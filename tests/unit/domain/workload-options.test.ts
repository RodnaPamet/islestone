/**
 * Ways to rebalance (sub-phase 3.5c; docs/porting/maps/3.5.md, "Ways to
 * rebalance (3.5c)" and "H3 and 3.5"; decision 299): an "Assign to" option
 * never names someone who would go over in any week of the item's placement,
 * nor anyone off the item's project; a "Move dates" option moves later only,
 * keeps the item's working-day duration and brings the person within
 * capacity in every week it covers, and no earlier move would; options are
 * worked out only for an over-capacity week; nothing an option offers is
 * written by computing it (the inputs come back unchanged).
 */
import fc from 'fast-check';

import { defaultCalendar, toEpochDay, workingDaysInclusive, type EpochDay } from '@/app-layer/domain/schedule/calendar';
import { movePlannedDates } from '@/app-layer/domain/schedule/move';
import { placeItem, remainingMinutes } from '@/app-layer/domain/workload/allocation';
import { fitsEveryWeek, planRebalance, REBALANCE_LIMITS, type RebalanceInput, type RebalancePerson } from '@/app-layer/domain/workload/options';
import type { WorkloadItemSpec } from '@/app-layer/domain/workload/workload';
import { proposeDates } from '@/lib/work-items/reschedule';

const day = toEpochDay;
const MON = day('2026-12-07');
const cal = defaultCalendar();
const WEEKS = 30;
const calendarOfTeam = () => ({ calendar: cal, today: MON });

function item(id: string, assigneeId: string, projectId: string, startDate: string | null, dueDate: string | null, estimateMinutes: number): WorkloadItemSpec {
    return { id, assigneeId, projectId, teamId: 't1', startDate: startDate ? day(startDate) : null, dueDate: dueDate ? day(dueDate) : null, estimateMinutes, spentMinutes: null };
}
const flat = (minutes: number) => new Array<number>(WEEKS).fill(minutes);

function input(person: RebalancePerson, others: RebalancePerson[] | null, extra: Partial<RebalanceInput> = {}): RebalanceInput {
    return { firstMonday: MON, weekCount: WEEKS, cellWeek: MON, person, wholeDaysOff: [], others, calendarOfTeam, offer: { assign: true, moveDates: true }, ...extra };
}

describe('the move rule', () => {
    it('is the timeline\'s: proposeDates moves through it', () => {
        for (const days of [1, 2, 5, 6, 12]) {
            const moved = movePlannedDates({ startDate: day('2026-12-09'), dueDate: day('2026-12-15') }, cal, days);
            const proposed = proposeDates({ startDate: '2026-12-09', dueDate: '2026-12-15' }, cal, 'move', days);
            expect(proposed).toEqual({ startDate: moved.startDate === null ? null : new Date(moved.startDate * 86_400_000).toISOString().slice(0, 10), dueDate: new Date(moved.dueDate! * 86_400_000).toISOString().slice(0, 10) });
            expect(workingDaysInclusive(cal, moved.startDate!, moved.dueDate!)).toBe(5);
        }
    });
});

