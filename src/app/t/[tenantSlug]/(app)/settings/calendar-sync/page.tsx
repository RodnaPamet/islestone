import { getTranslations } from 'next-intl/server';

import { CalendarSyncSettings } from '@/components/calendar-sync/CalendarSyncSettings';
import { settingsPageAccess } from '@/lib/server/settings-pages.server';

/**
 * Settings → Calendar sync (roadmap 3.3b; ADR 0011 §5 and §6; owner decisions
 * 234 and 237): the workspace's switch and Microsoft 365's admin consent. The
 * gate is the Settings page's own; whether the caller may manage calendar
 * sync (`integrations.manage`) and whether the operator opened it
 * (`CALENDAR_SYNC`) are asked on the server. `?calendar=` is the admin-consent
 * callback's outcome.
 */
export default async function CalendarSyncSettingsPage({
    params,
    searchParams,
}: {
    params: Promise<{ tenantSlug: string }>;
    searchParams: Promise<{ calendar?: string | string[] }>;
}) {
    const { tenantSlug } = await params;
    const { calendar } = await searchParams;
    const { calendarSync } = await settingsPageAccess(tenantSlug);
    const t = await getTranslations('calendarSync.settings');
    return <CalendarSyncSettings title={t('title')} canManage={calendarSync.manage} open={calendarSync.open} outcome={typeof calendar === 'string' ? calendar : null} />;
}
