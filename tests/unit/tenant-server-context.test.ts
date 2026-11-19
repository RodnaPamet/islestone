/**
 * Unit tests for the server-side tenant context resolver.
 *
 * Tests resolveTenantBySlug and getTenantServerContext from
 * @/lib/server/tenant-context.server.
 *
 * Uses mocked Prisma client (same pattern as tenant-context.test.ts).
 */

// ─── Mocks ───

const mockPrisma = {
    tenant: {
        findUnique: jest.fn(),
    },
    tenantMembership: {
        findUnique: jest.fn(),
    },
};

// Getters, because the factory runs while the module under test is being
// imported, before `mockPrisma` above is initialised. Both exports: the
// resolver reads the default, `runWithoutRls` the named `prisma`.
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

import { getTenantServerContext, resolveTenantBySlug } from '@/lib/server/tenant-context.server';

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

const MEMBERSHIP_ADMIN = {
    id: 'member-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'ADMIN' as const,
    status: 'ACTIVE' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
};

const MEMBERSHIP_MEMBER = {
    ...MEMBERSHIP_ADMIN,
    id: 'member-2',
    role: 'MEMBER' as const,
};

const MEMBERSHIP_DEACTIVATED = {
    ...MEMBERSHIP_ADMIN,
    id: 'member-3',
    status: 'DEACTIVATED',
};

// ─── resolveTenantBySlug ───

describe('resolveTenantBySlug', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns tenant record for valid slug', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue({
            id: 'tenant-1',
            slug: 'acme-corp',
            name: 'Acme Corp',
        });

        const result = await resolveTenantBySlug('acme-corp');

        expect(result).toEqual({
            id: 'tenant-1',
            slug: 'acme-corp',
            name: 'Acme Corp',
        });
    });

    it('throws NOT_FOUND for unknown slug', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue(null);

        await expect(resolveTenantBySlug('does-not-exist')).rejects.toThrow('Tenant not found');
    });

    it('only selects id, slug, name (no overfetch)', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue({
            id: 'tenant-1',
            slug: 'acme-corp',
            name: 'Acme Corp',
        });

        await resolveTenantBySlug('acme-corp');

        expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith({
            where: { slug: 'acme-corp' },
            select: { id: true, slug: true, name: true },
        });
    });
});

// ─── getTenantServerContext ───

describe('getTenantServerContext', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns full context for valid slug and membership', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue(TENANT);
        mockPrisma.tenantMembership.findUnique.mockResolvedValue(MEMBERSHIP_ADMIN);

        const ctx = await getTenantServerContext({ tenantSlug: 'acme-corp', userId: 'user-1', session: {} });

        expect(ctx.tenant).toEqual({
            id: 'tenant-1',
            slug: 'acme-corp',
            name: 'Acme Corp',
        });
        expect(ctx.role).toBe('ADMIN');
        expect(ctx.membershipRole).toBe('ADMIN');
        expect(ctx.permissions.canRead).toBe(true);
        expect(ctx.permissions.canWrite).toBe(true);
        expect(ctx.permissions.canAdmin).toBe(true);
    });

    it('returns correct Member-role permissions', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue(TENANT);
        mockPrisma.tenantMembership.findUnique.mockResolvedValue(MEMBERSHIP_MEMBER);

        const ctx = await getTenantServerContext({ tenantSlug: 'acme-corp', userId: 'user-1', session: {} });

        expect(ctx.role).toBe('MEMBER');
        expect(ctx.permissions.canWrite).toBe(true);
        expect(ctx.permissions.canAdmin).toBe(false);
    });

    it('throws for unknown tenant slug', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue(null);

        await expect(getTenantServerContext({ tenantSlug: 'ghost', userId: 'user-1', session: {} })).rejects.toThrow(
            'Tenant not found',
        );
    });

    it('throws for a soft-deleted tenant', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue({ ...TENANT, deletedAt: new Date() });
        mockPrisma.tenantMembership.findUnique.mockResolvedValue(MEMBERSHIP_ADMIN);

        await expect(getTenantServerContext({ tenantSlug: 'acme-corp', userId: 'user-1', session: {} })).rejects.toThrow(
            'Tenant not found',
        );
    });

    it('throws for non-member user', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue(TENANT);
        mockPrisma.tenantMembership.findUnique.mockResolvedValue(null);

        await expect(getTenantServerContext({ tenantSlug: 'acme-corp', userId: 'outsider', session: {} })).rejects.toThrow(
            'Not a member of this tenant',
        );
    });

    it('throws for deactivated member', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue(TENANT);
        mockPrisma.tenantMembership.findUnique.mockResolvedValue(MEMBERSHIP_DEACTIVATED);

        await expect(getTenantServerContext({ tenantSlug: 'acme-corp', userId: 'user-1', session: {} })).rejects.toThrow(
            /deactivated/i,
        );
    });

    it('returns plain serializable object (no Prisma model types)', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue(TENANT);
        mockPrisma.tenantMembership.findUnique.mockResolvedValue(MEMBERSHIP_ADMIN);

        const ctx = await getTenantServerContext({ tenantSlug: 'acme-corp', userId: 'user-1', session: {} });

        // The tenant field must be a plain object, not a Prisma model.
        // It should only contain id, slug, name — no createdAt, updatedAt, etc.
        expect(Object.keys(ctx.tenant).sort()).toEqual(['id', 'name', 'slug']);
        expect(Object.keys(ctx).sort()).toEqual(['appPermissions', 'membershipRole', 'permissions', 'role', 'tenant']);

        // Should be JSON-safe (no Date objects or circular refs)
        expect(() => JSON.stringify(ctx)).not.toThrow();
    });
});
