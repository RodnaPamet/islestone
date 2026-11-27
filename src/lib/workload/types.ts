/**
 * Client-safe shapes of capacity, time off and the Workload page (sub-phase
 * 3.5a; docs/porting/maps/3.5.md; ADR 0013). Dates are `YYYY-MM-DD`; minutes
 * are whole minutes. A time-off type is present only for a caller who may see
 * it (the person, or a holder of `workload.manage`; decision 287): the key is
 * ABSENT otherwise, never `null`.
 *
 * Written fresh for Islestone.
 */
import type { TimeOffType } from './time-off';

/** What the Workload pages offer the caller (asked on the server; never in a component). */
export interface WorkloadAffordances {
    /** The Workload page: everyone's capacity, time-off dates and hours. */
    view: boolean;
    /** Record, change and remove one's own time off (a person only). */
    recordOwnTimeOff: boolean;
    /** The default, anyone's capacity, anyone's time off and every type (a person only for writes). */
    manage: boolean;
}

export interface WorkloadSettingsData {
    defaultWeeklyMinutes: number;
    /** 0 while no row is saved (the defaults). */
    version: number;
}

export interface MemberCapacityData {
    id: string;
    userId: string;
    effectiveFrom: string;
    weeklyMinutes: number;
    calendarTeamId: string | null;
    version: number;
    createdAt: string;
}

/** One person's capacity rows, newest first, with what is in force this week. */
export interface MemberCapacityHistory {
    userId: string;
    /** The workspace's default, for a person with no row in force. */
    defaultWeeklyMinutes: number;
    /** The current week's Monday (today in the workspace calendar's zone). */
    currentWeek: string;
    rows: MemberCapacityData[];
}

/** One member, for Settings → Workload's table. */
export interface WorkloadMemberRow {
    userId: string;
    name: string | null;
    active: boolean;
    /** The row in force this week; NULL: the workspace's default. */
    inForce: MemberCapacityData | null;
    /** The next future row, if any. */
    next: MemberCapacityData | null;
}

export interface WorkloadMembersData {
    defaultWeeklyMinutes: number;
    currentWeek: string;
    members: WorkloadMemberRow[];
    teams: { id: string; name: string }[];
}

/** One date of a person's time off. */
export interface TimeOffDayData {
    userId: string;
    day: string;
    /** NULL: the whole day. */
    minutes: number | null;
    version: number;
    /** Who last wrote it, when it was not the person ("Added by Ana"). */
    updatedByUserId: string;
    /** Present only for the person and holders of `workload.manage`. */
    type?: TimeOffType;
}

export interface TimeOffData {
    userId: string;
    from: string;
    to: string;
    days: TimeOffDayData[];
    /** Whether `type` is carried on each date for this caller. */
    typeShown: boolean;
}

/** The result of a batch write: the dates as now stored. */
export interface TimeOffWriteResult {
    userId: string;
    days: TimeOffDayData[];
    removed: string[];
}

/** Counted items with neither date, placed nowhere (decision 292). */
export interface WorkloadNoDates {
    count: number;
    /** Their remaining minutes. */
    minutes: number;
}

/** Points work, named beside the hours and never converted (decision 294). */
export interface WorkloadPointsWork {
    count: number;
    points: number;
}

/**
 * One person's row on the Workload page (3.5a capacity; 3.5b allocation).
 * Every array is per week, in the order of `weeks`.
 */
export interface WorkloadPersonRow {
    userId: string;
    name: string | null;
    /** False for a deactivated member who still holds open work: zero capacity, so any work is over. */
    active: boolean;
    capacity: number[];
    weeklyMinutes: number[];
    /** Minutes time off removed, per week. */
    timeOffMinutes: number[];
    /** The dates carrying time off, per week (never a type). */
    timeOffDays: string[][];
    /** Minutes of counted work placed in each week. */
    allocated: number[];
    /** Minutes over capacity per week; 0 within (decision 296). */
    over: number[];
    /** The filtered project's or team's share of each week; NULL without such a filter. */
    share: number[] | null;
    /** Minutes placed after the window. */
    later: number;
    noDates: WorkloadNoDates;
    /** Open assigned items with no counted estimate (hours teams and teams that do not estimate). */
    notEstimated: number;
    pointsWork: WorkloadPointsWork;
}

/** Work assigned to nobody: one row of its own, never compared with a capacity. */
export interface WorkloadUnassignedRow {
    allocated: number[];
    share: number[] | null;
    later: number;
    noDates: WorkloadNoDates;
}

