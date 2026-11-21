/**
 * The timeline's read model and view model (roadmap 3.1b): the engine's
 * input built from a timeline (cancelled items and context parents left
 * out), the browser's re-run after a write, and the layout of bars, groups,
 * the "No dates" list, the critical links and the summary line.
 */
import {
    computeTimelineSchedule,
    placeRowInTimeline,
    removeRowFromTimeline,
    scheduleInputOf,
    type TimelineData,
    type TimelineResponse,
    type TimelineRow,
} from '@/lib/work-items/timeline';
import { buildTimelineModel, cellContainsDay, criticalLinkCss, leafSpan, nonWorkingEverywhere, toWidgetTask, treeOrder, type ChartTask } from '@/components/work-items/timeline/timeline-model';

import { toEpochDay } from '@/app-layer/domain/schedule/calendar';

const CAL = { id: 'cal-ws', teamId: null, timeZone: 'UTC', workingWeekdays: [1, 2, 3, 4, 5] as Array<1 | 2 | 3 | 4 | 5>, holidays: [] as string[] };

function row(id: string, over: Partial<TimelineRow> = {}): TimelineRow {
    return {
        id,
        key: `ISL-${id}`,
        title: `Item ${id}`,
        projectId: 'p1',
        teamId: 't1',
        typeId: 'ty',
        stateCategory: 'UNSTARTED',
        assigneeId: null,
        parentId: null,
        sortKey: id,
        startDate: null,
        dueDate: null,
        actualStart: null,
        actualFinish: null,
        milestoneId: null,
        calendarId: CAL.id,
        version: 1,
        context: false,
        ...over,
    };
}

function data(rows: TimelineRow[], over: Partial<TimelineData> = {}): TimelineData {
    return {
        asOf: '2026-03-02', // a Monday
        rows,
        edges: [],
        calendars: [CAL],
        milestones: [],
        projects: [{ id: 'p1', name: 'Platform', keyPrefix: 'ISL', dueDate: null, archived: false }],
        hiddenDependencies: 0,
        omittedContextRows: 0,
        ...over,
    };
}

function respond(d: TimelineData): TimelineResponse {
    return { ...d, schedule: computeTimelineSchedule(d) };
}

describe('scheduleInputOf', () => {
    it('leaves cancelled items and their relations out, and maps the states', () => {
        const input = scheduleInputOf(
            data([row('a', { stateCategory: 'BACKLOG' }), row('b', { stateCategory: 'STARTED' }), row('c', { stateCategory: 'DONE' }), row('x', { stateCategory: 'CANCELLED' })], {
                edges: [
                    { id: 'e1', fromId: 'a', toId: 'x' },
                    { id: 'e2', fromId: 'a', toId: 'b' },
                ],
            }),
        );
        expect(input.items.map((i) => [i.id, i.status])).toEqual([
            ['a', 'open'],
            ['b', 'started'],
            ['c', 'done'],
        ]);
        expect(input.edges).toEqual([{ from: 'a', to: 'b' }]);
    });

    it('a parent counts only when it is a scope row passed too; a context row never parents', () => {
        const input = scheduleInputOf(
            data([
                row('p'),
                row('c1', { parentId: 'p' }),
                row('c2', { parentId: 'gone' }),
                row('ctx', { context: true }),
                row('c3', { parentId: 'ctx' }),
                row('pc', { stateCategory: 'CANCELLED' }),
                row('c4', { parentId: 'pc' }),
            ]),
        );
        const parents = Object.fromEntries(input.items.map((i) => [i.id, i.parentId]));
        expect(parents).toEqual({ p: null, c1: 'p', c2: null, ctx: null, c3: null, c4: null });
    });

    it("reads the milestone's and the project's due dates as deadlines (decision 188)", () => {
        const input = scheduleInputOf(
            data([row('a', { milestoneId: 'm1', dueDate: '2026-03-04' })], {
                milestones: [{ id: 'm1', projectId: 'p1', name: 'Beta', dueDate: '2026-03-10' }],
                projects: [{ id: 'p1', name: 'Platform', keyPrefix: 'ISL', dueDate: '2026-03-20', archived: false }],
            }),
        );
        expect(input.items[0]).toMatchObject({ milestoneDue: toEpochDay('2026-03-10'), projectDue: toEpochDay('2026-03-20'), plannedFinish: toEpochDay('2026-03-04') });
    });

    it('passes each pair once and only the calendars the rows count on', () => {
        const input = scheduleInputOf(
            data([row('a'), row('b')], {
                edges: [
                    { id: 'e1', fromId: 'a', toId: 'b' },
                    { id: 'e2', fromId: 'a', toId: 'b' },
                ],
                calendars: [CAL, { ...CAL, id: 'cal-other', teamId: 't9' }],
            }),
        );
        expect(input.edges).toHaveLength(1);
        expect(input.calendars.map((c) => c.id)).toEqual(['cal-ws']);
    });
});

