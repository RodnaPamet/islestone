/**
 * The timesheet bells (sub-phase 3.4c; docs/porting/maps/3.4.md,
 * "Notifications (decision 276)"; ADR 0012 §8; owner decision 276):
 *
 *   - `TIMESHEET_SUBMITTED` — to whoever approves weeks when a member submits
 *     theirs (the settings' recipient list, else every holder of
 *     `time.approve`; never the week's own person);
 *   - `TIMESHEET_RETURNED` — to the person when their week is returned, or an
 *     approved week is reopened (also an immediate email);
 *   - `TIMESHEET_APPROVED` — to the person when their week is approved;
 *   - `TIMESHEET_REMINDER` — the Monday reminder to submit last week, while
 *     approval is on (`jobs/timesheet-reminder.ts`).
 *
 * Each row names the week and who decided, NEVER the explanation's text (it
 * is encrypted; `Notification.body` is not). No row names a work item
 * (`workItemId` NULL). Like every bell writer it asks `isInAppTypeEnabled`
 * for its recipients BEFORE it writes, inserts with
 * `createMany({ skipDuplicates: true })` and publishes each inserted row's
 * real id.
 *
 * Written fresh for Islestone, in the shape of `review.ts`.
 */
import type { PrismaClient } from '@prisma/client';

import { publishNotificationEvent } from '@/lib/notifications/notification-bus';

import { insertedNotificationIds } from './inserted-ids';
import { isInAppTypeEnabled } from './settings';

export type TimesheetNotificationType = 'TIMESHEET_SUBMITTED' | 'TIMESHEET_RETURNED' | 'TIMESHEET_APPROVED' | 'TIMESHEET_REMINDER';

/** The titles each type writes; `in-app-types.ts` lists the types from these keys. */
export const TIMESHEET_NOTIFICATION_COPY: Record<TimesheetNotificationType, { title: string }> = {
    TIMESHEET_SUBMITTED: { title: 'Timesheet submitted' },
    TIMESHEET_RETURNED: { title: 'Timesheet returned' },
    TIMESHEET_APPROVED: { title: 'Timesheet approved' },
    TIMESHEET_REMINDER: { title: 'Timesheet to submit' },
};

/** What a timesheet bell is about. `weekStart` is the Monday, `YYYY-MM-DD`. */
export type TimesheetNotice =
    | { kind: 'submitted'; timesheetId: string; version: number; weekStart: string; personName?: string | null }
    | { kind: 'returned'; timesheetId: string; version: number; weekStart: string; byName?: string | null; reopened: boolean }
    | { kind: 'approved'; timesheetId: string; version: number; weekStart: string; byName?: string | null }
    | { kind: 'reminder'; weekStart: string };

export function timesheetNoticeType(notice: TimesheetNotice): TimesheetNotificationType {
    switch (notice.kind) {
        case 'submitted':
            return 'TIMESHEET_SUBMITTED';
        case 'returned':
            return 'TIMESHEET_RETURNED';
        case 'approved':
            return 'TIMESHEET_APPROVED';
        case 'reminder':
            return 'TIMESHEET_REMINDER';
    }
}

/** "23 November 2026": the week's Monday, date-only (never through a zone). */
export function weekLabel(weekStart: string): string {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${weekStart}T00:00:00Z`));
}

/** The bell's title and body: the week and who; never the explanation. */
export function timesheetNotificationText(notice: TimesheetNotice): { title: string; body: string } {
    const week = `the week of ${weekLabel(notice.weekStart)}`;
    switch (notice.kind) {
        case 'submitted': {
            const who = notice.personName?.trim() || 'A member';
            return { title: TIMESHEET_NOTIFICATION_COPY.TIMESHEET_SUBMITTED.title, body: `${who} submitted their timesheet for ${week}.` };
        }
        case 'returned': {
            const who = notice.byName?.trim() || 'An approver';
            return notice.reopened
                ? { title: 'Timesheet reopened', body: `${who} reopened your approved timesheet for ${week}. Open it to see why.` }
                : { title: TIMESHEET_NOTIFICATION_COPY.TIMESHEET_RETURNED.title, body: `${who} returned your timesheet for ${week}. Open it to see why.` };
        }
        case 'approved': {
            const who = notice.byName?.trim() || 'An approver';
            return { title: TIMESHEET_NOTIFICATION_COPY.TIMESHEET_APPROVED.title, body: `${who} approved your timesheet for ${week}.` };
        }
        case 'reminder':
            return { title: TIMESHEET_NOTIFICATION_COPY.TIMESHEET_REMINDER.title, body: `You recorded time in ${week}; submit your timesheet for it.` };
    }
}

/**
 * The dedupe key: per type, source and person. A decision rings once per
 * version of the week's row (a week may be returned, resubmitted and
 * returned again); the reminder once per person and week.
 */
export function buildTimesheetDedupeKey(tenantId: string, notice: TimesheetNotice, userId: string): string {
    const type = timesheetNoticeType(notice);
    if (notice.kind === 'reminder') return `${tenantId}:${type}:${notice.weekStart}:${userId}`;
    return `${tenantId}:${type}:${notice.timesheetId}:${notice.version}:${userId}`;
}

type TimesheetDb = Pick<PrismaClient, 'notification' | 'tenantNotificationSettings' | 'notificationPreference'>;

/**
 * One type's bells for one workspace: the preference read once, one
 * `createMany({ skipDuplicates })`, one id read-back, then a push per row.
 * Returns the people a row was written for.
 */
export async function createTimesheetNotifications(
    db: TimesheetDb,
    tenantId: string,
    entries: ReadonlyArray<{ userId: string; notice: TimesheetNotice; linkUrl: string }>,
): Promise<{ created: number; written: string[] }> {
    if (entries.length === 0) return { created: 0, written: [] };
    const type = timesheetNoticeType(entries[0]!.notice);
    // Above the write, not filtered after it: a muted row would still reach
    // the bell list, the badge and the SSE stream.
    const enabled = await isInAppTypeEnabled(db, tenantId, type, entries.map((e) => e.userId));
    const rows = entries
        .filter((e) => timesheetNoticeType(e.notice) === type && enabled.has(e.userId))
        .map((e) => {
            const text = timesheetNotificationText(e.notice);
            return {
                tenantId,
                userId: e.userId,
                type,
                title: text.title,
                body: text.body,
                linkUrl: e.linkUrl,
                workItemId: null,
                dedupeKey: buildTimesheetDedupeKey(tenantId, e.notice, e.userId),
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
