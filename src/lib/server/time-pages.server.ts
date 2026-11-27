/**
 * What the Time entry's pages read on the server (sub-phase 3.4b;
 * docs/porting/maps/3.4.md, "The pages (3.4b)"): the request context
 * (`getTenantCtx`, the gates the API asks), what the pages offer
 * (`timeAffordances`, the predicates the usecases assert), and today's date
 * in `NOTIFICATIONS_TZ` through the clock seam, the week My time opens on.
 * A viewer who neither records time nor approves weeks gets a 404; the
 * Timesheets page (3.4c) only whoever approves weeks.
 *
 * Written fresh for Islestone.
 */
import { notFound } from 'next/navigation';

import { getTenantCtx } from '@/app-layer/context';
import { dayKeyInTz } from '@/app-layer/notifications/work-item-due';
import { mayApproveTime, mayTrackTime, timeAffordances } from '@/app-layer/policies/time.policies';
import { notificationsTz } from '@/app-layer/usecases/work-item-shared';
import { todayClock } from '@/lib/clock';
import { isCalendarDate } from '@/lib/calendar-date';
import type { TimeAffordances } from '@/lib/time/types';
import { weekStartOf } from '@/lib/time/week';

export async function myTimePageContext(tenantSlug: string, week: string | undefined): Promise<{ affordances: TimeAffordances; today: string; weekStart: string }> {
    const ctx = await getTenantCtx({ tenantSlug });
    if (!mayTrackTime(ctx) && !mayApproveTime(ctx)) notFound();
    const zone = notificationsTz();
    const today = dayKeyInTz(todayClock(zone), zone);
    return { affordances: timeAffordances(ctx), today, weekStart: weekStartOf(week && isCalendarDate(week) ? week : today) };
}

/**
 * The Timesheets page (3.4c): whoever approves weeks (`time.approve`, decision
 * 269); anybody else gets a 404, as for a page they may not open.
 */
export async function timesheetsPageContext(tenantSlug: string): Promise<{ affordances: TimeAffordances }> {
    const ctx = await getTenantCtx({ tenantSlug });
    if (!mayApproveTime(ctx)) notFound();
    return { affordances: timeAffordances(ctx) };
}
