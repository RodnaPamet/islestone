/**
 * Comments, watchers, links and labels on a work item (sub-phase 2.2).
 *
 * Copied from inflect-compliance `src/app-layer/usecases/task.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (comments 1773–1803, watchers
 * 1807–1853, links 1594–1657) and edited per docs/porting/maps/2.1-2.2.md:
 *
 *   - every write first checks the item is live and visible (the source's
 *     watcher removal did not), and refuses an archived project's item;
 *   - comment bodies are sanitised and stored encrypted; edits and deletes
 *     are new: the author edits, the author or a workspace admin deletes
 *     (moderation, audited as such; `comment.policies.ts`), deletes are soft;
 *   - watching and unwatching are mutations and are audited
 *     (`WORK_ITEM_WATCHER_ADDED` / `_REMOVED`, the source wrote nothing); the
 *     self/other split lives in the routes, so "watch someone else" without
 *     `work_items.edit` is an audited `requirePermission` denial, and the
 *     usecases keep their asserts for callers that are not routes;
 *   - links are `WorkItemLink` rows (a URL, pull request or commit), with no
 *     polymorphic entity targets;
 *   - attaching or detaching a label increases the item's version (ADR 0002 §9);
 *   - a comment's mentions (2.7d, decisions 127 to 130) are recorded in the
 *     write's transaction (`recordMentionsInTx`) and rung after the commit
 *     (`emitMentionBells`), before the watcher fan-out, which skips them; a
 *     page of comments carries each comment's recorded people (`mentions`),
 *     the only tokens the renderer shows as chips.
 */
import { logEvent } from '../events/audit';
import { commentDeleteBasis, isMarkedAnswer, mayEditComment } from '../policies/comment.policies';
import { LabelRepository } from '../repositories/LabelRepository';
import { MembershipRepository } from '../repositories/MembershipRepository';
import { MentionRepository } from '../repositories/MentionRepository';
import { SearchVectorRepository } from '../repositories/SearchVectorRepository';
import {
    CommentRepository,
    WorkItemLinkRepository,
    WorkItemRepository,
    WorkItemWatcherRepository,
} from '../repositories/WorkItemRepository';
import {
    assertCanCommentOnWorkItems,
    assertCanEditWorkItems,
    assertCanReadWorkItems,
} from '../policies/work-item.policies';
import { visibleProjects } from '../policies/project-visibility';
import { assertLabelsUsable } from './work-item';
import { assertFieldWrite } from './field-set';
import { recordMentionsInTx } from './mention';
import { emitMentionBells, emitWatcherActivity, keyOf, loadVisibleItem, loadWritableItem } from './work-item-shared';
import type { RequestContext } from '../types';
import { appendAuditEntryOrQueue } from '@/lib/audit';
import { runInTenantContext } from '@/lib/db-context';
import { badRequest, ConflictError, forbidden, notFound } from '@/lib/errors/types';
import { clampLimit, computeKeysetPage, decodeCursor, InvalidCursorError, type KeysetOrder } from '@/lib/pagination';
import { sanitizePlainText, sanitizeUrlText } from '@/lib/security/sanitize';

/**
 * 409 `ANSWER_LOCKED`: the comment is its item's marked answer (2.4b-c,
 * decision 113). A validation of state, not an authority refusal: not audited.
 */
function answerLocked(verb: 'edit' | 'delete'): ConflictError {
    return new ConflictError(`This comment is the work item's answer. Clear the answer first, then ${verb} it.`, { reason: 'ANSWER_LOCKED' });
}

const COMMENT_ORDER: KeysetOrder = { column: 'createdAt', direction: 'desc', kind: 'date' };

/** The link types (ADR 0006 "Link"). PAGE and CANVAS take ids once pages (4.1) and canvases (4.2) exist. */
export const WORK_ITEM_LINK_TYPES = ['URL', 'PULL_REQUEST', 'COMMIT', 'PAGE', 'CANVAS'] as const;
export type WorkItemLinkType = (typeof WORK_ITEM_LINK_TYPES)[number];
const URL_LINK_TYPES: ReadonlySet<WorkItemLinkType> = new Set(['URL', 'PULL_REQUEST', 'COMMIT']);

