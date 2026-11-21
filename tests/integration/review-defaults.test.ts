/**
 * Default review steps per type and the per-type Done check, against a real
 * Postgres (sub-phase 2.8c; ADR 0009 §14 and §15; owner decisions 149, 158,
 * 159 and 160):
 *
 *   - the two tables are tenant tables: as `app_user` in workspace B nothing
 *     of A's is read, changed, removed or created (the two-tenant test
 *     `tests/guards/tenant-isolation-forward-lock.test.ts` names);
 *   - the route matrix: reads under `projects.view`, a change under
 *     `admin.manage`, every key refusal a 403 with an `AUTHZ_DENIED` row;
 *   - setting the defaults: active members and the workspace's live lists
 *     only, each step naming somebody, audited with ids and counts;
 *   - every create path copies them into round 1, PLANNED, never opened: the
 *     dialog and the API, template sub-items, project-template starter items,
 *     intake accept and repeat copies; the assignee and ineligible members
 *     are dropped (decision 158), an archived list too, and named;
 *   - a later change to the defaults changes no item; a removed member leaves
 *     every default (the membership FK cascades);
 *   - the Done check: every state path into Done (single, bulk, the board,
 *     the answer, a state's delete, a create into Done) is refused 409
 *     `REVIEW_INCOMPLETE` while the newest round with steps has not completed;
 *     cancelling and a move between Done states are never held; a type that
 *     does not require review holds nothing, nor does an item with no round;
 *   - the audit chain verifies.
 *
 * Written fresh for Islestone.
 */
import { NextRequest } from 'next/server';
import type { PrismaClient, Role } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';

const getTenantCtxMock = jest.fn<Promise<RequestContext>, [unknown, unknown]>();
jest.mock('@/app-layer/context', () => ({
    getTenantCtx: (params: unknown, req: unknown) => getTenantCtxMock(params, req),
}));

