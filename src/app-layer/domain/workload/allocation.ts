/**
 * Allocation: an item's remaining hours placed into weeks (sub-phase 3.5b;
 * docs/porting/maps/3.5.md, "Allocation (3.5b)" and "Rules no decision names
 * (3.5b, as built)"; ADR 0013 §6 and §7; owner decisions 292 to 296).
 *
 *   1. **Remaining.** `R = max(0, estimate − time spent)`; the caller passes
 *      the estimate alone when it may not see the item's time (decision 295).
 *   2. **The span** is the engine's `plannedSpanOf` (decision 185): start to
 *      due; one date, one working day on it; start after due, one day at the
 *      due date; neither, no span ("No dates": counted, never placed).
 *   3. **From today.** The placement runs from the later of the span's start
 *      and today's next working day to the span's end. An item whose span
 *      ended before today is overdue: all of `R` falls on today's next
 *      working day, marked. A span with no working day left in it (it ends on
 *      days the calendar does not work) falls on the first working day of
 *      what is left, unmarked.
 *   4. **Into weeks.** The minutes are shared over the placement's working
 *      days: week `k` gets `⌈R·C(k)/D⌉ − ⌈R·C(k−1)/D⌉`, where `D` is the
 *      placement's working days and `C(k)` those up to week `k`'s Sunday.
 *      Every week is within one minute of its exact share, the odd minute
 *      goes to the earlier week, the weeks sum to `R` exactly, a later due
 *      date never moves minutes earlier, and a week's figure needs no other
 *      week, so a window costs its own weeks however long the item runs.
 *
 * Weeks are Monday to Sunday by date (decision 268), never passed through a
 * zone. Pure and client-safe, over epoch days: no database, no clock (today
 * is an argument), no zone. Working days come only from the scheduling
 * module (ADR 0010 §1: never a second working-day count or span rule).
 *
 * Written fresh for Islestone.
 */
import { nextWorkingDay, workingDaysInclusive, type CompiledCalendar, type EpochDay } from '../schedule/calendar';
import { plannedSpanOf } from '../schedule/span';

/** One item's dates and the minutes left to place. */
export interface AllocationInput {
    startDate: EpochDay | null;
    dueDate: EpochDay | null;
    /** Minutes left (at least zero); see {@link remainingMinutes}. */
    remainingMinutes: number;
}

/** Why an item's minutes sit where they do. */
export type PlacementReason =
    /** Its span ended before today: everything on today's next working day. */
    | 'OVERDUE'
    /** One working day takes it all (one date, or one day left). */
    | 'ONE_DAY'
    /** Spread over several working days. */
    | 'SPREAD';

/** Where one item's minutes land against a window of weeks. */
export interface Placement {
    /** The first and last day minutes may land on (`from` a working day). */
    from: EpochDay;
    to: EpochDay;
    /** Working days in `[from, to]`, at least one. */
    workingDays: number;
    reason: PlacementReason;
    /** Minutes in each week of the window, in order. */
    weeks: number[];
    /** Minutes in weeks before the window (a window that starts after the current week). */
    before: number;
    /** Minutes in weeks after the window ("Later"). */
    later: number;
}

/** The minutes an item still needs: its estimate less the time spent on it, never below zero. */
export function remainingMinutes(estimateMinutes: number, spentMinutes: number | null): number {
    const left = estimateMinutes - (spentMinutes ?? 0);
    return left > 0 ? left : 0;
}

/** `⌈a / b⌉` for non-negative whole numbers. */
function ceilDiv(a: number, b: number): number {
    return Math.floor((a + b - 1) / b);
}

/**
 * The working days and reason of an item's placement, or `null` for an item
 * with neither date (it is named under "No dates", never placed).
 */
export function placementSpan(input: Pick<AllocationInput, 'startDate' | 'dueDate'>, calendar: CompiledCalendar, today: EpochDay): Pick<Placement, 'from' | 'to' | 'workingDays' | 'reason'> | null {
    const span = plannedSpanOf(input, calendar);
    if (span === null) return null;
    const first = nextWorkingDay(calendar, today);
    if (span.end < today) return { from: first, to: first, workingDays: 1, reason: 'OVERDUE' };
    const from = span.start > first ? span.start : first;
    const days = workingDaysInclusive(calendar, from, span.end);
    if (days === 0) {
        const only = nextWorkingDay(calendar, from);
        return { from: only, to: only, workingDays: 1, reason: 'ONE_DAY' };
    }
    return { from: nextWorkingDay(calendar, from), to: span.end, workingDays: days, reason: days === 1 ? 'ONE_DAY' : 'SPREAD' };
}

/**
 * Place one item into the `weekCount` weeks starting on the Monday
 * `firstMonday`; `null` for an item with neither date.
 */
export function placeItem(input: AllocationInput, calendar: CompiledCalendar, today: EpochDay, firstMonday: EpochDay, weekCount: number): Placement | null {
    const span = placementSpan(input, calendar, today);
    if (span === null) return null;
    const r = input.remainingMinutes > 0 ? Math.floor(input.remainingMinutes) : 0;
    const d = span.workingDays;
    // Minutes placed up to and including `day` (rounded up, so the odd minute stays early).
    const upTo = (day: EpochDay): number => {
        if (day < span.from) return 0;
        if (day >= span.to) return r;
        return ceilDiv(r * workingDaysInclusive(calendar, span.from, day), d);
    };
    const before = upTo(firstMonday - 1);
    const weeks: number[] = [];
    let previous = before;
    for (let k = 0; k < weekCount; k += 1) {
        const through = upTo(firstMonday + 7 * k + 6);
        weeks.push(through - previous);
        previous = through;
    }
    return { ...span, weeks, before, later: r - previous };
}

/** Minutes a week is over capacity: allocated less capacity when positive, else 0 (decision 296). */
export function overCapacityMinutes(allocatedMinutes: number, capacityMinutes: number): number {
    return allocatedMinutes > capacityMinutes ? allocatedMinutes - capacityMinutes : 0;
}

/** Several placements summed by week (one person's row, or the "Unassigned" row). */
export function sumPlacements(placements: Iterable<Placement>, weekCount: number): { weeks: number[]; before: number; later: number } {
    const weeks = new Array<number>(weekCount).fill(0);
    let before = 0;
    let later = 0;
    for (const p of placements) {
        for (let k = 0; k < weekCount; k += 1) weeks[k]! += p.weeks[k] ?? 0;
        before += p.before;
        later += p.later;
    }
    return { weeks, before, later };
}
