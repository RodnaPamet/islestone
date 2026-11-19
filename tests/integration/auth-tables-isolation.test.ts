/**
 * Two-tenant isolation for the tenant tables sub-phase 1.4 adds:
 * `UserMfaEnrollment`, `TenantSecuritySettings`, `TenantInvite` and
 * `TenantCustomRole` (roadmap section 4: every tenant table gets a two-tenant
 * test). `UserSession`, whose policy is the asymmetric single one, has its own
 * suite, `user-session-rls.test.ts`.
 *
 * Every operation runs through `runInTenantContext` as tenant B, i.e. as
 * `app_user` with `app.tenant_id` = B, and none of them may read, count,
 * change or remove tenant A's rows, or create one in A. Tenant A's rows are
 * then re-read through the login role, so a check cannot pass because the row
 * was never there. Each model also proves B still reaches its own row, so the
 * policy is not simply deny-all.
 *
 * Written from the pattern of `tenant-membership-isolation.test.ts`; no code
 * copied.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db/rls-middleware';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

const SUFFIX = `authiso_${Date.now()}`;

type Db = PrismaTx;

interface Fixture {
    tenantA: string;
    tenantB: string;
    userA: string;
    userB: string;
}

/**
 * One table's operations, each written against its own delegate so the
 * types hold. `seed` creates the row for a tenant through the login role and
 * returns its id; `createIn` is what tenant B tries to insert into tenant A.
 */
interface TableCase {
    model: string;
    seed: (prisma: PrismaClient, tenantId: string, userId: string, f: Fixture) => Promise<string>;
    findById: (db: Db, id: string) => Promise<unknown>;
    listIds: (db: Db) => Promise<Array<{ id: string; tenantId: string }>>;
    countIn: (db: Db, tenantId: string) => Promise<number>;
    updateManyIn: (db: Db, tenantId: string) => Promise<{ count: number }>;
    deleteManyIn: (db: Db, tenantId: string) => Promise<{ count: number }>;
    createIn: (db: Db, tenantId: string, f: Fixture) => Promise<unknown>;
    snapshot: (prisma: PrismaClient, tenantId: string) => Promise<unknown>;
}

const CASES: readonly TableCase[] = [
    {
        model: 'UserMfaEnrollment',
        seed: async (prisma, tenantId, userId) =>
            (await prisma.userMfaEnrollment.create({ data: { tenantId, userId, secretEncrypted: 'enc:seed' } })).id,
        findById: (db, id) => db.userMfaEnrollment.findUnique({ where: { id } }),
        listIds: (db) => db.userMfaEnrollment.findMany({ select: { id: true, tenantId: true } }),
        countIn: (db, tenantId) => db.userMfaEnrollment.count({ where: { tenantId } }),
        updateManyIn: (db, tenantId) => db.userMfaEnrollment.updateMany({ where: { tenantId }, data: { isVerified: true } }),
        deleteManyIn: (db, tenantId) => db.userMfaEnrollment.deleteMany({ where: { tenantId } }),
        createIn: (db, tenantId, f) =>
            db.userMfaEnrollment.create({ data: { tenantId, userId: f.userB, secretEncrypted: 'enc:planted' } }),
        snapshot: (prisma, tenantId) =>
            prisma.userMfaEnrollment.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    },
    {
        model: 'TenantSecuritySettings',
        seed: async (prisma, tenantId) =>
            (await prisma.tenantSecuritySettings.create({ data: { tenantId, maxConcurrentSessions: 3 } })).id,
        findById: (db, id) => db.tenantSecuritySettings.findUnique({ where: { id } }),
        listIds: (db) => db.tenantSecuritySettings.findMany({ select: { id: true, tenantId: true } }),
        countIn: (db, tenantId) => db.tenantSecuritySettings.count({ where: { tenantId } }),
        updateManyIn: (db, tenantId) =>
            db.tenantSecuritySettings.updateMany({ where: { tenantId }, data: { mfaFailClosed: true } }),
        deleteManyIn: (db, tenantId) => db.tenantSecuritySettings.deleteMany({ where: { tenantId } }),
        // A's row exists, so the unique key would refuse a plain insert anyway;
        // an upsert keyed on A is the write an attacker would actually try.
        createIn: (db, tenantId) =>
            db.tenantSecuritySettings.upsert({
                where: { tenantId },
                update: { mfaFailClosed: true },
                create: { tenantId, mfaFailClosed: true },
            }),
        snapshot: (prisma, tenantId) =>
            prisma.tenantSecuritySettings.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    },
    {
        model: 'TenantInvite',
        seed: async (prisma, tenantId, userId) =>
            (
                await prisma.tenantInvite.create({
                    data: {
                        tenantId,
                        email: `invitee-${tenantId}@example.com`,
                        role: 'MEMBER',
                        token: `tok-${tenantId}`,
                        invitedById: userId,
                        expiresAt: new Date(Date.now() + 86_400_000),
                    },
                })
            ).id,
        findById: (db, id) => db.tenantInvite.findUnique({ where: { id } }),
        listIds: (db) => db.tenantInvite.findMany({ select: { id: true, tenantId: true } }),
        countIn: (db, tenantId) => db.tenantInvite.count({ where: { tenantId } }),
        updateManyIn: (db, tenantId) =>
            db.tenantInvite.updateMany({ where: { tenantId }, data: { revokedAt: new Date() } }),
        deleteManyIn: (db, tenantId) => db.tenantInvite.deleteMany({ where: { tenantId } }),
        createIn: (db, tenantId, f) =>
            db.tenantInvite.create({
                data: {
                    tenantId,
                    email: `planted-${SUFFIX}@example.com`,
                    role: 'OWNER',
                    token: `planted-${SUFFIX}`,
                    invitedById: f.userB,
                    expiresAt: new Date(Date.now() + 86_400_000),
                },
            }),
        snapshot: (prisma, tenantId) => prisma.tenantInvite.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    },
    {
        model: 'TenantCustomRole',
        seed: async (prisma, tenantId) =>
            (
                await prisma.tenantCustomRole.create({
                    data: { tenantId, name: 'Reviewer', baseRole: 'VIEWER', grantsJson: {} },
                })
            ).id,
        findById: (db, id) => db.tenantCustomRole.findUnique({ where: { id } }),
        listIds: (db) => db.tenantCustomRole.findMany({ select: { id: true, tenantId: true } }),
        countIn: (db, tenantId) => db.tenantCustomRole.count({ where: { tenantId } }),
        updateManyIn: (db, tenantId) =>
            db.tenantCustomRole.updateMany({ where: { tenantId }, data: { baseRole: 'ADMIN' } }),
        deleteManyIn: (db, tenantId) => db.tenantCustomRole.deleteMany({ where: { tenantId } }),
        createIn: (db, tenantId) =>
            db.tenantCustomRole.create({ data: { tenantId, name: 'Planted', baseRole: 'ADMIN', grantsJson: {} } }),
        snapshot: (prisma, tenantId) =>
            prisma.tenantCustomRole.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    },
];

