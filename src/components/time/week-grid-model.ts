/**
 * My time's week grid, as data (sub-phase 3.4b; docs/porting/maps/3.4.md,
 * "The pages (3.4b)"): one row per item the person recorded time on that
 * week, seven day cells holding the sum of that item's finished entries on
 * that day, the row's total and the day totals. Entries whose item was
 * deleted share one row ("Deleted item"), as do those the reader cannot see.
 * A running timer is listed in its cell (`timerOn`) and counted nowhere.
 *
 * Pure and client-safe. Written fresh for Islestone.
 */
import type { TimeEntryItem, TimeWeekData } from '@/lib/time/entries';
import { weekDays } from '@/lib/time/week';

export type WeekEntry = TimeWeekData['entries'][number];

export interface WeekCell {
    date: string;
    minutes: number;
    /** The finished entries summed here, oldest first. */
    entries: WeekEntry[];
    timerOn: boolean;
}

export interface WeekRow {
    /** The item's id, or `deleted` / `hidden` for the shared rows. */
    key: string;
    item: TimeEntryItem;
    cells: WeekCell[];
    total: number;
}

export interface WeekGrid {
    days: string[];
    rows: WeekRow[];
    dayTotals: number[];
    total: number;
}

function rowKeyOf(e: WeekEntry): string {
    return e.item.kind === 'visible' ? e.item.id : e.item.kind;
}

export function buildWeekGrid(week: Pick<TimeWeekData, 'weekStart' | 'entries'>): WeekGrid {
    const days = weekDays(week.weekStart);
    const rows = new Map<string, WeekRow>();
    for (const e of week.entries) {
        const key = rowKeyOf(e);
        let row = rows.get(key);
        if (!row) {
            row = { key, item: e.item, cells: days.map((date) => ({ date, minutes: 0, entries: [], timerOn: false })), total: 0 };
            rows.set(key, row);
        }
        const cell = row.cells.find((c) => c.date === e.workDate);
        if (!cell) continue;
        if (e.minutes === null) {
            cell.timerOn = true;
            continue;
        }
        cell.minutes += e.minutes;
        cell.entries.push(e);
        row.total += e.minutes;
    }
    // Visible items by key, then the shared rows last.
    const ordered = [...rows.values()].sort((a, b) => {
        const rank = (r: WeekRow) => (r.item.kind === 'visible' ? 0 : r.item.kind === 'hidden' ? 1 : 2);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        const ka = a.item.kind === 'visible' ? a.item.key : '';
        const kb = b.item.kind === 'visible' ? b.item.key : '';
        return ka.localeCompare(kb, 'en', { numeric: true });
    });
    const dayTotals = days.map((_, i) => ordered.reduce((s, r) => s + r.cells[i]!.minutes, 0));
    return { days, rows: ordered, dayTotals, total: dayTotals.reduce((s, n) => s + n, 0) };
}
