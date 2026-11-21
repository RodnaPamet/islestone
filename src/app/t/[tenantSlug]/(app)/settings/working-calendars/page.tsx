import { WorkingCalendarsSettings } from '@/components/settings/WorkingCalendarSettings';
import { settingsPageAccess } from '@/lib/server/settings-pages.server';

/** Settings → Working calendars (roadmap 3.1a, decisions 189 to 193); the gate is the Settings page's own. */
export default async function WorkingCalendarsSettingsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { affordances } = await settingsPageAccess(tenantSlug);
    return <WorkingCalendarsSettings affordances={affordances} />;
}
