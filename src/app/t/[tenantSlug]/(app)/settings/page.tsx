import { getTranslations } from 'next-intl/server';

import { SettingsOverview } from '@/components/settings/SettingsOverview';
import { settingsPageAccess } from '@/lib/server/settings-pages.server';

/**
 * Settings (decision 55): the sections of the workspace's work
 * configuration, and the steps to a first project. Asserted on the server
 * with the sidebar's own rule, `mayOpenSettings`: anybody else gets a 404,
 * as for a workspace they are not in, rather than a page that names what
 * they may not do.
 */
export default async function SettingsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { affordances } = await settingsPageAccess(tenantSlug);
    const tNav = await getTranslations('nav');
    return <SettingsOverview title={tNav('settings')} affordances={affordances} />;
}