describeFn('auth tables — two-tenant isolation as app_user', () => {
    let prisma: PrismaClient;
    let f: Fixture;
    let ctxB: RequestContext;
    const ids: Record<string, { a: string; b: string }> = {};

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);

        const tenantA = (await prisma.tenant.create({ data: { name: 'A', slug: `a-${SUFFIX}` } })).id;
        const tenantB = (await prisma.tenant.create({ data: { name: 'B', slug: `b-${SUFFIX}` } })).id;
        const userA = (await prisma.user.create({ data: { email: `a-${SUFFIX}@example.com` } })).id;
        const userB = (await prisma.user.create({ data: { email: `b-${SUFFIX}@example.com` } })).id;
        await prisma.tenantMembership.create({ data: { tenantId: tenantA, userId: userA, role: 'OWNER' } });
        await prisma.tenantMembership.create({ data: { tenantId: tenantB, userId: userB, role: 'OWNER' } });
        f = { tenantA, tenantB, userA, userB };

        for (const c of CASES) {
            ids[c.model] = {
                a: await c.seed(prisma, tenantA, userA, f),
                b: await c.seed(prisma, tenantB, userB, f),
            };
        }

        ctxB = makeRequestContext('OWNER', { tenantId: tenantB, userId: userB, requestId: 'req-auth-iso' });
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    describe.each(CASES.map((c) => [c.model, c] as const))('%s', (_model, c) => {
        let before: unknown;
        beforeEach(async () => {
            before = await c.snapshot(prisma, f.tenantA);
            expect(before).toHaveLength(1);
        });
        afterEach(async () => {
            expect(await c.snapshot(prisma, f.tenantA)).toEqual(before);
        });

        it('read by A id returns nothing', async () => {
            expect(await runInTenantContext(ctxB, (db) => c.findById(db, ids[c.model].a))).toBeNull();
        });

        it('an unfiltered list returns only B rows, and a count of A is zero', async () => {
            const [rows, inA] = await runInTenantContext(ctxB, async (db) => [
                await c.listIds(db),
                await c.countIn(db, f.tenantA),
            ]);
            expect(rows).toEqual([{ id: ids[c.model].b, tenantId: f.tenantB }]);
            expect(inA).toBe(0);
        });

        it('updateMany and deleteMany over A change nothing', async () => {
            const [updated, deleted] = await runInTenantContext(ctxB, async (db) => [
                await c.updateManyIn(db, f.tenantA),
                await c.deleteManyIn(db, f.tenantA),
            ]);
            expect(updated.count).toBe(0);
            expect(deleted.count).toBe(0);
        });

        it('a write carrying A id is refused', async () => {
            await expect(runInTenantContext(ctxB, (db) => c.createIn(db, f.tenantA, f))).rejects.toThrow();
        });

        it('tenant B still reads its own row (the policy is not deny-all)', async () => {
            const own = await runInTenantContext(ctxB, (db) => c.findById(db, ids[c.model].b));
            expect(own).toMatchObject({ id: ids[c.model].b, tenantId: f.tenantB });
        });
    });
});
