'use client';

/**
 * My time (sub-phase 3.4b; docs/porting/maps/3.4.md, "The pages (3.4b)";
 * owner decisions 260 to 268): the person's Monday-to-Sunday week as a grid,
 * one row per item they recorded time on, seven day cells and a total, and
 * the day totals under them.
 *
 *   - A cell holds the sum of that item's entries that day: opening an empty
 *     cell adds an entry, one with one entry changes it, one with several
 *     lists that day's entries in a sheet (each changed or deleted there).
 *   - "Add time" picks an item (the work-item typeahead) and adds an entry;
 *     previous and next week and "This week" move the week, kept in `?week=`.
 *   - The grid is a real `role=grid` with a roving tabindex: the arrow keys,
 *     Home and End move between cells, Enter or Space opens one; every cell
 *     has a label ("ISL-12, Tuesday 24 November, 1h 30m").
 *   - What it offers is `affordances` (asked on the server) and the week's
 *     own `viewer`; nothing here asks a role or a key.
 *
 * Written fresh for Islestone.
 */
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { PageHeader } from '@/components/layout/PageHeader';
import { Sheet } from '@/components/ui/sheet';
import { cn } from '@inflect/ui/lib/cn';
import type { TimeEntryData } from '@/lib/time/entries';
import type { TimeAffordances } from '@/lib/time/types';
import { addDays, weekStartOf } from '@/lib/time/week';
import { formatDuration } from '@/lib/work-items/estimate';

import { TimeEntryDialog, type TimeEntryDraft } from './TimeEntryDialog';
import { useTimeWeek, useTimeWrites } from './data/use-time';
import { formatDay } from './time-format';
import { buildWeekGrid, type WeekCell, type WeekRow } from './week-grid-model';

type DialogState =
    | { kind: 'add'; workItem: { id: string; label: string } | null; date: string }
    | { kind: 'edit'; entry: TimeEntryData; label: string };

