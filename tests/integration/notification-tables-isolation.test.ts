/**
 * Two-tenant isolation for the tenant tables sub-phase 1.6 adds:
 * `Notification`, `NotificationOutbox` and `TenantNotificationSettings`
 * (roadmap section 4: every tenant table gets a two-tenant test).
 *
 * Every operation runs through `runInTenantContext` as tenant B, i.e. as
 * `app_user` with `app.tenant_id` = B, and none of them may read, count,
 * change or remove tenant A's rows, or create one in A. Tenant A's rows are
 * re-read through the login role after each case, so a check cannot pass
 * because the row was never there, and B reaches its own row, so the policy
 * is not simply deny-all.
 *
 * `NotificationOutbox` and `TenantNotificationSettings` are stricter than RLS
 * alone: `app_user` holds no DELETE on them, so a delete is refused by
 * privilege before any policy is asked.
 *
 * Written from the pattern of `audit-tables-isolation.test.ts`; no code copied.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { runInTenantContext } from '@/lib/db/rls-middleware';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

const SUFFIX = `notifiso_${Date.now()}`;

describeFn('notification tables — two-tenant isolation as app_user', () => {
    let prisma: PrismaClient;
    let tenantA: string;
    let tenantB: string;
    let userA: string;
    let userB: string;
    let ctxB: RequestContext;
    const bell = { a: '', b: '' };
    const outbox = { a: '', b: '' };
    const settings = { a: '', b: '' };

    const seedBell = async (tenantId: string, userId: string) =>
        (await prisma.notification.create({ data: { tenantId, userId, title: 'T', body: 'B' } })).id;
    const seedOutbox = async (tenantId: string) =>
        (
            await prisma.notificationOutbox.create({
                data: {
                    tenantId,
                    type: 'WORK_ITEM_ASSIGNED',
                    toEmail: `to-${tenantId}@example.com`,
                    subject: 'S',
                    bodyText: 'B',
                    dedupeKey: `dk-${tenantId}`,
                },
            })
        ).id;
    const seedSettings = async (tenantId: string) =>
        (
            await prisma.tenantNotificationSettings.create({
                data: { tenantId, defaultFromEmail: 'noreply@example.com' },
            })
        ).id;

    const snapshotA = async () => ({
        bell: await prisma.notification.findMany({ where: { tenantId: tenantA }, orderBy: { id: 'asc' } }),
        outbox: await prisma.notificationOutbox.findMany({ where: { tenantId: tenantA }, orderBy: { id: 'asc' } }),
        settings: await prisma.tenantNotificationSettings.findMany({ where: { tenantId: tenantA } }),
    });

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantA = (await prisma.tenant.create({ data: { name: 'A', slug: `a-${SUFFIX}` } })).id;
        tenantB = (await prisma.tenant.create({ data: { name: 'B', slug: `b-${SUFFIX}` } })).id;
        userA = (await prisma.user.create({ data: { email: `a-${SUFFIX}@example.com` } })).id;
        userB = (await prisma.user.create({ data: { email: `b-${SUFFIX}@example.com` } })).id;
        bell.a = await seedBell(tenantA, userA);
        bell.b = await seedBell(tenantB, userB);
        outbox.a = await seedOutbox(tenantA);
        outbox.b = await seedOutbox(tenantB);
        settings.a = await seedSettings(tenantA);
        settings.b = await seedSettings(tenantB);
        ctxB = makeRequestContext('OWNER', { tenantId: tenantB, userId: userB, requestId: 'req-notif-iso' });
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    let before: Awaited<ReturnType<typeof snapshotA>>;
    beforeEach(async () => {
        before = await snapshotA();
        expect(before.bell).toHaveLength(1);
        expect(before.outbox).toHaveLength(1);
        expect(before.settings).toHaveLength(1);
    });
    afterEach(async () => {
        expect(await snapshotA()).toEqual(before);
    });

    describe('Notification', () => {
        it('read by A id returns nothing, an unfiltered list holds only B rows, a count of A is zero', async () => {
            const [one, rows, inA] = await runInTenantContext(ctxB, async (db) => [
                await db.notification.findUnique({ where: { id: bell.a } }),
                await db.notification.findMany({ select: { id: true, tenantId: true } }),
                await db.notification.count({ where: { tenantId: tenantA } }),
            ] as const);
            expect(one).toBeNull();
            expect(rows).toEqual([{ id: bell.b, tenantId: tenantB }]);
            expect(inA).toBe(0);
        });

        it('updateMany and deleteMany over A change nothing', async () => {
            const [updated, deleted] = await runInTenantContext(ctxB, async (db) => [
                await db.notification.updateMany({ where: { tenantId: tenantA }, data: { read: true } }),
                await db.notification.deleteMany({ where: { tenantId: tenantA } }),
            ]);
            expect(updated.count).toBe(0);
            expect(deleted.count).toBe(0);
        });

        it('an insert carrying A id is refused', async () => {
            await expect(
                runInTenantContext(ctxB, (db) =>
                    db.notification.create({ data: { tenantId: tenantA, userId: userA, title: 'P', body: 'P' } }),
                ),
            ).rejects.toThrow();
        });

        it('tenant B still reads its own row (the policy is not deny-all)', async () => {
            const own = await runInTenantContext(ctxB, (db) => db.notification.findUnique({ where: { id: bell.b } }));
            expect(own).toMatchObject({ id: bell.b, tenantId: tenantB });
        });
    });

    describe('NotificationOutbox', () => {
        it('read by A id returns nothing, an unfiltered list holds only B rows, a count of A is zero', async () => {
            const [one, rows, inA] = await runInTenantContext(ctxB, async (db) => [
                await db.notificationOutbox.findUnique({ where: { id: outbox.a } }),
                await db.notificationOutbox.findMany({ select: { id: true, tenantId: true } }),
                await db.notificationOutbox.count({ where: { tenantId: tenantA } }),
            ] as const);
            expect(one).toBeNull();
            expect(rows).toEqual([{ id: outbox.b, tenantId: tenantB }]);
            expect(inA).toBe(0);
        });

        it('updateMany over A changes nothing, and a delete is refused by privilege', async () => {
            const updated = await runInTenantContext(ctxB, (db) =>
                db.notificationOutbox.updateMany({ where: { tenantId: tenantA }, data: { status: 'FAILED' } }),
            );
            expect(updated.count).toBe(0);
            await expect(
                runInTenantContext(ctxB, (db) => db.notificationOutbox.deleteMany({ where: { tenantId: tenantB } })),
            ).rejects.toThrow(/permission denied/i);
        });

        it('an insert carrying A id is refused', async () => {
            await expect(
                runInTenantContext(ctxB, (db) =>
                    db.notificationOutbox.create({
                        data: {
                            tenantId: tenantA,
                            type: 'DUE_DIGEST',
                            toEmail: 'planted@example.com',
                            subject: 'P',
                            bodyText: 'P',
                            dedupeKey: `planted-${SUFFIX}`,
                        },
                    }),
                ),
            ).rejects.toThrow();
        });

        it('tenant B still reads its own row, recipient decrypted', async () => {
            const own = await runInTenantContext(ctxB, (db) =>
                db.notificationOutbox.findUnique({ where: { id: outbox.b } }),
            );
            expect(own).toMatchObject({ id: outbox.b, tenantId: tenantB, toEmail: `to-${tenantB}@example.com` });
        });

        it('stores the recipient as ciphertext (the PII extension encrypts it in place)', async () => {
            const [raw] = await prisma.$queryRaw<{ toEmail: string }[]>`
                SELECT "toEmail" FROM "NotificationOutbox" WHERE id = ${outbox.b}`;
            expect(raw?.toEmail).toBeDefined();
            expect(raw?.toEmail).not.toContain('@example.com');
        });
    });

    describe('TenantNotificationSettings', () => {
        it('read by A id returns nothing, an unfiltered list holds only B rows', async () => {
            const [one, rows] = await runInTenantContext(ctxB, async (db) => [
                await db.tenantNotificationSettings.findUnique({ where: { tenantId: tenantA } }),
                await db.tenantNotificationSettings.findMany({ select: { id: true, tenantId: true } }),
            ] as const);
            expect(one).toBeNull();
            expect(rows).toEqual([{ id: settings.b, tenantId: tenantB }]);
        });

        it('updateMany over A changes nothing, and a delete is refused by privilege', async () => {
            const updated = await runInTenantContext(ctxB, (db) =>
                db.tenantNotificationSettings.updateMany({ where: { tenantId: tenantA }, data: { enabled: false } }),
            );
            expect(updated.count).toBe(0);
            await expect(
                runInTenantContext(ctxB, (db) => db.tenantNotificationSettings.deleteMany({ where: { tenantId: tenantB } })),
            ).rejects.toThrow(/permission denied/i);
        });

        it('an upsert carrying A id is refused', async () => {
            await expect(
                runInTenantContext(ctxB, (db) =>
                    db.tenantNotificationSettings.create({
                        data: { tenantId: tenantA, defaultFromEmail: 'planted@example.com' },
                    }),
                ),
            ).rejects.toThrow();
        });

        it('tenant B still reads its own row (the policy is not deny-all)', async () => {
            const own = await runInTenantContext(ctxB, (db) =>
                db.tenantNotificationSettings.findUnique({ where: { tenantId: tenantB } }),
            );
            expect(own).toMatchObject({ id: settings.b, tenantId: tenantB, defaultFromName: 'Islestone' });
        });
    });
});
