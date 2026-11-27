/**
 * The time-off bell (sub-phase 3.5a; docs/porting/maps/3.5.md, "Notifications";
 * ADR 0013 §8; owner decision 300): someone else added, changed or removed
 * your time off.
 *
 * In-app only, never email (`IN_APP_ONLY_TYPES` in
 * `src/lib/notifications/preferences.ts` and the CHECK
 * `NotificationPreference_in_app_only_types`), under the person's preference
 * like every bell writer: it asks `isInAppTypeEnabled` BEFORE it writes. The
 * row names who and the dates, and NEVER the type (decision 287: "Sick" is
 * health data); `workItemId` is NULL; the link is the Workload page.
 *
 * One per write: the dedupe key carries the request id, so a retried request
 * rings once.
 *
 * Written fresh for Islestone, in the shape of `calendar-change.ts`.
 */
import type { PrismaClient } from '@prisma/client';

import { publishNotificationEvent } from '@/lib/notifications/notification-bus';

import { insertedNotificationIds } from './inserted-ids';
import { isInAppTypeEnabled } from './settings';

/** The bell type this writer emits; `in-app-types.ts` lists it. */
export const TIME_OFF_NOTIFICATION_TYPE = 'TIME_OFF_CHANGED_BY_OTHER' as const;

/** The title it writes. */
export const TIME_OFF_NOTIFICATION_TITLE = 'Time off changed for you';

export interface TimeOffChangeTarget {
    tenantId: string;
    /** The person whose time off it is. */
    userId: string;
    /** Who changed it (a holder of `workload.manage`), by name. */
    actorName: string;
    change: 'set' | 'removed';
    /** The dates changed, `YYYY-MM-DD`, ascending. */
    days: readonly string[];
    /** The bell's link, `/t/<slug>/workload`, or NULL when the slug is unknown. */
    linkUrl: string | null;
    /** The request that made the change: one bell per write. */
    requestId: string;
}

/** "7 Dec 2026", from a date-only key, never through a zone. */
function shortDate(ymd: string): string {
    const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
    return `${d} ${month} ${y}`;
}

/** The dates in words: up to three listed, more as a count and a range. */
export function timeOffDaysText(days: readonly string[]): string {
    if (days.length <= 3) return days.map(shortDate).join(', ');
    return `${days.length} dates from ${shortDate(days[0]!)} to ${shortDate(days[days.length - 1]!)}`;
}

/** "Ana Petrova recorded time off for you on 7 Dec 2026." / "… removed your time off on …" — never the type. */
export function timeOffChangeBody(t: Pick<TimeOffChangeTarget, 'actorName' | 'change' | 'days'>): string {
    const when = timeOffDaysText(t.days);
    return t.change === 'set' ? `${t.actorName} recorded time off for you on ${when}.` : `${t.actorName} removed your time off on ${when}.`;
}

export async function createTimeOffChangedNotification(
    db: Pick<PrismaClient, 'notification' | 'tenantNotificationSettings' | 'notificationPreference'>,
    t: TimeOffChangeTarget,
): Promise<{ created: number }> {
    if (t.days.length === 0) return { created: 0 };
    const enabled = await isInAppTypeEnabled(db, t.tenantId, TIME_OFF_NOTIFICATION_TYPE, [t.userId]);
    if (!enabled.has(t.userId)) return { created: 0 };

    const row = {
        tenantId: t.tenantId,
        userId: t.userId,
        type: TIME_OFF_NOTIFICATION_TYPE,
        title: TIME_OFF_NOTIFICATION_TITLE,
        body: timeOffChangeBody(t),
        linkUrl: t.linkUrl,
        workItemId: null,
        dedupeKey: `${t.tenantId}:${TIME_OFF_NOTIFICATION_TYPE}:${t.userId}:${t.change}:${t.requestId}`,
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
