/**
 * The measures of sub-phase 3.6a (`src/app-layer/domain/analytics/`; owner
 * decisions 311 to 313; ADR 0014 §2 and §3): nearest-rank percentiles on
 * hand-computed vectors, elapsed working time (whole non-working days
 * removed, a day's own length across an offset change, never negative,
 * equal to a brute-force sum), completion as of a moment (a reopen moves it,
 * a deletion retracts it, a restore returns it, cancelled never counts, the
 * future is never read), and cycle time, lead time and age.
 */
import fc from 'fast-check';
import type { WorkflowStateCategory } from '@prisma/client';

import { completionAsOf, completionsAsOf } from '@/app-layer/domain/analytics/completion';
import { ageStartAsOf, completionInstantsAsOf } from '@/app-layer/domain/analytics/durations';
import { WorkingTimeMeter, elapsedWorkingDays, type DurationCalendar } from '@/app-layer/domain/analytics/elapsed';
import { nearestRank, summarise } from '@/app-layer/domain/analytics/percentiles';
import { byItem, pictureAt, type RecordFact } from '@/app-layer/domain/analytics/record';
import { DayStarts, epochDayOf } from '@/app-layer/domain/analytics/zone';
import { compileCalendar, isWorkingDay, toEpochDay } from '@/app-layer/domain/schedule/calendar';

const monFri = (timeZone = 'UTC', holidays: string[] = []): DurationCalendar => ({
    timeZone,
    compiled: compileCalendar({ id: 'c', workingWeekdays: [1, 2, 3, 4, 5], holidays: holidays.map((h) => toEpochDay(h)) }),
});

let seq = 0;
function f(workItemId: string, at: string, stateCategory: WorkflowStateCategory, extra: Partial<RecordFact> = {}): RecordFact {
    seq += 1;
    return { workItemId, projectId: 'p1', teamId: 't1', cycleId: null, stateCategory, deleted: false, at: new Date(at), seq, ...extra };
}

describe('nearestRank (one definition everywhere)', () => {
    const one20 = Array.from({ length: 20 }, (_, i) => i + 1);
    it('takes the value at ceil(p × n) − 1 of the sorted list', () => {
        expect(nearestRank(one20, 0.5)).toBe(10);
        expect(nearestRank(one20, 0.85)).toBe(17);
        expect(nearestRank(one20, 0.95)).toBe(19);
        expect(nearestRank(one20, 1)).toBe(20);
        expect(nearestRank([7], 0.5)).toBe(7);
        expect(nearestRank([1, 2, 3], 0.5)).toBe(2);
        expect(nearestRank([1, 2, 3, 4], 0.5)).toBe(2);
        expect(nearestRank([], 0.5)).toBeNull();
    });
    it('summarises any order, counts every value, and reports nothing for none', () => {
        expect(summarise([3, 1, 2])).toEqual({ count: 3, p50: 2, p85: 3, p95: 3 });
        expect(summarise([])).toEqual({ count: 0, p50: null, p85: null, p95: null });
    });
    it('is always a value that happened, and p50 ≤ p85 ≤ p95', () => {
        fc.assert(
            fc.property(fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 200 }), (xs) => {
                const s = summarise(xs);
                expect(xs).toContain(s.p50);
                expect(xs).toContain(s.p95);
                expect(s.p50!).toBeLessThanOrEqual(s.p85!);
                expect(s.p85!).toBeLessThanOrEqual(s.p95!);
            }),
        );
    });
});

