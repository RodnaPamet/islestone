/**
 * The in-transaction core of review steps (sub-phase 2.8a; ADR 0009; owner
 * decisions 149 to 163): opening a step, settling it after a response, a
 * skip or a withdrawal, ending a round, copying the next one, and the
 * waiting-on interplay. Every caller has locked the item first
 * (`ReviewRepository.lockItem`) and passes its gate row.
 *
 * Callers: the review usecases (`review.ts`), every state path into a closed
 * category and every item delete (`endOpenRoundsOnClose`, `work-item*.ts`,
 * `workflow-state.ts`), member removal (`withdrawReviewerRowsOfUser`,
 * `tenant-admin.ts`) and every assignee change (`withdrawNewAssigneeRows`,
 * decision 158). It never notifies: it returns the notices, which the caller
 * rings after its commit (`emitReviewNotices` in `work-item-shared.ts`).
 *
 * Rules held here and by the database together:
 *   - zero is never complete: a step that resolves to nobody is refused when
 *     a round is sent (`NO_REVIEWERS`), and a step left with nobody stays
 *     open, flagged (`evaluateStep`), never completed;
 *   - nothing ended is rewritten: children are ended before their parents
 *     (reviewer rows, then the step, then the round), because the triggers
 *     freeze every row of an ended step or round;
 *   - waiting on (decision 152): cleared when a round opens; set to the
 *     active assignee of an open item when a round completes or is returned;
 *     untouched when a round is withdrawn.
 *
 * Due days (decision 151, ADR 0009 §13 as amended by decisions 191 and 192)
 * count working days on the item's team's working calendar, else the
 * workspace's, from "today" in that calendar's zone (`resolveWorkingCalendars`);
 * a stored `dueOn` never moves.
 *
 * Written fresh for Islestone. "Zero is never complete" is inflect-compliance's
 * legacy-access invariant 5 (its `CLAUDE.md`), pattern only, no code copied.
 */
import type { ReviewStepMode } from '@prisma/client';

import { logEvent } from '../events/audit';
import { afterStepEnds, evaluateStep, nextPendingStep } from '../domain/review-steps';
import { epochDayToDate, todayIn, workingDaysAfter } from '../domain/schedule/calendar';
import { formatKey } from '../domain/work-item-key';
import { resolveListRecipients } from '../notifications/recipient-list';
import type { ReviewNotice } from '../notifications/review';
import type { ProjectVisibility } from '../policies/project-visibility';
import { MembershipRepository } from '../repositories/MembershipRepository';
import { RecipientListRepository } from '../repositories/RecipientListRepository';
import { ReviewRepository, type NewStep, type ReviewRoundRow, type ReviewStepRow } from '../repositories/ReviewRepository';
import { WorkItemRepository, type WorkItemGateRow } from '../repositories/WorkItemRepository';
import type { RequestContext } from '../types';
import { resolveWorkingCalendars } from './working-calendar';
import type { PrismaTx } from '@/lib/db-context';
import { ConflictError } from '@/lib/errors/types';
import { todayClock } from '@/lib/clock';

/** A bell (and, for a request or a return, an email) the caller rings after its commit. */
export interface ReviewNoticeOut {
    item: { id: string; title: string; key: string };
    userIds: string[];
    notice: ReviewNotice;
    /** Who acted (the email names them); absent for nobody. */
    actorUserId?: string | null;
}

/** What the item needs to look like for the engine: its gate row. */
export type ReviewItem = WorkItemGateRow;

/** The reasons a reviewer row is withdrawn (the CHECK `WorkItemReviewer_withdrawn`). */
export type WithdrawnReason = 'MEMBER_REMOVED' | 'STEP_ENDED' | 'REMOVED_BY_PERSON' | 'BECAME_ASSIGNEE' | 'NOT_ELIGIBLE';

function itemRef(item: ReviewItem) {
    return { id: item.id, title: item.title, key: formatKey(item.project.keyPrefix, item.number) };
}

function isClosed(item: { stateCategory: string }): boolean {
    return item.stateCategory === 'DONE' || item.stateCategory === 'CANCELLED';
}

/** The people to tell about a round's end or a stall: the assignee and whoever sent the round, each once. */
function ownersOf(item: { assigneeId: string | null }, round: { startedByUserId: string | null }): string[] {
    return [...new Set([item.assigneeId, round.startedByUserId].filter((u): u is string => Boolean(u)))];
}

