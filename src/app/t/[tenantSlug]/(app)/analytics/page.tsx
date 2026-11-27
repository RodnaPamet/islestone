import { AnalyticsView } from '@/components/analytics/AnalyticsView';
import { WorkConfigProvider } from '@/components/work-items/data/use-work-config';
import { analyticsPageContext } from '@/lib/server/analytics-pages.server';

/**
 * Analytics (sub-phase 3.6a; docs/porting/maps/3.6.md, "Where analytics
 * appear"; owner decisions 324 and 329): counts and five fixed charts over a
 * scope set with the list's filters. What it offers is
 * `analyticsAffordances`, asked on the server; a viewer without
 * `analytics.view` gets a 404.
 */
export default async function AnalyticsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { affordances, config, today } = await analyticsPageContext(tenantSlug);
    return (
        <WorkConfigProvider config={config}>
            <AnalyticsView affordances={affordances} today={today} />
        </WorkConfigProvider>
    );
}
