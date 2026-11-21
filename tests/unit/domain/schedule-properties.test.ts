/**
 * The scheduling engine's properties (roadmap H3: "cycles refused, results
 * stable under input reordering"; docs/porting/maps/3.1.md, "The engine").
 * Random inputs of up to thirty items on up to three calendars, with every
 * status, missing and reversed dates, deadlines and sub-items.
 */
import fc from 'fast-check';

import { computeSchedule } from '@/app-layer/domain/schedule/engine';
import { compileCalendar, isWorkingDay, type CalendarSpec, type IsoWeekday } from '@/app-layer/domain/schedule/calendar';
import type { ScheduleEdge, ScheduleInput, ScheduleItem, ScheduleResult } from '@/app-layer/domain/schedule/types';
import { hasCycle, wouldCreateCycle } from '@/app-layer/domain/work-item-graph';

const AS_OF = 20_454; // 2026-01-01
const RANGE = 90;

const calendarArb = (id: string): fc.Arbitrary<CalendarSpec> =>
    fc.record({
        id: fc.constant(id),
        workingWeekdays: fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 7 }) as fc.Arbitrary<IsoWeekday[]>,
        holidays: fc.uniqueArray(fc.integer({ min: AS_OF - 30, max: AS_OF + 200 }), { maxLength: 12 }),
    });

interface Shape {
    flat: boolean;
    status: 'any' | 'open';
    deadlines: boolean;
    maxDates: 0 | 1 | 2;
}

const dayArb = fc.option(fc.integer({ min: AS_OF - 20, max: AS_OF + RANGE }), { nil: null, freq: 3 });

function inputArb(shape: Shape): fc.Arbitrary<ScheduleInput> {
    return fc
        .record({
            calendars: fc.integer({ min: 1, max: 3 }).chain((k) => fc.tuple(...Array.from({ length: k }, (_, i) => calendarArb(`c${i}`)))),
            n: fc.integer({ min: 1, max: 30 }),
        })
        .chain(({ calendars, n }) =>
            fc.record({
                calendars: fc.constant(calendars as CalendarSpec[]),
                items: fc.tuple(
                    ...Array.from({ length: n }, (_, i) =>
                        fc
                            .record({
                                cal: fc.integer({ min: 0, max: calendars.length - 1 }),
                                parent: shape.flat || i === 0 ? fc.constant(null) : fc.option(fc.integer({ min: 0, max: i - 1 }), { nil: null, freq: 2 }),
                                start: shape.maxDates === 0 ? fc.constant(null) : dayArb,
                                due: shape.maxDates < 2 ? fc.constant(null) : dayArb,
                                status: shape.status === 'open' ? fc.constant('open' as const) : fc.constantFrom('open' as const, 'open' as const, 'started' as const, 'done' as const),
                                actualStart: fc.integer({ min: AS_OF - 30, max: AS_OF }),
                                length: fc.integer({ min: 0, max: 10 }),
                                milestoneDue: shape.deadlines ? dayArb : fc.constant(null),
                                projectDue: shape.deadlines ? dayArb : fc.constant(null),
                            })
                            .map(
                                (r): ScheduleItem => ({
                                    id: `i${String(i).padStart(2, '0')}`,
                                    calendarId: `c${r.cal}`,
                                    parentId: r.parent === null ? null : `i${String(r.parent).padStart(2, '0')}`,
                                    plannedStart: r.start,
                                    plannedFinish: r.due,
                                    status: r.status,
                                    actualStart: r.status === 'open' ? null : r.actualStart,
                                    actualFinish: r.status === 'done' ? r.actualStart + r.length : null,
                                    milestoneDue: r.milestoneDue,
                                    projectDue: r.projectDue,
                                }),
                            ),
                    ),
                ),
                // A DAG: an edge goes forward in a random order of the items.
                order: fc.shuffledSubarray(Array.from({ length: n }, (_, i) => i), { minLength: n, maxLength: n }),
                pairs: fc.array(fc.tuple(fc.integer({ min: 0, max: n - 1 }), fc.integer({ min: 0, max: n - 1 })), { maxLength: n * 2 }),
            }),
        )
        .map(({ calendars, items, order, pairs }) => {
            const rank = new Map(order.map((item, pos) => [item, pos]));
            const seen = new Set<string>();
            const edges: ScheduleEdge[] = [];
            for (const [a, b] of pairs) {
                if (a === b) continue;
                const [x, y] = rank.get(a)! < rank.get(b)! ? [a, b] : [b, a];
                const key = `${x}>${y}`;
                if (seen.has(key)) continue;
                seen.add(key);
                edges.push({ from: items[x]!.id, to: items[y]!.id });
            }
            return { asOf: AS_OF, calendars, items: [...items], edges };
        });
}

