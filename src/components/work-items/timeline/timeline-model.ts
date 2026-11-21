/**
 * The timeline's view model (roadmap 3.1b): pure, so the chart, the schedule
 * table and the summary line are built from ONE reading of the server's
 * answer and tested without a browser. It decides nothing about the
 * schedule: every float, finish, critical item and conflict is the engine's
 * (`TimelineResponse.schedule`, decision 197); this module only lays the
 * rows out.
 *
 *   - **A leaf's bar is its stored dates** (decision 184: the timeline shows
 *     what people planned and reports what does not fit): start to due; one
 *     date, one day on it; reversed dates, one day at the due date (the
 *     engine's `DATES_REVERSED`). A done item's bar is its actual dates.
 *   - **A summary's bar is the engine's span of its sub-items** (decision
 *     186), never derived by the widget.
 *   - **Neither date** puts the item in the "No dates" list (decision 185).
 *     Cancelled items are in the table, greyed, with no bar (decision 187).
 *   - **Several projects** are grouped under one summary row each; their
 *     milestones' and the project's due dates are diamonds at the top of the
 *     group (decision 188). Context rows sit in their own group at the end.
 *   - **Critical links** are named by relation id for one CSS rule each;
 *     an id that is not a plain cuid is never put in a selector.
 *
 * Written fresh for Islestone.
 */
import { fromEpochDay, toEpochDay, compileCalendar, workingDaysInclusive, type EpochDay, type IsoWeekday } from '@/app-layer/domain/schedule/calendar';
import type { ItemSchedule, ScheduleConflict } from '@/app-layer/domain/schedule/types';
import { scheduleStatusOf, type TimelineResponse, type TimelineRow } from '@/lib/work-items/timeline';

export type TimelineZoom = 'day' | 'week' | 'month' | 'quarter';

/** One row the chart draws (handed to the adapter, which maps it to the widget's shape). */
export interface ChartTask {
    id: string;
    /** `0` for a top-level row. */
    parent: string | 0;
    type: 'task' | 'summary' | 'milestone';
    text: string;
    /** The key, or '' for a group or a diamond. */
    key: string;
    /** First day of the bar, `YYYY-MM-DD`. */
    start: string;
    /** Last day of the bar (inclusive), `YYYY-MM-DD`; equals `start` for a diamond. */
    end: string;
    kind: 'item' | 'project' | 'context-group' | 'milestone' | 'project-due';
    critical: boolean;
    late: boolean;
    lateDays: number;
    conflicts: readonly ScheduleConflict[];
    /** Outside the scope: greyed, read-only. */
    context: boolean;
    done: boolean;
    /** Float in working days (the grid's column); `null` for groups and diamonds. */
    totalFloat: number | null;
}

export interface ChartLink {
    id: string;
    source: string;
    target: string;
}

/** One row of the schedule table (decision 203): the same rows and numbers as the chart. */
export interface ScheduleTableRow {
    id: string;
    key: string;
    title: string;
    stateCategory: TimelineRow['stateCategory'];
    startDate: string | null;
    dueDate: string | null;
    earliestStart: string | null;
    earliestFinish: string | null;
    latestStart: string | null;
    latestFinish: string | null;
    totalFloat: number | null;
    lateDays: number;
    critical: boolean;
    summary: boolean;
    unscheduled: boolean;
    cancelled: boolean;
    context: boolean;
    conflicts: readonly ScheduleConflict[];
}

export interface TimelineSummary {
    /** The latest earliest finish in view; `null` when nothing is scheduled. */
    finish: string | null;
    criticalCount: number;
    lateCount: number;
    /** On a one-project timeline with a due date: the date, and the working days the finish passes it by. */
    projectDue: { dueDate: string; lateDays: number } | null;
    /** An open or started item has dates: without one there is no critical path to show ("Add dates…"). */
    hasDatedOpenItem: boolean;
}

export interface TimelineModel {
    ok: true;
    tasks: ChartTask[];
    links: ChartLink[];
    criticalLinkIds: string[];
    noDates: ScheduleTableRow[];
    table: ScheduleTableRow[];
    summary: TimelineSummary;
    /** The span the chart shows, `YYYY-MM-DD`, inclusive. */
    range: { start: string; end: string };
    asOf: string;
    /** Every day that is non-working on EVERY calendar in view (the shading), as epoch days within the range. */
    nonWorkingEveryCalendar: ReadonlySet<EpochDay>;
}

