'use client';

/**
 * Cycle time with age, and lead time (sub-phase 3.6a; owner decisions 312
 * and 313; docs/porting/maps/3.6.md, "What a widget shows").
 *
 *   - **Cycle time**: each of the newest completions as a dot (its completion
 *     day, its cycle time in working days), the 50th, 85th and 95th
 *     percentiles over every completion as lines, and open, started items'
 *     age as dots on today, so an item already older than the 85th shows.
 *   - **Lead time**: the distribution of lead times in whole working days
 *     as bars, the percentiles in the summary.
 *
 * The shared chart platform draws time series only; the scatter and the
 * distribution are small Islestone visx components on the same scales and
 * tokens (the map names them). Each has its table. Written fresh for
 * Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { Group } from '@visx/group';
import { ParentSize } from '@visx/responsive';
import { scaleBand, scaleLinear, scaleUtc } from '@visx/scale';
import { Bar, Line } from '@visx/shape';

import type { DurationsResponse, PercentileSummary } from '@/lib/analytics/types';

import type { AnalyticsRead } from '../data/use-analytics';
import { ChartSection, FiguresTable } from './ChartSection';

const MARGIN = { top: 8, right: 12, bottom: 28, left: 40 };
const DOT_CLASS = 'text-content-info';
const AGE_CLASS = 'text-content-warning';
const LINE_CLASS = 'text-content-muted';
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

function Scatter({ data, width, height }: { data: DurationsResponse; width: number; height: number }) {
    const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
    const innerH = Math.max(0, height - MARGIN.top - MARGIN.bottom);
    const done = data.points.filter((p) => p.cycleTime !== null);
    const lines = [data.cycleTime.p50, data.cycleTime.p85, data.cycleTime.p95].filter((v): v is number => v !== null);
    const maxY = Math.max(1, ...done.map((p) => p.cycleTime!), ...data.age.map((a) => a.age), ...lines);
    const x = scaleUtc({ domain: [day(data.from), day(data.asOf < data.to ? data.asOf : data.to)], range: [0, innerW] });
    const y = scaleLinear({ domain: [0, maxY * 1.05], range: [innerH, 0], nice: true });
    const today = day(data.asOf);
    return (
        <svg width={width} height={height} className="overflow-visible">
            <Group left={MARGIN.left} top={MARGIN.top}>
                {lines.map((v) => (
                    <Line key={v} from={{ x: 0, y: y(v) }} to={{ x: innerW, y: y(v) }} className={LINE_CLASS} stroke="currentColor" strokeDasharray="4 3" strokeWidth={1} />
                ))}
                {done.map((p) => (
                    <circle key={p.workItemId} cx={x(day(p.completedOn))} cy={y(p.cycleTime!)} r={3} className={DOT_CLASS} fill="currentColor" fillOpacity={0.7} />
                ))}
                {data.age.map((a) => (
                    <circle key={a.workItemId} cx={x(today)} cy={y(a.age)} r={3} className={AGE_CLASS} fill="currentColor" fillOpacity={0.7} />
                ))}
                <AxisLeft scale={y} numTicks={4} stroke="currentColor" tickStroke="currentColor" tickLabelProps={{ className: 'fill-content-muted text-[10px]' }} />
                <AxisBottom top={innerH} scale={x} numTicks={Math.max(2, Math.floor(innerW / 90))} stroke="currentColor" tickStroke="currentColor" tickLabelProps={{ className: 'fill-content-muted text-[10px]' }} />
            </Group>
        </svg>
    );
}

/** Lead times in whole working days: `[days, count]`, every day from 0 to the longest. */
export function leadTimeBuckets(points: DurationsResponse['points']): Array<[number, number]> {
    if (points.length === 0) return [];
    const counts = new Map<number, number>();
    let max = 0;
    for (const p of points) {
        const d = Math.floor(p.leadTime);
        counts.set(d, (counts.get(d) ?? 0) + 1);
        max = Math.max(max, d);
    }
    return Array.from({ length: max + 1 }, (_, d) => [d, counts.get(d) ?? 0] as [number, number]);
}

