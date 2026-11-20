/**
 * Review steps on a work item (sub-phase 2.8a; ADR 0009; owner decisions 148
 * to 165): read an item's rounds, edit the steps not yet opened, send a round,
 * respond (and change a response while its step is open), skip a step, add or
 * remove a reviewer, and withdraw a round.
 *
 * Every write locks the item first (`ReviewRepository.lockItem`), so two
 * responses, a response and a skip, a response and an edit, or a send and a
 * waiting-on write serialise; it runs in one transaction with its audit
 * entries, and rings its bells after the commit (`emitReviewNotices`, then the
 * watcher fan-out for a response). The in-transaction core is
 * `review-engine.ts`.
 *
 * Keys (decision 160): the routes carry `work_items.view` (read, respond) or
 * `work_items.edit` (everything else); past the key, a refusal decided here (a
 * person responding who is not named, the item's assignee responding, a
 * member skipping without standing) writes the same `AUTHZ_DENIED` entry a
 * `requirePermission` denial writes, then a 403.
 *
 * Written fresh for Islestone. The stale-decision refusal (a response to a
 * step that is no longer open is a 409, never an overwrite) is
 * inflect-compliance's `decidePolicyApproval` pattern, pattern only, no code
 * copied.
 */
import { logEvent } from '../events/audit';
import { REVIEW_LIMITS } from '../domain/review-steps';
import { formatKey } from '../domain/work-item-key';
import { assertActingAsPerson } from '../policies/person-only.policies';
import { visibleProjects, type ProjectVisibility } from '../policies/project-visibility';
import { isOwnWork, reviewAffordances, reviewStandingBasis, type ReviewAffordances } from '../policies/review.policies';
import { assertCanEditWorkItems, assertCanReadWorkItems } from '../policies/work-item.policies';
import { RecipientListRepository } from '../repositories/RecipientListRepository';
import { ReviewRepository, type NewStep, type ReviewRoundRow, type ReviewStepRow } from '../repositories/ReviewRepository';
import type { RequestContext } from '../types';
import {
    clearWaitingOnForRound,
    eligibleReviewers,
    openStepInTx,
    planRoundAfterWithdrawal,
    settleStepInTx,
    skipStepInTx,
    withdrawRoundsInTx,
    type ReviewItem,
    type ReviewNoticeOut,
} from './review-engine';
import { emitReviewNotices, emitWatcherActivity, loadVisibleItem, loadWritableItem, preconditionRequired } from './work-item-shared';
import { appendAuditEntryOrQueue } from '@/lib/audit';
import { runInTenantContext, type PrismaTx } from '@/lib/db-context';
import { badRequest, ConflictError, forbidden, notFound } from '@/lib/errors/types';
import type { ReviewStepInput } from '@/lib/schemas/review';
import { sanitizePlainText } from '@/lib/security/sanitize';

// ─── The response shape ───────────────────────────────────────────────────

function dateOnly(d: Date | null): string | null {
    return d ? d.toISOString().slice(0, 10) : null;
}

function reviewerDto(r: ReviewStepRow['reviewers'][number]) {
    return {
        userId: r.userId,
        viaRecipientListId: r.viaRecipientListId,
        outcome: r.outcome,
        respondedAt: r.respondedAt?.toISOString() ?? null,
        responseText: r.responseText,
        itemVersionAt: r.itemVersionAt,
        withdrawnAt: r.withdrawnAt?.toISOString() ?? null,
        withdrawnReason: r.withdrawnReason,
    };
}

