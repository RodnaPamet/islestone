'use client';

/**
 * One dashboard widget (sub-phase 3.6d; docs/porting/maps/3.6.md, "What a
 * widget shows" and "What a widget is over"; owner decisions 327 and 328):
 * its type's chart over its own scope (the list's filters) and window, each
 * read its own SWR key under the viewer's own visibility and keys, so one
 * slow chart never holds the others and a shared dashboard shows each viewer
 * only what they may see. Every chart keeps its table (the accessible
 * fallback). A widget whose stored configuration no longer parses says so.
 *
 * Pattern only, no code copied: inflect-compliance's
 * `src/components/ui/dashboard-widgets/ChartRenderer.tsx` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (one typed dispatcher from a
 * widget's type to its chart). Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { BurnUpChart } from '@/components/cycles/BurnUpChart';
import { useWorkConfig } from '@/components/work-items/data/use-work-config';
import type { WorkItemListFilters } from '@/components/work-items/data/list-filters';
import { resolveWidgetWindow, scopeAsListFilters, type DashboardWidgetData, type WidgetShape } from '@/lib/analytics/dashboard';
import type { AnalyticsMeasure } from '@/lib/analytics/types';

import { CountsFigures } from '../charts/CountsFigures';
import { CycleTimeChart, LeadTimeChart } from '../charts/DurationCharts';
import { FlowChart } from '../charts/FlowChart';
import { ThroughputChart } from '../charts/ThroughputChart';
import { TimeWaitingChart } from '../charts/TimeWaitingChart';
import type { SectionOverrides } from '../charts/ChartSection';
import { useAnalytics, type AnalyticsWindow } from '../data/use-analytics';
import type { ForecastChoices } from '../data/use-forecast';
import { ForecastPanel } from '../forecast/ForecastPanel';
import { ForecastSheet } from '../forecast/ForecastSection';

/** A widget's frame when its chart is not a `ChartSection` (the counts, the forecast, a widget that cannot draw). */
export function WidgetFrame({ title, actions, frame, testId, children }: { title: string; actions?: ReactNode; frame?: ReactNode; testId: string; children: ReactNode }) {
    return (
        <section aria-label={title} className="flex h-full min-h-0 flex-col gap-tight overflow-hidden rounded-lg border border-border-default bg-bg-default p-4" data-testid={testId}>
            <div className="flex flex-wrap items-center justify-between gap-tight">
                <h2 className="text-sm font-semibold text-content-emphasis">{title}</h2>
                {actions && <div className="flex items-center gap-1">{actions}</div>}
            </div>
            {frame && <p className="text-xs text-content-muted">{frame}</p>}
            <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        </section>
    );
}

type Windowed = Exclude<WidgetShape, { type: 'FORECAST' }>;

function WindowedChart({ shape, filters, window, section }: { shape: Windowed; filters: WorkItemListFilters; window: AnalyticsWindow; section: SectionOverrides }) {
    switch (shape.type) {
        case 'THROUGHPUT':
            return <ThroughputRead filters={filters} window={window} bin={shape.config.bin} section={section} />;
        case 'CYCLE_TIME':
            return <DurationsRead filters={filters} window={window} measure="cycle" section={section} />;
        case 'LEAD_TIME':
            return <DurationsRead filters={filters} window={window} measure="lead" section={section} />;
        case 'CUMULATIVE_FLOW':
            return <FlowRead filters={filters} window={window} section={section} />;
        case 'TIME_WAITING':
            return <WaitingRead filters={filters} window={window} section={section} />;
        case 'BURN_UP':
            return <BurnUpRead filters={filters} window={window} initial={shape.config.measure} section={section} />;
        case 'COUNTS':
            return <CountsRead filters={filters} window={window} section={section} />;
    }
}

function ThroughputRead({ filters, window, bin, section }: { filters: WorkItemListFilters; window: AnalyticsWindow; bin: 'day' | 'week'; section: SectionOverrides }) {
    const read = useAnalytics('throughput', filters, window, { bin });
    return <ThroughputChart read={read} section={section} />;
}

function DurationsRead({ filters, window, measure, section }: { filters: WorkItemListFilters; window: AnalyticsWindow; measure: 'cycle' | 'lead'; section: SectionOverrides }) {
    const read = useAnalytics('durations', filters, window, { measure });
    return measure === 'cycle' ? <CycleTimeChart read={read} section={section} /> : <LeadTimeChart read={read} section={section} />;
}

function FlowRead({ filters, window, section }: { filters: WorkItemListFilters; window: AnalyticsWindow; section: SectionOverrides }) {
    const read = useAnalytics('flow', filters, window);
    return <FlowChart read={read} section={section} />;
}

function WaitingRead({ filters, window, section }: { filters: WorkItemListFilters; window: AnalyticsWindow; section: SectionOverrides }) {
    const read = useAnalytics('waiting', filters, window);
    return <TimeWaitingChart read={read} section={section} />;
}

function CountsRead({ filters, window, section }: { filters: WorkItemListFilters; window: AnalyticsWindow; section: SectionOverrides }) {
    const tCountsWidget = useTranslations('analytics.dashboards.types');
    const read = useAnalytics('counts', filters, window);
    return (
        <WidgetFrame title={section.title ?? tCountsWidget('COUNTS')} actions={section.actions} frame={section.frame} testId={section.testId ?? 'analytics-counts-widget'}>
            <CountsFigures read={read} />
        </WidgetFrame>
    );
}

