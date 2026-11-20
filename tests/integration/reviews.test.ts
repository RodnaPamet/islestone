/**
 * Review steps against a real Postgres (sub-phase 2.8a; ADR 0009; owner
 * decisions 148 to 165):
 *
 *   - the four tables are tenant tables: as `app_user` in workspace B nothing
 *     of A's is read, changed, removed or created (the two-tenant test
 *     `tests/guards/tenant-isolation-forward-lock.test.ts` names);
 *   - steps not yet opened are edited under `work_items.edit`, never naming
 *     the assignee (decision 158) or someone who cannot see the project, with
 *     `If-Match` on the round once there is one;
 *   - sending opens the first step, resolves its lists then (decision 154),
 *     stores its due day in working days (151) and clears waiting on (152);
 *     setting waiting on by hand is refused while a round is open (153);
 *   - only the named reviewer responds, as a person, never the assignee
 *     (158), every refusal audited; a response may change while its step is
 *     open (162) and is frozen after; one Return returns an "all" step at
 *     once (156); a returned round plans the next one, which waits to be sent
 *     (155); a completed round names the assignee as waited on;
 *   - skip and reviewer removal take standing (150); a step left with nobody
 *     stays open, flagged, never completed (zero is never complete);
 *   - every state path into a closed category, and every delete, withdraws
 *     an open round; member removal and an assignee change withdraw rows;
 *   - the notifications and the 08:00 reminders;
 *   - **H2: an ended round is never rewritten** — a byte-for-byte snapshot
 *     after later rounds, and direct writes as `app_user` refused by the
 *     triggers (the key rotations' re-wrap and the purge excepted);
 *   - the audit chain verifies.
 *
 * Written fresh for Islestone.
 */
import type { PrismaClient } from '@prisma/client';

import { processWorkItemDueNotifications } from '@/app-layer/jobs/work-item-due-notification';
import type { RequestContext } from '@/app-layer/types';
import { createProject } from '@/app-layer/usecases/project';
import { archiveRecipientList, createRecipientList } from '@/app-layer/usecases/recipient-list';
import {
    addReviewStepReviewer,
    getWorkItemReview,
    removeReviewStepReviewer,
    respondToReviewStep,
    sendWorkItemReview,
    setWorkItemReviewSteps,
    skipReviewStep,
    withdrawWorkItemReview,
} from '@/app-layer/usecases/review';
import { removeTenantMember } from '@/app-layer/usecases/tenant-admin';
import { createTeam } from '@/app-layer/usecases/team';
import {
    assignWorkItem,
    bulkSetWorkItemState,
    createWorkItem,
    deleteWorkItem,
    listWorkItems,
    restoreWorkItem,
    setWorkItemState,
    setWorkItemWaitingOn,
} from '@/app-layer/usecases/work-item';
import { addComment } from '@/app-layer/usecases/work-item-collab';
import { markWorkItemAnswer } from '@/app-layer/usecases/work-item-answer';
import { moveWorkItemOnBoard } from '@/app-layer/usecases/work-item-moves';
import { addWorkItemRelation } from '@/app-layer/usecases/work-item-relations';
import { addQuestionType, listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createWorkflowState, deleteWorkflowState, listWorkflowStates } from '@/app-layer/usecases/workflow-state';
import { verifyAuditChain } from '@/lib/audit';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `rvw${Date.now().toString(36)}`;

type Step = { name: string; mode: 'ALL' | 'ANY'; dueInWorkingDays: number; memberIds?: string[]; recipientListIds?: string[] };

