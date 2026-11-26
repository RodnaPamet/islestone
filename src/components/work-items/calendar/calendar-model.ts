/**
 * The calendar view's model (roadmap 3.3a): pure, unit-tested, and deciding
 * nothing the server or the timeline already decides.
 *
 *   - `gridWindow`: the month grid's 42 days as the read's window.
 *   - `itemsByDay`: the items on their due dates in the window, open items
 *     first, then by key.
 *   - `cyclesByDay` / `markersByDay`: the cycle bands and the milestone and
 *     project due-date diamonds of each day.
 *   - `dayKind`: a holiday or a non-working weekday of the scope's working
 *     calendar (3.1a), for the shading.
 *   - `movableItems`: which chips may be dragged, through the timeline's own
 *     `editableRows` (3.1c), never a second rule. The calendar read has no
 *     schedule, so a parent whose dates follow its sub-items is not known to
 *     be one here: the move asks `editableRows` again on the project's
 *     timeline before it opens "Change dates".
 *
 * Written fresh for Islestone.
 */
import type { WorkflowStateCategory } from '@prisma/client';

import { fromEpochDay, isoWeekday, toEpochDay, type IsoWeekday } from '@/app-layer/domain/schedule/calendar';
import { WEEK_STARTS_ON } from '@/components/ui/date-picker/week-start';
import type { CalendarCycle, CalendarItem, CalendarMilestone, CalendarProject, CalendarResponse } from '@/lib/work-items/calendar';
import type { TimelineResponse, TimelineRow } from '@/lib/work-items/timeline';

import { editableRows } from '../timeline/timeline-model';

const DAY_MS = 86_400_000;
/** The grid always has six rows, so its height never jumps between months. */
export const GRID_CELLS = 42;

/**
 * The instants the 42-cell grid covers for `month`: from 00:00 UTC of its
 * first cell (the week start from the mirrored `week-start.ts`) to the last
 * millisecond of its last cell. Copied from inflect-compliance's
 * `CalendarMonth.monthGridRange` (5528464, BUSL-1.1), unchanged in substance.
 */
export function monthGridRange(month: Date): { from: Date; to: Date } {
    const monthStart = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
    const lead = (monthStart.getUTCDay() - WEEK_STARTS_ON + 7) % 7;
    const fromMs = monthStart.getTime() - lead * DAY_MS;
    return { from: new Date(fromMs), to: new Date(fromMs + GRID_CELLS * DAY_MS - 1) };
}

/** The read's window for a month: the grid's first and last day, `YYYY-MM-DD`. */
export function gridWindow(month: Date): { from: string; to: string } {
    const { from, to } = monthGridRange(month);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/** The first of the month `n` months after `month` (UTC). */
export function addMonths(month: Date, n: number): Date {
    return new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + n, 1));
}

/** The first of the month a `YYYY-MM-DD` falls in (UTC). */
export function monthOf(ymd: string): Date {
    return new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, 1));
}

const CATEGORY_ORDER: Record<WorkflowStateCategory, number> = { STARTED: 0, UNSTARTED: 1, BACKLOG: 2, DONE: 3, CANCELLED: 4 };

/** A closed item is shown done: struck through and muted. */
export function isClosed(category: WorkflowStateCategory): boolean {
    return category === 'DONE' || category === 'CANCELLED';
}

/** Key order within a project's prefix by number, then byte order (never `localeCompare`). */
function compareKeys(a: string, b: string): number {
    const [pa, na] = [a.replace(/-\d+$/, ''), Number(a.slice(a.lastIndexOf('-') + 1))];
    const [pb, nb] = [b.replace(/-\d+$/, ''), Number(b.slice(b.lastIndexOf('-') + 1))];
    if (pa !== pb) return pa < pb ? -1 : 1;
    return na - nb;
}

/** The items due on each day of `[from, to]`: open items first (started, then not started), then by key. */
export function itemsByDay(items: readonly CalendarItem[], window: { from: string; to: string }): Map<string, CalendarItem[]> {
    const out = new Map<string, CalendarItem[]>();
    for (const item of items) {
        if (!item.dueDate || item.dueDate < window.from || item.dueDate > window.to) continue;
        const list = out.get(item.dueDate) ?? [];
        list.push(item);
        out.set(item.dueDate, list);
    }
    for (const list of out.values()) list.sort((a, b) => CATEGORY_ORDER[a.stateCategory] - CATEGORY_ORDER[b.stateCategory] || compareKeys(a.key, b.key));
    return out;
}

