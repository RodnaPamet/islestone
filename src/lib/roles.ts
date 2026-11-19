/**
 * The built-in tenant roles, and which of them each writer may write.
 *
 * Copied from inflect-compliance `src/lib/roles.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e with Islestone's roles (ADR 0006:
 * Owner > Admin > Member > Viewer > Guest). Three rules live here:
 *
 *   1. Which roles a membership-role WRITER may write
 *      (`ASSIGNABLE_TENANT_ROLES`). GUEST is in the enum but no writer may
 *      write it until sub-phase 8.4 scopes guests to named projects; it is
 *      added here then, readers first, as the parent added AI_ADMIN.
 *   2. Which roles never sit under a custom role (`BUILT_IN_SCOPE_ROLES`):
 *      OWNER. Its census is `tests/unit/owner-custom-role.test.ts`.
 *   3. Which custom roles only an ADMIN membership may carry: one granting
 *      `admin.sso` or `admin.scim` (`ADMIN_MEMBERSHIP_ONLY_ADMIN_KEYS`), and
 *      one built on ADMIN (`customRoleCarriageRefusal`). Its census is
 *      `tests/unit/custom-role-carriage-writers.test.ts`.
 *
 * Client-safe: the only Prisma dependency is an `import type`.
 */
import type { Role } from '@prisma/client';

import type { PermissionSet } from '@/lib/permissions';
import { parsePermissionsJson } from '@/lib/permissions';

/**
 * Every built-in tenant role, in the `Role` enum's declaration order, which is
 * also its Postgres ordinal order and its seniority (ADR 0006; see
 * `prisma/schema/enums.prisma`). For a reader of a role: a label table, a
 * filter, a matrix. Never for a writer.
 */
export const TENANT_ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST'] as const satisfies readonly Role[];

/**
 * Compile-time proof that `TENANT_ROLES` names every `Role`. A seventh value
 * added to the enum and not here is a type error on this line, not a label that
 * silently renders the raw enum string.
 */
type MissingFromTenantRoles = Exclude<Role, (typeof TENANT_ROLES)[number]>;
const TENANT_ROLES_ARE_EXHAUSTIVE: [MissingFromTenantRoles] extends [never] ? true : never = true;
void TENANT_ROLES_ARE_EXHAUSTIVE;

/**
 * The roles a membership-role WRITER may write — every role except `GUEST`.
 * Invites (creation and redemption), the direct member add and the invites
 * route's schema read it. Writing OWNER also needs `admin.owner_management`.
 *
 * GUEST waits for sub-phase 8.4, which scopes a guest to named projects. It
 * must NOT be derived from `Role`: a new enum value is then unassignable by
 * default, which is the order a rolling deploy needs.
 */
export const ASSIGNABLE_TENANT_ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const satisfies readonly Role[];

export type AssignableTenantRole = (typeof ASSIGNABLE_TENANT_ROLES)[number];

export function isAssignableTenantRole(role: string): role is AssignableTenantRole {
    return (ASSIGNABLE_TENANT_ROLES as readonly string[]).includes(role);
}

/**
 * The roles the members-page role change may set on an EXISTING member
 * (`PATCH /api/t/:slug/admin/members/:membershipId`, `updateTenantMemberRole`).
 * Today it equals the writers' list. Its own constant because a role a member
 * may be promoted into but never invited into (the parent's AI_ADMIN, Phase 6)
 * joins this list and not the other.
 */
export const MEMBER_ROLE_CHANGE_ROLES = [...ASSIGNABLE_TENANT_ROLES] as const satisfies readonly Role[];

export type MemberRoleChangeRole = (typeof MEMBER_ROLE_CHANGE_ROLES)[number];

export function isMemberRoleChangeRole(role: string): role is MemberRoleChangeRole {
    return (MEMBER_ROLE_CHANGE_ROLES as readonly string[]).includes(role);
}

/**
 * The roles only a holder of `admin.owner_management` — an OWNER — may move a
 * member INTO or OUT OF, wherever the product writes them: the members-page
 * role change today. On the members page the same holder alone DEACTIVATES or
 * REMOVES a membership holding one of these (`deactivateTenantMember`,
 * `removeTenantMember`), revokes its sessions and resets its MFA.
 */
export const OWNER_MANAGED_ROLES = ['OWNER'] as const satisfies readonly Role[];