export interface EligibleReviewers {
    /** The people who may be asked, each once, in the order named (members first, then the lists'). */
    userIds: string[];
    /** The list each person came from; `null` when named directly. */
    via: Map<string, string | null>;
    /** Named people who may not be asked now, and why. */
    dropped: Array<{ userId: string; reason: 'NOT_ELIGIBLE' | 'BECAME_ASSIGNEE' }>;
}

/**
 * Who may be asked to review the item now (decisions 154 and 158): the
 * members named and the lists' people, through the one resolver
 * (`resolveListRecipients`: a live workspace, a live list of the workspace or
 * the item's project, an ACTIVE member holding `work_items.view` whose role
 * sees the project), never the item's assignee, never anyone excluded.
 */
export async function eligibleReviewers(
    db: PrismaTx,
    ctx: RequestContext,
    item: { projectId: string; assigneeId: string | null },
    named: { memberIds: readonly string[]; listIds: readonly string[] },
    excludeUserIds: readonly string[] = [],
): Promise<EligibleReviewers> {
    const memberIds = [...new Set(named.memberIds)];
    const listIds = [...new Set(named.listIds)];
    const resolved = await resolveListRecipients(db, ctx.tenantId, {
        listIds,
        projectId: item.projectId,
        alsoUserIds: memberIds,
        may: (p) => p.work_items?.view === true,
    });
    const via = new Map<string, string | null>();
    for (const id of memberIds) via.set(id, null);
    if (listIds.length > 0) {
        const order = new Map(listIds.map((id, i) => [id, i]));
        const members = await RecipientListRepository.listMembers(db, ctx, listIds);
        const sorted = [...members].sort((a, b) => (order.get(a.listId) ?? 0) - (order.get(b.listId) ?? 0));
        for (const m of sorted) if (!via.has(m.userId)) via.set(m.userId, m.listId);
    }
    const allowed = new Set(resolved.userIds);
    const excluded = new Set(excludeUserIds);
    const userIds: string[] = [];
    const dropped: EligibleReviewers['dropped'] = [];
    for (const id of resolved.named) {
        const isAssignee = Boolean(item.assigneeId) && id === item.assigneeId;
        if (allowed.has(id) && !isAssignee && !excluded.has(id)) userIds.push(id);
        else if (memberIds.includes(id)) dropped.push({ userId: id, reason: isAssignee ? 'BECAME_ASSIGNEE' : 'NOT_ELIGIBLE' });
    }
    return { userIds, via, dropped };
}

/** The members named directly on a step (its rows from no list, still asked). */
function namedMemberIds(step: ReviewStepRow): string[] {
    return step.reviewers.filter((r) => r.viaRecipientListId === null && r.withdrawnAt === null).map((r) => r.userId);
}

function listIdsOf(step: ReviewStepRow): string[] {
    return step.lists.map((l) => l.recipientListId);
}

/**
 * Open a PENDING step: resolve its lists (decision 154), withdraw named
 * people who may no longer be asked, add the lists' people, store its due
 * day in working days from today (decision 151), audit, and say whom to ask.
 * With `refuseEmpty` (a round being sent) a step that resolves to nobody is a
 * 409 `NO_REVIEWERS`; otherwise it opens flagged and its owners are told.
 */
