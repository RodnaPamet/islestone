/**
 * Changing dates from the timeline (roadmap 3.1c; owner decisions 194 and
 * 197): the dates a drop proposes, the confirmation's preview, and the set
 * "Also move the N items it pushes later" names, computed with the engine.
 * Hand-written vectors, then properties over random chains: every pushed item
 * is downstream of the changed one, moves later only and keeps its dates'
 * shape, and after the pushes none of them starts before a blocker finishes.
 */
import fc from 'fast-check';

import { compileCalendar, fromEpochDay, toEpochDay, workingDaysInclusive } from '@/app-layer/domain/schedule/calendar';
import { BULK_MAX } from '@/lib/schemas/work-item';
import { computeTimelineSchedule, type TimelineData, type TimelineResponse, type TimelineRow } from '@/lib/work-items/timeline';
import { downstreamOf, planDateChange, proposeDates, RESCHEDULE_MAX, type DatePlan } from '@/lib/work-items/reschedule';

const MON_FRI = compileCalendar({ id: 'cal', workingWeekdays: [1, 2, 3, 4, 5], holidays: [] });
const NONE_HIDDEN = { hiddenDates: () => ({ startDate: false, dueDate: false }) };

function row(id: string, over: Partial<TimelineRow> = {}): TimelineRow {
    return {
        id,
        key: `ISL-${id.replace(/\D/g, '') || '0'}`,
        title: `Item ${id}`,
        projectId: 'p1',
        teamId: 't1',
        typeId: 'type-1',
        stateCategory: 'UNSTARTED',
        assigneeId: null,
        parentId: null,
        sortKey: id,
        startDate: null,
        dueDate: null,
        actualStart: null,
        actualFinish: null,
        milestoneId: null,
        calendarId: 'cal',
        version: 3,
        context: false,
        ...over,
    };
}

function timeline(rows: TimelineRow[], edges: Array<[string, string]>, over: Partial<TimelineData> = {}): TimelineResponse {
    const data: TimelineData = {
        asOf: '2026-03-02', // a Monday
        rows,
        edges: edges.map(([fromId, toId], i) => ({ id: `rel${i}`, fromId, toId })),
        calendars: [{ id: 'cal', teamId: null, timeZone: 'UTC', workingWeekdays: [1, 2, 3, 4, 5], holidays: [] }],
        milestones: [],
        projects: [{ id: 'p1', name: 'P', keyPrefix: 'ISL', dueDate: null, archived: false }, { id: 'p2', name: 'Archived', keyPrefix: 'ARC', dueDate: null, archived: true }],
        hiddenDependencies: 0,
        omittedContextRows: 0,
        ...over,
    };
    return { ...data, schedule: computeTimelineSchedule(data) };
}

function ok(plan: ReturnType<typeof planDateChange>): DatePlan {
    if (!plan.ok) throw new Error(`plan failed: ${plan.error}`);
    return plan;
}

describe('the dates a drop proposes', () => {
    it('a move keeps the working-day duration, starting on the next working day', () => {
        // Mon 2 Mar to Wed 4 Mar is three working days; dragged four days to Fri 6 Mar, it ends Tue 10 Mar.
        expect(proposeDates({ startDate: '2026-03-02', dueDate: '2026-03-04' }, MON_FRI, 'move', 4)).toEqual({ startDate: '2026-03-06', dueDate: '2026-03-10' });
        // Dropped on a Saturday, it starts the Monday after.
        expect(proposeDates({ startDate: '2026-03-02', dueDate: '2026-03-04' }, MON_FRI, 'move', 5)).toEqual({ startDate: '2026-03-09', dueDate: '2026-03-11' });
        // Earlier works the same way.
        expect(proposeDates({ startDate: '2026-03-09', dueDate: '2026-03-10' }, MON_FRI, 'move', -7)).toEqual({ startDate: '2026-03-02', dueDate: '2026-03-03' });
    });

    it('a one-date item moves that date', () => {
        expect(proposeDates({ startDate: null, dueDate: '2026-03-04' }, MON_FRI, 'move', 2)).toEqual({ startDate: null, dueDate: '2026-03-06' });
        expect(proposeDates({ startDate: '2026-03-04', dueDate: null }, MON_FRI, 'move', 3)).toEqual({ startDate: '2026-03-09', dueDate: null });
    });

    it('a resize changes the one date, snapped to a working day and never past the other', () => {
        expect(proposeDates({ startDate: '2026-03-02', dueDate: '2026-03-06' }, MON_FRI, 'end', 1)).toEqual({ startDate: '2026-03-02', dueDate: '2026-03-06' });
        expect(proposeDates({ startDate: '2026-03-02', dueDate: '2026-03-06' }, MON_FRI, 'end', 3)).toEqual({ startDate: '2026-03-02', dueDate: '2026-03-09' });
        expect(proposeDates({ startDate: '2026-03-02', dueDate: '2026-03-06' }, MON_FRI, 'start', 2)).toEqual({ startDate: '2026-03-04', dueDate: '2026-03-06' });
        expect(proposeDates({ startDate: '2026-03-02', dueDate: '2026-03-06' }, MON_FRI, 'start', 9)).toEqual({ startDate: '2026-03-06', dueDate: '2026-03-06' });
        expect(proposeDates({ startDate: '2026-03-04', dueDate: '2026-03-06' }, MON_FRI, 'end', -9)).toEqual({ startDate: '2026-03-04', dueDate: '2026-03-04' });
        // A start-only bar resized at its end gains a due date.
        expect(proposeDates({ startDate: '2026-03-04', dueDate: null }, MON_FRI, 'end', 2)).toEqual({ startDate: '2026-03-04', dueDate: '2026-03-06' });
    });
});

