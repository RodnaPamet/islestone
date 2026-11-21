import { TeamWorkingCalendarSettings } from '@/components/settings/WorkingCalendarSettings';
import { settingsPageAccess } from '@/lib/server/settings-pages.server';

/** Settings → Working calendars → a team's own calendar (roadmap 3.1a, decision 189); the gate is the Settings page's own. */
export default async function TeamWorkingCalendarSettingsPage({ params }: { params: Promise<{ tenantSlug: string; teamId: string }> }) {
    const { tenantSlug, teamId } = await params;
    const { affordances } = await settingsPageAccess(tenantSlug);
    return <TeamWorkingCalendarSettings teamId={teamId} affordances={affordances} />;
}