export async function openStepInTx(
    db: PrismaTx,
    ctx: RequestContext,
    item: ReviewItem,
    round: Pick<ReviewRoundRow, 'id' | 'number' | 'startedByUserId'>,
    step: ReviewStepRow,
    now: Date,
    opts: { refuseEmpty: boolean; excludeUserIds?: readonly string[] },
): Promise<ReviewNoticeOut[]> {
    const eligible = await eligibleReviewers(db, ctx, item, { memberIds: namedMemberIds(step), listIds: listIdsOf(step) }, opts.excludeUserIds);
    if (eligible.userIds.length === 0 && opts.refuseEmpty) {
        throw new ConflictError(`Nobody can be asked to review at the step "${step.name}". Name a member who can see this project, or a recipient list that has some.`, {
            reason: 'NO_REVIEWERS',
            stepId: step.id,
        });
    }
    const already = new Map(step.reviewers.map((r) => [r.userId, r]));
    for (const reason of ['NOT_ELIGIBLE', 'BECAME_ASSIGNEE'] as const) {
        const ids = eligible.dropped.filter((d) => d.reason === reason).map((d) => already.get(d.userId)?.id).filter((x): x is string => Boolean(x));
        await ReviewRepository.withdrawReviewers(db, ctx, ids, reason, now);
    }
    const toAdd = eligible.userIds.filter((id) => !already.has(id)).map((userId) => ({ userId, viaRecipientListId: eligible.via.get(userId) ?? null }));
    await ReviewRepository.addReviewers(db, ctx, step, toAdd);
    // Working days on the item's team's calendar, else the workspace's, and
    // "today" in that calendar's zone (ADR 0009 §13 as amended, decision 192).
    // The day is stored: no later change to a calendar moves it.
    const calendar = (await resolveWorkingCalendars(db, ctx, [item.teamId])).forTeam(item.teamId);
    const dueOn = epochDayToDate(workingDaysAfter(calendar.compiled, todayIn(calendar.timeZone, todayClock(calendar.timeZone, now)), step.dueInWorkingDays));
    await ReviewRepository.openStep(db, ctx, step.id, now, dueOn);
    await logEvent(db, ctx, {
        action: 'WORK_ITEM_REVIEW_STEP_OPENED',
        entityType: 'WorkItem',
        entityId: item.id,
        details: `Opened a review step of ${formatKey(item.project.keyPrefix, item.number)}`,
        detailsJson: {
            category: 'custom',
            event: 'review_step_opened',
            roundId: round.id,
            roundNumber: round.number,
            stepId: step.id,
            reviewerIds: eligible.userIds,
            listIds: listIdsOf(step),
            dropped: eligible.dropped,
            dueOn: dueOn.toISOString().slice(0, 10),
        },
        metadata: { roundId: round.id, stepId: step.id, reviewerCount: eligible.userIds.length },
    });
    if (eligible.userIds.length === 0) {
        return [{ item: itemRef(item), userIds: ownersOf(item, round), notice: { kind: 'stalled', stepId: step.id, stepName: step.name } }];
    }
    return [
        {
            item: itemRef(item),
            userIds: eligible.userIds,
            notice: { kind: 'requested', stepId: step.id, stepName: step.name },
            actorUserId: round.startedByUserId,
        },
    ];
}

/** The step definitions a new round copies: names, modes, days, named members and live lists (decision 155, ADR 0009 §4). */
async function copiedSteps(db: PrismaTx, ctx: RequestContext, item: ReviewItem, round: ReviewRoundRow): Promise<NewStep[]> {
    const dropReasons = new Set(['MEMBER_REMOVED', 'REMOVED_BY_PERSON', 'BECAME_ASSIGNEE']);
    const wanted = round.steps.map((s) => ({
        step: s,
        members: [
            ...new Set(
                s.reviewers
                    .filter((r) => r.viaRecipientListId === null && !dropReasons.has(r.withdrawnReason ?? ''))
                    .map((r) => r.userId)
                    .filter((u) => u !== item.assigneeId),
            ),
        ],
    }));
    const active = await MembershipRepository.listActiveUserIds(db, ctx, [...new Set(wanted.flatMap((w) => w.members))]);
    return wanted.map((w, i) => ({
        position: i + 1,
        name: w.step.name,
        mode: w.step.mode as ReviewStepMode,
        dueInWorkingDays: w.step.dueInWorkingDays,
        memberIds: w.members.filter((u) => active.has(u)),
        recipientListIds: w.step.lists.filter((l) => l.list.archivedAt === null).map((l) => l.recipientListId),
    }));
}

/** A new PLANNED round with the same steps as `round` (after a Return or a withdrawal). */
async function planNextRound(db: PrismaTx, ctx: RequestContext, item: ReviewItem, round: ReviewRoundRow): Promise<string> {
    const steps = await copiedSteps(db, ctx, item, round);
    const next = await ReviewRepository.createRound(db, ctx, item.id, round.number + 1);
    await ReviewRepository.createSteps(db, ctx, { id: next.id, workItemId: item.id }, steps);
    return next.id;
}

