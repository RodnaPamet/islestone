/**
 * What the calendar sync pages read on the server (roadmap 3.3b; ADR 0011
 * §5): whether the member's own section is offered (`work_items.view`, the
 * deployment switch open; a guest is not offered it, decision 204). Settings
 * → Calendar sync reads `settingsPageAccess`. Never asked in a component.
 *
 * Written fresh for Islestone.
 */
import { getTenantCtx } from '@/app-layer/context';
import { mayConnectCalendar } from '@/app-layer/policies/calendar-sync.policies';
import { isCalendarSyncOpen } from '@/lib/calendar-sync/switch';
import { isAppError } from '@/lib/errors/types';

export async function calendarSyncSectionOffered(tenantSlug: string): Promise<boolean> {
    if (!isCalendarSyncOpen()) return false;
    try {
        return mayConnectCalendar(await getTenantCtx({ tenantSlug }));
    } catch (err) {
        if (isAppError(err)) return false;
        throw err;
    }
}
