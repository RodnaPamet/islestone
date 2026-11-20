/**
 * The three work-item jobs against a real Postgres (sub-phase 2.2):
 *
 *   - `work-item-due-notification`: the 7/1/0-day windows on date-only due
 *     dates, idempotence, and the skips (closed, unassigned, archived or
 *     deleted project, deleted item, deleted workspace), across workspaces,
 *     each scanned inside its own context;
 *   - `work-item-purge`: items and projects past the window are hard-deleted,
 *     younger ones stay, the audit entry carries counts only, and the key
 *     bookkeeping survives;
 *   - `work-item-sortkey-rebalance`: long keys are rewritten short, order kept.
 *
 * Written for Islestone in the pattern of inflect-compliance's
 * `tests/integration/task-due-notification.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 */
import type { PrismaClient } from '@prisma/client';

import { processWorkItemDueNotifications } from '@/app-layer/jobs/work-item-due-notification';
import { processWorkItemPurge } from '@/app-layer/jobs/work-item-purge';
import { processSortKeyRebalance } from '@/app-layer/jobs/work-item-sortkey-rebalance';
import { SORT_KEY_REBALANCE_LENGTH } from '@/app-layer/domain/fractional-index';
import { verifyAuditChain } from '@/lib/audit';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { seedWorkItem, seedWorkWorld, type WorkWorld } from '../helpers/work-fixture';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `wij${Date.now().toString(36)}`;
const NOW = new Date('2030-03-10T09:00:00Z');
const day = (offset: number) => new Date(Date.UTC(2030, 2, 10 + offset));