export function isOwnerManagedRole(role: string): boolean {
    return (OWNER_MANAGED_ROLES as readonly string[]).includes(role);
}

/** The refusal for moving a member into or out of an owner-managed role without the key. */
export function ownerManagedRoleMessage(role: string): string {
    return `Only an OWNER can assign or remove the ${role} role.`;
}

/**
 * The named reason a deactivation or removal of an OWNER-managed membership is
 * refused with when the caller lacks `admin.owner_management`
 * (`ForbiddenError.details`). An ADMIN, who can neither assign nor remove the
 * role, does not get to switch the membership off or delete it instead.
 */
export const OWNER_MANAGED_MEMBERSHIP_END_REFUSAL = 'ENDING_OWNER_MANAGED_MEMBERSHIP_IS_OWNER_TIER' as const;

/** The refusal for deactivating or removing an owner-managed membership without the key. */
export function ownerManagedMembershipEndMessage(role: string, verb: 'deactivate' | 'remove'): string {
    // OWNER keeps the sentence it has always had.
    if (role === 'OWNER') return `Only OWNERs can ${verb} an OWNER membership.`;
    return `Only an OWNER can ${verb} an ${role} membership.`;
}

/**
 * The named reason revoking another person's sessions is refused with when
 * that person holds an OWNER-managed role and the caller lacks
 * `admin.owner_management` (`ForbiddenError.details`). Signing one person out is a targeted act, so it follows the
 * deactivation rule above. "Revoke All" is the incident lever and still signs
 * everyone out, Owners included.
 */
export const OWNER_MANAGED_SESSION_REVOKE_REFUSAL = 'REVOKING_OWNER_MANAGED_SESSIONS_IS_OWNER_TIER' as const;

/**
 * The named reason resetting another person's MFA is refused with when that
 * person holds an OWNER-managed role and the caller lacks
 * `admin.owner_management`. Taking away an
 * Owner's second factor is a targeted act on an Owner, so it follows the
 * deactivation rule.
 */
export const OWNER_MANAGED_MFA_RESET_REFUSAL = 'RESETTING_OWNER_MANAGED_MFA_IS_OWNER_TIER' as const;

/** The refusal for resetting an owner-managed member's MFA without the key. */
export function ownerManagedMfaResetMessage(role: string): string {
    return `Only an OWNER can reset an ${role}'s MFA.`;
}

/** The refusal for revoking an owner-managed member's sessions without the key. */
export function ownerManagedSessionRevokeMessage(role: string): string {
    return `Only an OWNER can revoke an ${role}'s sessions.`;
}

/**
 * Roles whose scope is always the reviewed built-in set: a membership holding
 * one never carries a custom role. A custom role REPLACES the built-in role's
 * permissions and coarse tier at resolution (`resolveTenantContext` reads
 * `customRole.baseRole ?? role`), so a membership holding one of these and a
 * custom role would not hold the role at all.
 *
 *   - `OWNER`. On an OWNER the custom role would be a side door: an ADMIN
 *     could assign a VIEWER-based one and so demote every OWNER in effect,
 *     with the enum role still reading `OWNER`, so neither the last-OWNER
 *     checks nor `tenant_membership_last_owner_guard` would fire — the
 *     demotion `admin.owner_management` exists to reserve.
 *
 * Both orders are refused rather than repaired, for every caller, OWNER
 * included: a custom role is not assigned to such a membership, and a member
 * carrying one is not moved into the role — the custom role is removed first,
 * by a person, as its own audited change. Every writer reads this list: the
 * members-page role change and custom-role assignment, invite creation and
 * redemption.
 *
 * The database holds the same rule as a CHECK,
 * `TenantMembership_built_in_scope_role_no_custom_role` (migration
 * `20261119130000_auth_and_roles`). A role added here needs that CHECK
 * widened in a migration in the same change.
 */
export const BUILT_IN_SCOPE_ROLES = ['OWNER'] as const satisfies readonly Role[];

export function mayCarryCustomRole(role: string): boolean {
    return !(BUILT_IN_SCOPE_ROLES as readonly string[]).includes(role);
}

/** The named reason a role/custom-role combination is refused with (`ConflictError.details`). */
export const BUILT_IN_SCOPE_REFUSAL = 'BUILT_IN_SCOPE_ROLE_CARRIES_NO_CUSTOM_ROLE' as const;

