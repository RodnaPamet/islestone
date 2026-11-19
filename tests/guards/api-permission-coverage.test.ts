/**
 * Guardrail: Epic C.1 — API permission coverage.
 *
 * Locks in two invariants for every "privileged" API route, so a future
 * PR that adds a sensitive endpoint cannot ship without API-layer
 * permission enforcement:
 *
 *   1. The route file uses `requirePermission(...)` from
 *      `@/lib/security/permission-middleware`.
 *   2. The route's URL pathname matches at least one rule in
 *      `ROUTE_PERMISSIONS` — the declarative source of truth that
 *      `tools/SDK generation/docs read`.
 *
 * "Privileged" is defined deterministically below — currently every
 * route under `src/app/api/t/[tenantSlug]/admin/`. This is intentionally
 * narrow for Epic C.1; widening to other privileged surfaces (billing,
 * security, sso) lands in C.2 once those routes adopt
 * `requirePermission` and gain map entries.
 *
 * The complementary guardrail `admin-route-coverage.test.ts` keeps the
 * legacy role-based guards (`requireAdminCtx` etc.) honest. The two
 * together mean: a privileged route either uses the new permission
 * key model OR the legacy role model — never neither.
 *
 * Failure messages are written to be copy-paste-actionable. A reviewer
 * who sees a CI failure here should know exactly which file to edit
 * and which line to add.
 *
 * ─── THIS IS LAYER 1. IT IS THE STRONG CLAIM. ──────────────────────
 *
 * `tests/guards/api-route-has-some-authorization.test.ts` is layer 2:
 * it walks the WHOLE api tree and asks only "is there any authorization
 * on this path at all?", accepting a usecase-layer `assertCan*` reached
 * through the call graph. That is a strictly weaker question, and it is
 * ADDITIVE — it does not and must not relax anything here.
 *
 * Nothing in this file may be softened to lean on layer 2. In particular
 * a usecase `assertCan*` does NOT satisfy the assertion below, and the
 * routes in `PRIVILEGED_ROOTS` do not migrate there: a `requirePermission`
 * denial writes a hash-chained AUTHZ_DENIED audit row and an
 * `assertCanAdmin` denial writes nothing, which is exactly the defect
 * Epic D.3 fixed for seven tenant routes. Accepting the weaker mechanism
 * on this population was measured, once, at a net strictness regression
 * across 25 routes.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
    ROUTE_PERMISSIONS,
    isRouteCovered,
    type RoutePermissionRule,
} from '@/lib/security/route-permissions';
import { getPermissionsForRole } from '@/lib/permissions';
import { codeOf } from '../helpers/source-blocks';
import { gitFiles } from '../helpers/git-files';

// ─── Discovery ───────────────────────────────────────────────────────

/**
 * Roots that are scanned for privileged route files. Each entry comes
 * with a short description that surfaces in failure output so a
 * reviewer can see why the directory is in scope.
 */
