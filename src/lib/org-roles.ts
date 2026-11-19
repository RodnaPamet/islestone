/**
 * The organization roles, and how every reader compares them.
 *
 * An owner is at least an admin wherever a reader asks "is this an admin",
 * and an owner's membership is changed only by another owner. The last
 * owner of an organization is held by the `org_membership_last_owner_guard`
 * trigger.
 *
 * Never compare a role with `'ORG_ADMIN'` to ask whether somebody administers
 * an organization: that answers "no" for its owner. Ask `isOrgAdminTier`.
 *
 * Client-safe: the only Prisma dependency is an `import type`.
 */
import type { OrgRole } from '@prisma/client';

/** The roles that administer an organization, most senior first. */
export const ORG_ADMIN_TIER_ROLES = ['ORG_OWNER', 'ORG_ADMIN'] as const satisfies readonly OrgRole[];

/** Does this role administer the organization (owner or admin)? */
export function isOrgAdminTier(role: OrgRole | string | null | undefined): boolean {
    return role === 'ORG_OWNER' || role === 'ORG_ADMIN';
}

/** Is this the organization's owner role? */
export function isOrgOwner(role: OrgRole | string | null | undefined): boolean {
    return role === 'ORG_OWNER';
}

/**
 * Seniority for ordering a member list: owner, admin, reader, then anything
 * this build does not know. A `Record` over the enum, so a value added without
 * a rank fails `tsc`.
 */
const RANK: Readonly<Record<OrgRole, number>> = {
    ORG_OWNER: 0,
    ORG_ADMIN: 1,
    ORG_READER: 2,
};

export function orgRoleRank(role: OrgRole | string): number {
    return (RANK as Record<string, number>)[role] ?? 3;
}
