import { GoalsView } from '@/components/goals/GoalsView';
import { goalsPageContext } from '@/lib/server/goal-pages.server';

/**
 * Goals (sub-phase 3.2b; decision 222): the Roadmap entry's first page until
 * the Roadmap page itself (3.2c). The goal tree with progress and health; the
 * writes it offers are `goalAffordances`, asked on the server. A viewer
 * without `goals.view` gets a 404.
 */
export default async function GoalsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { goals, options, affordances } = await goalsPageContext(tenantSlug);
    return <GoalsView initialGoals={goals} goalOptions={options.goals} affordances={affordances} />;
}
