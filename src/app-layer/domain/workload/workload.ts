/**
 * The Workload page's figures (sub-phase 3.5b; docs/porting/maps/3.5.md,
 * "Allocation (3.5b)" and "The read"; ADR 0013 §6 to §8; owner decisions 292
 * to 297): per person and week the capacity (`capacity.ts`), the hours of
 * their counted work placed there (`allocation.ts`) and how far over it is;
 * per person what could not be placed in the window ("No dates", "Later");
 * the work assigned to nobody as one row of its own, never compared with a
 * capacity; and, for a project or team filter, that share of each week.
 *
 * Counted work (decision 292) is chosen by the caller's read: live, open,
 * visible, unarchived items of teams that estimate in hours with a counted
 * estimate. Each item counts its own estimate on its OWN calendar (ADR 0010
 * §5), with today in that calendar's zone (passed in, never read here).
 * Points are never converted (decision 294): they never reach this module.
 *
 * Pure and client-safe: no database, no clock, no zone, no time-off type.
 *
 * Written fresh for Islestone.
 */
import type { CompiledCalendar, EpochDay } from '../schedule/calendar';
import { overCapacityMinutes, placeItem, remainingMinutes, type Placement } from './allocation';
import { capacityByWeek, type CapacityContext, type CapacityPerson, type WeekCapacity } from './capacity';

/** One counted item (an hours estimate), as plain data. */
export interface WorkloadItemSpec {
    id: string;
    /** NULL: the "Unassigned" row. */
    assigneeId: string | null;
    projectId: string;
    teamId: string;
    startDate: EpochDay | null;
    dueDate: EpochDay | null;
    estimateMinutes: number;
    /** Finished time recorded on the item; NULL when the caller may not see it (decision 295). */
    spentMinutes: number | null;
}

/** The calendar an item counts on and today in its zone. */
export interface ItemCalendar {
    calendar: CompiledCalendar;
    today: EpochDay;
}

export interface WorkloadInput {
    /** The window's first Monday and its length in weeks. */
    firstMonday: EpochDay;
    weekCount: number;
    /** The people shown, each with what their capacity is read from. */
    people: ReadonlyArray<{ userId: string; person: CapacityPerson }>;
    capacity: CapacityContext;
    /** Counted items; an assignee who is not among `people` is left out. */
    items: readonly WorkloadItemSpec[];
    /** The team's calendar (else the workspace's) and today in its zone. */
    calendarOfTeam(teamId: string): ItemCalendar;
    /** A project or team filter: that share of each week is reported beside the whole. */
    share?: { projectId?: string; teamId?: string };
}

/** One row's figures (a person, or the "Unassigned" row with no capacity). */
export interface WorkloadRowFigures {
    /** Per week; empty for the "Unassigned" row. */
    capacity: WeekCapacity[];
    /** Allocated minutes per week. */
    allocated: number[];
    /** Minutes over capacity per week (0 when within); all zeros for the "Unassigned" row. */
    over: number[];
    /** The filtered project's or team's share of each week; NULL without such a filter. */
    share: number[] | null;
    /** Minutes placed after the window. */
    later: number;
    /** Counted items with neither date: their count and remaining minutes. */
    noDates: { count: number; minutes: number };
    /** Items placed in the window or later (dated, counted). */
    placedCount: number;
}

/** An item's placement, with what it was placed from (the cell sheet's rows). */
export interface PlacedItem {
    item: WorkloadItemSpec;
    remainingMinutes: number;
    placement: Placement;
}

export interface WorkloadFigures {
    rows: Map<string, WorkloadRowFigures>;
    unassigned: WorkloadRowFigures;
    /** Every dated item's placement, by assignee (`null` the unassigned), in the order given. */
    placed: Map<string | null, PlacedItem[]>;
}

function emptyRow(weekCount: number, withShare: boolean): WorkloadRowFigures {
    return {
        capacity: [],
        allocated: new Array<number>(weekCount).fill(0),
        over: new Array<number>(weekCount).fill(0),
        share: withShare ? new Array<number>(weekCount).fill(0) : null,
        later: 0,
        noDates: { count: 0, minutes: 0 },
        placedCount: 0,
    };
}

function inShare(share: WorkloadInput['share'], item: WorkloadItemSpec): boolean {
    if (!share) return false;
    if (share.projectId && item.projectId !== share.projectId) return false;
    if (share.teamId && item.teamId !== share.teamId) return false;
    return Boolean(share.projectId || share.teamId);
}

/** Every row's capacity, allocation, over-capacity minutes and the figures named beside them. */
export function buildWorkload(input: WorkloadInput): WorkloadFigures {
    const { firstMonday, weekCount } = input;
    const weeks = Array.from({ length: weekCount }, (_, i) => firstMonday + 7 * i);
    const withShare = Boolean(input.share && (input.share.projectId || input.share.teamId));
    const rows = new Map<string, WorkloadRowFigures>();
    for (const p of input.people) {
        const row = emptyRow(weekCount, withShare);
        row.capacity = capacityByWeek(p.person, weeks, input.capacity);
        rows.set(p.userId, row);
    }
    const unassigned = emptyRow(weekCount, withShare);
    const placed = new Map<string | null, PlacedItem[]>();

    for (const item of input.items) {
        const row = item.assigneeId === null ? unassigned : rows.get(item.assigneeId);
        if (!row) continue;
        const left = remainingMinutes(item.estimateMinutes, item.spentMinutes);
        const { calendar, today } = input.calendarOfTeam(item.teamId);
        const placement = placeItem({ startDate: item.startDate, dueDate: item.dueDate, remainingMinutes: left }, calendar, today, firstMonday, weekCount);
        if (placement === null) {
            row.noDates.count += 1;
            row.noDates.minutes += left;
            continue;
        }
        row.placedCount += 1;
        const counted = inShare(input.share, item);
        for (let k = 0; k < weekCount; k += 1) {
            const m = placement.weeks[k]!;
            row.allocated[k]! += m;
            if (counted) row.share![k]! += m;
        }
        row.later += placement.later;
        const list = placed.get(item.assigneeId) ?? [];
        list.push({ item, remainingMinutes: left, placement });
        placed.set(item.assigneeId, list);
    }

    for (const row of rows.values()) {
        for (let k = 0; k < weekCount; k += 1) row.over[k] = overCapacityMinutes(row.allocated[k]!, row.capacity[k]!.capacityMinutes);
    }
    return { rows, unassigned, placed };
}

/** Whether a row has any of the filtered share in the window (a project or team filter keeps such people). */
export function hasShareInWindow(row: WorkloadRowFigures): boolean {
    return row.share !== null && row.share.some((m) => m > 0);
}

/** Whether any week of a row is over capacity ("Over capacity only"). */
export function isOverInWindow(row: WorkloadRowFigures): boolean {
    return row.over.some((m) => m > 0);
}