/**
 * Waiting on once a round has completed or been returned (decision 152): the
 * assignee, when there is one, the item is open and they are an ACTIVE
 * member; otherwise nobody. Audited as any waiting-on change, with the reason.
 */
async function waitOnAssigneeAfterRound(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, item: ReviewItem, reason: 'review_round_completed' | 'review_round_returned') {
    if (isClosed(item) || !item.assigneeId || item.waitingOnUserId === item.assigneeId) return;
    const active = await MembershipRepository.listActiveUserIds(db, ctx, [item.assigneeId]);
    if (!active.has(item.assigneeId)) return;
    const count = await WorkItemRepository.updateVersioned(db, ctx, v, item.id, undefined, { waitingOnUserId: item.assigneeId });
    if (count === 0) return;
    await logEvent(db, ctx, {
        action: 'WORK_ITEM_WAITING_ON_CHANGED',
        entityType: 'WorkItem',
        entityId: item.id,
        details: `Changed who ${formatKey(item.project.keyPrefix, item.number)} waits on`,
        detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItem', operation: 'updated', changedFields: ['waitingOnUserId'], summary: reason },
        metadata: { fromUserId: item.waitingOnUserId, toUserId: item.assigneeId, reason },
    });
}

/**
 * Clear waiting on as a round opens (decision 152): the item now waits on
 * its open step's pending reviewers, read from their rows.
 */
export async function clearWaitingOnForRound(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, item: ReviewItem): Promise<void> {
    if (!item.waitingOnUserId) return;
    const count = await WorkItemRepository.updateVersioned(db, ctx, v, item.id, undefined, { waitingOnUserId: null });
    if (count === 0) return;
    await logEvent(db, ctx, {
        action: 'WORK_ITEM_WAITING_ON_CHANGED',
        entityType: 'WorkItem',
        entityId: item.id,
        details: `Changed who ${formatKey(item.project.keyPrefix, item.number)} waits on`,
        detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItem', operation: 'updated', changedFields: ['waitingOnUserId'], summary: 'review_round_opened' },
        metadata: { fromUserId: item.waitingOnUserId, toUserId: null, reason: 'review_round_opened' },
    });
}

async function auditRoundEnded(
    db: PrismaTx,
    ctx: RequestContext,
    item: ReviewItem,
    round: { id: string; number: number },
    reason: 'COMPLETED' | 'RETURNED' | 'ITEM_CLOSED' | 'ITEM_DELETED' | 'WITHDRAWN_BY_PERSON',
    extra: Record<string, unknown> = {},
) {
    await logEvent(db, ctx, {
        action: 'WORK_ITEM_REVIEW_ROUND_ENDED',
        entityType: 'WorkItem',
        entityId: item.id,
        details: `Review round ${round.number} of ${formatKey(item.project.keyPrefix, item.number)} ended: ${reason}`,
        detailsJson: { category: 'custom', event: 'review_round_ended', roundId: round.id, roundNumber: round.number, reason, ...extra },
        metadata: { roundId: round.id, reason },
    });
}

/**
 * Decide an OPEN step from its rows, after a response, a withdrawal or an
 * added reviewer, and carry the round on: a Return ends the round and plans
 * the next; a completion opens the next PENDING step or completes the round.
 * Re-reads the round, so it sees the caller's writes.
 */
export async function settleStepInTx(
    db: PrismaTx,
    ctx: RequestContext,
    v: ProjectVisibility,
    item: ReviewItem,
    stepId: string,
    now: Date,
    opts: { excludeUserIds?: readonly string[] } = {},
): Promise<ReviewNoticeOut[]> {
    const round = await ReviewRepository.liveRound(db, ctx, item.id);
    const step = round?.steps.find((s) => s.id === stepId);
    if (!round || round.status !== 'OPEN' || !step || step.status !== 'OPEN') return [];
    const verdict = evaluateStep(step.mode, step.reviewers.map((r) => ({ outcome: r.outcome, withdrawn: r.withdrawnAt !== null })));
    if (verdict.verdict === 'OPEN') {
        return verdict.noReviewersLeft
            ? [{ item: itemRef(item), userIds: ownersOf(item, round), notice: { kind: 'stalled', stepId: step.id, stepName: step.name } }]
            : [];
    }
    return endStepAndCarryOn(db, ctx, v, item, round, step, verdict.verdict, now, opts);
}

