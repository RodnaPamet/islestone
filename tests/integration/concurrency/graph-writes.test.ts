/**
 * Graph writes under a burst (Hardening H2, part 2; owner decision 254;
 * issue #70).
 *
 * Every write to `parentId` or a relation takes the workspace's graph lock
 * first in its transaction, so the database runs them one at a time per
 * workspace. Before decision 254 each waiter held a pooled connection while
 * it waited, and the writer holding the lock needed one more for its audit
 * append: a burst of about 25 graph writes in one workspace emptied the pool
 * and the transactions expired, as 25 creates did before decision 174.
 * Measured on 2026-11-26 before the queue: 20 of the 35 writers below failed.
 *
 * Now they wait in the process, per workspace, before they open a transaction
 * (`inWorkItemGraphQueue`, `WORK_ITEM_GRAPH_WRITES_PER_WORKSPACE`); a create
 * with a parent enters the graph queue, then its project's. The burst mixes
 * every kind of graph write (moves between projects, relation adds and
 * removes, re-parents, sub-item creates, the bulk reschedule) with plain
 * creates and reorders in the same project. Invariants are read from the
 * tables afterwards.
 */
import type { PrismaClient } from '@prisma/client';

import { createProject } from '@/app-layer/usecases/project';
import { queuedProjectCount } from '@/app-layer/usecases/project-sequence-queue';
import { createWorkItem, rescheduleWorkItems } from '@/app-layer/usecases/work-item';
import { queuedGraphWorkspaceCount } from '@/app-layer/usecases/work-item-graph-queue';
import { moveWorkItemToProject, reorderWorkItem, reparentWorkItem } from '@/app-layer/usecases/work-item-moves';
import { addWorkItemRelation, removeWorkItemRelation } from '@/app-layer/usecases/work-item-relations';
import { WORK_ITEM_GRAPH_WRITES_PER_WORKSPACE } from '@/lib/db/concurrency-limits';

import { prismaTestClient, resetDatabase } from '../../helpers/db';
import { roundNumbers } from '../../helpers/stress-scale';
import { createWorkItemWorkspace, isDeadlock, type WorkItemWorkspace } from '../../helpers/work-item-workspace';

import { DB_AVAILABLE } from '../db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `grph${Date.now().toString(36)}`;
const BASE_ROUNDS = 2;

