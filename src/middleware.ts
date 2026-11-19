import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { env } from '@/env';
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
    unauthorizedJson,
} from '@/lib/auth/guard';
import { shouldBlockAdminRequest } from '@/lib/security/admin-session-guard';

/**
 * Edge middleware: the centralized auth guard for ALL routes.
 *
 * Copied from inflect-compliance `src/middleware.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (docs/porting/maps/1.4.md,
 * section A). It reads the NextAuth v4 JWT cookie with `getToken()`; token
 * fields are typed through the `next-auth/jwt` module augmentation in
 * `src/auth.ts`.
 *
 * What sub-phase 1.4 brings: the public-path allowlist, the JWT check, the
 * admin-path role gate with its cross-site refusal, both MFA gates, and the
 * tenant-access and org-access gates. What it leaves to later sub-phases:
 * the CSP nonce, CORS and the auth and read rate-limit tiers (1.5; the
 * baseline security headers are already set in `next.config.ts`), the
 * `iflk_` API-key fall-through (5.2), the web-vitals beacons (1.6), and the
 * parent's trust-centre, device and vendor-assessment paths (cut).
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

    // ── Request ID (reuse from upstream or generate) ──
    const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-request-id', requestId);

    // ── Auth API routes bypass ──
    // /api/auth/* routes are public and self-authenticating (they manage their
    // own session/CSRF handling). Skip the JWT-checking middleware path
    // entirely so the request body stream isn't disturbed.
    const isAuthApi = pathname.startsWith('/api/auth/');
    const authRes = isAuthApi ? NextResponse.next() : await authMiddleware(req);

    // If auth returned a redirect (3xx) or error (4xx/5xx), use it directly.
    // Otherwise forward the request with the request id. For /api/auth/
    // routes we must NOT pass { request: { headers } }: Next.js re-creates
    // the Request to apply header overrides, which can interfere with
    // NextAuth's body-parsing path.
    const isPassThrough = authRes.status === 200 && !authRes.headers.get('location');

    let res: NextResponse;
    if (!isPassThrough) {
        res = authRes;
    } else if (isAuthApi) {
        res = NextResponse.next();
    } else {
        res = NextResponse.next({ request: { headers: requestHeaders } });
    }

    res.headers.set('x-request-id', requestId);
    return res;
}

/**
 * Matcher: run middleware on all routes EXCEPT static assets.
 * The public path check inside the middleware handles /login, /api/auth, etc.
 */
export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)',
    ],
};
