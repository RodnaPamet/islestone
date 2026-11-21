/**
 * Key allocation under a burst (Hardening H2, part 2; owner decision 174;
 * issue #32): 25 simultaneous creates in one project succeed, with gapless,
 * unique numbers, while creates in a second project and creates that fail
 * interleave with them. Invariants are read from the tables afterwards, never
 * only from the returned values.
 *
 * Before decision 174's fix, 24 of 25 such creates failed: each waiting
 * create held a pooled connection while it waited on the key-sequence row,
 * and the create at the head of the queue could not get the connection its
 * audit append needs (`src/app-layer/usecases/project-sequence-queue.ts`).
 */
import type { PrismaClient } from '@prisma/client';

import { createProject } from '@/app-layer/usecases/project';
import { queuedProjectCount } from '@/app-layer/usecases/project-sequence-queue';
import { createWorkItem } from '@/app-layer/usecases/work-item';
import { WORK_ITEM_CREATE_BURST_PER_PROJECT } from '@/lib/db/concurrency-limits';

import { prismaTestClient, resetDatabase } from '../../helpers/db';
import { createWorkItemWorkspace, type WorkItemWorkspace } from '../../helpers/work-item-workspace';

import { DB_AVAILABLE } from '../db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `keyc${Date.now().toString(36)}`;
const ROUNDS = 2;

describeFn('concurrency: key allocation under a burst', () => {
    let prisma: PrismaClient;
    let ws: WorkItemWorkspace;
    let secondProjectId = '';

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        ws = await createWorkItemWorkspace(prisma, TAG);
        secondProjectId = (await createProject(ws.owner, { teamId: ws.teamId, name: 'Second', keyPrefix: 'SEC' })).id;
    });

    afterAll(async () => {
        if (!process.env.KEEP_DB) await resetDatabase(prisma);
    });

    const lastValue = async (projectId: string) => (await prisma.projectKeySequence.findUniqueOrThrow({ where: { projectId } })).lastValue;

    it('states the burst it proves', () => {
        expect(WORK_ITEM_CREATE_BURST_PER_PROJECT).toBe(25);
    });

    it.each(Array.from({ length: ROUNDS }, (_, i) => i + 1))(
        `round %i: ${WORK_ITEM_CREATE_BURST_PER_PROJECT} simultaneous creates in one project all succeed, numbered without gaps`,
        async () => {
            const burst = WORK_ITEM_CREATE_BURST_PER_PROJECT;
            const beforeA = await lastValue(ws.projectId);
            const beforeB = await lastValue(secondProjectId);

            const inA = Array.from({ length: burst }, (_, i) => createWorkItem(ws.owner, { projectId: ws.projectId, typeId: ws.typeId, title: `burst ${i}` }));
            // Interleaved: creates in another project, and creates that fail (an unknown state).
            const inB = Array.from({ length: 10 }, (_, i) => createWorkItem(ws.member, { projectId: secondProjectId, typeId: ws.typeId, title: `other ${i}` }));
            const failing = Array.from({ length: 5 }, (_, i) =>
                createWorkItem(ws.owner, { projectId: ws.projectId, typeId: ws.typeId, title: `bad ${i}`, stateId: 'no-such-state' }),
            );
            const [a, b, bad] = await Promise.all([Promise.allSettled(inA), Promise.allSettled(inB), Promise.allSettled(failing)]);

            const rejected = a.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason);
            expect(rejected).toEqual([]);
            expect(b.filter((r) => r.status === 'rejected')).toEqual([]);
            expect(bad.every((r) => r.status === 'rejected' && (r.reason as { status?: number }).status === 404)).toBe(true);

            // From the table: contiguous from the previous value, unique, and the
            // sequence's last value is the highest number. Failed creates used none.
            const rowsA = await prisma.workItem.findMany({ where: { projectId: ws.projectId, number: { gt: beforeA } }, select: { number: true } });
            const numbersA = rowsA.map((r) => r.number).sort((x, y) => x - y);
            expect(numbersA).toEqual(Array.from({ length: burst }, (_, i) => beforeA + 1 + i));
            expect(await lastValue(ws.projectId)).toBe(beforeA + burst);
            const rowsB = await prisma.workItem.findMany({ where: { projectId: secondProjectId, number: { gt: beforeB } }, select: { number: true } });
            expect(rowsB.map((r) => r.number).sort((x, y) => x - y)).toEqual(Array.from({ length: 10 }, (_, i) => beforeB + 1 + i));
            expect(await lastValue(secondProjectId)).toBe(beforeB + 10);
            // Every create left the queue.
            expect(queuedProjectCount()).toBe(0);
        },
    );
});
