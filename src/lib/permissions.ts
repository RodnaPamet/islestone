/**
 * Islestone's permission set (sub-phase 1.4, roadmap 1.4).
 *
 * The MECHANISM is inflect-compliance's `src/lib/permissions.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e: the `PermissionSet` shape,
 * `PERMISSION_SCHEMA`, the exhaustive `getPermissionsForRole`, the
 * custom-role validator and parser, `DERIVED_FROM`, `permissionsForMembership`
 * and `permissionsExceeding`. The CONTENT is new: project-management domains
 * (docs/porting/maps/1.4.md, "Permission set: mechanism and key list") for
 * the five roles of ADR 0006, Owner > Admin > Member > Viewer > Guest.
 *
 * A key is a typed dotted literal, `domain.action` (`PermissionKey` in
 * `@/lib/security/permission-key`), and `requirePermission` takes it.
 *
 * Client-safe: the only Prisma dependency is an `import type`.
 */
import type { OrgRole, Role } from '@prisma/client';

import type { PermissionKey } from '@/lib/security/permission-key';

export type PermissionSet = {
    workspace: { view: boolean; export: boolean };
    projects: { view: boolean; create: boolean; edit: boolean; archive: boolean; manage_members: boolean };
    work_items: { view: boolean; create: boolean; edit: boolean; assign: boolean; comment: boolean; delete: boolean };
    views: { view: boolean; create: boolean; edit: boolean; share: boolean };
    cycles: { view: boolean; manage: boolean };
    /**
     * Intake (sub-phase 2.6, owner decision 92): read requests (they hold
     * outsiders' personal data), triage them (accept, decline, merge, snooze,
     * move, reopen), and manage a project's intake (on or off, forms, the
     * notify list). Accepting also needs `work_items.create`.
     */
    intake: { view: boolean; triage: boolean; manage: boolean };
    /**
     * Goals and initiatives (sub-phase 3.2, owner decision 213): read them,
     * and create, change, archive, delete, restore them and set their health
     * (a person only, decision 214). The key uses the UI word, "goals"; it
     * covers initiatives too. A project's initiative is a project field
     * (`projects.edit`) and an item's goal a work-item field
     * (`work_items.edit`); naming one also asks `goals.view`.
     */
    goals: { view: boolean; manage: boolean };
    /**
     * Time tracking (sub-phase 3.4, owner decision 265; ADR 0012): `view`
     * other people's time on items one can see (decision 266), `track` one's
     * own entries, timer and week, `approve` other members' weeks and read any
     * member's week (3.4c), `rates` see and set rates, billable defaults and
     * amounts (3.4d). Never `billing`, which is 8.1's subscription.
     */
    time: { view: boolean; track: boolean; approve: boolean; rates: boolean };
    /**
     * Workload (sub-phase 3.5, owner decision 298; ADR 0013): `view` the
     * Workload page (everyone's capacity, time-off dates and hours), `time_off`
     * record one's own time off, `manage` the workspace default, anyone's
     * capacity, anyone's time off and every time-off type (decision 287: the
     * type is seen only by the person and holders of `manage`).
     */
    workload: { view: boolean; time_off: boolean; manage: boolean };
    /**
     * Analytics (sub-phase 3.6, owner decision 329; ADR 0014 §11): `view` every
     * analytics read over the items one can see (throughput, cycle time, lead
     * time, age, cumulative flow, the burn-up; from 3.6c forecasts; from 3.6d
     * one's own dashboards and seeing shared ones), `share` shared dashboards
     * (3.6d), `people` time waiting per person beyond one's own row (3.6b).
     * No key groups throughput, cycle time or counts by assignee (decision 330).
     */
    analytics: { view: boolean; share: boolean; people: boolean };
    /**
     * Pages (sub-phase 4.1, owner decision 339; ADR 0015 §10): read pages in the
     * trees one can see (decision 342), create them, edit them (title, body,
     * moves, versions), comment on them (4.1d), delete and restore them. The
     * key uses the page's word: it replaced the unused `docs` domain ("Doc" is
     * banned for a page, ADR 0006), and stored custom roles' `docs` grants were
     * rewritten by migration `20261230120100_pages_permission_domain`.
     */
    pages: { view: boolean; create: boolean; edit: boolean; comment: boolean; delete: boolean };
    canvas: { view: boolean; edit: boolean };
    automations: { view: boolean; manage: boolean };
    integrations: { view: boolean; manage: boolean };
    /** Consumed from Phase 6 (ADR 0003): read, delegate work to, manage agents. */
    agents: { view: boolean; delegate: boolean; manage: boolean };
    billing: { view: boolean; manage: boolean };
    admin: {
        /** Open the admin console and read workspace settings. */
        view: boolean;
        /** Change workspace settings (security settings, MFA policy, custom roles). */
        manage: boolean;
        /** Invite, change, deactivate and remove members; revoke their sessions. */
        members: boolean;
        /** Enterprise SSO configuration (sub-phase 8.3). */
        sso: boolean;
        /** SCIM provisioning (sub-phase 8.3). */
        scim: boolean;
        /** Delete the workspace, rotate its keys, transfer ownership. OWNER only. */
        tenant_lifecycle: boolean;
        /** Invite, change or remove OWNERs, and assign the OWNER role. OWNER only. */
        owner_management: boolean;
    };
};

