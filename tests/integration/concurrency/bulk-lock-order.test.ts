/**
 * Multi-item writes under parallel writers (Hardening H2, part 2; owner
 * decision 173; issue #65). Every write that touches several work items
 * locks them in id order before it reads and plans from them
 * (`WorkItemRepository.lockForWrite`, `src/app-layer/repositories/work-item-locks.ts`).
 *
 * Two of these tests fail without the fix, deterministically:
 *
 *   - a bulk change over a subtree's sub-items in id order (as their reads
 *     return them) against a move of that subtree, which wrote its rows in
 *     sort order: the sub-items are created so their sort order is the
 *     reverse of their id order, so the two met in the middle and Postgres
 *     killed one with a deadlock (40P01);
 *   - a bulk state change read its items without a lock, so an item changed
 *     by another transaction between that read and the write was audited
 *     with the state it no longer had. The test holds one item's row from
 *     its own transaction, changes it while the bulk change waits, and
 *     compares the audit entry's "from" with the transition the database
 *     recorded.
 *
 * The rest hold the invariants the map names: no lost update against a
 * versioned single edit, and no item left assigned to a removed member.
 */
import type { PrismaClient } from '@prisma/client';

import { createProject } from '@/app-layer/usecases/project';
import { removeTenantMember } from '@/app-layer/usecases/tenant-admin';
import {
    bulkAssignWorkItems,
    bulkSetWorkItemDueDate,
    bulkSetWorkItemState,
    createWorkItem,
    updateWorkItem,
} from '@/app-layer/usecases/work-item';
import { moveWorkItemToProject } from '@/app-layer/usecases/work-item-moves';

import { prismaTestClient, resetDatabase } from '../../helpers/db';
import { createWorkItemWorkspace, isDeadlock, type WorkItemWorkspace } from '../../helpers/work-item-workspace';

