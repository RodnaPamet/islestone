/**
 * Notification preferences against a real Postgres (sub-phase 2.7c; owner
 * decision 132):
 *
 *   - `NotificationPreference` is a tenant table: as `app_user` in workspace
 *     B, nothing of workspace A's is read, counted, changed, removed or
 *     created, while B reaches its own row (the two-tenant test
 *     `tests/guards/tenant-isolation-forward-lock.test.ts` names);
 *   - the CHECK refuses IMMEDIATE email for a type that does not offer it,
 *     and a removed membership takes its preferences with it;
 *   - the usecases: defaults filled, a change stored and audited, a reset,
 *     the refusals, and the workspace's ceiling shown;
 *   - the bell writers ask each member's preference in the one seam
 *     (`isInAppTypeEnabled`): a member who switched a type off gets no row;
 *   - the immediate emails (assigned, and waiting on, new in 2.7c) are sent
 *     only while the member's choice, under the workspace's switch, is
 *     IMMEDIATE.
 *
 * Written fresh for Islestone.
 */
import type { PrismaClient } from '@prisma/client';

import { createWatcherNotifications } from '@/app-layer/notifications/watcher';
import { emitWaitingOnBell, enqueueAssignedEmail } from '@/app-layer/usecases/work-item-shared';
import { getMyNotificationPreferences, updateMyNotificationPreferences } from '@/app-layer/usecases/notification-preferences';
import type { RequestContext } from '@/app-layer/types';
import { verifyAuditChain } from '@/lib/audit';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';
import { seedWorkItem, seedWorkWorld } from '../helpers/work-fixture';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `npref${Date.now().toString(36)}`;