/**
 * The refusal, worded for the change that was asked for: assigning a custom
 * role to a membership that holds `role`, promoting a member who carries a
 * custom role into it, or inviting into it a person whose existing (inactive)
 * membership carries one.
 */
export function builtInScopeRoleMessage(
    role: string,
    asked: 'assign-custom-role' | 'promote' | 'invite',
): string {
    const why = `A membership with the ${role} role cannot carry a custom role: its scope is always the built-in one.`;
    if (asked === 'promote') return `${why} Remove this member's custom role first, then change the role.`;
    if (asked === 'invite') {
        return (
            `${why} This person's existing membership carries a custom role. Invite them with another ` +
            'role, remove the custom role once they have joined, then change their role.'
        );
    }
    return `${why} Change the member to another role first if they need a custom role.`;
}

/**
 * Whether CLEARING a custom role from a membership holding `role` is OWNER-tier
 * work — allowed only to a holder of `admin.owner_management`.
 *
 * True for `OWNER` alone. No writer can put a custom role on an OWNER and the
 * CHECK refuses it, so the branch is a backstop; a clear restores full OWNER
 * authority, which an ADMIN may not hand out.
 */
export function clearingCustomRoleIsOwnerTier(role: string): boolean {
    return role === 'OWNER';
}

/** The named reason an ADMIN's clear of an OWNER's custom role is refused with (`ForbiddenError.details`). */
export const OWNER_TIER_CLEAR_REFUSAL = 'CLEARING_OWNER_CUSTOM_ROLE_IS_OWNER_TIER' as const;

/** The refusal for clearing an OWNER membership's custom role without `admin.owner_management`. */
export function ownerTierClearMessage(): string {
    return 'Only an OWNER can remove a custom role from an OWNER membership: it restores full OWNER authority.';
}

/**
 * The refusal every writer of `ASSIGNABLE_TENANT_ROLES` gives for a role it may
 * not write. One sentence, so the API says the same thing whichever writer was
 * asked — and says where the role IS assigned.
 */
export function unassignableRoleMessage(role: string): string {
    if (!(TENANT_ROLES as readonly string[]).includes(role)) return `Invalid role: ${role}`;
    return `The ${role} role cannot be assigned yet: guests arrive with project scoping.`;
}

// ─── Which custom roles only an ADMIN membership may carry ─────────────────

/**
 * The `admin.*` keys a custom role may grant only on an ADMIN membership.
 *
 * The rule is the edge's. `checkAdminAccess` admits `/api/t/:slug/admin/**`
 * by the membership's BUILT-IN role — OWNER and ADMIN — and a custom role
 * never enters that check. `admin.sso` and `admin.scim` are consumed only
 * behind that surface (sub-phase 8.3's SSO and SCIM routes), so on a MEMBER,
 * VIEWER or GUEST membership a custom role granting one would grant nothing
 * but a control the edge refuses. (The parent's other nine keys here were
 * agent and data-subject keys; they arrive, if at all, with Phase 6 and 8.3,
 * and each is classified then.)
 */
export const ADMIN_MEMBERSHIP_ONLY_ADMIN_KEYS = ['sso', 'scim'] as const satisfies readonly (keyof PermissionSet['admin'])[];

export type AdminMembershipOnlyAdminKey = (typeof ADMIN_MEMBERSHIP_ONLY_ADMIN_KEYS)[number];

/**
 * The base roles a custom role may be built on: every role but OWNER (the
 * CHECK `TenantCustomRole_base_role_not_built_in_scope`) and GUEST (not
 * assignable until 8.4). The custom-role usecase and both `admin/roles`
 * routes read it, so the list is spelled once.
 */
export const CUSTOM_ROLE_BASE_ROLES = ['ADMIN', 'MEMBER', 'VIEWER'] as const satisfies readonly Role[];

export type CustomRoleBaseRole = (typeof CUSTOM_ROLE_BASE_ROLES)[number];

/**
 * The base roles whose coarse tier is the admin tier. A custom role's base IS
 * the role its carrier resolves to everywhere but the edge (`effectiveRole` in
 * `resolveTenantContext`), so a custom role built on one of these makes every
 * `assertCanAdmin` pass for a membership the edge treats as non-admin. No
 * writer builds a custom role on OWNER (`CUSTOM_ROLE_BASE_ROLES`, and the CHECK
 * `TenantCustomRole_base_role_not_built_in_scope`); it is here so a legacy one
 * is judged by its tier, not by its name.
 */
