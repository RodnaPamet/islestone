/**
 * Recording mentions (sub-phase 2.7d; docs/porting/maps/2.7.md, part 5; owner
 * decisions 127 to 130).
 *
 * `recordMentionsInTx` runs inside the write that stores a person's text: a
 * comment added or edited (`work-item-collab.ts`), a description edited
 * (`updateWorkItem`) or written by a person's own create (`createWorkItem`,
 * when the request names the description). Never from intake accept, a
 * template's projection or a repeat copy (decision 129): those call the
 * create core without asking for mentions, so their text records nobody and
 * its tokens render as text.
 *
 * In the write's transaction, on the sanitised text:
 *   1. parse the tokens (`parseMentionIds`, the pure grammar);
 *   2. keep the people not recorded for this source before who are ACTIVE
 *      members, hold `work_items.view` and can see the item's project (their
 *      role's visibility; a GUEST sees none until 8.4); drop the others
 *      silently: their token stays text;
 *   3. record them, and remove the rows whose token left the text;
 *   4. add each newly mentioned person (never the author) as a watcher
 *      (decision 128), audited as `WORK_ITEM_WATCHER_ADDED` with
 *      `reason: 'mentioned'`;
 *   5. audit `WORK_ITEM_MENTIONED` (and `WORK_ITEM_MENTIONS_REMOVED`) with
 *      the people's ids, never the text.
 *
 * It returns the people to notify (`notify`: the newly recorded, never the
 * author) and everybody the source now mentions (`recorded`, for the
 * response's chips). The caller rings `notify` after its commit
 * (`emitMentionBells` in `work-item-shared.ts`), so an edit notifies only
 * people it added.
 *
 * Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import { parseMentionIds, planMentionChange } from '../domain/mention';
import { resolveProjectVisibility } from '../policies/project-visibility';
import { MembershipRepository } from '../repositories/MembershipRepository';
import { MentionRepository } from '../repositories/MentionRepository';
import { WorkItemWatcherRepository } from '../repositories/WorkItemRepository';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { permissionsForMembership } from '@/lib/permissions';
import { isTenantSystemUserId } from '@/lib/tenant-system-user';

export interface MentionSource {
    workItemId: string;
    projectId: string;
    /** The item's key, for the audit sentence. */
    key: string;
    /** The comment, or `null` for the item's description. */
    commentId: string | null;
}

/**
 * Is the caller a person writing their own text (decision 129)? An API key
 * (5.2) or an agent acts for a person but does not speak as them, and the
 * workspace's system user is nobody.
 */
export function writesAsPerson(ctx: RequestContext): boolean {
    return !ctx.apiKeyId && !isTenantSystemUserId(ctx.userId);
}

/**
 * Of `userIds`, the people who may be mentioned on an item of `projectId`:
 * ACTIVE members whose permissions read work items and whose role sees the
 * project. One read for the batch.
 */
export async function mentionableAmong(db: PrismaTx, ctx: RequestContext, projectId: string, userIds: readonly string[]): Promise<Set<string>> {
    const memberships = await MembershipRepository.activeMembershipsWithRoles(db, ctx, userIds);
    const out = new Set<string>();
    for (const m of memberships) {
        if (!permissionsForMembership(m).work_items.view) continue;
        const v = resolveProjectVisibility({ role: m.customRole?.baseRole ?? m.role, membershipRole: m.role });
        if (v.kind === 'ALL' || v.projectIds.includes(projectId)) out.add(m.userId);
    }
    return out;
}

function people(n: number): string {
    return n === 1 ? 'a person' : `${n} people`;
}

export interface RecordedMentions {
    /** The people to notify after the commit: newly recorded, never the author. */
    notify: string[];
    /** Everybody the source mentions after the write. */
    recorded: string[];
}

/**
 * Record the mentions of one source's new text, in the caller's transaction.
 * A caller that is not a person records nothing and keeps what was recorded.
 */
export async function recordMentionsInTx(db: PrismaTx, ctx: RequestContext, source: MentionSource, text: string | null): Promise<RecordedMentions> {
    const ref = { workItemId: source.workItemId, commentId: source.commentId };
    if (!writesAsPerson(ctx)) return { notify: [], recorded: [...(await MentionRepository.listForSource(db, ctx, ref))] };
    const named = parseMentionIds(text);
    const recorded = await MentionRepository.listForSource(db, ctx, ref);
    if (named.length === 0 && recorded.size === 0) return { notify: [], recorded: [] };
    const candidates = named.filter((id) => !recorded.has(id));
    const allowed = candidates.length > 0 ? await mentionableAmong(db, ctx, source.projectId, candidates) : new Set<string>();
    const change = planMentionChange(recorded, named, allowed);
    const where = source.commentId ? 'a comment' : 'the description';

    if (change.remove.length > 0) {
        await MentionRepository.remove(db, ctx, ref, change.remove);
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_MENTIONS_REMOVED',
            entityType: 'WorkItem',
            entityId: source.workItemId,
            details: `Removed the mention of ${people(change.remove.length)} from ${where} on ${source.key}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Mention', operation: 'deleted', summary: source.commentId ? 'comment' : 'description' },
            metadata: { commentId: source.commentId, mentionedUserIds: change.remove },
        });
    }
    const after = [...[...recorded].filter((id) => !change.remove.includes(id)), ...change.add];
    if (change.add.length === 0) return { notify: [], recorded: after };

    await MentionRepository.add(db, ctx, ref, change.add);
    await logEvent(db, ctx, {
        action: 'WORK_ITEM_MENTIONED',
        entityType: 'WorkItem',
        entityId: source.workItemId,
        details: `Mentioned ${people(change.add.length)} in ${where} on ${source.key}`,
        detailsJson: { category: 'entity_lifecycle', entityName: 'Mention', operation: 'created', summary: source.commentId ? 'comment' : 'description' },
        metadata: { commentId: source.commentId, mentionedUserIds: change.add },
    });

    // A mention adds the person as a watcher (decision 128), so they hear the
    // replies; the author is never notified of their own mention.
    const notify = change.add.filter((id) => id !== ctx.userId);
    const watching = await WorkItemWatcherRepository.addMany(db, ctx, source.workItemId, notify);
    for (const userId of watching) {
        // One entry per new watcher (at most MAX_MENTIONS_PER_TEXT), as `changeWatcher` writes.
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_WATCHER_ADDED',
            entityType: 'WorkItem',
            entityId: source.workItemId,
            details: `Watching ${source.key} (mentioned)`,
            detailsJson: {
                category: 'relationship',
                operation: 'linked',
                sourceEntity: 'WorkItem',
                sourceId: source.workItemId,
                targetEntity: 'TenantMembership',
                targetId: userId,
                relation: 'watcher',
            },
            metadata: { watcherUserId: userId, self: false, reason: 'mentioned' },
        });
    }
    return { notify, recorded: after };
}