describe('the browser re-run after a write (decision 197)', () => {
    const base = respond(
        data([row('a', { startDate: '2026-03-02', dueDate: '2026-03-04' }), row('b', { startDate: '2026-03-05', dueDate: '2026-03-06' })], {
            edges: [{ id: 'e1', fromId: 'a', toId: 'b' }],
        }),
    );

    it('places the new dates and recomputes: equal to the server computing from scratch', () => {
        const placed = placeRowInTimeline(base, { id: 'a', title: 'Item a', stateCategory: 'UNSTARTED', assigneeId: null, parentId: null, startDate: '2026-03-02', dueDate: '2026-03-09', milestoneId: null, version: 2 });
        expect(placed).not.toBeNull();
        const fresh = respond({ ...base, rows: placed!.rows });
        expect(placed!.schedule).toEqual(fresh.schedule);
        const b = placed!.schedule.ok ? placed!.schedule.items.find((i) => i.id === 'b')! : null;
        expect(b?.conflicts).toContain('STARTS_BEFORE_BLOCKER_FINISHES');
    });

    it('a move into Done takes today as the actual dates', () => {
        const placed = placeRowInTimeline(base, { id: 'a', title: 'Item a', stateCategory: 'DONE', assigneeId: null, parentId: null, startDate: '2026-03-02', dueDate: '2026-03-04', milestoneId: null, version: 2 })!;
        expect(placed.rows.find((r) => r.id === 'a')).toMatchObject({ actualStart: '2026-03-02', actualFinish: '2026-03-02' });
    });

    it('answers null for a row the timeline does not hold (the hook re-reads)', () => {
        expect(placeRowInTimeline(base, { id: 'zz', title: '', stateCategory: 'UNSTARTED', assigneeId: null, parentId: null, startDate: null, dueDate: null, milestoneId: null, version: 1 })).toBeNull();
        expect(removeRowFromTimeline(base, 'zz')).toBeNull();
    });

    it('a removal drops the row and its relations', () => {
        const removed = removeRowFromTimeline(base, 'a')!;
        expect(removed.rows.map((r) => r.id)).toEqual(['b']);
        expect(removed.edges).toEqual([]);
    });
});

describe('leafSpan (decision 184: the stored dates)', () => {
    it('start to due; one date, one day; reversed, the due day; done, the actual dates', () => {
        expect(leafSpan(row('a', { startDate: '2026-03-02', dueDate: '2026-03-05' }))).toEqual({ start: '2026-03-02', end: '2026-03-05' });
        expect(leafSpan(row('a', { dueDate: '2026-03-05' }))).toEqual({ start: '2026-03-05', end: '2026-03-05' });
        expect(leafSpan(row('a', { startDate: '2026-03-05' }))).toEqual({ start: '2026-03-05', end: '2026-03-05' });
        expect(leafSpan(row('a', { startDate: '2026-03-09', dueDate: '2026-03-05' }))).toEqual({ start: '2026-03-05', end: '2026-03-05' });
        expect(leafSpan(row('a', { stateCategory: 'DONE', startDate: '2026-03-02', dueDate: '2026-03-20', actualStart: '2026-03-03', actualFinish: '2026-03-04' }))).toEqual({ start: '2026-03-03', end: '2026-03-04' });
        expect(leafSpan(row('a'))).toBeNull();
    });
});

