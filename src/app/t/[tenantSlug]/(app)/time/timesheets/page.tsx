import { getTranslations } from 'next-intl/server';

import { TimesheetsView } from '@/components/time/TimesheetsView';
import { timesheetsPageContext } from '@/lib/server/time-pages.server';

/**
 * Timesheets (sub-phase 3.4c; docs/porting/maps/3.4.md, "Acts"): the weeks
 * waiting for a decision and those decided, for whoever approves weeks
 * (`time.approve`, asked on the server; anybody else gets a 404).
 */
export default async function TimesheetsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    await timesheetsPageContext(tenantSlug);
    const t = await getTranslations('time.timesheets');
    return <TimesheetsView title={t('title')} />;
}
