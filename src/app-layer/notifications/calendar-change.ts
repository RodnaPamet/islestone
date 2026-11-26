/**
 * The calendar read-back's bell (roadmap 3.3c; ADR 0011 §1; owner decisions
 * 227 and 230): a day the member moved in their calendar was not applied, and
 * the next push puts Islestone's date back.
 *
 * In-app only, never email (decision 230; `IN_APP_ONLY_TYPES` in
 * `src/lib/notifications/preferences.ts` and the CHECK
 * `NotificationPreference_in_app_only_types`), under the member's preference
 * like every bell writer: it asks `isInAppTypeEnabled` BEFORE it writes. The
 * row names the item by its key, or the milestone by its name, and says why;
 * it never carries a description, a comment or anything read from the
 * calendar beyond the day.
 *
 * ONE PER EVENT AND CHANGED DAY (decision 230: "not one per sync"): the dedupe
 * key is the synced event's client id and the day the member moved it to, so
 * a change seen again (Graph's window is read every quarter hour; a revert
 * that has not reached the calendar yet) rings once.
 *
 * Written fresh for Islestone, in the shape of `mention.ts`.
 */
import type { PrismaClient } from '@prisma/client';

import { publishNotificationEvent } from '@/lib/notifications/notification-bus';

import { insertedNotificationIds } from './inserted-ids';
import { isInAppTypeEnabled } from './settings';

/** The bell type this writer emits; `in-app-types.ts` lists it. */
export const CALENDAR_CHANGE_NOTIFICATION_TYPE = 'CALENDAR_CHANGE_NOT_APPLIED' as const;

/** The title it writes. */
export const CALENDAR_CHANGE_NOTIFICATION_TITLE = 'Calendar change not applied';

/** Why a moved day was not applied (each a sentence in `calendarChangeBody`). */
export type CalendarChangeRefusal =
    | 'STALE'
    | 'NO_EDIT'
    | 'FIELD_HIDDEN'
    | 'ITEM_CLOSED'
    | 'START_AFTER_DUE'
    | 'PROJECT_ARCHIVED'
    | 'MILESTONE';

const REASON_TEXT: Record<Exclude<CalendarChangeRefusal, 'MILESTONE'>, string> = {
    STALE: 'the due date changed in Islestone',
    NO_EDIT: 'you cannot edit this item',
    FIELD_HIDDEN: "this item's type does not show a due date",
    ITEM_CLOSED: 'the item is closed',
    START_AFTER_DUE: 'the new due date is before its start date',
    PROJECT_ARCHIVED: 'its project is archived',
};

export interface CalendarChangeTarget {
    tenantId: string;
    userId: string;
    reason: CalendarChangeRefusal;
    /** The item's key (`ISL-12`), or the milestone's name. */
    label: string;
    /** The bell's link, `/t/<slug>/…`. */
    linkUrl: string;
    /** Set for an item: the bell row's `workItemId`. */
    workItemId: string | null;
    /** The synced event's deterministic client id. */
    clientEventId: string;
    /** `YYYY-MM-DD`: the day the member moved the event to. */
    movedTo: string;
}

/**
 * "Your calendar change to ISL-12 was not applied: the due date changed in
 * Islestone." / "Milestones cannot be moved from your calendar: Launch."
 */
export function calendarChangeBody(t: Pick<CalendarChangeTarget, 'reason' | 'label'>): string {
    if (t.reason === 'MILESTONE') return `Milestones cannot be moved from your calendar: ${t.label}.`;
    return `Your calendar change to ${t.label} was not applied: ${REASON_TEXT[t.reason]}.`;
}

export function buildCalendarChangeDedupeKey(t: Pick<CalendarChangeTarget, 'tenantId' | 'userId' | 'clientEventId' | 'movedTo'>): string {
    return `${t.tenantId}:${CALENDAR_CHANGE_NOTIFICATION_TYPE}:${t.clientEventId}:${t.userId}:${t.movedTo}`;
}

export async function createCalendarChangeNotAppliedNotification(
    db: Pick<PrismaClient, 'notification' | 'tenantNotificationSettings' | 'notificationPreference'>,
    t: CalendarChangeTarget,
): Promise<{ created: number }> {
    // Above the write, not filtered after it: a muted row would still reach
    // the bell list, the badge and the SSE stream.
    const enabled = await isInAppTypeEnabled(db, t.tenantId, CALENDAR_CHANGE_NOTIFICATION_TYPE, [t.userId]);
    if (!enabled.has(t.userId)) return { created: 0 };

    const row = {
        tenantId: t.tenantId,
        userId: t.userId,
        type: CALENDAR_CHANGE_NOTIFICATION_TYPE,
        title: CALENDAR_CHANGE_NOTIFICATION_TITLE,
        body: calendarChangeBody(t),
        linkUrl: t.linkUrl,
        workItemId: t.workItemId,
        dedupeKey: buildCalendarChangeDedupeKey(t),
    };
    const result = await db.notification.createMany({ data: [row], skipDuplicates: true });
    if (result.count > 0) {
        const written = (await insertedNotificationIds(db, t.tenantId, [row.dedupeKey])).get(row.dedupeKey);
        if (written) {
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
