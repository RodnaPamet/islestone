'use client';

/**
 * A cycle's burn-up (sub-phase 2.5a, owner decision 65): scope and completed
 * items per day, drawn with the shared chart platform
 * (`@inflect/ui/components/ui/charts`: `TimeSeriesChart`, `Areas`, the axes),
 * and the same points as a table, the accessible fallback, behind a toggle.
 *
 * The package's chart takes its x range from the data, so a current cycle is
 * drawn from its first day to today (docs/porting/maps/2.5.md, "The chart").
 * Islestone-owned, outside the mirrored roots.
 */
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Areas, TimeSeriesChart, XAxis, YAxis, type TimeSeriesDatum } from '@inflect/ui/components/ui/charts';
import type { BurnUpPointData } from '@/lib/work-items/types';

type Datum = TimeSeriesDatum<{ scope: number; completed: number; started: number }>;

const SCOPE_CLASS = 'text-content-muted';
const COMPLETED_CLASS = 'text-content-success';

export function BurnUpChart({ points, truncated, loading }: { points: BurnUpPointData[]; truncated?: boolean; loading?: boolean }) {
    const t = useTranslations('cycles.burnUp');
    const [asTable, setAsTable] = useState(false);
    const tableId = useId();
    const data = useMemo<Datum[]>(
        () => points.map((p) => ({ date: new Date(`${p.date}T00:00:00.000Z`), values: { scope: p.scope, completed: p.completed, started: p.started } })),
        [points],
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
        <section aria-labelledby={`${tableId}-title`} className="space-y-tight" data-testid="burn-up">
            <div className="flex flex-wrap items-center justify-between gap-tight">
                <h2 id={`${tableId}-title`} className="text-sm font-semibold text-content-emphasis">
                    {t('title')}
                </h2>
                <div className="flex items-center gap-default text-xs text-content-muted">
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
                </div>
            </div>
            {truncated && <p className="text-xs text-content-muted">{t('truncated')}</p>}
            {loading ? (
                <p className="text-sm text-content-muted">{t('loading')}</p>
            ) : points.length === 0 ? (
                <p className="text-sm text-content-muted">{t('empty')}</p>
            ) : (
                <>
                    {!asTable && (
                        <div
                            className="relative h-48 w-full"
                            role="img"
                            aria-label={t('aria', { scope: last?.scope ?? 0, completed: last?.completed ?? 0 })}
                        >
                            <TimeSeriesChart
                                data={data}
                                series={series}
                                type="area"
                                tooltipContent={(d) => t('tooltip', { scope: d.values.scope, completed: d.values.completed, started: d.values.started })}
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
                    <div id={`${tableId}-table`} className={asTable ? '' : 'sr-only'}>
                        <table className="w-full text-sm">
                            <caption className="sr-only">{t('caption')}</caption>
                            <thead>
                                <tr className="text-left text-xs text-content-muted">
                                    <th scope="col" className="py-1 pr-default font-medium">{t('date')}</th>
                                    <th scope="col" className="py-1 pr-default font-medium">{t('scope')}</th>
                                    <th scope="col" className="py-1 pr-default font-medium">{t('started')}</th>
                                    <th scope="col" className="py-1 font-medium">{t('completed')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {points.map((p) => (
                                    <tr key={p.date} className="border-t border-border-subtle">
                                        <th scope="row" className="py-1 pr-default text-left font-normal tabular-nums">{p.date}</th>
                                        <td className="py-1 pr-default tabular-nums">{p.scope}</td>
                                        <td className="py-1 pr-default tabular-nums">{p.started}</td>
                                        <td className="py-1 tabular-nums">{p.completed}</td>
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
