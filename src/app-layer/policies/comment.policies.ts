/**
 * Who may change a comment (owner decision, 2026-11-19).
 *
 *   - **Edit:** the author only. A workspace admin never rewrites someone
 *     else's words: an edited comment still reads as its author's.
 *   - **Delete:** the author, or a workspace admin (`canAdmin`) for
 *     moderation. An admin's delete of someone else's comment is audited as a
 *     moderation action (`COMMENT_MODERATED`), never as the author's own.
 *
 *   - **The marked answer** (sub-phase 2.4b-c, owner decision 113): while a
 *     comment is its item's answer, neither its author nor an admin edits or
 *     deletes it; the answer is cleared first (an admin moderates by
 *     clearing, then deleting). The usecases answer 409 `ANSWER_LOCKED`, and
 *     the trigger `comment_answer_not_deleted` refuses the soft delete.
 *   - **Marking an answer** is offered to a person who may edit the item,
 *     where its field set shows the answer (decisions 113 and 118).
 *
 * Both sit behind the route's `work_items.comment` key and the usecase's
 * `assertCanCommentOnWorkItems`; these rules decide between people who already
 * hold it. Pure, so the decision is tested without a database.
 *
 * Written fresh for Islestone.
 */
import type { RequestContext } from '../types';

/** Why a delete is allowed: the author's own, or an admin moderating. */
export type CommentDeleteBasis = 'author' | 'moderation';

export function mayEditComment(ctx: Pick<RequestContext, 'userId'>, comment: { authorUserId: string }): boolean {
    return comment.authorUserId === ctx.userId;
}

/** The basis a delete rests on, or `null` when the caller may not delete it. */
export function commentDeleteBasis(
    ctx: Pick<RequestContext, 'userId' | 'permissions'>,
    comment: { authorUserId: string },
): CommentDeleteBasis | null {
    if (comment.authorUserId === ctx.userId) return 'author';
    if (ctx.permissions.canAdmin) return 'moderation';
    return null;
}

/** Is this comment its item's marked answer (2.4b-c)? Then it is locked until the answer is cleared (decision 113). */
export function isMarkedAnswer(comment: { id: string }, item: { answerCommentId?: string | null }): boolean {
    return Boolean(item.answerCommentId) && item.answerCommentId === comment.id;
}

/** What a viewer may do with one comment: the buttons the detail renders, from the rules the server asks. */
export interface CommentAffordances {
    edit: boolean;
    deleteBasis: CommentDeleteBasis | null;
    /** It is the item's marked answer: edit and delete wait until the answer is cleared. */
    isAnswer: boolean;
    /** "Mark as answer": a person who may edit the item, the answer shown by its field set, not already the answer. */
    markAnswer: boolean;
}

export function commentAffordances(
    ctx: Pick<RequestContext, 'userId' | 'permissions'>,
    comment: { id: string; authorUserId: string },
    item: { answerCommentId?: string | null },
    opts: { mayEditItem: boolean; answerShown: boolean },
): CommentAffordances {
    const isAnswer = isMarkedAnswer(comment, item);
    return {
        edit: !isAnswer && mayEditComment(ctx, comment),
        deleteBasis: isAnswer ? null : commentDeleteBasis(ctx, comment),
        isAnswer,
        markAnswer: !isAnswer && opts.mayEditItem && opts.answerShown,
    };
}
