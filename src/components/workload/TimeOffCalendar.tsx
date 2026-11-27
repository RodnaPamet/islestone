'use client';

/**
 * One person's time off as a grid of dates, a month at a time (sub-phase 3.5a;
 * docs/porting/maps/3.5.md, "The page"; owner decisions 286 to 288). A real
 * `role=grid` with a roving tabindex (arrows, Home and End within a week);
 * each date shows its hours or "Whole day", and its type when the server sent
 * one (the person, or a holder of `workload.manage`; decision 287). A writer
 * opens a date to change it in place, or an empty date to add time off from
 * it; "Add time off" opens the range dialog. Removing goes through the undo
 * toast (`use-time-off.ts`).
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useRef, useState, type KeyboardEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { cn } from '@inflect/ui/lib/cn';
import { formatDay } from '@/components/time/time-format';
import type { TimeOffDayData } from '@/lib/workload/types';

import { AddTimeOffDialog, EditTimeOffDialog } from './TimeOffDialogs';
import { useTimeOff } from './data/use-time-off';
import { addMonths, hoursText, monthEndOf, monthGrid, monthStartOf, rovingTarget } from './workload-model';

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export function TimeOffCalendar({
    userId,
    personId,
    today,
    canWrite,
    idPrefix,
}: {
    /** Another member's dates; one's own when absent. */
    userId?: string;
    /** The person whose dates these are, to tell "added for you" apart. */
    personId: string;
    today: string;
    canWrite: boolean;
    idPrefix: string;
}) {
    const t = useTranslations('workload.timeOff');
    const tType = useTranslations('workload.timeOff.type');
    const [month, setMonth] = useState(monthStartOf(today));
    const [active, setActive] = useState<[number, number] | null>(null);
    const [adding, setAdding] = useState<string | null>(null);
    const [editing, setEditing] = useState<TimeOffDayData | null>(null);
    const refs = useRef(new Map<string, HTMLDivElement>());
    const { data, error, isLoading } = useTimeOff(month, monthEndOf(month), userId);
    const grid = monthGrid(month, data?.days ?? []);
    const monthLabel = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${month}T00:00:00Z`));

    const valueOf = (d: TimeOffDayData) => (d.minutes === null ? t('wholeDay') : hoursText(d.minutes));
    const open = (date: string, off: TimeOffDayData | null) => {
        if (!canWrite) return;
        if (off) setEditing(off);
        else setAdding(date);
    };

    const fallback = (): [number, number] => {
        for (let w = 0; w < grid.length; w++) for (let i = 0; i < 7; i++) if (grid[w]![i]!.date === today) return [w, i];
        return [0, grid[0]!.findIndex((c) => c.inMonth)];
    };
    const [aw, ad] = active ?? fallback();

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, w: number, i: number, date: string, off: TimeOffDayData | null) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open(date, off);
            return;
        }
        const target = rovingTarget(e.key, w, i, grid.length, 7);
        if (!target) return;
        e.preventDefault();
        setActive(target);
        refs.current.get(`${target[0]}:${target[1]}`)?.focus();
    };

    return (
        <div className="space-y-default">
            <div className="flex flex-wrap items-center gap-tight">
                <Button variant="secondary" size="sm" text={t('previousMonth')} onClick={() => { setMonth(addMonths(month, -1)); setActive(null); }} />
                <Button variant="secondary" size="sm" text={t('nextMonth')} onClick={() => { setMonth(addMonths(month, 1)); setActive(null); }} />
                <h3 className="ml-tight text-sm font-semibold text-content-emphasis" data-testid={`${idPrefix}-month`}>
                    {monthLabel}
                </h3>
                {canWrite && <Button id={`${idPrefix}-add`} variant="primary" size="sm" text={t('add')} onClick={() => setAdding(today >= month && today <= monthEndOf(month) ? today : month)} className="ml-auto" />}
            </div>
            {error && (
                <p role="alert" className="text-sm text-content-error">
                    {t('loadFailed')}
                </p>
            )}
            {isLoading && !data && <p className="text-sm text-content-muted">{t('loading')}</p>}
            <div role="grid" aria-label={t('gridLabel', { month: monthLabel })} className="text-sm" data-testid={`${idPrefix}-grid`}>
                <div role="row" className="grid grid-cols-7 border-b border-border-subtle text-xs font-medium text-content-muted">
                    {WEEKDAYS.map((d) => (
                        <div key={d} role="columnheader" className="px-1 py-1">
                            {t(`weekday.${d}`)}
                        </div>
                    ))}
                </div>
                {grid.map((week, w) => (
                    <div key={week[0]!.date} role="row" className="grid grid-cols-7 border-b border-border-subtle">
                        {week.map((cell, i) => {
                            const off = cell.timeOff;
                            const label = off
                                ? t(off.type ? 'cellLabelTyped' : 'cellLabel', { date: formatDay(cell.date, 'long'), value: valueOf(off), type: off.type ? tType(off.type) : '' })
                                : t('cellNone', { date: formatDay(cell.date, 'long') });
                            return (
                                <div
                                    key={cell.date}
                                    ref={(el) => {
                                        if (el) refs.current.set(`${w}:${i}`, el);
                                        else refs.current.delete(`${w}:${i}`);
                                    }}
                                    role="gridcell"
                                    tabIndex={w === aw && i === ad ? 0 : -1}
                                    aria-label={label}
                                    onFocus={() => setActive([w, i])}
                                    onClick={() => open(cell.date, off)}
                                    onKeyDown={(e) => onKeyDown(e, w, i, cell.date, off)}
                                    className={cn(
                                        'min-h-[3.5rem] px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-border-emphasis',
                                        !cell.inMonth && 'text-content-muted',
                                        canWrite && 'cursor-pointer',
                                        off && 'bg-bg-subtle',
                                        cell.date === today && 'font-semibold',
                                    )}
                                    data-testid={`${idPrefix}-day-${cell.date}`}
                                >
                                    <span aria-hidden="true" className="block text-xs">
                                        {Number(cell.date.slice(8))}
                                    </span>
                                    {off && (
                                        <span aria-hidden="true" className="block text-xs text-content-emphasis">
                                            {valueOf(off)}
                                            {off.type && <span className="block text-content-muted">{tType(off.type)}</span>}
                                            {off.updatedByUserId !== personId && <span className="block text-content-muted">{t('addedForPerson')}</span>}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
            {adding && <AddTimeOffDialog open onOpenChange={(o) => !o && setAdding(null)} userId={userId} initialFrom={adding} />}
            {editing && <EditTimeOffDialog open onOpenChange={(o) => !o && setEditing(null)} userId={userId} day={editing} />}
        </div>
    );
}
