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
import { ForecastSection } from '@/components/analytics/forecast/ForecastSection';
import { WorkItemsView } from '@/components/work-items/WorkItemsView';
import { useTenantHref } from '@/lib/tenant-context-provider';
import type { BurnUpMeasure, CycleAffordances, CycleData, SavedViewAffordances } from '@/lib/work-items/types';

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

function CycleSummary({ cycle, affordances, forecast }: { cycle: CycleData; affordances: CycleAffordances; forecast: boolean }) {
    const tSummary = useTranslations('cycles');
    const router = useRouter();
    const tenantHref = useTenantHref();
    // What the burn-up counts (3.4a, decision 259): items, or the team's estimate unit; the server says which it offers.
    const [measure, setMeasure] = useState<BurnUpMeasure>('items');
    const burnUp = useBurnUp(cycle.id, measure);
    // The previous measure's answer stays while another loads (`keepPreviousData`), labelled by its own `measure`.
    const measures = burnUp.data?.measures ?? ['items'];
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
            <BurnUpChart
                points={burnUp.data?.points ?? []}
                truncated={burnUp.data?.truncated}
                loading={burnUp.isLoading}
                measure={burnUp.data?.measure ?? measure}
                selected={measure}
                measures={measures}
                onMeasure={setMeasure}
                unavailable={burnUp.error !== undefined && measure !== 'items'}
            />
            {/* Beside the burn-up: the chance of finishing its open items by its end (3.6c, decision 324). */}
            {forecast && cycle.status !== 'completed' && <ForecastSection filters={{ teamId: cycle.teamId, cycleId: cycle.id }} />}
            {canEdit && <CycleFormDialog open={editing} onOpenChange={setEditing} teamId={cycle.teamId} cycle={cycle} />}
        </div>
    );
}

export function CycleView({
    initialCycle,
    teamName,
    affordances,
    savedViews,
    forecast = false,
}: {
    initialCycle: CycleData;
    teamName: string;
    affordances: CycleAffordances;
    savedViews: SavedViewAffordances;
    /** The Forecast section (3.6c; `mayViewAnalytics`, asked on the server). */
    forecast?: boolean;
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
            summary={<CycleSummary cycle={cycle} affordances={affordances} forecast={forecast} />}
        />
    );
}
