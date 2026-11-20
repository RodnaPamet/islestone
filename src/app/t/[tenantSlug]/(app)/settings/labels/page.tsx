import { LabelsSettings } from '@/components/settings/LabelsSettings';
import { settingsPageAccess } from '@/lib/server/settings-pages.server';

/** Settings → Labels (decision 55); the gate is the Settings page's own. */
export default async function LabelsSettingsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { affordances } = await settingsPageAccess(tenantSlug);
    return <LabelsSettings affordances={affordances} />;
}