/** End a step (its pending reviewers withdrawn first) and carry the round on. */
async function endStepAndCarryOn(
    db: PrismaTx,
    ctx: RequestContext,
    v: ProjectVisibility,
    item: ReviewItem,
    round: ReviewRoundRow,
    step: ReviewStepRow,
    endedAs: 'COMPLETED' | 'RETURNED' | 'SKIPPED',
    now: Date,
    opts: { excludeUserIds?: readonly string[]; skipReason?: 'PERSON_SKIPPED' | 'NO_REVIEWERS_LEFT' } = {},
): Promise<ReviewNoticeOut[]> {
    const pending = step.reviewers.filter((r) => r.outcome === null && r.withdrawnAt === null).map((r) => r.id);
    await ReviewRepository.withdrawReviewers(db, ctx, pending, 'STEP_ENDED', now);
    await ReviewRepository.endStep(db, ctx, step.id, {
        status: endedAs,
        endedAt: now,
        ...(endedAs === 'SKIPPED' ? { skippedByUserId: ctx.userId, skipReason: opts.skipReason ?? 'PERSON_SKIPPED' } : {}),
    });
    const next = afterStepEnds(endedAs, nextPendingStep(round.steps, step.position));
    const ref = itemRef(item);
    const owners = ownersOf(item, round).filter((u) => u !== ctx.userId);
    if (next.kind === 'OPEN_NEXT') {
        const nextStep = round.steps.find((s) => s.id === next.stepId)!;
        await ReviewRepository.updateRound(db, ctx, round.id, undefined, {});
        return openStepInTx(db, ctx, item, round, nextStep, now, { refuseEmpty: false, excludeUserIds: opts.excludeUserIds });
    }
    if (next.kind === 'ROUND_RETURNED') {
        await ReviewRepository.withdrawPendingInRounds(db, ctx, [round.id], now);
        await ReviewRepository.withdrawLiveSteps(db, ctx, [round.id], now);
        await ReviewRepository.updateRound(db, ctx, round.id, undefined, { status: 'RETURNED', endReason: 'RETURNED', endedAt: now, endedByUserId: ctx.userId });
        const nextRoundId = await planNextRound(db, ctx, item, round);
        await auditRoundEnded(db, ctx, item, round, 'RETURNED', { stepId: step.id, nextRoundId });
        await waitOnAssigneeAfterRound(db, ctx, v, item, 'review_round_returned');
        return owners.length > 0
            ? [{ item: ref, userIds: owners, notice: { kind: 'returned', stepId: step.id, stepName: step.name, roundNumber: round.number }, actorUserId: ctx.userId }]
            : [];
    }
    await ReviewRepository.updateRound(db, ctx, round.id, undefined, { status: 'COMPLETED', endReason: 'COMPLETED', endedAt: now, endedByUserId: ctx.userId });
    await auditRoundEnded(db, ctx, item, round, 'COMPLETED', { stepId: step.id });
    await waitOnAssigneeAfterRound(db, ctx, v, item, 'review_round_completed');
    return owners.length > 0 ? [{ item: ref, userIds: owners, notice: { kind: 'completed', roundId: round.id, roundNumber: round.number }, actorUserId: ctx.userId }] : [];
}

/**
 * Skip a step (decision 150): an OPEN step ends SKIPPED (its pending
 * reviewers withdrawn) and the round carries on; a PENDING step of an open
 * round ends SKIPPED and is passed over when its turn comes. Never a
 * response. The reason is `NO_REVIEWERS_LEFT` for an open step nobody is
 * left to answer ("closing a step whose reviewers left"), else
 * `PERSON_SKIPPED`.
 */
