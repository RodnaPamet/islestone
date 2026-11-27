'use client';

/**
 * The forecast's distribution (sub-phase 3.6c; owner decision 324): how many
 * of the trials finish on each working day (or ISO week, past 92 days), with
 * the scope's due date as a dashed line.
 *
 * Copied from inflect-compliance `src/components/ui/charts/ale-histogram.tsx`
 * (BUSL-1.1, the same licensor; PROVENANCE.md) and adapted: its accessible
 * buckets (each a focusable list item whose label reads its range and count,
 * the svg carrying a plain-language summary) and its dashed reference line
 * kept; decade buckets of currency replaced by days and weeks of the
 * forecast, the band stacks dropped, the axes on Islestone's tokens, the copy
 * through `next-intl`.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { Group } from '@visx/group';
import { ParentSize } from '@visx/responsive';
import { scaleBand, scaleLinear } from '@visx/scale';

import { formatDay } from '@/components/time/time-format';
import type { ForecastResponse } from '@/lib/analytics/types';

const MARGIN = { top: 16, right: 16, bottom: 28, left: 44 };
const BAR_CLASS = 'text-content-info';
const DUE_CLASS = 'text-content-error';

type Histogram = NonNullable<ForecastResponse['histogram']>;

function Inner({ histogram, trials, dueDate, width, height }: { histogram: Histogram; trials: number; dueDate: string | null; width: number; height: number }) {
    const t = useTranslations('forecast.histogram');
    const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
    const innerH = Math.max(0, height - MARGIN.top - MARGIN.bottom);
    const buckets = histogram.buckets;
    const x = useMemo(() => scaleBand({ domain: buckets.map((b) => b.start), range: [0, innerW], padding: 0.15 }), [buckets, innerW]);
    const maxCount = buckets.reduce((m, b) => Math.max(m, b.trials), 0);
    const y = useMemo(() => scaleLinear({ domain: [0, Math.max(1, maxCount)], range: [innerH, 0], nice: true }), [maxCount, innerH]);
    if (buckets.length === 0 || width === 0) return null;
    const label = (b: Histogram['buckets'][number]) =>
        b.start === b.end ? formatDay(b.start, 'dateYear') : t('range', { from: formatDay(b.start, 'date'), to: formatDay(b.end, 'dateYear') });
    // The due date's line sits at the bucket holding it, or past the last one.
    const dueBucket = dueDate ? buckets.find((b) => b.start <= dueDate && dueDate <= b.end) ?? (dueDate > buckets[buckets.length - 1]!.end ? null : buckets.find((b) => b.start > dueDate)) : null;
    const dueX = dueBucket ? (x(dueBucket.start) ?? 0) + (dueDate! >= dueBucket.start ? x.bandwidth() : 0) : null;
    const step = Math.max(1, Math.ceil(buckets.length / Math.max(2, Math.floor(innerW / 70))));
    return (
        <svg width={width} height={height} className="overflow-visible">
            <Group left={MARGIN.left} top={MARGIN.top}>
                <g role="list" aria-label={t('buckets')}>
                    {buckets.map((b) => {
                        const h = innerH - y(b.trials);
                        return (
                            <g
                                key={b.start}
                                role="listitem"
                                tabIndex={b.trials > 0 ? 0 : -1}
                                aria-label={t('bucket', { when: label(b), trials: b.trials, share: Math.round((b.trials / trials) * 1000) / 10 })}
                                data-testid="forecast-histogram-bucket"
                                data-trials={b.trials}
                                className="focus:outline-none focus-visible:opacity-70"
                            >
                                <rect x={x(b.start)} y={innerH - h} width={x.bandwidth()} height={h} className={BAR_CLASS} fill="currentColor" fillOpacity={0.8} />
                            </g>
                        );
                    })}
                </g>
                {dueX !== null && (
                    <g className={DUE_CLASS} data-testid="forecast-histogram-due">
                        <line x1={dueX} x2={dueX} y1={0} y2={innerH} stroke="currentColor" strokeWidth={1.5} strokeDasharray="4 3" />
                        <text x={dueX} y={-4} fontSize={9} textAnchor="middle" fill="currentColor">
                            {t('due', { date: formatDay(dueDate!, 'date') })}
                        </text>
                    </g>
                )}
                <AxisLeft scale={y} numTicks={4} stroke="currentColor" tickStroke="currentColor" tickLabelProps={{ className: 'fill-content-muted text-[10px]' }} />
                <AxisBottom
                    top={innerH}
                    scale={x}
                    tickValues={buckets.filter((_, i) => i % step === 0).map((b) => b.start)}
                    tickFormat={(v) => formatDay(String(v), 'date')}
                    stroke="currentColor"
                    tickStroke="currentColor"
                    tickLabelProps={{ className: 'fill-content-muted text-[10px]' }}
                />
            </Group>
        </svg>
    );
}

export function ForecastHistogram({ histogram, trials, dueDate, ariaLabel }: { histogram: Histogram; trials: number; dueDate: string | null; ariaLabel: string }) {
    return (
        <div className="h-full w-full" role="group" aria-label={ariaLabel} data-testid="forecast-histogram">
            <ParentSize>{({ width, height }) => <Inner histogram={histogram} trials={trials} dueDate={dueDate} width={width} height={height} />}</ParentSize>
        </div>
    );
}