describe('elapsedWorkingDays', () => {
    it('keeps a same-afternoon span short', () => {
        expect(elapsedWorkingDays(new Date('2026-11-04T13:00:00Z'), new Date('2026-11-04T17:48:00Z'), monFri())).toBe(0.2);
    });
    it('removes a whole weekend: Friday 16:00 to Monday 10:00 is 0.75 days (0.8 to one decimal)', () => {
        expect(elapsedWorkingDays(new Date('2026-11-06T16:00:00Z'), new Date('2026-11-09T10:00:00Z'), monFri())).toBe(0.8); // 0.75 days, to one decimal
        // 18 hours exactly, before rounding to one decimal.
        expect(new WorkingTimeMeter(monFri()).elapsedMs(new Date('2026-11-06T16:00:00Z'), new Date('2026-11-09T10:00:00Z'))).toBe(18 * 3_600_000);
    });
    it('removes a holiday, and never a day only partly inside the span', () => {
        const cal = monFri('UTC', ['2026-11-04']);
        expect(new WorkingTimeMeter(cal).elapsedMs(new Date('2026-11-03T12:00:00Z'), new Date('2026-11-05T12:00:00Z'))).toBe(24 * 3_600_000);
        // Saturday 10:00 to Saturday 14:00: Saturday is not whole inside the span.
        expect(new WorkingTimeMeter(cal).elapsedMs(new Date('2026-11-07T10:00:00Z'), new Date('2026-11-07T14:00:00Z'))).toBe(4 * 3_600_000);
        // From Saturday's very start: the whole Saturday is removed.
        expect(new WorkingTimeMeter(cal).elapsedMs(new Date('2026-11-07T00:00:00Z'), new Date('2026-11-08T06:00:00Z'))).toBe(6 * 3_600_000);
    });
    it("removes a non-working day's own length across an offset change (Europe/London, 29 March 2026 is 23 hours)", () => {
        // Friday 16:00 GMT to Monday 10:00 BST: 65 hours elapsed, Saturday 24 and Sunday 23 removed.
        const ms = new WorkingTimeMeter(monFri('Europe/London')).elapsedMs(new Date('2026-03-27T16:00:00Z'), new Date('2026-03-30T09:00:00Z'));
        expect(ms).toBe(18 * 3_600_000);
    });
    it('is zero for an empty or backwards span', () => {
        const t = new Date('2026-11-04T13:00:00Z');
        expect(elapsedWorkingDays(t, t, monFri())).toBe(0);
        expect(elapsedWorkingDays(t, new Date('2026-11-01T00:00:00Z'), monFri())).toBe(0);
    });
    it('equals the elapsed time less a brute-force sum of the whole non-working days inside it, in any zone', () => {
        const zones = ['UTC', 'Europe/Sofia', 'America/New_York', 'Asia/Tokyo', 'Australia/Lord_Howe'];
        const base = Date.UTC(2026, 0, 1);
        fc.assert(
            fc.property(
                fc.constantFrom(...zones),
                fc.integer({ min: 0, max: 400 * 86_400_000 }),
                fc.integer({ min: 0, max: 60 * 86_400_000 }),
                fc.array(fc.integer({ min: 0, max: 460 }), { maxLength: 20 }),
                (tz, offset, length, holidayOffsets) => {
                    const cal: DurationCalendar = {
                        timeZone: tz,
                        compiled: compileCalendar({ id: 'c', workingWeekdays: [1, 2, 3, 4, 5], holidays: holidayOffsets.map((h) => toEpochDay(new Date(base)) + h) }),
                    };
                    const s = new Date(base + offset);
                    const e = new Date(base + offset + length);
                    const starts = new DayStarts(tz);
                    let removed = 0;
                    for (let d = epochDayOf(s, tz); d <= epochDayOf(e, tz); d++) {
                        if (starts.at(d) >= s.getTime() && starts.at(d + 1) <= e.getTime() && !isWorkingDay(cal.compiled, d)) removed += starts.at(d + 1) - starts.at(d);
                    }
                    const ms = new WorkingTimeMeter(cal).elapsedMs(s, e);
                    expect(ms).toBe(e.getTime() - s.getTime() - removed);
                    expect(ms).toBeGreaterThanOrEqual(0);
                    expect(ms).toBeLessThanOrEqual(e.getTime() - s.getTime());
                },
            ),
            { numRuns: 300 },
        );
    });
    it('gives the same answer from a meter reused across many spans as from a fresh one', () => {
        const cal = monFri('Europe/Sofia', ['2026-12-24', '2026-12-25']);
        const meter = new WorkingTimeMeter(cal);
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 300 * 86_400_000 }), fc.integer({ min: 0, max: 90 * 86_400_000 }), (offset, length) => {
                const s = new Date(Date.UTC(2026, 3, 1) + offset);
                const e = new Date(s.getTime() + length);
                expect(meter.elapsedMs(s, e)).toBe(new WorkingTimeMeter(cal).elapsedMs(s, e));
            }),
            { numRuns: 200 },
        );
    });
});

