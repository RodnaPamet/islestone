/**
 * The pure parts of the Workload page (sub-phase 3.5a; docs/porting/maps/3.5.md,
 * "The page"): the capacity grid's cells, the roving focus of a `role=grid`,
 * a month of dates for the time-off calendar, and the working days a range of
 * time off would fill (the dialog's preview). Date-only `YYYY-MM-DD` keys;
 * nothing here reads a clock or a zone.
 *
 * Client-safe and pure; written fresh for Islestone in the pattern of My
 * time's `week-grid-model.ts` and the calendar view's `calendar-model.ts`.
 */
import { addDays, isoWeekday, weekStartOf } from '@/lib/time/week';
import type { TimeOffDayData, WorkloadData } from '@/lib/workload/types';

export interface WorkloadCell {
    week: string;
    capacityMinutes: number;
    weeklyMinutes: number;
    timeOffMinutes: number;
    timeOffDays: string[];
    /** Minutes of counted work placed in the week (3.5b). */
    allocatedMinutes: number;
    /** Minutes over capacity; 0 within (decision 296). */
    overMinutes: number;
    /** The filtered project's or team's share; NULL without such a filter. */
    shareMinutes: number | null;
}

export interface WorkloadRow {
    /** The person, or `unassigned` for the work assigned to nobody. */
    userId: string;
    name: string;
    active: boolean;
    /** The "Unassigned" row: no capacity, never over. */
    unassigned: boolean;
    cells: WorkloadCell[];
    later: number;
    noDates: { count: number; minutes: number };
    notEstimated: number;
    pointsWork: { count: number; points: number };
}

/** The `userId` of the "Unassigned" row (the cell route's too). */
export const UNASSIGNED_ROW = 'unassigned';

/** The grid's rows: people in the server's order, one cell per week, then the "Unassigned" row when there is one. */
export function workloadRows(data: Pick<WorkloadData, 'weeks' | 'people'> & Partial<Pick<WorkloadData, 'unassigned'>>, labels: { unnamed: string; unassigned: string }): WorkloadRow[] {
    const rows: WorkloadRow[] = data.people.map((p) => ({
        userId: p.userId,
        name: p.name?.trim() || labels.unnamed,
        active: p.active,
        unassigned: false,
        cells: data.weeks.map((week, i) => ({
            week,
            capacityMinutes: p.capacity[i] ?? 0,
            weeklyMinutes: p.weeklyMinutes[i] ?? 0,
            timeOffMinutes: p.timeOffMinutes[i] ?? 0,
            timeOffDays: p.timeOffDays[i] ?? [],
            allocatedMinutes: p.allocated[i] ?? 0,
            overMinutes: p.over[i] ?? 0,
            shareMinutes: p.share ? (p.share[i] ?? 0) : null,
        })),
        later: p.later,
        noDates: p.noDates,
        notEstimated: p.notEstimated,
        pointsWork: p.pointsWork,
    }));
    const u = data.unassigned;
    if (u) {
        rows.push({
            userId: UNASSIGNED_ROW,
            name: labels.unassigned,
            active: true,
            unassigned: true,
            cells: data.weeks.map((week, i) => ({
                week,
                capacityMinutes: 0,
                weeklyMinutes: 0,
                timeOffMinutes: 0,
                timeOffDays: [],
                allocatedMinutes: u.allocated[i] ?? 0,
                overMinutes: 0,
                shareMinutes: u.share ? (u.share[i] ?? 0) : null,
            })),
            later: u.later,
            noDates: u.noDates,
            notEstimated: 0,
            pointsWork: { count: 0, points: 0 },
        });
    }
    return rows;
}

/** How full a week is, 0 to 1 (a bar's width and its colour); a week with no capacity and work is full. */
export function fillRatio(cell: Pick<WorkloadCell, 'allocatedMinutes' | 'capacityMinutes'>): number {
    if (cell.allocatedMinutes <= 0) return 0;
    if (cell.capacityMinutes <= 0) return 1;
    return Math.min(1, cell.allocatedMinutes / cell.capacityMinutes);
}

/**
 * My Work's one line (decision 300): this week's allocation against capacity
 * and next week's, the first over-capacity week said as such; `null` when the
 * person has no counted work in either week (the line is hidden).
 */
export function workloadLine(cells: readonly Pick<WorkloadCell, 'allocatedMinutes' | 'capacityMinutes' | 'overMinutes'>[]): Array<{ week: 'this' | 'next'; allocated: number; capacity: number; over: number }> | null {
    const two = cells.slice(0, 2);
    if (two.every((c) => c.allocatedMinutes === 0)) return null;
    return two.map((c, i) => ({ week: i === 0 ? 'this' : 'next', allocated: c.allocatedMinutes, capacity: c.capacityMinutes, over: c.overMinutes }));
}

/** Where focus moves in a grid of `rows` × `cols` for a key, or null for a key it does not handle. */
export function rovingTarget(key: string, r: number, c: number, rows: number, cols: number): [number, number] | null {
    const lastRow = Math.max(0, rows - 1);
    const lastCol = Math.max(0, cols - 1);
    switch (key) {
        case 'ArrowRight':
            return [r, Math.min(lastCol, c + 1)];
        case 'ArrowLeft':
            return [r, Math.max(0, c - 1)];
        case 'ArrowDown':
            return [Math.min(lastRow, r + 1), c];
        case 'ArrowUp':
            return [Math.max(0, r - 1), c];
        case 'Home':
            return [r, 0];
        case 'End':
            return [r, lastCol];
        default:
            return null;
    }
}

/** The first of the month holding `ymd`. */
export function monthStartOf(ymd: string): string {
    return `${ymd.slice(0, 7)}-01`;
}

/** The first of the month `n` months after the one starting `monthStart`. */
export function addMonths(monthStart: string, n: number): string {
    const [y, m] = monthStart.split('-').map(Number) as [number, number];
    const total = y * 12 + (m - 1) + n;
    return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

/** The last date of the month starting `monthStart`. */
export function monthEndOf(monthStart: string): string {
    return addDays(addMonths(monthStart, 1), -1);
}

export interface MonthCell {
    date: string;
    inMonth: boolean;
    timeOff: TimeOffDayData | null;
}

/** Six weeks of seven dates, Monday first, covering the month starting `monthStart`. */
export function monthGrid(monthStart: string, days: readonly TimeOffDayData[]): MonthCell[][] {
    const byDay = new Map(days.map((d) => [d.day, d] as const));
    const first = weekStartOf(monthStart);
    const month = monthStart.slice(0, 7);
    return Array.from({ length: 6 }, (_, w) =>
        Array.from({ length: 7 }, (_, i) => {
            const date = addDays(first, w * 7 + i);
            return { date, inMonth: date.slice(0, 7) === month, timeOff: byDay.get(date) ?? null };
        }),
    );
}

/**
 * The dates in `[from, to]` a range of time off fills: the person's working
 * weekdays, without the holidays known for the range. At most `max` dates.
 */
export function workingDatesIn(from: string, to: string, workingWeekdays: readonly number[], holidays: readonly string[], max = 366): string[] {
    if (to < from) return [];
    const off = new Set(holidays);
    const out: string[] = [];
    for (let d = from; d <= to && out.length < max; d = addDays(d, 1)) {
        if (workingWeekdays.includes(isoWeekday(d)) && !off.has(d)) out.push(d);
    }
    return out;
}

/** "40h", "37h 30m", "0h": minutes as hours for a cell (whole minutes, never rounded). */
export function hoursText(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
