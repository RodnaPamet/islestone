/**
 * Two-tenant isolation for `TenantMembership` (roadmap section 4: every
 * tenant table gets a two-tenant test; hardening gate H1).
 *
 * Every operation runs through `runInTenantContext` as tenant B, i.e. as the
 * application database role `app_user` with `app.tenant_id` = B, and none of
 * them may read, count, change or remove tenant A's memberships. Tenant A's
 * rows are then checked through the login role, so a check cannot pass
 * because the row was never there.
 *
 * Written from the pattern of inflect-compliance's
 * `tests/integration/rls-isolation.test.ts` (whose models are all compliance
 * models); no code copied.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { runInTenantContext } from '@/lib/db/rls-middleware';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

const SUFFIX = `iso_${Date.now()}`;

describeFn('TenantMembership — two-tenant isolation as app_user', () => {
    let prisma: PrismaClient;
    let tenantA: string;
    let tenantB: string;
    let ownerA: string;
    let memberA: string;
    let memberB: string;
    let userA1: string;
    let userA2: string;
    let userB: string;
    let ctxB: RequestContext;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);

        tenantA = (await prisma.tenant.create({ data: { name: 'A', slug: `a-${SUFFIX}` } })).id;
        tenantB = (await prisma.tenant.create({ data: { name: 'B', slug: `b-${SUFFIX}` } })).id;
        userA1 = (await prisma.user.create({ data: { email: `a1-${SUFFIX}@example.com` } })).id;
        userA2 = (await prisma.user.create({ data: { email: `a2-${SUFFIX}@example.com` } })).id;
        userB = (await prisma.user.create({ data: { email: `b-${SUFFIX}@example.com` } })).id;

        ownerA = (await prisma.tenantMembership.create({ data: { tenantId: tenantA, userId: userA1, role: 'OWNER' } })).id;
        memberA = (await prisma.tenantMembership.create({ data: { tenantId: tenantA, userId: userA2, role: 'MEMBER' } })).id;
        memberB = (await prisma.tenantMembership.create({ data: { tenantId: tenantB, userId: userB, role: 'OWNER' } })).id;

        ctxB = makeRequestContext('OWNER', { tenantId: tenantB, userId: userB, requestId: 'req-iso' });
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    /** Tenant A's rows as the login role sees them, for the after-checks. */
    const tenantARows = () =>
        prisma.tenantMembership.findMany({
            where: { tenantId: tenantA },
            orderBy: { id: 'asc' },
            select: { id: true, tenantId: true, userId: true, role: true, status: true },
        });

    let before: Awaited<ReturnType<typeof tenantARows>>;
    beforeEach(async () => {
        before = await tenantARows();
        expect(before).toHaveLength(2);
    });
    afterEach(async () => {
        expect(await tenantARows()).toEqual(before);
    });

    it('runs as app_user with app.tenant_id = B', async () => {
        const [row] = await runInTenantContext(ctxB, (db) =>
            db.$queryRawUnsafe<Array<{ who: string; tenant: string }>>(
                `SELECT current_user AS who, current_setting('app.tenant_id', true) AS tenant`,
            ),
        );
        expect(row).toEqual({ who: 'app_user', tenant: tenantB });
    });

    it('read: findUnique, findFirst and findMany by A ids return nothing', async () => {
        const [unique, first, many] = await runInTenantContext(ctxB, async (db) => [
            await db.tenantMembership.findUnique({ where: { id: ownerA } }),
            await db.tenantMembership.findFirst({ where: { tenantId: tenantA } }),
            await db.tenantMembership.findMany({ where: { id: { in: [ownerA, memberA] } } }),
        ]);
        expect(unique).toBeNull();
        expect(first).toBeNull();
        expect(many).toEqual([]);
    });

    it('list: an unfiltered findMany returns only B rows', async () => {
        const rows = await runInTenantContext(ctxB, (db) => db.tenantMembership.findMany({ select: { id: true, tenantId: true } }));
        expect(rows).toEqual([{ id: memberB, tenantId: tenantB }]);
    });

    it('count and aggregate see only B rows', async () => {
        const [all, inA, grouped] = await runInTenantContext(ctxB, async (db) => [
            await db.tenantMembership.count(),
            await db.tenantMembership.count({ where: { tenantId: tenantA } }),
            await db.tenantMembership.groupBy({ by: ['tenantId'], _count: { _all: true } }),
        ]);
        expect(all).toBe(1);
        expect(inA).toBe(0);
        expect(grouped).toEqual([{ tenantId: tenantB, _count: { _all: 1 } }]);
    });

    it('a raw SELECT is filtered too', async () => {
        const rows = await runInTenantContext(ctxB, (db) =>
            db.$queryRawUnsafe<Array<{ tenantId: string }>>(`SELECT "tenantId" FROM "TenantMembership"`),
        );
        expect(rows).toEqual([{ tenantId: tenantB }]);
    });

    it('update: updateMany over A rows changes nothing; update by A id throws not-found', async () => {
        const result = await runInTenantContext(ctxB, (db) =>
            db.tenantMembership.updateMany({ where: { tenantId: tenantA }, data: { role: 'GUEST' } }),
        );
        expect(result.count).toBe(0);
        await expect(
            runInTenantContext(ctxB, (db) => db.tenantMembership.update({ where: { id: memberA }, data: { role: 'GUEST' } })),
        ).rejects.toMatchObject({ code: 'P2025' });
    });

    it('delete: deleteMany over A rows removes nothing; delete by A id throws not-found', async () => {
        const result = await runInTenantContext(ctxB, (db) => db.tenantMembership.deleteMany({ where: { tenantId: tenantA } }));
        expect(result.count).toBe(0);
        await expect(
            runInTenantContext(ctxB, (db) => db.tenantMembership.delete({ where: { id: memberA } })),
        ).rejects.toMatchObject({ code: 'P2025' });
    });

    it('upsert keyed on an A row cannot update it, and its create half cannot land in A', async () => {
        await expect(
            runInTenantContext(ctxB, (db) =>
                db.tenantMembership.upsert({
                    where: { tenantId_userId: { tenantId: tenantA, userId: userA2 } },
                    update: { role: 'OWNER' },
                    create: { tenantId: tenantA, userId: userA2, role: 'OWNER' },
                }),
            ),
        ).rejects.toThrow();
    });

    it('create carrying A id is refused by the insert policy', async () => {
        await expect(
            runInTenantContext(ctxB, (db) =>
                db.tenantMembership.create({ data: { tenantId: tenantA, userId: userB, role: 'OWNER' } }),
            ),
        ).rejects.toThrow(/row-level security/);
    });

    it('tenant B still reads and writes its own rows (the policy is not simply deny-all)', async () => {
        const own = await runInTenantContext(ctxB, async (db) => {
            const row = await db.tenantMembership.findUnique({ where: { id: memberB } });
            const touched = await db.tenantMembership.updateMany({ where: { id: memberB }, data: { invitedAt: new Date() } });
            return { row, touched: touched.count };
        });
        expect(own.row?.tenantId).toBe(tenantB);
        expect(own.touched).toBe(1);
    });
});