function Distribution({ buckets, width, height }: { buckets: Array<[number, number]>; width: number; height: number }) {
    const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
    const innerH = Math.max(0, height - MARGIN.top - MARGIN.bottom);
    const x = scaleBand({ domain: buckets.map(([d]) => d), range: [0, innerW], padding: 0.2 });
    const y = scaleLinear({ domain: [0, Math.max(1, ...buckets.map(([, n]) => n))], range: [innerH, 0], nice: true });
    return (
        <svg width={width} height={height}>
            <Group left={MARGIN.left} top={MARGIN.top}>
                {buckets.map(([d, n]) => (
                    <Bar key={d} x={x(d) ?? 0} y={y(n)} width={x.bandwidth()} height={innerH - y(n)} className={DOT_CLASS} fill="currentColor" rx={2} />
                ))}
                <AxisLeft scale={y} numTicks={4} stroke="currentColor" tickStroke="currentColor" tickLabelProps={{ className: 'fill-content-muted text-[10px]' }} />
                <AxisBottom
                    top={innerH}
                    scale={x}
                    numTicks={Math.min(buckets.length, Math.max(2, Math.floor(innerW / 40)))}
                    stroke="currentColor"
                    tickStroke="currentColor"
                    tickLabelProps={{ className: 'fill-content-muted text-[10px]' }}
                />
            </Group>
        </svg>
    );
}

function percentileText(t: (key: string, values?: Record<string, string | number>) => string, s: PercentileSummary): string {
    return s.count === 0 ? t('noneDone') : t('percentiles', { count: s.count, p50: s.p50 ?? 0, p85: s.p85 ?? 0, p95: s.p95 ?? 0 });
}

export function CycleTimeChart({ read }: { read: AnalyticsRead<DurationsResponse> }) {
    const tCycle = useTranslations('analytics.durations');
    const data = read.data;
    const summary = data ? (
        <>
            {percentileText(tCycle, data.cycleTime)} {data.doneWithoutStarting > 0 && tCycle('doneWithoutStarting', { count: data.doneWithoutStarting })}{' '}
            {data.ageTotal > 0 && tCycle('ageSummary', { count: data.ageTotal, shown: data.age.length })} {data.pointsNewestOnly && tCycle('newestOnly', { count: data.points.length })}
        </>
    ) : undefined;
    return (
        <ChartSection
            title={tCycle('cycleTitle')}
            testId="analytics-cycle-time"
            legend={[
                { label: tCycle('legend.done'), className: DOT_CLASS },
                { label: tCycle('legend.age'), className: AGE_CLASS },
                { label: tCycle('legend.percentiles'), className: LINE_CLASS },
            ]}
            summary={summary}
            loading={read.isLoading && !data}
            failed={!!read.error}
            tooLarge={read.tooLarge}
            empty={!!data && data.points.length === 0 && data.age.length === 0}
            chart={() => (
                <div className="h-full w-full" role="img" aria-label={data ? percentileText(tCycle, data.cycleTime) : ''}>
                    <ParentSize>{({ width, height }) => (data && width > 0 && height > 0 ? <Scatter data={data} width={width} height={height} /> : null)}</ParentSize>
                </div>
            )}
            table={() => (
                <>
                    <FiguresTable
                        caption={tCycle('cycleCaption')}
                        columns={[tCycle('item'), tCycle('title'), tCycle('completedOn'), tCycle('cycleTime')]}
                        rows={(data?.points ?? []).map((p) => [p.key, p.title, p.completedOn, p.cycleTime === null ? tCycle('notStarted') : tCycle('days', { days: p.cycleTime })] as const)}
                    />
                    {data && data.age.length > 0 && (
                        <FiguresTable
                            caption={tCycle('ageCaption')}
                            columns={[tCycle('item'), tCycle('title'), tCycle('startedOn'), tCycle('age')]}
                            rows={data.age.map((a) => [a.key, a.title, a.startedOn, tCycle('days', { days: a.age })] as const)}
                        />
                    )}
                </>
            )}
        />
    );
}

export function LeadTimeChart({ read }: { read: AnalyticsRead<DurationsResponse> }) {
    const tLead = useTranslations('analytics.durations');
    const data = read.data;
    const buckets = useMemo(() => leadTimeBuckets(data?.points ?? []), [data]);
    return (
        <ChartSection
            title={tLead('leadTitle')}
            testId="analytics-lead-time"
            legend={[{ label: tLead('legend.items'), className: DOT_CLASS }]}
            summary={data ? <>{percentileText(tLead, data.leadTime)} {data.pointsNewestOnly && tLead('newestOnly', { count: data.points.length })}</> : undefined}
            loading={read.isLoading && !data}
            failed={!!read.error}
            tooLarge={read.tooLarge}
            empty={!!data && data.points.length === 0}
            chart={() => (
                <div className="h-full w-full" role="img" aria-label={data ? percentileText(tLead, data.leadTime) : ''}>
                    <ParentSize>{({ width, height }) => (width > 0 && height > 0 ? <Distribution buckets={buckets} width={width} height={height} /> : null)}</ParentSize>
                </div>
            )}
            table={() => (
                <FiguresTable caption={tLead('leadCaption')} columns={[tLead('leadDays'), tLead('items')]} rows={buckets.map(([d, n]) => [tLead('daysRange', { from: d, to: d + 1 }), n] as const)} />
            )}
        />
    );
}