const PRIVILEGED_ROOTS: ReadonlyArray<{
    /** Filesystem path relative to repo root. */
    relPath: string;
    /** Human-readable rationale, surfaced in failures. */
    why: string;
}> = [
    // Islestone, sub-phase 1.4: the parent's roots are pruned to the three
    // directories that exist. Every other parent root (billing, SSO, the
    // compliance registers, the platform-admin surface, the CSP report) left
    // with its routes; a later sub-phase that brings one back brings its root.
    {
        relPath: 'src/app/api/t/[tenantSlug]/admin',
        why: 'Tenant admin surface — members, invites, custom roles, sessions, settings.',
    },
    {
        relPath: 'src/app/api/t/[tenantSlug]/security',
        why: 'Tenant security surface — MFA policy mutations + admin-driven session revocation.',
    },
    // Sub-phases 2.1–2.2: the work-item API and its configuration. Every
    // route carries a literal requirePermission, so a refusal writes an
    // AUTHZ_DENIED row, and every method has its rule.
    { relPath: 'src/app/api/t/[tenantSlug]/work-items', why: 'Work items: list, CRUD, state, assign, bulk, comments, watchers, links, relations, labels, moves.' },
    { relPath: 'src/app/api/t/[tenantSlug]/projects', why: 'Projects: create, edit, archive, delete, restore.' },
    { relPath: 'src/app/api/t/[tenantSlug]/teams', why: 'Teams and their workflow states.' },
    { relPath: 'src/app/api/t/[tenantSlug]/work-item-types', why: 'Work item types.' },
    { relPath: 'src/app/api/t/[tenantSlug]/labels', why: 'Labels.' },
    // NOT tenant-scoped, and that is exactly why it is here. `/api/account`
    // acts on the SESSION's user, so `requirePermission` — which resolves a
    // tenant role — does not apply to the route in it today. In scope so the
    // triage is FORCED: a new route under `/api/account` either uses
    // requirePermission or gets an EXCLUDED_ROUTES entry with a written reason.
    {
        relPath: 'src/app/api/account',
        why: 'Self-service account surface (profile). Session-scoped rather than tenant-scoped, so the existing route is excluded individually — the root is in scope so a future one cannot arrive unexamined.',
    },
];

/**
 * Routes intentionally excluded from API permission coverage. Each
 * entry MUST carry a `reason` so the carve-out is reviewable.
 *
 * Format: relative path from `src/app` (the same prefix `Next.js`
 * uses), e.g. `api/t/[tenantSlug]/admin/foo/route.ts`.
 */
const EXCLUDED_ROUTES: ReadonlyArray<{ relPath: string; reason: string }> = [
    // Epic D.3 — self-service security routes that are intentionally
    // NOT admin-gated. Any authenticated tenant member may operate on
    // their own MFA enrolment / challenge / current session. The
    // handlers resolve ctx via `getTenantCtx` and the underlying
    // usecases scope each action to `ctx.userId`. Admin-driven
    // counterparts (`/admin/sessions`, `/security/sessions/revoke-{all,user}`)
    // ARE in scope and gated by `requirePermission`.
    {
        relPath: 'api/t/[tenantSlug]/security/sessions/revoke-current/route.ts',
        reason: 'Self-service: revoke MY sessions (scoped to ctx.userId).',
    },
    {
        relPath: 'api/t/[tenantSlug]/security/mfa/enroll/route.ts',
        reason: 'Self-service: enrol MY MFA factor (scoped to ctx.userId).',
    },
    {
        relPath: 'api/t/[tenantSlug]/security/mfa/enroll/start/route.ts',
        reason: 'Self-service: start MY MFA enrolment.',
    },
    {
        relPath: 'api/t/[tenantSlug]/security/mfa/enroll/verify/route.ts',
        reason: 'Self-service: verify MY MFA enrolment.',
    },
    {
        relPath: 'api/t/[tenantSlug]/security/mfa/challenge/verify/route.ts',
        reason: 'Self-service: complete MY MFA challenge during sign-in.',
    },
    // `/api/account` — session-scoped, so there is no tenant role for
    // `requirePermission` to resolve. Described by what it ACTUALLY
    // authorises, not by the directory it sits in.
    {
        relPath: 'api/account/profile/route.ts',
        reason: 'Self-service: PATCH MY profile. The handler writes to the session user (getSession) and takes no user identifier from the request.',
    },
];

const REPO_ROOT = path.resolve(__dirname, '../..');

/** Every git-listed `route.ts(x)` under `dir` (absolute paths); population from git, never a directory walk. */
function walkRouteFiles(dir: string): string[] {
    const rel = path.relative(REPO_ROOT, dir) + '/';
    return gitFiles(REPO_ROOT)
        .filter((f) => f.startsWith(rel) && /\/route\.tsx?$/.test(f))
        .map((f) => path.join(REPO_ROOT, f));
}

