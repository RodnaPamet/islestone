/**
 * In-app bell notifications for a work item's WATCHERS (ADR 0006:
 * `WorkItemWatcher`).
 *
 * Channel decision — BELL, not per-event email. A watched item can take many
 * comments and state changes in a day; an email per event to every watcher
 * is the notification fatigue that makes people stop watching (GitHub and
 * Linear route watched-item activity to the in-app feed, not the inbox).
 * Email stays reserved for direct assignment — a stronger, lower-frequency
 * signal. The bell is SSE-pushed so a watcher sees the update immediately.
 *
 * Mirrors `assignment.ts`:
 *   - `db.notification.createMany({ skipDuplicates: true })` so a repeated
 *     dedupeKey collapses with NO exception (raw create throws P2002 and
 *     poisons interactive PG transactions).
 *   - the workspace's in-app mute list is asked before any write.
 *   - Fire-and-forget — the caller isolates this in its own transaction
 *     AFTER the item write commits, so a notification failure never rolls
 *     back the item.
 *
 * Callers: the work-item usecases (comments, state changes, assignment and
 * material edits), sub-phase 2.2.
 *
 * Copied from inflect-compliance `src/app-layer/notifications/watcher.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e: task fields renamed to work-item
 * fields, `TASK_WATCH_UPDATE` → `WORK_ITEM_WATCH_UPDATE`, `status_changed` →
 * `state_changed` (ADR 0006 keeps "status" for fixed enums; sub-phase 2.2), the link supplied
 * by the caller until 2.3 owns the route, the mute check added, and the bell
 * text is `body`.
 */

import type { PrismaClient } from '@prisma/client';
import { publishNotificationEvent } from '@/lib/notifications/notification-bus';
import { insertedNotificationIds } from './inserted-ids';
import { isInAppTypeEnabled } from './settings';

/**
 * `updated` covers MATERIAL field edits (due-date change, start-date change,
 * re-parent, move) — the changes a watcher needs to know about that aren't a
 * comment, state move, or assignment. Cosmetic edits (title/description
 * wording) deliberately do NOT notify: a bell for every keystroke-level save
 * trains people to ignore the bell.
 */
export type WatcherActivityKind = 'commented' | 'state_changed' | 'assigned' | 'updated';

export interface WatcherActivity {
    tenantId: string;
    workItemId: string;
    workItemKey: string | null;
    workItemTitle: string;
    /**
     * The bell's link, `/t/<slug>/…`. Sub-phase 2.3 owns the work-item route
     * and its `workItemPath(slug, id)` helper; until then the caller passes it.
     */
    linkUrl: string;
    kind: WatcherActivityKind;
    /**
     * Distinguishes genuinely different events while deduping retries of
     * the SAME event — e.g. the comment id, `${from}->${to}` for a state
     * change, or the new assignee id. Without it, two comments in a day
     * would collapse to one bell entry (too coarse for activity).
     */
    discriminator: string;
    /** Short human phrase for the body, e.g. "state Todo → In progress" (state names). */
    detail: string;
}

/** The bell type this emitter writes; `in-app-types.ts` lists it. */
export const WATCHER_NOTIFICATION_TYPE = 'WORK_ITEM_WATCH_UPDATE' as const;

/** The title it writes. */
export const WATCHER_NOTIFICATION_TITLE = 'Watched work item updated';

/**
 * Idempotency key — finer than the assignment key (which is per-day):
 * watcher activity keys on the event discriminator so distinct events
 * don't collapse, but a retry of the same event still dedupes.
 */
export function buildWatcherDedupeKey(a: WatcherActivity, watcherUserId: string): string {
    return `${a.tenantId}:WORK_ITEM_WATCH:${a.workItemId}:${watcherUserId}:${a.kind}:${a.discriminator}`;
}

export async function createWatcherNotifications(
    db: Pick<PrismaClient, 'notification' | 'tenantNotificationSettings'>,
    watcherUserIds: string[],
    a: WatcherActivity,
    // Kept for the source's call shape; the watcher key carries no date.
    _now: Date = new Date(),
): Promise<{ created: number }> {
    if (watcherUserIds.length === 0) return { created: 0 };
    // Above the write, not filtered after it: a muted row would still reach
    // the bell list, the badge and the SSE stream.
    if (!(await isInAppTypeEnabled(db, a.tenantId, WATCHER_NOTIFICATION_TYPE))) {
        return { created: 0 };
    }

    const label = a.workItemKey ? `${a.workItemKey} "${a.workItemTitle}"` : `"${a.workItemTitle}"`;
    const title = WATCHER_NOTIFICATION_TITLE;
    const linkUrl = a.linkUrl;

    const rows = watcherUserIds.map((userId) => ({
        tenantId: a.tenantId,
        userId,
        type: WATCHER_NOTIFICATION_TYPE,
        title,
        body: `${label}: ${a.detail}`,
        linkUrl,
        dedupeKey: buildWatcherDedupeKey(a, userId),
    }));

    const result = await db.notification.createMany({ data: rows, skipDuplicates: true });

    // Push to the SSE bus so subscribed bell clients see it without waiting
    // for the next poll. The client keys on `id`, so a re-push of an
    // already-seen row is a no-op in the UI. The id is the ROW's (inflect #5305),
    // read back by the unique dedupe key: the dedupe key itself, which the
    // event used to carry, named no notification to mark read.
    if (result.count > 0) {
        const inserted = await insertedNotificationIds(db, a.tenantId, rows.map((r) => r.dedupeKey));
        for (const row of rows) {
            const written = inserted.get(row.dedupeKey);
            if (!written) continue;
            publishNotificationEvent(a.tenantId, row.userId, {
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
