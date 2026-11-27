'use client';

/**
 * One chart of the Analytics page with its table (sub-phase 3.6a;
 * docs/porting/maps/3.6.md, "What a widget shows": every chart has its table,
 * the accessible fallback, `BurnUpChart`'s pattern). The section holds the
 * heading, the legend, the "Show table" switch and the states every read has:
 * loading, failed, too large to draw (the count, never a cut chart) and
 * nothing to draw. The table is always in the document (`sr-only` while the
 * chart shows), so a screen reader reads the numbers either way.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useId, useState, type ReactNode } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import type { AnalyticsTooLargeDetails } from '@/lib/analytics/types';

export interface LegendEntry {
    label: string;
    className: string;
}

export interface ChartSectionProps {
    title: string;
    testId: string;
    legend?: readonly LegendEntry[];
    /** A line under the heading: a summary of the figures. */
    summary?: ReactNode;
    loading: boolean;
    failed: boolean;
    tooLarge: AnalyticsTooLargeDetails | null;
    empty: boolean;
    /** The chart, labelled by the caller (`role="img"` and an `aria-label` summarising it). */
    chart: () => ReactNode;
    /** The same figures as a table, with its own caption. */
    table: () => ReactNode;
    /** Controls beside the legend (a measure switch). */
    controls?: ReactNode;
}

export function ChartSection({ title, testId, legend = [], summary, loading, failed, tooLarge, empty, chart, table, controls }: ChartSectionProps) {
    const t = useTranslations('analytics.chart');
    const [asTable, setAsTable] = useState(false);
    const id = useId();
    const ready = !loading && !failed && !tooLarge && !empty;
    return (
        <section aria-labelledby={`${id}-title`} className="space-y-tight rounded-lg border border-border-default p-4" data-testid={testId}>
            <div className="flex flex-wrap items-center justify-between gap-tight">
                <h2 id={`${id}-title`} className="text-sm font-semibold text-content-emphasis">
                    {title}
                </h2>
                <div className="flex flex-wrap items-center gap-default text-xs text-content-muted">
                    {controls}
                    {legend.map((l) => (
                        <span key={l.label} className="flex items-center gap-1">
                            <span aria-hidden className={`inline-block size-2 rounded-full bg-current ${l.className}`} />
                            {l.label}
                        </span>
                    ))}
                    {ready && (
                        <Button
                            variant="ghost"
                            size="sm"
                            text={asTable ? t('showChart') : t('showTable')}
                            aria-controls={`${id}-table`}
                            aria-expanded={asTable}
                            onClick={() => setAsTable((v) => !v)}
                        />
                    )}
                </div>
            </div>
            {summary && ready && <p className="text-xs text-content-muted">{summary}</p>}
            {loading ? (
                <p className="text-sm text-content-muted">{t('loading')}</p>
            ) : failed ? (
                <p role="alert" className="text-sm text-content-error">
                    {t('failed')}
                </p>
            ) : tooLarge ? (
                <p role="status" className="text-sm text-content-muted" data-testid={`${testId}-too-large`}>
                    {t(`tooLarge.${tooLarge.what}`, { count: tooLarge.count, limit: tooLarge.limit })}
                </p>
            ) : empty ? (
                <p className="text-sm text-content-muted">{t('empty')}</p>
            ) : (
                <>
                    {!asTable && <div className="relative h-56 w-full">{chart()}</div>}
                    <div id={`${id}-table`} className={asTable ? 'max-h-80 overflow-auto' : 'sr-only'}>
                        {table()}
                    </div>
                </>
            )}
        </section>
    );
}

/** A plain figures table: a caption, column headings and rows whose first cell heads the row. */
export function FiguresTable({ caption, columns, rows }: { caption: string; columns: readonly string[]; rows: ReadonlyArray<readonly [string, ...Array<string | number>]> }) {
    return (
        <table className="w-full text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead>
                <tr className="text-left text-xs text-content-muted">
                    {columns.map((c) => (
                        <th key={c} scope="col" className="py-1 pr-default font-medium">
                            {c}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.map(([head, ...cells], i) => (
                    <tr key={`${head}-${i}`} className="border-t border-border-subtle">
                        <th scope="row" className="py-1 pr-default text-left font-normal tabular-nums">
                            {head}
                        </th>
                        {cells.map((cell, j) => (
                            <td key={j} className="py-1 pr-default tabular-nums">
                                {cell}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