// ─── Comments ─────────────────────────────────────────────────────────────

export async function listComments(ctx: RequestContext, workItemId: string, query: { limit?: number; cursor?: string } = {}) {
    assertCanReadWorkItems(ctx);
    const limit = clampLimit(query.limit);
    let cursor;
    try {
        cursor = query.cursor ? decodeCursor(query.cursor, COMMENT_ORDER) : undefined;
    } catch (err) {
        if (err instanceof InvalidCursorError) throw badRequest('Invalid cursor.');
        throw err;
    }
    return runInTenantContext(ctx, async (db) => {
        await loadVisibleItem(db, ctx, await visibleProjects(ctx, db), workItemId);
        const rows = await CommentRepository.list(db, ctx, workItemId, { limit, cursor });
        const page = computeKeysetPage(rows, limit, COMMENT_ORDER);
        // Each comment's recorded people (2.7d): the renderer's authority.
        const mentions = await MentionRepository.listForComments(db, ctx, workItemId, page.items.map((c) => c.id));
        const byComment = new Map<string, string[]>();
        for (const m of mentions) {
            if (!m.commentId) continue;
            byComment.set(m.commentId, [...(byComment.get(m.commentId) ?? []), m.mentionedUserId]);
        }
        return { ...page, items: page.items.map((c) => ({ ...c, mentions: byComment.get(c.id) ?? [] })) };
    });
}

function cleanBody(body: string): string {
    const safe = sanitizePlainText(body).trim();
    if (!safe) throw badRequest('A comment needs some text.');
    return safe;
}