const ANY: Shape = { flat: false, status: 'any', deadlines: true, maxDates: 2 };
const FLAT: Shape = { flat: true, status: 'any', deadlines: true, maxDates: 2 };
const FLAT_OPEN: Shape = { flat: true, status: 'open', deadlines: false, maxDates: 2 };

/** A deterministic shuffle from a list of random keys. */
function shuffle<T>(xs: readonly T[], keys: readonly number[]): T[] {
    return xs.map((x, i) => [keys[i % Math.max(1, keys.length)]! + i / 1e6, x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
}

function okItems(r: ScheduleResult) {
    if (!r.ok) throw new Error(JSON.stringify(r));
    return new Map(r.items.map((i) => [i.id, i]));
}

const pairsOf = (edges: readonly ScheduleEdge[]) => edges.map((e) => [e.from, e.to] as const);

describe('computeSchedule — cycles', () => {
    it('a DAG of items with no sub-items is never refused', () => {
        fc.assert(fc.property(inputArb(FLAT), (input) => computeSchedule(input).ok), { numRuns: 300 });
    });

    it('one back edge is refused, and the cycle named is a real cycle of the input', () => {
        fc.assert(
            fc.property(inputArb({ ...FLAT_OPEN, maxDates: 0 }), fc.nat(), (input, pick) => {
                fc.pre(input.edges.length > 0);
                const e = input.edges[pick % input.edges.length]!;
                // Close a loop: something the edge's target reaches back to its source.
                const back = { from: e.to, to: e.from };
                const r = computeSchedule({ ...input, edges: [...input.edges, back] });
                if (r.ok || r.error !== 'CYCLE') return false;
                const all = new Set([...input.edges, back].map((x) => `${x.from}>${x.to}`));
                return r.cycle.every((id, i) => all.has(`${id}>${r.cycle[(i + 1) % r.cycle.length]}`));
            }),
            { numRuns: 300 },
        );
    });

    it('refuses exactly when the relation usecase would (wouldCreateCycle), and exactly the cyclic graphs (hasCycle)', () => {
        fc.assert(
            fc.property(inputArb({ ...FLAT_OPEN, maxDates: 0 }), fc.nat(), fc.nat(), (input, a, b) => {
                const from = input.items[a % input.items.length]!.id;
                const to = input.items[b % input.items.length]!.id;
                const edges = [...input.edges, { from, to }];
                const r = computeSchedule({ ...input, edges });
                const refused = !r.ok && r.error === 'CYCLE';
                return refused === wouldCreateCycle(pairsOf(input.edges), from, to) && refused === hasCycle(pairsOf(edges));
            }),
            { numRuns: 500 },
        );
    });
});

describe('computeSchedule — determinism', () => {
    it('shuffling items, edges, calendars and holidays gives the same result', () => {
        fc.assert(
            fc.property(inputArb(ANY), fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 40 }), (input, keys) => {
                const shuffled: ScheduleInput = {
                    asOf: input.asOf,
                    calendars: shuffle(input.calendars, keys).map((c) => ({ ...c, holidays: shuffle(c.holidays, keys), workingWeekdays: shuffle(c.workingWeekdays, keys) })),
                    items: shuffle(input.items, keys),
                    edges: shuffle(input.edges, [...keys].reverse()),
                };
                expect(computeSchedule(shuffled)).toEqual(computeSchedule(input));
            }),
            { numRuns: 300 },
        );
    });

    it('every number is a whole number, and every item passed is in the result once, sorted by id', () => {
        fc.assert(
            fc.property(inputArb(ANY), (input) => {
                const r = computeSchedule(input);
                if (!r.ok) return true;
                const ids = r.items.map((i) => i.id);
                const nums = r.items.flatMap((i) => [i.earliestStart, i.earliestFinish, i.latestStart, i.latestFinish, i.totalFloat, i.freeFloat, i.lateDays, i.durationDays]);
                return JSON.stringify(ids) === JSON.stringify(input.items.map((i) => i.id).sort()) && nums.every(Number.isInteger);
            }),
            { numRuns: 300 },
        );
    });
});