export interface TimelineModelError {
    ok: false;
    error: 'CYCLE' | 'TOO_LARGE';
    /** The keys of a cycle's items, in order. */
    cycleKeys: string[];
}

export interface TimelineModelOptions {
    /** The page's fixed project: no project group rows. */
    scopeProjectId?: string;
    showCriticalPath: boolean;
}

/** A relation id safe to put in a CSS attribute selector (a cuid). */
export const SAFE_LINK_ID = /^[a-z0-9]+$/;

const minDay = (a: string, b: string) => (a < b ? a : b);
const maxDay = (a: string, b: string) => (a > b ? a : b);
const addDays = (day: string, n: number) => fromEpochDay(toEpochDay(day) + n);
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The days a leaf's bar covers (decision 184), or `null` when it has no date to draw. */
export function leafSpan(row: TimelineRow): { start: string; end: string } | null {
    if (row.stateCategory === 'DONE') {
        const start = row.actualStart ?? row.startDate ?? row.actualFinish ?? row.dueDate;
        const end = row.actualFinish ?? row.dueDate ?? start;
        if (!start || !end) return null;
        return start <= end ? { start, end } : { start: end, end };
    }
    const { startDate: s, dueDate: d } = row;
    if (s && d) return s <= d ? { start: s, end: d } : { start: d, end: d };
    if (s) return { start: s, end: s };
    if (d) return { start: d, end: d };
    return null;
}

function tableRowOf(row: TimelineRow, sched: ItemSchedule | undefined): ScheduleTableRow {
    const cancelled = scheduleStatusOf(row.stateCategory) === null;
    const has = sched && !sched.unscheduled;
    return {
        id: row.id,
        key: row.key,
        title: row.title,
        stateCategory: row.stateCategory,
        startDate: row.startDate,
        dueDate: row.dueDate,
        earliestStart: has ? fromEpochDay(sched.earliestStart) : null,
        earliestFinish: has ? fromEpochDay(sched.earliestFinish) : null,
        latestStart: has ? fromEpochDay(sched.latestStart) : null,
        latestFinish: has ? fromEpochDay(sched.latestFinish) : null,
        totalFloat: has && row.stateCategory !== 'DONE' ? sched.totalFloat : null,
        lateDays: sched?.lateDays ?? 0,
        critical: sched?.critical ?? false,
        summary: sched?.summary ?? false,
        unscheduled: cancelled ? false : (sched?.unscheduled ?? true),
        cancelled,
        context: row.context,
        conflicts: sched?.conflicts ?? [],
    };
}

/** Rows in manual order: `sortKey`, then id (compared with `<`, never `localeCompare`). */
function byManualOrder(a: TimelineRow, b: TimelineRow): number {
    return compareText(a.sortKey, b.sortKey) || compareText(a.id, b.id);
}

