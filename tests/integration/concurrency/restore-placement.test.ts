/**
 * A restored item comes back in its place, and the sort-key rebalance stops
 * selecting a project once it has rewritten it (issue #110; found by
 * Hardening H2c, part 2, while reading the rebalance).
 *
 * Before the fix the rebalance rewrote a project's live items only, while
 * the check that picks projects to rebalance also counted deleted rows. So a
 * deleted item kept its long key: its project was rewritten every night
 * until the purge, and once restored the item sorted by its old long key
 * among the new short ones instead of between its old neighbours. A
 * placement computes its key among live rows only, so it could also mint
 * the very key a deleted item kept, and the restored item then shared it
 * with a live one (a placement between the two is refused). Measured before
 * the fix on 2026-11-26: the first three tests failed.
 *
 * The fix rewrites deleted rows in the rebalance too, in the same order and
 * under the same locks (the project's sequence row, then every row in id
 * order), and a restore takes the project's sequence row (in the project's
 * queue, before the item rows) and gives a row whose key a live row now
 * holds a new key between its old neighbours. Invariants are read from the
 * table.
 */
import type { PrismaClient } from '@prisma/client';

import { keysBetween, SORT_KEY_REBALANCE_LENGTH } from '@/app-layer/domain/fractional-index';
import { processSortKeyRebalance } from '@/app-layer/jobs/work-item-sortkey-rebalance';
import { createProject } from '@/app-layer/usecases/project';
import { createWorkItem, deleteWorkItem, restoreWorkItem } from '@/app-layer/usecases/work-item';
import { reorderWorkItem } from '@/app-layer/usecases/work-item-moves';

import { prismaTestClient, resetDatabase } from '../../helpers/db';
import { roundNumbers } from '../../helpers/stress-scale';
import { createWorkItemWorkspace, isDeadlock, type WorkItemWorkspace } from '../../helpers/work-item-workspace';

import { DB_AVAILABLE } from '../db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `rstp${Date.now().toString(36)}`;
const BASE_ROUNDS = 2;

