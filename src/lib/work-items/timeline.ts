/**
 * The timeline's read model (roadmap 3.1b; ADR 0010; owner decisions 184 to
 * 198). Client-safe on purpose: the server builds a `TimelineData` from its
 * reads and runs the engine through `computeTimelineSchedule`; the browser
 * runs the SAME function over its cached copy when a write changes a row
 * (decision 197: one module, no second implementation). Nothing here reads a
 * database, a clock or a time zone.
 *
 *   - **Scope rows** are the items the list's filters select (at most
 *     `TIMELINE_ITEM_LIMIT`, decision 196); **context rows** are visible items
 *     outside the scope that block or are blocked by a scope row, read-only
 *     and greyed, at most `TIMELINE_CONTEXT_LIMIT`.
 *   - **Cancelled items** are shown, never scheduled: they and their
 *     relations are left out of the engine's input (decision 187).
 *   - **A parent** is a summary only when it is a scope row too (decision
 *     186); a context row is never a parent in the engine's input.
 *
 * Written fresh for Islestone.
 */
import type { WorkflowStateCategory } from '@prisma/client';

import { computeSchedule } from '@/app-layer/domain/schedule/engine';
import { toEpochDay, type IsoWeekday } from '@/app-layer/domain/schedule/calendar';
import type { ScheduleInput, ScheduleItem, ScheduleItemStatus, ScheduleResult } from '@/app-layer/domain/schedule/types';

/** At most this many items in one timeline; above it the read refuses with the count (decision 196). */
export const TIMELINE_ITEM_LIMIT = 5_000;
/** Visible items outside the scope shown because a relation reaches them. */
export const TIMELINE_CONTEXT_LIMIT = 500;
/** Blocks relations read for one timeline; above it the read refuses, never cuts. */
export const TIMELINE_EDGE_LIMIT = 25_000;

/** One item on the timeline (a scope row, or a context row with `context: true`). */
export interface TimelineRow {
    id: string;
    key: string;
    title: string;
    projectId: string;
    teamId: string;
    typeId: string;
    stateCategory: WorkflowStateCategory;
    assigneeId: string | null;
    /** The stored parent, whatever the scope (the engine reads it only when the parent is a scope row). */
    parentId: string | null;
    sortKey: string;
    /** `YYYY-MM-DD`, date-only. */
    startDate: string | null;
    dueDate: string | null;
    /** When it started and finished, in its calendar's time zone (decision 187), `YYYY-MM-DD`. */
    actualStart: string | null;
    actualFinish: string | null;
    milestoneId: string | null;
    /** The working calendar its days count on: its team's, else the workspace's. */
    calendarId: string;
    version: number;
    /** Outside the scope, shown because a relation reaches it: greyed and read-only. */
    context: boolean;
}

export interface TimelineCalendar {
    id: string;
    /** `null`: the workspace's calendar (or its Monday-to-Friday default). */
    teamId: string | null;
    timeZone: string;
    workingWeekdays: IsoWeekday[];
    /** `YYYY-MM-DD`. */
    holidays: string[];
}

/** A blocks relation: `fromId` must finish before `toId` starts (decision 183). */
export interface TimelineEdge {
    id: string;
    fromId: string;
    toId: string;
}

export interface TimelineMilestone {
    id: string;
    projectId: string;
    name: string;
    dueDate: string | null;
}

export interface TimelineProject {
    id: string;
    name: string;
    keyPrefix: string;
    dueDate: string | null;
    archived: boolean;
}

/** What the timeline read returns before the engine runs (the engine's whole input, and the rows to draw). */
export interface TimelineData {
    /** Today in the workspace calendar's time zone (decision 191), `YYYY-MM-DD`. */
    asOf: string;
    rows: TimelineRow[];
    edges: TimelineEdge[];
    calendars: TimelineCalendar[];
    milestones: TimelineMilestone[];
    projects: TimelineProject[];
    /** Relations to items the caller cannot see (a deleted item, a project it does not see): counted, never named. */
    hiddenDependencies: number;
    /** Visible items outside the scope past `TIMELINE_CONTEXT_LIMIT`: counted, not drawn. */
    omittedContextRows: number;
}

