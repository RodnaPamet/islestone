import { WorkItemTypesSettings } from '@/components/settings/WorkItemTypesSettings';
import { settingsPageAccess } from '@/lib/server/settings-pages.server';

/** Settings → Work item types (decision 55); the gate is the Settings page's own. */
export default async function WorkItemTypesSettingsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { affordances } = await settingsPageAccess(tenantSlug);
    return <WorkItemTypesSettings affordances={affordances} />;
}