describe('computeSchedule — the passes', () => {
    it('is idempotent: writing each open item\'s earliest dates back as its plan changes nothing', () => {
        fc.assert(
            fc.property(inputArb(FLAT_OPEN), (input) => {
                const first = okItems(computeSchedule(input));
                const replanned: ScheduleInput = {
                    ...input,
                    items: input.items.map((i) => {
                        const s = first.get(i.id)!;
                        return s.unscheduled ? i : { ...i, plannedStart: s.earliestStart, plannedFinish: s.earliestFinish };
                    }),
                };
                const second = okItems(computeSchedule(replanned));
                return input.items.every((i) => first.get(i.id)!.earliestStart === second.get(i.id)!.earliestStart && first.get(i.id)!.earliestFinish === second.get(i.id)!.earliestFinish);
            }),
            { numRuns: 300 },
        );
    });

    it('adding an edge never makes an earliest start earlier', () => {
        fc.assert(
            fc.property(inputArb(FLAT), fc.nat(), fc.nat(), (input, a, b) => {
                const from = input.items[a % input.items.length]!.id;
                const to = input.items[b % input.items.length]!.id;
                fc.pre(!wouldCreateCycle(pairsOf(input.edges), from, to));
                const before = okItems(computeSchedule(input));
                const after = okItems(computeSchedule({ ...input, edges: [...input.edges, { from, to }] }));
                return input.items.every((i) => after.get(i.id)!.earliestStart >= before.get(i.id)!.earliestStart);
            }),
            { numRuns: 300 },
        );
    });

    it('a later "today" never makes an earliest start earlier', () => {
        fc.assert(
            fc.property(inputArb(ANY), fc.integer({ min: 1, max: 60 }), (input, later) => {
                const before = computeSchedule(input);
                fc.pre(before.ok);
                const b = okItems(before);
                const a = okItems(computeSchedule({ ...input, asOf: input.asOf + later }));
                return input.items.every((i) => a.get(i.id)!.earliestStart >= b.get(i.id)!.earliestStart);
            }),
            { numRuns: 300 },
        );
    });

    // With both dates, an item's duration is the working days its own planned
    // span holds, so a holiday inside that span shortens it; the property
    // holds for items whose duration a holiday cannot change (one date).
    it('a holiday never makes an earliest finish earlier (items with one date)', () => {
        fc.assert(
            fc.property(inputArb({ ...FLAT, maxDates: 1 }), fc.integer({ min: AS_OF, max: AS_OF + RANGE }), (input, holiday) => {
                const b = okItems(computeSchedule(input));
                const calendars = input.calendars.map((c) => ({ ...c, holidays: [...c.holidays, holiday] }));
                const a = okItems(computeSchedule({ ...input, calendars }));
                return input.items.every((i) => i.status !== 'open' || a.get(i.id)!.earliestFinish >= b.get(i.id)!.earliestFinish);
            }),
            { numRuns: 300 },
        );
    });

    it('no earliest or latest date of an open item is a non-working day of its calendar', () => {
        fc.assert(
            fc.property(inputArb(ANY), (input) => {
                const r = computeSchedule(input);
                if (!r.ok) return true;
                const cals = new Map(input.calendars.map((c) => [c.id, compileCalendar(c)]));
                const items = new Map(input.items.map((i) => [i.id, i]));
                return r.items.every((s) => {
                    const i = items.get(s.id)!;
                    if (s.summary || i.status !== 'open') return true;
                    const c = cals.get(i.calendarId)!;
                    return [s.earliestStart, s.earliestFinish, s.latestStart, s.latestFinish].every((d) => isWorkingDay(c, d));
                });
            }),
            { numRuns: 300 },
        );
    });

    it('free float is never negative nor more than total float when that is positive', () => {
        fc.assert(
            fc.property(inputArb(ANY), (input) => {
                const r = computeSchedule(input);
                if (!r.ok) return true;
                return r.items.every((s) => s.summary || (s.freeFloat >= 0 && s.freeFloat <= Math.max(0, s.totalFloat) && (s.lateDays === 0 || s.lateDays === -s.totalFloat)));
            }),
            { numRuns: 300 },
        );
    });
});

