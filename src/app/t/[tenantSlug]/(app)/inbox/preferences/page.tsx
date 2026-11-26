import { CalendarSyncSection } from '@/components/calendar-sync/CalendarSyncSection';
import { NotificationPreferencesView } from '@/components/inbox/NotificationPreferencesView';
import { calendarSyncSectionOffered } from '@/lib/server/calendar-sync-pages.server';

/**
 * Inbox → Notification preferences (sub-phase 2.7c; owner decision 132): the
 * member's own choices per kind of notification, under the workspace's
 * settings. Every member manages their own; the layout has admitted them.
 * Roadmap 3.3b adds the member's own "Calendar sync" section, offered by the
 * server (`work_items.view`, the deployment switch open); `?calendar=` is the
 * callback's outcome.
 */
export default async function NotificationPreferencesPage({
    params,
    searchParams,
}: {
    params: Promise<{ tenantSlug: string }>;
    searchParams: Promise<{ calendar?: string | string[] }>;
}) {
    const { tenantSlug } = await params;
    const { calendar } = await searchParams;
    const offered = await calendarSyncSectionOffered(tenantSlug);
    return <NotificationPreferencesView>{offered ? <CalendarSyncSection outcome={typeof calendar === 'string' ? calendar : null} /> : null}</NotificationPreferencesView>;
}