describeFn('review steps', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let otherTenantId = '';
    let owner: RequestContext;
    let admin: RequestContext;
    let mia: RequestContext; // the assignee
    let max: RequestContext;
    let rae: RequestContext;
    let viewer: RequestContext;
    let guest: RequestContext;
    let outsider: RequestContext;
    let teamId = '';
    let projectId = '';
    let typeId = '';
    let legalListId = '';
    let doneStateId = '';
    let cancelledStateId = '';

    const steps = (s: Step[]) => ({ steps: s.map((x) => ({ memberIds: [], recipientListIds: [], ...x })) });
    const newItem = async (title: string, extra: Record<string, unknown> = {}) =>
        createWorkItem(owner, { projectId, typeId, title, assigneeId: mia.userId, ...extra } as Parameters<typeof createWorkItem>[1]);
    const audits = (entityId: string, action: string) => prisma.auditLog.count({ where: { tenantId, entityId, action } });
    const bells = (userId: string, type: string, workItemId?: string) =>
        prisma.notification.count({ where: { tenantId, userId, type: type as never, ...(workItemId ? { workItemId } : {}) } });
    const live = async (id: string) => (await getWorkItemReview(owner, id)).rounds[0]!;
    const twoSteps = (): Step[] => [
        { name: 'Peer review', mode: 'ALL', dueInWorkingDays: 2, memberIds: [max.userId, viewer.userId] },
        { name: 'Legal', mode: 'ANY', dueInWorkingDays: 3, recipientListIds: [legalListId] },
    ];

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        otherTenantId = (await createTenantWithDek({ name: `${TAG}-b`, slug: `${TAG}-b` })).id;
        const mk = async (role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | 'GUEST', n: string) => {
            const u = await prisma.user.create({ data: { email: `${n}-${TAG}@example.test`, name: n } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            return makeRequestContext(role, { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-${n}` });
        };
        owner = await mk('OWNER', 'Olive');
        admin = await mk('ADMIN', 'Ada');
        mia = await mk('MEMBER', 'Mia');
        max = await mk('MEMBER', 'Max');
        rae = await mk('MEMBER', 'Rae');
        viewer = await mk('VIEWER', 'Vic');
        guest = await mk('GUEST', 'Gus');
        const bea = await prisma.user.create({ data: { email: `bea-${TAG}@example.test`, name: 'Bea' } });
        await prisma.tenantMembership.create({ data: { tenantId: otherTenantId, userId: bea.id, role: 'OWNER' } });
        outsider = makeRequestContext('OWNER', { tenantId: otherTenantId, userId: bea.id, tenantSlug: `${TAG}-b` });
        teamId = (await createTeam(owner, { name: 'Core' })).id;
        projectId = (await createProject(owner, { teamId, name: 'Support', keyPrefix: 'SUP' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
        legalListId = (await createRecipientList(owner, null, { name: 'Legal', userIds: [rae.userId, mia.userId, guest.userId] })).id;
        const states = await listWorkflowStates(owner, teamId);
        doneStateId = states.find((s) => s.category === 'DONE')!.id;
        cancelledStateId = states.find((s) => s.category === 'CANCELLED')!.id;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    describe('editing the steps not yet opened', () => {
        it('plans a round, refuses the assignee, people who cannot see the project and stale versions', async () => {
            const item = await newItem('Edit me');
            await expect(setWorkItemReviewSteps(owner, item.id, steps([{ name: 'X', mode: 'ALL', dueInWorkingDays: 1, memberIds: [mia.userId] }]))).rejects.toMatchObject({
                status: 400,
                details: { reason: 'REVIEWER_IS_ASSIGNEE' },
            });
            await expect(setWorkItemReviewSteps(owner, item.id, steps([{ name: 'X', mode: 'ALL', dueInWorkingDays: 1, memberIds: [guest.userId] }]))).rejects.toMatchObject({
                status: 400,
                details: { reason: 'REVIEWER_NOT_ELIGIBLE' },
            });
            await expect(setWorkItemReviewSteps(owner, item.id, steps([{ name: 'X', mode: 'ALL', dueInWorkingDays: 1 }]))).rejects.toMatchObject({
                status: 400,
                details: { reason: 'STEP_HAS_NO_REVIEWERS' },
            });
            await expect(setWorkItemReviewSteps(viewer, item.id, steps(twoSteps()))).rejects.toMatchObject({ status: 403 });

            const planned = await setWorkItemReviewSteps(max, item.id, steps(twoSteps()));
            expect(planned.rounds).toHaveLength(1);
            const round = planned.rounds[0]!;
            expect(round).toMatchObject({ number: 1, status: 'PLANNED' });
            expect(round.steps.map((s) => [s.position, s.name, s.mode, s.status])).toEqual([
                [1, 'Peer review', 'ALL', 'PENDING'],
                [2, 'Legal', 'ANY', 'PENDING'],
            ]);
            expect(round.steps[1]!.lists).toEqual([{ id: legalListId, name: 'Legal', archived: false }]);
            expect(await audits(item.id, 'WORK_ITEM_REVIEW_STEPS_CHANGED')).toBe(1);

            // A second edit names the round's version (If-Match): 428 without, 409 when stale.
            await expect(setWorkItemReviewSteps(owner, item.id, steps(twoSteps()))).rejects.toMatchObject({ status: 428 });
            await expect(setWorkItemReviewSteps(owner, item.id, steps(twoSteps()), round.version + 5)).rejects.toMatchObject({ status: 409 });
            const again = await setWorkItemReviewSteps(owner, item.id, steps(twoSteps().slice(0, 1)), round.version);
            expect(again.rounds[0]!.steps).toHaveLength(1);
            expect(again.rounds[0]!.version).toBe(round.version + 1);
        });
    });

    describe('a round from send to completion', () => {
        let itemId = '';
        let round1Id = '';
        const snapshot = async (roundId: string) => ({
            round: await prisma.workItemReviewRound.findUniqueOrThrow({ where: { id: roundId } }),
            steps: await prisma.workItemReviewStep.findMany({ where: { roundId }, orderBy: { position: 'asc' } }),
            lists: await prisma.workItemReviewStepList.findMany({ where: { step: { roundId } }, orderBy: [{ stepId: 'asc' }, { recipientListId: 'asc' }] }),
            reviewers: await prisma.workItemReviewer.findMany({ where: { roundId }, orderBy: [{ stepId: 'asc' }, { userId: 'asc' }] }),
        });
        let round1AtItsEnd: Awaited<ReturnType<typeof snapshot>> | null = null;

        it('send opens the first step, stores its due day and clears waiting on', async () => {
            const item = await newItem('Review me', { waitingOnUserId: max.userId });
            itemId = item.id;
            const planned = await setWorkItemReviewSteps(owner, itemId, steps(twoSteps()));
            round1Id = planned.rounds[0]!.id;
            const sent = await sendWorkItemReview(owner, itemId);
            const round = sent.rounds[0]!;
            expect(round).toMatchObject({ status: 'OPEN', startedByUserId: owner.userId });
            const first = round.steps[0]!;
            expect(first.status).toBe('OPEN');
            expect(first.pendingUserIds.sort()).toEqual([max.userId, viewer.userId].sort());
            expect(first.dueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect([0, 6]).not.toContain(new Date(`${first.dueOn}T00:00:00Z`).getUTCDay());
            expect(sent.waitingOnReviewerIds.sort()).toEqual([max.userId, viewer.userId].sort());
            const row = await prisma.workItem.findUniqueOrThrow({ where: { id: itemId } });
            expect(row.waitingOnUserId).toBeNull();
            expect(await audits(itemId, 'WORK_ITEM_REVIEW_ROUND_STARTED')).toBe(1);
            expect(await audits(itemId, 'WORK_ITEM_REVIEW_STEP_OPENED')).toBe(1);
            expect(await bells(max.userId, 'WORK_ITEM_REVIEW_REQUESTED', itemId)).toBe(1);
            expect(await bells(viewer.userId, 'WORK_ITEM_REVIEW_REQUESTED', itemId)).toBe(1);
            // The immediate email (decision 161, the default) went to the outbox for each.
            expect(await prisma.notificationOutbox.count({ where: { tenantId, type: 'WORK_ITEM_REVIEW_REQUESTED' } })).toBeGreaterThanOrEqual(2);
        });

        it('refuses waiting on by hand while the round is open (decision 153)', async () => {
            await expect(setWorkItemWaitingOn(owner, itemId, { userId: rae.userId })).rejects.toMatchObject({ status: 409, details: { reason: 'REVIEW_ROUND_OPEN' } });
        });

        it('lists the item under reviewerId=me for a pending reviewer only', async () => {
            const forMax = await listWorkItems(max, { reviewerId: 'me' });
            expect(forMax.items.map((i) => i.id)).toContain(itemId);
            const forRae = await listWorkItems(rae, { reviewerId: 'me' });
            expect(forRae.items.map((i) => i.id)).not.toContain(itemId);
        });

        it('refuses the assignee, someone not named, an API key and a Return without text', async () => {
            const stepId = (await live(itemId)).steps[0]!.id;
            const deniedBefore = await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED', entityId: itemId } });
            await expect(respondToReviewStep(mia, itemId, stepId, { outcome: 'SIGNED_OFF' })).rejects.toMatchObject({ status: 403, details: { reason: 'REVIEWER_IS_ASSIGNEE' } });
            await expect(respondToReviewStep(rae, itemId, stepId, { outcome: 'SIGNED_OFF' })).rejects.toMatchObject({ status: 403, details: { reason: 'REVIEWER_NOT_NAMED' } });
            await expect(respondToReviewStep(owner, itemId, stepId, { outcome: 'SIGNED_OFF' })).rejects.toMatchObject({ status: 403 });
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED', entityId: itemId } })).toBe(deniedBefore + 3);
            const key = { ...max, apiKeyId: 'key-1' };
            await expect(respondToReviewStep(key, itemId, stepId, { outcome: 'SIGNED_OFF' })).rejects.toMatchObject({ status: 403, details: { reason: 'NOT_A_PERSON' } });
            await expect(respondToReviewStep(max, itemId, stepId, { outcome: 'RETURNED', text: '   ' })).rejects.toMatchObject({ status: 400, details: { reason: 'RETURN_NEEDS_TEXT' } });
        });

        it('a Viewer signs off and changes the response while the step is open (decision 162)', async () => {
            const stepId = (await live(itemId)).steps[0]!.id;
            const version = (await prisma.workItem.findUniqueOrThrow({ where: { id: itemId } })).version;
            const first = await respondToReviewStep(viewer, itemId, stepId, { outcome: 'SIGNED_OFF', text: 'Looks <b>fine</b>' });
            const vic = first.rounds[0]!.steps[0]!.reviewers.find((r) => r.userId === viewer.userId)!;
            expect(vic).toMatchObject({ outcome: 'SIGNED_OFF', responseText: 'Looks fine', itemVersionAt: version });
            const changed = await respondToReviewStep(viewer, itemId, stepId, { outcome: 'SIGNED_OFF', text: 'Looks fine to me' });
            expect(changed.rounds[0]!.steps[0]!.reviewers.find((r) => r.userId === viewer.userId)!.responseText).toBe('Looks fine to me');
            expect(changed.rounds[0]!.steps[0]!.status).toBe('OPEN');
            expect(await audits(itemId, 'WORK_ITEM_REVIEW_RESPONDED')).toBe(1);
            expect(await audits(itemId, 'WORK_ITEM_REVIEW_RESPONSE_CHANGED')).toBe(1);
            // The text is never in the audit trail.
            const entries = await prisma.auditLog.findMany({ where: { tenantId, entityId: itemId } });
            expect(JSON.stringify(entries)).not.toContain('Looks fine');
        });

        it('the last sign-off completes the step; the next opens with its list resolved now, never the assignee or a guest', async () => {
            const stepId = (await live(itemId)).steps[0]!.id;
            const after = await respondToReviewStep(max, itemId, stepId, { outcome: 'SIGNED_OFF' });
            const [peer, legal] = after.rounds[0]!.steps;
            expect(peer!.status).toBe('COMPLETED');
            expect(legal!.status).toBe('OPEN');
            expect(legal!.pendingUserIds).toEqual([rae.userId]);
            expect(legal!.reviewers.find((r) => r.userId === rae.userId)!.viaRecipientListId).toBe(legalListId);
            // The completed step is frozen: Vic can no longer change her response.
            await expect(respondToReviewStep(viewer, itemId, peer!.id, { outcome: 'RETURNED', text: 'second thoughts' })).rejects.toMatchObject({
                status: 409,
                details: { reason: 'REVIEW_STEP_NOT_OPEN' },
            });
            await expect(
                runInTenantContext(owner, (db) =>
                    db.$executeRaw`UPDATE "WorkItemReviewer" SET "outcome" = 'RETURNED', "responseText" = 'v2:x' WHERE "stepId" = ${peer!.id} AND "userId" = ${viewer.userId}`,
                ),
            ).rejects.toThrow(/REVIEW_RESPONSE_FROZEN/);
        });

        it('a Return ends the round, plans the next one unsent, and names the assignee as waited on', async () => {
            const legalId = (await live(itemId)).steps[1]!.id;
            const returned = await respondToReviewStep(rae, itemId, legalId, { outcome: 'RETURNED', text: 'Clause 4 is missing.' });
            const [next, ended] = returned.rounds;
            expect(ended).toMatchObject({ id: round1Id, status: 'RETURNED', endReason: 'RETURNED' });
            // Taken at its end; compared after rounds 2 and 3 (H2).
            round1AtItsEnd = await snapshot(round1Id);
            expect(next).toMatchObject({ number: 2, status: 'PLANNED' });
            expect(next!.steps.map((s) => [s.name, s.mode, s.status])).toEqual([
                ['Peer review', 'ALL', 'PENDING'],
                ['Legal', 'ANY', 'PENDING'],
            ]);
            // Named members are copied, never the previous round's resolved list people.
            expect(next!.steps[0]!.reviewers.map((r) => r.userId).sort()).toEqual([max.userId, viewer.userId].sort());
            expect(next!.steps[1]!.reviewers).toEqual([]);
            expect(next!.steps[1]!.lists.map((l) => l.id)).toEqual([legalListId]);
            expect((await prisma.workItem.findUniqueOrThrow({ where: { id: itemId } })).waitingOnUserId).toBe(mia.userId);
            expect(await bells(mia.userId, 'WORK_ITEM_REVIEW_RETURNED', itemId)).toBe(1);
            expect(await bells(owner.userId, 'WORK_ITEM_REVIEW_RETURNED', itemId)).toBe(1);
            expect(await bells(rae.userId, 'WORK_ITEM_REVIEW_RETURNED', itemId)).toBe(0);
            // A person may set waiting on again once the round has ended.
            await setWorkItemWaitingOn(owner, itemId, { userId: max.userId });
        });

        it('in an "all" step one Return returns it at once and withdraws the others (decision 156)', async () => {
            await sendWorkItemReview(owner, itemId);
            const round2 = await live(itemId);
            expect(round2).toMatchObject({ number: 2, status: 'OPEN' });
            const peer = round2.steps[0]!;
            const after = await respondToReviewStep(max, itemId, peer.id, { outcome: 'RETURNED', text: 'Tests fail.' });
            const ended = after.rounds.find((r) => r.number === 2)!;
            expect(ended.status).toBe('RETURNED');
            const vic = ended.steps[0]!.reviewers.find((r) => r.userId === viewer.userId)!;
            expect(vic).toMatchObject({ outcome: null, withdrawnReason: 'STEP_ENDED' });
            expect(ended.steps[1]!.status).toBe('WITHDRAWN');
            expect(after.rounds[0]).toMatchObject({ number: 3, status: 'PLANNED' });
        });

        it('round 3 completes: every step signed off; the assignee is waited on and told', async () => {
            await sendWorkItemReview(owner, itemId);
            const peer = (await live(itemId)).steps[0]!;
            await respondToReviewStep(max, itemId, peer.id, { outcome: 'SIGNED_OFF' });
            await respondToReviewStep(viewer, itemId, peer.id, { outcome: 'SIGNED_OFF' });
            const legal = (await live(itemId)).steps[1]!;
            const done = await respondToReviewStep(rae, itemId, legal.id, { outcome: 'SIGNED_OFF' });
            expect(done.rounds[0]).toMatchObject({ number: 3, status: 'COMPLETED', endReason: 'COMPLETED' });
            expect(done.rounds).toHaveLength(3);
            expect(done.waitingOnReviewerIds).toEqual([]);
            expect((await prisma.workItem.findUniqueOrThrow({ where: { id: itemId } })).waitingOnUserId).toBe(mia.userId);
            expect(await bells(mia.userId, 'WORK_ITEM_REVIEW_COMPLETED', itemId)).toBe(1);
            // Nothing live: a send needs a new plan.
            await expect(sendWorkItemReview(owner, itemId)).rejects.toMatchObject({ status: 409 });
        });

        describe('H2: an ended round is never rewritten', () => {

            it('round 1 is byte for byte what it was when it ended, after rounds 2 and 3', async () => {
                // Round 1 ended with the Return above; rounds 2 and 3 have run since.
                expect(round1AtItsEnd).not.toBeNull();
                const now = await snapshot(round1Id);
                expect(now).toEqual(round1AtItsEnd);
                expect(now.round.status).toBe('RETURNED');
                expect(now.reviewers.map((r) => [r.userId === rae.userId ? 'rae' : r.userId === max.userId ? 'max' : 'vic', r.outcome]).sort()).toEqual([
                    ['max', 'SIGNED_OFF'],
                    ['rae', 'RETURNED'],
                    ['vic', 'SIGNED_OFF'],
                ]);
            });

            it('refuses every direct write to an ended round as app_user', async () => {
                const before = await snapshot(round1Id);
                const step = before.steps[0]!;
                const reviewer = before.reviewers[0]!;
                const writes: Array<[string, () => Promise<unknown>]> = [
                    ['a response', () => runInTenantContext(owner, (db) => db.$executeRaw`UPDATE "WorkItemReviewer" SET "outcome" = 'RETURNED', "responseText" = 'v2:x' WHERE "id" = ${reviewer.id}`)],
                    ['a withdrawal', () => runInTenantContext(owner, (db) => db.$executeRaw`UPDATE "WorkItemReviewer" SET "withdrawnAt" = now(), "withdrawnReason" = 'STEP_ENDED', "outcome" = NULL WHERE "id" = ${reviewer.id}`)],
                    ['a step name', () => runInTenantContext(owner, (db) => db.$executeRaw`UPDATE "WorkItemReviewStep" SET "name" = 'Rewritten' WHERE "id" = ${step.id}`)],
                    ['a step status', () => runInTenantContext(owner, (db) => db.$executeRaw`UPDATE "WorkItemReviewStep" SET "status" = 'OPEN', "endedAt" = NULL WHERE "id" = ${step.id}`)],
                    ['a round status', () => runInTenantContext(owner, (db) => db.$executeRaw`UPDATE "WorkItemReviewRound" SET "status" = 'COMPLETED', "endReason" = 'COMPLETED' WHERE "id" = ${round1Id}`)],
                    ['a step delete', () => runInTenantContext(owner, (db) => db.$executeRaw`DELETE FROM "WorkItemReviewStep" WHERE "id" = ${step.id}`)],
                    ['a reviewer delete', () => runInTenantContext(owner, (db) => db.$executeRaw`DELETE FROM "WorkItemReviewer" WHERE "id" = ${reviewer.id}`)],
                    ['a round delete', () => runInTenantContext(owner, (db) => db.$executeRaw`DELETE FROM "WorkItemReviewRound" WHERE "id" = ${round1Id}`)],
                    ['a new step', () => runInTenantContext(owner, (db) => db.$executeRaw`INSERT INTO "WorkItemReviewStep" ("id","tenantId","roundId","workItemId","position","name","dueInWorkingDays") VALUES ('planted', ${tenantId}, ${round1Id}, ${itemId}, 9, 'Planted', 1)`)],
                    ['a new reviewer', () => runInTenantContext(owner, (db) => db.$executeRaw`INSERT INTO "WorkItemReviewer" ("id","tenantId","stepId","roundId","workItemId","userId","addedById") VALUES ('planted', ${tenantId}, ${step.id}, ${round1Id}, ${itemId}, ${rae.userId}, ${owner.userId})`)],
                ];
                for (const [what, write] of writes) {
                    await expect(write()).rejects.toThrow(/REVIEW_|REVIEWER_|permission denied|duplicate/);
                    void what;
                }
                expect(await snapshot(round1Id)).toEqual(before);
            });

            it('admits the key rotations\' re-wrap of the response text, and nothing beside it', async () => {
                const rows = await prisma.workItemReviewer.findMany({ where: { roundId: round1Id, responseText: { not: null } }, orderBy: { id: 'asc' } });
                expect(rows.length).toBeGreaterThanOrEqual(1);
                const row = rows.find((r) => r.userId === rae.userId)!;
                const original = row.responseText!;
                const other = (await prisma.workItemReviewer.findFirstOrThrow({ where: { tenantId, responseText: { not: null }, id: { not: row.id } } })).responseText!;
                expect(original).toMatch(/^v\d+:/);
                // One ciphertext for another, every other column unchanged: passes.
                await runInTenantContext(owner, (db) => db.$executeRaw`UPDATE "WorkItemReviewer" SET "responseText" = ${other} WHERE "id" = ${row.id}`);
                await runInTenantContext(owner, (db) => db.$executeRaw`UPDATE "WorkItemReviewer" SET "responseText" = ${original} WHERE "id" = ${row.id}`);
                // Plaintext in its place, or the text with another column, is refused.
                await expect(runInTenantContext(owner, (db) => db.$executeRaw`UPDATE "WorkItemReviewer" SET "responseText" = 'plain' WHERE "id" = ${row.id}`)).rejects.toThrow(/REVIEW_ROUND_ENDED/);
                await expect(
                    runInTenantContext(owner, (db) => db.$executeRaw`UPDATE "WorkItemReviewer" SET "responseText" = ${other}, "itemVersionAt" = 99 WHERE "id" = ${row.id}`),
                ).rejects.toThrow(/REVIEW_ROUND_ENDED/);
                expect((await prisma.workItemReviewer.findUniqueOrThrow({ where: { id: row.id } })).responseText).toBe(original);
            });
        });
    });

    describe('skip, standing and "zero is never complete"', () => {
        it('a member without standing is refused a skip and a reviewer removal (audited); an admin skips', async () => {
            const item = await newItem('Skip me');
            await setWorkItemReviewSteps(owner, item.id, steps(twoSteps()));
            await sendWorkItemReview(owner, item.id);
            const peer = (await live(item.id)).steps[0]!;
            await expect(skipReviewStep(max, item.id, peer.id)).rejects.toMatchObject({ status: 403, details: { reason: 'REVIEW_STANDING_REQUIRED' } });
            await expect(removeReviewStepReviewer(rae, item.id, peer.id, viewer.userId)).rejects.toMatchObject({ status: 403 });
            const skipped = await skipReviewStep(admin, item.id, peer.id);
            const round = skipped.rounds[0]!;
            expect(round.steps[0]).toMatchObject({ status: 'SKIPPED', skipReason: 'PERSON_SKIPPED', skippedByUserId: admin.userId });
            expect(round.steps[0]!.reviewers.every((r) => r.withdrawnReason === 'STEP_ENDED')).toBe(true);
            expect(round.steps[1]!.status).toBe('OPEN');
            expect(await audits(item.id, 'WORK_ITEM_REVIEW_STEP_SKIPPED')).toBe(1);
            // The assignee may skip too: the last step completes the round by a skip.
            const done = await skipReviewStep(mia, item.id, round.steps[1]!.id);
            expect(done.rounds[0]).toMatchObject({ status: 'COMPLETED' });
        });

        it('a step whose last reviewer left stays open, flagged, and closes only by a skip (NO_REVIEWERS_LEFT)', async () => {
            const leaver = await prisma.user.create({ data: { email: `leaver-${TAG}@example.test`, name: 'Lee' } });
            const membership = await prisma.tenantMembership.create({ data: { tenantId, userId: leaver.id, role: 'MEMBER' } });
            const item = await newItem('Left behind');
            await setWorkItemReviewSteps(owner, item.id, steps([{ name: 'Solo', mode: 'ALL', dueInWorkingDays: 1, memberIds: [leaver.id] }]));
            await sendWorkItemReview(owner, item.id);
            await removeTenantMember(owner, { membershipId: membership.id });
            const round = await live(item.id);
            const solo = round.steps[0]!;
            expect(solo.status).toBe('OPEN');
            expect(solo.noReviewersLeft).toBe(true);
            expect(solo.reviewers[0]).toMatchObject({ userId: leaver.id, withdrawnReason: 'MEMBER_REMOVED', outcome: null });
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'WORK_ITEM_REVIEWERS_WITHDRAWN_ON_MEMBER_REMOVAL' } })).toBe(1);
            // The assignee is told the step has nobody left (the sender too, unless it was them).
            expect(await bells(mia.userId, 'WORK_ITEM_REVIEW_REQUESTED', item.id)).toBe(1);
            const closed = await skipReviewStep(owner, item.id, solo.id);
            expect(closed.rounds[0]!.steps[0]).toMatchObject({ status: 'SKIPPED', skipReason: 'NO_REVIEWERS_LEFT' });
            expect(closed.rounds[0]!.status).toBe('COMPLETED');
        });

        it('send refuses a step that resolves to nobody (NO_REVIEWERS): an archived list names nobody', async () => {
            const empty = await createRecipientList(owner, null, { name: 'Soon gone', userIds: [rae.userId] });
            const item = await newItem('Nobody');
            await setWorkItemReviewSteps(owner, item.id, steps([
                { name: 'First', mode: 'ALL', dueInWorkingDays: 1, memberIds: [max.userId] },
                { name: 'Gone', mode: 'ANY', dueInWorkingDays: 1, recipientListIds: [empty.id] },
            ]));
            await archiveRecipientList(owner, null, empty.id);
            await expect(sendWorkItemReview(owner, item.id)).rejects.toMatchObject({ status: 409, details: { reason: 'NO_REVIEWERS' } });
            expect((await live(item.id)).status).toBe('PLANNED');
        });

        it('a response and a skip racing: exactly one lands', async () => {
            const item = await newItem('Race');
            await setWorkItemReviewSteps(owner, item.id, steps([{ name: 'Only', mode: 'ALL', dueInWorkingDays: 1, memberIds: [max.userId] }]));
            await sendWorkItemReview(owner, item.id);
            const stepId = (await live(item.id)).steps[0]!.id;
            const results = await Promise.allSettled([
                respondToReviewStep(max, item.id, stepId, { outcome: 'SIGNED_OFF' }),
                skipReviewStep(owner, item.id, stepId),
            ]);
            expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
            const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
            expect(rejected.reason).toMatchObject({ status: 409 });
            const step = (await getWorkItemReview(owner, item.id)).rounds[0]!.steps[0]!;
            expect(['COMPLETED', 'SKIPPED']).toContain(step.status);
        });

        it('adding a reviewer to an open step asks them at once; removing a pending one (with standing) can complete it', async () => {
            const item = await newItem('Add and remove');
            await setWorkItemReviewSteps(owner, item.id, steps([{ name: 'Pair', mode: 'ALL', dueInWorkingDays: 1, memberIds: [max.userId] }]));
            await sendWorkItemReview(owner, item.id);
            const stepId = (await live(item.id)).steps[0]!.id;
            await expect(addReviewStepReviewer(owner, item.id, stepId, { userId: mia.userId })).rejects.toMatchObject({ status: 400, details: { reason: 'REVIEWER_IS_ASSIGNEE' } });
            const added = await addReviewStepReviewer(max, item.id, stepId, { userId: rae.userId });
            expect(added.rounds[0]!.steps[0]!.pendingUserIds.sort()).toEqual([max.userId, rae.userId].sort());
            expect(await bells(rae.userId, 'WORK_ITEM_REVIEW_REQUESTED', item.id)).toBe(1);
            await respondToReviewStep(max, item.id, stepId, { outcome: 'SIGNED_OFF' });
            const removed = await removeReviewStepReviewer(owner, item.id, stepId, rae.userId);
            expect(removed.rounds[0]).toMatchObject({ status: 'COMPLETED' });
            expect(removed.rounds[0]!.steps[0]!.reviewers.find((r) => r.userId === rae.userId)!.withdrawnReason).toBe('REMOVED_BY_PERSON');
            // A withdrawn person is not added back to the same step.
            await expect(addReviewStepReviewer(owner, item.id, stepId, { userId: rae.userId })).rejects.toMatchObject({ status: 409 });
        });
    });

    describe('decision 158: an assignee change withdraws the new assignee as a reviewer', () => {
        it('withdraws their pending row (BECAME_ASSIGNEE), audited, and settles the step', async () => {
            const item = await newItem('Reassign');
            await setWorkItemReviewSteps(owner, item.id, steps([{ name: 'Pair', mode: 'ALL', dueInWorkingDays: 1, memberIds: [max.userId, rae.userId] }]));
            await sendWorkItemReview(owner, item.id);
            const stepId = (await live(item.id)).steps[0]!.id;
            await respondToReviewStep(max, item.id, stepId, { outcome: 'SIGNED_OFF' });
            await assignWorkItem(owner, item.id, { assigneeId: rae.userId });
            const round = (await getWorkItemReview(owner, item.id)).rounds[0]!;
            expect(round.steps[0]!.reviewers.find((r) => r.userId === rae.userId)!.withdrawnReason).toBe('BECAME_ASSIGNEE');
            // Max had signed off and nobody else is asked: the step and the round complete.
            expect(round.status).toBe('COMPLETED');
            expect(await audits(item.id, 'WORK_ITEM_REVIEWER_WITHDRAWN')).toBe(1);
            expect((await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } })).waitingOnUserId).toBe(rae.userId);
        });
    });

    describe('every close and every delete withdraws an open round (decision 149)', () => {
        const openRound = async (title: string, extra: Record<string, unknown> = {}) => {
            const item = await newItem(title, extra);
            await setWorkItemReviewSteps(owner, item.id, steps([{ name: 'One', mode: 'ALL', dueInWorkingDays: 1, memberIds: [max.userId] }]));
            await sendWorkItemReview(owner, item.id);
            return item;
        };
        const expectWithdrawn = async (id: string, reason: 'ITEM_CLOSED' | 'ITEM_DELETED') => {
            const round = await prisma.workItemReviewRound.findFirstOrThrow({ where: { workItemId: id }, orderBy: { number: 'desc' } });
            expect(round).toMatchObject({ status: 'WITHDRAWN', endReason: reason });
            const reviewers = await prisma.workItemReviewer.findMany({ where: { roundId: round.id } });
            expect(reviewers.every((r) => r.withdrawnReason === 'STEP_ENDED')).toBe(true);
            expect((await prisma.workItemReviewStep.findMany({ where: { roundId: round.id } })).every((s) => s.status === 'WITHDRAWN')).toBe(true);
        };

        it('a state change, and a reopen does not reopen it', async () => {
            const item = await openRound('Close single');
            await setWorkItemState(owner, item.id, { stateId: doneStateId });
            await expectWithdrawn(item.id, 'ITEM_CLOSED');
            const states = await listWorkflowStates(owner, teamId);
            await setWorkItemState(owner, item.id, { stateId: states.find((s) => s.category === 'UNSTARTED')!.id });
            expect((await getWorkItemReview(owner, item.id)).rounds[0]!.status).toBe('WITHDRAWN');
        });

        it('a bulk state change', async () => {
            const item = await openRound('Close bulk');
            await bulkSetWorkItemState(owner, { workItemIds: [item.id], stateCategory: 'CANCELLED' });
            await expectWithdrawn(item.id, 'ITEM_CLOSED');
        });

        it('a board move', async () => {
            const item = await openRound('Close board');
            await moveWorkItemOnBoard(owner, item.id, { stateId: cancelledStateId });
            await expectWithdrawn(item.id, 'ITEM_CLOSED');
        });

        it('a duplicate mark', async () => {
            const original = await newItem('Original');
            const item = await openRound('Close duplicate');
            await addWorkItemRelation(owner, item.id, { type: 'DUPLICATES', toId: original.id });
            await expectWithdrawn(item.id, 'ITEM_CLOSED');
        });

        it("a state's delete into a closed state", async () => {
            const extra = await createWorkflowState(owner, teamId, { name: 'Parked', category: 'STARTED' });
            const item = await openRound('Close state delete');
            await moveWorkItemOnBoard(owner, item.id, { stateId: extra.id });
            expect((await live(item.id)).status).toBe('OPEN');
            await deleteWorkflowState(owner, extra.id, { moveToStateId: doneStateId });
            await expectWithdrawn(item.id, 'ITEM_CLOSED');
        });

        it('the answer of a question-like type', async () => {
            const question = await addQuestionType(owner, { name: `Question ${TAG}` });
            const item = await openRound('Close answer', { typeId: question.id, dueDate: '2099-01-01', waitingOnUserId: max.userId });
            const comment = await addComment(rae, item.id, { body: 'The answer' });
            await markWorkItemAnswer(owner, item.id, { commentId: comment.id });
            await expectWithdrawn(item.id, 'ITEM_CLOSED');
        });

        it('a delete, and a restore does not reopen it', async () => {
            const item = await openRound('Delete me');
            await deleteWorkItem(owner, item.id);
            await expectWithdrawn(item.id, 'ITEM_DELETED');
            await restoreWorkItem(owner, item.id);
            expect((await getWorkItemReview(owner, item.id)).rounds[0]!.status).toBe('WITHDRAWN');
        });

        it('a person withdrawing the round plans the next one; a planned round survives a close', async () => {
            const item = await openRound('Withdraw me');
            const after = await withdrawWorkItemReview(owner, item.id);
            expect(after.rounds.map((r) => [r.number, r.status])).toEqual([
                [2, 'PLANNED'],
                [1, 'WITHDRAWN'],
            ]);
            expect(after.rounds[1]!.endReason).toBe('WITHDRAWN_BY_PERSON');
            await setWorkItemState(owner, item.id, { stateId: doneStateId });
            expect((await getWorkItemReview(owner, item.id)).rounds[0]!.status).toBe('PLANNED');
            await expect(sendWorkItemReview(owner, item.id)).rejects.toMatchObject({ status: 409, details: { reason: 'ITEM_CLOSED' } });
        });

        it('the purge removes rounds with the item', async () => {
            const item = await openRound('Purge me');
            await prisma.workItem.delete({ where: { id: item.id } });
            expect(await prisma.workItemReviewRound.count({ where: { workItemId: item.id } })).toBe(0);
            expect(await prisma.workItemReviewer.count({ where: { workItemId: item.id } })).toBe(0);
        });
    });

    describe('the 08:00 reminders (decision 161)', () => {
        it('reminds pending reviewers on the due day, the working day before and once when overdue', async () => {
            const item = await newItem('Remind me');
            await setWorkItemReviewSteps(owner, item.id, steps([{ name: 'Due', mode: 'ALL', dueInWorkingDays: 2, memberIds: [max.userId, rae.userId] }]));
            await sendWorkItemReview(owner, item.id);
            const step = (await live(item.id)).steps[0]!;
            await respondToReviewStep(rae, item.id, step.id, { outcome: 'SIGNED_OFF' });
            const dueOn = new Date(`${step.dueOn}T09:00:00Z`);
            const run = (at: Date) => processWorkItemDueNotifications({ tenantId, now: at, tz: 'UTC' });
            await run(dueOn);
            await run(dueOn);
            expect(await bells(max.userId, 'WORK_ITEM_REVIEW_DUE', item.id)).toBe(1);
            expect(await bells(rae.userId, 'WORK_ITEM_REVIEW_DUE', item.id)).toBe(0);
            await run(new Date(dueOn.getTime() + 3 * 86_400_000));
            await run(new Date(dueOn.getTime() + 4 * 86_400_000));
            expect(await bells(max.userId, 'WORK_ITEM_REVIEW_DUE', item.id)).toBe(2);
        });
    });

    describe('two-tenant isolation as app_user', () => {
        let itemId = '';
        beforeAll(async () => {
            const item = await newItem('Isolated');
            itemId = item.id;
            await setWorkItemReviewSteps(owner, itemId, steps(twoSteps()));
        });
        const snapshotA = async () => ({
            rounds: await prisma.workItemReviewRound.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
            steps: await prisma.workItemReviewStep.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
            lists: await prisma.workItemReviewStepList.findMany({ where: { tenantId }, orderBy: [{ stepId: 'asc' }, { recipientListId: 'asc' }] }),
            reviewers: await prisma.workItemReviewer.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
        });

        it("B reads and counts none of A's rows", async () => {
            expect(await runInTenantContext(outsider, (db) => db.workItemReviewRound.count({}))).toBe(0);
            expect(await runInTenantContext(outsider, (db) => db.workItemReviewStep.count({}))).toBe(0);
            expect(await runInTenantContext(outsider, (db) => db.workItemReviewStepList.count({}))).toBe(0);
            expect(await runInTenantContext(outsider, (db) => db.workItemReviewer.count({}))).toBe(0);
            expect(await runInTenantContext(owner, (db) => db.workItemReviewStep.count({ where: { workItemId: itemId } }))).toBe(2);
            await expect(getWorkItemReview(outsider, itemId)).rejects.toMatchObject({ status: 404 });
        });

        it("B changes or removes none of A's rows and cannot create one in A", async () => {
            const before = await snapshotA();
            const r1 = await runInTenantContext(outsider, (db) => db.workItemReviewStep.updateMany({ where: { tenantId }, data: { name: 'Hijacked' } }));
            expect(r1.count).toBe(0);
            const r2 = await runInTenantContext(outsider, (db) => db.workItemReviewStep.deleteMany({ where: { tenantId } }));
            expect(r2.count).toBe(0);
            const r3 = await runInTenantContext(outsider, (db) => db.workItemReviewStepList.deleteMany({ where: { tenantId } }));
            expect(r3.count).toBe(0);
            const r4 = await runInTenantContext(outsider, (db) => db.workItemReviewRound.updateMany({ where: { tenantId }, data: { version: 99 } }));
            expect(r4.count).toBe(0);
            const r5 = await runInTenantContext(outsider, (db) => db.workItemReviewer.updateMany({ where: { tenantId }, data: { withdrawnAt: new Date(), withdrawnReason: 'NOT_ELIGIBLE' } }));
            expect(r5.count).toBe(0);
            expect(await snapshotA()).toEqual(before);
            const round = before.rounds.find((r) => r.workItemId === itemId)!;
            await expect(
                runInTenantContext(outsider, (db) => db.workItemReviewRound.create({ data: { tenantId, workItemId: itemId, number: 9, createdById: outsider.userId } })),
            ).rejects.toThrow();
            await expect(
                runInTenantContext(outsider, (db) =>
                    db.workItemReviewStep.create({ data: { tenantId, roundId: round.id, workItemId: itemId, position: 9, name: 'Planted', dueInWorkingDays: 1 } }),
                ),
            ).rejects.toThrow();
        });
    });

    it('the audit chain verifies', async () => {
        expect((await verifyAuditChain(tenantId, prisma)).valid).toBe(true);
    });
});