describe('buildTimelineModel', () => {
    const chain = data(
        [
            row('a', { startDate: '2026-03-02', dueDate: '2026-03-03' }),
            row('b', { startDate: '2026-03-04', dueDate: '2026-03-06' }),
            row('c', { startDate: '2026-03-02', dueDate: '2026-03-02' }),
            row('n'),
            row('x', { stateCategory: 'CANCELLED', startDate: '2026-03-02', dueDate: '2026-03-02' }),
        ],
        { edges: [{ id: 'rel1', fromId: 'a', toId: 'b' }] },
    );

    it('draws the chain with the critical path on bars and links, lists the undated item, keeps the cancelled one in the table only', () => {
        const model = buildTimelineModel(respond(chain), { showCriticalPath: true });
        if (!model.ok) throw new Error('expected a schedule');
        expect(model.tasks.map((t) => t.id)).toEqual(['a', 'b', 'c']);
        expect(model.tasks.filter((t) => t.critical).map((t) => t.id)).toEqual(['a', 'b']);
        expect(model.links).toEqual([{ id: 'rel1', source: 'a', target: 'b' }]);
        expect(model.criticalLinkIds).toEqual(['rel1']);
        expect(model.noDates.map((r) => r.id)).toEqual(['n']);
        expect(model.table.map((r) => r.id)).toEqual(['a', 'b', 'c', 'n', 'x']);
        expect(model.table.find((r) => r.id === 'x')).toMatchObject({ cancelled: true, unscheduled: false });
        expect(model.summary).toMatchObject({ finish: '2026-03-06', criticalCount: 2, lateCount: 0, hasDatedOpenItem: true, projectDue: null });
    });

    it('the critical path switched off marks nothing and names no link', () => {
        const model = buildTimelineModel(respond(chain), { showCriticalPath: false });
        if (!model.ok) throw new Error('expected a schedule');
        expect(model.tasks.some((t) => t.critical)).toBe(false);
        expect(model.criticalLinkIds).toEqual([]);
    });

    it('never invents a path: with no dated open item it says so', () => {
        const model = buildTimelineModel(respond(data([row('n')])), { showCriticalPath: true });
        if (!model.ok) throw new Error('expected a schedule');
        expect(model.summary.hasDatedOpenItem).toBe(false);
        expect(model.tasks).toEqual([]);
    });

    it("draws the project's due date and dated milestones, and says how late the finish is (decision 188)", () => {
        const late = data([row('a', { startDate: '2026-03-02', dueDate: '2026-03-13', milestoneId: 'm1' })], {
            projects: [{ id: 'p1', name: 'Platform', keyPrefix: 'ISL', dueDate: '2026-03-10', archived: false }],
            milestones: [
                { id: 'm1', projectId: 'p1', name: 'Beta', dueDate: '2026-03-06' },
                { id: 'm2', projectId: 'p1', name: 'Undated', dueDate: null },
            ],
        });
        const model = buildTimelineModel(respond(late), { showCriticalPath: true, scopeProjectId: 'p1' });
        if (!model.ok) throw new Error('expected a schedule');
        expect(model.tasks.map((t) => [t.id, t.type])).toEqual([
            ['project-due:p1', 'milestone'],
            ['milestone:m1', 'milestone'],
            ['a', 'task'],
        ]);
        // 2026-03-13 is three working days after 2026-03-10.
        expect(model.summary.projectDue).toEqual({ dueDate: '2026-03-10', lateDays: 3 });
        const a = model.table.find((r) => r.id === 'a')!;
        expect(a.lateDays).toBeGreaterThan(0);
        expect(a.conflicts).toEqual(expect.arrayContaining(['MISSES_MILESTONE_DUE_DATE', 'MISSES_PROJECT_DUE_DATE']));
    });

    it('groups several projects under summary rows, and context rows in their own group', () => {
        const multi = data(
            [
                row('a', { startDate: '2026-03-02', dueDate: '2026-03-03' }),
                row('b', { projectId: 'p2', startDate: '2026-03-04', dueDate: '2026-03-05' }),
                row('k', { projectId: 'p3', context: true, startDate: '2026-03-09', dueDate: '2026-03-09' }),
            ],
            {
                projects: [
                    { id: 'p1', name: 'Alpha', keyPrefix: 'ALP', dueDate: null, archived: false },
                    { id: 'p2', name: 'Beta', keyPrefix: 'BET', dueDate: null, archived: false },
                    { id: 'p3', name: 'Gamma', keyPrefix: 'GAM', dueDate: null, archived: false },
                ],
                edges: [{ id: 'r1', fromId: 'b', toId: 'k' }],
            },
        );
        const model = buildTimelineModel(respond(multi), { showCriticalPath: true });
        if (!model.ok) throw new Error('expected a schedule');
        expect(model.tasks.map((t) => [t.id, t.parent])).toEqual([
            ['project:p1', 0],
            ['a', 'project:p1'],
            ['project:p2', 0],
            ['b', 'project:p2'],
            ['context-group', 0],
            ['k', 'context-group'],
        ]);
        expect(model.tasks.find((t) => t.id === 'project:p1')).toMatchObject({ type: 'summary', start: '2026-03-02', end: '2026-03-03' });
        expect(model.links).toEqual([{ id: 'r1', source: 'b', target: 'k' }]);
        expect(model.table.find((r) => r.id === 'k')).toMatchObject({ context: true });
    });

    it("a summary's bar is the engine's span of its sub-items (decision 186)", () => {
        const tree = data([
            row('p', { startDate: '2026-03-02', dueDate: '2026-03-02' }),
            row('c1', { parentId: 'p', sortKey: 'b', startDate: '2026-03-03', dueDate: '2026-03-04' }),
            row('c2', { parentId: 'p', sortKey: 'a', startDate: '2026-03-05', dueDate: '2026-03-10' }),
        ]);
        const model = buildTimelineModel(respond(tree), { showCriticalPath: true });
        if (!model.ok) throw new Error('expected a schedule');
        expect(model.tasks.map((t) => [t.id, t.type, t.parent])).toEqual([
            ['p', 'summary', 0],
            ['c2', 'task', 'p'],
            ['c1', 'task', 'p'],
        ]);
        expect(model.tasks[0]).toMatchObject({ start: '2026-03-03', end: '2026-03-10' });
    });

    it('a stored cycle is reported with its keys, never drawn', () => {
        const looped = respond(
            data([row('a', { dueDate: '2026-03-02' }), row('b', { dueDate: '2026-03-03' })], {
                edges: [
                    { id: 'r1', fromId: 'a', toId: 'b' },
                    { id: 'r2', fromId: 'b', toId: 'a' },
                ],
            }),
        );
        const model = buildTimelineModel(looped, { showCriticalPath: true });
        expect(model).toMatchObject({ ok: false, error: 'CYCLE' });
        if (!model.ok) expect(model.cycleKeys).toEqual(expect.arrayContaining(['ISL-a', 'ISL-b']));
    });

    it('a link id that is not a plain cuid is never put in a selector', () => {
        const weird = data([row('a', { startDate: '2026-03-02', dueDate: '2026-03-02' }), row('b', { startDate: '2026-03-03', dueDate: '2026-03-03' })], {
            edges: [{ id: 'x"]{}*{color:red', fromId: 'a', toId: 'b' }],
        });
        const model = buildTimelineModel(respond(weird), { showCriticalPath: true });
        if (!model.ok) throw new Error('expected a schedule');
        expect(model.criticalLinkIds).toEqual([]);
        expect(criticalLinkCss(['ok123', 'bad"id'])).toBe('.isl-timeline [data-link-id=":ok123"] .wx-line-draw{stroke:var(--isl-timeline-critical);stroke-width:2.5}');
    });
});