/** The cycles covering each day of the window, in start order. */
export function cyclesByDay(cycles: readonly CalendarCycle[], window: { from: string; to: string }): Map<string, CalendarCycle[]> {
    const out = new Map<string, CalendarCycle[]>();
    const sorted = [...cycles].sort((a, b) => (a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : a.id < b.id ? -1 : 1));
    const from = toEpochDay(window.from);
    const to = toEpochDay(window.to);
    for (const c of sorted) {
        for (let d = Math.max(from, toEpochDay(c.startsOn)); d <= Math.min(to, toEpochDay(c.endsOn)); d++) {
            const ymd = fromEpochDay(d);
            const list = out.get(ymd) ?? [];
            list.push(c);
            out.set(ymd, list);
        }
    }
    return out;
}

/** A diamond on a day: a milestone's due date or a project's. */
export interface CalendarMarker {
    kind: 'milestone' | 'project';
    id: string;
    /** The milestone's name, or the project's. */
    label: string;
    /** The project's key prefix (the milestone's project). */
    keyPrefix: string;
    /** For a milestone, its id; for a project, `null`. */
    milestoneId: string | null;
}

/** The markers due on each day of the window: milestones first, then projects, each by label. */
export function markersByDay(
    milestones: readonly CalendarMilestone[],
    projects: readonly CalendarProject[],
    window: { from: string; to: string },
): Map<string, CalendarMarker[]> {
    const out = new Map<string, CalendarMarker[]>();
    const byProject = new Map(projects.map((p) => [p.id, p]));
    const add = (ymd: string, m: CalendarMarker) => {
        if (ymd < window.from || ymd > window.to) return;
        const list = out.get(ymd) ?? [];
        list.push(m);
        out.set(ymd, list);
    };
    for (const m of milestones) {
        const p = byProject.get(m.projectId);
        if (p) add(m.dueDate, { kind: 'milestone', id: m.id, label: m.name, keyPrefix: p.keyPrefix, milestoneId: m.id });
    }
    for (const p of projects) if (p.dueDate) add(p.dueDate, { kind: 'project', id: p.id, label: p.name, keyPrefix: p.keyPrefix, milestoneId: null });
    for (const list of out.values()) list.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'milestone' ? -1 : 1) : a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    return out;
}

/** A holiday, a non-working weekday, or a working day of the scope's calendar. */
export function dayKind(ymd: string, calendar: CalendarResponse['calendar']): 'holiday' | 'nonWorking' | null {
    if (calendar.holidays.includes(ymd)) return 'holiday';
    const weekday: IsoWeekday = isoWeekday(toEpochDay(ymd));
    return calendar.workingWeekdays.includes(weekday) ? null : 'nonWorking';
}

/** A calendar item as the timeline's row shape (what `editableRows` reads). */
export function asTimelineRow(item: CalendarItem): TimelineRow {
    return {
        id: item.id,
        key: item.key,
        title: item.title,
        projectId: item.projectId,
        teamId: item.teamId,
        typeId: item.typeId,
        stateCategory: item.stateCategory,
        assigneeId: item.assigneeId,
        parentId: item.parentId,
        sortKey: '',
        startDate: item.startDate,
        dueDate: item.dueDate,
        actualStart: null,
        actualFinish: null,
        milestoneId: item.milestoneId,
        calendarId: '',
        version: item.version,
        context: false,
    };
}

/**
 * The chips a person may drag or "Move to date…" (decision 241): the
 * timeline's `editableRows` over the calendar's items (3.1c's rule: a caller
 * who edits work items, an open or started item of an unarchived project
 * whose type shows the dates it carries).
 */
export function movableItems(
    resp: CalendarResponse,
    options: { canEdit: boolean; hiddenDates: (row: TimelineRow) => { startDate: boolean; dueDate: boolean } },
): ReadonlySet<string> {
    const asTimeline: TimelineResponse = {
        asOf: resp.asOf,
        rows: resp.items.map(asTimelineRow),
        edges: [],
        calendars: [],
        milestones: [],
        projects: resp.projects.map((p) => ({ id: p.id, name: p.name, keyPrefix: p.keyPrefix, dueDate: p.dueDate, archived: p.archived })),
        hiddenDependencies: 0,
        omittedContextRows: 0,
        // No schedule is read here: no row is known to be a summary until the project's timeline is.
        schedule: { ok: false, error: 'TOO_LARGE', items: 0, limit: 0 },
    };
    return editableRows(asTimeline, options).dates;
}
