'use client';

/**
 * Cumulative flow (sub-phase 3.6a; ADR 0006 "Cumulative flow"): the items in
 * scope at each day's end by state category, Done counted from the window's
 * first day, drawn as stacked areas on the shared chart platform (each band
 * a cumulative series, the widest first) with the same days as a table.
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { Areas, TimeSeriesChart, XAxis, YAxis, type TimeSeriesDatum } from '@inflect/ui/components/ui/charts';
import type { FlowResponse } from '@/lib/analytics/types';

import type { AnalyticsRead } from '../data/use-analytics';
import { ChartSection, FiguresTable, type SectionOverrides } from './ChartSection';

type Bands = { backlog: number; unstarted: number; started: number; done: number };
type Datum = TimeSeriesDatum<Bands>;

const BANDS = [
    { id: 'backlog', className: 'text-content-subtle' },
    { id: 'unstarted', className: 'text-content-muted' },
    { id: 'started', className: 'text-content-info' },
    { id: 'done', className: 'text-content-success' },
] as const;

export function FlowChart({ read, section }: { read: AnalyticsRead<FlowResponse>; section?: SectionOverrides }) {
    const t = useTranslations('analytics.flow');
    const data = read.data;
    // Cumulative from the bottom (Done) up, so each band's top is its series.
    const points = useMemo<Datum[]>(
        () =>
            (data?.days ?? []).map((d) => ({
                date: new Date(`${d.date}T00:00:00.000Z`),
                values: { done: d.done, started: d.done + d.started, unstarted: d.done + d.started + d.unstarted, backlog: d.done + d.started + d.unstarted + d.backlog },
            })),
        [data],
    );
    const series = useMemo(() => BANDS.map((b) => ({ id: b.id, isActive: true, valueAccessor: (d: Datum) => d.values[b.id], colorClassName: b.className })), []);
    const last = data?.days.at(-1);
    return (
        <ChartSection
            title={t('title')}
            testId="analytics-flow"
            legend={BANDS.map((b) => ({ label: t(`band.${b.id}`), className: b.className }))}
            summary={last ? t('summary', { items: data!.items, ...last }) : undefined}
            loading={read.isLoading && !data}
            {...section}
            failed={!!read.error}
            tooLarge={read.tooLarge}
            empty={!!data && data.days.length === 0}
            chart={() => (
                <div className="h-full w-full" role="img" aria-label={t('aria', { backlog: last?.backlog ?? 0, unstarted: last?.unstarted ?? 0, started: last?.started ?? 0, done: last?.done ?? 0 })}>
                    <TimeSeriesChart
                        data={points}
                        series={series}
                        type="area"
                        tooltipContent={(d) =>
                            t('tooltip', {
                                backlog: d.values.backlog - d.values.unstarted,
                                unstarted: d.values.unstarted - d.values.started,
                                started: d.values.started - d.values.done,
                                done: d.values.done,
                            })
                        }
                    >
                        <YAxis showGridLines />
                        <XAxis />
                        <Areas seriesStyles={BANDS.map((b) => ({ id: b.id, lineClassName: b.className }))} />
                    </TimeSeriesChart>
                </div>
            )}
            table={() => (
                <FiguresTable
                    caption={t('caption')}
                    columns={[t('date'), t('band.backlog'), t('band.unstarted'), t('band.started'), t('band.done')]}
                    rows={(data?.days ?? []).map((d) => [d.date, d.backlog, d.unstarted, d.started, d.done] as const)}
                />
            )}
        />
    );
}
