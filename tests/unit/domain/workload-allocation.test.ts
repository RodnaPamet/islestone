/**
 * Allocation (sub-phase 3.5b; docs/porting/maps/3.5.md, "Placing hours into
 * weeks" and "H3 and 3.5"): an item's placed minutes sum to its remaining
 * minutes exactly, every week's share is non-negative, none lands before
 * today, a later due date never moves minutes earlier, each week is within
 * one minute of its exact share, points never appear in an hours sum (they
 * never reach the module), and the figures do not depend on the window.
 */
import fc from 'fast-check';

import { compileCalendar, defaultCalendar, isWorkingDay, toEpochDay, workingDaysInclusive, type IsoWeekday } from '@/app-layer/domain/schedule/calendar';
import { overCapacityMinutes, placeItem, placementSpan, remainingMinutes, sumPlacements } from '@/app-layer/domain/workload/allocation';
import { buildWorkload, hasShareInWindow, isOverInWindow, type WorkloadItemSpec } from '@/app-layer/domain/workload/workload';

const day = toEpochDay;
const MON = day('2026-12-07');
const cal = defaultCalendar();

describe('remaining minutes', () => {
    it('is the estimate less the time spent, never below zero', () => {
        expect(remainingMinutes(600, null)).toBe(600);
        expect(remainingMinutes(600, 120)).toBe(480);
        expect(remainingMinutes(600, 900)).toBe(0);
    });
});

describe('placing one item', () => {
    it('spreads 7 hours over three working days as 420 minutes, the odd minutes early', () => {
        // Wed 9 Dec to Fri 11 Dec, today Monday 7 Dec.
        const p = placeItem({ startDate: day('2026-12-09'), dueDate: day('2026-12-11'), remainingMinutes: 420 }, cal, MON, MON, 2)!;
        expect(p.reason).toBe('SPREAD');
        expect(p.workingDays).toBe(3);
        expect(p.weeks).toEqual([420, 0]);
        expect(p.later).toBe(0);
    });

    it('shares a span across weeks by working days, rounding up', () => {
        // Thu 10 Dec to Tue 15 Dec: Thu, Fri | Mon, Tue = 4 working days; 10 minutes → 5 | 5.
        const p = placeItem({ startDate: day('2026-12-10'), dueDate: day('2026-12-15'), remainingMinutes: 10 }, cal, MON, MON, 2)!;
        expect(p.weeks).toEqual([5, 5]);
        // 7 minutes over 4 days, 2 in the first week: ⌈7·2/4⌉ = 4, then 3.
        const q = placeItem({ startDate: day('2026-12-10'), dueDate: day('2026-12-15'), remainingMinutes: 7 }, cal, MON, MON, 2)!;
        expect(q.weeks).toEqual([4, 3]);
    });

    it('starts from today when the span began earlier, and puts overdue work on today, marked', () => {
        const today = day('2026-12-09');
        const p = placeItem({ startDate: day('2026-11-30'), dueDate: day('2026-12-11'), remainingMinutes: 300 }, cal, today, MON, 1)!;
        expect(p.from).toBe(today);
        expect(p.workingDays).toBe(3);
        const late = placeItem({ startDate: null, dueDate: day('2026-12-01'), remainingMinutes: 300 }, cal, today, MON, 2)!;
        expect(late.reason).toBe('OVERDUE');
        expect(late.from).toBe(today);
        expect(late.weeks).toEqual([300, 0]);
    });

    it('puts today\'s weekend work on the next working day', () => {
        const saturday = day('2026-12-12');
        const late = placeItem({ startDate: null, dueDate: day('2026-12-08'), remainingMinutes: 60 }, cal, saturday, MON, 2)!;
        expect(late.from).toBe(day('2026-12-14'));
        expect(late.weeks).toEqual([0, 60]);
        // Due on the Sunday after a Saturday today: no working day left before it, so the Monday, not marked overdue.
        const sunday = placeItem({ startDate: null, dueDate: day('2026-12-13'), remainingMinutes: 60 }, cal, saturday, MON, 2)!;
        expect(sunday.reason).toBe('ONE_DAY');
        expect(sunday.from).toBe(day('2026-12-14'));
    });

    it('reads one date as one working day (the engine\'s span rule), and neither date as unplaced', () => {
        const due = placementSpan({ startDate: null, dueDate: day('2026-12-16') }, cal, MON)!;
        expect(due).toEqual({ from: day('2026-12-16'), to: day('2026-12-16'), workingDays: 1, reason: 'ONE_DAY' });
        const start = placementSpan({ startDate: day('2026-12-19'), dueDate: null }, cal, MON)!;
        expect(start).toEqual({ from: day('2026-12-21'), to: day('2026-12-21'), workingDays: 1, reason: 'ONE_DAY' });
        // Start after due: one day at the due date.
        const reversed = placementSpan({ startDate: day('2026-12-18'), dueDate: day('2026-12-15') }, cal, MON)!;
        expect(reversed).toEqual({ from: day('2026-12-15'), to: day('2026-12-15'), workingDays: 1, reason: 'ONE_DAY' });
        expect(placementSpan({ startDate: null, dueDate: null }, cal, MON)).toBeNull();
    });

    it('sends weeks after the window to "Later" and before it to its own figure', () => {
        const p = placeItem({ startDate: day('2026-12-07'), dueDate: day('2026-12-25'), remainingMinutes: 1500 }, cal, MON, day('2026-12-14'), 1)!;
        expect(p.before).toBe(500);
        expect(p.weeks).toEqual([500]);
        expect(p.later).toBe(500);
    });

    it('skips holidays on the item\'s calendar', () => {
        const withHoliday = compileCalendar({ id: 'h', workingWeekdays: [1, 2, 3, 4, 5], holidays: [day('2026-12-08')] });
        const p = placeItem({ startDate: day('2026-12-07'), dueDate: day('2026-12-09'), remainingMinutes: 120 }, withHoliday, MON, MON, 1)!;
        expect(p.workingDays).toBe(2);
        expect(p.weeks).toEqual([120]);
    });
});

