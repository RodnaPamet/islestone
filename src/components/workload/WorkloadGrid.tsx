'use client';

/**
 * The Workload page's grid (sub-phase 3.5a: capacity per person per week;
 * docs/porting/maps/3.5.md, "The page"; decisions 284 to 286 and 297). A real
 * `role=grid` on a `div`: rows people, columns weeks, Islestone's own roving
 * tabindex with arrow, Home and End keys (the pattern of My time's grid and
 * `CalendarMonth`), the pure layout in `workload-model.ts`. Each cell shows the
 * week's capacity and, when time off removed some, a mark and its hours; the
 * text carries the meaning, never a colour alone. 3.5b adds allocation and the
 * over-capacity flags to the same cells.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useRef, useState, type KeyboardEvent } from 'react';

import { cn } from '@inflect/ui/lib/cn';
import { formatDay } from '@/components/time/time-format';

import { hoursText, rovingTarget, type CapacityRow } from './workload-model';

export function WorkloadGrid({ weeks, rows, rangeLabel }: { weeks: readonly string[]; rows: readonly CapacityRow[]; rangeLabel: string }) {
    const t = useTranslations('workload.grid');
    const [active, setActive] = useState<[number, number]>([0, 0]);
    const refs = useRef(new Map<string, HTMLDivElement>());

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, r: number, c: number) => {
        if (e.target !== e.currentTarget) return;
        const target = rovingTarget(e.key, r, c, rows.length, weeks.length);
        if (!target) return;
        e.preventDefault();
        setActive(target);
        refs.current.get(`${target[0]}:${target[1]}`)?.focus();
    };

    const [ar, ac] = [Math.min(active[0], Math.max(0, rows.length - 1)), Math.min(active[1], Math.max(0, weeks.length - 1))];

    return (
        <div className="overflow-x-auto">
            <div role="grid" aria-label={t('gridLabel', { range: rangeLabel })} aria-rowcount={rows.length + 1} className="min-w-[44rem] text-sm" data-testid="workload-grid">
                <div role="rowgroup">
                    <div role="row" className="flex border-b border-border-subtle text-xs font-medium text-content-muted">
                        <div role="columnheader" className="w-44 shrink-0 px-2 py-1">
                            {t('person')}
                        </div>
                        {weeks.map((w) => (
                            <div key={w} role="columnheader" className="min-w-[5.5rem] flex-1 px-2 py-1 text-right">
                                {t('weekOf', { date: formatDay(w, 'date') })}
                            </div>
                        ))}
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
                        <div key={row.userId} role="row" className="flex border-b border-border-subtle" data-testid={`workload-row-${row.userId}`}>
                            <div role="rowheader" className="w-44 shrink-0 truncate px-2 py-2 text-content-emphasis">
                                {row.name}
                                {!row.active && <span className="ml-tight text-xs text-content-muted">{t('inactive')}</span>}
                            </div>
                            {row.cells.map((cell, c) => {
                                const capacity = hoursText(cell.capacityMinutes);
                                const label =
                                    cell.timeOffDays.length > 0
                                        ? t('cellLabelOff', { name: row.name, week: formatDay(cell.week, 'dateYear'), capacity, weekly: hoursText(cell.weeklyMinutes), count: cell.timeOffDays.length, off: hoursText(cell.timeOffMinutes) })
                                        : t('cellLabel', { name: row.name, week: formatDay(cell.week, 'dateYear'), capacity, weekly: hoursText(cell.weeklyMinutes) });
                                return (
                                    <div
                                        key={cell.week}
                                        ref={(el) => {
                                            if (el) refs.current.set(`${r}:${c}`, el);
                                            else refs.current.delete(`${r}:${c}`);
                                        }}
                                        role="gridcell"
                                        tabIndex={r === ar && c === ac ? 0 : -1}
                                        aria-label={label}
                                        onFocus={() => setActive([r, c])}
                                        onKeyDown={(e) => onKeyDown(e, r, c)}
                                        className={cn(
                                            'min-w-[5.5rem] flex-1 px-2 py-2 text-right tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-border-emphasis',
                                            cell.capacityMinutes === 0 && 'text-content-muted',
                                        )}
                                        data-testid={`workload-cell-${row.userId}-${cell.week}`}
                                    >
                                        <span aria-hidden="true">{capacity}</span>
                                        {cell.timeOffDays.length > 0 && (
                                            <span aria-hidden="true" className="block text-xs text-content-muted">
                                                {t('timeOffMark', { off: hoursText(cell.timeOffMinutes) })}
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