function stepDto(s: ReviewStepRow) {
    const asked = s.reviewers.filter((r) => r.withdrawnAt === null);
    return {
        id: s.id,
        position: s.position,
        name: s.name,
        mode: s.mode,
        dueInWorkingDays: s.dueInWorkingDays,
        status: s.status,
        openedAt: s.openedAt?.toISOString() ?? null,
        dueOn: dateOnly(s.dueOn),
        endedAt: s.endedAt?.toISOString() ?? null,
        skippedByUserId: s.skippedByUserId,
        skipReason: s.skipReason,
        lists: s.lists.map((l) => ({ id: l.recipientListId, name: l.list.name, archived: l.list.archivedAt !== null })),
        reviewers: s.reviewers.map(reviewerDto),
        pendingUserIds: asked.filter((r) => r.outcome === null).map((r) => r.userId),
        /** Open with nobody still asked: flagged, never completed (ADR 0009 §5). */
        noReviewersLeft: s.status === 'OPEN' && asked.length === 0,
    };
}

function roundDto(r: ReviewRoundRow) {
    return {
        id: r.id,
        number: r.number,
        status: r.status,
        version: r.version,
        startedAt: r.startedAt?.toISOString() ?? null,
        startedByUserId: r.startedByUserId,
        endedAt: r.endedAt?.toISOString() ?? null,
        endedByUserId: r.endedByUserId,
        endReason: r.endReason,
        steps: r.steps.map(stepDto),
    };
}

export type ReviewRoundDto = ReturnType<typeof roundDto>;

export interface WorkItemReviewDto {
    workItemId: string;
    itemVersion: number;
    /** Newest first; the live (PLANNED or OPEN) round, when there is one, is first. */
    rounds: ReviewRoundDto[];
    /** While a round is open, the item waits on these people (decision 152): the open step's pending reviewers. */
    waitingOnReviewerIds: string[];
    viewer: ReviewAffordances;
}

function isClosed(item: { stateCategory: string }): boolean {
    return item.stateCategory === 'DONE' || item.stateCategory === 'CANCELLED';
}

function toReviewDto(ctx: RequestContext, item: ReviewItem, rounds: ReviewRoundRow[]): WorkItemReviewDto {
    const live = rounds.find((r) => r.status === 'PLANNED' || r.status === 'OPEN') ?? null;
    const latest = live ?? rounds[0] ?? null;
    const openStep = live?.steps.find((s) => s.status === 'OPEN') ?? null;
    return {
        workItemId: item.id,
        itemVersion: item.version,
        rounds: rounds.map(roundDto),
        waitingOnReviewerIds: openStep && live?.status === 'OPEN' ? stepDto(openStep).pendingUserIds : [],
        viewer: reviewAffordances(
            ctx,
            { assigneeId: item.assigneeId, closed: isClosed(item), projectArchived: item.project.archivedAt !== null },
            latest
                ? {
                      status: latest.status,
                      startedByUserId: latest.startedByUserId,
                      stepCount: latest.steps.length,
                      openStep: openStep
                          ? { id: openStep.id, namesViewer: openStep.reviewers.some((r) => r.userId === ctx.userId && r.withdrawnAt === null) }
                          : null,
                  }
                : null,
        ),
    };
}

/** An item's review: its rounds, newest first, and what the viewer may do (`work_items.view`). */
export async function getWorkItemReview(ctx: RequestContext, workItemId: string): Promise<WorkItemReviewDto> {
    assertCanReadWorkItems(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const item = await loadVisibleItem(db, ctx, v, workItemId);
        return toReviewDto(ctx, item, await ReviewRepository.listRounds(db, ctx, workItemId));
    });
}

// ─── Shared gates ─────────────────────────────────────────────────────────

/**
 * A refusal decided here, after the route's key admitted the caller: the same
 * hash-chained `AUTHZ_DENIED` entry a `requirePermission` denial writes (in a
 * transaction of its own, so the request's rollback keeps it), then a 403.
 */
async function refuseReview(ctx: RequestContext, workItemId: string, verb: string, reason: string, message: string): Promise<never> {
    await appendAuditEntryOrQueue({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        actorType: ctx.apiKeyId ? 'API_KEY' : 'USER',
        entity: 'WorkItem',
        entityId: workItemId,
        action: 'AUTHZ_DENIED',
        details: `Review ${verb} refused`,
        detailsJson: { category: 'access', event: 'authz_denied', reason, role: ctx.role },
        requestId: ctx.requestId,
        metadataJson: { role: ctx.role, verb, reason },
    });
    throw forbidden(message, { reason });
}

