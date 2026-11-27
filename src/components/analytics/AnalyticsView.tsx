'use client';

/**
 * The Analytics page (sub-phase 3.6a; docs/porting/maps/3.6.md, "Where
 * analytics appear"; ADR 0014): over a scope set with the list's shared
 * filter toolbar and a window of the last 4, 8, 12, 26 or 52 weeks, the
 * counts and five fixed charts, each with its table: throughput, cycle time
 * with age, lead time, cumulative flow and the burn-up, then time waiting
 * (3.6b): the totals, and the rows the server gave (every party's for a
 * holder of `analytics.people`, else the reader's own; decision 329). From
 * 3.6d these are the dashboard's default composition.
 *
 * Each chart is its own read (`data/use-analytics.ts`). The status filters
 * are not offered (each measure owns status; decision 315); one carried in
 * the URL is set aside and named. Nothing is grouped by assignee (decision
 * 330). What the page offers is `analyticsAffordances`, asked on the server.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { BurnUpChart } from '@/components/cycles/BurnUpChart';
import { FilterProvider, useFilters } from '@/components/ui/filter';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { useListFiltersFromContext, useWorkItemFilterContext } from '@/components/work-items/use-work-item-filter-context';
import { addDays } from '@/lib/time/week';
import {
    ANALYTICS_SET_ASIDE_FILTERS,
    ANALYTICS_WINDOW_WEEKS,
    DEFAULT_ANALYTICS_WINDOW_WEEKS,
    type AnalyticsAffordances,
    type AnalyticsMeasure,
    type AnalyticsWindowWeeks,
} from '@/lib/analytics/types';

import { CycleTimeChart, LeadTimeChart } from './charts/DurationCharts';
import { FlowChart } from './charts/FlowChart';
import { ThroughputChart } from './charts/ThroughputChart';
import { TimeWaitingChart } from './charts/TimeWaitingChart';
import { useAnalytics, type AnalyticsWindow } from './data/use-analytics';

const SET_ASIDE: readonly string[] = ANALYTICS_SET_ASIDE_FILTERS;
const NO_SCOPE = {};

function Counts({ filters, window }: { filters: ReturnType<typeof useListFiltersFromContext>; window: AnalyticsWindow }) {
    const tCounts = useTranslations('analytics.counts');
    const { data } = useAnalytics('counts', filters, window);
    const figures = [
        ['open', data?.open],
        ['started', data?.started],
        ['done', data?.doneInWindow],
        ['created', data?.createdInWindow],
    ] as const;
    return (
        <dl className="grid grid-cols-2 gap-default md:grid-cols-4" data-testid="analytics-counts">
            {figures.map(([key, value]) => (
                <div key={key} className="rounded-lg border border-border-default p-4">
                    <dt className="text-xs text-content-muted">{tCounts(key)}</dt>
                    <dd className="text-2xl font-semibold tabular-nums text-content-emphasis" data-testid={`analytics-count-${key}`}>
                        {value ?? '–'}
                    </dd>
                </div>
            ))}
        </dl>
    );
}

function AnalyticsBody({ today }: { today: string }) {
    const t = useTranslations('analytics');
    const { filters: defs } = useFilters();
    const filters = useListFiltersFromContext();
    const [weeks, setWeeks] = useState<AnalyticsWindowWeeks>(DEFAULT_ANALYTICS_WINDOW_WEEKS);
    const [measure, setMeasure] = useState<AnalyticsMeasure>('items');
    const window = useMemo<AnalyticsWindow>(() => ({ from: addDays(today, -7 * weeks + 1), to: today }), [today, weeks]);
    const offered = useMemo(() => defs.filter((d) => !SET_ASIDE.includes(d.key)), [defs]);

    const throughput = useAnalytics('throughput', filters, window, { bin: 'week' });
    const cycle = useAnalytics('durations', filters, window, { measure: 'cycle' });
    const flow = useAnalytics('flow', filters, window);
    const burnUpRead = useAnalytics('flow', filters, window, { burnUp: '1', measure });
    const waiting = useAnalytics('waiting', filters, window);
    const setAside = throughput.data?.setAside ?? [];
    const burnUp = burnUpRead.data?.burnUp ?? null;

    return (
        <DashboardLayout header={{ title: t('title'), description: t('description') }} data-testid="analytics-page">
            <div className="flex flex-wrap items-center gap-default">
                <FilterToolbar filters={offered} searchId="analytics-search" searchPlaceholder={t('searchPlaceholder')} />
                <ToggleGroup
                    ariaLabel={t('window.label')}
                    options={ANALYTICS_WINDOW_WEEKS.map((w) => ({ value: String(w), label: t('window.weeks', { weeks: w }) }))}
                    selected={String(weeks)}
                    selectAction={(v) => setWeeks(Number(v) as AnalyticsWindowWeeks)}
                />
            </div>
            <p className="text-xs text-content-muted" data-testid="analytics-frame">
                {throughput.data ? t('frame', { from: window.from, to: throughput.data.asOf, zone: throughput.data.timeZone }) : t('frameLoading')}{' '}
                {setAside.length > 0 && t('setAside', { filters: setAside.map((k) => t(`setAsideNames.${k}`)).join(', ') })}
            </p>
            <Counts filters={filters} window={window} />
            <div className="grid gap-section xl:grid-cols-2">
                <ThroughputChart read={throughput} />
                <CycleTimeChart read={cycle} />
                <LeadTimeChart read={cycle} />
                <FlowChart read={flow} />
            </div>
            <div className="rounded-lg border border-border-default p-4">
                {burnUpRead.tooLarge ? (
                    <p role="status" className="text-sm text-content-muted">
                        {t(`chart.tooLarge.${burnUpRead.tooLarge.what}`, { count: burnUpRead.tooLarge.count, limit: burnUpRead.tooLarge.limit })}
                    </p>
                ) : (
                    <BurnUpChart
                        points={burnUp?.points ?? []}
                        loading={burnUpRead.isLoading && !burnUpRead.data}
                        measure={burnUp?.measure ?? 'items'}
                        selected={measure}
                        measures={burnUp?.measures ?? (measure === 'items' ? ['items'] : ['items', measure])}
                        onMeasure={setMeasure}
                        // The teams in scope no longer all estimate in the chosen unit: say so; items stay offered.
                        unavailable={!!burnUpRead.error && measure !== 'items'}
                    />
                )}
            </div>
            <TimeWaitingChart read={waiting} />
            <p className="text-xs text-content-muted">{t('currentValues')}</p>
        </DashboardLayout>
    );
}

export function AnalyticsView({ today }: { affordances: AnalyticsAffordances; today: string }) {
    const { filterCtx } = useWorkItemFilterContext(NO_SCOPE);
    return (
        <FilterProvider value={filterCtx}>
            <AnalyticsBody today={today} />
        </FilterProvider>
    );
}
