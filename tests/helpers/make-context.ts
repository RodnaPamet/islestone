/**
 * Shared test helper for building RequestContext fixtures.
 *
 * All test files that create mock RequestContext objects should use
 * this helper to ensure they include all required fields, including
 * appPermissions.
 */
import type { Role } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { getPermissionsForRole } from '@/lib/permissions';

/**
 * Build a complete RequestContext for tests.
 *
 * The coarse flags follow `computePermissions` in src/lib/tenant-context.ts
 * (ADR 0006 roles, provisional until sub-phase 1.4).
 *
 * @param role - The Role enum value (defaults to ADMIN)
 * @param overrides - Partial overrides to any field
 */
export function makeRequestContext(role: Role = 'ADMIN', overrides?: Partial<RequestContext>): RequestContext {
    return {
        requestId: 'req-test',
        userId: 'user-1',
        tenantId: 'tenant-1',
        tenantSlug: 'acme',
        role,
        membershipRole: role,
        permissions: {
            canRead: true,
            canWrite: role === 'OWNER' || role === 'ADMIN' || role === 'MEMBER',
            canAdmin: role === 'OWNER' || role === 'ADMIN',
            canExport: role !== 'GUEST',
        },
        appPermissions: getPermissionsForRole(role),
        ...overrides,
    };
}

/**
 * Per-role appPermissions — inline constants for test files that construct
 * RequestContext literals without using makeRequestContext.
 */
export const OWNER_APP_PERMISSIONS = getPermissionsForRole('OWNER');
export const ADMIN_APP_PERMISSIONS = getPermissionsForRole('ADMIN');
export const MEMBER_APP_PERMISSIONS = getPermissionsForRole('MEMBER');
export const VIEWER_APP_PERMISSIONS = getPermissionsForRole('VIEWER');
export const GUEST_APP_PERMISSIONS = getPermissionsForRole('GUEST');
