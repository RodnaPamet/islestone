/**
 * In-app due-date reminders for work items (`WORK_ITEM_DUE`), the shared
 * helper behind both callers: the work-item usecases (after a create, an
 * update or an assignment commits) and the daily `work-item-due-notification`
 * job. Owner decision, 2026-11-18 ("In 2.2"): due reminders land with the
 * work-item engine. The email due digest is 2.7's.
 *
 * Kept in `notifications/`, never `jobs/`: the usecases import it, and a
 * usecase importing `jobs/` would drag the job graph into the request path.
 *
 * Reminder windows:
 *   An item is reminded when the count of calendar days from "today" to its
 *   due date is exactly 7, 1 or 0. Days 2–6 produce nothing.
 *
 * Date-only due dates (docs/porting/maps/2.1-2.2.md, risk 6):
 *   `WorkItem.dueDate` is a `@db.Date`. Prisma reads it back as UTC midnight
 *   of that date, and formatting UTC midnight in a zone west of UTC gives the
 *   PREVIOUS day, which would shift every window by one. So the due day is
 *   read from the value's UTC date parts and never converted; only "now" is
 *   converted to the reminder zone `tz` (`NOTIFICATIONS_TZ`).
 *
 * Deduplication contract:
 *   `Notification.dedupeKey` is unique, shaped
 *   `{tenantId}:WORK_ITEM_DUE:{window}:{workItemId}:{userId}:{YYYY-MM-DD}`,
 *   the date being the run day in `tz`. The insert is a `createMany` with
 *   `skipDuplicates`, so a repeat (the job and an event overlapping) is
 *   absorbed with no exception, and an item yields at most three reminders
 *   over its life (7d, 1d, 0d).
 *
 * Copied from inflect-compliance `src/app-layer/notifications/task-due.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e: renamed for work items, the
 * date-only due day, the workspace's in-app mute list asked before any write
 * (as 1.6 does for the other two bells), the link through `workItemPath`, and
 * a batch form for the job's page write (one `createMany` and one id
 * read-back per page, where the source wrote and read back per item).
 */
import type { PrismaClient } from '@prisma/client';

import { publishNotificationEvent } from '@/lib/notifications/notification-bus';
import { tenantWorkItemPath } from '@/lib/work-item-paths';
import { insertedNotificationIds } from './inserted-ids';
import { isInAppTypeEnabled } from './settings';

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The bell type this emitter writes; `in-app-types.ts` lists it. */
export const WORK_ITEM_DUE_NOTIFICATION_TYPE = 'WORK_ITEM_DUE' as const;

/** The three reminder touchpoints. */
export type WorkItemDueWindow = 'week' | 'day' | 'today';

interface WindowCopy {
    /** Calendar days from today (in the reminder zone) to the due date. */
    days: number;
    title: string;
    /** "<item label> <phrase>." */
    phrase: string;
}

export const WORK_ITEM_DUE_WINDOWS: Record<WorkItemDueWindow, WindowCopy> = {
    week: { days: 7, title: 'Work item due in one week', phrase: 'is due in one week' },
    day: { days: 1, title: 'Work item due tomorrow', phrase: 'is due tomorrow' },
    today: { days: 0, title: 'Work item due today', phrase: 'is due today' },
};

/** The title the settings API lists for the mute. */
export const WORK_ITEM_DUE_NOTIFICATION_TITLE = 'Work item due';

/** The YYYY-MM-DD calendar date of the instant `d` as seen in IANA zone `tz`. */
export function dayKeyInTz(d: Date, tz: string): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** The YYYY-MM-DD of a date-only value: its UTC date parts, never converted. */
export function dateOnlyKey(dueDate: Date): string {
    return dueDate.toISOString().slice(0, 10);
}

/** Today (in `tz`) as a date-only value: UTC midnight of that calendar date. */
export function todayInTz(now: Date, tz: string): Date {
    return new Date(`${dayKeyInTz(now, tz)}T00:00:00Z`);
}

/**
 * Calendar days from today (in `tz`) to the date-only `dueDate`: 0 = due
 * today, 1 = tomorrow, negative = overdue.
 */
export function daysUntilDue(dueDate: Date, now: Date = new Date(), tz: string = 'UTC'): number {
    return Math.round((Date.parse(`${dateOnlyKey(dueDate)}T00:00:00Z`) - Date.parse(`${dayKeyInTz(now, tz)}T00:00:00Z`)) / MS_PER_DAY);
}

