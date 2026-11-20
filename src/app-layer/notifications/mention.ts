/**
 * The mention bell (sub-phase 2.7d; owner decisions 128 and 130): someone
 * mentioned the recipient in a comment or in a work item's description.
 *
 * The row says WHO mentioned them, on WHICH item, and links to it; it never
 * carries the comment's or the description's text (decision 130): both are
 * encrypted, and `Notification.body` is plaintext, read by the bell, the
 * Inbox and the daily digest's email.
 *
 * Like every bell writer it asks `isInAppTypeEnabled` for its recipients
 * BEFORE it writes (the member's preference under the workspace's ceiling),
 * inserts with `createMany({ skipDuplicates: true })` and publishes each
 * inserted row's real id. The dedupe key is per source, person and day: a
 * retry, or the same person mentioned again in the same text that day, rings
 * once.
 *
 * Written fresh for Islestone, in the shape of `watcher.ts`.
 */
import type { PrismaClient } from '@prisma/client';
import { publishNotificationEvent } from '@/lib/notifications/notification-bus';
import { insertedNotificationIds } from './inserted-ids';
import { isInAppTypeEnabled } from './settings';

/** The bell type this writer emits; `in-app-types.ts` lists it. */
export const MENTION_NOTIFICATION_TYPE = 'WORK_ITEM_MENTIONED' as const;

/** The title it writes. */
export const MENTION_NOTIFICATION_TITLE = 'You were mentioned';

export interface MentionNotificationTarget {
    tenantId: string;
    workItemId: string;
    workItemKey: string | null;
    workItemTitle: string;
    /** The bell's link, `/t/<slug>/…` (`tenantWorkItemPath`). */
    linkUrl: string;
    /** The comment, or `null` for the description. */
    commentId: string | null;
    /** Who mentioned them; absent when the name is not known. */
    mentionedByName?: string | null;
}

/** "Ada mentioned you in a comment on ISL-12 "Title"." Never the text. */
export function mentionBody(t: Pick<MentionNotificationTarget, 'workItemKey' | 'workItemTitle' | 'commentId' | 'mentionedByName'>): string {
    const label = t.workItemKey ? `${t.workItemKey} "${t.workItemTitle}"` : `"${t.workItemTitle}"`;
    const who = t.mentionedByName?.trim() || 'Someone';
    return t.commentId ? `${who} mentioned you in a comment on ${label}.` : `${who} mentioned you in the description of ${label}.`;
}

export function buildMentionDedupeKey(t: Pick<MentionNotificationTarget, 'tenantId' | 'workItemId' | 'commentId'>, userId: string, now: Date = new Date()): string {
    const ymd = now.toISOString().slice(0, 10);
    return `${t.tenantId}:${MENTION_NOTIFICATION_TYPE}:${t.workItemId}:${t.commentId ?? 'description'}:${userId}:${ymd}`;
}

export async function createMentionNotifications(
    db: Pick<PrismaClient, 'notification' | 'tenantNotificationSettings' | 'notificationPreference'>,
    userIds: readonly string[],
    t: MentionNotificationTarget,
    now: Date = new Date(),
): Promise<{ created: number }> {
    if (userIds.length === 0) return { created: 0 };
    // Above the write, not filtered after it: a muted row would still reach
    // the bell list, the badge and the SSE stream.
    const enabled = await isInAppTypeEnabled(db, t.tenantId, MENTION_NOTIFICATION_TYPE, userIds);
    const recipients = [...new Set(userIds)].filter((id) => enabled.has(id));
    if (recipients.length === 0) return { created: 0 };

    const body = mentionBody(t);
    const rows = recipients.map((userId) => ({
        tenantId: t.tenantId,
        userId,
        type: MENTION_NOTIFICATION_TYPE,
        title: MENTION_NOTIFICATION_TITLE,
        body,
        linkUrl: t.linkUrl,
        workItemId: t.workItemId,
        dedupeKey: buildMentionDedupeKey(t, userId, now),
    }));

    const result = await db.notification.createMany({ data: rows, skipDuplicates: true });
    if (result.count > 0) {
        const inserted = await insertedNotificationIds(db, t.tenantId, rows.map((r) => r.dedupeKey));
        for (const row of rows) {
            const written = inserted.get(row.dedupeKey);
            if (!written) continue;
            publishNotificationEvent(t.tenantId, row.userId, {
                id: written.id,
                type: row.type,
                title: row.title,
                body: row.body,
                read: false,
                linkUrl: row.linkUrl,
                createdAt: written.createdAt.toISOString(),
            });
        }
    }
    return { created: result.count };
}
