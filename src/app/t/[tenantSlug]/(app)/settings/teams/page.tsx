import { TeamsSettings } from '@/components/settings/TeamsSettings';
import { settingsPageAccess } from '@/lib/server/settings-pages.server';

/** Settings → Teams (decision 55); the gate is the Settings page's own. */
export default async function TeamsSettingsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { affordances } = await settingsPageAccess(tenantSlug);
    return <TeamsSettings affordances={affordances} />;
}
