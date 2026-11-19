/**
 * Route → permission map for the API surface.
 *
 * Copied from inflect-compliance `src/lib/security/route-permissions.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e: the mechanism (`HttpMethod`,
 * `RoutePermissionRule`, the `T` prefix, `resolveRoutePermission`,
 * `isRouteCovered`) unchanged, and the rules cut to the routes Islestone has
 * (docs/porting/maps/1.4.md, section D).
 *
 * The map is the single declarative source of truth for "which
 * `PermissionKey` does this URL require?" — it lets us:
 *
 *   1. Roll the `requirePermission(...)` middleware across handlers
 *      without duplicating the policy in twelve different files.
 *   2. Guard against a new sensitive route shipping unprotected: the
 *      coverage test in `tests/guards/api-permission-coverage.test.ts`
 *      walks `src/app/api/**\/route.ts` and verifies every in-scope
 *      route has a matching rule AND uses `requirePermission(...)` in
 *      its handler.
 *   3. Surface the policy in code review: a PR that touches an admin
 *      route is forced to update this map, which a reviewer can read
 *      in isolation without context-switching across handler files.
 *
 * Adding or moving an admin/privileged route:
 *   - Add a rule below covering the path + methods.
 *   - Wire `requirePermission(<key>, …)` into the route handler.
 *   - Run `npx jest tests/guards/api-permission-coverage.test.ts`
 *     to verify the rollout is complete.
 *
 * This file is intentionally narrow in scope. It only enumerates
 * privileged routes (admin, member management, security settings).
 * Ordinary tenant routes authorise through the usecase-layer policy
 * helpers (`assertCanRead/Write/Admin`). Later sub-phases add their own
 * rules: API keys (5.2), integrations (5.x), billing (8.1), key rotation
 * (1.5), automations (5.1), notification settings (1.6), SSO and SCIM
 * (8.3). First match wins, so a specific rule sits above its catch-all.
 */

import type { PermissionKey, PermissionMode } from './permission-middleware';

// ─── Rule shape ─────────────────────────────────────────────────────

/**
 * Closed set of HTTP methods a rule may gate. Template-literal union
 * enforces at compile time that every rule uses the canonical
 * uppercase form — the hot path at line ~210 does a direct
 * `includes` with no per-call normalisation.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RoutePermissionRule {
    /**
     * Regex matched against `req.nextUrl.pathname`. Use `\/[^/]+\/` for
     * a single dynamic segment (so trailing slashes / query strings
     * don't accidentally match).
     */
    path: RegExp;
    /**
     * HTTP methods this rule covers. Omit to apply to every method.
     * MUST be uppercase — the compile-time `HttpMethod` union enforces.
     */
    methods?: readonly HttpMethod[];
    /**
     * Permission key(s) required to call the route.
     */
    permission: PermissionKey | readonly PermissionKey[];
    /**
     * All-of vs any-of when multiple keys. Defaults to `'all'`.
     */
    mode?: PermissionMode;
    /**
     * Short human-readable rationale. Required so a reviewer can sanity-
     * check the policy at a glance — `'admin.scim'` on the SCIM route is
     * obvious; rules that combine keys or carve exceptions are not.
     */
    note: string;
}

// ─── Tenant route prefix ────────────────────────────────────────────

/**
 * Shared prefix for every tenant-scoped API path. Centralised so a
 * future rename (`/api/t/` → `/api/tenants/`) updates one place.
 */
const T = String.raw`\/api\/t\/[^/]+`;

// ─── The map ────────────────────────────────────────────────────────

