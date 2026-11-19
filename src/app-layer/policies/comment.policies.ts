/**
 * Who may change a comment (owner decision, 2026-11-19).
 *
 *   - **Edit:** the author only. A workspace admin never rewrites someone
 *     else's words: an edited comment still reads as its author's.
 *   - **Delete:** the author, or a workspace admin (`canAdmin`) for
 *     moderation. An admin's delete of someone else's comment is audited as a
 *     moderation action (`COMMENT_MODERATED`), never as the author's own.
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