/**
 * The denominator: every domain and its actions. Client-safe. Validation,
 * parsing and the escalation guard all iterate it, so a key added to
 * `PermissionSet` must be added here (the `satisfies` below fails otherwise).
 */
export const PERMISSION_SCHEMA = {
    workspace: ['view', 'export'],
    projects: ['view', 'create', 'edit', 'archive', 'manage_members'],
    work_items: ['view', 'create', 'edit', 'assign', 'comment', 'delete'],
    views: ['view', 'create', 'edit', 'share'],
    cycles: ['view', 'manage'],
    intake: ['view', 'triage', 'manage'],
    goals: ['view', 'manage'],
    time: ['view', 'track', 'approve', 'rates'],
    workload: ['view', 'time_off', 'manage'],
    analytics: ['view', 'share', 'people'],
    pages: ['view', 'create', 'edit', 'comment', 'delete'],
    canvas: ['view', 'edit'],
    automations: ['view', 'manage'],
    integrations: ['view', 'manage'],
    agents: ['view', 'delegate', 'manage'],
    billing: ['view', 'manage'],
    admin: ['view', 'manage', 'members', 'sso', 'scim', 'tenant_lifecycle', 'owner_management'],
} as const satisfies { [D in keyof PermissionSet]: readonly (keyof PermissionSet[D])[] } as unknown as Record<
    keyof PermissionSet,
    string[]
>;

type Grants = { [D in keyof PermissionSet]?: readonly (keyof PermissionSet[D])[] | 'all' };

/** Builds a complete set: every listed action true, every other false. */
function permissionSetOf(grants: Grants): PermissionSet {
    const out = {} as Record<string, Record<string, boolean>>;
    for (const domain of Object.keys(PERMISSION_SCHEMA) as (keyof PermissionSet)[]) {
        const granted = grants[domain];
        out[domain] = Object.fromEntries(
            PERMISSION_SCHEMA[domain].map((action) => [
                action,
                granted === 'all' || (granted as readonly string[] | undefined)?.includes(action) === true,
            ]),
        );
    }
    return out as unknown as PermissionSet;
}

const ALL_DOMAINS: Grants = Object.fromEntries(
    (Object.keys(PERMISSION_SCHEMA) as (keyof PermissionSet)[]).map((d) => [d, 'all']),
) as Grants;

/**
 * Returns the static, granular PermissionSet for a built-in role.
 *
 * Role matrix (docs/porting/maps/1.4.md, "Permission set"):
 *
 *   OWNER   everything.
 *   ADMIN   everything except `admin.tenant_lifecycle` and
 *           `admin.owner_management`, which are stated false explicitly.
 *   MEMBER  does the work: projects view/create/edit, work items
 *           view/create/edit/assign/comment, views view/create/edit/share,
 *           cycles, intake view/triage (decision 92), goals view/manage
 *           (decision 213), time view/track (decision 265), workload view/time_off
 *           (decision 298), analytics view/share (decision 329), pages (all, decision 339),
 *           canvas view/edit, automations and
 *           integrations view, agents view/delegate, workspace view.
 *   VIEWER  reads every project (`view` on the work domains, goals, time, pages and agents),
 *           records its own time off (`workload.view` and `workload.time_off`,
 *           decision 298: time off is about oneself), reads analytics
 *           (`analytics.view`, decision 329) and
 *           saves personal views: `views.create` and `views.edit`, never
 *           `views.share`, so a shared view stays with the roles that hold it
 *           (owner decision 60, 2026-11-20).
 *   GUEST   nothing (owner decision 204, 2026-11-21): until sub-phase 8.4
 *           scopes guests to named projects, a guest holds no key, so every
 *           `requirePermission` route refuses it with an audited 403 and
 *           every usecase that asks a key refuses it too. What it keeps is
 *           self-service, which asks no key: its own notifications and
 *           notification preferences, its own MFA and its own sessions. 8.4
 *           grants exactly what its project grants need. Not assignable
 *           (`ASSIGNABLE_TENANT_ROLES`), and a GUEST membership resolves to
 *           this set whatever custom role it carries
 *           (`permissionsForMembership`).
 *
 * Backend authorisation must still verify the key at the route
 * (`requirePermission`) or in the usecase.
 */
