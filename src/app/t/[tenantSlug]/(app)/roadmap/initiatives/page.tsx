import { InitiativesView } from '@/components/goals/InitiativesView';
import { initiativesPageContext } from '@/lib/server/goal-pages.server';

/**
 * Initiatives (sub-phase 3.2b; decision 222): every initiative with the goal
 * it serves, its progress and health. A viewer without `goals.view` gets a
 * 404.
 */
export default async function InitiativesPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { initiatives, options, affordances } = await initiativesPageContext(tenantSlug);
    return <InitiativesView initialInitiatives={initiatives} goalOptions={options.goals} affordances={affordances} />;
}