function discoverPrivilegedRoutes(): string[] {
    const seen = new Set<string>();
    for (const root of PRIVILEGED_ROOTS) {
        const abs = path.resolve(REPO_ROOT, root.relPath);
        for (const f of walkRouteFiles(abs)) seen.add(f);
    }
    return Array.from(seen).sort();
}

/**
 * Convert a route file's filesystem path back to its URL pathname.
 *
 *   src/app/api/t/[tenantSlug]/admin/scim/route.ts
 *      → /api/t/acme/admin/scim
 *
 * `[tenantSlug]` becomes a literal segment so the regexes in
 * `ROUTE_PERMISSIONS` (which use `\/[^/]+`) match cleanly. Other
 * dynamic `[id]` segments are similarly stubbed.
 */
function fileToPathname(routeFile: string): string {
    const rel = path.relative(path.join(REPO_ROOT, 'src/app'), routeFile);
    const noFile = rel.replace(/\/route\.tsx?$/, '');
    const segments = noFile.split('/').map((seg) => {
        if (seg === '[tenantSlug]') return 'acme';
        if (seg.startsWith('[') && seg.endsWith(']')) return 'stub-id';
        return seg;
    });
    return '/' + segments.join('/');
}

/**
 * The route's CODE, comments masked. A docblock saying a handler is wrapped in
 * the permission middleware is not the wrapper: read raw, a route whose wrapper
 * had been deleted stayed green on the strength of its own comment (found
 * mutation-checking the legacy campaign route, 2026-10-26). String literals are
 * kept, so nothing else this file reads changes.
 */
function readSource(file: string): string {
    return codeOf(fs.readFileSync(file, 'utf8'));
}

