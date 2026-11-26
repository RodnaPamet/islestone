/**
 * Creates made inside another usecase's transaction, under a burst (Hardening
 * H2, part 2; issue #70; the pattern of owner decision 174).
 *
 * Intake accept makes its work item through `createWorkItemInTx`, inside the
 * transaction that claims the request. Before it waited its turn in the
 * project's queue (`inProjectSequenceQueue`), 25 simultaneous accepts into
 * one project failed the way 25 simultaneous creates did before decision 174:
 * each waiter held a pooled connection inside its transaction while it waited
 * on the project's key-sequence row, the accept at the head needed one more
 * for its audit append, and every waiter's transaction expired. Measured
 * before the fix on 2026-11-26: most of the 25 failed.
 *
 * Interleaved with the burst: plain creates in the same project (which share
 * the queue) and accepts into a second project (which do not). Invariants are
 * read from the tables afterwards.
 */
import type { PrismaClient } from '@prisma/client';

import { createIntakeForm } from '@/app-layer/usecases/intake-form';
import { acceptIntakeRequest, sendIntakeRequest } from '@/app-layer/usecases/intake-request';
import { setProjectIntake } from '@/app-layer/usecases/intake-settings';
import { createProject } from '@/app-layer/usecases/project';
import { queuedProjectCount } from '@/app-layer/usecases/project-sequence-queue';
import { createWorkItem } from '@/app-layer/usecases/work-item';
import { WORK_ITEM_CREATE_BURST_PER_PROJECT } from '@/lib/db/concurrency-limits';

import { prismaTestClient, resetDatabase } from '../../helpers/db';
import { roundNumbers } from '../../helpers/stress-scale';
import { createWorkItemWorkspace, isDeadlock, type WorkItemWorkspace } from '../../helpers/work-item-workspace';

import { DB_AVAILABLE } from '../db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `nstc${Date.now().toString(36)}`;
const BASE_ROUNDS = 2;

describeFn('concurrency: creates nested in another usecase, under a burst', () => {
    let prisma: PrismaClient;
    let ws: WorkItemWorkspace;
    let secondProjectId = '';
    let formId = '';
    let secondFormId = '';

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        ws = await createWorkItemWorkspace(prisma, TAG);
        secondProjectId = (await createProject(ws.owner, { teamId: ws.teamId, name: 'Second', keyPrefix: 'SEC' })).id;
        await setProjectIntake(ws.owner, ws.projectId, { enabled: true });
        await setProjectIntake(ws.owner, secondProjectId, { enabled: true });
        const definition = { fields: [] };
        formId = (await createIntakeForm(ws.owner, { projectId: ws.projectId, name: 'Requests', definition })).id;
        secondFormId = (await createIntakeForm(ws.owner, { projectId: secondProjectId, name: 'Requests', definition })).id;
    });

    afterAll(async () => {
        if (!process.env.KEEP_DB) await resetDatabase(prisma);
    });

    const lastValue = async (projectId: string) => (await prisma.projectKeySequence.findUniqueOrThrow({ where: { projectId } })).lastValue;

    async function requests(form: string, count: number, round: number) {
        const rows = [];
        for (let i = 0; i < count; i++) {
            // guardrail-allow: n+1 — the test's own setup, one request at a time.
            rows.push(await sendIntakeRequest(ws.member, form, { title: `request ${round}-${i}`, body: 'Please', answers: {} }));
        }
        return rows;
    }

    it.each(roundNumbers(BASE_ROUNDS))(
        `round %i: ${WORK_ITEM_CREATE_BURST_PER_PROJECT} simultaneous intake accepts into one project all succeed, numbered without gaps`,
        async (round) => {
            const burst = WORK_ITEM_CREATE_BURST_PER_PROJECT;
            const inA = await requests(formId, burst, round);
            const inB = await requests(secondFormId, 5, round);
            const beforeA = await lastValue(ws.projectId);
            const beforeB = await lastValue(secondProjectId);

            const accepts = inA.map((r) => acceptIntakeRequest(ws.owner, r.id, { typeId: ws.typeId }, r.version));
            const plain = Array.from({ length: 5 }, (_, i) => createWorkItem(ws.member, { projectId: ws.projectId, typeId: ws.typeId, title: `plain ${round}-${i}` }));
            const other = inB.map((r) => acceptIntakeRequest(ws.member, r.id, { typeId: ws.typeId }, r.version));
            const settled = await Promise.allSettled([...accepts, ...plain, ...other]);

            const failures = settled.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason));
            expect(failures.filter(isDeadlock)).toEqual([]);
            expect(failures).toEqual([]);

            // From the tables: every request accepted with its item, numbers
            // contiguous from the previous value in both projects.
            const decided = await prisma.intakeRequest.findMany({ where: { id: { in: [...inA, ...inB].map((r) => r.id) } }, select: { status: true, workItemId: true } });
            expect(decided.every((r) => r.status === 'ACCEPTED' && r.workItemId)).toBe(true);
            const rowsA = await prisma.workItem.findMany({ where: { projectId: ws.projectId, number: { gt: beforeA } }, select: { number: true } });
            expect(rowsA.map((r) => r.number).sort((x, y) => x - y)).toEqual(Array.from({ length: burst + 5 }, (_, i) => beforeA + 1 + i));
            expect(await lastValue(ws.projectId)).toBe(beforeA + burst + 5);
            const rowsB = await prisma.workItem.findMany({ where: { projectId: secondProjectId, number: { gt: beforeB } }, select: { number: true } });
            expect(rowsB.map((r) => r.number).sort((x, y) => x - y)).toEqual(Array.from({ length: 5 }, (_, i) => beforeB + 1 + i));
            expect(queuedProjectCount()).toBe(0);
        },
    );
});
