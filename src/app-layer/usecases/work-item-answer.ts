/**
 * A work item's marked answer (sub-phase 2.4b-c; ADR 0002 §15; owner
 * decisions 113 to 118).
 *
 *   - **Mark** names one live comment of the item as its answer. A person
 *     does it, never an API key or an agent (`assertActingAsPerson`), under
 *     `work_items.edit`, and only where the item's field set shows the answer
 *     (decision 118; a hidden answer is the field set's 400 `FIELD_HIDDEN`).
 *     An open item moves to a Done state in the same versioned write
 *     (`planAnswerMark`, decision 114), through `stateTransitionEffects`, so
 *     waiting on is cleared and the transition trigger records the move; a
 *     closed item keeps its state (decision 115).
 *   - **Clear** removes the pointer only: the state stays, and clearing never
 *     reopens (decision 115).
 *
 * Both are single-field changes: `If-Match` optional, the version increases.
 * Audited inside the transaction (`WORK_ITEM_ANSWER_MARKED` /
 * `WORK_ITEM_ANSWER_CLEARED`, naming the comment's id, never its text, then
 * the state change's own entry); after the commit, the state change's
 * automation and fan-out, and the watchers are told the item was answered
 * (decision 117).
 *
 * While a comment is the answer, editing or deleting it is refused until the
 * answer is cleared (decision 113; `comment.policies.ts`, `work-item-collab.ts`,
 * and the trigger `comment_answer_not_deleted` behind them).
 *
 * Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import { assertActingAsPerson } from '../policies/person-only.policies';
import { assertCanEditWorkItems } from '../policies/work-item.policies';
import { visibleProjects } from '../policies/project-visibility';
import { CommentRepository, WorkItemRepository } from '../repositories/WorkItemRepository';
import { TeamRepository } from '../repositories/TeamRepository';
import { planAnswerMark } from '../domain/work-item-answer';
import { checkWorkflowStateTransition, formatStateTransitionError, stateTransitionEffects } from '../domain/workflow-state';
import { assertFieldWrite } from './field-set';
import { afterStateCommit, applyStateAudit, getWorkItem } from './work-item';
import { emitWatcherActivity, keyOf, loadWritableItem, throwWriteConflict } from './work-item-shared';
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { badRequest, ConflictError, notFound } from '@/lib/errors/types';

export async function markWorkItemAnswer(
    ctx: RequestContext,
    id: string,
    input: { commentId: string; stateId?: string | null },
    expectedVersion?: number,
) {
    assertActingAsPerson(ctx, 'Marking an answer');
    assertCanEditWorkItems(ctx);
    const outcome = await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const item = await loadWritableItem(db, ctx, v, id);
        // Decision 118: only where the type's field set shows the answer.
        await assertFieldWrite(db, ctx, item, { answerCommentId: input.commentId });
        const comment = await CommentRepository.get(db, ctx, item.id, input.commentId);
        if (!comment) throw notFound('Comment not found');
        if (item.answerCommentId === comment.id) return { changed: false as const };

        const states = await TeamRepository.listStates(db, ctx, item.teamId, { includeArchived: true });
        const plan = planAnswerMark(item, states, input.stateId);
        if (plan.kind === 'refused') {
            if (plan.reason === 'NO_DONE_STATE') {
                throw new ConflictError("The team's workflow has no live Done state to move the answered item to.", { reason: 'NO_DONE_STATE' });
            }
            throw badRequest("Choose a live Done state of the item's team.", { reason: 'NOT_A_DONE_STATE' });
        }

        const from = plan.kind === 'move' ? states.find((s) => s.id === item.stateId) : undefined;
        if (plan.kind === 'move') {
            const err = checkWorkflowStateTransition(from!, plan.to);
            if (err) throw badRequest(formatStateTransitionError(err), { reason: err.kind });
        }
        const move =
            plan.kind === 'move'
                ? { stateId: plan.to.id, stateCategory: plan.to.category, ...stateTransitionEffects(from!.category, plan.to.category, item) }
                : {};
        const count = await WorkItemRepository.updateVersioned(db, ctx, v, id, expectedVersion, { answerCommentId: comment.id, ...move });
        if (count === 0) await throwWriteConflict(db, ctx, v, id);
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_ANSWER_MARKED',
            entityType: 'WorkItem',
            entityId: id,
            details: `Marked the answer of ${keyOf(item)}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItem', operation: 'updated', changedFields: ['answerCommentId'] },
            metadata: { commentId: comment.id, fromCommentId: item.answerCommentId, ...(plan.kind === 'move' ? { toStateId: plan.to.id } : {}) },
        });
        if (plan.kind === 'move') await applyStateAudit(db, ctx, item, from!, plan.to);
        return { changed: true as const, item, move: plan.kind === 'move' ? { from: from!, to: plan.to } : null, commentId: comment.id };
    });

    if (outcome.changed) {
        // After the COMMIT: the state change's automation and fan-out, then "answered".
        if (outcome.move) await afterStateCommit(ctx, [{ item: outcome.item, from: outcome.move.from, to: outcome.move.to }]);
    }
    const after = await getWorkItem(ctx, id);
    if (outcome.changed) {
        await emitWatcherActivity(ctx, [{ workItemId: id, kind: 'answered', discriminator: `${outcome.commentId}:v${after.version}`, detail: 'answered' }]);
    }
    return after;
}

export async function clearWorkItemAnswer(ctx: RequestContext, id: string, expectedVersion?: number) {
    assertActingAsPerson(ctx, 'Clearing an answer');
    assertCanEditWorkItems(ctx);
    const outcome = await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const item = await loadWritableItem(db, ctx, v, id);
        if (!item.answerCommentId) return { changed: false as const };
        const count = await WorkItemRepository.updateVersioned(db, ctx, v, id, expectedVersion, { answerCommentId: null });
        if (count === 0) await throwWriteConflict(db, ctx, v, id);
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_ANSWER_CLEARED',
            entityType: 'WorkItem',
            entityId: id,
            details: `Cleared the answer of ${keyOf(item)}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItem', operation: 'updated', changedFields: ['answerCommentId'] },
            metadata: { fromCommentId: item.answerCommentId },
        });
        return { changed: true as const, commentId: item.answerCommentId };
    });
    const after = await getWorkItem(ctx, id);
    if (outcome.changed) {
        await emitWatcherActivity(ctx, [{ workItemId: id, kind: 'updated', discriminator: `answer-cleared:${outcome.commentId}:v${after.version}`, detail: 'answer cleared' }]);
    }
    return after;
}