describe('completion as of a moment (decision 311)', () => {
    const R = (at: string) => new Date(at).getTime();
    it('counts once, at the last entry into Done; a reopen moves it', () => {
        const rows = [f('a', '2026-11-01T09:00:00Z', 'UNSTARTED'), f('a', '2026-11-02T09:00:00Z', 'DONE'), f('a', '2026-11-03T09:00:00Z', 'STARTED'), f('a', '2026-11-05T09:00:00Z', 'DONE')];
        expect(completionAsOf(rows, R('2026-11-02T12:00:00Z'))?.row.at.toISOString()).toBe('2026-11-02T09:00:00.000Z');
        expect(completionAsOf(rows, R('2026-11-04T12:00:00Z'))).toBeNull();
        expect(completionAsOf(rows, R('2026-11-06T12:00:00Z'))?.row.at.toISOString()).toBe('2026-11-05T09:00:00.000Z');
    });
    it('is retracted by a deletion, returned by a restore, and never for a cancelled or purged item', () => {
        const done = [f('b', '2026-11-01T09:00:00Z', 'STARTED'), f('b', '2026-11-02T09:00:00Z', 'DONE')];
        const deleted = [...done, f('b', '2026-11-03T09:00:00Z', 'DONE', { deleted: true })];
        expect(completionAsOf(deleted, R('2026-11-04T00:00:00Z'))).toBeNull();
        const restored = [...deleted, f('b', '2026-11-04T09:00:00Z', 'DONE')];
        expect(completionAsOf(restored, R('2026-11-05T00:00:00Z'))?.row.at.toISOString()).toBe('2026-11-02T09:00:00.000Z');
        expect(completionAsOf([f('c', '2026-11-01T09:00:00Z', 'CANCELLED')], R('2026-11-05T00:00:00Z'))).toBeNull();
    });
    it('counts an insert straight into Done at creation, and a move of a Done item is no new completion', () => {
        const rows = [f('d', '2026-11-01T09:00:00Z', 'DONE'), f('d', '2026-11-03T09:00:00Z', 'DONE', { projectId: 'p2' })];
        expect(completionAsOf(rows, R('2026-11-05T00:00:00Z'))?.row.projectId).toBe('p1');
    });
    it('never reads a row after the moment of reading', () => {
        const state = fc.constantFrom<WorkflowStateCategory>('BACKLOG', 'UNSTARTED', 'STARTED', 'DONE', 'CANCELLED');
        fc.assert(
            fc.property(
                fc.array(fc.record({ day: fc.integer({ min: 0, max: 30 }), state, deleted: fc.boolean() }), { minLength: 1, maxLength: 15 }),
                fc.integer({ min: 0, max: 31 }),
                (raw, cut) => {
                    const rows = byItem(raw.map((r) => f('x', new Date(Date.UTC(2026, 10, 1 + r.day, 9)).toISOString(), r.state, { deleted: r.deleted }))).get('x')!;
                    const asOf = Date.UTC(2026, 10, 1 + cut, 12);
                    const past = rows.filter((r) => r.at.getTime() <= asOf);
                    const later = [...rows, f('x', new Date(asOf + 3_600_000).toISOString(), 'STARTED')];
                    expect(completionAsOf(later, asOf)).toEqual(past.length ? completionAsOf(past, asOf) : null);
                    // At most one completion per item, and only when the picture is live and Done.
                    const c = completionAsOf(rows, asOf);
                    if (c) {
                        const pic = pictureAt(rows, asOf)!;
                        expect(pic.stateCategory).toBe('DONE');
                        expect(pic.deleted).toBe(false);
                    }
                },
            ),
        );
    });
    it('reads every item once', () => {
        const items = byItem([f('a', '2026-11-01T09:00:00Z', 'DONE'), f('b', '2026-11-01T09:00:00Z', 'STARTED'), f('c', '2026-11-01T09:00:00Z', 'DONE')]);
        expect(completionsAsOf(items, R('2026-11-02T00:00:00Z')).map((c) => c.workItemId).sort()).toEqual(['a', 'c']);
    });
});

describe('cycle time, lead time and age (decision 312)', () => {
    const R = (at: string) => new Date(at).getTime();
    it('measures cycle time from the first start and lead time from creation', () => {
        const rows = [
            f('a', '2026-11-02T09:00:00Z', 'BACKLOG'),
            f('a', '2026-11-03T09:00:00Z', 'STARTED'),
            f('a', '2026-11-04T09:00:00Z', 'UNSTARTED'),
            f('a', '2026-11-05T09:00:00Z', 'STARTED'),
            f('a', '2026-11-05T15:00:00Z', 'DONE'),
        ];
        const c = completionInstantsAsOf(rows, R('2026-11-06T00:00:00Z'))!;
        expect(c.startedAt?.toISOString()).toBe('2026-11-03T09:00:00.000Z');
        expect(c.createdAt.toISOString()).toBe('2026-11-02T09:00:00.000Z');
        expect(elapsedWorkingDays(c.startedAt!, c.completedAt, monFri())).toBe(2.3);
        expect(elapsedWorkingDays(c.createdAt, c.completedAt, monFri())).toBe(3.3);
    });
    it('gives no cycle time to an item done without starting', () => {
        const c = completionInstantsAsOf([f('b', '2026-11-02T09:00:00Z', 'UNSTARTED'), f('b', '2026-11-03T09:00:00Z', 'DONE')], R('2026-11-04T00:00:00Z'))!;
        expect(c.startedAt).toBeNull();
    });
    it('ages an open, started item from its first start; not a done, deleted or unstarted one', () => {
        const rows = [f('c', '2026-11-02T09:00:00Z', 'STARTED'), f('c', '2026-11-03T09:00:00Z', 'UNSTARTED'), f('c', '2026-11-04T09:00:00Z', 'STARTED')];
        expect(ageStartAsOf(rows, R('2026-11-05T00:00:00Z'))?.startedAt.toISOString()).toBe('2026-11-02T09:00:00.000Z');
        expect(ageStartAsOf(rows, R('2026-11-03T12:00:00Z'))).toBeNull();
        expect(ageStartAsOf([...rows, f('c', '2026-11-04T10:00:00Z', 'STARTED', { deleted: true })], R('2026-11-05T00:00:00Z'))).toBeNull();
    });
});