interface Locked {
    v: ProjectVisibility;
    item: ReviewItem;
    round: ReviewRoundRow | null;
}

/** The writable item, locked, and its live round. */
async function lockForReview(db: PrismaTx, ctx: RequestContext, workItemId: string): Promise<Locked> {
    const v = await visibleProjects(ctx, db);
    const item = await loadWritableItem(db, ctx, v, workItemId);
    await ReviewRepository.lockItem(db, ctx, workItemId);
    // Re-read under the lock: a write that committed while we waited is seen.
    const fresh = await loadWritableItem(db, ctx, v, item.id);
    return { v, item: fresh, round: await ReviewRepository.liveRound(db, ctx, workItemId) };
}

function roundChanged(round: ReviewRoundRow): ConflictError {
    return new ConflictError('The review changed since you read it.', { reason: 'VERSION_CONFLICT', version: round.version });
}

function assertRoundVersion(round: ReviewRoundRow, expectedVersion: number | undefined) {
    if (expectedVersion !== undefined && expectedVersion !== round.version) throw roundChanged(round);
}

/** The step of the item's live round; a step of an ended round is a 409 (the stale-decision refusal), any other a 404. */
async function stepOf(db: PrismaTx, ctx: RequestContext, workItemId: string, round: ReviewRoundRow | null, stepId: string): Promise<ReviewStepRow> {
    const step = round?.steps.find((s) => s.id === stepId);
    if (step) return step;
    if (await ReviewRepository.stepOfItemExists(db, ctx, workItemId, stepId)) {
        throw new ConflictError('This review step has ended.', { reason: 'REVIEW_STEP_NOT_OPEN' });
    }
    throw notFound('Review step not found');
}

/** After a write: the fresh review, then the bells (and the watchers for a response). */
async function afterReviewWrite(
    ctx: RequestContext,
    workItemId: string,
    notices: readonly ReviewNoticeOut[],
    watcherEvent?: { discriminator: string; detail: string },
): Promise<WorkItemReviewDto> {
    const reached = await emitReviewNotices(ctx, notices);
    if (watcherEvent) {
        await emitWatcherActivity(ctx, [{ workItemId, kind: 'reviewed', discriminator: watcherEvent.discriminator, detail: watcherEvent.detail, skipUserIds: reached }]);
    }
    return getWorkItemReview(ctx, workItemId);
}

// ─── Edit the steps not yet opened (decision 150) ─────────────────────────

/** Check and clean the steps a person sends: names, people who may be asked, lists in scope. */
async function cleanSteps(db: PrismaTx, ctx: RequestContext, item: ReviewItem, input: readonly ReviewStepInput[], firstPosition: number): Promise<NewStep[]> {
    const out: NewStep[] = [];
    const allLists = [...new Set(input.flatMap((s) => s.recipientListIds))];
    const lists = new Map<string, { projectId: string | null; archivedAt: Date | null }>();
    for (const id of allLists) {
        // guardrail-allow: n+1 — at most maxSteps × maxListsPerStep lists, read by id.
        const row = await RecipientListRepository.getById(db, ctx, id);
        if (row) lists.set(id, row);
    }
    const allMembers = [...new Set(input.flatMap((s) => s.memberIds))];
    if (item.assigneeId && allMembers.includes(item.assigneeId)) {
        throw badRequest("The work item's assignee cannot review it: a person does not review their own work.", { reason: 'REVIEWER_IS_ASSIGNEE', userId: item.assigneeId });
    }
    const eligible = await eligibleReviewers(db, ctx, item, { memberIds: allMembers, listIds: [] });
    const notEligible = eligible.dropped.map((d) => d.userId);
    if (notEligible.length > 0) {
        throw badRequest('A reviewer must be an active member who can see this project.', { reason: 'REVIEWER_NOT_ELIGIBLE', userIds: notEligible });
    }
    input.forEach((s, i) => {
        const name = sanitizePlainText(s.name).trim();
        if (!name || name.length > REVIEW_LIMITS.stepNameMax) {
            throw badRequest(`A review step needs a name of 1 to ${REVIEW_LIMITS.stepNameMax} characters.`, { reason: 'STEP_NAME_INVALID', index: i });
        }
        const memberIds = [...new Set(s.memberIds)];
        const listIds = [...new Set(s.recipientListIds)];
        for (const id of listIds) {
            const list = lists.get(id);
            if (!list || list.archivedAt || (list.projectId !== null && list.projectId !== item.projectId)) {
                throw badRequest("A recipient list must be live, and the workspace's or this project's.", { reason: 'RECIPIENT_LIST_NOT_USABLE', recipientListId: id });
            }
        }
        if (memberIds.length === 0 && listIds.length === 0) {
            throw badRequest(`The step "${name}" names nobody: name a member or a recipient list.`, { reason: 'STEP_HAS_NO_REVIEWERS', index: i });
        }
        out.push({ position: firstPosition + i, name, mode: s.mode, dueInWorkingDays: s.dueInWorkingDays, memberIds, recipientListIds: listIds });
    });
    return out;
}