function BurnUpRead({ filters, window, initial, section }: { filters: WorkItemListFilters; window: AnalyticsWindow; initial: AnalyticsMeasure; section: SectionOverrides }) {
    const tBurnUpChart = useTranslations('analytics.chart');
    // The stored measure is where the widget starts; a viewer may switch it without changing the dashboard.
    const [measure, setMeasure] = useState<AnalyticsMeasure>(initial);
    const read = useAnalytics('flow', filters, window, { burnUp: '1', measure });
    const burnUp = read.data?.burnUp ?? null;
    return (
        <div className="flex h-full min-h-0 flex-col gap-tight overflow-hidden rounded-lg border border-border-default bg-bg-default p-4" data-testid={section.testId}>
            {read.tooLarge ? (
                <>
                    <h2 className="text-sm font-semibold text-content-emphasis">{section.title}</h2>
                    <p role="status" className="text-sm text-content-muted">
                        {tBurnUpChart(`tooLarge.${read.tooLarge.what}`, { count: read.tooLarge.count, limit: read.tooLarge.limit })}
                    </p>
                </>
            ) : (
                <div className="min-h-0 flex-1">
                    <BurnUpChart
                        points={burnUp?.points ?? []}
                        loading={read.isLoading && !read.data}
                        measure={burnUp?.measure ?? 'items'}
                        selected={measure}
                        measures={burnUp?.measures ?? (measure === 'items' ? ['items'] : ['items', measure])}
                        onMeasure={setMeasure}
                        // The teams in scope no longer all estimate in the chosen unit: say so; items stay offered.
                        unavailable={!!read.error && measure !== 'items'}
                        heading={section.title}
                        actions={section.actions}
                        fill
                    />
                </div>
            )}
            {section.frame && <p className="text-xs text-content-muted">{section.frame}</p>}
        </div>
    );
}

function ForecastRead({ title, filters, config, actions, frame, testId }: { title: string; filters: WorkItemListFilters; config: Extract<WidgetShape, { type: 'FORECAST' }>['config']; actions?: ReactNode; frame?: ReactNode; testId: string }) {
    const tForecast = useTranslations('forecast');
    const stored = useMemo<ForecastChoices>(() => ({ historyWeeks: config.historyWeeks, share: config.share, basedOn: config.basedOn }), [config]);
    // The stored choices are where the widget starts; the details sheet may try others without changing the dashboard.
    const [choices, setChoices] = useState<ForecastChoices>(stored);
    const [open, setOpen] = useState(false);
    return (
        <WidgetFrame
            title={title}
            frame={frame}
            testId={testId}
            actions={
                <>
                    <Button variant="ghost" size="sm" text={tForecast('details')} onClick={() => setOpen(true)} />
                    {actions}
                </>
            }
        >
            <ForecastPanel filters={filters} choices={stored} onChoices={() => undefined} />
            <ForecastSheet open={open} onClose={() => setOpen(false)} filters={filters} choices={choices} onChoices={setChoices} />
        </WidgetFrame>
    );
}

export interface DashboardWidgetViewProps {
    widget: DashboardWidgetData;
    /** Today in the workspace calendar's zone: a window of weeks ends on it. */
    today: string;
    /** The widget's settings and removal in edit mode. */
    actions?: ReactNode;
}

/** What a widget shows, dispatched on its type. */
export function DashboardWidgetView({ widget, today, actions }: DashboardWidgetViewProps) {
    const tTypeNames = useTranslations('analytics.dashboards.types');
    const tWidget = useTranslations('analytics.dashboards.widget');
    const config = useWorkConfig();
    const testId = `dashboard-widget-${widget.id}`;
    const title = widget.title ?? tTypeNames(widget.type);
    const shape = widget.shape;
    const filters = useMemo(() => (shape ? scopeAsListFilters(shape.config.scope) : {}), [shape]);
    const scoped = shape ? Object.keys(filters).length > 0 : false;

    if (!shape) {
        return (
            <WidgetFrame title={title} actions={actions} testId={testId}>
                <p className="text-sm text-content-muted">{tWidget('unreadable')}</p>
            </WidgetFrame>
        );
    }
    const scopeText = scoped ? tWidget('scopeFiltered', { count: Object.keys(filters).length }) : tWidget('scopeAll');
    if (shape.type === 'FORECAST') {
        return <ForecastRead title={title} filters={filters} config={shape.config} actions={actions} frame={scopeText} testId={testId} />;
    }
    const win = shape.config.window;
    const resolved = resolveWidgetWindow(win, today, config.cycles);
    const teamName = win.kind === 'cycle' ? (config.teams.find((t) => t.id === win.teamId)?.name ?? tWidget('removedTeam')) : '';
    if (!resolved) {
        return (
            <WidgetFrame title={title} actions={actions} testId={testId}>
                <p className="text-sm text-content-muted">{tWidget('noCurrentCycle', { team: teamName })}</p>
            </WidgetFrame>
        );
    }
    const windowText = win.kind === 'weeks' ? tWidget('windowWeeks', { weeks: win.weeks }) : tWidget('windowCycle', { team: teamName });
    const section: SectionOverrides = {
        testId,
        actions,
        fill: true,
        frame: tWidget('frame', { window: windowText, scope: scopeText }),
        ...(widget.title ? { title: widget.title } : {}),
    };
    if (shape.type === 'BURN_UP') section.title = title;
    return <WindowedChart shape={shape} filters={filters} window={{ from: resolved.from, to: resolved.to }} section={section} />;
}
