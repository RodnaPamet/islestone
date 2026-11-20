import { getTranslations } from 'next-intl/server';

import { CyclesView } from '@/components/cycles/CyclesView';
import { cyclesPageContext } from '@/lib/server/cycle-pages.server';

/**
 * Cycles (sub-phase 2.5a): every team's current, upcoming and completed
 * cycles. The writes it offers (the schedule, a one-off cycle, deleting an
 * upcoming one) are `cycleAffordances`, asked on the server.
 */
export default async function CyclesPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { teams, cycles, affordances } = await cyclesPageContext(tenantSlug);
    const tNav = await getTranslations('nav');
    return <CyclesView title={tNav('cycles')} teams={teams} initialCycles={cycles} affordances={affordances} />;
}
