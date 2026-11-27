import { TimeTrackingSettings } from '@/components/settings/TimeTrackingSettings';
import { settingsPageAccess } from '@/lib/server/settings-pages.server';

/**
 * Settings → Time tracking (sub-phase 3.4c; owner decisions 268 and 269):
 * "Timesheets need approval" and who is told of submitted weeks. The gate is
 * the Settings page's own; the write is offered to whoever manages the
 * workspace (`admin.manage`), asked on the server.
 */
export default async function TimeTrackingSettingsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { affordances } = await settingsPageAccess(tenantSlug);
    return <TimeTrackingSettings manage={affordances.manageWorkConfig} />;
}