export function MyTimeView({ affordances, today, weekStart }: { affordances: TimeAffordances; today: string; weekStart: string }) {
    const t = useTranslations('time.myTime');
    const router = useRouter();
    const pathname = usePathname();
    const [week, setWeek] = useState(weekStart);
    const { data, error, isLoading } = useTimeWeek(affordances.track ? week : null);
    const writes = useTimeWrites();
    const [dialog, setDialog] = useState<DialogState | null>(null);
    const [dayCell, setDayCell] = useState<{ row: WeekRow; cell: WeekCell } | null>(null);
    const [active, setActive] = useState<[number, number] | null>(null);
    const cellRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

    const grid = useMemo(() => (data ? buildWeekGrid(data) : null), [data]);
    const canEdit = affordances.record && (data?.viewer.edit ?? false);

    const goTo = (next: string) => {
        setWeek(next);
        setActive(null);
        router.replace(`${pathname}?week=${next}`, { scroll: false });
    };

    const dayLabel = (date: string, style: 'short' | 'long') => formatDay(date, style);
    const itemLabel = (row: WeekRow) => (row.item.kind === 'visible' ? `${row.item.key} ${row.item.title}` : row.item.kind === 'deleted' ? t('deletedItem') : t('hiddenItem'));
    const itemShort = (row: WeekRow) => (row.item.kind === 'visible' ? row.item.key : row.item.kind === 'deleted' ? t('deletedItem') : t('hiddenItem'));

    const openCell = (row: WeekRow, cell: WeekCell) => {
        if (!canEdit) return;
        if (cell.entries.length === 0) {
            // A deleted item, or one out of sight, takes no new time.
            if (row.item.kind !== 'visible') return;
            setDialog({ kind: 'add', workItem: { id: row.item.id, label: itemLabel(row) }, date: cell.date });
        } else if (cell.entries.length === 1) {
            setDialog({ kind: 'edit', entry: cell.entries[0]!, label: itemShort(row) });
        } else {
            setDayCell({ row, cell });
        }
    };

    const focusCell = (r: number, c: number) => {
        setActive([r, c]);
        cellRefs.current.get(`${r}:${c}`)?.focus();
    };

    const onCellKeyDown = (e: KeyboardEvent<HTMLDivElement>, r: number, c: number, row: WeekRow, cell: WeekCell) => {
        if (e.target !== e.currentTarget || !grid) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openCell(row, cell);
            return;
        }
        const last = grid.rows.length - 1;
        const next: Record<string, [number, number]> = {
            ArrowRight: [r, Math.min(6, c + 1)],
            ArrowLeft: [r, Math.max(0, c - 1)],
            ArrowDown: [Math.min(last, r + 1), c],
            ArrowUp: [Math.max(0, r - 1), c],
            Home: [r, 0],
            End: [r, 6],
        };
        const target = next[e.key];
        if (!target) return;
        e.preventDefault();
        focusCell(target[0], target[1]);
    };

    const save = async (draft: TimeEntryDraft & { minutes: number }, entry?: TimeEntryData): Promise<string | null> => {
        const body = { workDate: draft.workDate, minutes: draft.minutes, billable: draft.billable, description: draft.description.trim() || null };
        const out = entry ? await writes.change(entry, body) : await writes.add({ workItemId: draft.workItem!.id, ...body });
        return out instanceof Error ? (out.reason ?? t('failed')) : null;
    };

    const thisWeek = weekStartOf(today);
    const end = addDays(week, 6);
    const rangeLabel = `${formatDay(week, 'date')} – ${formatDay(end, 'dateYear')}`;
    const [ar, ac] = active ?? [0, Math.max(0, Math.min(6, grid?.days.indexOf(today) ?? 0))];

    return (
        <div className="space-y-section p-4 md:h-full md:overflow-auto" data-testid="my-time">
            <PageHeader
                title={t('title')}
                description={t('description')}
                actions={canEdit ? <Button variant="primary" text={t('addTime')} onClick={() => setDialog({ kind: 'add', workItem: null, date: week <= today && today <= end ? today : week })} /> : undefined}
            />
            <div className="flex flex-wrap items-center gap-tight">
                <Button variant="secondary" size="sm" text={t('previousWeek')} onClick={() => goTo(addDays(week, -7))} />
                <Button variant="secondary" size="sm" text={t('thisWeek')} disabled={week === thisWeek} onClick={() => goTo(thisWeek)} />
                <Button variant="secondary" size="sm" text={t('nextWeek')} onClick={() => goTo(addDays(week, 7))} />
                <h2 className="ml-tight text-sm font-semibold text-content-emphasis" data-testid="my-time-range">
                    {rangeLabel}
                </h2>
            </div>
            {!affordances.track && <p className="text-sm text-content-muted">{t('approveOnly')}</p>}
            {error && (
                <p role="alert" className="text-sm text-content-error">
                    {t('loadFailed')}
                </p>
            )}
            {isLoading && !data && <p className="text-sm text-content-muted">{t('loading')}</p>}
            {grid && (
                <div className="overflow-x-auto">
                    <div role="grid" aria-label={t('gridLabel', { range: rangeLabel })} className="min-w-[44rem] text-sm" data-testid="my-time-grid">
                        <div role="rowgroup">
                            <div role="row" className="grid grid-cols-[minmax(12rem,2fr)_repeat(7,minmax(4rem,1fr))_minmax(4.5rem,1fr)] border-b border-border-subtle text-xs font-medium text-content-muted">
                                <div role="columnheader" className="px-2 py-1">
                                    {t('item')}
                                </div>
                                {grid.days.map((d) => (
                                    <div key={d} role="columnheader" className={cn('px-2 py-1 text-right', d === today && 'text-content-emphasis')}>
                                        {dayLabel(d, 'short')}
                                    </div>
                                ))}
                                <div role="columnheader" className="px-2 py-1 text-right">
                                    {t('total')}
                                </div>
                            </div>
                        </div>
                        <div role="rowgroup">
                            {grid.rows.length === 0 && (
                                <div role="row">
                                    <div role="gridcell" className="px-2 py-4 text-content-muted">
                                        {t('empty')}
                                    </div>
                                </div>
                            )}
                            {grid.rows.map((row, r) => (
                                <div key={row.key} role="row" className="grid grid-cols-[minmax(12rem,2fr)_repeat(7,minmax(4rem,1fr))_minmax(4.5rem,1fr)] border-b border-border-subtle">
                                    <div role="rowheader" className="truncate px-2 py-2 text-content-emphasis" title={itemLabel(row)}>
                                        {itemLabel(row)}
                                    </div>
                                    {row.cells.map((cell, c) => (
                                        <div
                                            key={cell.date}
                                            ref={(el) => {
                                                cellRefs.current.set(`${r}:${c}`, el);
                                            }}
                                            role="gridcell"
                                            tabIndex={r === ar && c === ac ? 0 : -1}
                                            aria-label={t(cell.timerOn ? 'cellLabelTimer' : 'cellLabel', {
                                                item: itemShort(row),
                                                day: dayLabel(cell.date, 'long'),
                                                spent: cell.minutes > 0 ? formatDuration(cell.minutes) : t('noTime'),
                                            })}
                                            data-testid={`my-time-cell-${r}-${c}`}
                                            className={cn(
                                                'px-2 py-2 text-right tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-border-emphasis',
                                                canEdit && 'cursor-pointer hover:bg-bg-subtle',
                                                cell.minutes === 0 && 'text-content-subtle',
                                            )}
                                            onClick={() => {
                                                setActive([r, c]);
                                                openCell(row, cell);
                                            }}
                                            onKeyDown={(e) => onCellKeyDown(e, r, c, row, cell)}
                                        >
                                            {cell.minutes > 0 ? formatDuration(cell.minutes) : '–'}
                                            {cell.timerOn && <span className="ml-1 text-xs text-content-emphasis">{t('timerOn')}</span>}
                                        </div>
                                    ))}
                                    <div role="gridcell" className="px-2 py-2 text-right font-medium tabular-nums">
                                        {formatDuration(row.total)}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div role="rowgroup">
                            <div role="row" className="grid grid-cols-[minmax(12rem,2fr)_repeat(7,minmax(4rem,1fr))_minmax(4.5rem,1fr)] font-medium" data-testid="my-time-totals">
                                <div role="rowheader" className="px-2 py-2">
                                    {t('dayTotals')}
                                </div>
                                {grid.dayTotals.map((m, i) => (
                                    <div key={grid.days[i]} role="gridcell" className="px-2 py-2 text-right tabular-nums">
                                        {formatDuration(m)}
                                    </div>
                                ))}
                                <div role="gridcell" className="px-2 py-2 text-right tabular-nums" data-testid="my-time-week-total">
                                    {formatDuration(grid.total)}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {dialog?.kind === 'add' && (
                <TimeEntryDialog
                    open
                    onOpenChange={(o) => !o && setDialog(null)}
                    title={dialog.workItem ? t('addOn', { item: dialog.workItem.label.split(' ')[0] ?? '' }) : t('addTime')}
                    pickItem={!dialog.workItem}
                    initial={{ workItem: dialog.workItem, workDate: dialog.date, minutes: null, billable: false, description: '' }}
                    onSave={(d) => save(d)}
                />
            )}
            {dialog?.kind === 'edit' && (
                <TimeEntryDialog
                    open
                    onOpenChange={(o) => !o && setDialog(null)}
                    title={t('editOn', { item: dialog.label })}
                    initial={{ workItem: null, workDate: dialog.entry.workDate, minutes: dialog.entry.minutes, billable: dialog.entry.billable, description: dialog.entry.description ?? '' }}
                    onSave={(d) => save(d, dialog.entry)}
                    onDelete={() => {
                        writes.remove(dialog.entry);
                        setDialog(null);
                    }}
                />
            )}
            <Sheet open={dayCell !== null} onOpenChange={(o: boolean) => !o && setDayCell(null)} title={t('dayEntries')}>
                <Sheet.Header title={dayCell ? t('dayEntriesOf', { item: itemShort(dayCell.row), day: dayLabel(dayCell.cell.date, 'long') }) : t('dayEntries')} />
                <Sheet.Body>
                    {dayCell && (
                        <ul className="divide-y divide-border-subtle">
                            {dayCell.cell.entries.map((e) => (
                                <li key={e.id} className="flex flex-wrap items-baseline gap-default py-2 text-sm">
                                    <span className="font-medium tabular-nums">{formatDuration(e.minutes ?? 0)}</span>
                                    {e.billable && <span className="text-xs text-content-muted">{t('billable')}</span>}
                                    {e.description && <span className="w-full whitespace-pre-wrap">{e.description}</span>}
                                    {canEdit && (
                                        <span className="flex gap-tight">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                text={t('edit')}
                                                onClick={() => {
                                                    setDialog({ kind: 'edit', entry: e, label: itemShort(dayCell.row) });
                                                    setDayCell(null);
                                                }}
                                            />
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                text={t('delete')}
                                                onClick={() => {
                                                    writes.remove(e);
                                                    setDayCell(null);
                                                }}
                                            />
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </Sheet.Body>
            </Sheet>
        </div>
    );
}