/** `GET /work-items/timeline`: the data and the engine's answer over it. */
export interface TimelineResponse extends TimelineData {
    schedule: ScheduleResult;
}

/** The refusal's code when a scope holds more than `TIMELINE_ITEM_LIMIT` items (or more relations than `TIMELINE_EDGE_LIMIT`). */
export const TIMELINE_TOO_LARGE = 'TIMELINE_TOO_LARGE' as const;

export interface TimelineTooLargeDetails {
    reason: typeof TIMELINE_TOO_LARGE;
    /** How many there are (items, or relations when `what` says so). */
    count: number;
    limit: number;
    what: 'items' | 'relations';
}

/** An item's state as the engine reads it; `null` for a cancelled item, which is not scheduled (decision 187). */
export function scheduleStatusOf(category: WorkflowStateCategory): ScheduleItemStatus | null {
    switch (category) {
        case 'BACKLOG':
        case 'UNSTARTED':
            return 'open';
        case 'STARTED':
            return 'started';
        case 'DONE':
            return 'done';
        case 'CANCELLED':
            return null;
    }
}

const dayOrNull = (value: string | null | undefined): number | null => (value ? toEpochDay(value) : null);

/**
 * The engine's input for a timeline: every row but the cancelled ones, each
 * relation between two rows passed, every calendar the rows name. Context
 * rows never parent anything (a scope row's parent counts only when it is a
 * scope row passed too).
 */
export function scheduleInputOf(data: TimelineData): ScheduleInput {
    const passed = new Map<string, TimelineRow>();
    for (const row of data.rows) if (scheduleStatusOf(row.stateCategory) !== null) passed.set(row.id, row);
    const milestoneDue = new Map(data.milestones.map((m) => [m.id, dayOrNull(m.dueDate)]));
    const projectDue = new Map(data.projects.map((p) => [p.id, dayOrNull(p.dueDate)]));
    const items: ScheduleItem[] = [];
    for (const row of passed.values()) {
        const parent = row.parentId ? passed.get(row.parentId) : undefined;
        items.push({
            id: row.id,
            calendarId: row.calendarId,
            parentId: !row.context && parent && !parent.context ? parent.id : null,
            plannedStart: dayOrNull(row.startDate),
            plannedFinish: dayOrNull(row.dueDate),
            status: scheduleStatusOf(row.stateCategory)!,
            actualStart: dayOrNull(row.actualStart),
            actualFinish: dayOrNull(row.actualFinish),
            milestoneDue: row.milestoneId ? milestoneDue.get(row.milestoneId) ?? null : null,
            projectDue: projectDue.get(row.projectId) ?? null,
        });
    }
    // One edge per pair: the engine reads blocks as finish-to-start, so a duplicate adds nothing.
    const seen = new Set<string>();
    const edges = [];
    for (const e of data.edges) {
        if (!passed.has(e.fromId) || !passed.has(e.toId) || e.fromId === e.toId) continue;
        const k = `${e.fromId}\u0000${e.toId}`;
        if (seen.has(k)) continue;
        seen.add(k);
        edges.push({ from: e.fromId, to: e.toId });
    }
    const used = new Set(items.map((i) => i.calendarId));
    const calendars = data.calendars
        .filter((c) => used.has(c.id))
        .map((c) => ({ id: c.id, workingWeekdays: c.workingWeekdays, holidays: c.holidays.map((h) => toEpochDay(h)) }));
    return { asOf: toEpochDay(data.asOf), calendars, items, edges };
}

/** Run the engine over a timeline: what the server returns and what the browser re-runs. */
export function computeTimelineSchedule(data: TimelineData): ScheduleResult {
    return computeSchedule(scheduleInputOf(data));
}

/** The fields of a row a write can change and the timeline draws. */
export interface TimelineRowChange {
    id: string;
    title: string;
    stateCategory: WorkflowStateCategory;
    assigneeId: string | null;
    parentId: string | null;
    startDate: string | null;
    dueDate: string | null;
    milestoneId: string | null;
    version: number;
}

