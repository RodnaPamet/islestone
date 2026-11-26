/**
 * The calendar view's read and its client-side helpers (roadmap 3.3a;
 * docs/porting/maps/3.3.md, "The calendar view (3.3a)"; owner decisions 241
 * and 242). Client-safe: the usecase builds a `CalendarResponse`, the browser
 * draws it and places a write in its cached copy here.
 *
 *   - **The window** is the month grid's days, at most `CALENDAR_MAX_DAYS`;
 *     dates are date-only (`YYYY-MM-DD`), never passed through a zone.
 *   - **At most `CALENDAR_ITEM_LIMIT` items** with a due date in the window;
 *     more is a 422 `CALENDAR_TOO_LARGE` carrying the count, never a cut-off
 *     grid.
 *   - **Cycles, milestones and project due dates** are named as omitted when
 *     the caller may not read them, and as truncated when their bound is hit.
 *
 * Written fresh for Islestone.
 */
import type { WorkflowStateCategory } from '@prisma/client';

import { fromEpochDay, toEpochDay } from '@/app-layer/domain/schedule/calendar';

import type { TimelineCalendar } from './timeline';

/** The most days one calendar read spans (a 42-day month grid fits with room). */
export const CALENDAR_MAX_DAYS = 62;
/** At most this many items in one calendar read; above it the read refuses with the count. */
export const CALENDAR_ITEM_LIMIT = 2_000;
/** Cycles overlapping the window, at most. */
export const CALENDAR_CYCLE_LIMIT = 200;
/** Dated milestones in the window, at most. */
export const CALENDAR_MILESTONE_LIMIT = 500;

/** The refusal's code when the window holds more than `CALENDAR_ITEM_LIMIT` items. */
export const CALENDAR_TOO_LARGE = 'CALENDAR_TOO_LARGE' as const;
/** The refusal's code for a window that is reversed or longer than `CALENDAR_MAX_DAYS`. */
export const CALENDAR_RANGE = 'CALENDAR_RANGE' as const;

export interface CalendarTooLargeDetails {
    reason: typeof CALENDAR_TOO_LARGE;
    count: number;
    limit: number;
}

/** One item on its due date. */
export interface CalendarItem {
    id: string;
    key: string;
    title: string;
    projectId: string;
    teamId: string;
    typeId: string;
    stateCategory: WorkflowStateCategory;
    assigneeId: string | null;
    parentId: string | null;
    cycleId: string | null;
    milestoneId: string | null;
    /** `YYYY-MM-DD`. */
    startDate: string | null;
    /** `YYYY-MM-DD`; `null` only once a write in the browser cleared it (the read returns dated items). */
    dueDate: string | null;
    version: number;
}

export interface CalendarCycle {
    id: string;
    teamId: string;
    number: number;
    name: string | null;
    /** `YYYY-MM-DD`, both inclusive. */
    startsOn: string;
    endsOn: string;
}

export interface CalendarMilestone {
    id: string;
    projectId: string;
    name: string;
    /** `YYYY-MM-DD`. */
    dueDate: string;
}

export interface CalendarProject {
    id: string;
    name: string;
    keyPrefix: string;
    /** `YYYY-MM-DD`. */
    dueDate: string | null;
    archived: boolean;
}

/** What the caller may not read is named, never silently dropped. */
export type CalendarOmission = 'cycles' | 'milestones';

/** `GET /work-items/calendar`. */
export interface CalendarResponse {
    /** The window, `YYYY-MM-DD`, both inclusive. */
    from: string;
    to: string;
    /** Today in the scope calendar's time zone (decision 191), `YYYY-MM-DD`. */
    asOf: string;
    items: CalendarItem[];
    /** Items of the scope with no due date: counted, not drawn. */
    noDueDate: number;
    cycles: CalendarCycle[];
    milestones: CalendarMilestone[];
    /** The projects the items and markers name; a project's due date in the window is a marker. */
    projects: CalendarProject[];
    /** The scope's working calendar (one team's, else the workspace's), its holidays in the window. */
    calendar: TimelineCalendar;
    omitted: CalendarOmission[];
    /** A bound was reached: not every cycle or milestone of the window is shown. */
    truncated: CalendarOmission[];
}