export function buildTimelineModel(resp: TimelineResponse, options: TimelineModelOptions): TimelineModel | TimelineModelError {
    if (!resp.schedule.ok) {
        const byId = new Map(resp.rows.map((r) => [r.id, r.key]));
        return {
            ok: false,
            error: resp.schedule.error,
            cycleKeys: resp.schedule.error === 'CYCLE' ? resp.schedule.cycle.map((id) => byId.get(id) ?? id) : [],
        };
    }
    const schedule = resp.schedule;
    const sched = new Map(schedule.items.map((i) => [i.id, i]));
    const rowsById = new Map(resp.rows.map((r) => [r.id, r]));
    const showCritical = options.showCriticalPath;

    // The table: scope rows in manual order, then the context rows.
    const scopeRows = resp.rows.filter((r) => !r.context).sort(byManualOrder);
    const contextRows = resp.rows.filter((r) => r.context).sort(byManualOrder);
    const table = [...scopeRows, ...contextRows].map((r) => tableRowOf(r, sched.get(r.id)));

    // Bars: a summary spans the engine's result; a leaf its own dates.
    const spans = new Map<string, { start: string; end: string }>();
    const noDates: ScheduleTableRow[] = [];
    for (const row of [...scopeRows, ...contextRows]) {
        const s = sched.get(row.id);
        if (!s) continue; // cancelled: table only
        if (s.summary) {
            if (!s.unscheduled) spans.set(row.id, { start: fromEpochDay(s.earliestStart), end: fromEpochDay(s.earliestFinish) });
            else if (!row.context) noDates.push(tableRowOf(row, s));
            continue;
        }
        const span = leafSpan(row);
        if (span) spans.set(row.id, span);
        else if (!row.context) noDates.push(tableRowOf(row, s));
    }

    // Groups: one per project on a several-project timeline, and one for context rows.
    const projectsInView = [...new Set(scopeRows.map((r) => r.projectId))];
    const grouped = !options.scopeProjectId && projectsInView.length > 1;
    const projectsById = new Map(resp.projects.map((p) => [p.id, p]));
    const groupOf = (row: TimelineRow): string | 0 => (row.context ? 'context-group' : grouped ? `project:${row.projectId}` : 0);

    const tasks: ChartTask[] = [];
    const base = { critical: false, late: false, lateDays: 0, conflicts: [] as readonly ScheduleConflict[], context: false, done: false, totalFloat: null };
    const itemTask = (row: TimelineRow): ChartTask => {
        const s = sched.get(row.id)!;
        const span = spans.get(row.id)!;
        const parentRow = row.parentId ? rowsById.get(row.parentId) : undefined;
        const parent = parentRow && !row.context && spans.has(parentRow.id) && !parentRow.context ? parentRow.id : groupOf(row);
        return {
            id: row.id,
            parent,
            type: s.summary ? 'summary' : 'task',
            text: row.title,
            key: row.key,
            start: span.start,
            end: span.end,
            kind: 'item',
            critical: showCritical && s.critical,
            late: s.lateDays > 0,
            lateDays: s.lateDays,
            conflicts: s.conflicts,
            context: row.context,
            done: row.stateCategory === 'DONE',
            totalFloat: row.stateCategory === 'DONE' ? null : s.totalFloat,
        };
    };

    const diamondsFor = (projectId: string, parent: string | 0): ChartTask[] => {
        const out: ChartTask[] = [];
        const project = projectsById.get(projectId);
        if (project?.dueDate) {
            out.push({ ...base, id: `project-due:${projectId}`, parent, type: 'milestone', text: project.name, key: '', start: project.dueDate, end: project.dueDate, kind: 'project-due' });
        }
        const dated = resp.milestones
            .filter((m) => m.projectId === projectId && m.dueDate)
            .sort((a, b) => compareText(a.dueDate!, b.dueDate!) || compareText(a.id, b.id));
        for (const m of dated) {
            out.push({ ...base, id: `milestone:${m.id}`, parent, type: 'milestone', text: m.name, key: '', start: m.dueDate!, end: m.dueDate!, kind: 'milestone' });
        }
        return out;
    };

    const scopeTasks = scopeRows.filter((r) => spans.has(r.id)).map(itemTask);
    if (grouped) {
        const order = [...projectsInView].sort((a, b) => compareText(projectsById.get(a)?.name ?? a, projectsById.get(b)?.name ?? b) || compareText(a, b));
        for (const projectId of order) {
            const id = `project:${projectId}`;
            const members = scopeTasks.filter((t) => t.parent === id);
            const diamonds = diamondsFor(projectId, id);
            const all = [...members, ...diamonds];
            if (all.length === 0) continue;
            const start = all.map((t) => t.start).reduce(minDay);
            const end = all.map((t) => t.end).reduce(maxDay);
            tasks.push({ ...base, id, parent: 0, type: 'summary', text: projectsById.get(projectId)?.name ?? projectId, key: projectsById.get(projectId)?.keyPrefix ?? '', start, end, kind: 'project' });
            tasks.push(...diamonds);
            tasks.push(...scopeTasks.filter((t) => rowsById.get(t.id)?.projectId === projectId));
        }
    } else {
        for (const projectId of projectsInView) tasks.push(...diamondsFor(projectId, 0));
        tasks.push(...scopeTasks);
    }
    const contextTasks = contextRows.filter((r) => spans.has(r.id)).map(itemTask);
    if (contextTasks.length > 0) {
        const start = contextTasks.map((t) => t.start).reduce(minDay);
        const end = contextTasks.map((t) => t.end).reduce(maxDay);
        tasks.push({ ...base, id: 'context-group', parent: 0, type: 'summary', text: '', key: '', start, end, kind: 'context-group', context: true });
        tasks.push(...contextTasks);
    }

    const ordered = treeOrder(tasks);
    tasks.length = 0;
    tasks.push(...ordered);

    // Links: every relation whose two ends are drawn.
    const drawn = new Set(tasks.map((t) => t.id));
    const links: ChartLink[] = resp.edges.filter((e) => drawn.has(e.fromId) && drawn.has(e.toId)).map((e) => ({ id: e.id, source: e.fromId, target: e.toId }));
    const criticalPairs = new Set(schedule.criticalEdges.map((e) => `${e.from}\u0000${e.to}`));
    const criticalLinkIds = showCritical
        ? links.filter((l) => criticalPairs.has(`${l.source}\u0000${l.target}`) && SAFE_LINK_ID.test(l.id)).map((l) => l.id)
        : [];

    // The summary line.
    const openScheduled = schedule.items.filter((i) => {
        const row = rowsById.get(i.id);
        const st = row ? scheduleStatusOf(row.stateCategory) : null;
        return row && !row.context && !i.summary && !i.unscheduled && (st === 'open' || st === 'started');
    });
    const scopeItems = schedule.items.filter((i) => !rowsById.get(i.id)?.context);
    const anyScheduled = scopeItems.some((i) => !i.unscheduled);
    const finish = anyScheduled ? fromEpochDay(Math.max(...scopeItems.filter((i) => !i.unscheduled).map((i) => i.earliestFinish))) : null;
    const workspaceCal = resp.calendars.find((c) => c.teamId === null) ?? resp.calendars[0];
    let projectDue: TimelineSummary['projectDue'] = null;
    const singleProject = options.scopeProjectId ?? (projectsInView.length === 1 ? projectsInView[0] : undefined);
    const dueDate = singleProject ? projectsById.get(singleProject)?.dueDate : null;
    if (dueDate) {
        let lateDays = 0;
        if (finish && finish > dueDate && workspaceCal) {
            const compiled = compileCalendar({ id: workspaceCal.id, workingWeekdays: workspaceCal.workingWeekdays, holidays: workspaceCal.holidays.map(toEpochDay) });
            lateDays = workingDaysInclusive(compiled, toEpochDay(dueDate) + 1, toEpochDay(finish));
        }
        projectDue = { dueDate, lateDays };
    }
    const summary: TimelineSummary = {
        finish,
        criticalCount: scopeItems.filter((i) => i.critical).length,
        lateCount: scopeItems.filter((i) => i.lateDays > 0).length,
        projectDue,
        hasDatedOpenItem: openScheduled.length > 0,
    };

    // The span the chart shows: every bar and today, with a margin.
    const bounds = tasks.length > 0 ? { start: tasks.map((t) => t.start).reduce(minDay), end: tasks.map((t) => t.end).reduce(maxDay) } : { start: resp.asOf, end: resp.asOf };
    const range = { start: addDays(minDay(bounds.start, resp.asOf), -3), end: addDays(maxDay(bounds.end, resp.asOf), 21) };

    return {
        ok: true,
        tasks,
        links,
        criticalLinkIds,
        noDates,
        table,
        summary,
        range,
        asOf: resp.asOf,
        nonWorkingEveryCalendar: nonWorkingEverywhere(resp, range),
    };
}

