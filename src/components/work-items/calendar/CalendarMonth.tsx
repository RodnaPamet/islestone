'use client';

/**
 * The calendar view's month grid (roadmap 3.3a; owner decision 242).
 *
 * Copied from inflect-compliance's `<CalendarMonth>`
 * (`src/app/t/[tenantSlug]/(app)/calendar/_components/CalendarMonth.tsx` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, BUSL-1.1, licensor Inflect Ltd.;
 * ADR 0001 D1) and adapted (PROVENANCE.md). Kept from the source:
 *
 *   - a pure HTML and CSS grid, seven columns and a FIXED six rows (42
 *     cells), so the height never jumps between months; the week start from
 *     the mirrored `week-start.ts`, shared with the date picker;
 *   - the full grid tree: `role=grid` (on a `div`: axe 4.12 refuses the
 *     role on the source's `section`) → `rowgroup` → `row` →
 *     `columnheader` / `gridcell`, rows `display: contents`;
 *   - a roving tabindex (one tabbable cell: the selected day, else today,
 *     else the month's first), arrow, Home and End keys moving DOM focus,
 *     Enter and Space selecting the day, keys aimed at a child never taken;
 *   - a per-cell `aria-label` restating what the cell shows as text, and
 *     `aria-current="date"` on today, which is the SERVER's day;
 *   - "+N more" past a few entries, selecting the day; a click anywhere in a
 *     cell outside a link or button selects it.
 *
 * Changed for Islestone: work-item chips ("ISL-12 Title", toned by state
 * category, closed items struck through) instead of category dots, each
 * opening the item's sheet, with a "Move to date…" button beside a chip the
 * person may move (the chip's one action besides opening it); chips dragged to another day (pragmatic drag and
 * drop, `use-calendar-dnd.ts`); cycle bands across the top of each week row;
 * diamonds for milestones and project due dates, linking to them; holidays
 * and non-working days of the scope's working calendar shaded; no
 * create-on-a-day affordance; `monthGridRange` moved to the pure
 * `calendar-model.ts`; Islestone's tokens and copy (`workItems.calendar.*`).
 */
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { cn } from '@inflect/ui/lib/cn';
import { formatDateLong, formatMonthYear, formatWeekdayShort } from '@inflect/ui/lib/format-date';
import { WEEK_STARTS_ON } from '@/components/ui/date-picker/week-start';
import type { CalendarCycle, CalendarItem } from '@/lib/work-items/calendar';

import { GRID_CELLS, isClosed, monthGridRange, type CalendarMarker } from './calendar-model';
import { useCalendarDropMonitor, useDraggableChip, useDropDay } from './use-calendar-dnd';

const DAY_MS = 86_400_000;

export interface CalendarMonthProps {
    /** Any day of the month to render (UTC). */
    month: Date;
    /** The day to ring as today, from the server (today in the scope calendar's zone). */
    todayYmd: string;
    items: ReadonlyMap<string, CalendarItem[]>;
    cycles: ReadonlyMap<string, CalendarCycle[]>;
    markers: ReadonlyMap<string, CalendarMarker[]>;
    dayKind: (ymd: string) => 'holiday' | 'nonWorking' | null;
    /** Chips per cell before "+N more". Default 3. */
    maxChipsPerDay?: number;
    selectedYmd?: string | null;
    onSelectDate?: (ymd: string) => void;
    onOpenItem: (id: string) => void;
    /** The chips a person may move (drag, or "Move to date…"). */
    movable: ReadonlySet<string>;
    onMoveRequest: (id: string) => void;
    onDropItem: (id: string, ymd: string) => void;
    markerHref: (marker: CalendarMarker) => string;
    className?: string;
}

// Weekday column headers: 2023-01-01 (UTC) is a Sunday, so offsetting by
// WEEK_STARTS_ON walks the labels to the configured first day.
const WEEKDAY_HEADERS = Array.from({ length: 7 }, (_, i) => formatWeekdayShort(new Date(Date.UTC(2023, 0, 1 + ((i + WEEK_STARTS_ON) % 7)))));

