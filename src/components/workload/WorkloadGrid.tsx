'use client';

/**
 * The Workload page's grid (sub-phases 3.5a and 3.5b; docs/porting/maps/3.5.md,
 * "The page"; decisions 284 to 286 and 292 to 297). A real `role=grid` on a
 * `div`: rows people (then the "Unassigned" row), columns weeks, Islestone's
 * own roving tabindex with arrow, Home and End keys (the pattern of My time's
 * grid and `CalendarMonth`), the pure layout in `workload-model.ts`.
 *
 * Each cell shows "34h / 40h", a bar whose width and colour (`useHeatScale`)
 * follow allocated ÷ capacity, a red edge and "Over by 6h" when over, the
 * filtered project's or team's share as a second figure, and a mark for time
 * off; the text always carries the meaning, colour never alone. Enter, Space
 * or a click opens the week's items. A row ends with what could not be
 * placed: No dates, Not estimated, Points work and Later.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useRef, useState, type KeyboardEvent } from 'react';

import { useHeatScale } from '@inflect/ui/components/ui/charts';
import { cn } from '@inflect/ui/lib/cn';
import { formatDay } from '@/components/time/time-format';

import { fillRatio, hoursText, rovingTarget, type WorkloadCell, type WorkloadRow } from './workload-model';

export interface WorkloadGridProps {
    weeks: readonly string[];
    rows: readonly WorkloadRow[];
    rangeLabel: string;
    /** The filtered project's or team's name, when a filter reports a share. */
    shareScope?: string | null;
    /** Open the week's items (the cell sheet). */
    onOpenCell?: (row: WorkloadRow, cell: WorkloadCell) => void;
}

const HEAT_DOMAIN: [number, number] = [0, 1];

