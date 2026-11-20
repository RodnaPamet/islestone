'use client';

/**
 * One cycle's page (sub-phase 2.5a): its scope, started and completed items,
 * the burn-up, and its work items in the shared list and board
 * (`WorkItemsView` scoped to the cycle, so writes flow through the one cache
 * and an item whose cycle changes leaves or joins this list). A viewer the
 * server offers `manageCycles` may rename the cycle or move its dates, and
 * delete it while it is upcoming.
 *
 * Written fresh for Islestone (docs/porting/maps/2.5.md, "UI touch points").
 */
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { WorkItemsView } from '@/components/work-items/WorkItemsView';
import { useTenantHref } from '@/lib/tenant-context-provider';
import type { CycleAffordances, CycleData, SavedViewAffordances } from '@/lib/work-items/types';

import { BurnUpChart } from './BurnUpChart';
import { CycleFormDialog } from './CycleDialogs';
import { cycleTitle } from './CyclesView';
import { useBurnUp, useCycle, useCycleWrites } from './use-cycles';

function Stat({ label, value }: { label: string; value: string | number }) {
    return (
        <div>
            <dt className="text-xs text-content-muted">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums text-content-emphasis">{value}</dd>
        </div>
    );
}

function CycleSummary({ cycle, affordances }: { cycle: CycleData; affordances: CycleAffordances }) {
    const tSummary = useTranslations('cycles');
    const router = useRouter();
    const tenantHref = useTenantHref();
    const burnUp = useBurnUp(cycle.id);
    const writes = useCycleWrites();
    const [editing, setEditing] = useState(false);
    const done = cycle.counts.scope === 0 ? 0 : Math.round((cycle.counts.completed / cycle.counts.scope) * 100);
    const canEdit = affordances.manageCycles && cycle.status !== 'completed';

    return (
        <div className="space-y-default" data-testid="cycle-summary">
            <div className="flex flex-wrap items-start justify-between gap-default">
                <dl className="grid grid-cols-2 gap-default sm:grid-cols-5" aria-label={tSummary('stats.label')}>
                    <Stat label={tSummary('stats.scope')} value={cycle.counts.scope} />
                    <Stat label={tSummary('stats.started')} value={cycle.counts.started} />
                    <Stat label={tSummary('stats.completed')} value={cycle.counts.completed} />
                    <Stat label={tSummary('stats.percent')} value={`${done}%`} />
                    <Stat label={tSummary('stats.daysLeft')} value={cycle.daysLeft} />
                </dl>
                {canEdit && (
                    <div className="flex items-center gap-tight">
                        <Button variant="secondary" text={tSummary('edit')} onClick={() => setEditing(true)} />
                        {cycle.status === 'upcoming' && (
                            <Button
                                variant="ghost"
                                text={tSummary('delete')}
                                onClick={() => {
                                    writes.remove(cycle);
                                    router.push(tenantHref('/cycles'));
                                }}
                            />
                        )}
                    </div>
                )}
            </div>
            <BurnUpChart points={burnUp.data?.points ?? []} truncated={burnUp.data?.truncated} loading={burnUp.isLoading} />
            {canEdit && <CycleFormDialog open={editing} onOpenChange={setEditing} teamId={cycle.teamId} cycle={cycle} />}
        </div>
    );
}

export function CycleView({
    initialCycle,
    teamName,
    affordances,
    savedViews,
}: {
    initialCycle: CycleData;
    teamName: string;
    affordances: CycleAffordances;
    savedViews: SavedViewAffordances;
}) {
    const tCycle = useTranslations('cycles');
    const { data } = useCycle(initialCycle.id, initialCycle);
    const cycle = data ?? initialCycle;
    return (
        <WorkItemsView
            scope={{ teamId: cycle.teamId, cycleId: cycle.id }}
            title={cycleTitle(tCycle, cycle)}
            description={tCycle('subtitle', { team: teamName, start: cycle.startsOn, end: cycle.endsOn, status: tCycle(`status.${cycle.status}`) })}
            viewKey={`cycle:${cycle.id}`}
            savedViews={savedViews}
            summary={<CycleSummary cycle={cycle} affordances={affordances} />}
        />
    );
}