/**
 * Replace the steps not yet opened (`work_items.edit`, decision 150): every
 * step of a planned round (one is created when the item has none), or the
 * steps after the open one of an open round. `If-Match` names the round's
 * version and is required when the item has a live round (428). Audited
 * `WORK_ITEM_REVIEW_STEPS_CHANGED` with ids and counts, never a name.
 */
export async function setWorkItemReviewSteps(ctx: RequestContext, workItemId: string, input: { steps: readonly ReviewStepInput[] }, expectedVersion?: number) {
    assertCanEditWorkItems(ctx);
    await runInTenantContext(ctx, async (db) => {
        const { item, round } = await lockForReview(db, ctx, workItemId);
        if (round) {
            if (expectedVersion === undefined) throw preconditionRequired();
            assertRoundVersion(round, expectedVersion);
        }
        const kept = round ? round.steps.filter((s) => s.status !== 'PENDING') : [];
        const lastKept = kept.reduce((m, s) => Math.max(m, s.position), 0);
        if (kept.length + input.steps.length > REVIEW_LIMITS.maxSteps) {
            throw badRequest(`A round has at most ${REVIEW_LIMITS.maxSteps} steps.`, { reason: 'TOO_MANY_STEPS' });
        }
        const steps = await cleanSteps(db, ctx, item, input.steps, lastKept + 1);
        let target = round;
        if (!target) {
            if (steps.length === 0) return;
            const number = (await ReviewRepository.lastRoundNumber(db, ctx, workItemId)) + 1;
            await ReviewRepository.createRound(db, ctx, workItemId, number);
            target = (await ReviewRepository.liveRound(db, ctx, workItemId))!;
        }
        const pending = target.steps.filter((s) => s.status === 'PENDING').map((s) => s.id);
        await ReviewRepository.deletePendingSteps(db, ctx, target.id, pending);
        await ReviewRepository.createSteps(db, ctx, { id: target.id, workItemId }, steps);
        if (round) {
            const count = await ReviewRepository.updateRound(db, ctx, round.id, expectedVersion, {});
            if (count === 0) throw roundChanged(round);
        }
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_REVIEW_STEPS_CHANGED',
            entityType: 'WorkItem',
            entityId: workItemId,
            details: `Changed the review steps of ${formatKey(item.project.keyPrefix, item.number)}`,
            detailsJson: {
                category: 'custom',
                event: 'review_steps_changed',
                roundId: target.id,
                removedStepIds: pending,
                stepCount: steps.length,
                memberIds: [...new Set(steps.flatMap((s) => s.memberIds))],
                recipientListIds: [...new Set(steps.flatMap((s) => s.recipientListIds))],
            },
            metadata: { roundId: target.id, stepCount: steps.length },
        });
    });
    return getWorkItemReview(ctx, workItemId);
}

