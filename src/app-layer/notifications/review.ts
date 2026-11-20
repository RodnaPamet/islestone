/**
 * The review bells (sub-phase 2.8a; ADR 0009; owner decision 161):
 *
 *   - `WORK_ITEM_REVIEW_REQUESTED` — to each reviewer when their step opens,
 *     or when they are added to an open one; and, worded "no reviewers left",
 *     to the item's assignee and whoever sent the round when a step is left
 *     with nobody to respond (zero is never complete, ADR 0009 §5);
 *   - `WORK_ITEM_REVIEW_DUE` — the 08:00 due job's reminder to the pending
 *     reviewers of an open step due today, on the next working day, or
 *     overdue (once);
 *   - `WORK_ITEM_REVIEW_RETURNED` — to the assignee and whoever sent the
 *     round, when a reviewer returns the item;
 *   - `WORK_ITEM_REVIEW_COMPLETED` — to the same people when a round
 *     completes.
 *
 * Each row says who, which item, which step and the outcome; never the
 * response text (decision 157 and decision 130's rule: the text is
 * encrypted, `Notification.body` is not). Like every bell writer it asks
 * `isInAppTypeEnabled` for its recipients BEFORE it writes, inserts with
 * `createMany({ skipDuplicates: true })` and publishes each inserted row's
 * real id.
 *
 * Written fresh for Islestone, in the shape of `mention.ts`.
 */
import type { PrismaClient } from '@prisma/client';
import { publishNotificationEvent } from '@/lib/notifications/notification-bus';
import { insertedNotificationIds } from './inserted-ids';
import { isInAppTypeEnabled } from './settings';

export type ReviewNotificationType =
    | 'WORK_ITEM_REVIEW_REQUESTED'
    | 'WORK_ITEM_REVIEW_DUE'
    | 'WORK_ITEM_REVIEW_RETURNED'
    | 'WORK_ITEM_REVIEW_COMPLETED';

/** The titles each type writes; `in-app-types.ts` lists the types from these keys. */
export const REVIEW_NOTIFICATION_COPY: Record<ReviewNotificationType, { title: string }> = {
    WORK_ITEM_REVIEW_REQUESTED: { title: 'Review requested' },
    WORK_ITEM_REVIEW_DUE: { title: 'Review due' },
    WORK_ITEM_REVIEW_RETURNED: { title: 'Work item returned' },
    WORK_ITEM_REVIEW_COMPLETED: { title: 'Review completed' },
};

/** What a review bell is about. */
export type ReviewNotice =
    | { kind: 'requested'; stepId: string; stepName: string; requestedByName?: string | null }
    | { kind: 'stalled'; stepId: string; stepName: string }
    | { kind: 'due'; stepId: string; stepName: string; window: ReviewDueWindow }
    | { kind: 'returned'; stepId: string; stepName: string; roundNumber: number; byName?: string | null }
    | { kind: 'completed'; roundId: string; roundNumber: number };

export type ReviewDueWindow = 'today' | 'next' | 'overdue';

export interface ReviewNotificationTarget {
    tenantId: string;
    workItemId: string;
    workItemKey: string | null;
    workItemTitle: string;
    /** The bell's link, `/t/<slug>/…` (`tenantWorkItemPath`). */
    linkUrl: string;
}

function typeOf(notice: ReviewNotice): ReviewNotificationType {
    switch (notice.kind) {
        case 'requested':
        case 'stalled':
            return 'WORK_ITEM_REVIEW_REQUESTED';
        case 'due':
            return 'WORK_ITEM_REVIEW_DUE';
        case 'returned':
            return 'WORK_ITEM_REVIEW_RETURNED';
        case 'completed':
            return 'WORK_ITEM_REVIEW_COMPLETED';
    }
}