import { addDays, dayKey } from '@/app-layer/domain/cycle';
import { todayInTz } from '@/app-layer/notifications/work-item-due';
import { processWorkItemRecurrence } from '@/app-layer/jobs/work-item-recurrence';
import { setTypeField } from '@/app-layer/usecases/field-set';
import { createIntakeForm } from '@/app-layer/usecases/intake-form';
import { acceptIntakeRequest, sendIntakeRequest } from '@/app-layer/usecases/intake-request';
import { setProjectIntake } from '@/app-layer/usecases/intake-settings';
import { createProject } from '@/app-layer/usecases/project';
import { saveProjectAsTemplate } from '@/app-layer/usecases/project-template';
import { archiveRecipientList, createRecipientList } from '@/app-layer/usecases/recipient-list';
import { setWorkItemRecurrence } from '@/app-layer/usecases/recurrence';
import { getWorkItemReview, respondToReviewStep, sendWorkItemReview, setWorkItemReviewSteps, withdrawWorkItemReview } from '@/app-layer/usecases/review';
import { getTypeReviewSteps, setTypeReviewSteps } from '@/app-layer/usecases/review-defaults';
import { removeTenantMember } from '@/app-layer/usecases/tenant-admin';
import { createTeam } from '@/app-layer/usecases/team';
import { bulkSetWorkItemState, createWorkItem, getWorkItem, listWorkItems, setWorkItemState } from '@/app-layer/usecases/work-item';
import { markWorkItemAnswer } from '@/app-layer/usecases/work-item-answer';
import { addComment } from '@/app-layer/usecases/work-item-collab';
import { moveWorkItemOnBoard } from '@/app-layer/usecases/work-item-moves';
import { createWorkItemTemplate } from '@/app-layer/usecases/work-item-template';
import { createWorkItemType } from '@/app-layer/usecases/work-item-type';
import { createWorkflowState, deleteWorkflowState, listWorkflowStates } from '@/app-layer/usecases/workflow-state';
import { verifyAuditChain } from '@/lib/audit';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `rdef${Date.now().toString(36)}`;
const ROUTE = 'src/app/api/t/[tenantSlug]/work-item-types/[typeId]/review-steps/route.ts';
const ROLES: readonly Role[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST'];

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type StepIn = { name: string; mode: 'ALL' | 'ANY'; dueInWorkingDays: number; memberIds?: string[]; recipientListIds?: string[] };

function request(method: string, p: string, body?: unknown): NextRequest {
    return new NextRequest(`http://localhost/api/t/${TAG}${p}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.7' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

const held = { status: 409, details: { reason: 'REVIEW_INCOMPLETE' } };

describeFn('default review steps per type and the Done check', () => {
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
    let legalListId = '';
    let doneStateId = '';
    let otherDoneStateId = '';
    let cancelledStateId = '';
    let startedStateId = '';
    let typeSeq = 0;

    const stepsOf = (s: StepIn[]) => s.map((x) => ({ memberIds: [], recipientListIds: [], ...x }));
    const defaults = (): StepIn[] => [
        { name: 'Peer review', mode: 'ALL', dueInWorkingDays: 2, memberIds: [max.userId, mia.userId] },
        { name: 'Legal', mode: 'ANY', dueInWorkingDays: 3, recipientListIds: [legalListId] },
    ];
    /** A type with the two default steps; `required` for the Done check. */
    const reviewedType = async (required: boolean, steps: StepIn[] = defaults()) => {
        typeSeq += 1;
        const type = await createWorkItemType(owner, { name: `Reviewed ${typeSeq} ${TAG}` });
        await setTypeReviewSteps(owner, type.id, { reviewRequiredForDone: required, steps: stepsOf(steps) });
        return type.id;
    };
    const roundsOf = (workItemId: string) =>
        prisma.workItemReviewRound.findMany({
            where: { tenantId, workItemId },
            orderBy: { number: 'asc' },
            include: { steps: { orderBy: { position: 'asc' }, include: { reviewers: true, lists: true } } },
        });
    /** Send round 1 and sign every step off, as the people named. */
    const completeReview = async (workItemId: string) => {
        await sendWorkItemReview(owner, workItemId);
        for (;;) {
            const live = (await getWorkItemReview(owner, workItemId)).rounds[0]!;
            if (live.status !== 'OPEN') return live.status;
            const step = live.steps.find((s) => s.status === 'OPEN')!;
            for (const userId of step.pendingUserIds) {
                // guardrail-allow: n+1 — a test drive, at most a few reviewers.
                const ctx = [max, rae, admin, viewer].find((c) => c.userId === userId)!;
                await respondToReviewStep(ctx, workItemId, step.id, { outcome: 'SIGNED_OFF' });
                const after = (await getWorkItemReview(owner, workItemId)).rounds[0]!;
                if (after.steps.find((s) => s.id === step.id)!.status !== 'OPEN') break;
            }
        }
    };

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        otherTenantId = (await createTenantWithDek({ name: `${TAG}-b`, slug: `${TAG}-b` })).id;
        const mk = async (role: Role, n: string) => {
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
        legalListId = (await createRecipientList(owner, null, { name: 'Legal', userIds: [rae.userId] })).id;
        const states = await listWorkflowStates(owner, teamId);
        doneStateId = states.find((s) => s.category === 'DONE')!.id;
        cancelledStateId = states.find((s) => s.category === 'CANCELLED')!.id;
        startedStateId = states.find((s) => s.category === 'STARTED')!.id;
        otherDoneStateId = (await createWorkflowState(owner, teamId, { name: 'Shipped', category: 'DONE' })).id;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    describe('setting the defaults', () => {
        it('stores them in order with whom each names, and audits ids and counts', async () => {
            const typeId = await reviewedType(true);
            const read = await getTypeReviewSteps(viewer, typeId);
            expect(read.reviewRequiredForDone).toBe(true);
            expect(read.steps.map((s) => [s.position, s.name, s.mode, s.dueInWorkingDays])).toEqual([
                [1, 'Peer review', 'ALL', 2],
                [2, 'Legal', 'ANY', 3],
            ]);
            expect(read.steps[0]!.memberIds.sort()).toEqual([max.userId, mia.userId].sort());
            expect(read.steps[1]!.lists).toEqual([{ id: legalListId, name: 'Legal', archived: false }]);
            const entry = await prisma.auditLog.findFirst({ where: { tenantId, entityId: typeId, action: 'WORK_ITEM_TYPE_REVIEW_STEPS_SET' } });
            expect(entry?.metadataJson).toMatchObject({ stepCount: 2, stepCountBefore: 0, reviewRequiredForDone: true });
            expect(JSON.stringify(entry?.metadataJson)).not.toContain('Peer review');
            // Replaced as a whole.
            await setTypeReviewSteps(admin, typeId, { reviewRequiredForDone: false, steps: stepsOf([{ name: 'Only', mode: 'ANY', dueInWorkingDays: 1, memberIds: [rae.userId] }]) });
            const after = await getTypeReviewSteps(owner, typeId);
            expect(after.reviewRequiredForDone).toBe(false);
            expect(after.steps.map((s) => s.name)).toEqual(['Only']);
        });

        it("refuses a step naming nobody, an inactive member, a project's list and an archived list", async () => {
            const typeId = (await createWorkItemType(owner, { name: `Strict ${TAG}` })).id;
            const put = (steps: StepIn[]) => setTypeReviewSteps(owner, typeId, { reviewRequiredForDone: false, steps: stepsOf(steps) });
            await expect(put([{ name: 'Empty', mode: 'ALL', dueInWorkingDays: 1 }])).rejects.toMatchObject({ status: 400, details: { reason: 'STEP_HAS_NO_REVIEWERS' } });
            await expect(put([{ name: 'Gone', mode: 'ALL', dueInWorkingDays: 1, memberIds: ['nobody'] }])).rejects.toMatchObject({ status: 400, details: { reason: 'REVIEWER_NOT_ELIGIBLE' } });
            const projectList = await createRecipientList(owner, projectId, { name: 'Support desk', userIds: [rae.userId] });
            await expect(put([{ name: 'Desk', mode: 'ALL', dueInWorkingDays: 1, recipientListIds: [projectList.id] }])).rejects.toMatchObject({
                status: 400,
                details: { reason: 'RECIPIENT_LIST_NOT_USABLE' },
            });
            const old = await createRecipientList(owner, null, { name: 'Old board', userIds: [rae.userId] });
            await archiveRecipientList(owner, null, old.id);
            await expect(put([{ name: 'Board', mode: 'ALL', dueInWorkingDays: 1, recipientListIds: [old.id] }])).rejects.toMatchObject({ status: 400 });
            await expect(setTypeReviewSteps(mia, typeId, { reviewRequiredForDone: true, steps: [] })).rejects.toMatchObject({ status: 403 });
            expect((await getTypeReviewSteps(owner, typeId)).steps).toEqual([]);
        });
    });

    describe('every create path copies them, never opened', () => {
        it('the dialog and the API: round 1 PLANNED, the assignee dropped and named', async () => {
            const typeId = await reviewedType(false);
            const item = await createWorkItem(owner, { projectId, typeId, title: 'From the dialog', assigneeId: mia.userId });
            const [round, ...more] = await roundsOf(item.id);
            expect(more).toEqual([]);
            expect(round).toMatchObject({ number: 1, status: 'PLANNED', startedAt: null });
            expect(round!.steps.map((s) => [s.position, s.name, s.mode, s.dueInWorkingDays, s.status])).toEqual([
                [1, 'Peer review', 'ALL', 2, 'PENDING'],
                [2, 'Legal', 'ANY', 3, 'PENDING'],
            ]);
            // Decision 158: Mia, the assignee, is not copied; Max is. The list is named, resolved when its step opens.
            expect(round!.steps[0]!.reviewers.map((r) => r.userId)).toEqual([max.userId]);
            expect(round!.steps[1]!.lists.map((l) => l.recipientListId)).toEqual([legalListId]);
            expect((await getWorkItem(owner, item.id)).review).toMatchObject({ state: 'planned', roundNumber: 1 });
            const created = await prisma.auditLog.findFirst({ where: { tenantId, entityId: item.id, action: 'WORK_ITEM_CREATED' } });
            expect(created?.metadataJson).toMatchObject({ reviewStepsFromType: 2, reviewDefaultsDropped: [{ userId: mia.userId, reason: 'BECAME_ASSIGNEE' }] });
            // Nothing opened: nobody was asked.
            expect(await prisma.notification.count({ where: { tenantId, type: 'WORK_ITEM_REVIEW_REQUESTED', workItemId: item.id } })).toBe(0);
        });

        it('a guest and an archived list are dropped; a step left naming nobody stays and cannot be sent', async () => {
            const board = await createRecipientList(owner, null, { name: 'Board', userIds: [rae.userId] });
            const typeId = await reviewedType(false, [
                { name: 'Guest only', mode: 'ALL', dueInWorkingDays: 1, memberIds: [guest.userId] },
                { name: 'Board', mode: 'ANY', dueInWorkingDays: 1, recipientListIds: [board.id] },
            ]);
            await archiveRecipientList(owner, null, board.id);
            const item = await createWorkItem(owner, { projectId, typeId, title: 'Dropped' });
            const [round] = await roundsOf(item.id);
            expect(round!.steps.map((s) => [s.name, s.reviewers.length, s.lists.length])).toEqual([
                ['Guest only', 0, 0],
                ['Board', 0, 0],
            ]);
            const created = await prisma.auditLog.findFirst({ where: { tenantId, entityId: item.id, action: 'WORK_ITEM_CREATED' } });
            expect(created?.metadataJson).toMatchObject({
                reviewDefaultsDropped: [{ userId: guest.userId, reason: 'NOT_ELIGIBLE' }],
                reviewDefaultListsDropped: [board.id],
            });
            await expect(sendWorkItemReview(owner, item.id)).rejects.toMatchObject({ status: 409, details: { reason: 'NO_REVIEWERS' } });
        });

        it("a template's sub-items each get the copy", async () => {
            const typeId = await reviewedType(false);
            const template = await createWorkItemTemplate(owner, projectId, { name: `Plan ${TAG}`, title: 'Plan', typeId, subItems: [{ title: 'Step one' }, { title: 'Step two' }] });
            const made = await createWorkItem(owner, { projectId, templateId: template.id });
            const subs = await prisma.workItem.findMany({ where: { tenantId, parentId: made.id }, select: { id: true } });
            expect(subs).toHaveLength(2);
            for (const id of [made.id, ...subs.map((s) => s.id)]) {
                // guardrail-allow: n+1 — three items in a test.
                const rounds = await roundsOf(id);
                expect(rounds.map((r) => [r.number, r.status, r.steps.length])).toEqual([[1, 'PLANNED', 2]]);
            }
        });

        it("a project template's starter items get the copy", async () => {
            const typeId = await reviewedType(false);
            const source = (await createProject(owner, { teamId, name: 'Source', keyPrefix: 'SRC' })).id;
            await createWorkItem(owner, { projectId: source, typeId, title: 'a starter' });
            const template = await saveProjectAsTemplate(owner, { fromProjectId: source, name: `Starter ${TAG}`, includeItems: true });
            const made = await createProject(owner, { teamId, name: 'From the template', keyPrefix: 'NEW', templateId: template.id });
            const starter = await prisma.workItem.findFirstOrThrow({ where: { tenantId, projectId: made.id }, select: { id: true } });
            const rounds = await roundsOf(starter.id);
            expect(rounds.map((r) => [r.number, r.status, r.steps.length])).toEqual([[1, 'PLANNED', 2]]);
        });

        it('an intake accept gets the copy', async () => {
            const typeId = await reviewedType(false);
            await setProjectIntake(owner, projectId, { enabled: true, notifyUserIds: [] });
            const form = await createIntakeForm(owner, { projectId, name: `Report ${TAG}`, definition: { fields: [{ id: 'f1', kind: 'SHORT_TEXT', label: 'What', required: false }] } });
            const request = await sendIntakeRequest(mia, form.id, { title: 'Please look', answers: {} });
            const accepted = await acceptIntakeRequest(owner, request.id, { typeId }, request.version);
            const rounds = await roundsOf(accepted.workItemId!);
            expect(rounds.map((r) => [r.number, r.status, r.steps.length])).toEqual([[1, 'PLANNED', 2]]);
        });

        it('a repeat copy gets the copy, made as its owner', async () => {
            const typeId = await reviewedType(false);
            const k = (n: number) => dayKey(addDays(todayInTz(new Date(), 'UTC'), n));
            const source = await createWorkItem(rae, { projectId, typeId, title: 'Monthly close', dueDate: k(0) });
            await setWorkItemRecurrence(rae, source.id, { frequency: 'DAILY', interval: 1, weekdays: [], leadDays: 0 });
            const result = await processWorkItemRecurrence({ tenantId, now: new Date(`${k(1)}T12:00:00.000Z`), tz: 'UTC' });
            expect(result).toMatchObject({ created: 1, failed: 0 });
            const copy = await prisma.workItem.findFirstOrThrow({ where: { tenantId, recurrence: { sourceWorkItemId: source.id }, id: { not: source.id } }, select: { id: true } });
            const rounds = await roundsOf(copy.id);
            expect(rounds.map((r) => [r.number, r.status, r.steps.length, r.createdById])).toEqual([[1, 'PLANNED', 2, rae.userId]]);
        });

        it('a later change to the defaults changes no item, and a removed member leaves every default', async () => {
            const typeId = await reviewedType(false);
            const item = await createWorkItem(owner, { projectId, typeId, title: 'Copied before' });
            await setTypeReviewSteps(owner, typeId, { reviewRequiredForDone: false, steps: [] });
            expect((await roundsOf(item.id))[0]!.steps).toHaveLength(2);
            const leaver = await prisma.user.create({ data: { email: `leo-${TAG}@example.test`, name: 'Leo' } });
            const membership = await prisma.tenantMembership.create({ data: { tenantId, userId: leaver.id, role: 'MEMBER' } });
            await setTypeReviewSteps(owner, typeId, { reviewRequiredForDone: false, steps: stepsOf([{ name: 'Leo', mode: 'ALL', dueInWorkingDays: 1, memberIds: [leaver.id, max.userId] }]) });
            await removeTenantMember(owner, { membershipId: membership.id });
            expect((await getTypeReviewSteps(owner, typeId)).steps[0]!.memberIds).toEqual([max.userId]);
        });
    });

    describe('the Done check', () => {
        const newItem = async (typeId: string, extra: Record<string, unknown> = {}) =>
            createWorkItem(owner, { projectId, typeId, title: `held ${Math.random()}`, assigneeId: mia.userId, ...extra } as Parameters<typeof createWorkItem>[1]);

        it('a single state change into Done is refused until the round completes; cancelling never is', async () => {
            const typeId = await reviewedType(true);
            const item = await newItem(typeId);
            await expect(setWorkItemState(owner, item.id, { stateId: doneStateId })).rejects.toMatchObject(held);
            await expect(setWorkItemState(admin, item.id, { stateId: doneStateId })).rejects.toThrow(/until its review is complete: round 1 is planned/);
            expect((await getWorkItem(owner, item.id)).stateCategory).not.toBe('DONE');
            await completeReview(item.id);
            expect((await setWorkItemState(owner, item.id, { stateId: doneStateId })).stateCategory).toBe('DONE');
            // Between two Done states: never held.
            expect((await setWorkItemState(owner, item.id, { stateId: otherDoneStateId })).stateId).toBe(otherDoneStateId);

            const cancelled = await newItem(typeId);
            expect((await setWorkItemState(owner, cancelled.id, { stateId: cancelledStateId })).stateCategory).toBe('CANCELLED');
        });

        it('an open, returned or withdrawn round holds; an item reopened after a close withdrew its round stays held', async () => {
            const typeId = await reviewedType(true);
            const item = await newItem(typeId);
            await sendWorkItemReview(owner, item.id);
            await expect(setWorkItemState(owner, item.id, { stateId: doneStateId })).rejects.toThrow(/round 1 is open at the step "Peer review"/);
            const step = (await getWorkItemReview(owner, item.id)).rounds[0]!.steps[0]!;
            await respondToReviewStep(max, item.id, step.id, { outcome: 'RETURNED', text: 'Needs work' });
            await expect(setWorkItemState(owner, item.id, { stateId: doneStateId })).rejects.toMatchObject({ details: { roundNumber: 2, roundStatus: 'PLANNED' } });
            await sendWorkItemReview(owner, item.id);
            await withdrawWorkItemReview(owner, item.id);
            await expect(setWorkItemState(owner, item.id, { stateId: doneStateId })).rejects.toMatchObject(held);
            // Cancel (the round is withdrawn by the close), reopen: still held until a new round completes.
            const other = await newItem(typeId);
            await sendWorkItemReview(owner, other.id);
            await setWorkItemState(owner, other.id, { stateId: cancelledStateId });
            await setWorkItemState(owner, other.id, { stateId: startedStateId });
            await expect(setWorkItemState(owner, other.id, { stateId: doneStateId })).rejects.toMatchObject({ details: { roundStatus: 'WITHDRAWN' } });
        });

        it('a type that does not require review holds nothing, nor does an item with no review steps', async () => {
            const loose = await reviewedType(false);
            expect((await setWorkItemState(owner, (await newItem(loose)).id, { stateId: doneStateId })).stateCategory).toBe('DONE');
            const bare = (await createWorkItemType(owner, { name: `Bare ${TAG}` })).id;
            await setTypeReviewSteps(owner, bare, { reviewRequiredForDone: true, steps: [] });
            expect((await setWorkItemState(owner, (await newItem(bare)).id, { stateId: doneStateId })).stateCategory).toBe('DONE');
            // A planned round emptied of its steps is no review.
            const typeId = await reviewedType(true);
            const emptied = await newItem(typeId);
            const round = (await getWorkItemReview(owner, emptied.id)).rounds[0]!;
            await setWorkItemReviewSteps(owner, emptied.id, { steps: [] }, round.version);
            expect((await setWorkItemState(owner, emptied.id, { stateId: doneStateId })).stateCategory).toBe('DONE');
        });

        it('bulk is all or nothing, naming the held item', async () => {
            const typeId = await reviewedType(true);
            const loose = await reviewedType(false);
            const a = await newItem(loose);
            const b = await newItem(typeId);
            await expect(bulkSetWorkItemState(owner, { workItemIds: [a.id, b.id], stateCategory: 'DONE' })).rejects.toMatchObject({ ...held, details: { workItemId: b.id } });
            expect((await getWorkItem(owner, a.id)).stateCategory).not.toBe('DONE');
            await bulkSetWorkItemState(owner, { workItemIds: [a.id, b.id], stateCategory: 'CANCELLED' });
            expect((await getWorkItem(owner, b.id)).stateCategory).toBe('CANCELLED');
        });

        it('the board move and the answer are refused the same way', async () => {
            const typeId = await reviewedType(true);
            const item = await newItem(typeId);
            await expect(moveWorkItemOnBoard(owner, item.id, { stateId: doneStateId })).rejects.toMatchObject(held);
            await setTypeField(owner, typeId, { field: 'answer', requirement: 'OPTIONAL' });
            const asked = await newItem(typeId);
            const comment = await addComment(rae, asked.id, { body: 'This is the answer' });
            await expect(markWorkItemAnswer(owner, asked.id, { commentId: comment.id })).rejects.toMatchObject(held);
            expect((await getWorkItem(owner, asked.id)).answerCommentId).toBeNull();
            await completeReview(asked.id);
            expect((await markWorkItemAnswer(owner, asked.id, { commentId: comment.id })).stateCategory).toBe('DONE');
        });

        it("a state's delete into a Done state is refused while an item in it is held", async () => {
            const typeId = await reviewedType(true);
            const extra = await createWorkflowState(owner, teamId, { name: `Doing ${TAG}`, category: 'STARTED' });
            const item = await newItem(typeId, { stateId: extra.id });
            await expect(deleteWorkflowState(owner, extra.id, { moveToStateId: doneStateId })).rejects.toMatchObject({ status: 409, details: { reason: 'REVIEW_INCOMPLETE', itemCount: 1 } });
            await completeReview(item.id);
            expect(await deleteWorkflowState(owner, extra.id, { moveToStateId: doneStateId })).toMatchObject({ deleted: true, movedItems: 1 });
        });

        it('a create into a Done state is refused when the copied steps would hold it', async () => {
            const typeId = await reviewedType(true);
            await expect(newItem(typeId, { stateId: doneStateId, title: 'born done' })).rejects.toMatchObject({ ...held, details: { atCreate: true } });
            expect((await listWorkItems(owner, { projectId, q: 'born done' })).items).toEqual([]);
            const loose = await reviewedType(false);
            expect((await newItem(loose, { stateId: doneStateId })).stateCategory).toBe('DONE');
        });
    });

    describe('the route matrix (decision 160)', () => {
        const ctxFor = (role: Role) => ({ OWNER: owner, ADMIN: admin, MEMBER: max, VIEWER: viewer, GUEST: guest })[role as 'OWNER'];
        const denied = () => prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED' } });
        const call = async (role: Role, method: 'GET' | 'PUT', typeId: string, body?: unknown) => {
            getTenantCtxMock.mockResolvedValue({ ...ctxFor(role), requestId: `${TAG}-${role}-${Math.random()}` });
            const mod = (await import(`../../${ROUTE}`)) as Record<string, Handler>;
            const res = await mod[method]!(request(method, `/work-item-types/${typeId}/review-steps`, body), { params: Promise.resolve({ tenantSlug: TAG, typeId }) });
            return res.status;
        };
        const EXPECT = {
            // Decision 204: a GUEST holds no key until 8.4, so it is refused the read too.
            GET: { OWNER: 200, ADMIN: 200, MEMBER: 200, VIEWER: 200, GUEST: 403 },
            PUT: { OWNER: 200, ADMIN: 200, MEMBER: 403, VIEWER: 403, GUEST: 403 },
        } as const;

        it.each(ROLES.flatMap((role) => (['GET', 'PUT'] as const).map((m) => [m, role] as const)))('%s as %s', async (method, role) => {
            const typeId = (await createWorkItemType(owner, { name: `Matrix ${method} ${role} ${TAG}` })).id;
            const before = await denied();
            const status = await call(role, method, typeId, method === 'PUT' ? { reviewRequiredForDone: true, steps: stepsOf([{ name: 'Check', mode: 'ALL', dueInWorkingDays: 2, memberIds: [rae.userId] }]) } : undefined);
            expect({ method, role, status }).toEqual({ method, role, status: EXPECT[method][role as 'OWNER'] });
            expect(await denied()).toBe(before + (status === 403 ? 1 : 0));
        });

        it('a body that does not parse is a 400', async () => {
            const typeId = (await createWorkItemType(owner, { name: `Matrix bad ${TAG}` })).id;
            expect(await call('OWNER', 'PUT', typeId, { steps: [] })).toBe(400);
        });
    });

    describe('two-tenant isolation as app_user', () => {
        let typeId = '';
        beforeAll(async () => {
            typeId = await reviewedType(true);
        });
        const snapshotA = async () => ({
            steps: await prisma.workItemTypeReviewStep.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
            reviewers: await prisma.workItemTypeReviewStepReviewer.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
        });

        it("B reads and counts none of A's rows", async () => {
            expect(await runInTenantContext(outsider, (db) => db.workItemTypeReviewStep.count({}))).toBe(0);
            expect(await runInTenantContext(outsider, (db) => db.workItemTypeReviewStepReviewer.count({}))).toBe(0);
            expect(await runInTenantContext(owner, (db) => db.workItemTypeReviewStep.count({ where: { typeId } }))).toBe(2);
            await expect(getTypeReviewSteps(outsider, typeId)).rejects.toMatchObject({ status: 404 });
        });

        it("B changes or removes none of A's rows and cannot create one in A", async () => {
            const before = await snapshotA();
            const r1 = await runInTenantContext(outsider, (db) => db.workItemTypeReviewStep.updateMany({ where: { tenantId }, data: { name: 'Hijacked' } }));
            expect(r1.count).toBe(0);
            const r2 = await runInTenantContext(outsider, (db) => db.workItemTypeReviewStep.deleteMany({ where: { tenantId } }));
            expect(r2.count).toBe(0);
            const r3 = await runInTenantContext(outsider, (db) => db.workItemTypeReviewStepReviewer.deleteMany({ where: { tenantId } }));
            expect(r3.count).toBe(0);
            expect(await snapshotA()).toEqual(before);
            await expect(
                runInTenantContext(outsider, (db) => db.workItemTypeReviewStep.create({ data: { tenantId, typeId, position: 9, name: 'Planted', dueInWorkingDays: 1 } })),
            ).rejects.toThrow();
            await expect(
                runInTenantContext(outsider, (db) => db.workItemTypeReviewStepReviewer.create({ data: { tenantId, stepId: before.steps[0]!.id, recipientListId: legalListId } })),
            ).rejects.toThrow();
        });

        it('the database refuses a default reviewer naming both or neither', async () => {
            const stepId = (await snapshotA()).steps[0]!.id;
            await expect(prisma.workItemTypeReviewStepReviewer.create({ data: { tenantId, stepId, userId: rae.userId, recipientListId: legalListId } })).rejects.toThrow();
            await expect(prisma.workItemTypeReviewStepReviewer.create({ data: { tenantId, stepId } })).rejects.toThrow();
        });
    });

    it('the audit chain verifies', async () => {
        expect((await verifyAuditChain(tenantId, prisma)).valid).toBe(true);
    });
});
