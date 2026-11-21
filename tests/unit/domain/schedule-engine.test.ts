/**
 * The scheduling engine (roadmap 3.1; ADR 0010 §1 to §4; owner decisions 183
 * to 188 and 198): vectors written by hand against the rules in
 * `engine.ts`'s header. No vector is translated from SVAR's PRO tests.
 */
import { computeSchedule } from '@/app-layer/domain/schedule/engine';
import { fromEpochDay, toEpochDay, type CalendarSpec, type IsoWeekday } from '@/app-layer/domain/schedule/calendar';
import { SCHEDULE_ITEM_LIMIT, type ItemSchedule, type ScheduleItem, type ScheduleResult } from '@/app-layer/domain/schedule/types';

const day = toEpochDay;
const WEEK: CalendarSpec = { id: 'w', workingWeekdays: [1, 2, 3, 4, 5], holidays: [] };

function item(id: string, over: Partial<Omit<ScheduleItem, 'plannedStart' | 'plannedFinish' | 'actualStart' | 'actualFinish' | 'milestoneDue' | 'projectDue'>> & {
    start?: string;
    due?: string;
    started?: string;
    finished?: string;
    milestoneDue?: string;
    projectDue?: string;
} = {}): ScheduleItem {
    return {
        id,
        calendarId: over.calendarId ?? 'w',
        parentId: over.parentId ?? null,
        plannedStart: over.start ? day(over.start) : null,
        plannedFinish: over.due ? day(over.due) : null,
        status: over.status ?? 'open',
        actualStart: over.started ? day(over.started) : null,
        actualFinish: over.finished ? day(over.finished) : null,
        milestoneDue: over.milestoneDue ? day(over.milestoneDue) : null,
        projectDue: over.projectDue ? day(over.projectDue) : null,
    };
}

function ok(result: ScheduleResult) {
    if (!result.ok) throw new Error(`expected a schedule, got ${JSON.stringify(result)}`);
    return result;
}

/** One item's schedule with its dates as `YYYY-MM-DD`. */
function view(result: ScheduleResult, id: string) {
    const s = ok(result).items.find((i) => i.id === id) as ItemSchedule;
    return {
        es: fromEpochDay(s.earliestStart),
        ef: fromEpochDay(s.earliestFinish),
        ls: fromEpochDay(s.latestStart),
        lf: fromEpochDay(s.latestFinish),
        float: s.totalFloat,
        free: s.freeFloat,
        late: s.lateDays,
        critical: s.critical,
        conflicts: s.conflicts,
        duration: s.durationDays,
        unscheduled: s.unscheduled,
        summary: s.summary,
    };
}

const MON = '2026-01-05';

