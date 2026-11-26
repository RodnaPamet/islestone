import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { env } from '@/env';
import { checkApiReadRateLimit, extractTenantSlug, isApiReadRateLimited } from '@/lib/rate-limit/apiReadRateLimit';
import { checkAuthRateLimit } from '@/lib/rate-limit/authRateLimit';
import { tenantLandingPath } from '@/lib/auth/landing';
import { applySecurityHeaders } from '@/lib/security-headers';
import {
    buildLoginRedirect,
    checkAdminAccess,
    checkOrgAccess,
    checkTenantAccess,
    extractTenantSlugFromPath,
    forbiddenJson,
    isAdminPath,
    isApiRoute,
    isMfaAllowedPath,
    isOrgPath,
    isPublicPath,
    isTenantPath,
    pendingMfaWorkspaceSlug,
    publicIntakeRateKey,
    unauthorizedJson,
} from '@/lib/auth/guard';
import { shouldBlockAdminRequest } from '@/lib/security/admin-session-guard';
import { applyCorsHeaders, CORS_PREFLIGHT_HEADERS, isOriginAllowed, resolveCorsConfig } from '@/lib/security/cors';
import {
    buildCspHeader,
    CSP_NONCE_HEADER,
    CSP_REPORT_GROUP,
    CSP_REPORT_PATH,
    generateNonce,
    getCspHeaderName,
    isCspReportOnly,
    LEGACY_CSP_REPORT_PATH,
} from '@/lib/security/csp';
import { edgeLogger } from '@/lib/observability/edge-logger';
import {
    documentLoadRoute,
    DOCUMENT_LOAD_MSG,
    softNavigationRoute,
    SOFT_NAVIGATION_MSG,
} from '@/lib/observability/vital-route';

/**
 * Edge middleware: the centralized auth guard for ALL routes.
 *
 * Copied from inflect-compliance `src/middleware.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (docs/porting/maps/1.4.md,
 * section A). It reads the NextAuth v4 JWT cookie with `getToken()`; token
 * fields are typed through the `next-auth/jwt` module augmentation in
 * `src/auth.ts`.
 *
 * Sub-phase 1.4 brought the public-path allowlist, the JWT check, the
 * admin-path role gate with its cross-site refusal, both MFA gates, and the
 * tenant-access and org-access gates. Sub-phase 1.5 adds the perimeter: the
 * per-request CSP nonce, CORS (fail-closed in production), the auth-tier
 * rate limit on `/api/auth/**`, the read-tier rate limit on tenant GETs, and
 * the baseline security headers on every response the middleware answers
 * itself. Sub-phase 1.6 adds the web-vitals denominator (one `document_load`
 * line per served page and one `soft_navigation` line per client navigation)
 * and the CSP violation-report sink (the reporting headers, and an edge rate
 * limit on the sink's operator GET). Later: the `iflk_` API-key fall-through
 * (5.2). The parent's trust-centre,
 * device and vendor-assessment paths are cut.
 *
 * CSP flow:
 *   1. Generate a cryptographic nonce per request.
 *   2. Pass it to server components in the `x-csp-nonce` request header, and
 *      the whole policy in the `Content-Security-Policy` REQUEST header, which
 *      is what Next.js reads to stamp its own `<script>` tags with the nonce.
 *   3. Send the policy as the response's Content-Security-Policy (or the
 *      Report-Only header when CSP_REPORT_ONLY is set).
 *
 * Auth behavior:
 *   ┌──────────────────┬───────────────┬──────────────────────────┐
 *   │ Route type       │ Unauthed      │ Authed but wrong role    │
 *   ├──────────────────┼───────────────┼──────────────────────────┤
 *   │ /api/*           │ 401 JSON      │ 403 JSON                 │
 *   │ App pages        │ redirect →    │ passed to the page's own │
 *   │                  │  /login?next= │ server gate              │
 *   │ Public paths     │ allowed       │ allowed                  │
 *   └──────────────────┴───────────────┴──────────────────────────┘
 */