export function getPermissionsForRole(role: Role): PermissionSet {
    switch (role) {
        case 'OWNER':
            return permissionSetOf(ALL_DOMAINS);
        case 'ADMIN': {
            // ADMIN holds every admin flag but the two OWNER-only ones, stated
            // explicitly so a reader of this branch sees them refused. The
            // custom-role path, which CAN express them, is re-checked at write
            // time by `permissionsExceeding`.
            const set = permissionSetOf(ALL_DOMAINS);
            set.admin.tenant_lifecycle = false;
            set.admin.owner_management = false;
            return set;
        }
        case 'MEMBER':
            return permissionSetOf({
                workspace: ['view'],
                projects: ['view', 'create', 'edit'],
                work_items: ['view', 'create', 'edit', 'assign', 'comment'],
                views: ['view', 'create', 'edit', 'share'],
                cycles: ['view', 'manage'],
                intake: ['view', 'triage'],
                goals: ['view', 'manage'],
                time: ['view', 'track'],
                workload: ['view', 'time_off'],
                analytics: ['view', 'share'],
                pages: 'all',
                canvas: ['view', 'edit'],
                automations: ['view'],
                integrations: ['view'],
                agents: ['view', 'delegate'],
            });
        case 'VIEWER':
            return viewerPermissions();
        case 'GUEST':
            // Decision 204: no key at all until 8.4. The guest tripwire in the
            // permission matrix (`tests/guards/permission-matrix-population.test.ts`)
            // fails every guest cell once this grants anything.
            return permissionSetOf({});
        default: {
            // Prisma's enum is closed; an unknown value gets the least
            // privileged set with workspace-wide standing (ADR 0006: the
            // fallback is Viewer, never Guest).
            const _exhaustive: never = role;
            void _exhaustive;
            return viewerPermissions();
        }
    }
}

/**
 * VIEWER: reads every project and agent, and saves, changes and deletes its own
 * PERSONAL views (`views.create`, `views.edit`; owner decision 60). It holds no
 * `views.share`, so it never saves, shares or changes a shared view
 * (`saved-view.policies.ts`), and it writes nothing else.
 *
 * This is also the set an unresolvable role falls back to (ADR 0006: Viewer,
 * never Guest). Saving a personal view there is harmless: the view is visible
 * to its creator alone, and reaches no work item, project or other member.
 */
function viewerPermissions(): PermissionSet {
    return permissionSetOf({
        workspace: ['view'],
        projects: ['view'],
        work_items: ['view'],
        views: ['view', 'create', 'edit'],
        cycles: ['view'],
        goals: ['view'],
        time: ['view'],
        workload: ['view', 'time_off'],
        analytics: ['view'],
        pages: ['view'],
        canvas: ['view'],
        agents: ['view'],
    });
}

// ─── Organization permissions ──────────────────────────────────────────────

/** The organization-level flags, derived from `OrgRole`. */
export type OrgPermissionSet = {
    /** See the organization's workspaces. */
    canViewWorkspaces: boolean;
    /** Create and manage the workspaces under the organization. ORG_OWNER only. */
    canManageTenants: boolean;
    /** Add, change and remove organization members. ORG_OWNER and ORG_ADMIN. */
    canManageMembers: boolean;
    /**
     * Promote to, demote from or remove ORG_OWNER. ORG_OWNER only; the last
     * owner is also held by the `org_membership_last_owner_guard` trigger.
     */
    canManageOwners: boolean;
};

/**
 * Maps an OrgRole to its concrete permission booleans.
 *
 * The role-to-permission mapping is intentionally hard-coded (no
 * custom-role overrides at the org layer) — org membership roles are
 * simple by design.
 */
