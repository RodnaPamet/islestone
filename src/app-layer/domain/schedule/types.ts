/**
 * The scheduling engine's shapes (roadmap 3.1; ADR 0010 §1 to §4). Plain data
 * in, plain data out: the server's read, the browser's drag preview (3.1c)
 * and roadmap 7.5's proposals all speak these types.
 *
 * Written fresh for Islestone.
 */
import type { CalendarSpec, EpochDay } from './calendar';

export type { CalendarSpec, EpochDay, IsoWeekday } from './calendar';

/** The engine refuses a larger input before doing any work (four times the timeline's 5,000). */
export const SCHEDULE_ITEM_LIMIT = 20_000;

/** An item's state as the engine reads it; CANCELLED items are not passed (decision 187). */
export type ScheduleItemStatus = 'open' | 'started' | 'done';

export interface ScheduleItem {
    id: string;
    /** The calendar the item's working days are counted on: its team's, else the workspace's. */
    calendarId: string;
    /** Its parent, when the parent is in the input too (decision 186: a summary). */
    parentId: string | null;
    /** `startDate`: "not before" (decision 184). */
    plannedStart: EpochDay | null;
    /** `dueDate`: the planned finish, inclusive. */
    plannedFinish: EpochDay | null;
    status: ScheduleItemStatus;
    /** When it was started and completed, in its calendar's time zone (decision 187). */
    actualStart: EpochDay | null;
    actualFinish: EpochDay | null;
    /** Its milestone's due date: a deadline (decision 188). */
    milestoneDue: EpochDay | null;
    /** Its project's due date: a deadline (decision 188). */
    projectDue: EpochDay | null;
}

/** `from` BLOCKS `to`: finish-to-start, no lag (decision 183). */
export interface ScheduleEdge {
    from: string;
    to: string;
}

export interface ScheduleInput {
    /** Today, passed in: the engine never reads a clock. */
    asOf: EpochDay;
    calendars: readonly CalendarSpec[];
    items: readonly ScheduleItem[];
    edges: readonly ScheduleEdge[];
}

export type ScheduleConflict =
    | 'STARTS_BEFORE_BLOCKER_FINISHES'
    | 'MISSES_MILESTONE_DUE_DATE'
    | 'MISSES_PROJECT_DUE_DATE'
    | 'DATES_REVERSED'
    | 'STARTS_ON_NON_WORKING_DAY';

export interface ItemSchedule {
    id: string;
    /** Working days the item takes; 0 for an item with no dates. */
    durationDays: number;
    /** Neither a start nor a due date (nor, when done or started, an actual date): the "No dates" list (decision 185). */
    unscheduled: boolean;
    /** It has sub-items in the input: drawn as a span of them, not scheduled itself (decision 186). */
    summary: boolean;
    earliestStart: EpochDay;
    earliestFinish: EpochDay;
    latestStart: EpochDay;
    latestFinish: EpochDay;
    /** Working days it can slip without moving the finish or missing a deadline; negative when late. */
    totalFloat: number;
    /** Working days it can slip without moving any successor's earliest start; never negative. */
    freeFloat: number;
    /** "Late by N days": the working days a deadline is missed by, else 0. */
    lateDays: number;
    /** On the critical path: the least float in view, when that is 0 or less (decision 198). */
    critical: boolean;
    conflicts: readonly ScheduleConflict[];
}

export type ScheduleWarningCode =
    /** Items with no dates inside a chain of blocks: counted as zero days (decision 185). */
    | 'UNSCHEDULED_IN_CHAIN'
    /** A summary's sub-items run outside its own planned dates (decision 186). */
    | 'SUMMARY_OUTSIDE_PLANNED_DATES'
    /** A blocks relation between an item and one of its own sub-items: it has no meaning in a schedule and is left out. */
    | 'EDGE_INSIDE_SUMMARY';

export interface ScheduleWarning {
    code: ScheduleWarningCode;
    ids: readonly string[];
}

export type ScheduleResult =
    | {
          ok: true;
          asOf: EpochDay;
          /** The latest earliest finish in view. */
          finish: EpochDay;
          /** Every item passed, sorted by id. */
          items: readonly ItemSchedule[];
          /** The edges passed whose two ends are critical and which leave no gap, sorted. */
          criticalEdges: readonly ScheduleEdge[];
          warnings: readonly ScheduleWarning[];
      }
    | { ok: false; error: 'CYCLE'; cycle: readonly string[] }
    | { ok: false; error: 'TOO_LARGE'; items: number; limit: number };