const calendars = fc
    .record({
        days: fc.subarray([1, 2, 3, 4, 5, 6, 7] as IsoWeekday[], { minLength: 1 }),
        holidays: fc.array(fc.integer({ min: MON - 30, max: MON + 200 }), { maxLength: 20 }),
    })
    .map((c) => compileCalendar({ id: 'c', workingWeekdays: c.days, holidays: c.holidays }));

const items = fc.record({
    start: fc.option(fc.integer({ min: MON - 60, max: MON + 150 }), { nil: null }),
    due: fc.option(fc.integer({ min: MON - 60, max: MON + 150 }), { nil: null }),
    minutes: fc.integer({ min: 0, max: 60_000 }),
});

describe('allocation properties', () => {
    it('places the remaining minutes exactly, never negative, never before today, each week within a minute of its share', () => {
        fc.assert(
            fc.property(calendars, items, fc.integer({ min: 0, max: 20 }), fc.integer({ min: 0, max: 6 }), fc.integer({ min: 1, max: 26 }), (c, it, offset, todayShift, weekCount) => {
                const today = MON + todayShift;
                const firstMonday = MON + 7 * offset;
                const p = placeItem({ startDate: it.start, dueDate: it.due, remainingMinutes: it.minutes }, c, today, firstMonday, weekCount);
                if (it.start === null && it.due === null) {
                    expect(p).toBeNull();
                    return;
                }
                expect(p).not.toBeNull();
                const placed = p!;
                expect(placed.before + placed.weeks.reduce((a, b) => a + b, 0) + placed.later).toBe(it.minutes);
                expect([placed.before, placed.later, ...placed.weeks].every((m) => m >= 0)).toBe(true);
                expect(placed.from).toBeGreaterThanOrEqual(today);
                expect(isWorkingDay(c, placed.from)).toBe(true);
                // Within one minute of the exact share.
                for (let k = 0; k < weekCount; k += 1) {
                    const mon = firstMonday + 7 * k;
                    const days = workingDaysInclusive(c, Math.max(placed.from, mon), Math.min(placed.to, mon + 6));
                    const exact = (it.minutes * days) / placed.workingDays;
                    expect(Math.abs(placed.weeks[k]! - exact)).toBeLessThan(1);
                }
            }),
        );
    });

    it('never moves minutes earlier when the due date is later', () => {
        fc.assert(
            fc.property(calendars, items, fc.integer({ min: 0, max: 60 }), (c, it, later) => {
                if (it.due === null) return;
                const a = placeItem({ startDate: it.start, dueDate: it.due, remainingMinutes: it.minutes }, c, MON, MON, 26)!;
                const b = placeItem({ startDate: it.start, dueDate: it.due + later, remainingMinutes: it.minutes }, c, MON, MON, 26)!;
                let ca = a.before;
                let cb = b.before;
                for (let k = 0; k < 26; k += 1) {
                    ca += a.weeks[k]!;
                    cb += b.weeks[k]!;
                    expect(cb).toBeLessThanOrEqual(ca);
                }
            }),
        );
    });

    it('gives the same week the same minutes whatever window it is read in', () => {
        fc.assert(
            fc.property(calendars, items, fc.integer({ min: 1, max: 10 }), (c, it, shift) => {
                if (it.start === null && it.due === null) return;
                const whole = placeItem({ startDate: it.start, dueDate: it.due, remainingMinutes: it.minutes }, c, MON, MON, 26)!;
                const part = placeItem({ startDate: it.start, dueDate: it.due, remainingMinutes: it.minutes }, c, MON, MON + 7 * shift, 26 - shift)!;
                expect(part.weeks).toEqual(whole.weeks.slice(shift));
            }),
        );
    });
});

