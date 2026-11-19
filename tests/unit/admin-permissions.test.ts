/**
 * Admin Permission Boundary Tests
 *
 * Copied from inflect-compliance `tests/unit/admin-permissions.test.ts`
 * (5528464fc54a8681956f3b9ce23ca9c075f0420e); its PermissionSet half is
 * rewritten for Islestone's roles, the DSAR, agent-inventory and
 * skill-authoring cases are cut.
 *
 * Verifies that all admin policy functions correctly enforce
 * ADMIN-only access and that safety invariants block dangerous operations.
 */
import type { RequestContext } from '@/app-layer/types';
import {
    assertCanManageMembers,
    assertCanChangeRoles,
    assertCanViewAdminSettings,
    assertCanConfigureSSO,
    assertCanManageSCIM,
    assertNotSelfDemotion,
    assertNotSelfDeactivation,
} from '@/app-layer/policies/admin.policies';
import { computePermissions } from '@/lib/tenant-context';
import { getPermissionsForRole } from '@/lib/permissions';
import type { Role } from '@prisma/client';

// ─── Helpers ───

function makeCtx(role: Role, userId = 'user-1'): RequestContext {
    return {
        requestId: 'req-test',
        userId,
        tenantId: 'tenant-1',
        tenantSlug: 'acme-co',
        role,
        permissions: computePermissions(role),
        appPermissions: getPermissionsForRole(role),
    };
}

// ─── Policy Enforcement Tests ───

describe('Admin Policy Enforcement', () => {
    const NON_ADMIN_ROLES: Role[] = ['MEMBER', 'VIEWER', 'GUEST'];
    const policies = [
        { name: 'assertCanManageMembers', fn: assertCanManageMembers },
        { name: 'assertCanChangeRoles', fn: assertCanChangeRoles },
        { name: 'assertCanViewAdminSettings', fn: assertCanViewAdminSettings },
        { name: 'assertCanConfigureSSO', fn: assertCanConfigureSSO },
        { name: 'assertCanManageSCIM', fn: assertCanManageSCIM },
    ];

    policies.forEach(({ name, fn }) => {
        describe(name, () => {
            it('allows ADMIN', () => {
                expect(() => fn(makeCtx('ADMIN'))).not.toThrow();
            });

            NON_ADMIN_ROLES.forEach((role) => {
                it(`rejects ${role}`, () => {
                    expect(() => fn(makeCtx(role))).toThrow(/permission/i);
                });
            });
        });
    });
});

// ─── Safety Invariant Tests ───

describe('Admin Safety Invariants', () => {
    it('assertNotSelfDemotion blocks demoting yourself', () => {
        const ctx = makeCtx('ADMIN', 'admin-user-1');
        expect(() => assertNotSelfDemotion(ctx, 'admin-user-1', 'MEMBER')).toThrow(/demote yourself/i);
    });

    it('assertNotSelfDemotion allows demoting another user', () => {
        const ctx = makeCtx('ADMIN', 'admin-user-1');
        expect(() => assertNotSelfDemotion(ctx, 'other-user', 'VIEWER')).not.toThrow();
    });

    it('assertNotSelfDemotion allows keeping own ADMIN role', () => {
        const ctx = makeCtx('ADMIN', 'admin-user-1');
        expect(() => assertNotSelfDemotion(ctx, 'admin-user-1', 'ADMIN')).not.toThrow();
    });

    it('assertNotSelfDeactivation blocks deactivating yourself', () => {
        const ctx = makeCtx('ADMIN', 'admin-user-1');
        expect(() => assertNotSelfDeactivation(ctx, 'admin-user-1')).toThrow(/deactivate your own/i);
    });

    it('assertNotSelfDeactivation allows deactivating another user', () => {
        const ctx = makeCtx('ADMIN', 'admin-user-1');
        expect(() => assertNotSelfDeactivation(ctx, 'other-user')).not.toThrow();
    });
});

// ─── PermissionSet Tests ───

const ADMIN_KEYS = ['view', 'manage', 'members', 'sso', 'scim', 'tenant_lifecycle', 'owner_management'] as const;

describe('PermissionSet admin capabilities', () => {
    it('OWNER has all admin permissions including tenant_lifecycle and owner_management', () => {
        const admin = getPermissionsForRole('OWNER').admin;
        for (const key of ADMIN_KEYS) expect(admin[key]).toBe(true);
    });

    it('ADMIN has operational permissions but NOT tenant_lifecycle or owner_management', () => {
        const admin = getPermissionsForRole('ADMIN').admin;
        for (const key of ['view', 'manage', 'members', 'sso', 'scim'] as const) expect(admin[key]).toBe(true);
        expect(admin.tenant_lifecycle).toBe(false);
        expect(admin.owner_management).toBe(false);
    });

    it.each(['MEMBER', 'VIEWER', 'GUEST'] as const)('%s has no admin permissions', (role) => {
        const admin = getPermissionsForRole(role).admin;
        for (const key of ADMIN_KEYS) expect(admin[key]).toBe(false);
    });
});

describe('computePermissions admin flags', () => {
    it.each([
        ['OWNER', true],
        ['ADMIN', true],
        ['MEMBER', false],
        ['VIEWER', false],
        ['GUEST', false],
    ] as const)('%s gets canAdmin=%s', (role, expected) => {
        expect(computePermissions(role).canAdmin).toBe(expected);
    });
});
