'use client';

/**
 * A cycle's burn-up (sub-phase 2.5a, owner decision 65): scope and completed
 * items per day, drawn with the shared chart platform
 * (`@inflect/ui/components/ui/charts`: `TimeSeriesChart`, `Areas`, the axes),
 * and the same points as a table, the accessible fallback, behind a toggle.
 *
 * The package's chart takes its x range from the data, so a current cycle is
 * drawn from its first day to today (docs/porting/maps/2.5.md, "The chart").
 * From 3.4a (owner decision 259) it counts items, or sums points or hours
 * when the cycle's team estimates in them: the switch offers the measures
 * the server names, and the summary line says how many in-scope items carry
 * no estimate. Hours arrive as minutes and are drawn as hours.
 * Islestone-owned, outside the mirrored roots.
 */
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState, type ReactNode } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Areas, TimeSeriesChart, XAxis, YAxis, type TimeSeriesDatum } from '@inflect/ui/components/ui/charts';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { formatDuration } from '@/lib/work-items/estimate';
import type { BurnUpMeasure, BurnUpPointData } from '@/lib/work-items/types';

type Datum = TimeSeriesDatum<{ scope: number; completed: number; started: number }>;

const SCOPE_CLASS = 'text-content-muted';
const COMPLETED_CLASS = 'text-content-success';

export interface BurnUpChartProps {
    points: BurnUpPointData[];
    truncated?: boolean;
    loading?: boolean;
    /** What `points` count (3.4a); items when left out. */
    measure?: BurnUpMeasure;
    /** The measure the person chose (the switch's selection), when it differs from the one shown while it loads. */
    selected?: BurnUpMeasure;
    /** The measures the cycle offers; the switch shows when there is more than one. */
    measures?: readonly BurnUpMeasure[];
    onMeasure?: (measure: BurnUpMeasure) => void;
    /** The chosen measure was refused (the team stopped estimating in it). */
    unavailable?: boolean;
    /** A dashboard widget's title (3.6d), in place of "Burn-up". */
    heading?: string;
    /** A dashboard widget's own buttons (3.6d), at the end of the header. */
    actions?: ReactNode;
    /** Fill the parent's height (a dashboard widget's place on the grid, 3.6d). */
    fill?: boolean;
}

