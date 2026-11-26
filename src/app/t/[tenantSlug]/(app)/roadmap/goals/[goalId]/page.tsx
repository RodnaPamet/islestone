import { GoalView } from '@/components/goals/GoalView';
import { goalPageContext } from '@/lib/server/goal-pages.server';

/**
 * One goal (sub-phase 3.2b): its ancestors, progress, health and its
 * history, child goals, initiatives and directly named items. A missing or
 * deleted goal, or a viewer without `goals.view`, is a 404.
 */
export default async function GoalPage({ params }: { params: Promise<{ tenantSlug: string; goalId: string }> }) {
    const { tenantSlug, goalId } = await params;
    const { detail, options, affordances } = await goalPageContext(tenantSlug, decodeURIComponent(goalId));
    return <GoalView initialDetail={detail} goalOptions={options.goals} affordances={affordances} />;
}