export async function skipStepInTx(
    db: PrismaTx,
    ctx: RequestContext,
    v: ProjectVisibility,
    item: ReviewItem,
    round: ReviewRoundRow,
    step: ReviewStepRow,
    now: Date,
): Promise<{ reason: 'PERSON_SKIPPED' | 'NO_REVIEWERS_LEFT'; notices: ReviewNoticeOut[] }> {
    const asked = step.reviewers.filter((r) => r.withdrawnAt === null);
    const reason = step.status === 'OPEN' && asked.length === 0 ? 'NO_REVIEWERS_LEFT' : 'PERSON_SKIPPED';
    if (step.status === 'PENDING') {
        const pending = step.reviewers.filter((r) => r.outcome === null && r.withdrawnAt === null).map((r) => r.id);
        await ReviewRepository.withdrawReviewers(db, ctx, pending, 'STEP_ENDED', now);
        await ReviewRepository.endStep(db, ctx, step.id, { status: 'SKIPPED', endedAt: now, skippedByUserId: ctx.userId, skipReason: reason });
        await ReviewRepository.updateRound(db, ctx, round.id, undefined, {});
        return { reason, notices: [] };
    }
    const notices = await endStepAndCarryOn(db, ctx, v, item, round, step, 'SKIPPED', now, { skipReason: reason });
    return { reason, notices };
}

/**
 * End some OPEN rounds unfinished: the item closed (`ITEM_CLOSED`) or was
 * deleted (`ITEM_DELETED`), or a person withdrew it. Their reviewers still
 * asked are withdrawn, then their live steps, then the rounds: nothing that
 * had ended is touched. Waiting on is not set (a closed item waits on nobody;
 * decision 152). A PLANNED round stays PLANNED.
 */
export async function withdrawRoundsInTx(
    db: PrismaTx,
    ctx: RequestContext,
    rounds: ReadonlyArray<{ id: string; workItemId: string; number: number }>,
    reason: 'ITEM_CLOSED' | 'ITEM_DELETED' | 'WITHDRAWN_BY_PERSON',
    now: Date,
    items: ReadonlyMap<string, ReviewItem>,
): Promise<void> {
    if (rounds.length === 0) return;
    const ids = rounds.map((r) => r.id);
    await ReviewRepository.withdrawPendingInRounds(db, ctx, ids, now);
    await ReviewRepository.withdrawLiveSteps(db, ctx, ids, now);
    await ReviewRepository.endRounds(db, ctx, ids, { status: 'WITHDRAWN', endReason: reason, endedAt: now, endedByUserId: ctx.userId });
    for (const r of rounds) {
        const item = items.get(r.workItemId);
        if (item) await auditRoundEnded(db, ctx, item, r, reason);
    }
}

/**
 * Every state path into DONE or CANCELLED, and every delete, ends the item's
 * open round (decision 149; ADR 0009 §14), in the same transaction as the
 * move. A reopen or a restore does not reopen it. Called beside
 * `stateTransitionEffects` by each state path
 * (`tests/guards/review-close-paths.test.ts` pins them).
 */
export async function endOpenRoundsOnClose(
    db: PrismaTx,
    ctx: RequestContext,
    workItemIds: readonly string[],
    reason: 'ITEM_CLOSED' | 'ITEM_DELETED',
    now: Date = new Date(),
): Promise<void> {
    if (workItemIds.length === 0) return;
    const rounds = await ReviewRepository.openRoundsOf(db, ctx, [...new Set(workItemIds)]);
    if (rounds.length === 0) return;
    // The ids come from a gated read (the caller's visible items, or their subtree).
    const items = await WorkItemRepository.listByIds(db, ctx, { kind: 'ALL' }, rounds.map((r) => r.workItemId));
    await withdrawRoundsInTx(db, ctx, rounds, reason, now, new Map(items.map((i) => [i.id, i])));
}

/**
 * A state's delete moves its items to another state (2.2): when that state is
 * closed, the moved items' open rounds end as any close ends them. Called
 * before the move, while the items are still in `stateId`.
 */
export async function endOpenRoundsInState(db: PrismaTx, ctx: RequestContext, stateId: string, now: Date = new Date()): Promise<void> {
    const rounds = await ReviewRepository.openRoundsInState(db, ctx, stateId);
    if (rounds.length === 0) return;
    const items = await WorkItemRepository.listByIds(db, ctx, { kind: 'ALL' }, rounds.map((r) => r.workItemId));
    await withdrawRoundsInTx(db, ctx, rounds, 'ITEM_CLOSED', now, new Map(items.map((i) => [i.id, i])));
}

/** Plan the next round after a person withdrew the open one (ADR 0009 §4: as after a Return). */
export async function planRoundAfterWithdrawal(db: PrismaTx, ctx: RequestContext, item: ReviewItem, round: ReviewRoundRow): Promise<string> {
    return planNextRound(db, ctx, item, round);
}