async function authMiddleware(req: NextRequest): Promise<NextResponse> {
    const { pathname } = req.nextUrl;

    // ── 0e. CSP violation report — meter the operator GET, leave the
    // browser POST alone (inflect-compliance's block 0e, sub-phase 1.6).
    //
    // The report paths sit in MACHINE_CALLER_PREFIXES so a browser can POST a
    // report with no cookie, and that allowlist matches a PATH — so the
    // operator GET, which returns the process-wide violation buffer behind
    // PLATFORM_ADMIN_API_KEY, would be reachable from the internet at any rate
    // at all (inflect measured 500 wrong-key GETs, 500 × 401, zero 429). The
    // key is compared in constant time, so guessing it is not the threat; the
    // threat is that each attempt is free to the caller and not to us.
    //
    // GET (and the HEAD Next.js derives from it) — deliberately not POST. The
    // POST is a credential-less browser beacon, and a limiter it shares with
    // an attacker silently drops real reports. It keeps its own per-IP limiter
    // (30/min) and 16 KB body cap inside the handler.
    //
    // Keyed by IP alone (`checkApiReadRateLimit` folds the client IP in; no
    // JWT has been read here). NOT keyed by the presented credential: that is
    // the thing an attacker varies, and keying by it would hand every guess a
    // fresh budget. Budget: API_READ_LIMIT (120/min).
    if (
        (req.method === 'GET' || req.method === 'HEAD') &&
        (pathname === CSP_REPORT_PATH || pathname === LEGACY_CSP_REPORT_PATH)
    ) {
        const rl = await checkApiReadRateLimit(req, null, 'cspreport');
        if (!rl.ok && rl.response) {
            return rl.response;
        }
        // Falls THROUGH to the allowlist rather than returning
        // `NextResponse.next()`: MACHINE_CALLER_PREFIXES stays the only thing
        // making this path public at the edge, which is what `guard.ts`
        // claims of it.
    }

    // ── 0f. Public intake forms (sub-phase 2.6b, owner decision 88) ──
    //
    // `/f/<publicId>`, `/f/confirm/<token>` and the two public intake POSTs
    // are public at the edge (`PUBLIC_PATH_PREFIXES`, `MACHINE_CALLER_PREFIXES`),
    // so the read tier's budget (120/min) is applied here, every method, before
    // the allowlist returns: keyed by IP and form for a form and its submit, by
    // IP alone for the confirmation. The submit keeps its own stricter per-IP
    // and per-form limits in its handler, and the daily caps are counted from
    // the database. Falls through to the allowlist, which stays the only thing
    // making these paths public.
    {
        const intakeKey = publicIntakeRateKey(pathname);
        if (intakeKey) {
            const rl = await checkApiReadRateLimit(req, null, intakeKey);
            if (!rl.ok && rl.response) return rl.response;
        }
    }

    // ── 1. Allow public paths (login, auth callbacks, static, etc.) ──
    if (isPublicPath(pathname)) {
        return NextResponse.next();
    }

    // ── 2. Verify JWT cookie ──
    // v4 — `getToken()` reads + verifies the JWT cookie set by NextAuth.
    // Returns null if no cookie / bad signature / expired.
    const token = await getToken({
        req,
        secret: env.AUTH_SECRET,
    });

    if (!token) {
        if (isApiRoute(pathname)) {
            return unauthorizedJson();
        }
        const proto = req.headers.get('x-forwarded-proto') || 'http';
        const host = req.headers.get('host') || req.nextUrl.host;
        const origin = `${proto}://${host}`;
        return NextResponse.redirect(
            buildLoginRedirect(origin, pathname),
        );
    }

    // ── 3. Admin-only paths ──
    if (isAdminPath(pathname)) {
        // Judged by the role in the tenant the URL names, not the primary
        // membership's. A tenant missing from the claim is 'defer': the
        // tenant-access gate below owns that answer. The handler's
        // `requirePermission` stays the authority either way.
        if (checkAdminAccess(pathname, token.role, token.memberships, req.method) === 'deny') {
            if (isApiRoute(pathname)) {
                return forbiddenJson('Admin access required');
            }

            // A refused PAGE request is not answered here. It goes on to the
            // App Router, where each admin server page refuses it itself
            // (the admin pages arrive with sub-phase 1.7).
            //
            // It goes on THROUGH the MFA gates below, not around them: a page
            // that a server gate admits must have passed its second factor
            // like any other tenant page.
        }

        // Admin role confirmed here, or deferred to the tenant-access gate —
        // either way, enforce the stricter session posture. (A refused page
        // request reaches this line too; the check below is for API routes,
        // and a refused API request has already been answered.)
        // Block cross-site requests to admin API routes (Sec-Fetch-Site check).
        // This provides equivalent protection to SameSite=strict cookies
        // without breaking OAuth redirect flows that require SameSite=lax.
        if (isApiRoute(pathname)) {
            const secFetchSite = req.headers.get('sec-fetch-site');
            const method = req.method || 'GET';
            if (shouldBlockAdminRequest(secFetchSite, method)) {
                return forbiddenJson('Cross-site admin requests are not allowed');
            }
        }
    }

    // ── 4. MFA enforcement ──
    // EVERY authenticated request, minus an explicit allowlist. Execution
    // reaches this line only past the `!token` return above, so "authenticated"
    // is already established.
    //
    // inflect-compliance once enforced MFA by URL SHAPE
    // (`isTenantPath(pathname) && !isMfaAllowedPath(…)`) while authorization
    // is enforced per route, and the two disagreed on 93 paths. The
    // predicate is therefore inverted: every authenticated path but the
    // allowlist.
    //
    // Public + machine-caller paths do not regress, and not because they are
    // listed: `isPublicPath` returned them at step 1, before `getToken` ran.
    // `/api/auth/`, `/api/livez`, `/api/readyz` and `/api/scim` never arrive
    // here.
    //
    // `/api/org/**` is gated the same as tenant routes. That is a decision,
    // not an inference: nothing in the code answers whether an ORG_ADMIN
    // mid-challenge may read org data, so the conservative reading applies —
    // `mfaPending` is a property of the PRINCIPAL (it is set on the token from
    // the active tenant's `mfaPolicy`, not derived from the path), and an org
    // route exposes a portfolio spanning every tenant under the org, which is
    // a superset of the one tenant whose policy demanded the second factor.
    // Admitting it would mean the broader surface is the unguarded one.
    if (!isMfaAllowedPath(pathname) && token.mfaPending === true) {
        if (isApiRoute(pathname)) {
            return forbiddenJson('MFA verification required');
        }

        // The challenge lives at a tenant URL, and `mfaPending` is the
        // PRIMARY workspace's: the challenge verifies a code for the workspace
        // in its URL, so it must be the primary's. `tenantSlug` is always
        // populated here: `mfaPending` is only ever set when `token.tenantId`
        // is non-null (`src/auth.ts` — the MFA block is inside `if
        // (activeTenantId)`), and `tenantId`/`tenantSlug` are assigned
        // together from the primary membership. The URL's slug is the fallback
        // for a token that somehow lacks it.
        const tenantSlug =
            token.tenantSlug ?? extractTenantSlugFromPath(pathname) ?? null;

        if (tenantSlug) {
            const mfaUrl = new URL(`/t/${tenantSlug}/auth/mfa`, req.nextUrl.origin);
            mfaUrl.searchParams.set('next', pathname);
            return NextResponse.redirect(mfaUrl);
        }

        // No slug anywhere — a state the paragraph above says is unreachable.
        // Send them somewhere terminal and public rather than falling through,
        // because falling through is how a page path used to skip this gate
        // entirely.
        return NextResponse.redirect(new URL('/no-tenant', req.nextUrl.origin));
    }

    // ── 4b. MFA for the workspace being opened ──
    // The primary workspace's policy is `mfaPending`, above. Every other
    // workspace the session can reach was asked at sign-in too, and one that
    // still wants a code from this session holds its own paths (and org paths)
    // until its own challenge is passed (`pendingMfaWorkspaceSlug`). Before,
    // only the oldest membership's policy was ever asked.
    if (!isMfaAllowedPath(pathname)) {
        const pendingSlug = pendingMfaWorkspaceSlug(pathname, token);
        if (pendingSlug) {
            if (isApiRoute(pathname)) {
                return forbiddenJson('MFA verification required');
            }
            const mfaUrl = new URL(`/t/${pendingSlug}/auth/mfa`, req.nextUrl.origin);
            mfaUrl.searchParams.set('next', pathname);
            return NextResponse.redirect(mfaUrl);
        }
    }

    // ── 5. Tenant-access gate ──
    // R-1: check whether the URL slug appears in the user's memberships
    // array. No DB hit — the JWT claim is the early-rejection layer. If
    // the membership list was capped at sign-in (membershipsTruncated),
    // a slug-miss defers to the authoritative server-side gate
    // (TenantLayout / getTenantCtx) instead of a definitive denial.
    if (isTenantPath(pathname)) {
        const memberships = token.memberships;
        const gateResult = checkTenantAccess(
            pathname,
            memberships,
            token.membershipsTruncated === true,
        );

        if (gateResult === 'no_tenant_access') {
            if (isApiRoute(pathname)) {
                return NextResponse.json(
                    { error: 'no_tenant_access' },
                    { status: 403 },
                );
            }
            return NextResponse.redirect(new URL('/no-tenant', req.nextUrl.origin));
        }

        if (gateResult === 'cross_tenant') {
            if (isApiRoute(pathname)) {
                return NextResponse.json(
                    { error: 'cross_tenant_access_denied' },
                    { status: 403 },
                );
            }
            return NextResponse.redirect(new URL('/no-tenant', req.nextUrl.origin));
        }

        // ── 5a. The workspace root goes to My Work ──
        // Answered here, after the gate, with an empty body. As a page,
        // `redirect()` in `t/[tenantSlug]/(app)/page.tsx`, it was a 307 whose
        // body streamed the workspace layout's shell, the signed-in person's
        // name and email in it (ZAP rule 10044, Big Redirect: found when
        // Hardening H2f's nightly scan reached `/t/<slug>`).
        const root = /^\/t\/([^/]+)\/?$/.exec(pathname);
        if (root) {
            let slug: string;
            try {
                slug = decodeURIComponent(root[1]!);
            } catch {
                slug = root[1]!;
            }
            return NextResponse.redirect(new URL(tenantLandingPath(slug), req.nextUrl.origin), 307);
        }
    }

    // ── 5b. Org-access gate (GAP O4-1) ──
    // Mirror of the tenant gate, keyed on `token.orgMemberships`.
    // Same anti-enumeration posture as `getOrgCtx` / `getOrgServerContext`:
    // both `no_org_access` and `cross_org` collapse to a single
    // external response (notFound for pages, 404 JSON for API). The
    // gate-result string distinguishes them for ops via the standard
    // request-id correlation; nothing leaks to the caller.
    //
    // No DB hit — the JWT claim is the authority. The `orgMemberships`
    // array is populated by the JWT callback in `src/auth.ts` at
    // sign-in time. Page-level (`getOrgServerContext`) and API-level
    // (`getOrgCtx`) checks remain in place as defense-in-depth — this
    // is the early-rejection layer, not a replacement.
    if (isOrgPath(pathname)) {
        const gateResult = checkOrgAccess(
            pathname,
            token.orgMemberships,
            token.orgMembershipsTruncated === true,
        );
        if (gateResult !== 'allow') {
            if (isApiRoute(pathname)) {
                return NextResponse.json(
                    { error: 'not_found' },
                    { status: 404 },
                );
            }
            // 404 surface — route to the same landing page non-members
            // see today via the layout's `notFound()` collapse, so a
            // probing user can't tell whether the slug exists.
            return NextResponse.redirect(new URL('/no-tenant', req.nextUrl.origin));
        }
    }

    // ── 5c. API read rate limit (GAP-17) ──
    // Tenant-scoped GETs go through a dedicated read-tier limiter before
    // reaching the route handler. Sits AFTER the tenant-access gate so an
    // unauthorized cross-tenant read still gets the cheaper 403, and BEFORE
    // the route runs, so an exhausted budget costs no database query. The
    // health probes are excluded by `isApiReadRateLimited`. Mutations and
    // non-tenant routes are unaffected: they have their own tiers.
    if (isApiReadRateLimited(req.method, pathname)) {
        const tenantSlug = extractTenantSlug(pathname);
        const userId = (token.sub as string | undefined) ?? null;
        const rl = await checkApiReadRateLimit(req, userId, tenantSlug);
        if (!rl.ok && rl.response) {
            return rl.response;
        }
    }

    // ── 5b. The calendar OAuth callbacks (roadmap 3.3b) ──
    // Signed-in GETs outside `/api/t/` (each provider returns to one fixed
    // URI), so the tenant read tier above does not see them: the same budget,
    // keyed by IP and user under their own name.
    if (req.method === 'GET' && pathname.startsWith('/api/integrations/calendar/')) {
        const userId = (token.sub as string | undefined) ?? null;
        const rl = await checkApiReadRateLimit(req, userId, 'calendarcallback');
        if (!rl.ok && rl.response) {
            return rl.response;
        }
    }

    // ── 6. Authenticated and authorized → proceed ──
    return NextResponse.next();
}

