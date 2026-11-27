/**
 * Ways to rebalance an over-capacity week (sub-phase 3.5c;
 * docs/porting/maps/3.5.md, "Ways to rebalance (3.5c)" and "Rules no decision
 * names (3.5c, as built)"; ADR 0013 §8; owner decisions 283 and 299).
 *
 * For one person's week that is over capacity (decision 296), from the same
 * inputs as the Workload read, over a window of weeks starting at the
 * current one:
 *
 *   - **The items that fill the week**, by their minutes there, most first
 *     (ties by id), as the cell lists them.
 *   - **"Assign to …"**, for each of the five largest: at most three other
 *     ACTIVE members who already hold counted work of the item's project
 *     placed in the window, and who would stay within capacity in EVERY week
 *     the item's placement covers if it were theirs; ranked by their free
 *     minutes in the cell's week (capacity less allocation, before taking the
 *     item), then by name, then by id. An item whose placement runs past the
 *     window is offered nobody: it cannot be shown to fit.
 *   - **"Move dates"**, for each of the five largest: the earliest later
 *     dates, moved whole on the item's own calendar by the engine's one move
 *     rule (`movePlannedDates`: the working-day duration kept), at which the
 *     person is within capacity in every week the item would cover, the item
 *     not overdue there. The search moves the item's last day at most 26
 *     weeks past the later of that day and today, and stops where the item
 *     would leave the window.
 *   - **"Due during time off"**: each filling item whose due date is a date
 *     the person has the whole day off (the date only; never a type).
 *
 * The item's hours land on its own calendar whoever holds it (ADR 0010 §5),
 * so an item placed for another person covers the same weeks with the same
 * minutes. Nothing here writes or stores anything: a person opens an option
 * into an existing confirmation (decision 299; ADR 0003: an agent never
 * computes or applies one).
 *
 * Pure and client-safe: no database, no clock, no zone, no time-off type.
 *
 * Written fresh for Islestone.
 */
import type { EpochDay } from '../schedule/calendar';
import { movePlannedDates } from '../schedule/move';
import { plannedSpanOf } from '../schedule/span';
import { placeItem, remainingMinutes, type Placement } from './allocation';
import { mondayOf } from './capacity';
import type { ItemCalendar, WorkloadItemSpec } from './workload';

export const REBALANCE_LIMITS = Object.freeze({
    /** Options are worked out for this many of the week's largest items. */
    largest: 5,
    /** "Assign to …" names at most this many people per item. */
    assignees: 3,
    /** "Move dates" moves an item's last day at most this many weeks past the later of that day and today. */
    searchWeeks: 26,
    /** The window runs from the current week to this many weeks after the cell's. */
    weeksAfterCell: 27,
    /** Options are worked out only for a cell at most this many weeks after the current one. */
    cellWeeksAhead: 52,
});

/** One person as the options read them: capacity per window week and their counted items. */
export interface RebalancePerson {
    userId: string;
    name: string | null;
    /** Capacity minutes in each week of the window, in order. */
    capacity: readonly number[];
    items: readonly WorkloadItemSpec[];
}

export interface RebalanceInput {
    /** The window: its first Monday (the current week) and its length; the cell's week lies in it. */
    firstMonday: EpochDay;
    weekCount: number;
    /** The cell's Monday. */
    cellWeek: EpochDay;
    /** The person whose week it is. */
    person: RebalancePerson;
    /** The dates the person has the whole day off. */
    wholeDaysOff: readonly EpochDay[];
    /** Other ACTIVE members (the candidates are chosen among them); `null` when their work is not known. */
    others: readonly RebalancePerson[] | null;
    /** An item's team's calendar (else the workspace's) and today in its zone. */
    calendarOfTeam(teamId: string): ItemCalendar;
    /** The writes the viewer could make: `work_items.assign`, `work_items.edit`. */
    offer: { assign: boolean; moveDates: boolean };
}

export interface AssignOption {
    userId: string;
    name: string | null;
    /** Their capacity less their allocation in the cell's week, before taking the item. */
    freeMinutes: number;
}

export interface MoveOption {
    startDate: EpochDay | null;
    dueDate: EpochDay | null;
    /** The days its minutes would land on. */
    from: EpochDay;
    to: EpochDay;
}

export interface RebalanceItemOptions {
    itemId: string;
    /** Its minutes in the cell's week. */
    minutes: number;
    /** Empty when nobody fits or the viewer may not assign. */
    assignTo: AssignOption[];
    /** NULL when no later dates fit or the viewer may not change dates. */
    moveTo: MoveOption | null;
}

export interface RebalanceOptions {
    /** The five largest items filling the week, most minutes first. */
    items: RebalanceItemOptions[];
    /** Filling items due on a date the person has the whole day off. */
    dueDuringTimeOff: Array<{ itemId: string; dueDate: EpochDay }>;
}

interface Placed {
    item: WorkloadItemSpec;
    remaining: number;
    placement: Placement;
}

/** Every dated item of a person placed over the window, and their allocation per week. */
function placeAll(person: RebalancePerson, input: RebalanceInput): { placed: Placed[]; allocated: number[] } {
    const allocated = new Array<number>(input.weekCount).fill(0);
    const placed: Placed[] = [];
    for (const item of person.items) {
        const remaining = remainingMinutes(item.estimateMinutes, item.spentMinutes);
        const { calendar, today } = input.calendarOfTeam(item.teamId);
        const placement = placeItem({ startDate: item.startDate, dueDate: item.dueDate, remainingMinutes: remaining }, calendar, today, input.firstMonday, input.weekCount);
        if (placement === null) continue;
        for (let k = 0; k < input.weekCount; k += 1) allocated[k]! += placement.weeks[k]!;
        placed.push({ item, remaining, placement });
    }
    return { placed, allocated };
}

