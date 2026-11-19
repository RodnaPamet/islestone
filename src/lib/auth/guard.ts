/**
 * Edge-compatible auth guard helpers.
 * Pure functions — no Node.js or Prisma imports.
 * Used by middleware.ts for path classification and redirect building.
 *
 * Copied from inflect-compliance `src/lib/auth/guard.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e. Cut: the trust-centre,
 * vendor-assessment, audit-share, device and staging-seed public paths; the
 * AI_ADMIN, AUDITOR and reconciliation-view admin-path carve-outs (Phase 6
 * and cut). Deferred: the `iflk_` API-key recognition (5.2) and every
 * machine-caller entry (SCIM in 8.3, webhooks in 5.x, the CSP report in 1.5,
 * the platform-operator `/api/admin` routes when they arrive).
 */
import { NextResponse } from 'next/server';

import { EDGE_ADMIN_ROLES } from './edge-admin-roles';
import { sanitizeRedirectPath } from './redirect-path';

// ─── Public path allowlist ───
//
// The workspace picker (`/tenants`) is deliberately NOT here. It was, from
// R-1, "so it is reachable before an active tenant is set", but no gate in
// the middleware needs an active tenant for a path outside `/t/`, so the
// carve-out only changed what an UNAUTHENTICATED request got: the page's own
// `redirect('/login')`, which Next sends as a 307 carrying the whole root
// layout (about 800 KB, every i18n message; DAST rule 10044, 2026-11-13).
// Behind the gate it gets the edge's bodyless login redirect, and a session
// still owing its second factor is sent to the challenge rather than shown
// its workspaces.

const PUBLIC_PATH_PREFIXES = [
    '/login',
    '/register',
    '/forgot-password',  // Password-reset request page — unauthenticated users must reach it
    '/reset-password',   // Password-reset confirm page — reached from an emailed token link
    '/no-tenant',        // Landing page for uninvited users — must not gate-loop
    '/invite/',          // Invite preview page (tenant + org) — public so unauthenticated users can see invite details
    '/api/auth',         // Auth.js callbacks, session, csrf, providers
    '/api/invites/',     // Tenant invite redemption API (public) + start-signin cookie setter
    '/api/org/invite/',  // Org invite API (public) — preview/redeem + start-signin cookie setter, mirrors /api/invites/
    '/api/livez',        // Liveness probe (no auth)
    '/api/readyz',       // Readiness probe (no auth)
    '/_next',            // Next.js internals
];

const PUBLIC_PATH_EXACT = new Set([
    // Islestone: the placeholder home page and the UI gallery carry no
    // workspace data and were public before sub-phase 1.4 (the smoke and
    // gallery E2E specs read them signed out). Exact matches only, so
    // `/gallery/…` and every other path stay behind the gate.
    '/',
    '/gallery',
    '/favicon.ico',
    '/robots.txt',
    '/sitemap.xml',
]);

const STATIC_EXTENSIONS = /\.(ico|png|jpg|jpeg|gif|svg|webp|css|js|woff|woff2|ttf|eot|map|json)$/;

/**
 * Public API routes that the prefix allowlist cannot express — they carry a
 * dynamic tenant slug or resource id in the MIDDLE of the path, so a prefix
 * would over-expose the whole tenant API. These are anonymous, token- or
 * slug-authed endpoints whose real authentication runs INSIDE the handler
 * The middleware matcher only stops the blanket 401 so the request reaches
 * that handler. Empty: the parent's two (the device report and the trust
 * centre) are cut.
 */
export const PUBLIC_API_REGEXES: readonly RegExp[] = [];

