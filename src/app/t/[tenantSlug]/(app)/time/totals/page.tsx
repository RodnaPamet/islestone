import { TimeTotalsView } from '@/components/time/TimeTotalsView';
import { timeTotalsPageContext } from '@/lib/server/time-pages.server';

/**
 * Time totals (sub-phase 3.4d; docs/porting/maps/3.4.md, "Time totals"):
 * the sums of finished time over a window, grouped, with the CSV and Excel
 * export, for `time.view` (asked on the server; anybody else gets a 404).
 * Money only for `time.rates`, as the read answers it.
 */
export default async function TimeTotalsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { affordances, today, projects } = await timeTotalsPageContext(tenantSlug);
    return <TimeTotalsView affordances={affordances} today={today} projects={projects} />;
}