/** The reminder window a due date is on today, or `null`. */
export function classifyDueWindow(dueDate: Date, now: Date = new Date(), tz: string = 'UTC'): WorkItemDueWindow | null {
    const days = daysUntilDue(dueDate, now, tz);
    for (const key of Object.keys(WORK_ITEM_DUE_WINDOWS) as WorkItemDueWindow[]) {
        if (WORK_ITEM_DUE_WINDOWS[key].days === days) return key;
    }
    return null;
}

export function buildWorkItemDueDedupeKey(
    tenantId: string,
    window: WorkItemDueWindow,
    workItemId: string,
    userId: string,
    now: Date,
    tz: string = 'UTC',
): string {
    return `${tenantId}:WORK_ITEM_DUE:${window}:${workItemId}:${userId}:${dayKeyInTz(now, tz)}`;
}

/** One item in the shape the reminder needs. */
export interface WorkItemDueTarget {
    id: string;
    tenantId: string;
    tenantSlug: string;
    title: string;
    key: string | null;
    dueDate: Date;
    assigneeUserId: string;
}

export interface WorkItemDueOutcome {
    status: 'created' | 'duplicate' | 'out-of-window' | 'muted';
    window: WorkItemDueWindow | null;
}

type DueDb = Pick<PrismaClient, 'notification' | 'tenantNotificationSettings'>;

function rowFor(target: WorkItemDueTarget, window: WorkItemDueWindow, now: Date, tz: string) {
    const copy = WORK_ITEM_DUE_WINDOWS[window];
    const label = target.key ? `${target.key} "${target.title}"` : `"${target.title}"`;
    return {
        tenantId: target.tenantId,
        userId: target.assigneeUserId,
        type: WORK_ITEM_DUE_NOTIFICATION_TYPE,
        title: copy.title,
        body: `${label} ${copy.phrase}.`,
        linkUrl: tenantWorkItemPath(target.tenantSlug, target.id),
        dedupeKey: buildWorkItemDueDedupeKey(target.tenantId, window, target.id, target.assigneeUserId, now, tz),
    };
}

/**
 * Write the reminders for a batch of items of ONE workspace: the mute check
 * once, one `createMany({ skipDuplicates })`, one read-back of the inserted
 * ids, then a push per inserted row. Items off every window are skipped.
 */
export async function createWorkItemDueNotifications(
    db: DueDb,
    tenantId: string,
    targets: readonly WorkItemDueTarget[],
    now: Date = new Date(),
    tz: string = 'UTC',
): Promise<{ created: number; candidates: number; muted: boolean }> {
    const rows = [] as ReturnType<typeof rowFor>[];
    for (const t of targets) {
        if (t.tenantId !== tenantId) continue;
        const window = classifyDueWindow(t.dueDate, now, tz);
        if (window) rows.push(rowFor(t, window, now, tz));
    }
    if (rows.length === 0) return { created: 0, candidates: 0, muted: false };
    // Above the write, not filtered after it: a muted row would still reach
    // the bell list, the badge and the SSE stream.
    if (!(await isInAppTypeEnabled(db, tenantId, WORK_ITEM_DUE_NOTIFICATION_TYPE))) {
        return { created: 0, candidates: rows.length, muted: true };
    }
    const result = await db.notification.createMany({ data: rows, skipDuplicates: true });
    if (result.count > 0) {
        const inserted = await insertedNotificationIds(db, tenantId, rows.map((r) => r.dedupeKey));
        for (const row of rows) {
            const written = inserted.get(row.dedupeKey);
            if (!written) continue;
            publishNotificationEvent(tenantId, row.userId, {
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
    return { created: result.count, candidates: rows.length, muted: false };
}

/** The single form, for the usecases' post-commit call. */
export async function createWorkItemDueNotification(
    db: DueDb,
    target: WorkItemDueTarget,
    now: Date = new Date(),
    tz: string = 'UTC',
): Promise<WorkItemDueOutcome> {
    const window = classifyDueWindow(target.dueDate, now, tz);
    if (!window) return { status: 'out-of-window', window: null };
    const r = await createWorkItemDueNotifications(db, target.tenantId, [target], now, tz);
    if (r.muted) return { status: 'muted', window };
    return { status: r.created > 0 ? 'created' : 'duplicate', window };
}