describe('an over-capacity week', () => {
    // Ana: 30h and 20h this week against 40h, over by 10h.
    const ana: RebalancePerson = {
        userId: 'ana',
        name: 'Ana',
        capacity: flat(2400),
        items: [item('a', 'ana', 'p1', '2026-12-07', '2026-12-11', 1800), item('b', 'ana', 'p1', '2026-12-07', '2026-12-11', 1200)],
    };
    const bo: RebalancePerson = { userId: 'bo', name: 'Bo', capacity: flat(2400), items: [item('bo1', 'bo', 'p1', '2026-12-07', '2026-12-11', 600)] };
    const cy: RebalancePerson = { userId: 'cy', name: 'Cy', capacity: flat(2400), items: [item('cy1', 'cy', 'p1', '2026-12-07', '2026-12-11', 2000)] };
    const dee: RebalancePerson = { userId: 'dee', name: 'Dee', capacity: flat(2400), items: [item('dee1', 'dee', 'p2', '2026-12-07', '2026-12-11', 60)] };

    it('lists the largest items first and names who on the project has room, most free first', () => {
        const plan = planRebalance(input(ana, [bo, cy, dee]))!;
        expect(plan.items.map((i) => [i.itemId, i.minutes])).toEqual([
            ['a', 1800],
            ['b', 1200],
        ]);
        // Bo (30h free) takes either; Cy (6h 40m free) neither; Dee is not on the project.
        expect(plan.items[0]!.assignTo).toEqual([{ userId: 'bo', name: 'Bo', freeMinutes: 1800 }]);
        expect(plan.items[1]!.assignTo).toEqual([{ userId: 'bo', name: 'Bo', freeMinutes: 1800 }]);
    });

    it('moves an item to the earliest later dates that fit, keeping its five working days', () => {
        const plan = planRebalance(input(ana, [bo]))!;
        // A moved by one working day puts 24h in this week (44h); by two, 18h (38h): Wednesday to next Tuesday.
        expect(plan.items[0]!.moveTo).toEqual({ startDate: day('2026-12-09'), dueDate: day('2026-12-15'), from: day('2026-12-09'), to: day('2026-12-15') });
    });

    it('offers only what the viewer could write', () => {
        const assignOnly = planRebalance(input(ana, [bo], { offer: { assign: true, moveDates: false } }))!;
        expect(assignOnly.items.every((i) => i.moveTo === null)).toBe(true);
        const datesOnly = planRebalance(input(ana, [bo], { offer: { assign: false, moveDates: true } }))!;
        expect(datesOnly.items.every((i) => i.assignTo.length === 0 && i.moveTo !== null)).toBe(true);
        // The others' work unknown: nobody named, dates still worked out.
        const unknown = planRebalance(input(ana, null))!;
        expect(unknown.items.every((i) => i.assignTo.length === 0 && i.moveTo !== null)).toBe(true);
    });

    it('names an item due on a whole day off', () => {
        const plan = planRebalance(input(ana, [bo], { wholeDaysOff: [day('2026-12-11')] }))!;
        expect(plan.dueDuringTimeOff).toEqual([
            { itemId: 'a', dueDate: day('2026-12-11') },
            { itemId: 'b', dueDate: day('2026-12-11') },
        ]);
    });

    it('works out nothing for a week within capacity', () => {
        expect(planRebalance(input({ ...ana, capacity: flat(3000) }, [bo]))).toBeNull();
    });

    it('names at most three people, then by name', () => {
        const many = ['eve', 'fay', 'gus', 'hal'].map((u): RebalancePerson => ({ userId: u, name: u.toUpperCase(), capacity: flat(2400), items: [item(`${u}1`, u, 'p1', '2026-12-07', '2026-12-11', 60)] }));
        const plan = planRebalance(input(ana, many))!;
        expect(plan.items[0]!.assignTo.map((o) => o.userId)).toEqual(['eve', 'fay', 'gus']);
    });

    it('offers no one for an item that runs past the window', () => {
        const long = { ...ana, items: [...ana.items, item('long', 'ana', 'p1', '2026-12-07', '2028-01-07', 60_000)] };
        const plan = planRebalance(input(long, [bo]))!;
        const l = plan.items.find((i) => i.itemId === 'long')!;
        expect(l.assignTo).toEqual([]);
        expect(l.moveTo).toBeNull();
    });
});

// ─── Properties ────────────────────────────────────────────────────────────

const dateArb = fc.integer({ min: -20, max: 60 }).map((n) => MON + n);
const itemArb = (assigneeId: string, id: string) =>
    fc.record({
        startDate: fc.option(dateArb, { nil: null }),
        dueDate: fc.option(dateArb, { nil: null }),
        estimateMinutes: fc.integer({ min: 0, max: 3000 }),
        projectId: fc.constantFrom('p1', 'p2'),
    }).map((r): WorkloadItemSpec => ({ id, assigneeId, teamId: 't1', spentMinutes: null, ...r }));
const personArb = (userId: string) =>
    fc.record({
        capacity: fc.array(fc.integer({ min: 0, max: 3000 }), { minLength: WEEKS, maxLength: WEEKS }),
        count: fc.integer({ min: 0, max: 6 }),
    }).chain(({ capacity, count }) =>
        fc.tuple(...Array.from({ length: count }, (_, i) => itemArb(userId, `${userId}-${i}`))).map((items): RebalancePerson => ({ userId, name: userId, capacity, items })),
    );
const worldArb = fc.record({ person: personArb('me'), others: fc.tuple(personArb('o1'), personArb('o2'), personArb('o3')), cell: fc.integer({ min: 0, max: 8 }) });

function allocationOf(p: RebalancePerson, without?: string): number[] {
    const out = new Array<number>(WEEKS).fill(0);
    for (const i of p.items) {
        if (i.id === without) continue;
        const placed = placeItem({ startDate: i.startDate, dueDate: i.dueDate, remainingMinutes: remainingMinutes(i.estimateMinutes, i.spentMinutes) }, cal, MON, MON, WEEKS);
        if (placed) placed.weeks.forEach((m, k) => (out[k]! += m));
    }
    return out;
}
const placementOf = (i: WorkloadItemSpec, dates = { startDate: i.startDate, dueDate: i.dueDate }) =>
    placeItem({ ...dates, remainingMinutes: remainingMinutes(i.estimateMinutes, i.spentMinutes) }, cal, MON, MON, WEEKS);

