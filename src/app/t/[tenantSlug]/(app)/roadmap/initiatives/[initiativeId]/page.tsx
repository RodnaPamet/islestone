import { InitiativeView } from '@/components/goals/InitiativeView';
import { initiativePageContext } from '@/lib/server/goal-pages.server';

/**
 * One initiative, the roadmap's "portfolio page" (sub-phase 3.2b, decision
 * 221): its goal, progress, health and its history, and its projects table.
 * A missing or deleted initiative, or a viewer without `goals.view`, is a 404.
 */
export default async function InitiativePage({ params }: { params: Promise<{ tenantSlug: string; initiativeId: string }> }) {
    const { tenantSlug, initiativeId } = await params;
    const { detail, options, affordances, forecast } = await initiativePageContext(tenantSlug, decodeURIComponent(initiativeId));
    return <InitiativeView initialDetail={detail} goalOptions={options.goals} projects={options.projects} teams={options.teams} affordances={affordances} forecast={forecast} />;
}
