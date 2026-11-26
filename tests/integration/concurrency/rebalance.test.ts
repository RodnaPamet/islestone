/**
 * Reorders racing a running `work-item-sortkey-rebalance` (Hardening H2,
 * part 2; issue #70). The rebalance rewrites a project's live keys in one
 * transaction holding the project's key-sequence row, the row every
 * placement takes before it computes a key, and locks the rows in id order
 * before it writes (decision 173). So a reorder lands either before the
 * rewrite (and is rewritten in its new place) or after it (between the new
 * short keys), never between a read of the old order and its rewrite.
 *
 * Invariants, read from the table: the order after equals the order before
 * except for the moved rows' intended places; every key unique and within
 * the rebalance bound; no version moved (a `sortKey` write is not versioned).
 * No defect was found; dropping the rebalance's sequence-row lock makes the
 * first test fail (a reorder computed from keys the rewrite then replaced).
 */
import type { PrismaClient } from '@prisma/client';

import { processSortKeyRebalance } from '@/app-layer/jobs/work-item-sortkey-rebalance';
import { createProject } from '@/app-layer/usecases/project';
import { createWorkItem } from '@/app-layer/usecases/work-item';
import { moveWorkItemOnBoard, reorderWorkItem } from '@/app-layer/usecases/work-item-moves';
import { keysBetween, SORT_KEY_REBALANCE_LENGTH } from '@/app-layer/domain/fractional-index';

import { prismaTestClient, resetDatabase } from '../../helpers/db';
import { roundNumbers } from '../../helpers/stress-scale';
import { createWorkItemWorkspace, isDeadlock, type WorkItemWorkspace } from '../../helpers/work-item-workspace';

import { DB_AVAILABLE } from '../db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `rbal${Date.now().toString(36)}`;
const BASE_ROUNDS = 3;

describeFn('concurrency: reorders racing the sort-key rebalance', () => {
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

    /** A project of `count` items whose keys have grown past the bound, in creation order. */
    async function grownProject(prefix: string, count: number) {
        const p = await createProject(ws.owner, { teamId: ws.teamId, name: prefix, keyPrefix: prefix });
        const ids: string[] = [];
        for (let i = 0; i < count; i++) {
            // guardrail-allow: n+1 — the test's own setup.
            ids.push((await createWorkItem(ws.owner, { projectId: p.id, typeId: ws.typeId, title: `${prefix}-${i}` })).id);
        }
        // Long keys in the same order, as many inserts into one gap leave them.
        const stem = 'V'.repeat(SORT_KEY_REBALANCE_LENGTH + 6);
        const keys = keysBetween(null, null, count).map((k) => stem + k);
        for (let i = 0; i < count; i++) {
            // guardrail-allow: n+1 — the test's own setup.
            await prisma.$executeRaw`UPDATE "WorkItem" SET "sortKey" = ${keys[i]!} WHERE "id" = ${ids[i]!}`;
        }
        return { projectId: p.id, ids };
    }

    const orderOf = async (projectId: string) =>
        (await prisma.$queryRaw<Array<{ id: string; sortKey: string; version: number }>>`
            SELECT "id", "sortKey", "version" FROM "WorkItem" WHERE "projectId" = ${projectId} AND "deletedAt" IS NULL ORDER BY "sortKey", "id"`);

    it.each(roundNumbers(BASE_ROUNDS))(
        'round %i: reorders and drops while the rebalance runs: the order is the old order with the moved rows in their places',
        async (round) => {
            const { projectId, ids } = await grownProject(`RB${round}`, 40);
            const anchor = ids[5]!;
            const movers = [ids[30]!, ids[12]!, ids[39]!, ids[0]!, ids[21]!, ids[33]!];
            const dropped = [ids[25]!, ids[8]!];
            const others = ids.filter((id) => id !== anchor && !movers.includes(id) && !dropped.includes(id));

            const settled = await Promise.allSettled([
                ...movers.map((m) => reorderWorkItem(ws.owner, m, { afterId: anchor })),
                processSortKeyRebalance({ tenantId: ws.tenantId }),
                // A drop into another column, placed before the last of the others.
                ...dropped.map((d) => moveWorkItemOnBoard(ws.owner, d, { stateId: ws.states['In progress']!.id, position: { beforeId: others[others.length - 1]! } })),
            ]);
            const failures = settled.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason));
            expect(failures.filter(isDeadlock)).toEqual([]);
            expect(failures).toEqual([]);

            const after = await orderOf(projectId);
            const order = after.map((r) => r.id);
            expect(order).toHaveLength(ids.length);
            // Unique keys, all within the bound: whatever landed before the
            // rewrite was rewritten, whatever landed after sits between short keys.
            expect(new Set(after.map((r) => r.sortKey)).size).toBe(after.length);
            expect(after.every((r) => r.sortKey.length <= SORT_KEY_REBALANCE_LENGTH)).toBe(true);
            // A sortKey write never bumps the version; the drops changed the state once.
            for (const r of after) expect(r.version).toBe(dropped.includes(r.id) ? 2 : 1);

            // The rows nobody moved keep their order, with the anchor in its place among them.
            const untouched = order.filter((id) => id === anchor || others.includes(id));
            expect(untouched).toEqual(ids.filter((id) => id === anchor || others.includes(id)));
            // Every mover sits right after the anchor, before the anchor's old successor.
            const at = order.indexOf(anchor);
            expect(new Set(order.slice(at + 1, at + 1 + movers.length))).toEqual(new Set(movers));
            // Every drop sits immediately before the last of the others (in either order).
            const last = order.indexOf(others[others.length - 1]!);
            expect(new Set(order.slice(last - dropped.length, last))).toEqual(new Set(dropped));
        },
    );

    it('the rebalance waits for a placement holding the sequence row, and a placement after it uses the new keys', async () => {
        const { projectId, ids } = await grownProject('RBW', 12);
        const rebalance = processSortKeyRebalance({ tenantId: ws.tenantId });
        const reorders = Promise.all([reorderWorkItem(ws.owner, ids[11]!, { afterId: ids[2]! }), reorderWorkItem(ws.owner, ids[0]!, { beforeId: ids[7]! })]);
        await Promise.all([rebalance, reorders]);
        const order = (await orderOf(projectId)).map((r) => r.id);
        const expected = ids.filter((id) => id !== ids[11] && id !== ids[0]);
        expected.splice(expected.indexOf(ids[2]!) + 1, 0, ids[11]!);
        expected.splice(expected.indexOf(ids[7]!), 0, ids[0]!);
        expect(order).toEqual(expected);
    });
});