export default async function middleware(
    req: NextRequest,
    // Optional 2nd arg kept for test fixtures that call `middleware(req, {})`.
    // Unused: the JWT is read via `getToken({ req })`.
    _ctx?: unknown,
): Promise<NextResponse> {
    void _ctx;
    const { pathname } = req.nextUrl;
    const isProduction = env.NODE_ENV === 'production';

    // ── CSP nonce — generated once per request ──
    const nonce = generateNonce();
    const cspHeader = buildCspHeader(nonce, env.NODE_ENV === 'development');
    const cspHeaderName = getCspHeaderName(isCspReportOnly(env.CSP_REPORT_ONLY));

    // ── Request ID (reuse from upstream or generate) ──
    const requestId = req.headers.get('x-request-id') || crypto.randomUUID();

    // ── Pass the nonce, and the whole policy, to the render ──
    // Next.js reads the FULL policy from the request's Content-Security-Policy
    // header to stamp its own chunk-preload `<link>` and loader `<script>` tags
    // with the nonce; the `x-csp-nonce` header is for our own server components
    // (the root layout). Without the policy on the request, `strict-dynamic`
    // blocks every chunk not rendered with the nonce.
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set(CSP_NONCE_HEADER, nonce);
    requestHeaders.set('x-request-id', requestId);
    requestHeaders.set(cspHeaderName, cspHeader);

    // ── CORS policy — environment-aware, fail-closed in production ──
    const origin = req.headers.get('origin') ?? '';
    const corsConfig = resolveCorsConfig(env.CORS_ALLOWED_ORIGINS, env.NODE_ENV);
    const isAllowedOrigin = isOriginAllowed(origin, corsConfig);

    // ── CORS preflight for APIs ──
    if (pathname.startsWith('/api/') && req.method === 'OPTIONS') {
        const preflightHeaders = new Headers();
        if (isAllowedOrigin && origin) {
            applyCorsHeaders(preflightHeaders, origin);
        }
        for (const [key, value] of Object.entries(CORS_PREFLIGHT_HEADERS)) {
            preflightHeaders.set(key, value);
        }
        preflightHeaders.set('x-request-id', requestId);
        preflightHeaders.set(cspHeaderName, cspHeader);
        applySecurityHeaders(preflightHeaders, isProduction);
        return new NextResponse(null, { status: 204, headers: preflightHeaders });
    }

    // ── Auth API routes: the auth rate-limit tier, then bypass ──
    // /api/auth/* routes are public and self-authenticating (they manage their
    // own session/CSRF handling). They get the auth tier here (keyed on IP and
    // a user-agent hash, because they run before authentication), then skip
    // the JWT-checking middleware path entirely so the request body stream
    // isn't disturbed.
    const isAuthApi = pathname.startsWith('/api/auth/');
    let authRes: NextResponse;
    if (isAuthApi) {
        const rl = await checkAuthRateLimit(req);
        authRes = !rl.ok && rl.response ? rl.response : NextResponse.next();
    } else {
        authRes = await authMiddleware(req);
    }

    // If auth returned a redirect (3xx) or error (4xx/5xx), use it directly.
    // Otherwise forward the request with the nonce, the policy and the request
    // id. For /api/auth/ routes we must NOT pass { request: { headers } }:
    // Next.js re-creates the Request to apply header overrides, which can
    // interfere with NextAuth's body-parsing path.
    const isPassThrough = authRes.status === 200 && !authRes.headers.get('location');

    let res: NextResponse;
    if (!isPassThrough) {
        res = authRes;
        // next.config.ts headers do not reach a response the middleware
        // answers itself, so the baseline headers are set here.
        applySecurityHeaders(res.headers, isProduction);
    } else if (isAuthApi) {
        res = NextResponse.next();
    } else {
        res = NextResponse.next({ request: { headers: requestHeaders } });
    }

    // ── CSP and request id on every response ──
    res.headers.set(cspHeaderName, cspHeader);
    res.headers.set('x-request-id', requestId);

    // ── Where the browser sends violation reports (sub-phase 1.6) ──
    // `Report-To` for the Reporting API the policy's `report-to` names, and
    // `Reporting-Endpoints`, its newer replacement (Chrome 96+). The policy's
    // `report-uri` covers browsers that support neither.
    res.headers.set('Report-To', JSON.stringify({
        group: CSP_REPORT_GROUP,
        max_age: 86400,
        endpoints: [{ url: CSP_REPORT_PATH }],
    }));
    res.headers.set('Reporting-Endpoints', `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`);

    // ── CORS headers on API responses (environment-locked) ──
    if (pathname.startsWith('/api/') && isAllowedOrigin && origin) {
        applyCorsHeaders(res.headers, origin);
    }

    // ── THE WEB-VITALS DENOMINATOR (inflect #3547) ──
    //
    // inflect-compliance's production had 12 `web_vital` beacons in 30 days
    // and nothing to divide them by: the app logged no HTTP requests at all,
    // so "12 beacons" could not be read as "almost no traffic" OR as "beacons
    // are being dropped", and those two have completely different responses.
    //
    // One line per SERVED DOCUMENT, labelled by the same `normalizeVitalRoute`
    // the beacons use — the decision and the label both live in
    // `documentLoadRoute`, which is pure and unit-tested, because this file can
    // only be tested by grepping its own source.
    //
    // Bounded on purpose: one line per page load, route only. No tenant, no
    // user, no IP — the route label is already collapsed to fixed cardinality,
    // and anything per-identity would turn an access log into a PII store.
    const documentRoute = documentLoadRoute({
        fetchDest: req.headers.get('sec-fetch-dest'),
        pathname,
        passedThrough: isPassThrough,
    });
    if (documentRoute !== null) {
        edgeLogger.info(DOCUMENT_LOAD_MSG, { route: documentRoute, requestId });
    }

    // AND ONE PER CLIENT-SIDE NAVIGATION (inflect #4195), which is what four
    // of the five web-vitals fire on. Counted separately rather than folded
    // into the line above: `document_load` answers "is anyone using the app",
    // the two together answer "are beacons being dropped". Same bounded shape
    // — route only, nothing per-identity.
    const softNavRoute = softNavigationRoute({
        rsc: req.headers.get('rsc'),
        routerPrefetch: req.headers.get('next-router-prefetch'),
        pathname,
        passedThrough: isPassThrough,
    });
    if (softNavRoute !== null) {
        edgeLogger.info(SOFT_NAVIGATION_MSG, { route: softNavRoute, requestId });
    }

    return res;
}

/**
 * Matcher: run middleware on all routes EXCEPT the build's static assets.
 * The public path check inside the middleware handles /login, /api/auth, etc.
 *
 * `favicon.ico`, `robots.txt` and `sitemap.xml` are NOT skipped (Hardening
 * H1, the ZAP baseline's 10038): Islestone serves none of them as a file (the
 * icon is `src/app/icon.svg`, `public/` is empty), so Next.js answers each
 * with the HTML not-found page, and a skipped path got that page with no
 * Content-Security-Policy. Through the middleware they are public paths
 * (`PUBLIC_PATH_EXACT` in guard.ts) and get the nonce policy like every page.
 */
export const config = {
    matcher: [
        '/((?!_next/static|_next/image).*)',
    ],
};