/** Parents before their children, siblings in the order given (the widget builds its tree from `parent`). */
export function treeOrder(tasks: readonly ChartTask[]): ChartTask[] {
    const ids = new Set(tasks.map((t) => t.id));
    const children = new Map<string | 0, ChartTask[]>();
    for (const t of tasks) {
        const parent = t.parent !== 0 && ids.has(t.parent) ? t.parent : 0;
        const list = children.get(parent) ?? [];
        list.push(parent === t.parent ? t : { ...t, parent: 0 });
        children.set(parent, list);
    }
    const out: ChartTask[] = [];
    const stack: ChartTask[] = [...(children.get(0) ?? [])].reverse();
    while (stack.length > 0) {
        const t = stack.pop()!;
        out.push(t);
        const kids = children.get(t.id);
        if (kids) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
    }
    return out;
}

/**
 * The days in `range` that are non-working on every calendar the rows count
 * on (with several calendars in view, a day one team works is not shaded).
 */
export function nonWorkingEverywhere(resp: TimelineResponse, range: { start: string; end: string }): ReadonlySet<EpochDay> {
    const used = new Set(resp.rows.map((r) => r.calendarId));
    const calendars = resp.calendars.filter((c) => used.has(c.id));
    const list = calendars.length > 0 ? calendars : resp.calendars;
    const out = new Set<EpochDay>();
    if (list.length === 0) return out;
    const compiled = list.map((c) => ({
        weekdays: new Set<IsoWeekday>(c.workingWeekdays),
        holidays: new Set(c.holidays.map(toEpochDay)),
    }));
    const from = toEpochDay(range.start);
    const to = toEpochDay(range.end);
    // Bounded: the range is the bars' span plus margins (at most a few years of days).
    for (let d = from; d <= to && d - from < 3660; d++) {
        const weekday = (((((d + 3) % 7) + 7) % 7) + 1) as IsoWeekday;
        if (compiled.every((c) => !c.weekdays.has(weekday) || c.holidays.has(d))) out.add(d);
    }
    return out;
}