describe('the confirmation preview and the items a change pushes later', () => {
    const chain = () =>
        timeline(
            [
                row('a1', { startDate: '2026-03-02', dueDate: '2026-03-03' }),
                row('b2', { startDate: '2026-03-04', dueDate: '2026-03-05' }),
                row('c3', { startDate: '2026-03-06', dueDate: '2026-03-06' }),
                row('d4', { startDate: '2026-03-30', dueDate: '2026-03-31' }),
            ],
            [
                ['a1', 'b2'],
                ['b2', 'c3'],
                ['c3', 'd4'],
            ],
        );

    it('moves the chain later together, keeping each duration, and leaves an item with room alone', () => {
        const plan = ok(planDateChange(chain(), { id: 'a1', startDate: '2026-03-09', dueDate: '2026-03-10' }, NONE_HIDDEN));
        expect(plan.push.items.map((i) => [i.key, i.from, i.to])).toEqual([
            ['ISL-2', { startDate: '2026-03-04', dueDate: '2026-03-05' }, { startDate: '2026-03-11', dueDate: '2026-03-12' }],
            ['ISL-3', { startDate: '2026-03-06', dueDate: '2026-03-06' }, { startDate: '2026-03-13', dueDate: '2026-03-13' }],
        ]);
        expect(plan.push.items.every((i) => i.version === 3)).toBe(true);
        expect(plan.push.total).toBe(3);
        expect(plan.push.overLimit).toBe(false);
        // The preview names the items whose earliest start moves, and the conflicts the change brings.
        expect(plan.effects.moved.map((m) => [m.key, m.days])).toEqual([
            ['ISL-2', 5],
            ['ISL-3', 5],
        ]);
        expect(plan.effects.newConflicts.map((c) => [c.key, c.conflict])).toEqual([
            ['ISL-2', 'STARTS_BEFORE_BLOCKER_FINISHES'],
            ['ISL-3', 'STARTS_BEFORE_BLOCKER_FINISHES'],
        ]);
        // With the pushes, no pushed item starts before its blocker finishes.
        const after = plan.push.withPushes.schedule;
        expect(after.ok && after.items.filter((i) => i.conflicts.includes('STARTS_BEFORE_BLOCKER_FINISHES'))).toEqual([]);
    });

    it('never pulls an item earlier, and the same dates push nothing', () => {
        const earlier = ok(planDateChange(chain(), { id: 'b2', startDate: '2026-03-04', dueDate: '2026-03-04' }, NONE_HIDDEN));
        expect(earlier.push.items).toEqual([]);
        const same = ok(planDateChange(chain(), { id: 'a1', startDate: '2026-03-02', dueDate: '2026-03-03' }, NONE_HIDDEN));
        expect(same.push.items).toEqual([]);
        expect(same.effects).toEqual({ moved: [], becameCritical: [], stoppedCritical: [], newConflicts: [] });
    });

    it('names, and does not move, started, undated, hidden-date, archived and reversed items', () => {
        const t = timeline(
            [
                row('a1', { startDate: '2026-03-02', dueDate: '2026-03-03' }),
                row('s2', { stateCategory: 'STARTED', startDate: '2026-03-04', dueDate: '2026-03-05', actualStart: '2026-03-04' }),
                row('u3'),
                row('h4', { startDate: '2026-03-04', dueDate: '2026-03-05', typeId: 'hiding' }),
                row('x5', { startDate: '2026-03-04', dueDate: '2026-03-05', projectId: 'p2' }),
                row('r6', { startDate: '2026-03-06', dueDate: '2026-03-04' }),
                row('o7', { startDate: '2026-03-04', dueDate: '2026-03-05' }),
            ],
            [
                ['a1', 's2'],
                ['a1', 'u3'],
                ['a1', 'h4'],
                ['a1', 'x5'],
                ['a1', 'r6'],
                ['a1', 'o7'],
            ],
        );
        const plan = ok(
            planDateChange(t, { id: 'a1', startDate: '2026-03-09', dueDate: '2026-03-10' }, { hiddenDates: (r) => ({ startDate: r.typeId === 'hiding', dueDate: false }) }),
        );
        expect(plan.push.items.map((i) => i.key)).toEqual(['ISL-7']);
        expect(plan.push.notMoved.map((n) => [n.key, n.reason])).toEqual([
            ['ISL-2', 'started'],
            ['ISL-3', 'undated'],
            ['ISL-4', 'hidden'],
            ['ISL-5', 'archived'],
            ['ISL-6', 'reversed'],
        ]);
    });

    it('a due-only item moves its due date to its earliest finish', () => {
        const t = timeline([row('a1', { startDate: '2026-03-02', dueDate: '2026-03-03' }), row('b2', { dueDate: '2026-03-04' })], [['a1', 'b2']]);
        const plan = ok(planDateChange(t, { id: 'a1', startDate: '2026-03-02', dueDate: '2026-03-06' }, NONE_HIDDEN));
        expect(plan.push.items.map((i) => i.to)).toEqual([{ startDate: null, dueDate: '2026-03-09' }]);
    });

    it('reaches through context rows, and stops at an item that is not downstream', () => {
        const t = timeline(
            [
                row('a1', { startDate: '2026-03-02', dueDate: '2026-03-03' }),
                row('k2', { startDate: '2026-03-04', dueDate: '2026-03-04', context: true }),
                row('b3', { startDate: '2026-03-05', dueDate: '2026-03-05' }),
                row('z4', { startDate: '2026-03-02', dueDate: '2026-03-02' }),
            ],
            [
                ['a1', 'k2'],
                ['k2', 'b3'],
                ['z4', 'a1'],
            ],
        );
        expect([...downstreamOf(t, 'a1')].sort()).toEqual(['b3', 'k2']);
        const plan = ok(planDateChange(t, { id: 'a1', startDate: '2026-03-09', dueDate: '2026-03-10' }, NONE_HIDDEN));
        expect(plan.push.items.map((i) => i.id)).toEqual(['k2', 'b3']);
    });

    it('over 100 items the option is refused with the count, never cut', () => {
        const n = RESCHEDULE_MAX + 5;
        const rows = Array.from({ length: n }, (_, i) => row(`i${i}`, { key: `ISL-${i}`, startDate: fromEpochDay(toEpochDay('2026-03-02') + i), dueDate: fromEpochDay(toEpochDay('2026-03-02') + i) }));
        const edges = Array.from({ length: n - 1 }, (_, i) => [`i${i}`, `i${i + 1}`] as [string, string]);
        const plan = ok(planDateChange(timeline(rows, edges, { calendars: [{ id: 'cal', teamId: null, timeZone: 'UTC', workingWeekdays: [1, 2, 3, 4, 5, 6, 7], holidays: [] }] }), { id: 'i0', startDate: '2026-03-04', dueDate: '2026-03-04' }, NONE_HIDDEN));
        expect(plan.push.items).toHaveLength(n - 1);
        expect(plan.push.total).toBe(n);
        expect(plan.push.overLimit).toBe(true);
    });

    it('the bound equals the bulk routes\' (BULK_MAX)', () => {
        expect(RESCHEDULE_MAX).toBe(BULK_MAX);
    });
});

