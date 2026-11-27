'use client';

/**
 * Throughput (sub-phase 3.6a; ADR 0006 "Throughput", never "Velocity"):
 * items completed per ISO week (or day), drawn as bars on the shared chart
 * platform (`TimeSeriesChart`, `Bars`, the axes), the median whole week in
 * the summary, and the bins as a table. Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { Bars, TimeSeriesChart, XAxis, YAxis, type TimeSeriesDatum } from '@inflect/ui/components/ui/charts';
import type { ThroughputResponse } from '@/lib/analytics/types';

import type { AnalyticsRead } from '../data/use-analytics';
import { ChartSection, FiguresTable, type SectionOverrides } from './ChartSection';

type Datum = TimeSeriesDatum<{ count: number }>;
const BAR_CLASS = 'text-content-info';

export function ThroughputChart({ read, section }: { read: AnalyticsRead<ThroughputResponse>; section?: SectionOverrides }) {
    const t = useTranslations('analytics.throughput');
    const data = read.data;
    const points = useMemo<Datum[]>(() => (data?.bins ?? []).map((b) => ({ date: new Date(`${b.start}T00:00:00.000Z`), values: { count: b.count } })), [data]);
    const series = useMemo(() => [{ id: 'count', isActive: true, valueAccessor: (d: Datum) => d.values.count, colorClassName: BAR_CLASS }], []);
    const unit = data?.bin === 'day' ? 'day' : 'week';
    return (
        <ChartSection
            title={t('title')}
            testId="analytics-throughput"
            legend={[{ label: t(`legend.${unit}`), className: BAR_CLASS }]}
            summary={data ? t(`summary.${unit}`, { total: data.total, median: data.median ?? 0 }) : undefined}
            loading={read.isLoading && !data}
            {...section}
            failed={!!read.error}
            tooLarge={read.tooLarge}
            empty={!!data && data.bins.length === 0}
            chart={() => (
                <div className="h-full w-full" role="img" aria-label={t('aria', { total: data?.total ?? 0, median: data?.median ?? 0 })}>
                    <TimeSeriesChart data={points} series={series} type="bar" tooltipContent={(d) => t('tooltip', { count: d.values.count })}>
                        <YAxis showGridLines />
                        <XAxis />
                        <Bars seriesStyles={[{ id: 'count', barClassName: BAR_CLASS }]} />
                    </TimeSeriesChart>
                </div>
            )}
            table={() => (
                <FiguresTable
                    caption={t('caption')}
                    columns={[t('from'), t('to'), t('done')]}
                    rows={(data?.bins ?? []).map((b) => [b.start, b.end, b.count] as const)}
                />
            )}
        />
    );
}