// ─── Send for review (decision 155) ───────────────────────────────────────

/**
 * Open the planned round (`work_items.edit`): it opens its first step and the
 * item now waits on that step's reviewers (decision 152: the waiting-on
 * column is cleared). Refused on a closed item (`ITEM_CLOSED`), for a round
 * with no steps (`NO_STEPS`), and when any step resolves to nobody now
 * (`NO_REVIEWERS`): zero is never complete.
 */
export async function sendWorkItemReview(ctx: RequestContext, workItemId: string, expectedVersion?: number) {
    assertCanEditWorkItems(ctx);
    const notices = await runInTenantContext(ctx, async (db) => {
        const { v, item, round } = await lockForReview(db, ctx, workItemId);
        if (!round || round.status !== 'PLANNED') {
            throw new ConflictError('There is no planned review round to send.', { reason: round ? 'REVIEW_ROUND_OPEN' : 'NO_STEPS' });
        }
        assertRoundVersion(round, expectedVersion);
        if (isClosed(item)) throw new ConflictError('A closed work item is not sent for review. Reopen it first.', { reason: 'ITEM_CLOSED' });
        if (round.steps.length === 0) throw new ConflictError('Add a review step before sending the round.', { reason: 'NO_STEPS' });
        // Every step must have somebody to ask now (ADR 0009 §5); the first is opened below.
        for (const step of round.steps.slice(1)) {
            // guardrail-allow: n+1 — at most maxSteps steps, each resolved once.
            const e = await eligibleReviewers(db, ctx, item, { memberIds: step.reviewers.filter((r) => r.withdrawnAt === null).map((r) => r.userId), listIds: step.lists.map((l) => l.recipientListId) });
            if (e.userIds.length === 0) {
                throw new ConflictError(`Nobody can be asked to review at the step "${step.name}".`, { reason: 'NO_REVIEWERS', stepId: step.id });
            }
        }
        const now = new Date();
        const count = await ReviewRepository.updateRound(db, ctx, round.id, expectedVersion, { status: 'OPEN', startedAt: now, startedByUserId: ctx.userId });
        if (count === 0) throw roundChanged(round);
        await clearWaitingOnForRound(db, ctx, v, item);
        const started = { ...round, status: 'OPEN' as const, startedByUserId: ctx.userId };
        const out = await openStepInTx(db, ctx, item, started, round.steps[0]!, now, { refuseEmpty: true });
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_REVIEW_ROUND_STARTED',
            entityType: 'WorkItem',
            entityId: workItemId,
            details: `Sent ${formatKey(item.project.keyPrefix, item.number)} for review (round ${round.number})`,
            detailsJson: { category: 'custom', event: 'review_round_started', roundId: round.id, roundNumber: round.number, stepCount: round.steps.length },
            metadata: { roundId: round.id },
        });
        return out;
    });
    return afterReviewWrite(ctx, workItemId, notices);
}

// ─── Respond (decisions 156 to 158, 162, 163) ─────────────────────────────

/**
 * A reviewer's response to the open step, or a change to it while the step
 * is open (decision 162). Only the person named, acting as themselves
 * (`assertActingAsPerson`), never the item's assignee (decision 158). The row
 * is claimed with one `updateMany` naming what was read (`REVIEW_RESPONSE_TAKEN`
 * on a lost race); a step that is no longer open is a 409
 * (`REVIEW_STEP_NOT_OPEN`). The response records the item's version (decision
 * 163). Then the step is decided: a Return returns it at once (decision 156)
 * and the round with it; a completion opens the next step or completes the
 * round. Audited `WORK_ITEM_REVIEW_RESPONDED` or `_RESPONSE_CHANGED` with ids
 * and the outcome, never the text.
 */
