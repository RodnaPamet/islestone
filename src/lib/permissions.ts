/**
 * Permission sets — SUB-PHASE 1.3 STUB.
 *
 * Sub-phase 1.4 (authentication and roles) replaces this file with
 * Islestone's `PermissionSet` for the five roles of ADR 0006. Until then:
 *
 *   • `getPermissionsForRole` grants NOTHING for every role (fail closed),
 *     so no code path can come to depend on a placeholder grant.
 *   • `getOrgPermissions` keeps the organization roles' mapping from
 *     inflect-compliance (`src/lib/permissions.ts`), with its
 *     compliance-only flags removed.
 *
 * Client-safe: the only Prisma dependency is an `import type`.
 */
import type { OrgRole, Role } from '@prisma/client';

/** Placeholder until 1.4 writes Islestone's PermissionSet. Fail-closed. */
export type PermissionSet = Readonly<Record<string, boolean>>;

const NO_PERMISSIONS: PermissionSet = Object.freeze({});

/** Returns the empty permission set for every role in sub-phase 1.3. */
export function getPermissionsForRole(_role: Role): PermissionSet {
    return NO_PERMISSIONS;
}

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
