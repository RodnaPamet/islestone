/**
 * Tenant isolation at context resolution, against an in-memory Prisma mock.
 *
 * Tests:
 * 1. Tenant membership required — resolveTenantContext throws forbidden without it
 * 2. Cross-tenant data access blocked — cannot resolve context for a different tenant
 * 3. Default tenant resolver returns first membership
 * 4. Permission computation for the five roles (ADR 0006)
 *
 * It mocks `@/lib/prisma`, so it is a unit test (in inflect-compliance it sat
 * in tests/integration/tenant-isolation.test.ts). The live-database two-tenant
 * test is tests/integration/tenant-membership-isolation.test.ts.
 */
import { computePermissions, getDefaultTenantForUser, resolveTenantContext } from '@/lib/tenant-context';

// ─── Mocks ───

// We mock prisma directly to avoid needing a running DB. The resolvers go
// through runWithoutRls, which reads the named `prisma` export.
jest.mock('@/lib/prisma', () => {
    const tenants = [
        { id: 'tenant-a', slug: 'acme-corp', name: 'Acme Corp', deletedAt: null },
        { id: 'tenant-b', slug: 'evil-corp', name: 'Evil Corp', deletedAt: null },
    ];

    const memberships = [
        { id: 'mem-a', tenantId: 'tenant-a', userId: 'user-1', role: 'MEMBER', status: 'ACTIVE', createdAt: new Date('2024-01-01') },
        { id: 'mem-b', tenantId: 'tenant-b', userId: 'user-2', role: 'ADMIN', status: 'ACTIVE', createdAt: new Date('2024-01-01') },
    ];

    type Where = { slug?: string; id?: string; userId?: string; tenantId_userId?: { tenantId: string; userId: string } };
    const client = {
        tenant: {
            findUnique: jest.fn(async ({ where }: { where: Where }) => {
                if (where.slug) return tenants.find((t) => t.slug === where.slug) || null;
                if (where.id) return tenants.find((t) => t.id === where.id) || null;
                return null;
            }),
        },
        tenantMembership: {
            findUnique: jest.fn(async ({ where }: { where: Where }) => {
                const key = where.tenantId_userId;
                if (!key) return null;
                return memberships.find((m) => m.tenantId === key.tenantId && m.userId === key.userId) || null;
            }),
            findFirst: jest.fn(async ({ where, include }: { where: Where; include?: { tenant?: boolean } }) => {
                const mem = memberships.find((m) => m.userId === where.userId);
                if (!mem) return null;
                const tenant = tenants.find((t) => t.id === mem.tenantId);
                return include?.tenant ? { ...mem, tenant } : mem;
            }),
        },
    };
    return { __esModule: true, prisma: client, default: client };
});

jest.mock('@/lib/observability/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

describe('Tenant isolation at context resolution', () => {
    // ─── 1. Tenant membership required ───
    describe('tenant membership required', () => {
        it('resolves context for a member', async () => {
            const ctx = await resolveTenantContext({ tenantSlug: 'acme-corp' }, 'user-1');
            expect(ctx.tenant.id).toBe('tenant-a');
            expect(ctx.role).toBe('MEMBER');
            expect(ctx.permissions.canRead).toBe(true);
            expect(ctx.permissions.canWrite).toBe(true);
            expect(ctx.permissions.canAdmin).toBe(false);
        });

        it('throws forbidden for non-member', async () => {
            await expect(resolveTenantContext({ tenantSlug: 'acme-corp' }, 'user-999')).rejects.toThrow(/not a member/i);
        });

        it('throws notFound for non-existent tenant', async () => {
            await expect(resolveTenantContext({ tenantSlug: 'ghost-corp' }, 'user-1')).rejects.toThrow(/not found/i);
        });
    });

    // ─── 2. Cross-tenant data access blocked ───
    describe('cross-tenant data access blocked', () => {
        it('user-1 cannot access tenant-b', async () => {
            await expect(resolveTenantContext({ tenantSlug: 'evil-corp' }, 'user-1')).rejects.toThrow(/not a member/i);
        });

        it('user-2 cannot access tenant-a', async () => {
            await expect(resolveTenantContext({ tenantSlug: 'acme-corp' }, 'user-2')).rejects.toThrow(/not a member/i);
        });
    });

    // ─── 3. Default tenant resolver ───
    describe('default tenant resolver', () => {
        it('returns first membership for user with memberships', async () => {
            const result = await getDefaultTenantForUser('user-1');
            expect(result).not.toBeNull();
            expect(result!.tenant.slug).toBe('acme-corp');
        });

        it('returns null for user with no memberships', async () => {
            const result = await getDefaultTenantForUser('user-999');
            expect(result).toBeNull();
        });
    });

    // ─── 4. Permission computation ───
    describe('permission computation (the coarse ladder of 1.4)', () => {
        it.each([
            ['OWNER', { canRead: true, canWrite: true, canAdmin: true, canExport: true }],
            ['ADMIN', { canRead: true, canWrite: true, canAdmin: true, canExport: true }],
            ['MEMBER', { canRead: true, canWrite: true, canAdmin: false, canExport: false }],
            ['VIEWER', { canRead: true, canWrite: false, canAdmin: false, canExport: false }],
            ['GUEST', { canRead: true, canWrite: false, canAdmin: false, canExport: false }],
        ] as const)('%s', (role, expected) => {
            expect(computePermissions(role)).toEqual(expected);
        });

        it('an unknown role gets nothing', () => {
            expect(computePermissions('NOT_A_ROLE' as never)).toEqual({
                canRead: false,
                canWrite: false,
                canAdmin: false,
                canExport: false,
            });
        });
    });
});
