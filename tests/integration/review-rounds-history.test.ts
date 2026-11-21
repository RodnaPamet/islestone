/**
 * An earlier round is never rewritten (H2 part 4; ADR 0009 §4; owner
 * decisions 149 to 162): a model-based sequence test against a real Postgres.
 *
 * `reviews.test.ts` (2.8a) already pins one history byte for byte after two
 * more rounds, refuses every raw write to an ended round as `app_user`,
 * admits the key rotations' re-wrap, and shows the purge's cascade passes.
 * What it cannot show is that NO sequence of the product's own writes
 * rewrites an ended round. Here fast-check draws sequences of commands, each
 * a real usecase as a real person: edit the steps, send, respond (and change
 * a response while the step is open), Return, skip, add a reviewer, withdraw,
 * remove a member, make a pending reviewer the assignee, close the item and
 * reopen it, delete it and restore it, and rotate the workspace's DEK with its
 * sweep. After every command, every row of every ended round of the item
 * (the round, its steps, their lists, its reviewer rows) is compared with the
 * snapshot taken when that round was first seen ended: equal column for
 * column, `responseText` as its decrypted text (the DEK sweep re-wraps the
 * ciphertext, which is the one change the triggers admit), and no ended
 * round ever disappears.
 *
 * A command a person could be refused (a typed 4xx: nothing to send, a step
 * already ended, a deleted item) is a no-op for the sequence; anything else,
 * a trigger refusing the product's own write included, fails the property.
 */
import fc from 'fast-check';
import type { PrismaClient } from '@prisma/client';

import { DB_AVAILABLE } from './db-helper';

// The DEK rotation enqueues its sweep; the test runs the sweep itself.
jest.mock('@/app-layer/jobs/queue', () => ({
    enqueue: async () => ({ id: 'review-history-job' }),
    getQueue: () => ({ getJob: async () => null }),
}));