export async function addComment(ctx: RequestContext, workItemId: string, input: { body: string }) {
    assertCanCommentOnWorkItems(ctx);
    const body = cleanBody(input.body);
    const { comment, item, mentioned, mentions } = await runInTenantContext(ctx, async (db) => {
        const item = await loadWritableItem(db, ctx, await visibleProjects(ctx, db), workItemId);
        const created = await CommentRepository.create(db, ctx, workItemId, body);
        // Its search vector (2.7f, ADR 0008), in this transaction.
        await SearchVectorRepository.replaceForSource(db, ctx, { workItemId, commentId: created.id }, body);
        await logEvent(db, ctx, {
            action: 'COMMENT_ADDED',
            entityType: 'Comment',
            entityId: created.id,
            details: `Commented on ${keyOf(item)}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Comment', operation: 'created' },
            metadata: { workItemId },
        });
        const m = await recordMentionsInTx(db, ctx, { workItemId, projectId: item.projectId, key: keyOf(item), commentId: created.id }, body);
        return { comment: created, item, mentioned: m.notify, mentions: m.recorded };
    });
    // After the commit: the mention bells, then the watchers (not the people just mentioned).
    await emitMentionBells(ctx, { id: workItemId, title: item.title, key: keyOf(item) }, { commentId: comment.id }, mentioned);
    await emitWatcherActivity(ctx, [{ workItemId, kind: 'commented', discriminator: comment.id, detail: 'new comment', skipUserIds: mentioned }]);
    return { ...comment, mentions };
}

/**
 * A refusal decided here, after the route's key admitted the caller, writes
 * the same hash-chained `AUTHZ_DENIED` entry a `requirePermission` denial
 * writes (in a transaction of its own, so the request's rollback keeps it),
 * then answers 403.
 */
async function refuseComment(ctx: RequestContext, commentId: string, verb: 'edit' | 'delete', message: string): Promise<never> {
    await appendAuditEntryOrQueue({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        actorType: ctx.apiKeyId ? 'API_KEY' : 'USER',
        entity: 'Comment',
        entityId: commentId,
        action: 'AUTHZ_DENIED',
        details: `Comment ${verb} refused`,
        detailsJson: {
            category: 'access',
            event: 'authz_denied',
            reason: verb === 'edit' ? 'COMMENT_EDIT_AUTHOR_ONLY' : 'COMMENT_DELETE_AUTHOR_OR_ADMIN',
            role: ctx.role,
        },
        requestId: ctx.requestId,
        metadataJson: { role: ctx.role, verb },
    });
    throw forbidden(message);
}

export async function editComment(ctx: RequestContext, workItemId: string, commentId: string, input: { body: string }) {
    assertCanCommentOnWorkItems(ctx);
    const body = cleanBody(input.body);
    const outcome = await runInTenantContext(ctx, async (db) => {
        const item = await loadWritableItem(db, ctx, await visibleProjects(ctx, db), workItemId);
        const comment = await CommentRepository.get(db, ctx, workItemId, commentId);
        if (!comment) throw notFound('Comment not found');
        if (!mayEditComment(ctx, comment)) {
            await refuseComment(ctx, commentId, 'edit', 'Only the comment\'s author can edit it.');
        }
        if (isMarkedAnswer(comment, item)) throw answerLocked('edit');
        await CommentRepository.edit(db, ctx, commentId, body);
        await SearchVectorRepository.replaceForSource(db, ctx, { workItemId, commentId }, body);
        await logEvent(db, ctx, {
            action: 'COMMENT_EDITED',
            entityType: 'Comment',
            entityId: commentId,
            details: 'Edited a comment',
            detailsJson: { category: 'entity_lifecycle', entityName: 'Comment', operation: 'updated', changedFields: ['body'] },
            metadata: { workItemId },
        });
        // Only people the edit adds are recorded and notified (2.7d).
        const source = { workItemId, projectId: item.projectId, key: keyOf(item), commentId };
        const m = await recordMentionsInTx(db, ctx, source, body);
        return { item, mentioned: m.notify, mentions: m.recorded };
    });
    await emitMentionBells(ctx, { id: workItemId, title: outcome.item.title, key: keyOf(outcome.item) }, { commentId }, outcome.mentioned);
    return { id: commentId, edited: true, mentions: outcome.mentions };
}

export async function deleteComment(ctx: RequestContext, workItemId: string, commentId: string) {
    assertCanCommentOnWorkItems(ctx);
    return runInTenantContext(ctx, async (db) => {
        const item = await loadWritableItem(db, ctx, await visibleProjects(ctx, db), workItemId);
        const comment = await CommentRepository.get(db, ctx, workItemId, commentId);
        if (!comment) throw notFound('Comment not found');
        const basis = commentDeleteBasis(ctx, comment);
        if (!basis) {
            await refuseComment(ctx, commentId, 'delete', 'Only the comment\'s author or a workspace admin can delete it.');
        }
        if (isMarkedAnswer(comment, item)) throw answerLocked('delete');
        await CommentRepository.softDelete(db, ctx, commentId);
        // A deleted comment is never found (2.7f): its vector goes in this transaction.
        await SearchVectorRepository.removeForSource(db, ctx, { workItemId, commentId });
        // A deleted comment mentions nobody (2.7d); its text stays until the purge.
        await MentionRepository.removeForComment(db, ctx, workItemId, commentId);
        // An admin removing someone else's comment is moderation, and the
        // trail says so: its own action, and the author it acted on.
        const moderation = basis === 'moderation';
        await logEvent(db, ctx, {
            action: moderation ? 'COMMENT_MODERATED' : 'COMMENT_DELETED',
            entityType: 'Comment',
            entityId: commentId,
            details: moderation ? 'Deleted another member\'s comment (moderation)' : 'Deleted a comment',
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'Comment',
                operation: 'deleted',
                summary: moderation ? 'moderation' : 'author',
            },
            metadata: { workItemId, basis, authorUserId: comment.authorUserId },
        });
        return { deleted: true, basis };
    });
}

// ─── Watchers ─────────────────────────────────────────────────────────────

export async function listWatchers(ctx: RequestContext, workItemId: string) {
    assertCanReadWorkItems(ctx);
    return runInTenantContext(ctx, async (db) => {
        await loadVisibleItem(db, ctx, await visibleProjects(ctx, db), workItemId);
        return WorkItemWatcherRepository.list(db, ctx, workItemId);
    });
}

async function changeWatcher(ctx: RequestContext, workItemId: string, userId: string, add: boolean) {
    const self = userId === ctx.userId;
    return runInTenantContext(ctx, async (db) => {
        const item = await loadVisibleItem(db, ctx, await visibleProjects(ctx, db), workItemId);
        if (add) {
            const active = await MembershipRepository.listActiveUserIds(db, ctx, [userId]);
            if (!active.has(userId)) throw badRequest('A watcher must be an active member of this workspace.');
            await WorkItemWatcherRepository.add(db, ctx, workItemId, userId);
        } else {
            await WorkItemWatcherRepository.remove(db, ctx, workItemId, userId);
        }
        await logEvent(db, ctx, {
            action: add ? 'WORK_ITEM_WATCHER_ADDED' : 'WORK_ITEM_WATCHER_REMOVED',
            entityType: 'WorkItem',
            entityId: workItemId,
            details: `${add ? 'Watching' : 'Stopped watching'} ${keyOf(item)}`,
            detailsJson: {
                category: 'relationship',
                operation: add ? 'linked' : 'unlinked',
                sourceEntity: 'WorkItem',
                sourceId: workItemId,
                targetEntity: 'TenantMembership',
                targetId: userId,
                relation: 'watcher',
            },
            metadata: { watcherUserId: userId, self },
        });
        return { watching: add, userId };
    });
}

/** The caller watches the item (`work_items.view`). */
export async function watchWorkItem(ctx: RequestContext, workItemId: string) {
    assertCanReadWorkItems(ctx);
    return changeWatcher(ctx, workItemId, ctx.userId, true);
}

/** The caller stops watching the item (`work_items.view`). */
export async function unwatchWorkItem(ctx: RequestContext, workItemId: string) {
    assertCanReadWorkItems(ctx);
    return changeWatcher(ctx, workItemId, ctx.userId, false);
}

/** Add another member as a watcher (`work_items.edit`). */
export async function addWatcher(ctx: RequestContext, workItemId: string, userId: string) {
    assertCanEditWorkItems(ctx);
    if (userId === ctx.userId) return watchWorkItem(ctx, workItemId);
    return changeWatcher(ctx, workItemId, userId, true);
}

/** Remove another member as a watcher (`work_items.edit`). */
export async function removeWatcher(ctx: RequestContext, workItemId: string, userId: string) {
    assertCanEditWorkItems(ctx);
    if (userId === ctx.userId) return unwatchWorkItem(ctx, workItemId);
    return changeWatcher(ctx, workItemId, userId, false);
}

// ─── Links ────────────────────────────────────────────────────────────────

export async function listWorkItemLinks(ctx: RequestContext, workItemId: string) {
    assertCanReadWorkItems(ctx);
    return runInTenantContext(ctx, async (db) => {
        await loadVisibleItem(db, ctx, await visibleProjects(ctx, db), workItemId);
        return WorkItemLinkRepository.listByWorkItem(db, ctx, workItemId);
    });
}

export async function addWorkItemLink(
    ctx: RequestContext,
    workItemId: string,
    input: { type: WorkItemLinkType; location: string; title?: string | null },
) {
    assertCanEditWorkItems(ctx);
    if (!URL_LINK_TYPES.has(input.type)) {
        throw badRequest('Links to pages and canvases arrive with pages (4.1) and canvases (4.2).');
    }
    // A URL is percent-encoded rather than run through `sanitizePlainText`,
    // which would decode `&region=` into `®ion=` (see `sanitizeUrlText`).
    const location = sanitizeUrlText(input.location);
    if (!/^https?:\/\//i.test(location)) throw badRequest('A link is an http or https URL.');
    const title = input.title ? sanitizePlainText(input.title).trim() || null : null;
    return runInTenantContext(ctx, async (db) => {
        const item = await loadWritableItem(db, ctx, await visibleProjects(ctx, db), workItemId);
        const link = await WorkItemLinkRepository.link(db, ctx, workItemId, { type: input.type, location, title });
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_LINKED',
            entityType: 'WorkItem',
            entityId: workItemId,
            details: `Linked ${keyOf(item)} to a ${input.type}`,
            detailsJson: {
                category: 'relationship',
                operation: 'linked',
                sourceEntity: 'WorkItem',
                sourceId: workItemId,
                targetEntity: 'WorkItemLink',
                targetId: link.id,
                relation: input.type,
            },
        });
        return link;
    });
}

export async function removeWorkItemLink(ctx: RequestContext, workItemId: string, linkId: string) {
    assertCanEditWorkItems(ctx);
    return runInTenantContext(ctx, async (db) => {
        const item = await loadWritableItem(db, ctx, await visibleProjects(ctx, db), workItemId);
        const removed = await WorkItemLinkRepository.unlink(db, ctx, workItemId, linkId);
        if (!removed) throw notFound('Link not found');
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_UNLINKED',
            entityType: 'WorkItem',
            entityId: workItemId,
            details: `Removed a link from ${keyOf(item)}`,
            detailsJson: {
                category: 'relationship',
                operation: 'unlinked',
                sourceEntity: 'WorkItem',
                sourceId: workItemId,
                targetEntity: 'WorkItemLink',
                targetId: linkId,
                relation: removed.type,
            },
        });
        return { deleted: true };
    });
}

// ─── Labels on an item ────────────────────────────────────────────────────

export async function addWorkItemLabels(ctx: RequestContext, workItemId: string, labelIds: readonly string[]) {
    assertCanEditWorkItems(ctx);
    const ids = [...new Set(labelIds)];
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const item = await loadWritableItem(db, ctx, v, workItemId);
        await assertLabelsUsable(db, ctx, ids, item.teamId);
        // The type's field set (2.4b-b): hidden labels take none.
        await assertFieldWrite(db, ctx, item, { labelIds: ids });
        const result = await LabelRepository.attach(db, ctx, workItemId, ids);
        if (result.count > 0) {
            await WorkItemRepository.bumpVersion(db, ctx, v, [workItemId]);
            await logEvent(db, ctx, {
                action: 'WORK_ITEM_LABELS_CHANGED',
                entityType: 'WorkItem',
                entityId: workItemId,
                details: `Labelled ${keyOf(item)}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItem', operation: 'updated', changedFields: ['labels'] },
                metadata: { added: ids },
            });
        }
        return LabelRepository.listForItem(db, ctx, workItemId);
    });
}

export async function removeWorkItemLabel(ctx: RequestContext, workItemId: string, labelId: string) {
    assertCanEditWorkItems(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const item = await loadWritableItem(db, ctx, v, workItemId);
        const result = await LabelRepository.detach(db, ctx, workItemId, [labelId]);
        if (result.count === 0) throw notFound('Label not on this work item');
        // Required labels (2.4b-b): the last one of an open item stays (the throw undoes the detach).
        const left = await LabelRepository.listForItem(db, ctx, workItemId);
        if (left.length === 0) await assertFieldWrite(db, ctx, item, { labelIds: [] });
        await WorkItemRepository.bumpVersion(db, ctx, v, [workItemId]);
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_LABELS_CHANGED',
            entityType: 'WorkItem',
            entityId: workItemId,
            details: `Removed a label from ${keyOf(item)}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItem', operation: 'updated', changedFields: ['labels'] },
            metadata: { removed: [labelId] },
        });
        return LabelRepository.listForItem(db, ctx, workItemId);
    });
}
