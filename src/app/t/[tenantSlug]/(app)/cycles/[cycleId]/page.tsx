import { CycleView } from '@/components/cycles/CycleView';
import { WorkConfigProvider } from '@/components/work-items/data/use-work-config';
import { cyclePageContext } from '@/lib/server/cycle-pages.server';

/**
 * One cycle (sub-phase 2.5a): its scope, started and completed items, the
 * burn-up, and its work items as a list or a board. An unknown or invisible
 * cycle is a 404.
 */
export default async function CyclePage({ params }: { params: Promise<{ tenantSlug: string; cycleId: string }> }) {
    const { tenantSlug, cycleId } = await params;
    const { cycle, teamName, config, affordances, savedViews, forecast } = await cyclePageContext(tenantSlug, decodeURIComponent(cycleId));
    return (
        <WorkConfigProvider config={config}>
            <CycleView initialCycle={cycle} teamName={teamName} affordances={affordances} savedViews={savedViews} forecast={forecast} />
        </WorkConfigProvider>
    );
}