export function getOrgPermissions(role: OrgRole): OrgPermissionSet {
    switch (role) {
        // An owner holds everything an admin holds, plus the owner-only
        // powers: managing owners and the workspaces under the organization.
        case 'ORG_OWNER':
            return {
                canViewWorkspaces: true,
                canManageTenants: true,
                canManageMembers: true,
                canManageOwners: true,
            };
        case 'ORG_ADMIN':
            return {
                canViewWorkspaces: true,
                canManageTenants: false,
                canManageMembers: true,
                canManageOwners: false,
            };
        case 'ORG_READER':
            return {
                canViewWorkspaces: true,
                canManageTenants: false,
                canManageMembers: false,
                canManageOwners: false,
            };
        default: {
            // Defensive — Prisma's enum is closed, so the runtime
            // should never reach here. Returning the zero-permission
            // bag matches the fail-closed posture of every other
            // permission helper.
            const _exhaustive: never = role;
            void _exhaustive;
            return {
                canViewWorkspaces: false,
                canManageTenants: false,
                canManageMembers: false,
                canManageOwners: false,
            };
        }
    }
}

// ─── Custom Role Helpers ───────────────────────────────────────────────────

/**
 * Validates that a JSON value conforms to the PermissionSet shape.
 * Returns a list of error strings; empty list = valid.
 *
 * Used at write-time (creating/updating custom roles) to prevent
 * saving malformed grant blobs.
 */
export function validatePermissionsJson(json: unknown): string[] {
    const errors: string[] = [];

    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
        return ['grantsJson must be a non-null object'];
    }

    const obj = json as Record<string, unknown>;
    const expectedDomains = Object.keys(PERMISSION_SCHEMA) as (keyof PermissionSet)[];
    const actualDomains = Object.keys(obj);

    // Check for missing domains
    for (const domain of expectedDomains) {
        if (!(domain in obj)) {
            errors.push(`Missing permission domain: "${domain}"`);
            continue;
        }

        const domainValue = obj[domain];
        if (typeof domainValue !== 'object' || domainValue === null) {
            errors.push(`Permission domain "${domain}" must be an object`);
            continue;
        }

        const domainObj = domainValue as Record<string, unknown>;
        const expectedActions = PERMISSION_SCHEMA[domain];

        for (const action of expectedActions) {
            if (!(action in domainObj)) {
                errors.push(`Missing action "${domain}.${action}"`);
            } else if (typeof domainObj[action] !== 'boolean') {
                errors.push(`"${domain}.${action}" must be boolean, got ${typeof domainObj[action]}`);
            }
        }

        // Check for unexpected actions
        for (const action of Object.keys(domainObj)) {
            if (!expectedActions.includes(action)) {
                errors.push(`Unexpected action "${domain}.${action}"`);
            }
        }
    }

    // Check for unexpected domains
    for (const domain of actualDomains) {
        if (!expectedDomains.includes(domain as keyof PermissionSet)) {
            errors.push(`Unexpected permission domain: "${domain}"`);
        }
    }

    return errors;
}

/**
 * Keys a stored custom-role blob that predates them takes from ANOTHER key of
 * the same blob rather than from its base role.
 *
 * A key that splits a read off an existing key would otherwise widen any custom
 * role that had switched the existing key off: the base role's default is
 * `true` wherever the base holds the existing key. So when a later sub-phase
 * splits a key, it names the new key here with the key it was split from, and
 * a blob saved before the split reads the new key exactly as it read the old.
 * Empty: no key has been split yet.
 */
const DERIVED_FROM: Readonly<Record<string, Readonly<Record<string, string>>>> = {};

/**
 * Safely parses a custom role's `grantsJson` blob from the database into a typed PermissionSet.
 * Falls back to the baseRole's defaults for any missing or invalid fields.
 *
 * Used at read-time to ensure the runtime always has a complete, valid PermissionSet
 * even if the stored JSON is partially malformed (defensive programming). A key
 * named in `DERIVED_FROM` falls back to its source key in the blob first.
 */