/** Days from `a` to `b` (`YYYY-MM-DD`), positive when `b` is later. */
export function daysBetween(a: string, b: string): number {
    return toEpochDay(b) - toEpochDay(a);
}

/** `ymd` plus `n` days. */
export function addDays(ymd: string, n: number): string {
    return fromEpochDay(toEpochDay(ymd) + n);
}

export function inWindow(ymd: string | null, from: string, to: string): boolean {
    return ymd !== null && ymd >= from && ymd <= to;
}

/**
 * An item's dates with its due date moved to `toDue` and its start date, if
 * any, by the same number of calendar days (the map's rule for a drop or
 * "Move to date…", decision 241). An undated item gains the due date only.
 */
export function moveDueTo(dates: { startDate: string | null; dueDate: string | null }, toDue: string): { startDate: string | null; dueDate: string } {
    if (!dates.dueDate) return { startDate: dates.startDate, dueDate: toDue };
    const delta = daysBetween(dates.dueDate, toDue);
    return { startDate: dates.startDate ? addDays(dates.startDate, delta) : null, dueDate: toDue };
}

/** The fields of a row a write can change and the calendar draws. */
export interface CalendarRowChange {
    id: string;
    title: string;
    stateCategory: WorkflowStateCategory;
    assigneeId: string | null;
    parentId: string | null;
    cycleId: string | null;
    milestoneId: string | null;
    startDate: string | null;
    dueDate: string | null;
    version: number;
}

/**
 * A write placed in a cached calendar (`work-item-cache.ts`). `belongs` is
 * the list's own answer for the row and the calendar's filters
 * (`rowBelongs`). A held row takes the new fields (a due date outside the
 * window simply stops drawing it, so an undo can put it back); a held row
 * that no longer matches leaves. `null` when a row the calendar does not
 * hold may now belong in it: the caller re-reads then.
 */
export function placeRowInCalendar(current: CalendarResponse, change: CalendarRowChange, belongs: 'yes' | 'no' | 'unknown'): CalendarResponse | null {
    const index = current.items.findIndex((i) => i.id === change.id);
    if (index === -1) {
        return belongs !== 'no' && inWindow(change.dueDate, current.from, current.to) ? null : current;
    }
    if (belongs === 'no') return { ...current, items: current.items.filter((i) => i.id !== change.id) };
    const items = [...current.items];
    items[index] = {
        ...items[index]!,
        title: change.title,
        stateCategory: change.stateCategory,
        assigneeId: change.assigneeId,
        parentId: change.parentId,
        cycleId: change.cycleId,
        milestoneId: change.milestoneId,
        startDate: change.startDate,
        dueDate: change.dueDate,
        version: change.version,
    };
    return { ...current, items };
}

/** A row removed from a cached calendar (an optimistic delete); `null` when it was not there. */
export function removeRowFromCalendar(current: CalendarResponse, id: string): CalendarResponse | null {
    if (!current.items.some((i) => i.id === id)) return null;
    return { ...current, items: current.items.filter((i) => i.id !== id) };
}

/** New dates for held rows (a change of dates shown before it is sent, and put back by Undo). */
export function withCalendarDates(
    current: CalendarResponse,
    changes: ReadonlyArray<{ id: string; startDate: string | null; dueDate: string | null; version?: number }>,
): CalendarResponse {
    const byId = new Map(changes.map((c) => [c.id, c]));
    if (!current.items.some((i) => byId.has(i.id))) return current;
    return {
        ...current,
        items: current.items.map((i) => {
            const c = byId.get(i.id);
            return c ? { ...i, startDate: c.startDate, dueDate: c.dueDate, version: c.version ?? i.version } : i;
        }),
    };
}
