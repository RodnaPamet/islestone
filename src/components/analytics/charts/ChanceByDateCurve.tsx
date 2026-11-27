'use client';

/**
 * "Chance finished by" (sub-phase 3.6c; owner decision 324): for each
 * working day, the share of trials whose items are all done by it, as a step
 * curve, with the 50, 85 and 95 percent likely dates and the scope's due
 * date as dashed vertical lines.
 *
 * Copied from inflect-compliance
 * `src/components/ui/charts/loss-exceedance-curve.tsx` (BUSL-1.1, the same
 * licensor; PROVENANCE.md) and adapted: its step curve (`curveStepAfter`)
 * with the area under it, its 0 to 100 % axis and its dashed reference lines
 * kept; loss thresholds replaced by dates (a UTC time scale over the
 * forecast's days), exceedance by the cumulative share finished, the
 * currency formatter dropped, colours through Islestone's token classes, the
 * copy through `next-intl`.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { curveStepAfter } from '@visx/curve';
import { Group } from '@visx/group';
import { ParentSize } from '@visx/responsive';
import { scaleLinear, scaleUtc } from '@visx/scale';
import { Area, LinePath } from '@visx/shape';

import { formatDay } from '@/components/time/time-format';

const MARGIN = { top: 18, right: 20, bottom: 28, left: 44 };
const LINE_CLASS = 'text-content-info';
const MARK_CLASS = 'text-content-muted';
const DUE_CLASS = 'text-content-error';
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

export interface CurvePoint {
    date: string;
    /** The share of trials finished by the day, 0 to 1. */
    share: number;
}

export interface CurveMark {
    date: string;
    label: string;
    due?: boolean;
}

function Inner({ points, marks, width, height }: { points: readonly CurvePoint[]; marks: readonly CurveMark[]; width: number; height: number }) {
    const t = useTranslations('forecast.curve');
    const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
    const innerH = Math.max(0, height - MARGIN.top - MARGIN.bottom);
    const first = points[0]?.date;
    const last = [points[points.length - 1]?.date, ...marks.map((m) => m.date)].filter((d): d is string => !!d).sort().at(-1);
    const x = useMemo(() => scaleUtc({ domain: [day(first ?? '1970-01-01'), day(last ?? '1970-01-02')], range: [0, innerW] }), [first, last, innerW]);
    const y = useMemo(() => scaleLinear({ domain: [0, 1], range: [innerH, 0] }), [innerH]);
    if (points.length === 0 || width === 0) return null;
    // The curve starts from nothing finished on the day before the first finishing day.
    const series = [{ date: points[0]!.date, share: 0 }, ...points];
    return (
        <svg width={width} height={height} className="overflow-visible">
            <Group left={MARGIN.left} top={MARGIN.top}>
                <Area<CurvePoint> data={series} x={(d) => x(day(d.date))} y0={() => innerH} y1={(d) => y(d.share)} curve={curveStepAfter} className={LINE_CLASS} fill="currentColor" fillOpacity={0.12} />
                <LinePath<CurvePoint> data={series} x={(d) => x(day(d.date))} y={(d) => y(d.share)} curve={curveStepAfter} className={LINE_CLASS} stroke="currentColor" strokeWidth={2} />
                {marks.map((m) => {
                    const mx = x(day(m.date));
                    return (
                        <g key={`${m.label}-${m.date}`} className={m.due ? DUE_CLASS : MARK_CLASS} data-testid={m.due ? 'forecast-curve-due' : 'forecast-curve-mark'}>
                            <line x1={mx} x2={mx} y1={0} y2={innerH} stroke="currentColor" strokeWidth={1.5} strokeDasharray="4 3" />
                            <text x={mx} y={-5} fontSize={9} textAnchor="middle" fill="currentColor">
                                {m.label}
                            </text>
                        </g>
                    );
                })}
                <AxisLeft scale={y} numTicks={4} tickFormat={(v) => t('percent', { value: Math.round(Number(v) * 100) })} stroke="currentColor" tickStroke="currentColor" tickLabelProps={{ className: 'fill-content-muted text-[10px]' }} />
                <AxisBottom
                    top={innerH}
                    scale={x}
                    numTicks={Math.max(2, Math.floor(innerW / 80))}
                    tickFormat={(v) => formatDay((v as Date).toISOString().slice(0, 10), 'date')}
                    stroke="currentColor"
                    tickStroke="currentColor"
                    tickLabelProps={{ className: 'fill-content-muted text-[10px]' }}
                />
            </Group>
        </svg>
    );
}

export function ChanceByDateCurve({ points, marks, ariaLabel }: { points: readonly CurvePoint[]; marks: readonly CurveMark[]; ariaLabel: string }) {
    return (
        <div className="h-full w-full" role="img" aria-label={ariaLabel} data-testid="forecast-curve">
            <ParentSize>{({ width, height }) => <Inner points={points} marks={marks} width={width} height={height} />}</ParentSize>
        </div>
    );
}