/**
 * Withdraw reviewer rows and settle the OPEN steps they were on (member
 * removal; an assignee change, decision 158). The items are read once; each
 * affected step is settled with its item.
 */
async function withdrawRowsAndSettle(
    db: PrismaTx,
    ctx: RequestContext,
    v: ProjectVisibility,
    rows: ReadonlyArray<{ id: string; stepId: string; workItemId: string; step: { status: string } }>,
    reason: WithdrawnReason,
    now: Date,
    itemOverride: (item: ReviewItem) => ReviewItem,
    excludeUserIds: readonly string[],
): Promise<ReviewNoticeOut[]> {
    if (rows.length === 0) return [];
    // Every item a settle may write (waiting on), locked in id order before
    // the first write (decision 173); a no-op where the caller locked them.
    await WorkItemRepository.lockForWrite(db, ctx, rows.map((r) => r.workItemId));
    await ReviewRepository.withdrawReviewers(db, ctx, rows.map((r) => r.id), reason, now);
    const openSteps = [...new Map(rows.filter((r) => r.step.status === 'OPEN').map((r) => [r.stepId, r.workItemId])).entries()];
    if (openSteps.length === 0) return [];
    const items = new Map((await WorkItemRepository.listByIds(db, ctx, { kind: 'ALL' }, [...new Set(openSteps.map(([, w]) => w))])).map((i) => [i.id, i]));
    const notices: ReviewNoticeOut[] = [];
    for (const [stepId, workItemId] of openSteps) {
        const item = items.get(workItemId);
        if (!item) continue;
        // guardrail-allow: n+1 — one settle per affected open step, bounded by a person's pending rows.
        notices.push(...(await settleStepInTx(db, ctx, v, itemOverride(item), stepId, now, { excludeUserIds })));
    }
    return notices;
}

/**
 * Member removal (ADR 0009, Consequences): the member's reviewer rows still
 * asked are withdrawn (`MEMBER_REMOVED`) before the membership goes, audited,
 * and each open step they were on is settled; a step left with nobody stays
 * open, flagged, never completed.
 */
export async function withdrawReviewerRowsOfUser(
    db: PrismaTx,
    ctx: RequestContext,
    userId: string,
    now: Date = new Date(),
): Promise<{ withdrawn: number; notices: ReviewNoticeOut[] }> {
    const rows = await ReviewRepository.pendingRowsOf(db, ctx, userId);
    const notices = await withdrawRowsAndSettle(db, ctx, { kind: 'ALL' }, rows, 'MEMBER_REMOVED', now, (i) => i, [userId]);
    return { withdrawn: rows.length, notices };
}

/**
 * Decision 158: when an item's assignee changes to a person who is a
 * reviewer still asked on its live round, their rows are withdrawn
 * (`BECAME_ASSIGNEE`), audited per item, and each open step is settled. A
 * person never reviews their own work.
 */
export async function withdrawNewAssigneeRows(
    db: PrismaTx,
    ctx: RequestContext,
    v: ProjectVisibility,
    items: readonly ReviewItem[],
    assigneeId: string | null,
    now: Date = new Date(),
): Promise<ReviewNoticeOut[]> {
    if (!assigneeId || items.length === 0) return [];
    const rows = await ReviewRepository.pendingRowsOf(db, ctx, assigneeId, items.map((i) => i.id));
    if (rows.length === 0) return [];
    const byItem = new Map(items.map((i) => [i.id, i]));
    for (const workItemId of new Set(rows.map((r) => r.workItemId))) {
        const item = byItem.get(workItemId);
        if (!item) continue;
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_REVIEWER_WITHDRAWN',
            entityType: 'WorkItem',
            entityId: workItemId,
            details: `Withdrew the new assignee of ${formatKey(item.project.keyPrefix, item.number)} as a reviewer`,
            detailsJson: { category: 'custom', event: 'reviewer_withdrawn', userId: assigneeId, reason: 'BECAME_ASSIGNEE', stepIds: rows.filter((r) => r.workItemId === workItemId).map((r) => r.stepId) },
            metadata: { userId: assigneeId, reason: 'BECAME_ASSIGNEE' },
        });
    }
    return withdrawRowsAndSettle(db, ctx, v, rows, 'BECAME_ASSIGNEE', now, (i) => ({ ...i, assigneeId }), []);
}
