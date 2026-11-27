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

/** One person's capacity per week on the Workload page (3.5a: capacity only; 3.5b adds allocation). */
export interface WorkloadPersonRow {
    userId: string;
    name: string | null;
    active: boolean;
    /** Per week, in the order of `weeks`. */
    capacity: number[];
    weeklyMinutes: number[];
    /** Minutes time off removed, per week. */
    timeOffMinutes: number[];
    /** The dates carrying time off, per week (never a type). */
    timeOffDays: string[][];
}

export interface WorkloadData {
    weeks: string[];
    today: string;
    timeZone: string;
    people: WorkloadPersonRow[];
}
