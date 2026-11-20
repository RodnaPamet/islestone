/**
 * Review rounds, steps, the lists they name and their reviewers (sub-phase
 * 2.8a; ADR 0009). Every query filters by `tenantId` (RLS also scopes it);
 * the caller has already passed the item's gate (`loadWritableItem` /
 * `loadVisibleItem`), which carries `deletedAt` and project visibility.
 *
 * What the database holds besides (migration `20261208120600_reviews`): one
 * live round per item, one open step per round, and the triggers that keep an
 * ended round, an ended step and their responses from being rewritten. A
 * write here that the triggers refuse is a bug in the caller, never a path
 * to work around.
 *
 * Only `recordResponse` writes a reviewer's `outcome`, and only the respond
 * usecase calls it (`tests/guards/review-response-seam.test.ts`).
 *
 * Written fresh for Islestone. The pending-row claim of `recordResponse` is
 * inflect-compliance's `PolicyApprovalRepository.decide` pattern (a
 * conditional `updateMany` on the row still being what was read), pattern
 * only, no code copied.
 */
import type { Prisma, ReviewOutcome, ReviewStepMode } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import { REVIEW_LIMITS } from '../domain/review-steps';
import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId' | 'userId'>;

/** Rounds shown for one item: far beyond a real item's history. */
export const REVIEW_ROUNDS_TAKE = 50;
/** A person's pending rows across the workspace (member removal). */
export const REVIEWER_PENDING_TAKE = 2_000;
/** Rows of one step: named members, plus every list's people. */
const STEP_REVIEWERS_TAKE = 1_000;

const reviewerSelect = {
    id: true,
    stepId: true,
    roundId: true,
    workItemId: true,
    userId: true,
    viaRecipientListId: true,
    outcome: true,
    respondedAt: true,
    responseText: true,
    itemVersionAt: true,
    withdrawnAt: true,
    withdrawnReason: true,
    createdAt: true,
} satisfies Prisma.WorkItemReviewerSelect;

const stepSelect = {
    id: true,
    roundId: true,
    workItemId: true,
    position: true,
    name: true,
    mode: true,
    dueInWorkingDays: true,
    status: true,
    openedAt: true,
    dueOn: true,
    endedAt: true,
    skippedByUserId: true,
    skipReason: true,
    lists: { select: { recipientListId: true, list: { select: { id: true, name: true, projectId: true, archivedAt: true } } }, take: REVIEW_LIMITS.maxListsPerStep * 2 },
    reviewers: { select: reviewerSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: STEP_REVIEWERS_TAKE },
} satisfies Prisma.WorkItemReviewStepSelect;

const roundSelect = {
    id: true,
    workItemId: true,
    number: true,
    status: true,
    startedByUserId: true,
    startedAt: true,
    endedAt: true,
    endedByUserId: true,
    endReason: true,
    version: true,
    createdById: true,
    createdAt: true,
    steps: { select: stepSelect, orderBy: { position: 'asc' }, take: REVIEW_LIMITS.maxSteps * 2 },
} satisfies Prisma.WorkItemReviewRoundSelect;

export type ReviewRoundRow = Prisma.WorkItemReviewRoundGetPayload<{ select: typeof roundSelect }>;
export type ReviewStepRow = ReviewRoundRow['steps'][number];
export type ReviewerRow = ReviewStepRow['reviewers'][number];

export interface NewStep {
    position: number;
    name: string;
    mode: ReviewStepMode;
    dueInWorkingDays: number;
    memberIds: readonly string[];
    recipientListIds: readonly string[];
}