/**
 * Endpoints whose caller is a MACHINE, not a browser session.
 *
 * These were all unreachable. The edge gate runs
 * `isPublicPath(pathname)` and then, on a missing JWT,
 * `if (isApiRoute(pathname)) return unauthorizedJson()` — so a caller with
 * no NextAuth cookie is refused BEFORE the handler that would have
 * authenticated it. Stripe, Microsoft Graph, the AV scanner, a SCIM IdP and
 * an MCP client all send exactly that request, and all got 401.
 *
 * Nothing about the routes looked wrong, which is why this survived: every
 * one of them verifies its own caller, correctly, in code that never ran.
 * The gap was that "authenticates itself" was never expressed to the edge.
 *
 * Each entry below MUST authenticate inside the handler. That is not a
 * convention — `tests/guards/machine-caller-paths-self-authenticate.test.ts`
 * fails if an entry here has no in-handler gate, because an allowlist entry
 * without one is a hole, and this list is the only thing standing between a
 * public prefix and the tenant API.
 *
 * And "the handler" means EVERY handler the file exports. Matching here is
 * path-scoped, not method-scoped: an entry added for one credential-less
 * method opens the others too. That is how `GET /api/security/csp-report`
 * came to serve the cross-tenant CSP violation buffer to the internet
 * (#2103) while its own comment said the middleware protected it. If a
 * route needs one method open and another closed, the closed one gates
 * itself in code — there is no way to say so here.
 */
export const MACHINE_CALLER_PREFIXES: readonly string[] = [
    // The CSP violation-report sink (sub-phase 1.6). A browser sends a report
    // with no cookie, so requiring credentials here guarantees zero reports
    // forever. The POST is the credential-less sink, rate-limited and
    // size-capped in its handler; the GET returns the process-wide violation
    // buffer and gates itself on PLATFORM_ADMIN_API_KEY, because this list
    // cannot express a method (and the edge meters it, src/middleware.ts).
    '/api/security/csp-report',
    '/api/csp-report',
    // Web-vitals beacon, same reasoning: `navigator.sendBeacon` from a page
    // that may not yet have a session. POST only, always 204, rate-limited in
    // the handler (`acceptVitalBeacon`).
    '/api/telemetry/vitals',
    // Sub-phase 8.3 adds `/api/scim` (bearer SCIM token,
    // `authenticateScimRequest`); later sub-phases add their webhook receivers
    // and the platform-operator `/api/admin` routes, each with the in-handler
    // gate the guard test requires.
];

/**
 * Check if a pathname is public (should bypass auth).
 */