/** Does the chart cell starting on `cellStart` (a local `Date`) of `unit` contain the epoch day `day`? */
export function cellContainsDay(cellStart: Date, unit: string, day: EpochDay): boolean {
    const y = cellStart.getFullYear();
    const m = cellStart.getMonth();
    const first = toEpochDay(`${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(cellStart.getDate()).padStart(2, '0')}`);
    switch (unit) {
        case 'day':
            return first === day;
        case 'week':
            return day >= first && day < first + 7;
        case 'month': {
            const next = toEpochDay(fromLocalParts(m === 11 ? y + 1 : y, m === 11 ? 0 : m + 1));
            return day >= first && day < next;
        }
        case 'quarter': {
            const qm = m + 3;
            const next = toEpochDay(fromLocalParts(qm > 11 ? y + 1 : y, qm % 12));
            return day >= first && day < next;
        }
        default:
            return false;
    }
}

function fromLocalParts(y: number, month0: number): string {
    return `${String(y).padStart(4, '0')}-${String(month0 + 1).padStart(2, '0')}-01`;
}

/** A `YYYY-MM-DD` as the local midnight `Date` the widget draws (display only). */
export function localDate(day: string): Date {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d);
}

/** A local `Date` (a chart cell) as an epoch day. */
export function epochDayOfLocal(date: Date): EpochDay {
    return toEpochDay(`${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
}

/** The widget's task shape as Islestone hands it over (its own fields prefixed `isl`). */
export interface WidgetTask {
    id: string;
    parent: string | 0;
    type: ChartTask['type'];
    text: string;
    start: Date;
    end?: Date;
    open: boolean;
    islKey: string;
    islKind: ChartTask['kind'];
    islCritical: boolean;
    islLate: boolean;
    islConflict: boolean;
    islContext: boolean;
    islDone: boolean;
    islFloat: string;
}

export const addOneDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

/** The widget's task for a view-model row: the end is exclusive, one day past the last day drawn. */
export function toWidgetTask(task: ChartTask, floatLabel: string, contextGroupLabel: string): WidgetTask {
    const start = localDate(task.start);
    return {
        id: task.id,
        parent: task.parent,
        type: task.type,
        text: task.kind === 'context-group' ? contextGroupLabel : task.text,
        start,
        ...(task.type === 'milestone' ? {} : { end: addOneDay(localDate(task.end)) }),
        open: true,
        // Islestone's own fields, read back by the template and the columns.
        islKey: task.key,
        islKind: task.kind,
        islCritical: task.critical,
        islLate: task.late,
        islConflict: task.conflicts.length > 0,
        islContext: task.context,
        islDone: task.done,
        islFloat: floatLabel,
    };
}

/** One CSS rule per critical relation (the widget gives links no template). */
export function criticalLinkCss(ids: readonly string[]): string {
    return ids
        .filter((id) => SAFE_LINK_ID.test(id))
        .map((id) => `.isl-timeline [data-link-id=":${id}"] .wx-line-draw{stroke:var(--isl-timeline-critical);stroke-width:2.5}`)
        .join('\n');
}

