import { WorkloadView } from '@/components/workload/WorkloadView';
import { WorkConfigProvider } from '@/components/work-items/data/use-work-config';
import { workloadPageContext } from '@/lib/server/workload-pages.server';

/**
 * Workload (sub-phases 3.5a and 3.5b; docs/porting/maps/3.5.md, "The page";
 * decisions 284 to 298): "My capacity and time off", then everyone's work by
 * week against their capacity, over-capacity weeks flagged, a week's items in
 * a sheet. What it offers is `workloadAffordances`, asked on the server; a
 * viewer without `workload.view` gets a 404. A reader of work items gets the
 * view configuration, so a week's items open their sheets.
 */
export default async function WorkloadPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const page = await workloadPageContext(tenantSlug);
    const view = (
        <WorkloadView
            affordances={page.affordances}
            userId={page.userId}
            today={page.today}
            options={{ projects: page.config?.projects ?? [], teams: page.config?.teams ?? [], recipientLists: page.recipientLists, readsItems: page.config !== null }}
        />
    );
    return page.config ? <WorkConfigProvider config={page.config}>{view}</WorkConfigProvider> : view;
}
