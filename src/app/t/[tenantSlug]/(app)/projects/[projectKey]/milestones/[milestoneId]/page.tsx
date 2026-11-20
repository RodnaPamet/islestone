import { MilestoneView } from '@/components/milestones/MilestoneView';
import { WorkConfigProvider } from '@/components/work-items/data/use-work-config';
import { milestonePageContext } from '@/lib/server/milestone-pages.server';

/**
 * One milestone (sub-phase 2.5b): its due date and progress, and its work
 * items as a list or a board. An unknown or invisible milestone is a 404.
 */
export default async function MilestonePage({ params }: { params: Promise<{ tenantSlug: string; projectKey: string; milestoneId: string }> }) {
    const { tenantSlug, projectKey, milestoneId } = await params;
    const prefix = decodeURIComponent(projectKey).toUpperCase();
    const { project, milestone, config, affordances, savedViews } = await milestonePageContext(tenantSlug, prefix, decodeURIComponent(milestoneId));
    return (
        <WorkConfigProvider config={config}>
            <MilestoneView project={project} initialMilestone={milestone} affordances={affordances} savedViews={savedViews} />
        </WorkConfigProvider>
    );
}