export const ADMIN_TIER_BASE_ROLES = ['ADMIN', 'OWNER'] as const satisfies readonly Role[];

/** The named reason a custom role granting an `ADMIN_MEMBERSHIP_ONLY_ADMIN_KEYS` key is refused with. */
export const CUSTOM_ROLE_ADMIN_KEYS_REFUSAL = 'CUSTOM_ROLE_ADMIN_KEYS_NEED_ADMIN_MEMBERSHIP' as const;

/** The named reason a custom role built on ADMIN is refused with. */
export const CUSTOM_ROLE_ADMIN_BASE_REFUSAL = 'CUSTOM_ROLE_ADMIN_BASE_NEEDS_ADMIN_MEMBERSHIP' as const;

/** The custom role as the rule reads it: its base and its stored blob. */
export interface CustomRoleForCarriage {
    baseRole: Role | string;
    grantsJson: unknown;
}

/** A membership's built-in role and the custom role it carries (`null` for none). */
export interface CustomRoleCarriage {
    membershipRole: Role | string;
    customRole: CustomRoleForCarriage | null;
}

/** What a carriage breaks of the rule — empty when it breaks nothing. */
export interface CustomRoleCarriageOffence {
    /** The custom role's base, when it is an admin-tier base on a non-ADMIN membership. */
    adminBase: string | null;
    /** The `ADMIN_MEMBERSHIP_ONLY_ADMIN_KEYS` it grants on a non-ADMIN membership, in list order. */
    adminKeys: AdminMembershipOnlyAdminKey[];
}

/** The keys of `ADMIN_MEMBERSHIP_ONLY_ADMIN_KEYS` that `permissions` grants. */
export function adminMembershipOnlyKeysGranted(
    permissions: Pick<PermissionSet, 'admin'>,
): AdminMembershipOnlyAdminKey[] {
    return ADMIN_MEMBERSHIP_ONLY_ADMIN_KEYS.filter((key) => permissions.admin?.[key] === true);
}

/**
 * What `carriage` breaks of the rule. Only an ADMIN membership may carry a
 * custom role built on an admin-tier base or granting an
 * `ADMIN_MEMBERSHIP_ONLY_ADMIN_KEYS` key; on any other membership both are
 * offences. The keys are the custom role's EFFECTIVE grant — its blob parsed
 * over its base (`parsePermissionsJson`), exactly as a request resolves it —
 * so a legacy blob missing a key is judged by its base's default for it.
 *
 * OWNER memberships carry no custom role at all
 * (`mayCarryCustomRole`); that rule is asked first and separately, and this one
 * judges them like any other non-ADMIN membership.
 */
export function customRoleCarriageOffence(carriage: CustomRoleCarriage): CustomRoleCarriageOffence {
    const none: CustomRoleCarriageOffence = { adminBase: null, adminKeys: [] };
    const { membershipRole, customRole } = carriage;
    if (!customRole || membershipRole === 'ADMIN') return none;
    const base = String(customRole.baseRole);
    return {
        adminBase: (ADMIN_TIER_BASE_ROLES as readonly string[]).includes(base) ? base : null,
        adminKeys: adminMembershipOnlyKeysGranted(
            parsePermissionsJson(customRole.grantsJson, customRole.baseRole as Role),
        ),
    };
}

/** A refusal of the rule: its reason and what it names. */
export type CustomRoleCarriageRefusal =
    | { reason: typeof CUSTOM_ROLE_ADMIN_BASE_REFUSAL; baseRole: string }
    | { reason: typeof CUSTOM_ROLE_ADMIN_KEYS_REFUSAL; keys: AdminMembershipOnlyAdminKey[] };

/**
 * THE PREDICATE every writer asks: does moving a membership from `before` to
 * `after` ADD an offence (`customRoleCarriageOffence`)? `null` when it may.
 *
 * Only what is NEW is refused, so existing rows are never trapped. A change
 * that keeps or shrinks a membership's offence — clearing or replacing its
 * custom role, removing keys from the role, lowering its base, renaming it, or
 * moving the member between MEMBER and VIEWER (the rule treats them alike) —
 * always passes, and no writer refuses a row for what it already carried.
 * `before` is `null` for a membership that does not exist yet.
 *
 * The base refusal is returned first when both apply: a custom role built on
 * ADMIN grants both keys by default, so fixing the base is the change that
 * decides what the keys are.
 */