/** A call (or a generic instantiation) of the wrapper, in code. */
const WRAPPER_CALL = /requirePermission\s*[<(]/;

function relPathFromRepo(file: string): string {
    return path.relative(REPO_ROOT, file);
}

function lookupExclusion(
    fileFromAppRoot: string,
): { reason: string } | undefined {
    return EXCLUDED_ROUTES.find((e) => e.relPath === fileFromAppRoot);
}

const PRIVILEGED_ROUTES = discoverPrivilegedRoutes();

/**
 * EVERY route file under `src/app/api`, for the orphan check only.
 *
 * A superset of `PRIVILEGED_ROUTES` by construction — see the orphan test for
 * why that test needs it and why no other test may use it.
 */
const ALL_API_ROUTES = walkRouteFiles(
    path.resolve(REPO_ROOT, 'src/app/api'),
).sort();

// ─── Tests ───────────────────────────────────────────────────────────

describe('Epic C.1 — API permission coverage guardrail', () => {
    it('discovers at least one privileged route (sanity check)', () => {
        // Catches a refactor that moves the admin directory and
        // silently empties the entire suite.
        expect(PRIVILEGED_ROUTES.length).toBeGreaterThan(0);
    });

    it('a wrapper spelled only in a comment does not count', () => {
        const commentOnly =
            "/** Gated by requirePermission('admin.manage', …). */\n" +
            'export const GET = withApiErrorHandling(handler);\n';
        // The raw text would satisfy the check; the code the guard reads must not.
        expect(WRAPPER_CALL.test(commentOnly)).toBe(true);
        expect(WRAPPER_CALL.test(codeOf(commentOnly))).toBe(false);
        expect(WRAPPER_CALL.test(codeOf("export const GET = requirePermission('admin.manage', h);"))).toBe(true);
    });

    test.each(
        PRIVILEGED_ROUTES.map((r) => [relPathFromRepo(r), r] as const),
    )('%s wraps its handlers with requirePermission(...)', (relFromRepo, full) => {
        const fromAppRoot = path.relative(
            path.join(REPO_ROOT, 'src/app'),
            full,
        );
        const exclusion = lookupExclusion(fromAppRoot);
        if (exclusion) {

            console.log(`[exempt] ${relFromRepo} — ${exclusion.reason}`);
            return;
        }

        const src = readSource(full);
        const ok = WRAPPER_CALL.test(src);

        if (!ok) {
            // High-signal failure message a reviewer can act on without
            // re-reading the test.
            throw new Error(
                [
                    `Privileged route is missing API-layer permission enforcement.`,
                    `  File:  ${relFromRepo}`,
                    `  Fix:   Wrap each exported handler with`,
                    `         requirePermission('admin.<key>', async (req, { params }, ctx) => { ... })`,
                    `         imported from '@/lib/security/permission-middleware'.`,
                    `         Then add the route URL to ROUTE_PERMISSIONS in`,
                    `         src/lib/security/route-permissions.ts.`,
                    `  Or:    If the route is intentionally exempt, append it to`,
                    `         EXCLUDED_ROUTES in this guardrail with a written reason.`,
                ].join('\n'),
            );
        }
    });

    test.each(
        PRIVILEGED_ROUTES.map((r) => [relPathFromRepo(r), r] as const),
    )('%s is registered in ROUTE_PERMISSIONS', (relFromRepo, full) => {
        const fromAppRoot = path.relative(
            path.join(REPO_ROOT, 'src/app'),
            full,
        );
        if (lookupExclusion(fromAppRoot)) return;

        const pathname = fileToPathname(full);

        if (!isRouteCovered(pathname)) {
            throw new Error(
                [
                    `Privileged route is not in the ROUTE_PERMISSIONS map.`,
                    `  File:     ${relFromRepo}`,
                    `  URL:      ${pathname}`,
                    `  Fix:      Add a rule in src/lib/security/route-permissions.ts:`,
                    ``,
                    `              {`,
                    `                  path: new RegExp(\`^\\\\/api\\\\/t\\\\/[^/]+\\\\/admin\\\\/<segment>(\\\\/.*)?$\`),`,
                    `                  permission: 'admin.<key>',`,
                    `                  note: 'Why this route is admin-only.',`,
                    `              }`,
                    ``,
                    `            …and ensure the rule's regex matches the URL above.`,
                ].join('\n'),
            );
        }
    });

    // ── Map sanity ──────────────────────────────────────────────────

    it('every rule in ROUTE_PERMISSIONS carries a non-trivial `note`', () => {
        const offenders = ROUTE_PERMISSIONS.filter(
            (r: RoutePermissionRule) => !r.note || r.note.trim().length < 20,
        ).map((r) => r.path.source);

        if (offenders.length > 0) {
            throw new Error(
                [
                    `ROUTE_PERMISSIONS contains rules with missing or trivial \`note\`:`,
                    ...offenders.map((p) => `  - ${p}`),
                    ``,
                    `Each rule must have a one-sentence rationale (>=20 chars) so a`,
                    `reviewer can validate the policy in code review without`,
                    `chasing the handler.`,
                ].join('\n'),
            );
        }
    });

    it('every rule references a real PermissionSet key', () => {
        // PermissionKey is a TS-only contract; this runtime check
        // prevents `as PermissionKey` casts from ever sneaking in.
        const adminPerms = getPermissionsForRole('ADMIN');
        const offenders: string[] = [];

        for (const rule of ROUTE_PERMISSIONS) {
            const keys = Array.isArray(rule.permission)
                ? rule.permission
                : [rule.permission];
            for (const k of keys) {
                const [domain, action] = k.split('.');
                const bag = (adminPerms as Record<string, Record<string, boolean>>)[
                    domain
                ];
                if (!bag || typeof bag[action] !== 'boolean') {
                    offenders.push(`${rule.path.source}: ${k}`);
                }
            }
        }

        if (offenders.length > 0) {
            throw new Error(
                [
                    `ROUTE_PERMISSIONS references unknown PermissionKey(s):`,
                    ...offenders.map((o) => `  - ${o}`),
                    ``,
                    `Check the spelling against PermissionSet in src/lib/permissions.ts`,
                    `and against the keys returned by getPermissionsForRole('ADMIN').`,
                ].join('\n'),
            );
        }
    });

    it('every EXCLUDED_ROUTES entry points at a route that still exists', () => {
        // This list had no such check, which is the same shape of hole as the
        // one that kept `/api/account` out of scope: an exemption nothing
        // validates. A carve-out whose file was renamed or deleted stays on
        // the list forever, and the next route to land on that path inherits
        // an exemption written for different code — silently ungated, with a
        // reason attached that no longer describes it.
        //
        // Deleting a route means deleting its entry, in the same diff.
        const dangling = EXCLUDED_ROUTES.filter(
            (e) => !fs.existsSync(path.join(REPO_ROOT, 'src/app', e.relPath)),
        );

        if (dangling.length > 0) {
            throw new Error(
                [
                    `EXCLUDED_ROUTES lists routes that no longer exist:`,
                    ...dangling.map((e) => `  - ${e.relPath}\n      reason: ${e.reason}`),
                    ``,
                    `If the route was deleted, delete its exclusion too.`,
                    `If it moved, update the path — the exemption does not follow it.`,
                ].join('\n'),
            );
        }
    });

    it('every EXCLUDED_ROUTES entry is actually reachable by the scan', () => {
        // The mirror, and the half that matters more. An exclusion for a file
        // under no PRIVILEGED_ROOT is dead text: the scan never reaches the
        // route, so the entry excludes nothing and its reason is never read.
        // It looks like a considered carve-out and is inert — which is how a
        // reviewer concludes a directory was triaged when it was not.
        const unreachable = EXCLUDED_ROUTES.filter(
            (e) =>
                !PRIVILEGED_ROUTES.some(
                    (f) => path.relative(path.join(REPO_ROOT, 'src/app'), f) === e.relPath,
                ),
        );

        if (unreachable.length > 0) {
            throw new Error(
                [
                    `EXCLUDED_ROUTES entries that no PRIVILEGED_ROOT covers:`,
                    ...unreachable.map((e) => `  - ${e.relPath}`),
                    ``,
                    `These exclude nothing. Either add the covering root to`,
                    `PRIVILEGED_ROOTS, or drop the entry.`,
                ].join('\n'),
            );
        }
    });

    it('every rule path-regex matches at least one real route on disk', () => {
        // Catches dead rules left over after a route is moved or
        // deleted. A rule that matches nothing silently weakens the
        // map's coverage signal.
        //
        // THE POPULATION IS THE WHOLE API TREE, not `PRIVILEGED_ROUTES`.
        //
        // The question this test asks is "does a route by that name EXIST?",
        // and existence does not depend on privilege. Asking it against the
        // privileged subset reported a rule as dead for the opposite reason —
        // #3472 added `requirePermission` to the agent-run SSE tail, which is a
        // gate STRONGER than its `getTenantCtx` siblings, and recorded it here;
        // the rule matched a live route that simply is not under
        // `PRIVILEGED_ROOTS`. A guard that fails a rule for being written about
        // the wrong directory pushes the next author toward deleting the record
        // rather than keeping it, which is the opposite of what this map is for.
        //
        // Narrowing is still caught: `PRIVILEGED_ROUTES` is what every OTHER
        // test in this file ranges over, and a privileged route missing its
        // `requirePermission` wrapper or its rule fails there, not here.
        const orphans: string[] = [];

        for (const rule of ROUTE_PERMISSIONS) {
            const matchesSomething = ALL_API_ROUTES.some((file) =>
                rule.path.test(fileToPathname(file)),
            );
            if (!matchesSomething) {
                orphans.push(rule.path.source);
            }
        }

        if (orphans.length > 0) {
            throw new Error(
                [
                    `ROUTE_PERMISSIONS contains rules that match no route on disk:`,
                    ...orphans.map((p) => `  - ${p}`),
                    ``,
                    `If the route was moved or deleted, remove or update the rule.`,
                    `If the rule covers a future route, add it together with the`,
                    `route file in the same PR.`,
                ].join('\n'),
            );
        }
    });
});