const CATEGORY_DOT: Record<CalendarItem['stateCategory'], string> = {
    BACKLOG: 'bg-[var(--content-muted)]',
    UNSTARTED: 'bg-[var(--content-muted)]',
    STARTED: 'bg-[var(--content-info)]',
    DONE: 'bg-[var(--content-success)]',
    CANCELLED: 'bg-[var(--content-warning)]',
};

function Chip({
    item,
    ymd,
    movable,
    onOpen,
    onMove,
}: {
    item: CalendarItem;
    ymd: string;
    movable: boolean;
    onOpen: (id: string) => void;
    onMove: (id: string) => void;
}) {
    const tChip = useTranslations('workItems.calendar.chip');
    const tCategory = useTranslations('workItems');
    const ref = React.useRef<HTMLLIElement>(null);
    useDraggableChip(ref, item.id, ymd, movable);
    const closed = isClosed(item.stateCategory);
    return (
        <li ref={ref} data-item-id={item.id} data-movable={movable || undefined} className={cn('group/chip flex min-w-0 items-center gap-0.5', movable && 'cursor-grab')}>
            <button
                type="button"
                onClick={() => onOpen(item.id)}
                aria-label={tChip('open', { key: item.key, title: item.title, state: tCategory(`category.${item.stateCategory}`) })}
                className={cn(
                    'flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] leading-tight',
                    'hover:bg-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                    closed ? 'text-content-muted line-through' : 'text-content-default',
                )}
            >
                <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', CATEGORY_DOT[item.stateCategory], closed && 'opacity-50')} />
                <span className="shrink-0 font-mono text-[10px] text-content-muted">{item.key}</span>
                <span className="truncate">{item.title}</span>
            </button>
            {movable && (
                <button
                    type="button"
                    onClick={() => onMove(item.id)}
                    aria-label={tChip('moveToDate', { key: item.key })}
                    title={tChip('moveToDate', { key: item.key })}
                    className={cn(
                        'shrink-0 rounded px-0.5 text-[11px] leading-none text-content-muted',
                        'opacity-0 group-hover/chip:opacity-100 focus-visible:opacity-100',
                        'hover:bg-bg-muted hover:text-content-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                    )}
                >
                    …
                </button>
            )}
        </li>
    );
}

interface Cell {
    date: Date;
    ymd: string;
    inMonth: boolean;
}

function DayCell({
    cell,
    index,
    tabbable,
    isToday,
    isSelected,
    weekStart,
    props,
    registerRef,
    onKeyDown,
}: {
    cell: Cell;
    index: number;
    tabbable: boolean;
    isToday: boolean;
    isSelected: boolean;
    weekStart: boolean;
    props: CalendarMonthProps;
    registerRef: (index: number, el: HTMLDivElement | null) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>, index: number, ymd: string) => void;
}) {
    const tGrid = useTranslations('workItems.calendar.grid');
    const ref = React.useRef<HTMLDivElement | null>(null);
    const [over, setOver] = React.useState(false);
    useDropDay(ref, cell.ymd, setOver);
    const { ymd } = cell;
    const { maxChipsPerDay = 3, onSelectDate } = props;
    const items = props.items.get(ymd) ?? [];
    const cycles = props.cycles.get(ymd) ?? [];
    const markers = props.markers.get(ymd) ?? [];
    const kind = props.dayKind(ymd);
    const visible = items.slice(0, maxChipsPerDay);
    const overflow = items.length - visible.length;
    const cycleLabel = (c: CalendarCycle) => c.name ?? tGrid('cycleNumbered', { number: c.number });

    // The cell's text for assistive technology: the day, its items, and what the colours and shapes say.
    const extras = [
        ...cycles.map((c) => tGrid('cycleOn', { name: cycleLabel(c) })),
        ...markers.map((m) => (m.kind === 'milestone' ? tGrid('milestoneDue', { name: m.label }) : tGrid('projectDue', { name: m.label }))),
        ...(kind === 'holiday' ? [tGrid('holiday')] : kind === 'nonWorking' ? [tGrid('nonWorking')] : []),
    ];
    const label = tGrid('dayCell', { date: formatDateLong(cell.date), count: items.length, extras: extras.length > 0 ? `, ${extras.join(', ')}` : '' });

    const handleClick = onSelectDate
        ? (e: React.MouseEvent<HTMLDivElement>) => {
              if ((e.target as HTMLElement).closest('a, button, [role="menu"]')) return;
              onSelectDate(ymd);
          }
        : undefined;

    return (
        <div
            ref={(el) => {
                ref.current = el;
                registerRef(index, el);
            }}
            role="gridcell"
            tabIndex={tabbable ? 0 : -1}
            aria-current={isToday ? 'date' : undefined}
            aria-selected={isSelected}
            aria-label={label}
            className={cn(
                'group relative flex min-h-[96px] min-w-0 flex-col gap-0.5 p-1',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]',
                cell.inMonth ? 'bg-bg-default' : 'bg-bg-muted/30',
                kind && 'bg-bg-subtle',
                kind === 'holiday' && 'bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,var(--bg-muted)_6px,var(--bg-muted)_8px)]',
                isToday && 'ring-1 ring-inset ring-[var(--brand-default)]',
                isSelected && 'bg-brand-subtle/40 ring-2 ring-inset ring-[var(--brand-default)]',
                over && 'bg-brand-subtle/60 ring-2 ring-inset ring-[var(--brand-emphasis)]',
                onSelectDate && 'cursor-pointer transition-colors duration-150 ease-out hover:bg-bg-muted/50',
            )}
            data-ymd={ymd}
            data-in-month={cell.inMonth}
            data-today={isToday || undefined}
            data-selected={isSelected || undefined}
            data-day-kind={kind ?? undefined}
            onClick={handleClick}
            onKeyDown={(e) => onKeyDown(e, index, ymd)}
        >
            {cycles.length > 0 && (
                <div aria-hidden className="flex flex-col gap-px">
                    {cycles.slice(0, 2).map((c) => {
                        const starts = c.startsOn === ymd || weekStart;
                        const ends = c.endsOn === ymd;
                        return (
                            <div
                                key={c.id}
                                data-cycle-band={c.id}
                                className={cn('-mx-1 h-3.5 truncate bg-brand-subtle px-1 text-[10px] leading-[14px] text-content-brand', starts && 'ml-0 rounded-l', ends && 'mr-0 rounded-r')}
                            >
                                {starts ? cycleLabel(c) : ' '}
                            </div>
                        );
                    })}
                </div>
            )}
            <div className="flex items-center justify-between gap-1">
                <span className={cn('px-1 text-xs leading-none text-content-muted', !cell.inMonth && 'opacity-60', isToday && 'font-semibold text-content-emphasis')} aria-hidden>
                    {cell.date.getUTCDate()}
                </span>
                {kind === 'holiday' && (
                    <span aria-hidden className="truncate text-[10px] text-content-muted">
                        {tGrid('holidayShort')}
                    </span>
                )}
            </div>
            {markers.length > 0 && (
                <ul className="flex min-w-0 flex-col gap-0.5">
                    {markers.map((m) => (
                        <li key={`${m.kind}-${m.id}`} data-marker={m.kind}>
                            <Link
                                href={props.markerHref(m)}
                                aria-label={m.kind === 'milestone' ? tGrid('milestoneDue', { name: m.label }) : tGrid('projectDue', { name: m.label })}
                                className="flex min-w-0 items-center gap-1 rounded px-1 text-[11px] text-content-default hover:bg-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                            >
                                <span aria-hidden className={cn('inline-block size-2 shrink-0 rotate-45', m.kind === 'milestone' ? 'bg-[var(--content-brand)]' : 'bg-[var(--content-emphasis)]')} />
                                <span className="truncate">{m.label}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
            {visible.length > 0 && (
                <ul className="flex min-h-0 min-w-0 flex-col gap-0.5">
                    {visible.map((item) => (
                        <Chip key={item.id} item={item} ymd={ymd} movable={props.movable.has(item.id)} onOpen={props.onOpenItem} onMove={props.onMoveRequest} />
                    ))}
                </ul>
            )}
            {overflow > 0 && (
                <button
                    type="button"
                    onClick={() => onSelectDate?.(ymd)}
                    className="px-1 text-left text-[10px] text-content-muted hover:text-content-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                    {tGrid('more', { count: overflow })}
                </button>
            )}
        </div>
    );
}

export function CalendarMonth(props: CalendarMonthProps) {
    const { month, todayYmd, selectedYmd, onSelectDate, onDropItem, className } = props;
    const monthStart = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
    const monthLabel = formatMonthYear(monthStart);
    useCalendarDropMonitor(onDropItem);

    const gridStartMs = monthGridRange(monthStart).from.getTime();
    const cells: Cell[] = [];
    for (let i = 0; i < GRID_CELLS; i++) {
        const d = new Date(gridStartMs + i * DAY_MS);
        cells.push({ date: d, ymd: d.toISOString().slice(0, 10), inMonth: d.getUTCMonth() === monthStart.getUTCMonth() });
    }
    const weeks: Cell[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

    // ─── Roving tabindex + keyboard navigation (from the source) ────────
    const [activeIndex, setActiveIndex] = React.useState<number | null>(null);
    const cellRefs = React.useRef<Array<HTMLDivElement | null>>([]);
    const monthKey = `${monthStart.getUTCFullYear()}-${monthStart.getUTCMonth()}`;
    React.useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the roving target when the visible month changes
        setActiveIndex(null);
    }, [monthKey]);

    const defaultRovingIndex = (() => {
        if (selectedYmd) {
            const i = cells.findIndex((c) => c.ymd === selectedYmd);
            if (i >= 0) return i;
        }
        const todayIdx = cells.findIndex((c) => c.ymd === todayYmd);
        if (todayIdx >= 0) return todayIdx;
        const firstInMonth = cells.findIndex((c) => c.inMonth);
        return firstInMonth >= 0 ? firstInMonth : 0;
    })();
    const rovingIndex = activeIndex ?? defaultRovingIndex;

    function focusCell(index: number) {
        setActiveIndex(index);
        cellRefs.current[index]?.focus();
    }

    function handleCellKeyDown(e: React.KeyboardEvent<HTMLDivElement>, index: number, ymd: string) {
        // Only when the cell itself is focused: never a key aimed at a chip, a marker or a button.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            onSelectDate?.(ymd);
            return;
        }
        let target: number;
        switch (e.key) {
            case 'ArrowRight':
                target = index + 1;
                break;
            case 'ArrowLeft':
                target = index - 1;
                break;
            case 'ArrowDown':
                target = index + 7;
                break;
            case 'ArrowUp':
                target = index - 7;
                break;
            case 'Home':
                target = index - (index % 7);
                break;
            case 'End':
                target = index - (index % 7) + 6;
                break;
            default:
                return;
        }
        e.preventDefault();
        if (target >= 0 && target < cells.length) focusCell(target);
    }

    const registerRef = React.useCallback((index: number, el: HTMLDivElement | null) => {
        cellRefs.current[index] = el;
    }, []);

    return (
        <div role="grid" aria-label={monthLabel} className={cn('flex flex-col gap-1', className)} data-testid="calendar-month">
            <div role="rowgroup" className="grid grid-cols-7 gap-px text-xs font-medium text-content-muted">
                <div role="row" className="contents">
                    {WEEKDAY_HEADERS.map((label, i) => (
                        <div key={i} role="columnheader" className="py-1 text-center">
                            {label}
                        </div>
                    ))}
                </div>
            </div>
            <div role="rowgroup" className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-border-subtle">
                {weeks.map((week, wi) => (
                    <div key={`week-${wi}`} role="row" className="contents">
                        {week.map((cell, ci) => {
                            const index = wi * 7 + ci;
                            return (
                                <DayCell
                                    key={cell.ymd}
                                    cell={cell}
                                    index={index}
                                    tabbable={index === rovingIndex}
                                    isToday={cell.ymd === todayYmd}
                                    isSelected={selectedYmd === cell.ymd}
                                    weekStart={ci === 0}
                                    props={props}
                                    registerRef={registerRef}
                                    onKeyDown={handleCellKeyDown}
                                />
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}