describeFn('concurrency: graph writes under a burst', () => {
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

    const lastValue = async (projectId: string) => (await prisma.projectKeySequence.findUniqueOrThrow({ where: { projectId } })).lastValue;

    it('states the concurrency it proves', () => {
        expect(WORK_ITEM_GRAPH_WRITES_PER_WORKSPACE).toBe(1);
    });

    it.each(roundNumbers(BASE_ROUNDS))(
        'round %i: 27 graph writes of every kind at once in one workspace, with creates and reorders beside them, all succeed',
        async (round) => {
            const from = await createProject(ws.owner, { teamId: ws.teamId, name: `Graph from ${round}`, keyPrefix: `GF${round}` });
            const to = await createProject(ws.owner, { teamId: ws.teamId, name: `Graph to ${round}`, keyPrefix: `GT${round}` });
            const make = (projectId: string, title: string, extra: Partial<Parameters<typeof createWorkItem>[1]> = {}) =>
                createWorkItem(ws.owner, { projectId, typeId: ws.typeId, title, ...extra });

            // guardrail-allow: n+1 — the test's own setup, one row at a time.
            const roots = [];
            for (let i = 0; i < 8; i++) {
                const root = await make(from.id, `root ${i}`);
                await make(from.id, `root ${i} sub`, { parentId: root.id });
                roots.push(root);
            }
            const pairs = [];
            for (let i = 0; i < 10; i++) pairs.push([await make(to.id, `blocker ${i}`), await make(to.id, `blocked ${i}`)] as const);
            const toRemove = [];
            for (let i = 0; i < 2; i++) {
                const a = await make(to.id, `old blocker ${i}`);
                const b = await make(to.id, `old blocked ${i}`);
                toRemove.push({ from: a, relation: await addWorkItemRelation(ws.owner, a.id, { type: 'BLOCKS', toId: b.id }) });
            }
            const parent = await make(to.id, 'new parent');
            const children = [];
            for (let i = 0; i < 3; i++) children.push(await make(to.id, `to re-parent ${i}`));
            const holder = await make(to.id, 'sub-item holder');
            const solo = await make(to.id, 'rescheduled');
            const anchor = await make(to.id, 'anchor');
            const reordered = [];
            for (let i = 0; i < 3; i++) reordered.push(await make(to.id, `reordered ${i}`));
            const beforeTo = await lastValue(to.id);

            const graphWrites: Array<Promise<unknown>> = [
                ...roots.map((r) => moveWorkItemToProject(ws.owner, r.id, { projectId: to.id })),
                ...pairs.map(([a, b]) => addWorkItemRelation(ws.member, a.id, { type: 'BLOCKS', toId: b.id })),
                ...toRemove.map((r) => removeWorkItemRelation(ws.owner, r.from.id, r.relation.id)),
                ...children.map((c) => reparentWorkItem(ws.member, c.id, { parentId: parent.id })),
                ...Array.from({ length: 3 }, (_, i) => make(to.id, `new sub ${i}`, { parentId: holder.id })),
                rescheduleWorkItems(ws.owner, { dragged: { id: solo.id, version: solo.version, startDate: '2049-05-04', dueDate: '2049-05-06' }, pushed: [] }),
            ];
            expect(graphWrites).toHaveLength(27);
            const others: Array<Promise<unknown>> = [
                ...Array.from({ length: 5 }, (_, i) => createWorkItem(ws.member, { projectId: to.id, typeId: ws.typeId, title: `plain ${i}` })),
                ...reordered.map((r) => reorderWorkItem(ws.owner, r.id, { afterId: anchor.id })),
            ];
            const settled = await Promise.allSettled([...graphWrites, ...others]);
            const failures = settled.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason));
            expect(failures.filter(isDeadlock)).toEqual([]);
            expect(failures).toEqual([]);

            // Moves: every root and its sub-item in the destination, aliased.
            const movedIds = await prisma.workItem.findMany({ where: { parentId: { in: roots.map((r) => r.id) } }, select: { id: true } });
            const moved = await prisma.workItem.findMany({ where: { id: { in: [...roots.map((r) => r.id), ...movedIds.map((m) => m.id)] } }, select: { projectId: true } });
            expect(moved).toHaveLength(16);
            expect(moved.every((m) => m.projectId === to.id)).toBe(true);
            expect(await prisma.workItemKeyAlias.count({ where: { projectId: from.id } })).toBe(16);
            // One gapless series in the destination: moved rows, sub-item creates, plain creates.
            const fresh = await prisma.workItem.findMany({ where: { projectId: to.id, number: { gt: beforeTo } }, select: { number: true } });
            expect(fresh.map((r) => r.number).sort((x, y) => x - y)).toEqual(Array.from({ length: 16 + 3 + 5 }, (_, i) => beforeTo + 1 + i));
            // Relations: every new one stored once, the removed ones gone.
            for (const [a, b] of pairs) expect(await prisma.workItemRelation.count({ where: { fromId: a.id, toId: b.id, type: 'BLOCKS' } })).toBe(1);
            expect(await prisma.workItemRelation.count({ where: { id: { in: toRemove.map((r) => r.relation.id) } } })).toBe(0);
            // Re-parents and sub-item creates.
            expect(await prisma.workItem.count({ where: { id: { in: children.map((c) => c.id) }, parentId: parent.id } })).toBe(3);
            expect(await prisma.workItem.count({ where: { parentId: holder.id } })).toBe(3);
            // The reschedule.
            const s = await prisma.workItem.findUniqueOrThrow({ where: { id: solo.id } });
            expect(s.dueDate?.toISOString().slice(0, 10)).toBe('2049-05-06');
            // Every write left both queues.
            expect(queuedGraphWorkspaceCount()).toBe(0);
            expect(queuedProjectCount()).toBe(0);
        },
    );
});
