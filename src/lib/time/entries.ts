/**
 * Time entries and timers (sub-phase 3.4b; docs/porting/maps/3.4.md, "Time
 * entries and timers (3.4b)"; ADR 0012 §2; owner decisions 260 to 267): the
 * limits, the timer's arithmetic and the shapes the routes answer, shared by
 * the usecases, the input schemas and the pages.
 *
 *   - An entry is whole minutes, 1 to 1,440, never rounded (decision 264); a
 *     person's day holds at most 1,440 minutes.
 *   - A timer counts at most 12 hours and then stops counting, with no job
 *     (decision 263): its minutes are the whole minutes since it started,
 *     rounded to the nearest, at least one, at most 720. A timer stopped
 *     under 30 seconds is discarded rather than recorded as a minute. On
 *     Stop the person may state fewer minutes.
 *
 * Client-safe and pure: no Prisma runtime, no server import. Durations are
 * typed and shown through the estimate's one parser and formatter
 * (`parseDuration`, `formatDuration` in `src/lib/work-items/estimate.ts`).
 *
 * Written fresh for Islestone.
 */

export const TIME_LIMITS = {
    /** One entry, and a person's day: 24 hours (CHECK `TimeEntry_minutes_range`). */
    minutesMax: 1_440,
    /** A timer counts at most 12 hours (decision 263). */
    timerCapMinutes: 720,
    /** A timer stopped under this many seconds is discarded. */
    timerDiscardSeconds: 30,
    /** An entry's description, in characters of plaintext. */
    descriptionMax: 2_000,
    /** An item's entries on one page. */
    itemPage: 50,
} as const;

/**
 * The minutes a timer started at `startedAt` counts at `now`: the whole
 * minutes since, rounded to the nearest, at least one, at most the cap; `0`
 * when it ran under 30 seconds (discarded). A clock behind the start counts
 * nothing.
 */
export function timerMinutes(startedAt: Date, now: Date): number {
    const ms = now.getTime() - startedAt.getTime();
    if (ms < TIME_LIMITS.timerDiscardSeconds * 1_000) return 0;
    const rounded = Math.max(1, Math.round(ms / 60_000));
    return Math.min(rounded, TIME_LIMITS.timerCapMinutes);
}

/** Whether a timer started at `startedAt` has stopped counting at `now` (12 hours). */
export function timerStoppedCounting(startedAt: Date, now: Date): boolean {
    return now.getTime() - startedAt.getTime() >= TIME_LIMITS.timerCapMinutes * 60_000;
}

/** Whether `minutes` is a valid entry length. */
export function isValidEntryMinutes(minutes: number): boolean {
    return Number.isInteger(minutes) && minutes >= 1 && minutes <= TIME_LIMITS.minutesMax;
}

/** The item an entry names, as a reader may see it. */
export type TimeEntryItem =
    | { kind: 'visible'; id: string; key: string; title: string; projectId: string; closed: boolean }
    /** Purged, or soft-deleted: "Deleted item" (decision 261). */
    | { kind: 'deleted' }
    /** In a project the reader cannot see: "Item you cannot see". */
    | { kind: 'hidden' };

/** One entry as the routes answer it. Amounts never (3.4d, `time.rates`). */
export interface TimeEntryData {
    id: string;
    userId: string;
    workItemId: string | null;
    projectId: string;
    /** `YYYY-MM-DD`. */
    workDate: string;
    /** NULL only while the timer is on. */
    minutes: number | null;
    source: 'MANUAL' | 'TIMER';
    billable: boolean;
    /** Shown to the person, and to a `time.view` holder (decision 266). */
    description: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
}

/** The person's running timer (`GET /time-entries/timer`). */
export interface RunningTimerData {
    entry: TimeEntryData;
    timerStartedAt: string;
    item: TimeEntryItem;
    /** The server's clock when it answered, so a browser with a skewed clock counts from the server's. */
    serverNow: string;
    /** True once it counted 12 hours (decision 263). */
    stoppedCounting: boolean;
}

/** A person's week (`GET /time-entries?week=`). */
export interface TimeWeekData {
    userId: string;
    /** The Monday, `YYYY-MM-DD`. */
    weekStart: string;
    entries: Array<TimeEntryData & { item: TimeEntryItem }>;
    /** Minutes per date of the week, Monday first (finished entries only). */
    dayTotals: Array<{ date: string; minutes: number }>;
    totalMinutes: number;
    /** What the caller may do with this week (asked on the server). */
    viewer: { edit: boolean };
}

/** An item's time (`GET /work-items/:id/time`). */
export interface WorkItemTimeData {
    workItemId: string;
    /** Every finished entry on the item, all people; NULL when the caller sees only their own (no `time.view`). */
    totalMinutes: number | null;
    ownMinutes: number;
    entries: Array<TimeEntryData & { personName: string | null }>;
    pageInfo: { hasNextPage: boolean; nextCursor?: string };
    viewer: {
        /** May add time and start a timer here (`time.track`, a person, a writable project). */
        track: boolean;
        /** Sees other people's entries and the item's total (`time.view`). */
        viewAll: boolean;
    };
}