import type { RequestContext } from '@/app-layer/types';
import { runTenantDekRotation } from '@/app-layer/jobs/tenant-dek-rotation';
import { createProject } from '@/app-layer/usecases/project';
import { createRecipientList } from '@/app-layer/usecases/recipient-list';
import {
    addReviewStepReviewer,
    respondToReviewStep,
    sendWorkItemReview,
    setWorkItemReviewSteps,
    skipReviewStep,
    withdrawWorkItemReview,
} from '@/app-layer/usecases/review';
import { createTeam } from '@/app-layer/usecases/team';
import { removeTenantMember } from '@/app-layer/usecases/tenant-admin';
import { assignWorkItem, createWorkItem, deleteWorkItem, restoreWorkItem, setWorkItemState } from '@/app-layer/usecases/work-item';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { verifyAuditChain } from '@/lib/audit';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { AppError } from '@/lib/errors/types';
import { createTenantWithDek, rotateTenantDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `rhist${Date.now().toString(36)}`;
const REVIEWERS = ['R1', 'R2', 'R3', 'R4'] as const;
type Reviewer = (typeof REVIEWERS)[number];
const ENDED = new Set(['COMPLETED', 'RETURNED', 'WITHDRAWN']);

interface Model {
    item: string;
    /** One DEK rotation per sequence: a second is refused until the sweep clears the first. */
    rotated: boolean;
}

describeFn('an earlier round is never rewritten, whatever the sequence (H2 part 4)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let projectId = '';
    let typeId = '';
    let listId = '';
    const states: Record<'UNSTARTED' | 'STARTED' | 'DONE' | 'CANCELLED', string> = { UNSTARTED: '', STARTED: '', DONE: '', CANCELLED: '' };
    const users: Record<'OWNER' | 'ANN' | Reviewer, string> = { OWNER: '', ANN: '', R1: '', R2: '', R3: '', R4: '' };
    const as = (who: keyof typeof users): RequestContext =>
        makeRequestContext(who === 'OWNER' ? 'OWNER' : 'MEMBER', { tenantId, tenantSlug: TAG, userId: users[who], requestId: `${TAG}-${who}-${Math.random()}` });

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        for (const who of Object.keys(users) as (keyof typeof users)[]) {
            const u = await prisma.user.create({ data: { email: `${who.toLowerCase()}-${TAG}@example.test`, name: who } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role: who === 'OWNER' ? 'OWNER' : 'MEMBER' } });
            users[who] = u.id;
        }
        const owner = as('OWNER');
        const team = await createTeam(owner, { name: 'History' });
        for (const cat of Object.keys(states) as (keyof typeof states)[]) states[cat] = team.workflowStates.find((s) => s.category === cat)!.id;
        projectId = (await createProject(owner, { teamId: team.id, name: 'History', keyPrefix: 'HIS' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
        listId = (await createRecipientList(owner, null, { name: 'History reviewers', userIds: [users.R3, users.R4] })).id;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    /** Run a person's write; a typed refusal (4xx) is a no-op for the sequence, anything else fails it. */
    async function attempt(write: () => Promise<unknown>): Promise<void> {
        try {
            await write();
        } catch (err) {
            if (err instanceof AppError && err.status >= 400 && err.status < 500) return;
            throw err;
        }
    }

    async function live(item: string) {
        const rows = await prisma.workItemReviewRound.findMany({ where: { workItemId: item, status: { in: ['PLANNED', 'OPEN'] } }, select: { id: true, status: true } });
        const open = rows.find((r) => r.status === 'OPEN');
        const step = open ? await prisma.workItemReviewStep.findFirst({ where: { roundId: open.id, status: { in: ['OPEN', 'PENDING'] } }, orderBy: { position: 'asc' } }) : null;
        return { planned: rows.some((r) => r.status === 'PLANNED'), open, step };
    }

    /** Every row of one round: raw (ciphertext dropped) and the response texts as the app decrypts them. */
    async function roundRows(roundId: string) {
        const raw = {
            round: await prisma.workItemReviewRound.findUniqueOrThrow({ where: { id: roundId } }),
            steps: await prisma.workItemReviewStep.findMany({ where: { roundId }, orderBy: { position: 'asc' } }),
            lists: await prisma.workItemReviewStepList.findMany({ where: { step: { roundId } }, orderBy: [{ stepId: 'asc' }, { recipientListId: 'asc' }] }),
            reviewers: (await prisma.workItemReviewer.findMany({ where: { roundId }, orderBy: { id: 'asc' } })).map(({ responseText, ...rest }) => ({ ...rest, hasText: responseText !== null })),
        };
        const texts = await runInTenantContext(as('OWNER'), (db) => db.workItemReviewer.findMany({ where: { roundId }, orderBy: { id: 'asc' }, select: { id: true, responseText: true } }));
        return { raw, texts };
    }

    /** The invariant, after every command: each ended round is what it was when it ended. */
    async function checkHistory(item: string, ended: Map<string, unknown>): Promise<void> {
        const rounds = await prisma.workItemReviewRound.findMany({ where: { workItemId: item }, select: { id: true, status: true } });
        const present = new Set(rounds.map((r) => r.id));
        for (const id of ended.keys()) expect({ endedRound: id, present: present.has(id) }).toEqual({ endedRound: id, present: true });
        for (const r of rounds.filter((x) => ENDED.has(x.status))) {
            const now = await roundRows(r.id);
            if (!ended.has(r.id)) ended.set(r.id, now);
            else expect(now).toEqual(ended.get(r.id));
        }
    }

    /** The commands, each a real usecase as a real person. */
    const C = {
        edit: (a: Reviewer, useList: boolean) =>
            cmd(`edit steps naming ${a}${useList ? ' and a list' : ''}`, (m) =>
                attempt(() =>
                    setWorkItemReviewSteps(as('OWNER'), m.item, {
                        steps: [
                            { name: 'First', mode: 'ALL', dueInWorkingDays: 2, memberIds: [users[a]], recipientListIds: [] },
                            { name: 'Second', mode: 'ANY', dueInWorkingDays: 3, memberIds: useList ? [] : [users[a === 'R1' ? 'R2' : 'R1']], recipientListIds: useList ? [listId] : [] },
                        ],
                    }),
                ),
            ),
        send: (a: Reviewer) =>
            cmd(`send (planning one step naming ${a} and a list first if nothing is planned)`, async (m) => {
                const { planned, open } = await live(m.item);
                if (!planned && !open) await attempt(() => setWorkItemReviewSteps(as('OWNER'), m.item, { steps: [{ name: 'Only', mode: 'ALL', dueInWorkingDays: 1, memberIds: [users[a]], recipientListIds: [listId] }] }));
                await attempt(() => sendWorkItemReview(as('OWNER'), m.item));
            }),
        respond: (k: number, outcome: 'SIGNED_OFF' | 'RETURNED', text: string) =>
            cmd(`the open step's reviewer #${k} responds ${outcome} (again, if they already have)`, async (m) => {
                const { step } = await live(m.item);
                if (!step) return;
                const asked = await prisma.workItemReviewer.findMany({ where: { stepId: step.id, withdrawnAt: null }, orderBy: { id: 'asc' }, select: { userId: true } });
                const who = (Object.keys(users) as (keyof typeof users)[]).find((u) => users[u] === asked[k % Math.max(asked.length, 1)]?.userId);
                if (who) await attempt(() => respondToReviewStep(as(who), m.item, step.id, { outcome, text: `${outcome} ${text}` }));
            }),
        skip: () =>
            cmd('skip the open step', async (m) => {
                const { step } = await live(m.item);
                if (step) await attempt(() => skipReviewStep(as('OWNER'), m.item, step.id));
            }),
        add: (r: Reviewer) =>
            cmd(`add ${r} to the open step`, async (m) => {
                const { step } = await live(m.item);
                if (step) await attempt(() => addReviewStepReviewer(as('OWNER'), m.item, step.id, { userId: users[r] }));
            }),
        withdraw: () => cmd('withdraw the round', (m) => attempt(() => withdrawWorkItemReview(as('OWNER'), m.item))),
        remove: (r: Reviewer) =>
            cmd(`remove ${r} from the workspace, then let them rejoin`, async () => {
                const membership = await prisma.tenantMembership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId, userId: users[r] } } });
                await attempt(() => removeTenantMember(as('OWNER'), { membershipId: membership.id }));
                await prisma.tenantMembership.upsert({ where: { tenantId_userId: { tenantId, userId: users[r] } }, create: { tenantId, userId: users[r], role: 'MEMBER' }, update: {} });
            }),
        assign: (r: Reviewer) => cmd(`make ${r} the assignee`, (m) => attempt(() => assignWorkItem(as('OWNER'), m.item, { assigneeId: users[r] }))),
        giveBack: () => cmd('give the item back to Ann', (m) => attempt(() => assignWorkItem(as('OWNER'), m.item, { assigneeId: users.ANN }))),
        close: (cat: 'DONE' | 'CANCELLED') => cmd(`close the item (${cat})`, (m) => attempt(() => setWorkItemState(as('OWNER'), m.item, { stateId: states[cat] }))),
        reopen: () => cmd('reopen the item', (m) => attempt(() => setWorkItemState(as('OWNER'), m.item, { stateId: states.STARTED }))),
        deleteRestore: () =>
            cmd('delete the item and restore it', async (m) => {
                await attempt(() => deleteWorkItem(as('OWNER'), m.item));
                await attempt(() => restoreWorkItem(as('OWNER'), m.item));
            }),
        rotate: () =>
            cmd(
                "rotate the workspace's DEK and run its sweep",
                async (m) => {
                    await rotateTenantDek({ tenantId, initiatedByUserId: users.OWNER });
                    const swept = await runTenantDekRotation({ tenantId, initiatedByUserId: users.OWNER });
                    expect(swept.previousEncryptedDekCleared).toBe(true);
                    m.rotated = true;
                },
                (m) => !m.rotated,
            ),
    };

    const reviewer = fc.constantFrom(...REVIEWERS);
    const outcome = fc.constantFrom('SIGNED_OFF', 'SIGNED_OFF', 'RETURNED') as fc.Arbitrary<'SIGNED_OFF' | 'RETURNED'>;
    const commands = [
        fc.tuple(reviewer, fc.boolean()).map(([a, useList]) => C.edit(a, useList)),
        reviewer.map(C.send),
        fc.tuple(fc.nat(7), outcome, fc.string({ minLength: 1, maxLength: 20 })).map(([k, o, text]) => C.respond(k, o, text)),
        fc.constant(C.skip()),
        reviewer.map(C.add),
        fc.constant(C.withdraw()),
        reviewer.map(C.remove),
        reviewer.map(C.assign),
        fc.constant(C.giveBack()),
        fc.constantFrom('DONE', 'CANCELLED').map((cat) => C.close(cat as 'DONE' | 'CANCELLED')),
        fc.constant(C.reopen()),
        fc.constant(C.deleteRestore()),
        fc.constant(C.rotate()),
    ];

    /** A command: its write, then the history check. */
    function cmd(label: string, write: (m: Model) => Promise<void>, applies: (m: Model) => boolean = () => true): fc.AsyncCommand<Model, Map<string, unknown>> {
        return {
            check: applies,
            run: async (m, ended) => {
                await write(m);
                await checkHistory(m.item, ended);
            },
            toString: () => label,
        };
    }

    async function freshRun(cmds: Iterable<fc.AsyncCommand<Model, Map<string, unknown>>>): Promise<Map<string, unknown>> {
        const item = await createWorkItem(as('OWNER'), { projectId, typeId, title: `history ${Math.random()}`, assigneeId: users.ANN, stateId: states.STARTED });
        const ended = new Map<string, unknown>();
        await fc.asyncModelRun(() => ({ model: { item: item.id, rotated: false }, real: ended }), cmds);
        return ended;
    }

    it('a scripted sequence ends rounds of every kind, rotates the key and keeps each as it ended (the property is not vacuous)', async () => {
        const ended = await freshRun([
            C.edit('R1', false),
            C.send('R1'),
            C.respond(0, 'RETURNED', 'not yet'),
            C.send('R1'),
            C.respond(0, 'SIGNED_OFF', 'fine'),
            C.respond(0, 'SIGNED_OFF', 'fine too'),
            C.send('R3'),
            C.respond(0, 'SIGNED_OFF', 'first thoughts'),
            C.withdraw(),
            C.rotate(),
            C.remove('R1'),
            C.send('R4'),
            C.assign('R4'),
            C.close('DONE'),
            C.reopen(),
            C.deleteRestore(),
            C.giveBack(),
            C.send('R2'),
            C.skip(),
        ]);
        const statuses = await prisma.workItemReviewRound.findMany({ where: { id: { in: [...ended.keys()] } }, select: { status: true } });
        expect(new Set(statuses.map((r) => r.status))).toEqual(new Set(['RETURNED', 'COMPLETED', 'WITHDRAWN']));
        const texts = await prisma.workItemReviewer.count({ where: { roundId: { in: [...ended.keys()] }, responseText: { not: null } } });
        expect(texts).toBeGreaterThanOrEqual(3);
    });

    // Random sequences: each test is a few, so each stays inside the integration project's 30 s per test.
    it.each([1, 2, 3, 4])('random sequence batch %i: every ended round stays as it ended', async () => {
        await fc.assert(
            fc.asyncProperty(fc.commands(commands, { maxCommands: 18, size: 'max' }), async (cmds) => {
                await freshRun(cmds);
            }),
            { numRuns: 3 },
        );
    });

    it('the audit chain verifies', async () => {
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });
});
