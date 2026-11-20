/**
 * The daily digest and notification retention against a real Postgres
 * (sub-phase 2.7c; owner decisions 133 and 135).
 *
 * `notification-digest`:
 *   - one `NOTIFICATION_DIGEST` email per member with something DAILY, with
 *     their open items due soon (assigned or waiting on them) and the day's
 *     unread notifications of their daily kinds, deduplicated per address and
 *     day (a re-run mails nobody twice);
 *   - re-checked when it is built: a deleted workspace, a workspace with email
 *     off, an inactive member, a guest (no project visible), an archived
 *     project's or a deleted item, a closed item, a notification read, Done,
 *     older than a day, or about an item that is gone, and an intake
 *     notification to a member without `intake.view`, are all left out;
 *   - a member's own choices: email off for due dates drops the due section,
 *     an IMMEDIATE kind is never in the digest;
 *   - never a description: the item's description is not in the email.
 *
 * `notification-purge`: Done rows after 90 days, read rows after 180 (from
 * `readAt`, or `createdAt` for a row read before the column), unread kept,
 * one counts-only audit entry.
 *
 * Written fresh for Islestone.
 */
import type { PrismaClient } from '@prisma/client';

import { processNotificationDigest } from '@/app-layer/jobs/notification-digest';
import { processNotificationPurge } from '@/app-layer/jobs/notification-purge';
import { verifyAuditChain } from '@/lib/audit';
import { hashForLookup } from '@/lib/security/encryption';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { seedWorkItem, seedWorkWorld, type WorkWorld } from '../helpers/work-fixture';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `ndig${Date.now().toString(36)}`;
const NOW = new Date('2030-03-10T08:10:00Z');
const day = (offset: number) => new Date(Date.UTC(2030, 2, 10 + offset));
const HOUR = 3_600_000;