export function BurnUpChart({ points, truncated, loading, measure = 'items', selected, measures = ['items'], onMeasure, unavailable, heading, actions, fill = false }: BurnUpChartProps) {
    const t = useTranslations('cycles.burnUp');
    const [asTable, setAsTable] = useState(false);
    const tableId = useId();
    // Hours arrive as minutes: drawn as hours, read in the table as "2h 30m".
    const scale = measure === 'hours' ? 1 / 60 : 1;
    const show = (n: number) => (measure === 'hours' ? formatDuration(n) : String(n));
    const data = useMemo<Datum[]>(
        () => points.map((p) => ({ date: new Date(`${p.date}T00:00:00.000Z`), values: { scope: p.scope * scale, completed: p.completed * scale, started: p.started * scale } })),
        [points, scale],
    );
    const series = useMemo(
        () => [
            { id: 'scope', isActive: true, valueAccessor: (d: Datum) => d.values.scope, colorClassName: SCOPE_CLASS },
            { id: 'completed', isActive: true, valueAccessor: (d: Datum) => d.values.completed, colorClassName: COMPLETED_CLASS },
        ],
        [],
    );
    const last = points.at(-1);

    return (
        <section aria-labelledby={`${tableId}-title`} className={fill ? 'flex h-full min-h-0 flex-col gap-tight' : 'space-y-tight'} data-testid="burn-up">
            <div className="flex flex-wrap items-center justify-between gap-tight">
                <h2 id={`${tableId}-title`} className="text-sm font-semibold text-content-emphasis">
                    {heading ?? t('title')}
                </h2>
                <div className="flex items-center gap-default text-xs text-content-muted">
                    {measures.length > 1 && onMeasure && (
                        <ToggleGroup
                            ariaLabel={t('measure.label')}
                            options={measures.map((m) => ({ value: m, label: t(`measure.${m}`) }))}
                            selected={selected ?? measure}
                            selectAction={(v) => onMeasure(v as BurnUpMeasure)}
                        />
                    )}
                    <span className="flex items-center gap-1">
                        <span aria-hidden className={`inline-block size-2 rounded-full bg-current ${SCOPE_CLASS}`} />
                        {t('scope')}
                    </span>
                    <span className="flex items-center gap-1">
                        <span aria-hidden className={`inline-block size-2 rounded-full bg-current ${COMPLETED_CLASS}`} />
                        {t('completed')}
                    </span>
                    {points.length > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            text={asTable ? t('showChart') : t('showTable')}
                            aria-controls={`${tableId}-table`}
                            aria-expanded={asTable}
                            onClick={() => setAsTable((v) => !v)}
                        />
                    )}
                    {actions}
                </div>
            </div>
            {truncated && <p className="text-xs text-content-muted">{t('truncated')}</p>}
            {measure !== 'items' && last && (
                <p className="text-xs text-content-muted" data-testid="burn-up-summary">
                    {t(`measure.summary.${measure}`, { scope: measure === 'hours' ? formatDuration(last.scope) : last.scope, unestimated: last.unestimated ?? 0 })}
                </p>
            )}
            {unavailable && <p className="text-xs text-content-muted">{t('measure.unavailable')}</p>}
            {loading ? (
                <p className="text-sm text-content-muted">{t('loading')}</p>
            ) : points.length === 0 ? (
                <p className="text-sm text-content-muted">{t('empty')}</p>
            ) : (
                <>
                    {!asTable && (
                        <div
                            className={fill ? 'relative min-h-0 w-full flex-1' : 'relative h-48 w-full'}
                            role="img"
                            aria-label={t(`measure.aria.${measure}`, { scope: show(last?.scope ?? 0), completed: show(last?.completed ?? 0) })}
                        >
                            <TimeSeriesChart
                                data={data}
                                series={series}
                                type="area"
                                tooltipContent={(d) =>
                                    t('tooltip', {
                                        scope: show(Math.round(d.values.scope / scale)),
                                        completed: show(Math.round(d.values.completed / scale)),
                                        started: show(Math.round(d.values.started / scale)),
                                    })
                                }
                            >
                                <YAxis showGridLines />
                                <XAxis />
                                <Areas
                                    seriesStyles={[
                                        { id: 'scope', lineClassName: SCOPE_CLASS },
                                        { id: 'completed', lineClassName: COMPLETED_CLASS },
                                    ]}
                                />
                            </TimeSeriesChart>
                        </div>
                    )}
                    <div id={`${tableId}-table`} className={asTable ? (fill ? 'min-h-0 flex-1 overflow-auto' : '') : 'sr-only'}>
                        <table className="w-full text-sm">
                            <caption className="sr-only">{t('caption')}</caption>
                            <thead>
                                <tr className="text-left text-xs text-content-muted">
                                    <th scope="col" className="py-1 pr-default font-medium">{t('date')}</th>
                                    <th scope="col" className="py-1 pr-default font-medium">{t('scope')}</th>
                                    <th scope="col" className="py-1 pr-default font-medium">{t('started')}</th>
                                    <th scope="col" className={`py-1 font-medium${measure !== 'items' ? ' pr-default' : ''}`}>{t('completed')}</th>
                                    {measure !== 'items' && <th scope="col" className="py-1 font-medium">{t('measure.unestimated')}</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {points.map((p) => (
                                    <tr key={p.date} className="border-t border-border-subtle">
                                        <th scope="row" className="py-1 pr-default text-left font-normal tabular-nums">{p.date}</th>
                                        <td className="py-1 pr-default tabular-nums">{show(p.scope)}</td>
                                        <td className="py-1 pr-default tabular-nums">{show(p.started)}</td>
                                        <td className={`py-1 tabular-nums${measure !== 'items' ? ' pr-default' : ''}`}>{show(p.completed)}</td>
                                        {measure !== 'items' && <td className="py-1 tabular-nums">{p.unestimated ?? 0}</td>}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </section>
    );
}