/** The bell's title and body: who, which item, which step; never the response text. */
export function reviewNotificationText(t: Pick<ReviewNotificationTarget, 'workItemKey' | 'workItemTitle'>, notice: ReviewNotice): { title: string; body: string } {
    const label = t.workItemKey ? `${t.workItemKey} "${t.workItemTitle}"` : `"${t.workItemTitle}"`;
    switch (notice.kind) {
        case 'requested': {
            const who = notice.requestedByName?.trim();
            return {
                title: REVIEW_NOTIFICATION_COPY.WORK_ITEM_REVIEW_REQUESTED.title,
                body: `${who ? `${who} asks you` : 'You are asked'} to review ${label} (step "${notice.stepName}").`,
            };
        }
        case 'stalled':
            return {
                title: 'Review step has no reviewers left',
                body: `The review step "${notice.stepName}" of ${label} has nobody left to respond: skip it, add a reviewer or withdraw the round.`,
            };
        case 'due': {
            const when = notice.window === 'today' ? 'is due today' : notice.window === 'next' ? 'is due on the next working day' : 'is overdue';
            return { title: REVIEW_NOTIFICATION_COPY.WORK_ITEM_REVIEW_DUE.title, body: `Your review of ${label} (step "${notice.stepName}") ${when}.` };
        }
        case 'returned': {
            const who = notice.byName?.trim() || 'A reviewer';
            return { title: REVIEW_NOTIFICATION_COPY.WORK_ITEM_REVIEW_RETURNED.title, body: `${who} returned ${label} at the review step "${notice.stepName}".` };
        }
        case 'completed':
            return { title: REVIEW_NOTIFICATION_COPY.WORK_ITEM_REVIEW_COMPLETED.title, body: `Round ${notice.roundNumber} of the review of ${label} is complete: every step signed off.` };
    }
}

/**
 * The dedupe key: per type, source and person. A step's request, stall,
 * return and due windows each ring once (a step's due day is fixed when it
 * opens, so a window happens on one day only); a round's completion once.
 */
export function buildReviewDedupeKey(tenantId: string, notice: ReviewNotice, userId: string): string {
    const type = typeOf(notice);
    switch (notice.kind) {
        case 'requested':
            return `${tenantId}:${type}:${notice.stepId}:${userId}`;
        case 'stalled':
            return `${tenantId}:${type}:stalled:${notice.stepId}:${userId}`;
        case 'due':
            return `${tenantId}:${type}:${notice.window}:${notice.stepId}:${userId}`;
        case 'returned':
            return `${tenantId}:${type}:${notice.stepId}:${userId}`;
        case 'completed':
            return `${tenantId}:${type}:${notice.roundId}:${userId}`;
    }
}

type ReviewDb = Pick<PrismaClient, 'notification' | 'tenantNotificationSettings' | 'notificationPreference'>;

/** One bell per person for one notice (the people the preference admits). */
export async function createReviewNotifications(
    db: ReviewDb,
    userIds: readonly string[],
    t: ReviewNotificationTarget,
    notice: ReviewNotice,
): Promise<{ created: number; written: string[] }> {
    return createReviewNotificationBatch(db, t.tenantId, typeOf(notice), [...new Set(userIds)].map((userId) => ({ userId, target: t, notice })));
}

/**
 * A batch of one type for one workspace: the preference read once, one
 * `createMany({ skipDuplicates })`, one id read-back, then a push per row.
 * Returns the people a row was written for.
 */
export async function createReviewNotificationBatch(
    db: ReviewDb,
    tenantId: string,
    type: ReviewNotificationType,
    entries: ReadonlyArray<{ userId: string; target: ReviewNotificationTarget; notice: ReviewNotice }>,
): Promise<{ created: number; written: string[] }> {
    if (entries.length === 0) return { created: 0, written: [] };
    // Above the write, not filtered after it: a muted row would still reach
    // the bell list, the badge and the SSE stream.
    const enabled = await isInAppTypeEnabled(db, tenantId, type, entries.map((e) => e.userId));
    const rows = entries
        .filter((e) => e.target.tenantId === tenantId && typeOf(e.notice) === type && enabled.has(e.userId))
        .map((e) => {
            const text = reviewNotificationText(e.target, e.notice);
            return {
                tenantId,
                userId: e.userId,
                type,
                title: text.title,
                body: text.body,
                linkUrl: e.target.linkUrl,
                workItemId: e.target.workItemId,
                dedupeKey: buildReviewDedupeKey(tenantId, e.notice, e.userId),
            };
        });
    if (rows.length === 0) return { created: 0, written: [] };
    const result = await db.notification.createMany({ data: rows, skipDuplicates: true });
    const written: string[] = [];
    if (result.count > 0) {
        const inserted = await insertedNotificationIds(db, tenantId, rows.map((r) => r.dedupeKey));
        for (const row of rows) {
            const got = inserted.get(row.dedupeKey);
            if (!got) continue;
            written.push(row.userId);
            publishNotificationEvent(tenantId, row.userId, {
                id: got.id,
                type: row.type,
                title: row.title,
                body: row.body,
                read: false,
                linkUrl: row.linkUrl,
                createdAt: got.createdAt.toISOString(),
            });
        }
    }
    return { created: result.count, written };
}
