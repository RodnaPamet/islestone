import { getTranslations } from 'next-intl/server';

import { WorkloadSettings } from '@/components/workload/WorkloadSettings';
import { settingsPageAccess } from '@/lib/server/settings-pages.server';
import { workloadPageContext } from '@/lib/server/workload-pages.server';

/**
 * Settings → Workload (sub-phase 3.5a; docs/porting/maps/3.5.md, "The page";
 * decisions 284, 285, 288 and 298): the default weekly hours, each member's
 * capacity with its changes, and any member's time off with its types. The
 * gate is the Settings page's own; the writes it offers are
 * `workloadAffordances`, asked on the server.
 */
export default async function WorkloadSettingsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { workload } = await settingsPageAccess(tenantSlug);
    const { today } = await workloadPageContext(tenantSlug);
    const t = await getTranslations('settings.workload');
    return <WorkloadSettings title={t('title')} affordances={workload} today={today} />;
}