describeFn('work-item jobs', () => {
    let prisma: PrismaClient;
    const tenants: Array<{ id: string; userId: string; world: WorkWorld }> = [];

    async function workspace(tag: string, prefix: string) {
        const tenant = await createTenantWithDek({ name: tag, slug: `${tag}-${TAG}` });
        const user = await prisma.user.create({ data: { email: `${tag}-${TAG}@example.test` } });
        await prisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id, role: 'MEMBER' } });
        const world = await seedWorkWorld(prisma, tenant.id, { keyPrefix: prefix });
        return { id: tenant.id, userId: user.id, world };
    }

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenants.push(await workspace('one', 'ONE'), await workspace('two', 'TWO'));
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    describe('due reminders', () => {
        it('reminds on the 7, 1 and 0-day windows only, in every live workspace, once', async () => {
            const [one, two] = tenants;
            const seed = (t: typeof one, title: string, due: Date, extra: Parameters<typeof seedWorkItem>[3] extends infer X ? Partial<X> : never = {}) =>
                seedWorkItem(prisma, t!.id, t!.world, { title, createdByUserId: t!.userId, sortKey: 'V', assigneeId: t!.userId, dueDate: due, ...extra });
            const due0 = await seed(one, 'today', day(0));
            const due1 = await seed(one, 'tomorrow', day(1));
            const due7 = await seed(one, 'next week', day(7));
            await seed(one, 'in three days', day(3));
            await seed(one, 'closed', day(0), { stateName: 'Done' });
            await seed(one, 'unassigned', day(0), { assigneeId: null });
            const deleted = await seed(one, 'deleted', day(0));
            await prisma.workItem.update({ where: { id: deleted.id }, data: { deletedAt: NOW } });
            const other = await seed(two, 'other workspace', day(1));

            const first = await processWorkItemDueNotifications({ now: NOW, tz: 'UTC' });
            expect(first.notificationsCreated).toBe(4);
            const rows = await prisma.notification.findMany({ where: { type: 'WORK_ITEM_DUE' }, orderBy: { title: 'asc' } });
            expect(rows.map((r) => r.linkUrl).sort()).toEqual(
                [
                    `/t/one-${TAG}/work-items/${due0.id}`,
                    `/t/one-${TAG}/work-items/${due1.id}`,
                    `/t/one-${TAG}/work-items/${due7.id}`,
                    `/t/two-${TAG}/work-items/${other.id}`,
                ].sort(),
            );
            expect(rows.find((r) => r.linkUrl?.endsWith(due0.id))?.body).toBe('ONE-1 "today" is due today.');
            const again = await processWorkItemDueNotifications({ now: NOW, tz: 'UTC' });
            expect(again.notificationsCreated).toBe(0);
        });

        it('counts the due day without a time-zone shift west of UTC (date-only column)', async () => {
            const [one] = tenants;
            await prisma.notification.deleteMany({ where: { type: 'WORK_ITEM_DUE' } });
            // 2030-03-10 09:00 UTC is 05:00 in New York: "today" there is the 10th too.
            const item = await seedWorkItem(prisma, one!.id, one!.world, {
                title: 'ny', createdByUserId: one!.userId, sortKey: 'W', assigneeId: one!.userId, dueDate: day(1),
            });
            await processWorkItemDueNotifications({ now: NOW, tz: 'America/New_York', tenantId: one!.id });
            const row = await prisma.notification.findFirst({ where: { type: 'WORK_ITEM_DUE', linkUrl: { endsWith: item.id } } });
            expect(row?.title).toBe('Work item due tomorrow');
        });

        it('reminds the person an item waits on, unassigned items included, once per person, never an inactive member (decision 137)', async () => {
            const four = await workspace('four', 'FOU');
            const make = async (email: string, status: 'ACTIVE' | 'DEACTIVATED' = 'ACTIVE') => {
                const u = await prisma.user.create({ data: { email: `${email}-${TAG}@example.test` } });
                await prisma.tenantMembership.create({ data: { tenantId: four.id, userId: u.id, role: 'MEMBER', status } });
                return u.id;
            };
            const bea = await make('bea');
            const departed = await make('departed', 'DEACTIVATED');
            const seed = (title: string, sortKey: string, assigneeId: string | null, waitingOnUserId: string | null) =>
                seedWorkItem(prisma, four.id, four.world, { title, createdByUserId: four.userId, sortKey, assigneeId, waitingOnUserId, dueDate: day(1) });
            const both = await seed('both', 'B', four.userId, bea);
            const unassigned = await seed('unassigned', 'C', null, bea);
            const same = await seed('same person', 'D', four.userId, four.userId);
            const inactiveWaiting = await seed('waits on a departed member', 'E', four.userId, departed);
            const nobody = await seed('nobody active', 'F', null, departed);

            const r = await processWorkItemDueNotifications({ now: NOW, tz: 'UTC', tenantId: four.id });
            expect(r.notificationsCreated).toBe(5);
            const rows = await prisma.notification.findMany({ where: { tenantId: four.id, type: 'WORK_ITEM_DUE' } });
            const forItem = (id: string) => rows.filter((n) => n.linkUrl?.endsWith(id)).map((n) => n.userId).sort();
            expect(forItem(both.id)).toEqual([four.userId, bea].sort());
            expect(forItem(unassigned.id)).toEqual([bea]);
            expect(forItem(same.id)).toEqual([four.userId]);
            expect(forItem(inactiveWaiting.id)).toEqual([four.userId]);
            expect(forItem(nobody.id)).toEqual([]);
            const toBea = rows.find((n) => n.userId === bea && n.linkUrl?.endsWith(unassigned.id));
            expect(toBea).toMatchObject({ title: 'Waiting on you: due tomorrow', body: `FOU-${unassigned.number} "unassigned" is waiting on you and is due tomorrow.` });
            expect(rows.find((n) => n.userId === four.userId && n.linkUrl?.endsWith(same.id))?.title).toBe('Work item due tomorrow');
            expect(rows.every((n) => n.userId !== departed)).toBe(true);
            // A re-run on the same day adds nothing.
            expect((await processWorkItemDueNotifications({ now: NOW, tz: 'UTC', tenantId: four.id })).notificationsCreated).toBe(0);
        });

        it('skips archived and deleted projects and deleted workspaces', async () => {
            const three = await workspace('three', 'THR');
            const archived = await seedWorkItem(prisma, three.id, three.world, {
                title: 'archived', createdByUserId: three.userId, sortKey: 'V', assigneeId: three.userId, dueDate: day(0),
            });
            await prisma.project.update({ where: { id: three.world.projectId }, data: { archivedAt: new Date() } });
            await processWorkItemDueNotifications({ now: NOW, tz: 'UTC', tenantId: three.id });
            await prisma.project.update({ where: { id: three.world.projectId }, data: { archivedAt: null, deletedAt: new Date() } });
            await processWorkItemDueNotifications({ now: NOW, tz: 'UTC', tenantId: three.id });
            await prisma.project.update({ where: { id: three.world.projectId }, data: { deletedAt: null } });
            await prisma.tenant.update({ where: { id: three.id }, data: { deletedAt: new Date() } });
            const r = await processWorkItemDueNotifications({ now: NOW, tz: 'UTC', tenantId: three.id });
            expect(r.tenantsScanned).toBe(0);
            expect(await prisma.notification.count({ where: { linkUrl: { endsWith: archived.id } } })).toBe(0);
        });
    });

    describe('purge', () => {
        it('hard-deletes items and projects past the window, keeps younger ones and the key bookkeeping, audits counts only', async () => {
            const [one] = tenants;
            const old = new Date(NOW.getTime() - 31 * 86_400_000);
            const young = new Date(NOW.getTime() - 5 * 86_400_000);
            const parent = await seedWorkItem(prisma, one!.id, one!.world, { title: 'old parent', createdByUserId: one!.userId, sortKey: 'X' });
            const child = await seedWorkItem(prisma, one!.id, one!.world, { title: 'old child', createdByUserId: one!.userId, sortKey: 'Y', parentId: parent.id });
            await prisma.comment.create({ data: { tenantId: one!.id, workItemId: child.id, authorUserId: one!.userId, body: 'gone with it' } });
            await prisma.workItem.updateMany({ where: { id: { in: [parent.id, child.id] } }, data: { deletedAt: old, deletionId: 'old' } });
            const keep = await seedWorkItem(prisma, one!.id, one!.world, { title: 'young', createdByUserId: one!.userId, sortKey: 'Z' });
            await prisma.workItem.update({ where: { id: keep.id }, data: { deletedAt: young, deletionId: 'young' } });
            await prisma.workItemKeyAlias.create({ data: { tenantId: one!.id, projectId: one!.world.projectId, number: 4242, workItemId: parent.id } });

            const gone = await workspace('gone', 'GON');
            await seedWorkItem(prisma, gone.id, gone.world, { title: 'in a deleted project', createdByUserId: gone.userId, sortKey: 'V' });
            await prisma.project.update({ where: { id: gone.world.projectId }, data: { deletedAt: old } });

            const result = await processWorkItemPurge({ now: NOW, windowDays: 30 });
            expect(result).toMatchObject({ items: 3, projects: 1 });
            expect(await prisma.workItem.count({ where: { id: { in: [parent.id, child.id] } } })).toBe(0);
            expect(await prisma.comment.count({ where: { workItemId: child.id } })).toBe(0);
            expect(await prisma.workItem.count({ where: { id: keep.id } })).toBe(1);
            expect(await prisma.project.count({ where: { id: gone.world.projectId } })).toBe(0);
            // Never pruned: prefixes, sequences and aliases.
            expect(await prisma.projectKeyPrefix.count({ where: { projectId: gone.world.projectId } })).toBe(1);
            expect(await prisma.projectKeySequence.count({ where: { projectId: gone.world.projectId } })).toBe(1);
            expect(await prisma.workItemKeyAlias.count({ where: { workItemId: parent.id } })).toBe(1);

            const audit = await prisma.auditLog.findFirst({ where: { tenantId: one!.id, action: 'WORK_ITEM_PURGED' } });
            expect(audit?.metadataJson).toMatchObject({ items: 2, projects: 0, windowDays: 30 });
            expect(JSON.stringify(audit)).not.toContain('old parent');
            expect(JSON.stringify(audit)).not.toContain(parent.id);
            expect((await verifyAuditChain(one!.id)).valid).toBe(true);
        });
    });

    describe('sort-key rebalance', () => {
        it('rewrites a project whose keys passed the bound, keeping the order and the versions', async () => {
            const [, two] = tenants;
            const long = 'V'.repeat(SORT_KEY_REBALANCE_LENGTH + 5);
            const titles = ['r1', 'r2', 'r3'];
            for (const [i, title] of titles.entries()) {
                await seedWorkItem(prisma, two!.id, two!.world, { title, createdByUserId: two!.userId, sortKey: `${long}${i + 1}` });
            }
            const r = await processSortKeyRebalance({ tenantId: two!.id });
            expect(r.projects).toBe(1);
            const rows = await prisma.workItem.findMany({
                where: { projectId: two!.world.projectId, deletedAt: null },
                select: { title: true, sortKey: true, version: true },
            });
            expect(rows.every((x) => x.sortKey.length <= 3 && x.version === 1)).toBe(true);
            const ordered = [...rows].sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1)).map((x) => x.title);
            expect(ordered.filter((t) => titles.includes(t))).toEqual(titles);
        });
    });
});