export function parsePermissionsJson(json: unknown, baseRole: Role): PermissionSet {
    const defaults = getPermissionsForRole(baseRole);

    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
        return defaults;
    }

    const obj = json as Record<string, Record<string, unknown>>;
    const result = { ...defaults };

    for (const domain of Object.keys(PERMISSION_SCHEMA) as (keyof PermissionSet)[]) {
        if (domain in obj && typeof obj[domain] === 'object' && obj[domain] !== null) {
            const actions = PERMISSION_SCHEMA[domain];
            const domainResult: Record<string, boolean> = { ...defaults[domain] };

            for (const action of actions) {
                if (action in obj[domain] && typeof obj[domain][action] === 'boolean') {
                    domainResult[action] = obj[domain][action] as boolean;
                    continue;
                }
                const source = DERIVED_FROM[domain]?.[action];
                if (source !== undefined && typeof obj[domain][source] === 'boolean') {
                    domainResult[action] = obj[domain][source] as boolean;
                }
            }

            (result as Record<keyof PermissionSet, Record<string, boolean>>)[domain] = domainResult;
        }
    }

    return result;
}

/**
 * The permission set a MEMBERSHIP resolves to — the custom role's, parsed over
 * its base role, when it has one; the built-in role's otherwise.
 *
 * A GUEST membership resolves to GUEST's set (nothing, decision 204) whatever
 * custom role it carries: a custom role REPLACES the built-in set, so without
 * this a guest carrying one built on MEMBER would read the workspace. No
 * writer makes a GUEST membership before 8.4, and none moves a member who
 * carries a custom role into GUEST; this is the gate behind them, as
 * `resolveProjectVisibility` keeps a GUEST membership blind through its
 * `membershipRole`.
 *
 * The one expression `resolveTenantContext` (`getTenantCtx`, the pages'
 * context) and `resolveMemberContext` (jobs) build `appPermissions` from, and
 * what a usecase that must predict what ANOTHER member will be allowed to do
 * reads.
 */
export function permissionsForMembership(membership: {
    role: Role;
    customRole: { grantsJson: unknown; baseRole: Role } | null;
}): PermissionSet {
    if (membership.role === 'GUEST') return getPermissionsForRole('GUEST');
    return membership.customRole
        ? parsePermissionsJson(membership.customRole.grantsJson, membership.customRole.baseRole)
        : getPermissionsForRole(membership.role);
}

/**
 * The coarse role a MEMBERSHIP resolves to: the custom role's base when it
 * carries one, its built-in role otherwise; a GUEST membership stays GUEST
 * (see {@link permissionsForMembership}).
 */
export function effectiveRoleOfMembership(membership: { role: Role; customRole: { baseRole: Role } | null }): Role {
    if (membership.role === 'GUEST') return 'GUEST';
    return membership.customRole?.baseRole ?? membership.role;
}

// ─── Privilege-escalation guard ──────────────────────────────────────

/**
 * Which permissions in `granted` exceed `held` — i.e. are `true` in the
 * set being handed out while `false` for the person handing it out.
 *
 * ─── Why this exists ────────────────────────────────────────────────
 *
 * Custom roles resolve through `parsePermissionsJson`, which merges the
 * role's JSON over its base-role defaults. `PERMISSION_SCHEMA.admin`
 * includes `tenant_lifecycle` and `owner_management` — the two flags that
 * separate OWNER from ADMIN and gate deleting the tenant, rotating the
 * tenant DEK, and managing OWNERs.
 *
 * Every custom-role entrypoint is gated on `assertCanAdmin`, so an ADMIN
 * could otherwise mint a role setting those two true, assign it to
 * themselves, and hold OWNER-only powers on the next request. The enum
 * path makes that impossible
 * (`getPermissionsForRole('ADMIN').admin.tenant_lifecycle` is `false`); the
 * custom-role path would bypass it entirely.
 *
 * The invariant is the ordinary one for delegated authority: you cannot
 * grant what you do not hold. Revoking is always allowed — handing out
 * LESS than you hold is not escalation.
 */
export function permissionsExceeding(
    granted: PermissionSet,
    held: PermissionSet,
): PermissionKey[] {
    const exceeded: PermissionKey[] = [];
    for (const domain of Object.keys(PERMISSION_SCHEMA) as (keyof PermissionSet)[]) {
        for (const action of PERMISSION_SCHEMA[domain]) {
            const wants = (granted[domain] as Record<string, boolean> | undefined)?.[action];
            const has = (held[domain] as Record<string, boolean> | undefined)?.[action];
            if (wants === true && has !== true) exceeded.push(`${domain}.${action}` as PermissionKey);
        }
    }
    return exceeded;
}