describe('properties of the push set', () => {
    const AS_OF = toEpochDay('2026-03-02');
    const arb = fc
        .record({ n: fc.integer({ min: 2, max: 14 }), weekdays: fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 7 }) })
        .chain(({ n, weekdays }) =>
            fc.record({
                weekdays: fc.constant(weekdays),
                items: fc.array(
                    fc.record({
                        start: fc.option(fc.integer({ min: -5, max: 40 }), { nil: null, freq: 5 }),
                        length: fc.option(fc.integer({ min: 0, max: 6 }), { nil: null, freq: 4 }),
                        category: fc.constantFrom('BACKLOG' as const, 'UNSTARTED' as const, 'UNSTARTED' as const, 'STARTED' as const, 'DONE' as const),
                    }),
                    { minLength: n, maxLength: n },
                ),
                // Edges only from a lower index to a higher one: never a cycle.
                edges: fc.uniqueArray(fc.tuple(fc.integer({ min: 0, max: n - 1 }), fc.integer({ min: 0, max: n - 1 })).filter(([a, b]) => a < b), { maxLength: n * 2, selector: ([a, b]) => `${a}-${b}` }),
                dragged: fc.integer({ min: 0, max: n - 1 }),
                shift: fc.integer({ min: -10, max: 25 }),
            }),
        );

    interface Sample {
        weekdays: number[];
        items: Array<{ start: number | null; length: number | null; category: TimelineRow['stateCategory'] }>;
        edges: Array<[number, number]>;
    }

    function build(sample: Sample) {
        const rows = sample.items.map((it, i) =>
            row(`i${String(i).padStart(2, '0')}`, {
                key: `ISL-${String(i).padStart(2, '0')}`,
                stateCategory: it.category,
                startDate: it.start === null ? null : fromEpochDay(AS_OF + it.start),
                dueDate: it.start === null || it.length === null ? (it.length === null ? null : fromEpochDay(AS_OF + it.length)) : fromEpochDay(AS_OF + it.start + it.length),
                actualStart: it.category === 'STARTED' || it.category === 'DONE' ? fromEpochDay(AS_OF - 1) : null,
                actualFinish: it.category === 'DONE' ? fromEpochDay(AS_OF) : null,
            }),
        );
        const edges = sample.edges.map(([a, b]) => [rows[a]!.id, rows[b]!.id] as [string, string]);
        return timeline(rows, edges, { calendars: [{ id: 'cal', teamId: null, timeZone: 'UTC', workingWeekdays: sample.weekdays as Array<1 | 2 | 3 | 4 | 5 | 6 | 7>, holidays: [] }] });
    }

    it('every pushed item is downstream, open and unstarted, moves later only, keeps its dates and duration, and no longer starts before a blocker', () => {
        fc.assert(
            fc.property(arb, (sample) => {
                const t = build(sample);
                const dragged = t.rows[sample.dragged]!;
                const base = dragged.startDate ?? dragged.dueDate;
                if (!base) return;
                const shift = (d: string | null) => (d === null ? null : fromEpochDay(toEpochDay(d) + sample.shift));
                const plan = planDateChange(t, { id: dragged.id, startDate: shift(dragged.startDate), dueDate: shift(dragged.dueDate) }, NONE_HIDDEN);
                if (!plan.ok) return;
                const reach = downstreamOf(t, dragged.id);
                const cal = compileCalendar({ id: 'cal', workingWeekdays: sample.weekdays as Array<1 | 2 | 3 | 4 | 5 | 6 | 7>, holidays: [] });
                const rows = new Map(t.rows.map((r) => [r.id, r]));
                for (const p of plan.push.items) {
                    const r = rows.get(p.id)!;
                    expect(reach.has(p.id)).toBe(true);
                    expect(['BACKLOG', 'UNSTARTED']).toContain(r.stateCategory);
                    expect(p.from).toEqual({ startDate: r.startDate, dueDate: r.dueDate });
                    // No date added or cleared; each moves to the same day or later, one strictly.
                    expect(p.to.startDate === null).toBe(p.from.startDate === null);
                    expect(p.to.dueDate === null).toBe(p.from.dueDate === null);
                    if (p.from.startDate) expect(p.to.startDate! >= p.from.startDate).toBe(true);
                    if (p.from.dueDate) expect(p.to.dueDate! >= p.from.dueDate).toBe(true);
                    expect(p.to.startDate !== p.from.startDate || p.to.dueDate !== p.from.dueDate).toBe(true);
                    if (p.from.startDate && p.from.dueDate) {
                        expect(workingDaysInclusive(cal, toEpochDay(p.to.startDate!), toEpochDay(p.to.dueDate!))).toBeGreaterThanOrEqual(
                            workingDaysInclusive(cal, toEpochDay(p.from.startDate), toEpochDay(p.from.dueDate)),
                        );
                    }
                }
                expect(plan.push.total).toBe(plan.push.items.length + 1);
                expect(plan.push.overLimit).toBe(plan.push.total > RESCHEDULE_MAX);
                const after = plan.push.withPushes.schedule;
                if (after.ok) {
                    const pushedIds = new Set(plan.push.items.map((i) => i.id));
                    const stillBefore = after.items.filter((i) => pushedIds.has(i.id) && i.conflicts.includes('STARTS_BEFORE_BLOCKER_FINISHES'));
                    expect(stillBefore).toEqual([]);
                }
            }),
            { numRuns: 300 },
        );
    });

    it('an unchanged date pushes nothing and has no effect', () => {
        fc.assert(
            fc.property(arb, (sample) => {
                const t = build(sample);
                const dragged = t.rows[sample.dragged]!;
                const plan = planDateChange(t, { id: dragged.id, startDate: dragged.startDate, dueDate: dragged.dueDate }, NONE_HIDDEN);
                if (!plan.ok) return;
                expect(plan.push.items).toEqual([]);
                expect(plan.effects.moved).toEqual([]);
                expect(plan.effects.newConflicts).toEqual([]);
            }),
            { numRuns: 200 },
        );
    });
});
