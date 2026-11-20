import { MilestonesView } from '@/components/milestones/MilestonesView';
import { milestonesPageContext } from '@/lib/server/milestone-pages.server';

/**
 * A project's milestones (sub-phase 2.5b): each with its due date, progress
 * and "late" mark. An unknown or invisible project is a 404.
 */
export default async function MilestonesPage({ params }: { params: Promise<{ tenantSlug: string; projectKey: string }> }) {
    const { tenantSlug, projectKey } = await params;
    const prefix = decodeURIComponent(projectKey).toUpperCase();
    const { project, milestones, affordances } = await milestonesPageContext(tenantSlug, prefix);
    return <MilestonesView project={project} initialMilestones={milestones} affordances={affordances} />;
}
