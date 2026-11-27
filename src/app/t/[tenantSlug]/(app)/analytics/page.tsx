import { AnalyticsDashboardPage } from '@/components/analytics/dashboard/DashboardPages';
import { WorkConfigProvider } from '@/components/work-items/data/use-work-config';
import { analyticsPageContext } from '@/lib/server/analytics-pages.server';

/**
 * Analytics (sub-phases 3.6a and 3.6d; docs/porting/maps/3.6.md, "Where
 * analytics appear" and "Dashboards (3.6d)"; owner decisions 324, 326 and
 * 329): the dashboard page. It shows the default composition (3.6a's and
 * 3.6b's charts) to anyone who has not opened another dashboard, else the
 * viewer's last one. What it offers is asked on the server
 * (`analyticsAffordances`, `dashboardPageAffordances`); a viewer without
 * `analytics.view` gets a 404.
 */
export default async function AnalyticsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { dashboards, config, today } = await analyticsPageContext(tenantSlug);
    return (
        <WorkConfigProvider config={config}>
            <AnalyticsDashboardPage affordances={dashboards} today={today} />
        </WorkConfigProvider>
    );
}