describe('properties', () => {
    it('never names someone who would go over in any week the item covers, nor anyone off its project', () => {
        fc.assert(
            fc.property(worldArb, ({ person, others, cell }) => {
                const plan = planRebalance(input(person, [...others], { cellWeek: MON + 7 * cell }));
                if (!plan) return;
                for (const opt of plan.items) {
                    const x = person.items.find((i) => i.id === opt.itemId)!;
                    const p = placementOf(x)!;
                    expect(opt.assignTo.length).toBeLessThanOrEqual(REBALANCE_LIMITS.assignees);
                    for (const a of opt.assignTo) {
                        const o = others.find((q) => q.userId === a.userId)!;
                        expect(o.items.some((i) => i.projectId === x.projectId && (placementOf(i)?.weeks.some((m) => m > 0) ?? false))).toBe(true);
                        const alloc = allocationOf(o);
                        for (let k = 0; k < WEEKS; k += 1) {
                            if (MON + 7 * k + 6 < p.from || MON + 7 * k > p.to) continue;
                            expect(alloc[k]! + p.weeks[k]!).toBeLessThanOrEqual(o.capacity[k]!);
                        }
                    }
                }
            }),
            { numRuns: 600 },
        );
    });

    it('moves later only, within capacity in every week it covers, and no earlier move fits', () => {
        fc.assert(
            fc.property(worldArb, ({ person, cell }) => {
                const plan = planRebalance(input(person, [], { cellWeek: MON + 7 * cell }));
                if (!plan) return;
                for (const opt of plan.items) {
                    if (!opt.moveTo) continue;
                    const x = person.items.find((i) => i.id === opt.itemId)!;
                    const ref = x.dueDate ?? x.startDate!;
                    const moved = x.dueDate !== null ? opt.moveTo.dueDate! : opt.moveTo.startDate!;
                    expect(moved).toBeGreaterThan(ref);
                    expect(opt.moveTo.dueDate === null).toBe(x.dueDate === null);
                    expect(opt.moveTo.startDate === null).toBe(x.startDate === null);
                    const without = allocationOf(person, x.id);
                    const p = placementOf(x, { startDate: opt.moveTo.startDate, dueDate: opt.moveTo.dueDate })!;
                    expect(p.reason).not.toBe('OVERDUE');
                    for (let k = 0; k < WEEKS; k += 1) {
                        if (MON + 7 * k + 6 < p.from || MON + 7 * k > p.to) continue;
                        expect(without[k]! + p.weeks[k]!).toBeLessThanOrEqual(person.capacity[k]!);
                    }
                    // No earlier move fits.
                    for (let d = 1; ; d += 1) {
                        const earlier = movePlannedDates({ startDate: x.startDate, dueDate: x.dueDate }, cal, d);
                        if (earlier.startDate === opt.moveTo.startDate && earlier.dueDate === opt.moveTo.dueDate) break;
                        const q = placementOf(x, earlier)!;
                        if (q.reason === 'OVERDUE') continue;
                        expect(fitsEveryWeek({ firstMonday: MON, weekCount: WEEKS }, q, without, person.capacity)).toBe(false);
                    }
                }
            }),
            { numRuns: 600 },
        );
    });

    it('is worked out only for an over-capacity week, its items most minutes first, and writes nothing', () => {
        fc.assert(
            fc.property(worldArb, ({ person, others, cell }) => {
                const frozen = JSON.stringify({ person, others });
                const plan = planRebalance(input(person, [...others], { cellWeek: MON + 7 * cell }));
                expect(JSON.stringify({ person, others })).toBe(frozen);
                const alloc = allocationOf(person);
                if (alloc[cell]! <= person.capacity[cell]!) {
                    expect(plan).toBeNull();
                    return;
                }
                expect(plan).not.toBeNull();
                const minutes = plan!.items.map((i) => i.minutes);
                expect([...minutes].sort((a, b) => b - a)).toEqual(minutes);
                expect(plan!.items.length).toBeLessThanOrEqual(REBALANCE_LIMITS.largest);
                expect(minutes.every((m) => m > 0)).toBe(true);
            }),
            { numRuns: 600 },
        );
    });
});

// A guard against an `EpochDay` slipping into a string compare.
const _typed: EpochDay = MON;
void _typed;