export function WorkloadGrid({ weeks, rows, rangeLabel, shareScope = null, onOpenCell }: WorkloadGridProps) {
    const t = useTranslations('workload.grid');
    const heat = useHeatScale({ domain: HEAT_DOMAIN, idPrefix: 'workload' });
    const [active, setActive] = useState<[number, number]>([0, 0]);
    const refs = useRef(new Map<string, HTMLDivElement>());

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, r: number, c: number) => {
        if (e.target !== e.currentTarget) return;
        if ((e.key === 'Enter' || e.key === ' ') && onOpenCell) {
            e.preventDefault();
            const row = rows[r];
            const cell = row?.cells[c];
            if (row && cell) onOpenCell(row, cell);
            return;
        }
        const target = rovingTarget(e.key, r, c, rows.length, weeks.length);
        if (!target) return;
        e.preventDefault();
        setActive(target);
        refs.current.get(`${target[0]}:${target[1]}`)?.focus();
    };

    const [ar, ac] = [Math.min(active[0], Math.max(0, rows.length - 1)), Math.min(active[1], Math.max(0, weeks.length - 1))];

    const labelOf = (row: WorkloadRow, cell: WorkloadCell): string => {
        const week = formatDay(cell.week, 'dateYear');
        const allocated = hoursText(cell.allocatedMinutes);
        let label = row.unassigned
            ? t('cellLabelUnassigned', { week, allocated })
            : t('cellLabel', { name: row.name, week, allocated, capacity: hoursText(cell.capacityMinutes) });
        if (cell.overMinutes > 0) label += t('cellLabelOver', { over: hoursText(cell.overMinutes) });
        if (cell.timeOffDays.length > 0) label += t('cellLabelOff', { count: cell.timeOffDays.length, off: hoursText(cell.timeOffMinutes) });
        if (cell.shareMinutes !== null && shareScope) label += t('cellLabelShare', { share: hoursText(cell.shareMinutes), scope: shareScope });
        return label;
    };

    return (
        <div className="overflow-x-auto">
            <div role="grid" aria-label={t('gridLabel', { range: rangeLabel })} aria-rowcount={rows.length + 1} className="min-w-[52rem] text-sm" data-testid="workload-grid">
                <div role="rowgroup">
                    <div role="row" className="flex border-b border-border-subtle text-xs font-medium text-content-muted">
                        <div role="columnheader" className="w-44 shrink-0 px-2 py-1">
                            {t('person')}
                        </div>
                        {weeks.map((w) => (
                            <div key={w} role="columnheader" className="min-w-[6rem] flex-1 px-2 py-1 text-right">
                                {t('weekOf', { date: formatDay(w, 'date') })}
                            </div>
                        ))}
                        <div role="columnheader" className="w-40 shrink-0 px-2 py-1">
                            {t('figures')}
                        </div>
                    </div>
                </div>
                <div role="rowgroup">
                    {rows.length === 0 && (
                        <div role="row">
                            <div role="gridcell" className="px-2 py-4 text-content-muted">
                                {t('empty')}
                            </div>
                        </div>
                    )}
                    {rows.map((row, r) => (
                        <div key={row.userId} role="row" className={cn('flex border-b border-border-subtle', row.unassigned && 'bg-bg-muted')} data-testid={`workload-row-${row.userId}`}>
                            <div role="rowheader" className="w-44 shrink-0 truncate px-2 py-2 text-content-emphasis">
                                {row.name}
                                {!row.active && <span className="ml-tight text-xs text-content-muted">{t('inactive')}</span>}
                                {row.unassigned && <span className="block text-xs text-content-muted">{t('unassignedNote')}</span>}
                            </div>
                            {row.cells.map((cell, c) => {
                                const over = cell.overMinutes > 0;
                                const ratio = fillRatio(cell);
                                return (
                                    <div
                                        key={cell.week}
                                        ref={(el) => {
                                            if (el) refs.current.set(`${r}:${c}`, el);
                                            else refs.current.delete(`${r}:${c}`);
                                        }}
                                        role="gridcell"
                                        tabIndex={r === ar && c === ac ? 0 : -1}
                                        aria-label={labelOf(row, cell)}
                                        onFocus={() => setActive([r, c])}
                                        onKeyDown={(e) => onKeyDown(e, r, c)}
                                        onClick={() => onOpenCell?.(row, cell)}
                                        className={cn(
                                            'min-w-[6rem] flex-1 cursor-pointer border-l-2 border-transparent px-2 py-2 text-right tabular-nums outline-none hover:bg-bg-muted focus-visible:ring-2 focus-visible:ring-border-emphasis',
                                            over && 'border-l-border-error',
                                            !row.unassigned && cell.capacityMinutes === 0 && cell.allocatedMinutes === 0 && 'text-content-muted',
                                        )}
                                        data-testid={`workload-cell-${row.userId}-${cell.week}`}
                                        data-over={over ? 'true' : undefined}
                                    >
                                        <span aria-hidden="true" className="block">
                                            {row.unassigned ? hoursText(cell.allocatedMinutes) : t('cellText', { allocated: hoursText(cell.allocatedMinutes), capacity: hoursText(cell.capacityMinutes) })}
                                        </span>
                                        {!row.unassigned && (
                                            <span aria-hidden="true" className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
                                                <span
                                                    className={cn('block h-full rounded-full', over && 'bg-content-error')}
                                                    style={{ width: `${Math.round(ratio * 100)}%`, ...(over ? {} : { backgroundColor: heat.colorFor(ratio) }) }}
                                                />
                                            </span>
                                        )}
                                        {over && (
                                            <span aria-hidden="true" className="block text-xs font-medium text-content-error">
                                                {t('overBy', { over: hoursText(cell.overMinutes) })}
                                            </span>
                                        )}
                                        {cell.shareMinutes !== null && shareScope && (
                                            <span aria-hidden="true" className="block text-xs text-content-muted">
                                                {t('share', { share: hoursText(cell.shareMinutes), allocated: hoursText(cell.allocatedMinutes), scope: shareScope })}
                                            </span>
                                        )}
                                        {cell.timeOffDays.length > 0 && (
                                            <span aria-hidden="true" className="block text-xs text-content-muted">
                                                {t('timeOffMark', { off: hoursText(cell.timeOffMinutes) })}
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                            <div role="gridcell" className="w-40 shrink-0 space-y-0.5 px-2 py-2 text-xs text-content-muted" data-testid={`workload-figures-${row.userId}`}>
                                {row.noDates.count > 0 && <span className="block">{t('noDates', { count: row.noDates.count, hours: hoursText(row.noDates.minutes) })}</span>}
                                {row.notEstimated > 0 && <span className="block">{t('notEstimated', { count: row.notEstimated })}</span>}
                                {row.pointsWork.count > 0 && <span className="block">{t('pointsWork', { count: row.pointsWork.count, points: row.pointsWork.points })}</span>}
                                {row.later > 0 && <span className="block">{t('later', { hours: hoursText(row.later) })}</span>}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