describeFn('notification preferences', () => {
    let prisma: PrismaClient;
    let tenantA: string;
    let tenantB: string;
    let userA: string;
    let userB: string;
    let ctxA: RequestContext;
    let ctxB: RequestContext;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantA = (await createTenantWithDek({ name: 'A', slug: `a-${TAG}` })).id;
        tenantB = (await createTenantWithDek({ name: 'B', slug: `b-${TAG}` })).id;
        userA = (await prisma.user.create({ data: { email: `a-${TAG}@example.test`, name: 'Ann' } })).id;
        userB = (await prisma.user.create({ data: { email: `b-${TAG}@example.test`, name: 'Ben' } })).id;
        await prisma.tenantMembership.createMany({
            data: [
                { tenantId: tenantA, userId: userA, role: 'MEMBER', status: 'ACTIVE' },
                { tenantId: tenantA, userId: userB, role: 'MEMBER', status: 'ACTIVE' },
                { tenantId: tenantB, userId: userB, role: 'MEMBER', status: 'ACTIVE' },
            ],
        });
        ctxA = makeRequestContext('MEMBER', { tenantId: tenantA, userId: userA, tenantSlug: `a-${TAG}` });
        ctxB = makeRequestContext('MEMBER', { tenantId: tenantB, userId: userB, tenantSlug: `b-${TAG}` });
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    describe('two-tenant isolation as app_user', () => {
        beforeAll(async () => {
            await prisma.notificationPreference.deleteMany({});
            await prisma.notificationPreference.createMany({
                data: [
                    { tenantId: tenantA, userId: userA, type: 'WORK_ITEM_DUE', inApp: false, emailDelivery: 'DAILY' },
                    { tenantId: tenantB, userId: userB, type: 'WORK_ITEM_DUE', inApp: true, emailDelivery: 'OFF' },
                ],
            });
        });

        const snapshotA = () => prisma.notificationPreference.findMany({ where: { tenantId: tenantA }, orderBy: { userId: 'asc' } });

        it('B reads, counts and reaches only its own rows', async () => {
            const seen = await runInTenantContext(ctxB, (db) => db.notificationPreference.findMany({}));
            expect(seen.map((r) => r.tenantId)).toEqual([tenantB]);
            expect(await runInTenantContext(ctxB, (db) => db.notificationPreference.count({ where: { tenantId: tenantA } }))).toBe(0);
        });

        it("B changes and removes none of A's rows", async () => {
            const before = await snapshotA();
            const updated = await runInTenantContext(ctxB, (db) => db.notificationPreference.updateMany({ where: { tenantId: tenantA }, data: { inApp: true } }));
            const deleted = await runInTenantContext(ctxB, (db) => db.notificationPreference.deleteMany({ where: { tenantId: tenantA } }));
            expect([updated.count, deleted.count]).toEqual([0, 0]);
            expect(await snapshotA()).toEqual(before);
            expect(before).toHaveLength(1);
        });

        it('B cannot create a row in A', async () => {
            await expect(
                runInTenantContext(ctxB, (db) =>
                    db.notificationPreference.create({ data: { tenantId: tenantA, userId: userB, type: 'WORK_ITEM_ASSIGNED', inApp: false, emailDelivery: 'OFF' } }),
                ),
            ).rejects.toThrow();
        });
    });

    describe('the table holds its own rules', () => {
        it('refuses IMMEDIATE email for a type that does not offer it', async () => {
            await expect(
                prisma.notificationPreference.create({ data: { tenantId: tenantA, userId: userB, type: 'WORK_ITEM_WATCH_UPDATE', inApp: true, emailDelivery: 'IMMEDIATE' } }),
            ).rejects.toThrow(/NotificationPreference_immediate_types/);
            await expect(
                prisma.notificationPreference.create({ data: { tenantId: tenantA, userId: userB, type: 'WORK_ITEM_WAITING_ON', inApp: true, emailDelivery: 'IMMEDIATE' } }),
            ).resolves.toBeDefined();
            // Mentions joined the list in 2.7d (migration 20261205120200_mentions).
            await expect(
                prisma.notificationPreference.create({ data: { tenantId: tenantA, userId: userB, type: 'WORK_ITEM_MENTIONED', inApp: true, emailDelivery: 'IMMEDIATE' } }),
            ).resolves.toBeDefined();
        });

        it("a removed membership takes the member's preferences with it", async () => {
            const tmp = (await prisma.user.create({ data: { email: `gone-${TAG}@example.test` } })).id;
            await prisma.tenantMembership.create({ data: { tenantId: tenantA, userId: tmp, role: 'MEMBER' } });
            await prisma.notificationPreference.create({ data: { tenantId: tenantA, userId: tmp, type: 'WORK_ITEM_DUE', inApp: false, emailDelivery: 'OFF' } });
            await prisma.tenantMembership.delete({ where: { tenantId_userId: { tenantId: tenantA, userId: tmp } } });
            expect(await prisma.notificationPreference.count({ where: { userId: tmp } })).toBe(0);
        });
    });

    describe('the usecases', () => {
        beforeEach(async () => {
            await prisma.notificationPreference.deleteMany({});
            await prisma.tenantNotificationSettings.deleteMany({});
        });

        it('fills the defaults: the bell on, email at once for the direct types, daily for due and watched, off for intake', async () => {
            const view = await getMyNotificationPreferences(ctxA);
            const byType = Object.fromEntries(view.rows.map((r) => [r.type, r]));
            expect(byType.WORK_ITEM_ASSIGNED).toMatchObject({ inApp: true, email: 'IMMEDIATE', isDefault: true });
            expect(byType.WORK_ITEM_WAITING_ON).toMatchObject({ email: 'IMMEDIATE' });
            expect(byType.WORK_ITEM_DUE).toMatchObject({ email: 'DAILY' });
            expect(byType.WORK_ITEM_WATCH_UPDATE).toMatchObject({ email: 'DAILY', emailChoices: ['OFF', 'DAILY'] });
            expect(byType.INTAKE_REQUEST_RECEIVED).toMatchObject({ email: 'OFF' });
            expect(byType.WORK_ITEM_ASSIGNED!.emailChoices).toEqual(['OFF', 'IMMEDIATE', 'DAILY']);
        });

        it('stores a change for the caller only, audits it, and resets it to the default', async () => {
            const after = await updateMyNotificationPreferences(ctxA, { rows: [{ type: 'WORK_ITEM_WATCH_UPDATE', inApp: false, email: 'OFF' }] });
            expect(after.rows.find((r) => r.type === 'WORK_ITEM_WATCH_UPDATE')).toMatchObject({ inApp: false, email: 'OFF', isDefault: false });
            expect(await prisma.notificationPreference.findMany({ where: { tenantId: tenantA } })).toEqual([
                expect.objectContaining({ userId: userA, type: 'WORK_ITEM_WATCH_UPDATE', inApp: false, emailDelivery: 'OFF' }),
            ]);
            const audit = await prisma.auditLog.findMany({ where: { tenantId: tenantA, action: 'NOTIFICATION_PREFERENCES_UPDATED' } });
            expect(audit).toHaveLength(1);
            expect(audit[0]!.detailsJson).toMatchObject({ changedFields: ['WORK_ITEM_WATCH_UPDATE'], after: { WORK_ITEM_WATCH_UPDATE: { inApp: false, email: 'OFF' } } });
            expect((await verifyAuditChain(tenantA)).valid).toBe(true);

            const reset = await updateMyNotificationPreferences(ctxA, { rows: [{ type: 'WORK_ITEM_WATCH_UPDATE', reset: true }] });
            expect(reset.rows.find((r) => r.type === 'WORK_ITEM_WATCH_UPDATE')).toMatchObject({ isDefault: true, email: 'DAILY' });
            expect(await prisma.notificationPreference.count({ where: { tenantId: tenantA } })).toBe(0);
        });

        it('refuses immediate email where it is not offered, and a daily digest of a kind with the bell off', async () => {
            await expect(updateMyNotificationPreferences(ctxA, { rows: [{ type: 'WORK_ITEM_DUE', inApp: true, email: 'IMMEDIATE' }] })).rejects.toMatchObject({
                status: 400,
            });
            await expect(updateMyNotificationPreferences(ctxA, { rows: [{ type: 'WORK_ITEM_WATCH_UPDATE', inApp: false, email: 'DAILY' }] })).rejects.toMatchObject({
                status: 400,
            });
            // Due dates are read from the items, so their digest works with the bell off.
            await expect(updateMyNotificationPreferences(ctxA, { rows: [{ type: 'WORK_ITEM_DUE', inApp: false, email: 'DAILY' }] })).resolves.toBeDefined();
            expect(await prisma.notificationPreference.count({ where: { tenantId: tenantA } })).toBe(1);
        });

        it("shows the workspace's ceiling over the member's choice", async () => {
            await prisma.tenantNotificationSettings.create({
                data: { tenantId: tenantA, defaultFromEmail: 'noreply@example.test', enabled: false, mutedInAppTypes: ['WORK_ITEM_WATCH_UPDATE'] },
            });
            const view = await getMyNotificationPreferences(ctxA);
            const watch = view.rows.find((r) => r.type === 'WORK_ITEM_WATCH_UPDATE')!;
            expect(watch).toMatchObject({ inApp: true, effectiveInApp: false, inAppCap: 'WORKSPACE_MUTED', effectiveEmail: 'OFF', emailCap: 'WORKSPACE_EMAIL_OFF' });
            expect(view.workspace).toEqual({ emailEnabled: false, mutedInAppTypes: ['WORK_ITEM_WATCH_UPDATE'] });
        });
    });

    describe('the bell writers ask each member in the one seam', () => {
        it('a watcher who switched watch updates off gets no row; the other watcher does, naming the item', async () => {
            await prisma.notificationPreference.deleteMany({});
            await prisma.tenantNotificationSettings.deleteMany({});
            await prisma.notificationPreference.create({ data: { tenantId: tenantA, userId: userB, type: 'WORK_ITEM_WATCH_UPDATE', inApp: false, emailDelivery: 'OFF' } });
            const world = await seedWorkWorld(prisma, tenantA, { keyPrefix: 'NPA' });
            const item = await seedWorkItem(prisma, tenantA, world, { title: 'Watched', createdByUserId: userA, sortKey: 'V' });
            const r = await runInTenantContext(ctxA, (db) =>
                createWatcherNotifications(db, [userA, userB], {
                    tenantId: tenantA,
                    workItemId: item.id,
                    workItemKey: 'NPA-1',
                    workItemTitle: 'Watched',
                    linkUrl: `/t/a-${TAG}/work-items/${item.id}`,
                    kind: 'commented',
                    discriminator: 'c1',
                    detail: 'commented',
                }),
            );
            expect(r.created).toBe(1);
            const rows = await prisma.notification.findMany({ where: { tenantId: tenantA, type: 'WORK_ITEM_WATCH_UPDATE' } });
            expect(rows.map((n) => [n.userId, n.workItemId])).toEqual([[userA, item.id]]);
        });
    });

    describe('the immediate emails follow the member\'s choice', () => {
        let itemId = '';

        beforeAll(async () => {
            const world = await seedWorkWorld(prisma, tenantA, { keyPrefix: 'NPM' });
            itemId = (await seedWorkItem(prisma, tenantA, world, { title: 'Mailed', createdByUserId: userA, sortKey: 'V' })).id;
        });

        beforeEach(async () => {
            await prisma.notificationPreference.deleteMany({});
            await prisma.tenantNotificationSettings.deleteMany({});
            await prisma.notificationOutbox.deleteMany({});
        });

        const outboxTypes = async () => (await prisma.notificationOutbox.findMany({ where: { tenantId: tenantA } })).map((o) => o.type).sort();

        it('assigned: mailed by default, not when the member chose daily or off, nor with the workspace switched off', async () => {
            const assign = () => runInTenantContext(ctxA, (db) => enqueueAssignedEmail(db, ctxA, userB, [{ id: itemId, title: 'Mailed', key: 'NPM-1', typeName: 'Feature' }]));
            await prisma.notificationPreference.create({ data: { tenantId: tenantA, userId: userB, type: 'WORK_ITEM_ASSIGNED', inApp: true, emailDelivery: 'DAILY' } });
            await assign();
            expect(await outboxTypes()).toEqual([]);
            await prisma.notificationPreference.deleteMany({});
            await prisma.tenantNotificationSettings.create({ data: { tenantId: tenantA, defaultFromEmail: 'noreply@example.test', enabled: false } });
            await assign();
            expect(await outboxTypes()).toEqual([]);
            await prisma.tenantNotificationSettings.deleteMany({});
            await assign();
            expect(await outboxTypes()).toEqual(['WORK_ITEM_ASSIGNED']);
        });

        it('waiting on: the bell and, by default, the email to the person named; neither when they turned both off', async () => {
            await emitWaitingOnBell(ctxA, userB, { id: itemId, title: 'Mailed', key: 'NPM-1' });
            expect(await outboxTypes()).toEqual(['WORK_ITEM_WAITING_ON']);
            const mail = (await prisma.notificationOutbox.findMany({ where: { tenantId: tenantA } }))[0]!;
            expect(mail.subject).toBe('Waiting on you: [NPM-1] Mailed');
            expect(mail.bodyText).toContain('Ann marked a work item as waiting on you:');

            await prisma.notificationOutbox.deleteMany({});
            await prisma.notification.deleteMany({ where: { type: 'WORK_ITEM_WAITING_ON' } });
            await prisma.notificationPreference.create({ data: { tenantId: tenantA, userId: userB, type: 'WORK_ITEM_WAITING_ON', inApp: false, emailDelivery: 'OFF' } });
            await emitWaitingOnBell(ctxA, userB, { id: itemId, title: 'Mailed', key: 'NPM-1' });
            expect(await outboxTypes()).toEqual([]);
            expect(await prisma.notification.count({ where: { type: 'WORK_ITEM_WAITING_ON' } })).toBe(0);
        });
    });
});
