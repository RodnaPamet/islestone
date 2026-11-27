import { SavedDashboardPage } from '@/components/analytics/dashboard/DashboardPages';
import { WorkConfigProvider } from '@/components/work-items/data/use-work-config';
import { analyticsPageContext } from '@/lib/server/analytics-pages.server';

/**
 * One dashboard (sub-phase 3.6d; docs/porting/maps/3.6.md, "Dashboards
 * (3.6d)"; owner decisions 326 to 328): a personal one of the viewer's or a
 * shared one, its widgets each read under the viewer's own visibility and
 * keys. Its edit mode follows the server's `viewer` affordances; `?edit=1`
 * opens it in edit mode (a dashboard just made). A viewer without
 * `analytics.view` gets a 404; another person's personal dashboard reads as
 * not found.
 */
export default async function DashboardPage({ params, searchParams }: { params: Promise<{ tenantSlug: string; dashboardId: string }>; searchParams: Promise<{ edit?: string }> }) {
    const { tenantSlug, dashboardId } = await params;
    const { edit } = await searchParams;
    const { dashboards, config, today } = await analyticsPageContext(tenantSlug);
    return (
        <WorkConfigProvider config={config}>
            <SavedDashboardPage id={dashboardId} affordances={dashboards} today={today} startEditing={edit === '1'} />
        </WorkConfigProvider>
    );
}