export async function respondToReviewStep(
    ctx: RequestContext,
    workItemId: string,
    stepId: string,
    input: { outcome: 'SIGNED_OFF' | 'RETURNED'; text?: string | null },
) {
    assertCanReadWorkItems(ctx);
    assertActingAsPerson(ctx, 'Responding to a review step');
    const text = input.text ? sanitizePlainText(input.text).trim() : '';
    if (input.outcome === 'RETURNED' && !text) {
        throw badRequest('Say why you are returning it: the text is required to Return.', { reason: 'RETURN_NEEDS_TEXT' });
    }
    if (text.length > REVIEW_LIMITS.responseTextMax) {
        throw badRequest(`A response's text is at most ${REVIEW_LIMITS.responseTextMax} characters.`, { reason: 'RESPONSE_TOO_LONG' });
    }
    const outcome = await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const gate = await loadVisibleItem(db, ctx, v, workItemId);
        if (gate.project.archivedAt) {
            throw new ConflictError('The project is archived; unarchive it to change its work items.', { reason: 'PROJECT_ARCHIVED' });
        }
        await ReviewRepository.lockItem(db, ctx, workItemId);
        const item = await loadVisibleItem(db, ctx, v, workItemId);
        const round = await ReviewRepository.liveRound(db, ctx, workItemId);
        const ended = !round || round.status !== 'OPEN';
        const step = round?.steps.find((s) => s.id === stepId);
        const mine = step?.reviewers.find((r) => r.userId === ctx.userId && r.withdrawnAt === null);
        if (isOwnWork(ctx.userId, item)) {
            await refuseReview(ctx, workItemId, 'respond', 'REVIEWER_IS_ASSIGNEE', "You are this work item's assignee: a person does not review their own work.");
        }
        if (!step && !(await ReviewRepository.stepOfItemExists(db, ctx, workItemId, stepId))) throw notFound('Review step not found');
        if (ended || !step || step.status !== 'OPEN') {
            throw new ConflictError('This review step is not open any more.', { reason: 'REVIEW_STEP_NOT_OPEN' });
        }
        if (!mine) {
            await refuseReview(ctx, workItemId, 'respond', 'REVIEWER_NOT_NAMED', 'Only a reviewer named on this step may respond to it.');
        }
        const reviewer = mine!;
        const changing = reviewer.outcome !== null;
        if (changing && reviewer.outcome === input.outcome && (reviewer.responseText ?? '') === text) return null;
        const now = new Date();
        const count = await ReviewRepository.recordResponse(db, ctx, reviewer.id, reviewer.outcome, {
            outcome: input.outcome,
            responseText: text || null,
            itemVersionAt: item.version,
            respondedAt: now,
        });
        if (count === 0) throw new ConflictError('Your response was recorded by another request.', { reason: 'REVIEW_RESPONSE_TAKEN' });
        await ReviewRepository.updateRound(db, ctx, round!.id, undefined, {});
        await logEvent(db, ctx, {
            action: changing ? 'WORK_ITEM_REVIEW_RESPONSE_CHANGED' : 'WORK_ITEM_REVIEW_RESPONDED',
            entityType: 'WorkItem',
            entityId: workItemId,
            details: `${changing ? 'Changed a response to' : 'Responded to'} a review step of ${formatKey(item.project.keyPrefix, item.number)}: ${input.outcome}`,
            detailsJson: {
                category: 'custom',
                event: changing ? 'review_response_changed' : 'review_responded',
                roundId: round!.id,
                stepId,
                outcome: input.outcome,
                previousOutcome: reviewer.outcome,
                itemVersionAt: item.version,
                hasText: Boolean(text),
            },
            metadata: { roundId: round!.id, stepId, outcome: input.outcome },
        });
        const notices = await settleStepInTx(db, ctx, v, item, stepId, now);
        return { notices, discriminator: `${stepId}:${input.outcome}:${now.getTime()}` };
    });
    if (!outcome) return getWorkItemReview(ctx, workItemId);
    return afterReviewWrite(ctx, workItemId, outcome.notices, {
        discriminator: outcome.discriminator,
        detail: input.outcome === 'SIGNED_OFF' ? 'review signed off' : 'review returned',
    });
}