describe('computeSchedule — the critical path (decision 198)', () => {
    it('with no deadlines: non-empty when open work is scheduled, every critical item has float 0, and a critical item finishes the schedule', () => {
        fc.assert(
            fc.property(inputArb(FLAT_OPEN), (input) => {
                const r = computeSchedule(input);
                if (!r.ok) return false;
                const scheduled = r.items.filter((s) => !s.unscheduled || input.edges.some((e) => e.from === s.id || e.to === s.id));
                if (scheduled.length === 0) return r.items.every((s) => !s.critical);
                const critical = r.items.filter((s) => s.critical);
                return (
                    critical.length > 0 &&
                    critical.every((s) => s.totalFloat === 0) &&
                    critical.some((s) => (s.durationDays > 0 ? s.earliestFinish : s.earliestStart) === r.finish)
                );
            }),
            { numRuns: 300 },
        );
    });

    it('a critical edge joins two critical items with no gap between them', () => {
        fc.assert(
            fc.property(inputArb(FLAT), (input) => {
                const r = computeSchedule(input);
                if (!r.ok) return true;
                const by = okItems(r);
                const cals = new Map(input.calendars.map((c) => [c.id, compileCalendar(c)]));
                const items = new Map(input.items.map((i) => [i.id, i]));
                return r.criticalEdges.every((e) => {
                    const a = by.get(e.from)!;
                    const b = by.get(e.to)!;
                    if (!a.critical || !b.critical) return false;
                    const release = a.durationDays > 0 ? a.earliestFinish + 1 : a.earliestStart;
                    const c = cals.get(items.get(e.to)!.calendarId)!;
                    let next = release;
                    while (!isWorkingDay(c, next)) next += 1;
                    return b.earliestStart === next || items.get(e.to)!.status !== 'open';
                });
            }),
            { numRuns: 300 },
        );
    });

    it('with deadlines: the critical items share the least float, which is 0 or less', () => {
        fc.assert(
            fc.property(inputArb(ANY), (input) => {
                const r = computeSchedule(input);
                if (!r.ok) return true;
                const critical = r.items.filter((s) => s.critical);
                if (critical.length === 0) return true;
                const least = critical[0]!.totalFloat;
                const live = input.items.filter((i) => i.status !== 'done').map((i) => i.id);
                const others = r.items.filter((s) => live.includes(s.id) && !s.summary && !s.unscheduled);
                return least <= 0 && critical.every((s) => s.totalFloat === least) && others.every((s) => s.totalFloat >= least);
            }),
            { numRuns: 300 },
        );
    });
});
