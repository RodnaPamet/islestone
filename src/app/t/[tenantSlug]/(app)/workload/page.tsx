import { WorkloadView } from '@/components/workload/WorkloadView';
import { workloadPageContext } from '@/lib/server/workload-pages.server';

/**
 * Workload (sub-phase 3.5a; docs/porting/maps/3.5.md, "The page"; decisions
 * 297 and 298): "My capacity and time off", then everyone's capacity by week.
 * What it offers is `workloadAffordances`, asked on the server; a viewer
 * without `workload.view` gets a 404.
 */
export default async function WorkloadPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { affordances, userId, today } = await workloadPageContext(tenantSlug);
    return <WorkloadView affordances={affordances} userId={userId} today={today} />;
}
