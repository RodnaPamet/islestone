import { getTranslations } from 'next-intl/server';

import { NotificationSettings } from '@/components/settings/NotificationSettings';
import { settingsPageAccess } from '@/lib/server/settings-pages.server';

/**
 * Settings → Notifications (sub-phase 2.7c; owner decision 136): the
 * workspace's ceiling over members' preferences. The gate is the Settings
 * page's own; whether the settings are the caller's to see is asked on the
 * server (the 1.6 API's `admin.manage`).
 */
export default async function NotificationSettingsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { manageNotificationSettings } = await settingsPageAccess(tenantSlug);
    const t = await getTranslations('settings.notifications');
    return <NotificationSettings title={t('title')} canManage={manageNotificationSettings} />;
}