// ─── Skip, remove a reviewer (decision 150) ───────────────────────────────

async function assertStanding(ctx: RequestContext, item: ReviewItem, round: ReviewRoundRow, verb: string) {
    if (!reviewStandingBasis(ctx, item, round)) {
        await refuseReview(
            ctx,
            item.id,
            verb,
            'REVIEW_STANDING_REQUIRED',
            "Only the work item's assignee, whoever sent the round, or an admin may do this.",
        );
    }
}

/**
 * Skip an open or pending step of the open round (decision 150): the
 * assignee, whoever sent the round, or an admin; anyone else is refused and
 * audited. An open step nobody is left to answer is closed with reason
 * `NO_REVIEWERS_LEFT`. Audited `WORK_ITEM_REVIEW_STEP_SKIPPED`.
 */
export async function skipReviewStep(ctx: RequestContext, workItemId: string, stepId: string, expectedVersion?: number) {
    assertCanEditWorkItems(ctx);
    const notices = await runInTenantContext(ctx, async (db) => {
        const { v, item, round } = await lockForReview(db, ctx, workItemId);
        const step = await stepOf(db, ctx, workItemId, round, stepId);
        if (round!.status !== 'OPEN' || (step.status !== 'OPEN' && step.status !== 'PENDING')) {
            throw new ConflictError('Only a step of an open round that has not ended is skipped.', { reason: 'REVIEW_STEP_NOT_OPEN' });
        }
        await assertStanding(ctx, item, round!, 'skip');
        assertRoundVersion(round!, expectedVersion);
        const { reason, notices: out } = await skipStepInTx(db, ctx, v, item, round!, step, new Date());
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_REVIEW_STEP_SKIPPED',
            entityType: 'WorkItem',
            entityId: workItemId,
            details: `Skipped a review step of ${formatKey(item.project.keyPrefix, item.number)}`,
            detailsJson: { category: 'custom', event: 'review_step_skipped', roundId: round!.id, stepId, reason, basis: reviewStandingBasis(ctx, item, round) },
            metadata: { roundId: round!.id, stepId, reason },
        });
        return out;
    });
    return afterReviewWrite(ctx, workItemId, notices);
}

/**
 * Add one person to a step of the live round that has not ended
 * (`work_items.edit`): an active member who sees the project, never the
 * assignee (decision 158). On an open step they are asked at once.
 */
export async function addReviewStepReviewer(ctx: RequestContext, workItemId: string, stepId: string, input: { userId: string }) {
    assertCanEditWorkItems(ctx);
    const notices = await runInTenantContext(ctx, async (db) => {
        const { item, round } = await lockForReview(db, ctx, workItemId);
        const step = await stepOf(db, ctx, workItemId, round, stepId);
        if (step.status !== 'OPEN' && step.status !== 'PENDING') {
            throw new ConflictError('This review step has ended.', { reason: 'REVIEW_STEP_NOT_OPEN' });
        }
        if (isOwnWork(input.userId, item)) {
            throw badRequest("The work item's assignee cannot review it: a person does not review their own work.", { reason: 'REVIEWER_IS_ASSIGNEE', userId: input.userId });
        }
        const existing = step.reviewers.find((r) => r.userId === input.userId);
        if (existing) {
            throw new ConflictError(existing.withdrawnAt ? 'This person was withdrawn from this step.' : 'This person is already a reviewer of this step.', {
                reason: existing.withdrawnAt ? 'REVIEWER_WITHDRAWN' : 'ALREADY_REVIEWER',
            });
        }
        const eligible = await eligibleReviewers(db, ctx, item, { memberIds: [input.userId], listIds: [] });
        if (eligible.userIds.length === 0) {
            throw badRequest('A reviewer must be an active member who can see this project.', { reason: 'REVIEWER_NOT_ELIGIBLE', userIds: [input.userId] });
        }
        await ReviewRepository.addReviewers(db, ctx, step, [{ userId: input.userId, viaRecipientListId: null }]);
        await ReviewRepository.updateRound(db, ctx, round!.id, undefined, {});
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_REVIEWERS_CHANGED',
            entityType: 'WorkItem',
            entityId: workItemId,
            details: `Added a reviewer to ${formatKey(item.project.keyPrefix, item.number)}`,
            detailsJson: { category: 'custom', event: 'reviewer_added', roundId: round!.id, stepId, userId: input.userId },
            metadata: { roundId: round!.id, stepId, userId: input.userId },
        });
        if (step.status !== 'OPEN') return [] as ReviewNoticeOut[];
        return [
            {
                item: { id: item.id, title: item.title, key: formatKey(item.project.keyPrefix, item.number) },
                userIds: [input.userId],
                notice: { kind: 'requested' as const, stepId, stepName: step.name },
                actorUserId: ctx.userId,
            },
        ];
    });
    return afterReviewWrite(ctx, workItemId, notices);
}