export function customRoleCarriageRefusal(
    after: CustomRoleCarriage,
    before: CustomRoleCarriage | null,
): CustomRoleCarriageRefusal | null {
    const now = customRoleCarriageOffence(after);
    const was = before ? customRoleCarriageOffence(before) : { adminBase: null, adminKeys: [] };
    if (now.adminBase !== null && was.adminBase === null) {
        return { reason: CUSTOM_ROLE_ADMIN_BASE_REFUSAL, baseRole: now.adminBase };
    }
    const added = now.adminKeys.filter((key) => !was.adminKeys.includes(key));
    if (added.length > 0) return { reason: CUSTOM_ROLE_ADMIN_KEYS_REFUSAL, keys: added };
    return null;
}

/** The `ConflictError.details` of a refusal: the reason, and what it names. */
export function customRoleCarriageDetails(
    refusal: CustomRoleCarriageRefusal,
    extra: { blockingMemberships?: number } = {},
): Record<string, unknown> {
    return refusal.reason === CUSTOM_ROLE_ADMIN_BASE_REFUSAL
        ? { reason: refusal.reason, baseRole: refusal.baseRole, ...extra }
        : { reason: refusal.reason, keys: refusal.keys.map((k) => `admin.${k}`), ...extra };
}

/**
 * The refusal, worded for the change that was asked for: assigning the custom
 * role, changing the member's role while they carry it, inviting them back
 * into a membership that carries it, or saving the custom role while members
 * carry it (`blockingMemberships` of them).
 */
export function customRoleCarriageMessage(
    refusal: CustomRoleCarriageRefusal,
    asked: 'assign-custom-role' | 'change-role' | 'invite' | 'save-custom-role',
    blockingMemberships = 0,
): string {
    const what =
        refusal.reason === CUSTOM_ROLE_ADMIN_BASE_REFUSAL
            ? `A custom role built on ${refusal.baseRole}`
            : `A custom role granting ${refusal.keys.map((k) => `admin.${k}`).join(', ')}`;
    const why = `${what} can only be carried by an ADMIN membership.`;
    switch (asked) {
        case 'change-role':
            return `${why} Remove or change this member's custom role first, then change the role.`;
        case 'invite':
            return (
                `${why} This person's existing membership carries such a custom role. Invite them as ADMIN, ` +
                'or remove the custom role once they have joined.'
            );
        case 'save-custom-role':
            return (
                `${why} ${blockingMemberships} member(s) carrying this role hold another role. ` +
                'Change their role to ADMIN or give them another custom role first.'
            );
        default:
            return `${why} Change the member to ADMIN first, or choose another custom role.`;
    }
}

/** A carriage refusal as an API error body carries it (`error.details`), for a page to re-say in its language. */
export interface CustomRoleCarriageRefusalBody {
    reason: typeof CUSTOM_ROLE_ADMIN_BASE_REFUSAL | typeof CUSTOM_ROLE_ADMIN_KEYS_REFUSAL;
    /** The offending permission keys (`admin.<key>`); empty for a base refusal. */
    keys: string[];
    /** The offending base; `null` for a keys refusal. */
    baseRole: string | null;
    /** A save's count of carriers holding it back; `0` for any other refusal. */
    blockingMemberships: number;
}

/** The carriage refusal in an API error body, or `null` when the body carries another error. */
export function customRoleCarriageRefusalOf(body: unknown): CustomRoleCarriageRefusalBody | null {
    const details = (body as { error?: { details?: Record<string, unknown> } } | null)?.error?.details;
    const reason = details?.reason;
    if (reason !== CUSTOM_ROLE_ADMIN_BASE_REFUSAL && reason !== CUSTOM_ROLE_ADMIN_KEYS_REFUSAL) return null;
    return {
        reason,
        keys: Array.isArray(details?.keys) ? details.keys.filter((k): k is string => typeof k === 'string') : [],
        baseRole: typeof details?.baseRole === 'string' ? details.baseRole : null,
        blockingMemberships: typeof details?.blockingMemberships === 'number' ? details.blockingMemberships : 0,
    };
}