describe('computeSchedule — vectors', () => {
    it('a chain beside a longer item: the longer item is critical, the chain floats', () => {
        const r = computeSchedule({
            asOf: day(MON),
            calendars: [WEEK],
            items: [item('A', { start: MON, due: '2026-01-06' }), item('B', { start: MON, due: '2026-01-07' }), item('C', { start: MON, due: '2026-01-23' })],
            edges: [{ from: 'A', to: 'B' }],
        });
        expect(view(r, 'A')).toMatchObject({ es: MON, ef: '2026-01-06', lf: '2026-01-20', float: 10, free: 0, critical: false });
        expect(view(r, 'B')).toMatchObject({ es: '2026-01-07', ef: '2026-01-09', ls: '2026-01-21', lf: '2026-01-23', float: 10, free: 10, critical: false });
        expect(view(r, 'C')).toMatchObject({ es: MON, ef: '2026-01-23', float: 0, critical: true, duration: 15 });
        expect(ok(r).finish).toBe(day('2026-01-23'));
        expect(ok(r).criticalEdges).toEqual([]);
    });

    it('a chain across a weekend: the successor starts on Monday and its plan is flagged', () => {
        const r = computeSchedule({
            asOf: day(MON),
            calendars: [WEEK],
            items: [item('A', { start: '2026-01-08', due: '2026-01-09' }), item('B', { start: '2026-01-08', due: '2026-01-09' })],
            edges: [{ from: 'A', to: 'B' }],
        });
        expect(view(r, 'B')).toMatchObject({ es: '2026-01-12', ef: '2026-01-13', float: 0, critical: true, conflicts: ['STARTS_BEFORE_BLOCKER_FINISHES'] });
        expect(view(r, 'A')).toMatchObject({ float: 0, critical: true, conflicts: [] });
        expect(ok(r).criticalEdges).toEqual([{ from: 'A', to: 'B' }]);
    });

    it('a holiday inside a duration does not count', () => {
        const cal: CalendarSpec = { ...WEEK, holidays: [day('2026-01-07')] };
        const r = computeSchedule({ asOf: day(MON), calendars: [cal], items: [item('A', { start: MON, due: '2026-01-09' })], edges: [] });
        expect(view(r, 'A')).toMatchObject({ duration: 4, es: MON, ef: '2026-01-09' });
        const pushed = computeSchedule({
            asOf: day(MON),
            calendars: [cal],
            items: [item('A', { start: MON, due: '2026-01-06' }), item('B', { start: MON, due: '2026-01-05' })],
            edges: [{ from: 'A', to: 'B' }],
        });
        expect(view(pushed, 'B').es).toBe('2026-01-08');
    });

    it('two calendars across one edge: each end on its own working days', () => {
        const sunThu: CalendarSpec = { id: 'il', workingWeekdays: [7, 1, 2, 3, 4] as IsoWeekday[], holidays: [] };
        const r = computeSchedule({
            asOf: day(MON),
            calendars: [WEEK, sunThu],
            items: [item('A', { start: MON, due: '2026-01-09' }), item('B', { calendarId: 'il', start: MON, due: MON })],
            edges: [{ from: 'A', to: 'B' }],
        });
        expect(view(r, 'B')).toMatchObject({ es: '2026-01-11', ef: '2026-01-11' });
    });

    it('a started item past its due date cannot finish before today', () => {
        const r = computeSchedule({
            asOf: day('2026-01-12'),
            calendars: [WEEK],
            items: [item('S', { status: 'started', start: MON, due: '2026-01-06', started: MON })],
            edges: [],
        });
        expect(view(r, 'S')).toMatchObject({ es: MON, ef: '2026-01-12', critical: true, float: 0 });
    });

    it('a done item is fixed at its actual dates, never critical, and holds nothing back after it finished', () => {
        const r = computeSchedule({
            asOf: day(MON),
            calendars: [WEEK],
            items: [item('D', { status: 'done', start: MON, due: '2026-01-09', started: '2026-01-01', finished: '2026-01-02' }), item('B', { start: MON })],
            edges: [{ from: 'D', to: 'B' }],
        });
        expect(view(r, 'D')).toMatchObject({ es: '2026-01-01', ef: '2026-01-02', critical: false, float: 0 });
        expect(view(r, 'B')).toMatchObject({ es: MON, critical: true });
    });

    it('nothing unstarted starts before today', () => {
        const r = computeSchedule({ asOf: day('2026-01-14'), calendars: [WEEK], items: [item('A', { start: MON, due: '2026-01-06' })], edges: [] });
        expect(view(r, 'A')).toMatchObject({ es: '2026-01-14', ef: '2026-01-15' });
    });

    describe('deadlines (decision 188)', () => {
        const run = (milestoneDue?: string, projectDue?: string) =>
            computeSchedule({ asOf: day(MON), calendars: [WEEK], items: [item('A', { start: MON, due: '2026-01-09', milestoneDue, projectDue })], edges: [] });

        it("a milestone's due date earlier than the finish: late by two days", () => {
            expect(view(run('2026-01-07'), 'A')).toMatchObject({ lf: '2026-01-07', float: -2, late: 2, critical: true, conflicts: ['MISSES_MILESTONE_DUE_DATE'] });
        });
        it("the project's due date earlier than the milestone's binds", () => {
            expect(view(run('2026-01-07', '2026-01-06'), 'A')).toMatchObject({ float: -3, late: 3, conflicts: ['MISSES_MILESTONE_DUE_DATE', 'MISSES_PROJECT_DUE_DATE'] });
        });
        it("the project's due date later than the milestone's: the milestone binds the float, each miss is reported", () => {
            expect(view(run('2026-01-07', '2026-01-08'), 'A')).toMatchObject({ float: -2, conflicts: ['MISSES_MILESTONE_DUE_DATE', 'MISSES_PROJECT_DUE_DATE'] });
            expect(view(run('2026-01-07', '2026-01-09'), 'A')).toMatchObject({ float: -2, conflicts: ['MISSES_MILESTONE_DUE_DATE'] });
        });
        it('the two equal: both missed, by the same days', () => {
            expect(view(run('2026-01-07', '2026-01-07'), 'A')).toMatchObject({ float: -2, conflicts: ['MISSES_MILESTONE_DUE_DATE', 'MISSES_PROJECT_DUE_DATE'] });
        });
        it('a deadline met leaves float', () => {
            expect(view(run(undefined, '2026-01-16'), 'A')).toMatchObject({ float: 0, late: 0, conflicts: [] });
        });

        it('the critical path is the chain that is most late (decision 198)', () => {
            const r = computeSchedule({
                asOf: day(MON),
                calendars: [WEEK],
                items: [
                    item('X', { start: MON, due: '2026-01-06' }),
                    item('Y', { start: MON, due: '2026-01-07', milestoneDue: '2026-01-07' }),
                    item('Z', { start: MON, due: '2026-01-23' }),
                ],
                edges: [{ from: 'X', to: 'Y' }],
            });
            expect(view(r, 'Y')).toMatchObject({ float: -2, critical: true });
            expect(view(r, 'X')).toMatchObject({ float: -2, critical: true });
            expect(view(r, 'Z')).toMatchObject({ float: 0, critical: false });
            expect(ok(r).criticalEdges).toEqual([{ from: 'X', to: 'Y' }]);
        });
    });

    it('missing dates: one date is one working day; none is "No dates"; inside a chain it counts zero days and is named (decision 185)', () => {
        const r = computeSchedule({
            asOf: day(MON),
            calendars: [WEEK],
            items: [item('A', { start: MON, due: '2026-01-06' }), item('U'), item('B', { start: MON }), item('N'), item('D', { due: '2026-01-09' })],
            edges: [
                { from: 'A', to: 'U' },
                { from: 'U', to: 'B' },
            ],
        });
        expect(view(r, 'U')).toMatchObject({ unscheduled: true, duration: 0, es: '2026-01-07', critical: true });
        expect(view(r, 'B')).toMatchObject({ es: '2026-01-07', ef: '2026-01-07', duration: 1, critical: true });
        expect(view(r, 'N')).toMatchObject({ unscheduled: true, critical: false });
        expect(view(r, 'D')).toMatchObject({ duration: 1, unscheduled: false });
        expect(ok(r).warnings).toEqual([{ code: 'UNSCHEDULED_IN_CHAIN', ids: ['U'] }]);
        expect(ok(r).criticalEdges).toEqual([
            { from: 'A', to: 'U' },
            { from: 'U', to: 'B' },
        ]);
    });

    it('start after due is reported and counted as one day at the due date', () => {
        const r = computeSchedule({ asOf: day(MON), calendars: [WEEK], items: [item('R', { start: '2026-01-09', due: '2026-01-07' })], edges: [] });
        expect(view(r, 'R')).toMatchObject({ duration: 1, conflicts: ['DATES_REVERSED'], es: MON });
    });

    it('a start on a non-working day is reported', () => {
        const r = computeSchedule({ asOf: day(MON), calendars: [WEEK], items: [item('W', { start: '2026-01-10', due: '2026-01-12' })], edges: [] });
        expect(view(r, 'W')).toMatchObject({ conflicts: ['STARTS_ON_NON_WORKING_DAY'], es: '2026-01-12', duration: 1 });
    });

    it('a parent with sub-items is a summary spanning them; a relation into it applies to every sub-item (decision 186)', () => {
        const r = computeSchedule({
            asOf: day(MON),
            calendars: [WEEK],
            items: [
                item('P', { start: MON, due: '2026-01-08' }),
                item('C1', { parentId: 'P', start: MON, due: '2026-01-06' }),
                item('C2', { parentId: 'P', start: MON, due: '2026-01-08' }),
                item('Q', { start: MON, due: '2026-01-06' }),
                item('S', { start: MON }),
            ],
            edges: [
                { from: 'Q', to: 'P' },
                { from: 'P', to: 'S' },
            ],
        });
        expect(view(r, 'C1').es).toBe('2026-01-07');
        expect(view(r, 'C2')).toMatchObject({ es: '2026-01-07', ef: '2026-01-12', duration: 4 });
        expect(view(r, 'P')).toMatchObject({ summary: true, es: '2026-01-07', ef: '2026-01-12', critical: false });
        expect(view(r, 'S').es).toBe('2026-01-13');
        expect(ok(r).warnings).toContainEqual({ code: 'SUMMARY_OUTSIDE_PLANNED_DATES', ids: ['P'] });
        expect(ok(r).criticalEdges).toEqual([
            { from: 'P', to: 'S' },
            { from: 'Q', to: 'P' },
        ]);
    });

    it('a relation between an item and its own sub-item is left out and named', () => {
        const r = computeSchedule({
            asOf: day(MON),
            calendars: [WEEK],
            items: [item('P'), item('C', { parentId: 'P', start: MON })],
            edges: [{ from: 'P', to: 'C' }],
        });
        expect(ok(r).warnings).toEqual([{ code: 'EDGE_INSIDE_SUMMARY', ids: ['P>C'] }]);
    });

    it('names a cycle, in blocks order from its smallest id', () => {
        const r = computeSchedule({
            asOf: day(MON),
            calendars: [WEEK],
            items: ['A', 'B', 'C', 'D'].map((id) => item(id)),
            edges: [
                { from: 'B', to: 'C' },
                { from: 'C', to: 'A' },
                { from: 'A', to: 'B' },
                { from: 'D', to: 'A' },
            ],
        });
        expect(r).toEqual({ ok: false, error: 'CYCLE', cycle: ['A', 'B', 'C'] });
        expect(computeSchedule({ asOf: 0, calendars: [WEEK], items: [item('A')], edges: [{ from: 'A', to: 'A' }] })).toEqual({ ok: false, error: 'CYCLE', cycle: ['A'] });
    });

    it('refuses an input over the limit before any work, and throws on a programmer error', () => {
        const many = Array.from({ length: SCHEDULE_ITEM_LIMIT + 1 }, (_, i) => item(`i${i}`, { calendarId: 'missing' }));
        expect(computeSchedule({ asOf: 0, calendars: [], items: many, edges: [] })).toEqual({ ok: false, error: 'TOO_LARGE', items: SCHEDULE_ITEM_LIMIT + 1, limit: SCHEDULE_ITEM_LIMIT });
        expect(() => computeSchedule({ asOf: 0, calendars: [WEEK], items: [item('A'), item('A')], edges: [] })).toThrow(/duplicate item/);
        expect(() => computeSchedule({ asOf: 0, calendars: [WEEK], items: [item('A', { calendarId: 'x' })], edges: [] })).toThrow(/unknown calendar/);
        expect(() => computeSchedule({ asOf: 0, calendars: [WEEK], items: [item('A')], edges: [{ from: 'A', to: 'Z' }] })).toThrow(/unknown item/);
    });

    it('an empty input is an empty schedule finishing today', () => {
        expect(computeSchedule({ asOf: 5, calendars: [], items: [], edges: [] })).toEqual({ ok: true, asOf: 5, finish: 5, items: [], criticalEdges: [], warnings: [] });
    });
});