import { DB_AVAILABLE } from '../db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `blkc${Date.now().toString(36)}`;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describeFn('concurrency: multi-item writes lock in id order', () => {
    let prisma: PrismaClient;
    let ws: WorkItemWorkspace;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        ws = await createWorkItemWorkspace(prisma, TAG);
    });

    afterAll(async () => {
        if (!process.env.KEEP_DB) await resetDatabase(prisma);
    });

    const item = (title: string, extra: Partial<Parameters<typeof createWorkItem>[1]> = {}) =>
        createWorkItem(ws.owner, { projectId: ws.projectId, typeId: ws.typeId, title, ...extra });

    it('a bulk change over sub-items and a move of their parent, overlapping: neither deadlocks, both apply', async () => {
        for (let round = 0; round < 3; round++) {
            const dest = await createProject(ws.owner, { teamId: ws.teamId, name: `Dest ${round}`, keyPrefix: `DST${round}` });
            const root = await item(`root ${round}`);
            // Each sub-item placed BEFORE the previous one: sort order is the
            // reverse of creation (and id) order.
            const subs: Array<{ id: string }> = [];
            for (let i = 0; i < 40; i++) {
                subs.push(await item(`sub ${round}-${i}`, { parentId: root.id, ...(subs.length ? { position: { beforeId: subs[subs.length - 1]!.id } } : {}) }));
            }
            const [bulk, move] = await Promise.allSettled([
                bulkSetWorkItemState(ws.owner, { workItemIds: subs.map((s) => s.id), stateId: ws.states['In progress']!.id }),
                moveWorkItemToProject(ws.owner, root.id, { projectId: dest.id }),
            ]);
            const failures = [bulk, move].filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason);
            expect(failures.filter(isDeadlock)).toEqual([]);
            expect(failures).toEqual([]);
            const rows = await prisma.workItem.findMany({ where: { id: { in: [root.id, ...subs.map((s) => s.id)] } }, select: { projectId: true, stateId: true, parentId: true } });
            expect(rows.every((r) => r.projectId === dest.id)).toBe(true);
            expect(rows.filter((r) => r.parentId === root.id).every((r) => r.stateId === ws.states['In progress']!.id)).toBe(true);
        }
    });

    it('a bulk state change audits the state each item really leaves, when another writer changed it meanwhile', async () => {
        const a = await item('stale-a');
        const b = await item('stale-b');
        const todo = ws.states['Todo']!.id;
        const started = ws.states['In progress']!.id;
        const done = ws.states['Done']!.id;
        expect((await prisma.workItem.findUniqueOrThrow({ where: { id: b.id } })).stateId).toBe(todo);

        let bulk: Promise<unknown> | undefined;
        // Another writer holds b's row, starts the bulk change, then moves b to
        // In progress and commits while the bulk change waits on it.
        await prisma.$transaction(
            async (tx) => {
                await tx.$queryRaw`SELECT "id" FROM "WorkItem" WHERE "id" = ${b.id} FOR UPDATE`;
                bulk = bulkSetWorkItemState(ws.owner, { workItemIds: [a.id, b.id], stateId: done });
                await pause(800);
                await tx.$executeRaw`UPDATE "WorkItem" SET "stateId" = ${started}, "stateCategory" = 'STARTED', "startedAt" = now() WHERE "id" = ${b.id}`;
            },
            { timeout: 20_000 },
        );
        await bulk;

        const entry = await prisma.auditLog.findFirstOrThrow({
            where: { tenantId: ws.tenantId, entityId: b.id, action: 'WORK_ITEM_STATE_CHANGED' },
            orderBy: { createdAt: 'desc' },
        });
        // The transitions the database recorded for b: Todo (create), In progress, Done.
        const transitions = await prisma.workItemTransition.findMany({ where: { workItemId: b.id }, orderBy: { at: 'asc' }, select: { stateId: true } });
        expect(transitions.map((t) => t.stateId)).toEqual([todo, started, done]);
        expect((entry.detailsJson as { fromStateId: string; toStateId: string }).fromStateId).toBe(started);
        expect((entry.detailsJson as { fromStateId: string; toStateId: string }).toStateId).toBe(done);
    });

    it('two overlapping bulk changes, half shared, sent in opposite orders: both apply, every write bumps each version once', async () => {
        const items: Array<{ id: string }> = [];
        for (let i = 0; i < 60; i++) items.push(await item(`overlap ${i}`));
        const first = items.slice(0, 40).map((i) => i.id);
        const second = items.slice(20).map((i) => i.id).reverse();
        const [s, d] = await Promise.allSettled([
            bulkSetWorkItemState(ws.owner, { workItemIds: first, stateId: ws.states['In review']!.id }),
            bulkSetWorkItemDueDate(ws.owner, { workItemIds: second, dueDate: '2027-01-15' }),
        ]);
        expect([s, d].filter((r) => r.status === 'rejected')).toEqual([]);
        const rows = await prisma.workItem.findMany({ where: { id: { in: items.map((i) => i.id) } }, select: { id: true, version: true, stateId: true, dueDate: true } });
        const inFirst = new Set(first);
        const inSecond = new Set(second);
        for (const r of rows) {
            expect(r.version).toBe(1 + (inFirst.has(r.id) ? 1 : 0) + (inSecond.has(r.id) ? 1 : 0));
            expect(r.stateId === ws.states['In review']!.id).toBe(inFirst.has(r.id));
            expect(r.dueDate?.toISOString().slice(0, 10) ?? null).toBe(inSecond.has(r.id) ? '2027-01-15' : null);
        }
    });

    it('a bulk change against a versioned single edit: never a lost update', async () => {
        for (let round = 0; round < 3; round++) {
            const items: Array<{ id: string; version: number }> = [];
            for (let i = 0; i < 20; i++) items.push(await item(`versioned ${round}-${i}`));
            const target = items[10]!;
            const [bulk, single] = await Promise.allSettled([
                bulkSetWorkItemDueDate(ws.owner, { workItemIds: items.map((i) => i.id), dueDate: '2027-02-01' }),
                updateWorkItem(ws.member, target.id, { title: `renamed ${round}` }, target.version),
            ]);
            expect(bulk.status === 'rejected' ? String(bulk.reason) : 'fulfilled').toBe('fulfilled');
            const row = await prisma.workItem.findUniqueOrThrow({ where: { id: target.id } });
            expect(row.dueDate?.toISOString().slice(0, 10)).toBe('2027-02-01');
            if (single.status === 'fulfilled') {
                // The single edit came first: both changes stand, two bumps.
                expect(row.title).toBe(`renamed ${round}`);
                expect(row.version).toBe(target.version + 2);
            } else {
                // The bulk change came first: the stale version is refused, nothing lost.
                expect(single.reason).toMatchObject({ status: 409 });
                expect(row.title).toBe(`versioned ${round}-10`);
                expect(row.version).toBe(target.version + 1);
            }
        }
    });

    it('a bulk assign against the member\'s removal: no item is left assigned to someone who is not a member', async () => {
        const user = await prisma.user.create({ data: { email: `leaver-${TAG}@example.test`, name: 'Lee Leaver' } });
        const membership = await prisma.tenantMembership.create({ data: { tenantId: ws.tenantId, userId: user.id, role: 'MEMBER' } });
        const items: Array<{ id: string }> = [];
        for (let i = 0; i < 30; i++) items.push(await item(`leaver ${i}`, i % 3 === 0 ? { assigneeId: user.id } : {}));
        const [assign, removal] = await Promise.allSettled([
            bulkAssignWorkItems(ws.owner, { workItemIds: items.map((i) => i.id), assigneeId: user.id }),
            removeTenantMember(ws.owner, { membershipId: membership.id }),
        ]);
        const failures = [assign, removal].filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason);
        expect(failures.filter(isDeadlock)).toEqual([]);
        // On failure this prints the reason.
        expect(removal.status === 'rejected' ? String(removal.reason) : 'fulfilled').toBe('fulfilled');
        expect(await prisma.tenantMembership.count({ where: { id: membership.id } })).toBe(0);
        expect(await prisma.workItem.count({ where: { tenantId: ws.tenantId, assigneeId: user.id } })).toBe(0);
    });
});