export const ROUTE_PERMISSIONS: readonly RoutePermissionRule[] = [
    // ── Member management ────────────────────────────────────────────
    {
        path: new RegExp(`^${T}\\/admin\\/members(\\/.*)?$`),
        permission: 'admin.members',
        note:
            'Listing members, editing role, deactivating, removing — ' +
            'changes who can access the tenant and at what level.',
    },

    // ── Session management ───────────────────────────────────────────
    {
        path: new RegExp(`^${T}\\/admin\\/sessions(\\/.*)?$`),
        permission: 'admin.members',
        note:
            'Listing + revoking active user sessions for the tenant. ' +
            'Treated as a member-management action since it controls ' +
            'who currently has live access.',
    },

    // ── Custom roles ─────────────────────────────────────────────────
    {
        path: new RegExp(`^${T}\\/admin\\/roles(\\/.*)?$`),
        permission: 'admin.manage',
        note:
            'Creating / editing / deleting custom roles. Falls under ' +
            "admin.manage — there's no separate `admin.roles` key.",
    },

    // ── Tenant-wide settings ─────────────────────────────────────────
    {
        path: new RegExp(`^${T}\\/admin\\/settings(\\/.*)?$`),
        permission: 'admin.manage',
        note: 'Tenant settings (name, slug, defaults).',
    },

    // ── Security settings ────────────────────────────────────────────
    {
        path: new RegExp(`^${T}\\/admin\\/security-settings$`),
        permission: 'admin.manage',
        note:
            'Reading and writing the tenant security configuration — the ' +
            'sign-in session age limit and concurrent-session cap, and the ' +
            'MFA fail-closed switch.',
    },

    // ── Security session-management bulk routes ──────────────────────
    {
        path: new RegExp(`^${T}\\/security\\/sessions\\/(revoke-all|revoke-user)$`),
        permission: 'admin.members',
        note:
            'Admin-driven session revocation for the whole tenant or a ' +
            'specific colleague — same surface as /admin/sessions; ' +
            'gated under admin.members for consistency.',
    },

    // ── Tenant MFA policy (PUT only; GET is open) ────────────────────
    // Only the PUT method is mapped here. The GET handler in the same
    // file is intentionally unprotected by `requirePermission` — any
    // tenant member can read the current MFA posture from the security
    // settings page. The methods array enforces the asymmetry.
    {
        path: new RegExp(`^${T}\\/security\\/mfa\\/policy$`),
        methods: ['PUT'],
        permission: 'admin.manage',
        note:
            'Mutating the tenant MFA policy is admin-only; the GET ' +
            'sibling stays open so the settings UI can render for ' +
            'every tenant member.',
    },

    // ── Tenant invite management ─────────────────────────────────────
    {
        path: new RegExp(`^${T}\\/admin\\/invites(\\/.*)?$`),
        permission: 'admin.members',
        note:
            'Creating, listing, and revoking pending tenant invites. ' +
            'Changes who can join the tenant — gated under admin.members.',
    },

    // ── Notification settings (sub-phase 1.6) ────────────────────────
    // Outside `/api/t/:slug/admin/`, so the edge admin gate never applies:
    // these rules are the route-level gate, with `assertCanAdmin` behind
    // them in the usecase.
    {
        path: new RegExp(`^${T}\\/notification-settings$`),
        methods: ['GET', 'PUT'],
        permission: 'admin.manage',
        note:
            "The workspace's email sender, BCC mailbox and email switch, and " +
            'its in-app mute list — read and written only by the OWNER + ADMIN ' +
            "set the usecase's assertCanAdmin admits.",
    },
    {
        path: new RegExp(`^${T}\\/notification-settings\\/run-job$`),
        methods: ['POST'],
        permission: 'admin.manage',
        note: 'Drains this workspace\'s email outbox now (OWNER + ADMIN).',
    },

    // ── Master-KEK rotation (sub-phase 1.5b) ─────────────────────────
    {
        path: new RegExp(`^${T}\\/admin\\/key-rotation(\\/.*)?$`),
        permission: 'admin.tenant_lifecycle',
        note:
            'Re-wraps the workspace DEK + re-encrypts v1 ciphertexts ' +
            'after the operator stages a new DATA_ENCRYPTION_KEY. ' +
            'OWNER-only, the same key as the DEK rotation (owner decision, ' +
            '2026-11-19; inflect-compliance gated it at admin.manage).',
    },

    // ── Per-workspace DEK rotation (sub-phase 1.5b) ──────────────────
    {
        path: new RegExp(`^${T}\\/admin\\/tenant-dek-rotation(\\/.*)?$`),
        permission: 'admin.tenant_lifecycle',
        note:
            'Generates a fresh per-workspace DEK + sweeps every v2 ' +
            'ciphertext under the new key. Response to a per-workspace ' +
            'compromise — destructive on the timeline that matters ' +
            'and OWNER-only per the role model (src/lib/permissions.ts).',
    },

    // ── Work items and their configuration (sub-phases 2.1–2.2) ─────
    // Every route under work-items, teams, projects, work-item-types and
    // labels; a specific path sits above its one-segment catch-all.
    {
        path: new RegExp(`^${T}\\/work-items$`),
        methods: ['GET'],
        permission: 'work_items.view',
        note: 'The work-item list; project visibility narrows it in the repository.',
    },
    {
        path: new RegExp(`^${T}\\/work-items$`),
        methods: ['POST'],
        permission: 'work_items.create',
        note: 'Create a work item (also a sub-item, with parentId).',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/deleted$`),
        methods: ['GET'],
        permission: 'work_items.delete',
        note: 'The Deleted view is the restore surface: the key restore takes.',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/metrics$`),
        methods: ['GET'],
        permission: 'work_items.view',
        note: 'Counts over visible projects only.',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/by-key\\/[^\\/]+$`),
        methods: ['GET'],
        permission: 'work_items.view',
        note: 'Key lookup (current prefix, retired prefix, alias).',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/bulk\\/assign$`),
        methods: ['POST'],
        permission: 'work_items.assign',
        note: 'Bulk assign: the assign key, as the single assign.',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/bulk\\/(state|due)$`),
        methods: ['POST'],
        permission: 'work_items.edit',
        note: 'Bulk state and due-date changes.',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/bulk\\/delete$`),
        methods: ['POST'],
        permission: 'work_items.delete',
        note: 'Bulk soft delete: the delete key equals the usecase assert, so a refusal is audited.',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/[^\\/]+$`),
        methods: ['GET'],
        permission: 'work_items.view',
        note: 'Read one work item in a visible project.',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/[^\\/]+$`),
        methods: ['PATCH'],
        permission: 'work_items.edit',
        note: 'Edit a work item (If-Match for title and description).',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/[^\\/]+$`),
        methods: ['DELETE'],
        permission: 'work_items.delete',
        note: 'Soft-delete a work item and its sub-items.',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/[^\\/]+\\/(state|move)$`),
        methods: ['POST'],
        permission: 'work_items.edit',
        note: 'Change the state; reorder, re-parent or move to another project.',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/[^\\/]+\\/assign$`),
        methods: ['POST'],
        permission: 'work_items.assign',
        note: 'Assign a work item to a member, or clear its assignee.',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/[^\\/]+\\/restore$`),
        methods: ['POST'],
        permission: 'work_items.delete',
        note: 'Restore: the key equals the DELETE it undoes.',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/[^\\/]+\\/(activity|sub-items)$`),
        methods: ['GET'],
        permission: 'work_items.view',
        note: 'Activity and sub-items of a visible item.',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/[^\\/]+\\/comments$`),
        methods: ['GET'],
        permission: 'work_items.view',
        note: 'List the comments of a visible work item.',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/[^\\/]+\\/comments$`),
        methods: ['POST'],
        permission: 'work_items.comment',
        note: 'Add a comment to a work item (the comment key, not edit).',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/[^\\/]+\\/comments\\/[^\\/]+$`),
        methods: ['PATCH', 'DELETE'],
        permission: 'work_items.comment',
        note: 'Edit (author only) or delete (author, or an admin moderating) a comment; the usecase decides and audits the refusal.',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/[^\\/]+\\/watchers$`),
        methods: ['GET', 'POST', 'DELETE'],
        permission: 'work_items.view',
        note: 'List watchers; the caller watches or stops watching.',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/[^\\/]+\\/watchers\\/[^\\/]+$`),
        methods: ['POST', 'DELETE'],
        permission: 'work_items.edit',
        note: 'Add or remove ANOTHER member as a watcher: the split makes the refusal an audited denial.',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/[^\\/]+\\/(links|relations)$`),
        methods: ['GET'],
        permission: 'work_items.view',
        note: 'List links or relations.',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/[^\\/]+\\/(links|relations|labels)$`),
        methods: ['POST'],
        permission: 'work_items.edit',
        note: 'Add a link, relation or labels.',
    },
    {
        path: new RegExp(`^${T}\\/work-items\\/[^\\/]+\\/(links|relations|labels)\\/[^\\/]+$`),
        methods: ['DELETE'],
        permission: 'work_items.edit',
        note: 'Remove a link, relation or label.',
    },
    {
        path: new RegExp(`^${T}\\/(teams|work-item-types|labels)$`),
        methods: ['GET'],
        permission: 'projects.view',
        note: 'Read the work configuration.',
    },
    {
        path: new RegExp(`^${T}\\/(teams|work-item-types|labels)$`),
        methods: ['POST'],
        permission: 'admin.manage',
        note: 'Teams, types and labels are workspace settings under admin.manage (owner decision, 2026-11-19).',
    },
    {
        path: new RegExp(`^${T}\\/teams\\/[^\\/]+$`),
        methods: ['GET'],
        permission: 'projects.view',
        note: 'Read a team and its workflow.',
    },
    {
        path: new RegExp(`^${T}\\/(teams|work-item-types|labels)\\/[^\\/]+$`),
        methods: ['PATCH', 'DELETE'],
        permission: 'admin.manage',
        note: 'Change or delete a team, type or label.',
    },
    {
        path: new RegExp(`^${T}\\/teams\\/[^\\/]+\\/workflow-states$`),
        methods: ['GET'],
        permission: 'projects.view',
        note: 'Read the workflow states of a team.',
    },
    {
        path: new RegExp(`^${T}\\/teams\\/[^\\/]+\\/workflow-states$`),
        methods: ['POST'],
        permission: 'admin.manage',
        note: 'Add a workflow state.',
    },
    {
        path: new RegExp(`^${T}\\/teams\\/[^\\/]+\\/workflow-states\\/[^\\/]+$`),
        methods: ['PATCH', 'DELETE'],
        permission: 'admin.manage',
        note: 'Change or delete a workflow state.',
    },
    {
        path: new RegExp(`^${T}\\/projects$`),
        methods: ['GET'],
        permission: 'projects.view',
        note: 'List the projects visible to the caller.',
    },
    {
        path: new RegExp(`^${T}\\/projects$`),
        methods: ['POST'],
        permission: 'projects.create',
        note: 'Create a project, with its key prefix (never reused).',
    },
    {
        path: new RegExp(`^${T}\\/projects\\/[^\\/]+$`),
        methods: ['GET'],
        permission: 'projects.view',
        note: 'Read a visible project.',
    },
    {
        path: new RegExp(`^${T}\\/projects\\/[^\\/]+$`),
        methods: ['PATCH'],
        permission: 'projects.edit',
        note: 'Rename or re-prefix a project.',
    },
    {
        path: new RegExp(`^${T}\\/projects\\/[^\\/]+$`),
        methods: ['DELETE'],
        permission: 'projects.archive',
        note: 'Delete a project (soft): the archive key, the only destructive project key.',
    },
    {
        path: new RegExp(`^${T}\\/projects\\/[^\\/]+\\/(archive|restore)$`),
        methods: ['POST'],
        permission: 'projects.archive',
        note: 'Archive, unarchive or restore a project.',
    },
] as const;

// ─── Resolver ───────────────────────────────────────────────────────

export interface ResolvedRoutePermission {
    rule: RoutePermissionRule;
    permission: PermissionKey | readonly PermissionKey[];
    mode: PermissionMode;
}

/**
 * Look up the permission rule that applies to a request path + method.
 * Returns `null` for routes the map doesn't cover — callers decide
 * whether to fall back to legacy guards (Epic C.1 scope) or to fail
 * closed (a future Epic C.3 enforcement-by-default mode).
 */
export function resolveRoutePermission(
    pathname: string,
    method: string,
): ResolvedRoutePermission | null {
    const upperMethod = method.toUpperCase() as HttpMethod;
    for (const rule of ROUTE_PERMISSIONS) {
        if (!rule.path.test(pathname)) continue;
        if (rule.methods && !rule.methods.includes(upperMethod)) {
            continue;
        }
        return {
            rule,
            permission: rule.permission,
            mode: rule.mode ?? 'all',
        };
    }
    return null;
}

/**
 * Quick membership test for guard / coverage tests. True iff the path
 * matches at least one rule (regardless of method).
 */
export function isRouteCovered(pathname: string): boolean {
    return ROUTE_PERMISSIONS.some((r) => r.path.test(pathname));
}
