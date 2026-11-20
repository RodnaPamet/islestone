/**
 * The cycle date arithmetic (sub-phase 2.5a, `src/app-layer/domain/cycle.ts`):
 * statuses, scheduled windows and the schedule's plan, with property tests for
 * the rules the plan must never break: no window overlaps another or an
 * existing cycle, none has ended before today, and a re-run plans nothing new.
 */
import fc from 'fast-check';

import {
    addDays,
    cycleStatus,
    daysLeft,
    fromDayKey,
    nextCycleAfter,
    planScheduledCycles,
    rangesOverlap,
    scheduledWindow,
    windowIndexAt,
    type CycleRange,
} from '@/app-layer/domain/cycle';

const d = fromDayKey;

describe('cycleStatus and daysLeft', () => {
    const c = { startsOn: d('2026-11-02'), endsOn: d('2026-11-15'), completedAt: null };

    it('is upcoming before the first day, current through the last day, ended after it until closed', () => {
        expect(cycleStatus(c, d('2026-11-01'))).toBe('upcoming');
        expect(cycleStatus(c, d('2026-11-02'))).toBe('current');
        expect(cycleStatus(c, d('2026-11-15'))).toBe('current');
        expect(cycleStatus(c, d('2026-11-16'))).toBe('ended');
        expect(cycleStatus({ ...c, completedAt: new Date() }, d('2026-11-16'))).toBe('completed');
        expect(cycleStatus({ ...c, completedAt: new Date() }, d('2026-11-03'))).toBe('completed');
    });

    it('counts today among the days left', () => {
        expect(daysLeft(c, d('2026-11-15'))).toBe(1);
        expect(daysLeft(c, d('2026-11-02'))).toBe(14);
        expect(daysLeft(c, d('2026-10-20'))).toBe(14);
        expect(daysLeft(c, d('2026-11-16'))).toBe(0);
    });
});

describe('scheduled windows', () => {
    const s = { lengthWeeks: 2, firstStartsOn: d('2026-11-02'), upcomingCount: 2 };

    it('steps whole lengths from the first start, inclusive ranges of length × 7 days', () => {
        expect(scheduledWindow(s, 0)).toEqual({ startsOn: d('2026-11-02'), endsOn: d('2026-11-15') });
        expect(scheduledWindow(s, 1)).toEqual({ startsOn: d('2026-11-16'), endsOn: d('2026-11-29') });
        expect(windowIndexAt(s, d('2026-11-15'))).toBe(0);
        expect(windowIndexAt(s, d('2026-11-16'))).toBe(1);
        expect(windowIndexAt(s, d('2026-10-01'))).toBe(0);
    });

    it('plans the window containing today and the upcoming count after it', () => {
        expect(planScheduledCycles(s, [], d('2026-11-20'))).toEqual([
            scheduledWindow(s, 1),
            scheduledWindow(s, 2),
            scheduledWindow(s, 3),
        ]);
    });

    it('skips a window an existing cycle overlaps', () => {
        const oneOff = { startsOn: d('2026-12-01'), endsOn: d('2026-12-03') };
        expect(planScheduledCycles(s, [oneOff], d('2026-11-20'))).toEqual([scheduledWindow(s, 1), scheduledWindow(s, 3)]);
    });

    it('never plans an overlap, an ended window or a second copy (property)', () => {
        const range = fc
            .tuple(fc.integer({ min: 0, max: 400 }), fc.integer({ min: 0, max: 30 }))
            .map(([start, len]): CycleRange => ({ startsOn: addDays(d('2026-01-01'), start), endsOn: addDays(d('2026-01-01'), start + len) }));
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 8 }),
                fc.integer({ min: 1, max: 6 }),
                fc.integer({ min: 0, max: 300 }),
                fc.integer({ min: 0, max: 500 }),
                fc.array(range, { maxLength: 6 }),
                (lengthWeeks, upcomingCount, firstOffset, todayOffset, rawExisting) => {
                    // Existing cycles of a team never overlap each other.
                    const existing: CycleRange[] = [];
                    for (const r of rawExisting) if (!existing.some((e) => rangesOverlap(e, r))) existing.push(r);
                    const schedule = { lengthWeeks, upcomingCount, firstStartsOn: addDays(d('2026-01-01'), firstOffset) };
                    const today = addDays(d('2026-01-01'), todayOffset);
                    const plan = planScheduledCycles(schedule, existing, today);
                    expect(plan.length).toBeLessThanOrEqual(upcomingCount + 1);
                    for (const [i, w] of plan.entries()) {
                        expect(w.endsOn.getTime()).toBeGreaterThanOrEqual(today.getTime());
                        expect(existing.some((e) => rangesOverlap(e, w))).toBe(false);
                        for (const other of plan.slice(i + 1)) expect(rangesOverlap(w, other)).toBe(false);
                    }
                    expect(planScheduledCycles(schedule, [...existing, ...plan], today)).toEqual([]);
                },
            ),
        );
    });
});

describe('nextCycleAfter', () => {
    it('takes the earliest cycle starting after the end, skipping completed ones', () => {
        const a = { id: 'a', startsOn: d('2026-11-16'), endsOn: d('2026-11-29'), completedAt: null };
        const b = { id: 'b', startsOn: d('2026-11-30'), endsOn: d('2026-12-13'), completedAt: null };
        const done = { id: 'x', startsOn: d('2026-11-16'), endsOn: d('2026-11-20'), completedAt: new Date() };
        expect(nextCycleAfter([b, a], d('2026-11-15'))?.id).toBe('a');
        expect(nextCycleAfter([b, done], d('2026-11-15'))?.id).toBe('b');
        expect(nextCycleAfter([a], d('2026-11-29'))).toBeNull();
    });
});
