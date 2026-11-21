/**
 * Tenant context resolvers.
 *
 * These functions resolve the current tenant context for a request,
 * using TenantMembership as the authoritative source of truth.
 *
 * Design decisions:
 *   - Permissions are computed from the tenant membership role, or from its
 *     custom role (the base role's coarse tier and the stored grants) when
 *     the membership carries one.
 *   - The lookups run before any tenant context exists (they are what
 *     establishes it), so they go through `runWithoutRls` with the
 *     `auth-tenant-discovery` reason rather than the bare global client.
 */
import type { Role, Tenant, TenantCustomRole, TenantMembership } from '@prisma/client';

import { runWithoutRls } from '@/lib/db/rls-middleware';
import { forbidden, notFound } from '@/lib/errors/types';
import type { PermissionSet } from '@/lib/permissions';
import { effectiveRoleOfMembership, permissionsForMembership } from '@/lib/permissions';

// ─── Permission shape ───

export interface Permissions {
    canRead: boolean;
    canWrite: boolean;
    canAdmin: boolean;
    canExport: boolean;
}

export interface TenantContext {
    tenant: Tenant;
    membership: TenantMembership;
    role: Role;
    /** The membership's custom role, when it carries one. */
    customRole: TenantCustomRole | null;
    permissions: Permissions;
    appPermissions: PermissionSet;
}

// ─── Permission calculator ───

/**
 * The coarse ladder for Islestone's five roles (ADR 0006: Owner > Admin >
 * Member > Viewer > Guest; docs/porting/maps/1.4.md, "Permission set").
 * canRead: every role. canWrite: OWNER, ADMIN, MEMBER. canAdmin and
 * canExport: OWNER and ADMIN (matching `workspace.export`).
 *
 * GUEST keeps `canRead` so the self-service usecases (its own notifications
 * and preferences, which ask the coarse read tier and no key) answer it; it
 * holds no granular key (owner decision 204), so every keyed route and
 * usecase refuses it until sub-phase 8.4.
 */
const ROLE_ORDER: Record<Role, number> = {
    OWNER: 5,
    ADMIN: 4,
    MEMBER: 3,
    VIEWER: 2,
    GUEST: 1,
};

/**
 * A role's rung on the coarse ladder (`ROLE_ORDER`), 0 for a value the ladder
 * does not know. Exported so a caller comparing two coarse tiers reads THIS
 * ladder rather than a copy of it (#5306: the per-request API-key raise).
 */
export function coarseRoleLevel(role: Role): number {
    return ROLE_ORDER[role] ?? 0;
}

export function computePermissions(role: Role): Permissions {
    const level = ROLE_ORDER[role] ?? 0;
    return {
        canRead: level >= 1,
        canWrite: level >= 3,
        canAdmin: level >= 4,
        canExport: level >= 4,
    };
}

// ─── Tenant context resolver ───

export async function resolveTenantContext(
    params: { tenantSlug?: string; tenantId?: string },
    userId: string
): Promise<TenantContext> {
    if (!params.tenantSlug && !params.tenantId) {
        throw notFound('Tenant identifier required');
    }

    const tenant: Tenant | null = await runWithoutRls({ reason: 'auth-tenant-discovery' }, (db) =>
        params.tenantSlug
            ? db.tenant.findUnique({ where: { slug: params.tenantSlug } })
            : db.tenant.findUnique({ where: { id: params.tenantId } }),
    );

    if (!tenant) {
        throw notFound('Tenant not found');
    }

    // Soft-deleted (removed from the org admin panel) tenants are
    // inaccessible. This is the single authoritative gate — every /t and
    // /api/t request resolves through here — so denying it once makes a
    // removed tenant unreachable everywhere, regardless of stale JWT
    // claims or cached listings. Same anti-enumeration shape as
    // "not found".
    if (tenant.deletedAt) {
        throw notFound('Tenant not found');
    }

    const tenantId = tenant.id;
    const membership = await runWithoutRls({ reason: 'auth-tenant-discovery' }, (db) =>
        db.tenantMembership.findUnique({
            where: {
                tenantId_userId: {
                    tenantId,
                    userId,
                },
            },
            include: { customRole: true },
        }),
    );

    if (!membership) {
        throw forbidden('Not a member of this tenant');
    }

    // Block deactivated or removed members from accessing tenant resources
    const memberStatus = membership.status;
    if (memberStatus === 'DEACTIVATED') {
        throw forbidden('Your account has been deactivated by a tenant administrator. Contact your admin for access.');
    }
    if (memberStatus === 'REMOVED') {
        throw forbidden('You are no longer a member of this tenant.');
    }

    // Resolve permissions: a custom role overrides the enum-based defaults
    // when present, and its base becomes the effective (coarse) role; a GUEST
    // membership stays GUEST whatever it carries (decision 204).
    const { customRole, ...membershipRow } = membership;
    const effectiveRole = effectiveRoleOfMembership(membership);
    const appPermissions = permissionsForMembership(membership);

    return {
        tenant,
        membership: membershipRow,
        role: effectiveRole,
        customRole,
        permissions: computePermissions(effectiveRole),
        appPermissions,
    };
}

// ─── Default tenant helper ───

/**
 * Get the default tenant for a user (first membership by creation date).
 *
 * @param userId - The user's ID
 * @returns TenantMembership with tenant, or null if user has no memberships
 */
export async function getDefaultTenantForUser(
    userId: string
): Promise<(TenantMembership & { tenant: Tenant }) | null> {
    return runWithoutRls({ reason: 'auth-tenant-discovery' }, (db) =>
        db.tenantMembership.findFirst({
            // Skip memberships whose tenant was soft-deleted — never default
            // a user into a removed tenant.
            where: { userId, tenant: { deletedAt: null } },
            orderBy: { createdAt: 'asc' },
            include: { tenant: true },
        }),
    );
}