describeFn('notification digest and retention', () => {
    let prisma: PrismaClient;

    async function workspace(tag: string) {
        const tenant = await createTenantWithDek({ name: tag, slug: `${tag}-${TAG}` });
        return { id: tenant.id, slug: tenant.slug };
    }
    async function member(tenantId: string, label: string, role: 'MEMBER' | 'GUEST' | 'VIEWER' = 'MEMBER', status: 'ACTIVE' | 'DEACTIVATED' = 'ACTIVE') {
        const user = await prisma.user.create({ data: { email: `${label}-${TAG}@example.test`, name: label } });
        await prisma.tenantMembership.create({ data: { tenantId, userId: user.id, role, status } });
        return user.id;
    }
    const digestsTo = (label: string) =>
        prisma.notificationOutbox.findMany({ where: { type: 'NOTIFICATION_DIGEST', dedupeKey: { contains: hashForLookup(`${label}-${TAG}@example.test`) } } });

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    describe('notification-digest', () => {
        let one: { id: string; slug: string };
        let world: WorkWorld;
        let archived: WorkWorld;
        let ann = '';
        let ben = '';
        const items: Record<string, string> = {};

        beforeAll(async () => {
            one = await workspace('one');
            ann = await member(one.id, 'ann');
            ben = await member(one.id, 'ben');
            const guest = await member(one.id, 'gus', 'GUEST');
            const viewer = await member(one.id, 'val', 'VIEWER');
            const gone = await member(one.id, 'dee', 'MEMBER', 'DEACTIVATED');
            world = await seedWorkWorld(prisma, one.id, { keyPrefix: 'ONE' });
            archived = await seedWorkWorld(prisma, one.id, { keyPrefix: 'ARC', teamName: 'Team ARC' });
            await prisma.project.update({ where: { id: archived.projectId }, data: { archivedAt: NOW } });

            const seed = async (key: string, w: WorkWorld, data: Partial<Parameters<typeof seedWorkItem>[3]>) => {
                const row = await seedWorkItem(prisma, one.id, w, { title: key, createdByUserId: ann, sortKey: 'V', ...data });
                items[key] = row.id;
                return row;
            };
            await seed('Ann overdue', world, { assigneeId: ann, dueDate: day(-2) });
            await seed('Ann today', world, { assigneeId: ann, dueDate: day(0) });
            await seed('Ann in three days', world, { assigneeId: ann, dueDate: day(3) });
            await seed('Ann in a month', world, { assigneeId: ann, dueDate: day(30) });
            await seed('Ann closed', world, { assigneeId: ann, dueDate: day(0), stateName: 'Done' });
            await seed('Ann archived project', archived, { assigneeId: ann, dueDate: day(0) });
            const deleted = await seed('Ann deleted', world, { assigneeId: ann, dueDate: day(0) });
            await prisma.workItem.update({ where: { id: deleted.id }, data: { deletedAt: NOW } });
            await seed('Waiting on Ann', world, { assigneeId: ben, waitingOnUserId: ann, dueDate: day(1) });
            await seed('Guest item', world, { assigneeId: guest, dueDate: day(0) });
            await seed('Inactive item', world, { assigneeId: gone, dueDate: day(0) });
            await prisma.workItem.update({ where: { id: items['Ann today']! }, data: { description: 'SECRET-DESCRIPTION-TEXT' } });

            const bell = (userId: string, title: string, extra: Record<string, unknown> = {}) =>
                prisma.notification.create({
                    data: { tenantId: one.id, userId, type: 'WORK_ITEM_WATCH_UPDATE', title, body: `${title} body`, workItemId: items['Ann today'], createdAt: new Date(NOW.getTime() - HOUR), ...extra },
                });
            await bell(ann, 'Watch fresh');
            await bell(ann, 'Watch read', { read: true, readAt: NOW });
            await bell(ann, 'Watch done', { archivedAt: NOW });
            await bell(ann, 'Watch old', { createdAt: new Date(NOW.getTime() - 30 * HOUR) });
            await bell(ann, 'Watch archived item', { workItemId: items['Ann archived project'] });
            await bell(ann, 'Watch no item', { workItemId: null });
            await bell(ann, 'Assigned is immediate', { type: 'WORK_ITEM_ASSIGNED' });
            await bell(ann, 'Due bell', { type: 'WORK_ITEM_DUE' });
            // Intake: Ann (a Member, `intake.view`) and Val (a Viewer: no `intake.view`) chose daily.
            await bell(ann, 'Intake for Ann', { type: 'INTAKE_REQUEST_RECEIVED', workItemId: null });
            await bell(viewer, 'Intake for Val', { type: 'INTAKE_REQUEST_RECEIVED', workItemId: null });
            await prisma.notificationPreference.createMany({
                data: [
                    { tenantId: one.id, userId: ann, type: 'INTAKE_REQUEST_RECEIVED', inApp: true, emailDelivery: 'DAILY' },
                    { tenantId: one.id, userId: viewer, type: 'INTAKE_REQUEST_RECEIVED', inApp: true, emailDelivery: 'DAILY' },
                    // Ben wants no due-date email: his waiting-on item's assignee copy is not mailed.
                    { tenantId: one.id, userId: ben, type: 'WORK_ITEM_DUE', inApp: true, emailDelivery: 'OFF' },
                ],
            });

            // A deleted workspace, and one with email off: their members are never mailed.
            const removed = await workspace('removed');
            const rUser = await member(removed.id, 'rex');
            const rWorld = await seedWorkWorld(prisma, removed.id, { keyPrefix: 'REM' });
            await seedWorkItem(prisma, removed.id, rWorld, { title: 'Removed workspace item', createdByUserId: rUser, sortKey: 'V', assigneeId: rUser, dueDate: day(0) });
            await prisma.tenant.update({ where: { id: removed.id }, data: { deletedAt: NOW } });
            const quiet = await workspace('quiet');
            const qUser = await member(quiet.id, 'quinn');
            const qWorld = await seedWorkWorld(prisma, quiet.id, { keyPrefix: 'QUI' });
            await seedWorkItem(prisma, quiet.id, qWorld, { title: 'Quiet item', createdByUserId: qUser, sortKey: 'V', assigneeId: qUser, dueDate: day(0) });
            await prisma.tenantNotificationSettings.create({ data: { tenantId: quiet.id, defaultFromEmail: 'noreply@example.test', enabled: false } });
        });

        it("mails Ann one digest with her due items and the day's notifications she receives daily, and nothing else", async () => {
            const result = await processNotificationDigest({ now: NOW, tz: 'UTC' });
            expect(result.failedTenants).toBe(0);

            const [digest, ...more] = await digestsTo('ann');
            expect(more).toEqual([]);
            const text = digest!.bodyText;
            for (const present of ['[ONE-1] Ann overdue', '[ONE-2] Ann today', '[ONE-3] Ann in three days', 'Waiting on Ann — due 2030-03-11 (waiting on you)', 'Watch fresh', 'Intake for Ann']) {
                expect(text).toContain(present);
            }
            for (const absent of [
                'Ann in a month',
                'Ann closed',
                'Ann archived project',
                'Ann deleted',
                'Watch read',
                'Watch done',
                'Watch old',
                'Watch archived item',
                'Watch no item',
                'Assigned is immediate',
                'Due bell',
                'SECRET-DESCRIPTION-TEXT',
            ]) {
                expect(text).not.toContain(absent);
            }
            expect(digest!.bodyHtml).not.toContain('SECRET-DESCRIPTION-TEXT');
            expect(digest!.subject).toBe('Your daily digest: 4 work items due, 2 notifications');
        });

        it('mails nobody else: a guest, an inactive member, a viewer whose only daily kind is intake, a member who turned due email off, a deleted or quiet workspace', async () => {
            for (const label of ['gus', 'dee', 'val', 'ben', 'rex', 'quinn']) {
                expect(await digestsTo(label)).toEqual([]);
            }
            expect(await prisma.notificationOutbox.count({ where: { type: 'NOTIFICATION_DIGEST' } })).toBe(1);
        });

        it('a second run the same day mails nobody twice', async () => {
            await processNotificationDigest({ now: new Date(NOW.getTime() + HOUR), tz: 'UTC' });
            expect(await prisma.notificationOutbox.count({ where: { type: 'NOTIFICATION_DIGEST' } })).toBe(1);
        });
    });

    describe('notification-purge', () => {
        it('deletes Done rows after 90 days and read rows after 180, keeps unread, and audits counts only', async () => {
            const ws = await workspace('purge');
            const user = await member(ws.id, 'pia');
            const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
            const row = (title: string, data: Record<string, unknown>) =>
                prisma.notification.create({ data: { tenantId: ws.id, userId: user, title, body: 'b', createdAt: daysAgo(400), ...data } });
            await row('done old', { read: true, archivedAt: daysAgo(91) });
            await row('done recent', { read: true, archivedAt: daysAgo(89) });
            await row('read old', { read: true, readAt: daysAgo(181) });
            await row('read recent', { read: true, readAt: daysAgo(179) });
            await row('read before readAt existed', { read: true, readAt: null });
            await row('read before readAt existed, new', { read: true, readAt: null, createdAt: daysAgo(10) });
            await row('unread ancient', { read: false });

            const r = await processNotificationPurge({ now: NOW, tenantId: ws.id });
            expect(r).toMatchObject({ tenants: 1, purged: 3, failedTenants: 0 });
            const left = (await prisma.notification.findMany({ where: { tenantId: ws.id } })).map((n) => n.title).sort();
            expect(left).toEqual(['done recent', 'read before readAt existed, new', 'read recent', 'unread ancient']);

            const audit = await prisma.auditLog.findMany({ where: { tenantId: ws.id, action: 'NOTIFICATIONS_PURGED' } });
            expect(audit).toHaveLength(1);
            expect(audit[0]!.detailsJson).toMatchObject({ category: 'data_lifecycle', recordCount: 3, model: 'Notification' });
            expect(JSON.stringify(audit[0]!.detailsJson)).not.toContain('read old');
            expect((await verifyAuditChain(ws.id)).valid).toBe(true);

            expect((await processNotificationPurge({ now: NOW, tenantId: ws.id })).purged).toBe(0);
        });
    });
});