export class ReviewRepository {
    /**
     * Lock the item's row for a review write. Every write to an item's review
     * takes it first, and so does a waiting-on write (which a round's opening
     * clears), so two responses, a response and a skip, a response and a step
     * edit, or a send and a waiting-on write serialise.
     */
    static async lockItem(db: PrismaTx, ctx: Ctx, workItemId: string): Promise<void> {
        await db.$queryRaw`SELECT "id" FROM "WorkItem" WHERE "id" = ${workItemId} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
    }

    /**
     * Lock several items' rows, in id order (so two batches never deadlock):
     * the Done check (2.8c) reads their rounds under the same lock every
     * review write takes, so a round cannot be planned or reopened between
     * the check and the move.
     */
    static async lockItems(db: PrismaTx, ctx: Ctx, workItemIds: readonly string[]): Promise<void> {
        const ids = [...new Set(workItemIds)].sort();
        if (ids.length === 0) return;
        await db.$queryRaw`SELECT "id" FROM "WorkItem" WHERE "id" = ANY(${ids}::text[]) AND "tenantId" = ${ctx.tenantId} ORDER BY "id" FOR UPDATE`;
    }

    /**
     * The rounds the Done check reads (2.8c, decision 149): every round of
     * these items that has at least one step, with its OPEN step's name. A
     * planned round with no steps left is no review, so it is not read.
     */
    static async doneCheckRounds(db: PrismaTx, ctx: Ctx, workItemIds: readonly string[]) {
        const ids = [...new Set(workItemIds)];
        if (ids.length === 0) return [];
        const rows = await db.workItemReviewRound.findMany({
            where: { tenantId: ctx.tenantId, workItemId: { in: ids }, steps: { some: {} } },
            orderBy: [{ workItemId: 'asc' }, { number: 'desc' }],
            take: ids.length * REVIEW_ROUNDS_TAKE,
            select: {
                workItemId: true,
                number: true,
                status: true,
                _count: { select: { steps: true } },
                steps: { where: { status: 'OPEN' }, select: { name: true }, take: 1 },
            },
        });
        return rows.map((r) => ({ workItemId: r.workItemId, number: r.number, status: r.status, stepCount: r._count.steps, openStepName: r.steps[0]?.name ?? null }));
    }

    /**
     * The items in one workflow state whose type requires review before Done
     * (a state's delete moves them all; 2.8c), deleted ones included: a
     * restore would bring one back into the target state.
     */
    static async itemsInStateRequiringReview(db: PrismaTx, ctx: Ctx, stateId: string) {
        return db.workItem.findMany({
            where: { tenantId: ctx.tenantId, stateId, type: { reviewRequiredForDone: true } },
            orderBy: { id: 'asc' },
            // A state's items whose type requires review: far above a real state's.
            take: 10_000,
            select: { id: true, number: true, project: { select: { keyPrefix: true } } },
        });
    }

    /** The item's PLANNED or OPEN round, with its steps, lists and reviewers. */
    static async liveRound(db: PrismaTx, ctx: Ctx, workItemId: string): Promise<ReviewRoundRow | null> {
        return db.workItemReviewRound.findFirst({
            where: { tenantId: ctx.tenantId, workItemId, status: { in: ['PLANNED', 'OPEN'] } },
            select: roundSelect,
        });
    }

    /** The item's rounds, newest first. */
    static async listRounds(db: PrismaTx, ctx: Ctx, workItemId: string): Promise<ReviewRoundRow[]> {
        return db.workItemReviewRound.findMany({
            where: { tenantId: ctx.tenantId, workItemId },
            orderBy: { number: 'desc' },
            take: REVIEW_ROUNDS_TAKE,
            select: roundSelect,
        });
    }

    /** Is this a step of one of the item's rounds (any round, ended ones included)? */
    static async stepOfItemExists(db: PrismaTx, ctx: Ctx, workItemId: string, stepId: string): Promise<boolean> {
        const row = await db.workItemReviewStep.findFirst({ where: { id: stepId, tenantId: ctx.tenantId, workItemId }, select: { id: true } });
        return row !== null;
    }

    /** Is a round of the item OPEN (the waiting-on refusal, decision 153)? */
    static async hasOpenRound(db: PrismaTx, ctx: Ctx, workItemId: string): Promise<boolean> {
        const row = await db.workItemReviewRound.findFirst({
            where: { tenantId: ctx.tenantId, workItemId, status: 'OPEN' },
            select: { id: true },
        });
        return row !== null;
    }

    static async lastRoundNumber(db: PrismaTx, ctx: Ctx, workItemId: string): Promise<number> {
        const row = await db.workItemReviewRound.findFirst({
            where: { tenantId: ctx.tenantId, workItemId },
            orderBy: { number: 'desc' },
            select: { number: true },
        });
        return row?.number ?? 0;
    }

    static async createRound(db: PrismaTx, ctx: Ctx, workItemId: string, number: number): Promise<{ id: string; number: number }> {
        return db.workItemReviewRound.create({
            data: { tenantId: ctx.tenantId, workItemId, number, createdById: ctx.userId },
            select: { id: true, number: true },
        });
    }

    /**
     * A write to a live round that increases its version; with
     * `expectedVersion`, only when it still has that version. Returns the
     * count (0: the round moved on, or ended).
     */
    static async updateRound(
        db: PrismaTx,
        ctx: Ctx,
        roundId: string,
        expectedVersion: number | undefined,
        data: Prisma.WorkItemReviewRoundUpdateManyMutationInput,
    ): Promise<number> {
        const result = await db.workItemReviewRound.updateMany({
            where: { id: roundId, tenantId: ctx.tenantId, status: { in: ['PLANNED', 'OPEN'] }, ...(expectedVersion !== undefined ? { version: expectedVersion } : {}) },
            data: { ...data, version: { increment: 1 } },
        });
        return result.count;
    }

    /** End OPEN rounds (the item closed or was deleted): every one at once. */
    static async endRounds(db: PrismaTx, ctx: Ctx, roundIds: readonly string[], data: { status: 'WITHDRAWN'; endReason: string; endedAt: Date; endedByUserId: string | null }) {
        if (roundIds.length === 0) return 0;
        const result = await db.workItemReviewRound.updateMany({
            where: { id: { in: [...roundIds] }, tenantId: ctx.tenantId, status: 'OPEN' },
            data: { ...data, version: { increment: 1 } },
        });
        return result.count;
    }

    /** The OPEN rounds of some items (every state path into a closed category, every delete). */
    static async openRoundsOf(db: PrismaTx, ctx: Ctx, workItemIds: readonly string[]) {
        if (workItemIds.length === 0) return [];
        return db.workItemReviewRound.findMany({
            where: { tenantId: ctx.tenantId, workItemId: { in: [...workItemIds] }, status: 'OPEN' },
            take: workItemIds.length,
            select: { id: true, workItemId: true, number: true },
        });
    }

    /** The OPEN rounds of the items in one workflow state (a state's delete moves them; 2.2). */
    static async openRoundsInState(db: PrismaTx, ctx: Ctx, stateId: string) {
        return db.workItemReviewRound.findMany({
            where: { tenantId: ctx.tenantId, status: 'OPEN', workItem: { stateId } },
            // An open round per item at most; far above a real state's open reviews.
            take: 10_000,
            select: { id: true, workItemId: true, number: true },
        });
    }

    /** Remove a round's PENDING steps (their lists and named reviewers go with them). */
    static async deletePendingSteps(db: PrismaTx, ctx: Ctx, roundId: string, stepIds: readonly string[]) {
        if (stepIds.length === 0) return 0;
        const result = await db.workItemReviewStep.deleteMany({
            where: { id: { in: [...stepIds] }, tenantId: ctx.tenantId, roundId, status: 'PENDING' },
        });
        return result.count;
    }

    /** Add PENDING steps with their named members and lists. */
    static async createSteps(db: PrismaTx, ctx: Ctx, round: { id: string; workItemId: string }, steps: readonly NewStep[]) {
        for (const s of steps) {
            // guardrail-allow: n+1 — at most REVIEW_LIMITS.maxSteps steps, each a create that needs its own id.
            const step = await db.workItemReviewStep.create({
                data: {
                    tenantId: ctx.tenantId,
                    roundId: round.id,
                    workItemId: round.workItemId,
                    position: s.position,
                    name: s.name,
                    mode: s.mode,
                    dueInWorkingDays: s.dueInWorkingDays,
                },
                select: { id: true },
            });
            if (s.recipientListIds.length > 0) {
                await db.workItemReviewStepList.createMany({
                    data: s.recipientListIds.map((recipientListId) => ({ tenantId: ctx.tenantId, stepId: step.id, recipientListId })),
                });
            }
            if (s.memberIds.length > 0) {
                await db.workItemReviewer.createMany({
                    data: s.memberIds.map((userId) => ({
                        tenantId: ctx.tenantId,
                        stepId: step.id,
                        roundId: round.id,
                        workItemId: round.workItemId,
                        userId,
                        addedById: ctx.userId,
                    })),
                });
            }
        }
    }

    /** Add reviewers to a PENDING or OPEN step (a list's people when it opens, or a person added). */
    static async addReviewers(
        db: PrismaTx,
        ctx: Ctx,
        step: { id: string; roundId: string; workItemId: string },
        rows: ReadonlyArray<{ userId: string; viaRecipientListId: string | null }>,
    ) {
        if (rows.length === 0) return 0;
        const result = await db.workItemReviewer.createMany({
            data: rows.map((r) => ({
                tenantId: ctx.tenantId,
                stepId: step.id,
                roundId: step.roundId,
                workItemId: step.workItemId,
                userId: r.userId,
                viaRecipientListId: r.viaRecipientListId,
                addedById: ctx.userId,
            })),
            skipDuplicates: true,
        });
        return result.count;
    }

    /** Withdraw reviewers still asked (no response, not withdrawn). */
    static async withdrawReviewers(db: PrismaTx, ctx: Ctx, ids: readonly string[], reason: string, now: Date) {
        if (ids.length === 0) return 0;
        const result = await db.workItemReviewer.updateMany({
            where: { id: { in: [...ids] }, tenantId: ctx.tenantId, outcome: null, withdrawnAt: null },
            data: { withdrawnAt: now, withdrawnReason: reason },
        });
        return result.count;
    }

    /**
     * Withdraw every reviewer still asked in some rounds' PENDING and OPEN
     * steps (a round's withdrawal: the item closed or was deleted, or a person
     * withdrew it). Ended steps' rows are frozen and not touched.
     */
    static async withdrawPendingInRounds(db: PrismaTx, ctx: Ctx, roundIds: readonly string[], now: Date) {
        if (roundIds.length === 0) return 0;
        const result = await db.workItemReviewer.updateMany({
            where: {
                tenantId: ctx.tenantId,
                roundId: { in: [...roundIds] },
                outcome: null,
                withdrawnAt: null,
                step: { status: { in: ['PENDING', 'OPEN'] } },
            },
            data: { withdrawnAt: now, withdrawnReason: 'STEP_ENDED' },
        });
        return result.count;
    }

    /** End some rounds' PENDING and OPEN steps as WITHDRAWN. */
    static async withdrawLiveSteps(db: PrismaTx, ctx: Ctx, roundIds: readonly string[], now: Date) {
        if (roundIds.length === 0) return 0;
        const result = await db.workItemReviewStep.updateMany({
            where: { tenantId: ctx.tenantId, roundId: { in: [...roundIds] }, status: { in: ['PENDING', 'OPEN'] } },
            data: { status: 'WITHDRAWN', endedAt: now },
        });
        return result.count;
    }

    /** Open a PENDING step: its time and its stored due day. */
    static async openStep(db: PrismaTx, ctx: Ctx, stepId: string, now: Date, dueOn: Date) {
        const result = await db.workItemReviewStep.updateMany({
            where: { id: stepId, tenantId: ctx.tenantId, status: 'PENDING' },
            data: { status: 'OPEN', openedAt: now, dueOn },
        });
        return result.count;
    }

    /** End a PENDING or OPEN step. */
    static async endStep(
        db: PrismaTx,
        ctx: Ctx,
        stepId: string,
        data: { status: 'COMPLETED' | 'RETURNED' | 'SKIPPED' | 'WITHDRAWN'; endedAt: Date; skippedByUserId?: string; skipReason?: string },
    ) {
        const result = await db.workItemReviewStep.updateMany({
            where: { id: stepId, tenantId: ctx.tenantId, status: { in: ['PENDING', 'OPEN'] } },
            data,
        });
        return result.count;
    }

    /**
     * Record or change one reviewer's response: the claim on the row still
     * being what was read (`previous`: its outcome, `null` for a first
     * response) and still asked. The step being OPEN is held by the trigger.
     * Count 0: someone else's write got there first (409).
     */
    static async recordResponse(
        db: PrismaTx,
        ctx: Ctx,
        reviewerId: string,
        previous: ReviewOutcome | null,
        data: { outcome: ReviewOutcome; responseText: string | null; itemVersionAt: number; respondedAt: Date },
    ): Promise<number> {
        const result = await db.workItemReviewer.updateMany({
            where: { id: reviewerId, tenantId: ctx.tenantId, userId: ctx.userId, withdrawnAt: null, outcome: previous },
            data,
        });
        return result.count;
    }

    /**
     * A person's rows still asked, in steps not yet ended of live rounds:
     * member removal (decision 158's sibling: a person who left is withdrawn)
     * and an assignee change.
     */
    static async pendingRowsOf(db: PrismaTx, ctx: Ctx, userId: string, workItemIds?: readonly string[]) {
        return db.workItemReviewer.findMany({
            where: {
                tenantId: ctx.tenantId,
                userId,
                outcome: null,
                withdrawnAt: null,
                ...(workItemIds ? { workItemId: { in: [...workItemIds] } } : {}),
                step: { status: { in: ['PENDING', 'OPEN'] }, round: { status: { in: ['PLANNED', 'OPEN'] } } },
            },
            take: REVIEWER_PENDING_TAKE,
            select: { id: true, stepId: true, roundId: true, workItemId: true, step: { select: { status: true } } },
        });
    }

    /** The open steps' pending reviewers of some items (the waiting-on read model, decision 152). */
    static async pendingReviewersOfItems(db: PrismaTx, ctx: Ctx, workItemIds: readonly string[]) {
        if (workItemIds.length === 0) return [];
        return db.workItemReviewer.findMany({
            where: {
                tenantId: ctx.tenantId,
                workItemId: { in: [...workItemIds] },
                outcome: null,
                withdrawnAt: null,
                step: { status: 'OPEN' },
            },
            take: workItemIds.length * 50,
            select: { workItemId: true, userId: true, stepId: true },
        });
    }

    /**
     * The 08:00 reminder's candidates (decision 161): rows still asked in an
     * OPEN step of an OPEN round, due on or before `dueOnOrBefore` (overdue
     * included), of live items in live, unarchived projects, in pages keyed
     * on the row id. The person's membership is read so the job reminds only
     * an ACTIVE member whose role sees the project.
     */
    static async dueReviewCandidates(db: PrismaTx, tenantId: string, dueOnOrBefore: Date, afterId: string | null, take: number) {
        return db.workItemReviewer.findMany({
            where: {
                tenantId,
                outcome: null,
                withdrawnAt: null,
                ...(afterId ? { id: { gt: afterId } } : {}),
                step: { status: 'OPEN', dueOn: { lte: dueOnOrBefore }, round: { status: 'OPEN' } },
                workItem: { deletedAt: null, project: { deletedAt: null, archivedAt: null } },
            },
            orderBy: { id: 'asc' },
            take,
            select: {
                id: true,
                userId: true,
                stepId: true,
                step: { select: { name: true, dueOn: true } },
                workItem: { select: { id: true, title: true, number: true, projectId: true, project: { select: { keyPrefix: true } } } },
                user: {
                    select: {
                        tenantMemberships: {
                            where: { tenantId },
                            take: 1,
                            select: { status: true, role: true, customRole: { select: { baseRole: true } } },
                        },
                    },
                },
            },
        });
    }
}
