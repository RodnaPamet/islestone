/**
 * Unit tests for tenant context resolvers.
 *
 * Tests resolveTenantContext and getDefaultTenantForUser.
 * Uses a mocked Prisma client. The resolvers read through
 * `runWithoutRls({ reason: 'auth-tenant-discovery' })`, which hands its
 * callback the module's named `prisma` export, so the mock supplies both the
 * named and the default export.
 */

// @/env is already globally mocked via jest.config.mjs moduleNameMapper

const mockPrisma = {
    tenant: {
        findUnique: jest.fn(),
    },
    tenantMembership: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
    },
};

// Getters, because the factory runs while the module under test is being
// imported, before `mockPrisma` above is initialised.
jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    get prisma() {
        return mockPrisma;
    },
    get default() {
        return mockPrisma;
    },
}));

jest.mock('@/lib/observability/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import { logger } from '@/lib/observability/logger';
import { getDefaultTenantForUser, resolveTenantContext } from '@/lib/tenant-context';
import { getPermissionsForRole } from '@/lib/permissions';

// ─── Test fixtures ───

const TENANT = {
    id: 'tenant-1',
    slug: 'acme-corp',
    name: 'Acme Corp',
    organizationId: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
};

const MEMBERSHIP = {
    id: 'member-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'MEMBER' as const,
    status: 'ACTIVE' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
};

// ─── resolveTenantContext ───

describe('resolveTenantContext', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns tenant context when membership exists (by slug)', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue(TENANT);
        mockPrisma.tenantMembership.findUnique.mockResolvedValue(MEMBERSHIP);

        const ctx = await resolveTenantContext({ tenantSlug: 'acme-corp' }, 'user-1');

        expect(ctx.tenant.id).toBe('tenant-1');
        expect(ctx.membership.id).toBe('member-1');
        expect(ctx.role).toBe('MEMBER');
        expect(ctx.permissions.canRead).toBe(true);
        expect(ctx.permissions.canWrite).toBe(true);
        expect(ctx.permissions.canAdmin).toBe(false);
        expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith({ where: { slug: 'acme-corp' } });
    });

    it('returns tenant context when membership exists (by tenantId)', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue(TENANT);
        mockPrisma.tenantMembership.findUnique.mockResolvedValue(MEMBERSHIP);

        const ctx = await resolveTenantContext({ tenantId: 'tenant-1' }, 'user-1');

        expect(ctx.tenant.id).toBe('tenant-1');
        expect(ctx.role).toBe('MEMBER');
        expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith({ where: { id: 'tenant-1' } });
    });

    it('reads through the auth-tenant-discovery bypass, which is logged', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue(TENANT);
        mockPrisma.tenantMembership.findUnique.mockResolvedValue(MEMBERSHIP);

        await resolveTenantContext({ tenantSlug: 'acme-corp' }, 'user-1');

        expect(logger.info).toHaveBeenCalledWith(
            'rls-middleware.bypass_invoked',
            expect.objectContaining({ reason: 'auth-tenant-discovery' }),
        );
    });

    it('throws notFound when tenant does not exist', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue(null);

        await expect(resolveTenantContext({ tenantSlug: 'does-not-exist' }, 'user-1')).rejects.toThrow(/not found/i);
    });

    it('throws notFound for a soft-deleted tenant, before reading any membership', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue({ ...TENANT, deletedAt: new Date() });
        mockPrisma.tenantMembership.findUnique.mockResolvedValue(MEMBERSHIP);

        await expect(resolveTenantContext({ tenantSlug: 'acme-corp' }, 'user-1')).rejects.toMatchObject({
            status: 404,
        });
        expect(mockPrisma.tenantMembership.findUnique).not.toHaveBeenCalled();
    });

    it('throws forbidden when user has no membership', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue(TENANT);
        mockPrisma.tenantMembership.findUnique.mockResolvedValue(null);

        await expect(resolveTenantContext({ tenantSlug: 'acme-corp' }, 'user-1')).rejects.toMatchObject({
            status: 403,
        });
    });

    it.each(['DEACTIVATED', 'REMOVED'] as const)('throws forbidden for a %s membership', async (status) => {
        mockPrisma.tenant.findUnique.mockResolvedValue(TENANT);
        mockPrisma.tenantMembership.findUnique.mockResolvedValue({ ...MEMBERSHIP, status });

        await expect(resolveTenantContext({ tenantSlug: 'acme-corp' }, 'user-1')).rejects.toMatchObject({
            status: 403,
        });
    });

    it('throws notFound when no identifier provided', async () => {
        await expect(resolveTenantContext({}, 'user-1')).rejects.toThrow(/identifier required/i);
    });

    it('returns correct permissions for ADMIN role', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue(TENANT);
        mockPrisma.tenantMembership.findUnique.mockResolvedValue({
            ...MEMBERSHIP,
            role: 'ADMIN',
        });

        const ctx = await resolveTenantContext({ tenantSlug: 'acme-corp' }, 'user-1');

        expect(ctx.permissions).toEqual({ canRead: true, canWrite: true, canAdmin: true, canExport: true });
    });

    it('returns correct permissions for VIEWER role', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue(TENANT);
        mockPrisma.tenantMembership.findUnique.mockResolvedValue({
            ...MEMBERSHIP,
            role: 'VIEWER',
        });

        const ctx = await resolveTenantContext({ tenantSlug: 'acme-corp' }, 'user-1');

        expect(ctx.permissions).toEqual({ canRead: true, canWrite: false, canAdmin: false, canExport: false });
    });

    it('returns correct permissions for GUEST role', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue(TENANT);
        mockPrisma.tenantMembership.findUnique.mockResolvedValue({
            ...MEMBERSHIP,
            role: 'GUEST',
        });

        const ctx = await resolveTenantContext({ tenantSlug: 'acme-corp' }, 'user-1');

        expect(ctx.permissions).toEqual({ canRead: true, canWrite: false, canAdmin: false, canExport: false });
    });

    it('grants the built-in role\'s granular permissions when the membership carries no custom role', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue(TENANT);
        mockPrisma.tenantMembership.findUnique.mockResolvedValue({ ...MEMBERSHIP, role: 'OWNER', customRole: null });

        const ctx = await resolveTenantContext({ tenantSlug: 'acme-corp' }, 'user-1');

        expect(ctx.appPermissions).toEqual(getPermissionsForRole('OWNER'));
        expect(ctx.customRole).toBeNull();
    });

    it('a custom role replaces the permissions and its base sets the coarse tier', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue(TENANT);
        const viewer = getPermissionsForRole('VIEWER');
        mockPrisma.tenantMembership.findUnique.mockResolvedValue({
            ...MEMBERSHIP,
            role: 'MEMBER',
            customRole: {
                id: 'role-1',
                tenantId: TENANT.id,
                baseRole: 'VIEWER',
                grantsJson: { ...viewer, docs: { view: true, create: true, edit: false } },
            },
        });

        const ctx = await resolveTenantContext({ tenantSlug: 'acme-corp' }, 'user-1');

        expect(ctx.role).toBe('VIEWER');
        expect(ctx.membership.role).toBe('MEMBER');
        expect(ctx.permissions).toEqual({ canRead: true, canWrite: false, canAdmin: false, canExport: false });
        expect(ctx.appPermissions.docs).toEqual({ view: true, create: true, edit: false });
        expect(ctx.appPermissions.work_items.create).toBe(false);
        expect(ctx.membership).not.toHaveProperty('customRole');
    });
});

// ─── getDefaultTenantForUser ───

describe('getDefaultTenantForUser', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns first membership by createdAt', async () => {
        const membershipWithTenant = {
            ...MEMBERSHIP,
            tenant: TENANT,
        };
        mockPrisma.tenantMembership.findFirst.mockResolvedValue(membershipWithTenant);

        const result = await getDefaultTenantForUser('user-1');

        expect(result).toBeTruthy();
        expect(result!.tenantId).toBe('tenant-1');
        expect(result!.tenant.name).toBe('Acme Corp');
        expect(mockPrisma.tenantMembership.findFirst).toHaveBeenCalledWith({
            // Excludes soft-deleted tenants — never default a user into a
            // removed workspace.
            where: { userId: 'user-1', tenant: { deletedAt: null } },
            orderBy: { createdAt: 'asc' },
            include: { tenant: true },
        });
    });

    it('returns null when user has no memberships', async () => {
        mockPrisma.tenantMembership.findFirst.mockResolvedValue(null);

        const result = await getDefaultTenantForUser('user-1');
        expect(result).toBeNull();
    });
});