/**
 * Withdraw a pending reviewer (`REMOVED_BY_PERSON`), never delete them: on a
 * step not yet opened under `work_items.edit`; on an open step only with
 * standing (decision 150), since it can complete the step. The step is then
 * decided again.
 */
export async function removeReviewStepReviewer(ctx: RequestContext, workItemId: string, stepId: string, userId: string) {
    assertCanEditWorkItems(ctx);
    const notices = await runInTenantContext(ctx, async (db) => {
        const { v, item, round } = await lockForReview(db, ctx, workItemId);
        const step = await stepOf(db, ctx, workItemId, round, stepId);
        if (step.status !== 'OPEN' && step.status !== 'PENDING') {
            throw new ConflictError('This review step has ended.', { reason: 'REVIEW_STEP_NOT_OPEN' });
        }
        const row = step.reviewers.find((r) => r.userId === userId && r.withdrawnAt === null);
        if (!row) throw notFound('Reviewer not found');
        if (row.outcome !== null) throw new ConflictError('This reviewer has responded; a response is never removed.', { reason: 'REVIEWER_RESPONDED' });
        if (step.status === 'OPEN') await assertStanding(ctx, item, round!, 'remove_reviewer');
        const now = new Date();
        await ReviewRepository.withdrawReviewers(db, ctx, [row.id], 'REMOVED_BY_PERSON', now);
        await ReviewRepository.updateRound(db, ctx, round!.id, undefined, {});
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_REVIEWERS_CHANGED',
            entityType: 'WorkItem',
            entityId: workItemId,
            details: `Removed a reviewer from ${formatKey(item.project.keyPrefix, item.number)}`,
            detailsJson: { category: 'custom', event: 'reviewer_removed', roundId: round!.id, stepId, userId },
            metadata: { roundId: round!.id, stepId, userId },
        });
        return step.status === 'OPEN' ? settleStepInTx(db, ctx, v, item, stepId, now) : [];
    });
    return afterReviewWrite(ctx, workItemId, notices);
}

// ─── Withdraw a round ─────────────────────────────────────────────────────

/**
 * End the open round unfinished (`work_items.edit`): its steps and responses
 * stay as they were, read-only, and a new planned round with the same steps
 * follows, waiting to be sent (ADR 0009 §4). Waiting on is not set.
 */
export async function withdrawWorkItemReview(ctx: RequestContext, workItemId: string, expectedVersion?: number) {
    assertCanEditWorkItems(ctx);
    await runInTenantContext(ctx, async (db) => {
        const { item, round } = await lockForReview(db, ctx, workItemId);
        if (!round || round.status !== 'OPEN') throw new ConflictError('There is no open review round.', { reason: 'REVIEW_ROUND_NOT_OPEN' });
        assertRoundVersion(round, expectedVersion);
        await withdrawRoundsInTx(db, ctx, [round], 'WITHDRAWN_BY_PERSON', new Date(), new Map([[item.id, item]]));
        await planRoundAfterWithdrawal(db, ctx, item, round);
    });
    return getWorkItemReview(ctx, workItemId);
}