describe('the widget mapping and the cells', () => {
    it("a task's end is exclusive (one day past the due date); a diamond has no end", () => {
        const task: ChartTask = { id: 'a', parent: 0, type: 'task', text: 'A', key: 'ISL-1', start: '2026-03-02', end: '2026-03-04', kind: 'item', critical: true, late: false, lateDays: 0, conflicts: [], context: false, done: false, totalFloat: 0 };
        const w = toWidgetTask(task, 'No float', 'Outside');
        expect(w.start).toEqual(new Date(2026, 2, 2));
        expect(w.end).toEqual(new Date(2026, 2, 5));
        expect(w).toMatchObject({ islKey: 'ISL-1', islCritical: true, islFloat: 'No float' });
        expect(toWidgetTask({ ...task, type: 'milestone' }, '', '').end).toBeUndefined();
    });

    it('a cell contains today by its unit', () => {
        const today = toEpochDay('2026-03-04');
        expect(cellContainsDay(new Date(2026, 2, 4), 'day', today)).toBe(true);
        expect(cellContainsDay(new Date(2026, 2, 3), 'day', today)).toBe(false);
        expect(cellContainsDay(new Date(2026, 2, 2), 'week', today)).toBe(true);
        expect(cellContainsDay(new Date(2026, 2, 1), 'month', today)).toBe(true);
        expect(cellContainsDay(new Date(2026, 1, 1), 'month', today)).toBe(false);
        expect(cellContainsDay(new Date(2026, 0, 1), 'quarter', today)).toBe(true);
        expect(cellContainsDay(new Date(2026, 3, 1), 'quarter', today)).toBe(false);
    });

    it('shades only the days no calendar in view works', () => {
        const resp = respond(
            data([row('a'), row('b', { teamId: 't2', calendarId: 'cal-sat' })], {
                calendars: [CAL, { id: 'cal-sat', teamId: 't2', timeZone: 'UTC', workingWeekdays: [1, 2, 3, 4, 5, 6], holidays: ['2026-03-04'] }],
            }),
        );
        const days = nonWorkingEverywhere(resp, { start: '2026-03-02', end: '2026-03-08' });
        // Saturday the 7th is worked by one team; Sunday the 8th by neither; the holiday on the 4th is one team's only.
        expect([...days]).toEqual([toEpochDay('2026-03-08')]);
    });

    it('orders parents before children', () => {
        const t = (id: string, parent: string | 0): ChartTask => ({ id, parent, type: 'task', text: id, key: '', start: '2026-03-02', end: '2026-03-02', kind: 'item', critical: false, late: false, lateDays: 0, conflicts: [], context: false, done: false, totalFloat: 0 });
        expect(treeOrder([t('c', 'p'), t('p', 0), t('orphan', 'missing')]).map((x) => [x.id, x.parent])).toEqual([
            ['p', 0],
            ['c', 'p'],
            ['orphan', 0],
        ]);
    });
});
