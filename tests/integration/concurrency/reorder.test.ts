/**
 * Reordering under parallel writers (Hardening H2, part 2; decision 173's lock
 * order). Placements in one project are serialised on its key-sequence row;
 * the board's drop and a re-parent with a position now take that row BEFORE
 * the item's row, as a reorder does, so a drop that changes the state and a
 * reorder of the same item can no longer each hold what the other waits on.
 * Invariants are read from the table afterwards.
 */
import type { PrismaClient } from '@prisma/client';

import { createWorkItem } from '@/app-layer/usecases/work-item';
import { moveWorkItemOnBoard, reorderWorkItem } from '@/app-layer/usecases/work-item-moves';
import { createProject } from '@/app-layer/usecases/project';

import { prismaTestClient, resetDatabase } from '../../helpers/db';
import { createWorkItemWorkspace, isDeadlock, type WorkItemWorkspace } from '../../helpers/work-item-workspace';

import { DB_AVAILABLE } from '../db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `reoc${Date.now().toString(36)}`;

describeFn('concurrency: reordering', () => {
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

    const jsCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

    async function freshProject(prefix: string, count: number) {
        const p = await createProject(ws.owner, { teamId: ws.teamId, name: prefix, keyPrefix: prefix });
        const items = [];
        for (let i = 0; i < count; i++) items.push(await createWorkItem(ws.owner, { projectId: p.id, typeId: ws.typeId, title: `${prefix}-${i}` }));
        return { projectId: p.id, items };
    }

    it('20 reorders into the same gap: every key unique, all between the anchor and its old successor, versions untouched', async () => {
        const { projectId, items } = await freshProject('GAP', 22);
        const anchor = items[0]!;
        const successor = items[1]!;
        const movers = items.slice(2);
        const results = await Promise.allSettled(movers.map((m) => reorderWorkItem(ws.owner, m.id, { afterId: anchor.id })));
        expect(results.filter((r) => r.status === 'rejected')).toEqual([]);

        const rows = await prisma.workItem.findMany({ where: { projectId }, select: { id: true, sortKey: true, version: true } });
        expect(new Set(rows.map((r) => r.sortKey)).size).toBe(rows.length);
        const byId = new Map(rows.map((r) => [r.id, r]));
        const anchorKey = byId.get(anchor.id)!.sortKey;
        const successorKey = byId.get(successor.id)!.sortKey;
        for (const m of movers) {
            const k = byId.get(m.id)!.sortKey;
            expect(anchorKey < k && k < successorKey).toBe(true);
            // A sortKey write does not bump the version (ADR 0002 §5).
            expect(byId.get(m.id)!.version).toBe(1);
        }
        // Postgres's order (COLLATE "C") equals JavaScript's `<` order.
        const dbOrder = await prisma.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "WorkItem" WHERE "projectId" = ${projectId} ORDER BY "sortKey", "id"`;
        const jsOrder = [...rows].sort((a, b) => jsCompare(a.sortKey, b.sortKey) || jsCompare(a.id, b.id));
        expect(dbOrder.map((r) => r.id)).toEqual(jsOrder.map((r) => r.id));
        expect(dbOrder[0]!.id).toBe(anchor.id);
        expect(dbOrder[movers.length + 1]!.id).toBe(successor.id);
    });

    it('reorders, board drops that change the state, and appends interleaved: no deadlock, unique keys, every drop placed', async () => {
        for (let round = 0; round < 3; round++) {
            const { projectId, items } = await freshProject(`MIX${round}`, 9);
            const anchor = items[0]!;
            const targets = items.slice(1);
            // 19 writers at once: below the pool's 25, so what is measured is
            // the lock order, not connection starvation (see key-allocation).
            const work: Array<Promise<unknown>> = [];
            for (const t of targets) {
                // The same item dropped into another column (with a place) AND reordered at once:
                // before the fix the drop held the item and waited on the sequence the reorder held.
                work.push(moveWorkItemOnBoard(ws.owner, t.id, { stateId: ws.states['In progress']!.id, position: { afterId: anchor.id } }));
                work.push(reorderWorkItem(ws.owner, t.id, { afterId: anchor.id }));
            }
            for (let i = 0; i < 3; i++) work.push(createWorkItem(ws.member, { projectId, typeId: ws.typeId, title: `append ${round}-${i}` }));
            const results = await Promise.allSettled(work);
            const failures = results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason);
            expect(failures.filter(isDeadlock)).toEqual([]);
            expect(failures).toEqual([]);

            const rows = await prisma.workItem.findMany({ where: { projectId }, select: { id: true, sortKey: true, stateId: true } });
            expect(rows).toHaveLength(9 + 3);
            expect(new Set(rows.map((r) => r.sortKey)).size).toBe(rows.length);
            const byId = new Map(rows.map((r) => [r.id, r]));
            for (const t of targets) {
                expect(byId.get(t.id)!.stateId).toBe(ws.states['In progress']!.id);
                expect(byId.get(t.id)!.sortKey > byId.get(anchor.id)!.sortKey).toBe(true);
            }
        }
    });
});