describeFn('restore keeps an item\'s place; the rebalance and deleted rows', () => {
    let prisma: PrismaClient;
    let ws: WorkItemWorkspace;
    let seq = 0;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        ws = await createWorkItemWorkspace(prisma, TAG);
    });

    afterAll(async () => {
        if (!process.env.KEEP_DB) await resetDatabase(prisma);
    });

    /** A project of `count` items in creation order; with `grown`, their keys past the bound, in the same order. */
    async function project(count: number, grown: boolean) {
        seq += 1;
        const prefix = `RP${seq}`;
        const p = await createProject(ws.owner, { teamId: ws.teamId, name: prefix, keyPrefix: prefix });
        const ids: string[] = [];
        for (let i = 0; i < count; i++) {
            // guardrail-allow: n+1 — the test's own setup.
            ids.push((await createWorkItem(ws.owner, { projectId: p.id, typeId: ws.typeId, title: `${prefix}-${i}` })).id);
        }
        if (grown) {
            const stem = 'V'.repeat(SORT_KEY_REBALANCE_LENGTH + 6);
            const keys = keysBetween(null, null, count).map((k) => stem + k);
            for (let i = 0; i < count; i++) {
                // guardrail-allow: n+1 — the test's own setup.
                await prisma.$executeRaw`UPDATE "WorkItem" SET "sortKey" = ${keys[i]!} WHERE "id" = ${ids[i]!}`;
            }
        }
        return { projectId: p.id, ids };
    }

    const rowsOf = async (projectId: string) =>
        prisma.$queryRaw<Array<{ id: string; sortKey: string; version: number }>>`
            SELECT "id", "sortKey", "version" FROM "WorkItem" WHERE "projectId" = ${projectId} AND "deletedAt" IS NULL ORDER BY "sortKey", "id"`;

    function expectDistinctShort(rows: Array<{ sortKey: string }>) {
        expect(new Set(rows.map((r) => r.sortKey)).size).toBe(rows.length);
        expect(rows.every((r) => r.sortKey.length <= SORT_KEY_REBALANCE_LENGTH)).toBe(true);
    }

    it('an item deleted before a rebalance and restored after it comes back between its old neighbours, its key unique', async () => {
        const { projectId, ids } = await project(12, true);
        await deleteWorkItem(ws.owner, ids[4]!);
        await deleteWorkItem(ws.owner, ids[9]!);
        await processSortKeyRebalance({ tenantId: ws.tenantId });
        const rewritten = await rowsOf(projectId);
        expectDistinctShort(rewritten);

        await restoreWorkItem(ws.owner, ids[4]!);
        await restoreWorkItem(ws.owner, ids[9]!);
        const after = await rowsOf(projectId);
        expect(after.map((r) => r.id)).toEqual(ids);
        expectDistinctShort(after);
        // The live rows' keys did not move for the restore, and no version moved for a key.
        const keyOf = new Map(rewritten.map((r) => [r.id, r.sortKey]));
        expect(after.filter((r) => keyOf.has(r.id)).every((r) => r.sortKey === keyOf.get(r.id))).toBe(true);
    });

    it('a project whose only long keys are deleted is rewritten once, then no longer selected', async () => {
        const { projectId, ids } = await project(6, false);
        // The last item's own key, grown past the bound: still last.
        const own = (await prisma.workItem.findUniqueOrThrow({ where: { id: ids[5]! }, select: { sortKey: true } })).sortKey;
        const long = own + 'V'.repeat(SORT_KEY_REBALANCE_LENGTH + 3);
        await prisma.$executeRaw`UPDATE "WorkItem" SET "sortKey" = ${long} WHERE "id" = ${ids[5]!}`;
        await deleteWorkItem(ws.owner, ids[5]!);
        const versions = new Map((await prisma.workItem.findMany({ where: { projectId }, select: { id: true, version: true } })).map((r) => [r.id, r.version]));

        const first = await processSortKeyRebalance({ tenantId: ws.tenantId });
        expect(first.projects).toBeGreaterThanOrEqual(1);
        const all = await prisma.workItem.findMany({ where: { projectId }, select: { id: true, sortKey: true, version: true } });
        expect(all.every((r) => r.sortKey.length <= SORT_KEY_REBALANCE_LENGTH)).toBe(true);
        // A sort key is not versioned: no row's version moved, deleted or not.
        expect(all.every((r) => r.version === versions.get(r.id))).toBe(true);

        const second = await processSortKeyRebalance({ tenantId: ws.tenantId });
        expect(second).toEqual({ projects: 0, items: 0 });
        await restoreWorkItem(ws.owner, ids[5]!);
        expect((await rowsOf(projectId)).map((r) => r.id)).toEqual(ids);
    });

    it('a restored item whose kept key a placement minted again gets a new one in its place', async () => {
        const { projectId, ids } = await project(4, false);
        // X between ids[1] and ids[2], deleted; Y then placed in the same gap mints the same key.
        const x = (await createWorkItem(ws.owner, { projectId, typeId: ws.typeId, title: 'x' })).id;
        await reorderWorkItem(ws.owner, x, { afterId: ids[1]! });
        await deleteWorkItem(ws.owner, x);
        const y = (await createWorkItem(ws.owner, { projectId, typeId: ws.typeId, title: 'y' })).id;
        await reorderWorkItem(ws.owner, y, { afterId: ids[1]! });
        const xKey = (await prisma.workItem.findUniqueOrThrow({ where: { id: x }, select: { sortKey: true } })).sortKey;
        const yKey = (await prisma.workItem.findUniqueOrThrow({ where: { id: y }, select: { sortKey: true } })).sortKey;
        expect(yKey).toBe(xKey);

        await restoreWorkItem(ws.owner, x);
        const after = await rowsOf(projectId);
        expect(new Set(after.map((r) => r.sortKey)).size).toBe(after.length);
        // In its place: between ids[1] and ids[2], ordered with Y by id as the equal keys were.
        const middle = x < y ? [x, y] : [y, x];
        expect(after.map((r) => r.id)).toEqual([ids[0], ids[1], ...middle, ids[2], ids[3]]);
        // And a placement between X and Y is no longer refused.
        const z = (await createWorkItem(ws.owner, { projectId, typeId: ws.typeId, title: 'z' })).id;
        await reorderWorkItem(ws.owner, z, { afterId: middle[0]! });
        expect((await rowsOf(projectId)).map((r) => r.id)).toEqual([ids[0], ids[1], middle[0], z, middle[1], ids[2], ids[3]]);
    });

    it.each(roundNumbers(BASE_ROUNDS))(
        'round %i: restores, reorders and the rebalance at once: never a deadlock, every key unique, the restored rows in their places',
        async () => {
            const { projectId, ids } = await project(30, true);
            const deleted = [ids[3]!, ids[11]!, ids[19]!, ids[26]!];
            for (const id of deleted) {
                // guardrail-allow: n+1 — the test's own setup.
                await deleteWorkItem(ws.owner, id);
            }
            const settled = await Promise.allSettled([
                processSortKeyRebalance({ tenantId: ws.tenantId }),
                ...deleted.map((id) => restoreWorkItem(ws.owner, id)),
                reorderWorkItem(ws.owner, ids[29]!, { afterId: ids[0]! }),
                reorderWorkItem(ws.owner, ids[15]!, { afterId: ids[20]! }),
            ]);
            const failures = settled.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason);
            expect(failures.filter(isDeadlock).map(String)).toEqual([]);
            expect(failures.map(String)).toEqual([]);

            const after = await rowsOf(projectId);
            expect(new Set(after.map((r) => r.sortKey)).size).toBe(after.length);
            const expected = ids.filter((id) => id !== ids[29] && id !== ids[15]);
            expected.splice(1, 0, ids[29]!);
            expected.splice(expected.indexOf(ids[20]!) + 1, 0, ids[15]!);
            expect(after.map((r) => r.id)).toEqual(expected);
        },
    );
});