export function isPublicPath(pathname: string): boolean {
    // Exact matches
    if (PUBLIC_PATH_EXACT.has(pathname)) return true;

    // Prefix matches
    if (PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return true;

    // Regex matches — public API routes with a dynamic segment mid-path.
    if (PUBLIC_API_REGEXES.some((re) => re.test(pathname))) return true;
    // Exact match OR a `<prefix>/…` sub-path. Deliberately NOT a bare
    // `startsWith`: that would make `/api/mcp` also open `/api/mcp-admin`,
    // and an allowlist whose entries quietly cover their own siblings is
    // the shape that turns one intended hole into several.
    if (MACHINE_CALLER_PREFIXES.some(
        (p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`),
    )) return true;

    // Static file extensions
    if (STATIC_EXTENSIONS.test(pathname)) return true;

    return false;
}

/**
 * Check if a pathname is an API route.
 */
export function isApiRoute(pathname: string): boolean {
    return pathname.startsWith('/api/');
}

/**
 * Check if a pathname requires admin role.
 * Recognizes both flat and tenant-scoped admin paths.
 */
export function isAdminPath(pathname: string): boolean {
    // Flat: /admin, /api/admin
    if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) return true;
    // Tenant-scoped: /t/:slug/admin, /api/t/:slug/admin
    if (/^\/t\/[^/]+\/admin/.test(pathname)) return true;
    if (/^\/api\/t\/[^/]+\/admin/.test(pathname)) return true;
    return false;
}

/**
 * Check if a pathname is a tenant-scoped route.
 */
export function isTenantPath(pathname: string): boolean {
    return pathname.startsWith('/t/') || pathname.startsWith('/api/t/');
}

/**
 * Check if a pathname is an org-scoped route.
 *
 * Mirror of `isTenantPath` for the hub-and-spoke organization layer.
 * Used by the middleware-level org-access gate (GAP O4-1) to decide
 * whether to apply the JWT-bound org membership check on top of the
 * existing layout/page/API guards.
 */
export function isOrgPath(pathname: string): boolean {
    return pathname.startsWith('/org/') || pathname.startsWith('/api/org/');
}

/**
 * Paths that stay reachable while `mfaPending` is true.
 *
 * This is an ALLOWLIST, and it is the ONLY thing that softens MFA
 * enforcement. inflect-compliance once gated MFA on
 * `isTenantPath(pathname) && !isMfaAllowedPath(pathname)`, which enforced by
 * URL SHAPE while authorization is enforced per route — so a session that had
 * presented a password and not a second factor was refused on `/api/t/**` and
 * admitted on every flat API route. The check is "every authenticated request
 * except these".
 *
 * Public and machine-caller paths are NOT listed here and do not need to be:
 * `isPublicPath` returns them at step 1 of the middleware, before the JWT is
 * ever read, so `/api/auth/` and the health probes never reach the MFA
 * branch at all. A
 * server-to-server caller also carries no `mfaPending` claim, so the check
 * would be a no-op for it even if it did.
 *
 * What IS here is the enrolment + challenge surface, because a user cannot
 * clear `mfaPending` without it:
 *
 *   - `/t/<slug>/auth/mfa`        — the challenge page.
 *   - `/t/<slug>/security/mfa`    — the ENROLMENT page. Under a REQUIRED
 *     policy an unenrolled user is `mfaPending` from first sign-in, and the
 *     challenge page's own "Set up MFA" button points here; without this
 *     entry that click bounced straight back to the challenge, so a
 *     REQUIRED-policy tenant could not onboard anyone. The docstring above
 *     claimed enrolment worked long before it did.
 *   - `/api/t/<slug>/security/mfa/**` — the APIs both of those pages call.
 *   - `/api/auth/` — sign-out, session, csrf. Redundant with `isPublicPath`
 *     and kept because this predicate is also read on its own.
 *
 * Adding an entry here creates a surface a half-authenticated session can
 * reach. Add only what is needed to COMPLETE the challenge.
 */
export function isMfaAllowedPath(pathname: string): boolean {
    // MFA challenge page, enrolment page, and the APIs those two pages call.
    //
    // Every pattern is ANCHORED on a segment boundary. An unanchored
    // `/security/mfa` prefix also matches `/security/mfa/policy` and
    // `/security/mfa-policy`, and `PUT` on the policy route is gated on
    // `admin.manage` and nothing else — `updateTenantMfaPolicy` has an
    // anti-lockout check for switching TO required and none for switching
    // AWAY. So an mfaPending ADMIN holding only a password could have sent
    // `{"mfaPolicy":"DISABLED"}`, signed out and back in fully authenticated,
    // and turned MFA off for every user in the tenant. The allowlist must
    // admit only what COMPLETES a challenge, never what redefines whether one
    // is required.
    if (/^\/t\/[^/]+\/auth\/mfa(?:\/|$)/.test(pathname)) return true;
    if (/^\/t\/[^/]+\/security\/mfa(?:\/|$)/.test(pathname)) return true;
    // Enumerated, not prefixed: `enroll` and `challenge` are the two the
    // challenge and enrolment pages call. A future sibling under this path is
    // NOT admitted by default, which is the failure mode above.
    if (/^\/api\/t\/[^/]+\/security\/mfa\/(?:enroll|challenge)(?:\/|$)/.test(pathname)) return true;
    // Auth callbacks (sign-out, etc.)
    if (pathname.startsWith('/api/auth/')) return true;
    return false;
}

// The open-redirect rule lives in `./redirect-path` so the client sign-in
// page can hold it too; re-exported here for the server callers.
export { sanitizeRedirectPath };

/**
 * Build a login redirect URL with a safe 'next' parameter.
 */
export function buildLoginRedirect(
    baseUrl: string,
    pathname: string
): URL {
    const loginUrl = new URL('/login', baseUrl);
    const safeNext = sanitizeRedirectPath(pathname);
    if (safeNext !== '/') {
        loginUrl.searchParams.set('next', safeNext);
    }
    return loginUrl;
}

/**
 * Return a 401 Unauthorized JSON response for API routes.
 */
export function unauthorizedJson(): NextResponse {
    return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
    );
}

/**
 * Return a 403 Forbidden JSON response.
 */
export function forbiddenJson(reason?: string): NextResponse {
    return NextResponse.json(
        { error: reason || 'Forbidden' },
        { status: 403 }
    );
}

/**
 * Extract the tenant slug from a tenant-scoped URL path.
 *
 * Handles both:
 *   /t/:slug/...           → slug
 *   /api/t/:slug/...       → slug
 *
 * Returns null for any path that is not tenant-scoped.
 */
export function extractTenantSlugFromPath(pathname: string): string | null {
    // /t/:slug/...  or  /t/:slug (trailing-slash-less)
    const webMatch = pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
    if (webMatch) return webMatch[1];

    // /api/t/:slug/...
    const apiMatch = pathname.match(/^\/api\/t\/([^/]+)(?:\/|$)/);
    if (apiMatch) return apiMatch[1];

    return null;
}

/**
 * The workspace whose MFA challenge this request must pass first, if any, for
 * the session's NON-primary workspaces (`mfaPendingTenantIds`; the primary one
 * is `mfaPending`, handled before this):
 *   - a path inside a pending workspace answers that workspace;
 *   - an org path answers the first pending workspace, because an org route
 *     exposes a portfolio that includes it;
 *   - any other path answers nothing.
 * Paths that must stay reachable mid-challenge are the caller's to exempt
 * (`isMfaAllowedPath`). See `src/lib/auth/workspace-mfa.ts`.
 */
export function pendingMfaWorkspaceSlug(
    pathname: string,
    token: {
        memberships?: ReadonlyArray<{ slug: string; tenantId: string }> | null;
        mfaPendingTenantIds?: readonly string[] | null;
    },
): string | null {
    const pending = new Set(token.mfaPendingTenantIds ?? []);
    if (pending.size === 0) return null;
    const memberships = token.memberships ?? [];
    const slug = extractTenantSlugFromPath(pathname);
    if (slug) {
        const membership = memberships.find((m) => m.slug === slug);
        return membership && pending.has(membership.tenantId) ? slug : null;
    }
    if (isOrgPath(pathname)) {
        return memberships.find((m) => pending.has(m.tenantId))?.slug ?? null;
    }
    return null;
}

/**
 * Pure gate function: check whether a user's memberships array allows access
 * to the given path. Extracted as a pure function so it can be unit-tested
 * without Next.js framework machinery.
 *
 * R-1: `memberships` replaces the old single-slug `jwtTenantSlug` parameter.
 * A user is allowed through to `/t/:slug/...` if ANY of their memberships
 * contains a matching slug.
 *
 * Returns:
 *   'allow'             — pass through
 *   'no_tenant_access'  — authed user has no tenant memberships at all
 *   'cross_tenant'      — the URL slug is not in any of the user's memberships
 *
 * `membershipsTruncated` — set when the JWT carries only a capped subset
 * of the user's memberships (see `MAX_JWT_MEMBERSHIPS` in `auth.ts`). A
 * slug-miss is then NOT definitive — the slug may be a membership that
 * did not fit — so the gate returns 'allow' and lets the authoritative,
 * DB-backed server-side check (`TenantLayout` / `getTenantCtx`) decide.
 * This is safe because the middleware gate is the early-rejection layer,
 * never the sole authority.
 */
export type TenantGateResult = 'allow' | 'no_tenant_access' | 'cross_tenant';

export function checkTenantAccess(
    pathname: string,
    memberships: ReadonlyArray<{ slug: string }> | null | undefined,
    membershipsTruncated = false,
): TenantGateResult {
    // Only gate tenant-scoped routes.
    const urlSlug = extractTenantSlugFromPath(pathname);
    if (!urlSlug) return 'allow';

    // Public paths that should always pass (e.g. MFA challenge within a tenant URL).
    // Already checked upstream in isPublicPath, but be defensive.
    if (isPublicPath(pathname)) return 'allow';

    // An empty list is unambiguous — a truncated list is never empty, so
    // this genuinely means the user holds no memberships.
    if (!memberships || memberships.length === 0) return 'no_tenant_access';

    if (!memberships.some((m) => m.slug === urlSlug)) {
        // Slug not in the (possibly capped) list. If capped, defer to
        // the server-side gate rather than redirect a legitimate member.
        return membershipsTruncated ? 'allow' : 'cross_tenant';
    }
    return 'allow';
}

// ── Admin-path gate ──────────────────────────────────────────────────

/**
 * The built-in roles the edge admits to an admin path. OWNER is strictly
 * superior to ADMIN. Defined in `./edge-admin-roles` so the admin pages, which
 * are client components, apply the same set.
 */
export { EDGE_ADMIN_ROLES };

/**
 * Pure gate function: may this session reach an admin path, judged by the
 * role it holds IN THE TENANT THE PATH NAMES?
 *
 * It does not read `token.role`, which is the role on the session's primary
 * (oldest) membership: a VIEWER in their first tenant and an OWNER in a
 * second would be refused every admin route in the second, and an OWNER in
 * their first tenant would pass this gate in any tenant they held at all.
 *
 * Returns:
 *   'allow' — the role here is an admin role (OWNER or ADMIN)
 *   'deny'  — the role here is not
 *   'defer' — the URL's tenant is not in the claim. This gate does not own
 *             that answer: the tenant-access gate does, and it refuses
 *             `cross_tenant` when the claim is complete, or defers to the
 *             DB-backed server gate when it was capped at sign-in. Refusing
 *             here instead would deny a legitimate member whose membership did
 *             not fit in the cookie.
 *
 * A flat admin path names no tenant, so it is judged by the primary role, as
 * before.
 */
export type AdminGateResult = 'allow' | 'deny' | 'defer';

export function checkAdminAccess(
    pathname: string,
    primaryRole: string | null | undefined,
    memberships: ReadonlyArray<{ slug: string; role: string }> | null | undefined,
    /**
     * The request method. Kept in the signature for the method-scoped
     * carve-outs later phases may add (the parent's AUDITOR reads); unread.
     */
    _method?: string | null,
): AdminGateResult {
    const urlSlug = extractTenantSlugFromPath(pathname);
    if (!urlSlug) {
        return primaryRole && EDGE_ADMIN_ROLES.has(primaryRole) ? 'allow' : 'deny';
    }
    const here = memberships?.find((m) => m.slug === urlSlug);
    if (!here) return 'defer';
    if (EDGE_ADMIN_ROLES.has(here.role)) return 'allow';
    return 'deny';
}

// ── Org-route gate (mirror of the tenant gate) ───────────────────────

/**
 * Extract the org slug from `/org/:slug/...` or `/api/org/:slug/...`.
 * Returns null for any path that is not org-scoped.
 */
export function extractOrgSlugFromPath(pathname: string): string | null {
    const webMatch = pathname.match(/^\/org\/([^/]+)(?:\/|$)/);
    if (webMatch) return webMatch[1];

    const apiMatch = pathname.match(/^\/api\/org\/([^/]+)(?:\/|$)/);
    if (apiMatch) return apiMatch[1];

    return null;
}

/**
 * Pure gate: check whether a user's `orgMemberships` allows access to
 * an `/org/:slug/...` or `/api/org/:slug/...` path. Same shape as
 * `checkTenantAccess` so the middleware can route both gates through
 * a parallel branch.
 *
 * Returns:
 *   'allow'           — pass through
 *   'no_org_access'   — authed user has no org memberships at all
 *   'cross_org'       — the URL slug is not in any of the user's org memberships
 *
 * Anti-enumeration: middleware MUST collapse both `no_org_access` and
 * `cross_org` to the SAME external response (404 / no-tenant). The
 * distinction exists for log/metric tagging, not for the user.
 *
 * `orgMembershipsTruncated` — same contract as `checkTenantAccess`'s
 * `membershipsTruncated`: a slug-miss against a capped list defers to
 * the authoritative server-side org gate instead of denying.
 */
export type OrgGateResult = 'allow' | 'no_org_access' | 'cross_org';

export function checkOrgAccess(
    pathname: string,
    orgMemberships: ReadonlyArray<{ slug: string }> | null | undefined,
    orgMembershipsTruncated = false,
): OrgGateResult {
    const urlSlug = extractOrgSlugFromPath(pathname);
    if (!urlSlug) return 'allow';

    if (isPublicPath(pathname)) return 'allow';

    if (!orgMemberships || orgMemberships.length === 0) return 'no_org_access';

    if (!orgMemberships.some((m) => m.slug === urlSlug)) {
        return orgMembershipsTruncated ? 'allow' : 'cross_org';
    }
    return 'allow';
}