/**
 * A write placed in a cached timeline (`work-item-cache.ts`): the row's new
 * fields, then the engine re-run. `null` when the row is not on the timeline
 * (the caller re-reads it then: a row entering the scope cannot be placed
 * from here). A move into a started or done state takes today as its actual
 * date, as the server's `startedAt` / `completedAt` would.
 */
export function placeRowInTimeline(current: TimelineResponse, change: TimelineRowChange): TimelineResponse | null {
    const index = current.rows.findIndex((r) => r.id === change.id);
    if (index === -1) return null;
    const before = current.rows[index]!;
    const wasStatus = scheduleStatusOf(before.stateCategory);
    const isStatus = scheduleStatusOf(change.stateCategory);
    const actualStart =
        isStatus === 'started' || isStatus === 'done' ? (before.actualStart ?? current.asOf) : null;
    const actualFinish = isStatus === 'done' ? (wasStatus === 'done' ? before.actualFinish : current.asOf) : null;
    const row: TimelineRow = {
        ...before,
        title: change.title,
        stateCategory: change.stateCategory,
        assigneeId: change.assigneeId,
        parentId: change.parentId,
        startDate: change.startDate,
        dueDate: change.dueDate,
        milestoneId: change.milestoneId,
        version: change.version,
        actualStart,
        actualFinish,
    };
    const rows = [...current.rows];
    rows[index] = row;
    const { schedule: _old, ...rest } = current;
    void _old;
    const data: TimelineData = { ...rest, rows };
    return { ...data, schedule: computeTimelineSchedule(data) };
}

/** A row removed from a cached timeline (an optimistic delete), the engine re-run. */
export function removeRowFromTimeline(current: TimelineResponse, id: string): TimelineResponse | null {
    if (!current.rows.some((r) => r.id === id)) return null;
    const { schedule: _old, ...rest } = current;
    void _old;
    const data: TimelineData = {
        ...rest,
        rows: current.rows.filter((r) => r.id !== id),
        edges: current.edges.filter((e) => e.fromId !== id && e.toId !== id),
    };
    return { ...data, schedule: computeTimelineSchedule(data) };
}

/** New dates for rows of a cached timeline: what a change of dates (3.1c) previews and places. */
export interface TimelineDateChange {
    id: string;
    startDate: string | null;
    dueDate: string | null;
    /** The version the server answered with, when it has. */
    version?: number;
}

/**
 * Rows given new dates, the engine re-run (3.1c): the browser's preview of a
 * change before it is sent (decision 197), and its optimistic placement. A
 * change naming a row the timeline does not hold is ignored.
 */
export function withRowDates(current: TimelineResponse, changes: readonly TimelineDateChange[]): TimelineResponse {
    const byId = new Map(changes.map((c) => [c.id, c]));
    const { schedule: _old, ...rest } = current;
    void _old;
    const data: TimelineData = {
        ...rest,
        rows: current.rows.map((r) => {
            const c = byId.get(r.id);
            return c ? { ...r, startDate: c.startDate, dueDate: c.dueDate, version: c.version ?? r.version } : r;
        }),
    };
    return { ...data, schedule: computeTimelineSchedule(data) };
}

/** A relation taken out of a cached timeline (its removal behind the undo toast, 3.1c), the engine re-run. */
export function withoutEdge(current: TimelineResponse, edgeId: string): TimelineResponse {
    const { schedule: _old, ...rest } = current;
    void _old;
    const data: TimelineData = { ...rest, edges: current.edges.filter((e) => e.id !== edgeId) };
    return { ...data, schedule: computeTimelineSchedule(data) };
}

/** A relation put back into a cached timeline (an undone removal), the engine re-run. */
export function withEdge(current: TimelineResponse, edge: TimelineEdge): TimelineResponse {
    if (current.edges.some((e) => e.id === edge.id)) return current;
    const { schedule: _old, ...rest } = current;
    void _old;
    const data: TimelineData = { ...rest, edges: [...current.edges, edge] };
    return { ...data, schedule: computeTimelineSchedule(data) };
}
