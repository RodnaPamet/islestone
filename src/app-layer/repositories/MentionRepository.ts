/**
 * `Mention` rows (sub-phase 2.7d; owner decisions 127 to 130): who a comment
 * or a work item's description mentions. The rows are the authority the
 * renderer reads, written only by `recordMentionsInTx`
 * (`src/app-layer/usecases/mention.ts`) for a person's own edit. Every query
 * filters by `tenantId`; the caller has already checked the item is visible.
 *
 * Written fresh for Islestone.
 */
import { MAX_MENTIONS_PER_TEXT } from '../domain/mention';
import type { PrismaTx } from '@/lib/db-context';
import type { RequestContext } from '../types';

/** One source: a comment, or the item's description (`commentId` null). */
export interface MentionSourceRef {
    workItemId: string;
    commentId: string | null;
}

/**
 * A bound on one source's rows: a text records at most
 * `MAX_MENTIONS_PER_TEXT`, and an edit only removes rows whose token went, so
 * a source never holds more than that many plus the ones recorded before a cap
 * change.
 */
const SOURCE_TAKE = MAX_MENTIONS_PER_TEXT * 5;

export class MentionRepository {
    /** The people one source mentions. */
    static async listForSource(db: PrismaTx, ctx: RequestContext, source: MentionSourceRef): Promise<Set<string>> {
        const rows = await db.mention.findMany({
            where: { tenantId: ctx.tenantId, workItemId: source.workItemId, commentId: source.commentId },
            take: SOURCE_TAKE,
            select: { mentionedUserId: true },
        });
        return new Set(rows.map((r) => r.mentionedUserId));
    }

    /**
     * The rows of a page of an item's comments, in one read, for the
     * comments' chips.
     */
    static async listForComments(db: PrismaTx, ctx: RequestContext, workItemId: string, commentIds: readonly string[]) {
        if (commentIds.length === 0) return [];
        return db.mention.findMany({
            where: { tenantId: ctx.tenantId, workItemId, commentId: { in: [...commentIds] } },
            take: commentIds.length * SOURCE_TAKE,
            select: { commentId: true, mentionedUserId: true },
        });
    }

    /** Record people for one source; a row already there is kept as is. */
    static async add(db: PrismaTx, ctx: RequestContext, source: MentionSourceRef, userIds: readonly string[]) {
        if (userIds.length === 0) return { count: 0 };
        return db.mention.createMany({
            data: userIds.map((mentionedUserId) => ({
                tenantId: ctx.tenantId,
                workItemId: source.workItemId,
                commentId: source.commentId,
                mentionedUserId,
                mentionedById: ctx.userId,
            })),
            skipDuplicates: true,
        });
    }

    /** Remove people from one source (their token left the text). */
    static async remove(db: PrismaTx, ctx: RequestContext, source: MentionSourceRef, userIds: readonly string[]) {
        if (userIds.length === 0) return { count: 0 };
        return db.mention.deleteMany({
            where: { tenantId: ctx.tenantId, workItemId: source.workItemId, commentId: source.commentId, mentionedUserId: { in: [...userIds] } },
        });
    }

    /** A comment's rows, when the comment is deleted (soft: its text stays for the purge). */
    static async removeForComment(db: PrismaTx, ctx: RequestContext, workItemId: string, commentId: string) {
        return db.mention.deleteMany({ where: { tenantId: ctx.tenantId, workItemId, commentId } });
    }
}