/** The index of the window week holding `day`. */
function weekIndex(input: Pick<RebalanceInput, 'firstMonday'>, day: EpochDay): number {
    return (mondayOf(day) - input.firstMonday) / 7;
}

/** Whether a placement lies wholly inside the window. */
function insideWindow(input: Pick<RebalanceInput, 'firstMonday' | 'weekCount'>, p: Placement): boolean {
    return p.before === 0 && p.later === 0 && p.from >= input.firstMonday && p.to <= input.firstMonday + 7 * input.weekCount - 1;
}

/**
 * Whether `placement` fits beside `allocated` within `capacity` in every week
 * it covers (the weeks from its first day's to its last day's).
 */
export function fitsEveryWeek(input: Pick<RebalanceInput, 'firstMonday' | 'weekCount'>, placement: Placement, allocated: readonly number[], capacity: readonly number[]): boolean {
    if (!insideWindow(input, placement)) return false;
    const first = weekIndex(input, placement.from);
    const last = weekIndex(input, placement.to);
    for (let k = first; k <= last; k += 1) if (allocated[k]! + placement.weeks[k]! > capacity[k]!) return false;
    return true;
}

const byMinutesThenId = (k: number) => (a: Placed, b: Placed) => b.placement.weeks[k]! - a.placement.weeks[k]! || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0);

function compareNames(a: AssignOption, b: AssignOption): number {
    if (b.freeMinutes !== a.freeMinutes) return b.freeMinutes - a.freeMinutes;
    const an = (a.name ?? '').toLowerCase();
    const bn = (b.name ?? '').toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
}

/** The earliest later dates of `x` at which the person is within capacity in every week it would cover. */
function earliestMove(x: Placed, others: readonly number[], capacity: readonly number[], input: RebalanceInput): MoveOption | null {
    const { calendar, today } = input.calendarOfTeam(x.item.teamId);
    const dates = { startDate: x.item.startDate, dueDate: x.item.dueDate };
    const span = plannedSpanOf(dates, calendar);
    if (span === null) return null;
    const maxDays = Math.max(0, today - span.end) + 7 * REBALANCE_LIMITS.searchWeeks;
    let previous = '';
    for (let days = 1; days <= maxDays; days += 1) {
        const moved = movePlannedDates(dates, calendar, days);
        const key = `${moved.startDate}:${moved.dueDate}`;
        if (key === previous) continue;
        previous = key;
        const p = placeItem({ ...moved, remainingMinutes: x.remaining }, calendar, today, input.firstMonday, input.weekCount);
        if (p === null) return null;
        if (p.reason === 'OVERDUE') continue;
        // A later move only reaches further: past the window, nothing more can be shown to fit.
        if (!insideWindow(input, p)) return null;
        if (fitsEveryWeek(input, p, others, capacity)) return { startDate: moved.startDate, dueDate: moved.dueDate, from: p.from, to: p.to };
    }
    return null;
}

/**
 * The ways to rebalance the person's week, or `null` when the week is within
 * capacity (or lies outside the window).
 */
export function planRebalance(input: RebalanceInput): RebalanceOptions | null {
    const cell = (input.cellWeek - input.firstMonday) / 7;
    if (!Number.isInteger(cell) || cell < 0 || cell >= input.weekCount) return null;
    const mine = placeAll(input.person, input);
    if (mine.allocated[cell]! <= input.person.capacity[cell]!) return null;

    const filling = mine.placed.filter((p) => p.placement.weeks[cell]! > 0).sort(byMinutesThenId(cell));
    const largest = filling.slice(0, REBALANCE_LIMITS.largest);

    // The others' allocation and the projects they hold counted work of in the window, only when needed.
    const others =
        input.offer.assign && input.others
            ? input.others.map((o) => {
                  const placed = placeAll(o, input);
                  const projects = new Set(placed.placed.filter((p) => p.placement.weeks.some((m) => m > 0)).map((p) => p.item.projectId));
                  return { person: o, allocated: placed.allocated, projects };
              })
            : [];

    const items = largest.map((x): RebalanceItemOptions => {
        const assignTo: AssignOption[] = [];
        if (input.offer.assign && insideWindow(input, x.placement)) {
            for (const o of others) {
                if (!o.projects.has(x.item.projectId)) continue;
                if (!fitsEveryWeek(input, x.placement, o.allocated, o.person.capacity)) continue;
                assignTo.push({ userId: o.person.userId, name: o.person.name, freeMinutes: o.person.capacity[cell]! - o.allocated[cell]! });
            }
            assignTo.sort(compareNames);
            assignTo.splice(REBALANCE_LIMITS.assignees);
        }
        let moveTo: MoveOption | null = null;
        if (input.offer.moveDates) {
            const without = mine.allocated.map((m, k) => m - x.placement.weeks[k]!);
            moveTo = earliestMove(x, without, input.person.capacity, input);
        }
        return { itemId: x.item.id, minutes: x.placement.weeks[cell]!, assignTo, moveTo };
    });

    const off = new Set(input.wholeDaysOff);
    const dueDuringTimeOff = filling.filter((p) => p.item.dueDate !== null && off.has(p.item.dueDate)).map((p) => ({ itemId: p.item.id, dueDate: p.item.dueDate! }));
    return { items, dueDuringTimeOff };
}