/** The filters a workload read applied (echoed so the page can say so). */
export interface WorkloadFiltersApplied {
    userIds: string[] | null;
    projectId: string | null;
    teamId: string | null;
    recipientListId: string | null;
    over: boolean;
}

export interface WorkloadData {
    weeks: string[];
    /** Today in the workspace calendar's zone. */
    today: string;
    timeZone: string;
    people: WorkloadPersonRow[];
    /** NULL when a people filter is set, or nothing unassigned is counted. */
    unassigned: WorkloadUnassignedRow | null;
    /** The calendars counted on (the workspace's first), with their zones. */
    calendars: Array<{ id: string; timeZone: string }>;
    /** Whether recorded time shrank each item's remaining hours (the caller holds `time.view`, decision 295). */
    timeSpentCounted: boolean;
    filters: WorkloadFiltersApplied;
}

/** Why an item's minutes sit in a week (the cell sheet's "why"). */
export type WorkloadPlacementReason = 'OVERDUE' | 'ONE_DAY' | 'SPREAD';

/** One item filling a week. */
export interface WorkloadCellItem {
    id: string;
    key: string;
    title: string;
    projectId: string;
    projectName: string;
    startDate: string | null;
    dueDate: string | null;
    estimateMinutes: number;
    remainingMinutes: number;
    /** Its minutes in this week. */
    minutes: number;
    reason: WorkloadPlacementReason;
    /** The working days its remaining minutes are spread over, from `from` to `to`. */
    workingDays: number;
    from: string;
    to: string;
}

/** The items that fill one person's week (`GET /workload/cell`). */
export interface WorkloadCellData {
    /** The person, or `unassigned`. */
    userId: string;
    name: string | null;
    active: boolean;
    week: string;
    /** NULL for the unassigned. */
    capacityMinutes: number | null;
    weeklyMinutes: number | null;
    allocatedMinutes: number;
    overMinutes: number;
    /** The week's dates of time off with their hours (NULL the whole day); never a type. */
    timeOff: Array<{ day: string; minutes: number | null }>;
    /** Most minutes first; at most 200. Empty when the caller may not read work items. */
    items: WorkloadCellItem[];
    /** Items with minutes in the week beyond the 200 shown. */
    moreItems: number;
    /** Whether the caller may read the items (`work_items.view`); the figures are shown either way. */
    itemsShown: boolean;
    timeSpentCounted: boolean;
    /**
     * "Ways to rebalance" (3.5c, decision 299): present only for an over-capacity week of a person, for a
     * signed-in viewer who reads work items and may assign them or change their dates; NULL otherwise.
     */
    rebalance: WorkloadRebalance | null;
    /** Why no ways to rebalance were worked out for an over-capacity week the viewer could act on; NULL otherwise. */
    rebalanceNote: 'TOO_FAR_AHEAD' | null;
}

/** Someone who could take an item and stay within capacity in every week it covers ("Assign to Ana"). */
export interface WorkloadAssignOption {
    userId: string;
    name: string | null;
    /** Their capacity less their allocation in the cell's week, before taking the item. */
    freeMinutes: number;
}

/** The earliest later dates at which the person stays within capacity ("Move ISL-12 to 14–18 Dec"). */
export interface WorkloadMoveOption {
    startDate: string | null;
    dueDate: string | null;
    /** The days its minutes would land on. */
    from: string;
    to: string;
}

/** One of the week's five largest items with the ways it could leave the week. */
export interface WorkloadRebalanceItem {
    id: string;
    key: string;
    title: string;
    projectId: string;
    /** Its minutes in the cell's week. */
    minutes: number;
    /** Its dates now. */
    startDate: string | null;
    dueDate: string | null;
    /** At most three; empty when nobody fits or assigning is not offered. */
    assignTo: WorkloadAssignOption[];
    /** NULL when no later dates fit, or changing dates is not offered. */
    moveTo: WorkloadMoveOption | null;
}

/** The ways to rebalance one over-capacity week (`GET /workload/cell`, 3.5c). Nothing is applied by reading them. */
export interface WorkloadRebalance {
    items: WorkloadRebalanceItem[];
    /** Filling items due on a date the person has the whole day off (the date only; never a type). */
    dueDuringTimeOff: Array<{ id: string; key: string; title: string; dueDate: string }>;
    /** The writes the viewer could make: `work_items.assign`, `work_items.edit` (asked on the server). */
    offered: { assign: boolean; moveDates: boolean };
    /** Every member's work could not be read (above the read's bound): nobody is named to assign to. */
    assignUnavailable: boolean;
    /** How far "Move dates" searched, in weeks. */
    searchWeeks: number;
}
