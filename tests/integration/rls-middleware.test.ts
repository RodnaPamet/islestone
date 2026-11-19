/**
 * Integration Test: RLS enforcement end-to-end, through the middleware.
 *
 * Proves the invariants that make the RLS story production-grade:
 *
 *   1. `runInTenantContext` runs its callback as `app_user` with the
 *      `app.tenant_id` session variable set inside a transaction, and
 *      queries inside it only see own-tenant rows (Class A,
 *      `TenantMembership`).
 *   2. `SET LOCAL` is transaction-scoped: sequential and concurrent
 *      transactions never share a tenant context.
 *   3. `runWithoutRls` bypasses (superuser_bypass policy matches) and
 *      sees every row regardless of tenant.
 *   4. The org-axis tables (`Organization`, `OrgMembership`) return zero
 *      rows under `app_user` while `app.user_id` is unset — nothing sets
 *      it yet, so the org axis fails closed.
 *
 * Classes C (nullable tenantId) and E (ownership-chained) arrive with
 * their first tables (`UserSession` in 1.4).
 *
 * This test runs against the live Postgres (DB_AVAILABLE gate).
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { runInTenantContext, runWithoutRls } from '@/lib/db/rls-middleware';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

function makeCtx(tenantId: string): RequestContext {
    return makeRequestContext('ADMIN', { requestId: 'req-rls-int', userId: 'user-int', tenantId });
}

const SUFFIX = `rls_mw_${Date.now()}`;

describeFn('RLS middleware — live PostgreSQL enforcement', () => {
    let prisma: PrismaClient;
    let tenantA: string;
    let tenantB: string;
    let userA: string;
    let userB: string;
    let membershipA: string;
    let orgId: string;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);

        // Seed with the test client (the login role, so superuser_bypass
        // applies) so the fixture is reliably in place regardless of RLS.
        const [a, b] = await Promise.all([
            prisma.tenant.create({ data: { name: 'Tenant A', slug: `a-${SUFFIX}` } }),
            prisma.tenant.create({ data: { name: 'Tenant B', slug: `b-${SUFFIX}` } }),
        ]);
        tenantA = a.id;
        tenantB = b.id;
        userA = (await prisma.user.create({ data: { email: `a-${SUFFIX}@example.com` } })).id;
        userB = (await prisma.user.create({ data: { email: `b-${SUFFIX}@example.com` } })).id;
        membershipA = (
            await prisma.tenantMembership.create({ data: { tenantId: tenantA, userId: userA, role: 'MEMBER' } })
        ).id;

        orgId = (await prisma.organization.create({ data: { name: 'Org', slug: `org-${SUFFIX}` } })).id;
        await prisma.orgMembership.create({ data: { organizationId: orgId, userId: userA, role: 'ORG_OWNER' } });
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    describe('Direct tenantId — Class A (TenantMembership)', () => {
        test('the callback runs as app_user with app.tenant_id bound', async () => {
            const [row] = await runInTenantContext(makeCtx(tenantA), (db) =>
                db.$queryRawUnsafe<Array<{ who: string; tenant: string }>>(
                    `SELECT current_user AS who, current_setting('app.tenant_id', true) AS tenant`,
                ),
            );
            expect(row).toEqual({ who: 'app_user', tenant: tenantA });
        });

        test('tenant-A context sees its own membership', async () => {
            const rows = await runInTenantContext(makeCtx(tenantA), (db) =>
                db.tenantMembership.findMany({ where: { id: membershipA } }),
            );
            expect(rows).toHaveLength(1);
            expect(rows[0]!.tenantId).toBe(tenantA);
        });

        test('tenant-B context sees ZERO rows (cross-tenant blocked)', async () => {
            const rows = await runInTenantContext(makeCtx(tenantB), (db) =>
                db.tenantMembership.findMany({ where: { id: membershipA } }),
            );
            expect(rows).toHaveLength(0);
        });

        test('tenant-B context cannot INSERT carrying tenantA id', async () => {
            // Under app_user, the WITH CHECK on the INSERT policy must
            // reject a row whose tenantId mismatches the session var.
            await expect(
                runInTenantContext(makeCtx(tenantB), (db) =>
                    db.tenantMembership.create({ data: { tenantId: tenantA, userId: userB, role: 'OWNER' } }),
                ),
            ).rejects.toThrow(/row-level security/);
            expect(await prisma.tenantMembership.count({ where: { userId: userB } })).toBe(0);
        });

        test('tenant-B context cannot UPDATE a tenant-A row, nor move it to its own tenant', async () => {
            // Row is visible only via the bypass; under app_user the tenant-B
            // session can't even see the row to update.
            const result = await runInTenantContext(makeCtx(tenantB), (db) =>
                db.tenantMembership.updateMany({ where: { id: membershipA }, data: { tenantId: tenantB, role: 'OWNER' } }),
            );
            expect(result.count).toBe(0);
            expect(await prisma.tenantMembership.findUnique({ where: { id: membershipA } })).toMatchObject({
                tenantId: tenantA,
                role: 'MEMBER',
            });
        });

        test('tenant-A context cannot push its own row into tenant B', async () => {
            // The USING clause doubles as the UPDATE's check on the new row.
            await expect(
                runInTenantContext(makeCtx(tenantA), (db) =>
                    db.tenantMembership.update({ where: { id: membershipA }, data: { tenantId: tenantB } }),
                ),
            ).rejects.toThrow(/row-level security/);
        });
    });

    describe('SET LOCAL scoping — transaction boundary holds', () => {
        test('sequential transactions do not leak tenant context', async () => {
            const first = await runInTenantContext(makeCtx(tenantA), (db) =>
                db.tenantMembership.count({ where: { id: membershipA } }),
            );
            const second = await runInTenantContext(makeCtx(tenantB), (db) =>
                db.tenantMembership.count({ where: { id: membershipA } }),
            );
            expect(first).toBe(1);
            expect(second).toBe(0);
        });

        test('concurrent transactions do not share tenant context', async () => {
            const [a, b] = await Promise.all([
                runInTenantContext(makeCtx(tenantA), (db) => db.tenantMembership.count({ where: { id: membershipA } })),
                runInTenantContext(makeCtx(tenantB), (db) => db.tenantMembership.count({ where: { id: membershipA } })),
            ]);
            expect(a).toBe(1);
            expect(b).toBe(0);
        });

        test('a plain app_user transaction with no tenant bound sees nothing', async () => {
            const n = await prisma.$transaction(async (tx) => {
                await tx.$executeRawUnsafe('SET LOCAL ROLE app_user');
                return tx.tenantMembership.count();
            });
            expect(n).toBe(0);
        });
    });

    describe('runWithoutRls — explicit bypass path', () => {
        test("sees every tenant's rows regardless of filter", async () => {
            const rows = await runWithoutRls({ reason: 'test' }, (db) =>
                db.tenantMembership.findMany({ where: { id: membershipA } }),
            );
            expect(rows).toHaveLength(1);
            expect(rows[0]!.tenantId).toBe(tenantA);
        });

        test('can INSERT on behalf of any tenant (seeds, admin scripts)', async () => {
            const created = await runWithoutRls({ reason: 'test' }, (db) =>
                db.tenantMembership.create({ data: { tenantId: tenantB, userId: userB } }),
            );
            expect(created.tenantId).toBe(tenantB);
            // The schema default is the least-privileged role.
            expect(created.role).toBe('VIEWER');
        });
    });

    describe('Org axis — fails closed while app.user_id is unset', () => {
        test('Organization and OrgMembership return zero rows under app_user', async () => {
            const [orgs, members] = await runInTenantContext(makeCtx(tenantA), async (db) => [
                await db.organization.count(),
                await db.orgMembership.count(),
            ]);
            expect([orgs, members]).toEqual([0, 0]);
            // The rows exist: the login role sees them.
            expect(await prisma.organization.count({ where: { id: orgId } })).toBe(1);
            expect(await prisma.orgMembership.count({ where: { organizationId: orgId } })).toBe(1);
        });

        test('app_user cannot INSERT an OrgMembership (no WITH CHECK grants it)', async () => {
            await expect(
                runInTenantContext(makeCtx(tenantA), (db) =>
                    db.orgMembership.create({ data: { organizationId: orgId, userId: userB, role: 'ORG_OWNER' } }),
                ),
            ).rejects.toThrow(/row-level security/);
        });
    });
});