describe('over capacity (decision 296)', () => {
    it('is allocation above capacity, and any allocation in a week with none', () => {
        expect(overCapacityMinutes(2760, 2400)).toBe(360);
        expect(overCapacityMinutes(2400, 2400)).toBe(0);
        expect(overCapacityMinutes(1, 0)).toBe(1);
        expect(overCapacityMinutes(0, 0)).toBe(0);
    });

    it('sums placements by week', () => {
        const a = placeItem({ startDate: MON, dueDate: MON + 4, remainingMinutes: 500 }, cal, MON, MON, 2)!;
        const b = placeItem({ startDate: MON + 7, dueDate: MON + 8, remainingMinutes: 120 }, cal, MON, MON, 1)!;
        expect(sumPlacements([a, b], 2)).toEqual({ weeks: [500, 0], before: 0, later: 120 });
    });
});

describe('a workspace\'s figures', () => {
    const item = (over: Partial<WorkloadItemSpec>): WorkloadItemSpec => ({
        id: over.id ?? 'i',
        assigneeId: 'ana',
        projectId: 'web',
        teamId: 't',
        startDate: MON,
        dueDate: MON + 4,
        estimateMinutes: 600,
        spentMinutes: null,
        ...over,
    });
    const run = (items: WorkloadItemSpec[], share?: { projectId?: string; teamId?: string }) =>
        buildWorkload({
            firstMonday: MON,
            weekCount: 2,
            people: [
                { userId: 'ana', person: { active: true, rows: [], timeOff: [] } },
                { userId: 'bo', person: { active: false, rows: [], timeOff: [] } },
            ],
            capacity: { defaultWeeklyMinutes: 2400, calendarFor: () => cal },
            items,
            calendarOfTeam: () => ({ calendar: cal, today: MON }),
            share,
        });

    it('places each counted item on its assignee, flags over capacity, and names undated work', () => {
        const out = run([
            item({ id: 'a', estimateMinutes: 2000 }),
            item({ id: 'b', estimateMinutes: 700, spentMinutes: 100 }),
            item({ id: 'c', startDate: null, dueDate: null, estimateMinutes: 90 }),
            item({ id: 'd', assigneeId: 'bo', estimateMinutes: 60 }),
            item({ id: 'e', assigneeId: null, estimateMinutes: 300, projectId: 'ops' }),
            item({ id: 'f', assigneeId: 'gone', estimateMinutes: 300 }),
        ]);
        const ana = out.rows.get('ana')!;
        expect(ana.allocated).toEqual([2600, 0]);
        expect(ana.over).toEqual([200, 0]);
        expect(ana.noDates).toEqual({ count: 1, minutes: 90 });
        expect(isOverInWindow(ana)).toBe(true);
        // A deactivated member has no capacity: any work is over.
        const bo = out.rows.get('bo')!;
        expect(bo.capacity[0]!.capacityMinutes).toBe(0);
        expect(bo.over).toEqual([60, 0]);
        // Unassigned work is its own row, never over.
        expect(out.unassigned.allocated).toEqual([300, 0]);
        expect(out.unassigned.over).toEqual([0, 0]);
        expect(out.rows.has('gone')).toBe(false);
        expect(out.placed.get('ana')!.map((p) => p.item.id)).toEqual(['a', 'b']);
    });

    it('reports a project\'s share beside the whole', () => {
        const out = run([item({ id: 'a', estimateMinutes: 600 }), item({ id: 'b', estimateMinutes: 300, projectId: 'ops' })], { projectId: 'web' });
        const ana = out.rows.get('ana')!;
        expect(ana.allocated[0]).toBe(900);
        expect(ana.share).toEqual([600, 0]);
        expect(hasShareInWindow(ana)).toBe(true);
        expect(hasShareInWindow(out.rows.get('bo')!)).toBe(false);
        expect(run([item({ id: 'a' })]).rows.get('ana')!.share).toBeNull();
    });
});
