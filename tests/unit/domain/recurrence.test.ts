/**
 * The repeat's date stepping (sub-phase 2.5d, owner decisions 67 and 68):
 * property tests over every frequency, interval, weekday set and first date,
 * and the named cases (month ends, leap years, ends, the catch-up).
 */
import fc from 'fast-check';

import { addDays, dayKey, fromDayKey } from '@/app-layer/domain/cycle';
import {
    addMonthsClamped,
    firstOccurrenceAfter,
    nextOccurrenceFrom,
    numberOf,
    occurrenceOn,
    planDue,
    withinEnd,
    type RecurrenceRule,
} from '@/app-layer/domain/recurrence';

const day = fc.integer({ min: 0, max: 365 * 30 }).map((n) => addDays(fromDayKey('2000-01-01'), n));
const rule = fc
    .record({
        frequency: fc.constantFrom('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY') as fc.Arbitrary<RecurrenceRule['frequency']>,
        interval: fc.integer({ min: 1, max: 99 }),
        weekdays: fc.uniqueArray(fc.integer({ min: 0, max: 6 }), { maxLength: 7 }),
        firstOn: day,
    })
    .map((r) => ({ ...r, weekdays: r.frequency === 'WEEKLY' ? r.weekdays : [], endsOn: null, maxOccurrences: null }) as RecurrenceRule);

const r = (over: Partial<RecurrenceRule>): RecurrenceRule => ({
    frequency: 'DAILY',
    interval: 1,
    weekdays: [],
    firstOn: fromDayKey('2026-01-31'),
    endsOn: null,
    maxOccurrences: null,
    ...over,
});
const keys = (rr: RecurrenceRule, n: number) => Array.from({ length: n }, (_, i) => dayKey(occurrenceOn(rr, i + 1)));

describe('the occurrences of a rule (properties)', () => {
    it('start at firstOn and strictly increase', () => {
        fc.assert(
            fc.property(rule, (rr) => {
                expect(occurrenceOn(rr, 1)).toEqual(rr.firstOn);
                for (let n = 1; n < 30; n++) expect(occurrenceOn(rr, n + 1).getTime()).toBeGreaterThan(occurrenceOn(rr, n).getTime());
            }),
        );
    });

    it('firstOccurrenceAfter agrees with the numbered list, for any day', () => {
        fc.assert(
            fc.property(rule, fc.integer({ min: 0, max: 2000 }), (rr, offset) => {
                const d = addDays(rr.firstOn, offset);
                const next = firstOccurrenceAfter(rr, d);
                expect(next.on.getTime()).toBeGreaterThan(d.getTime());
                expect(occurrenceOn(rr, next.number)).toEqual(next.on);
                // Nothing in between: the one before is on or before d.
                expect(occurrenceOn(rr, next.number - 1).getTime()).toBeLessThanOrEqual(d.getTime());
                expect(numberOf(rr, next.on)).toBe(next.number);
            }),
        );
    });

    it('steps by the interval: days and weeks exactly, months and years on the clamped day of firstOn', () => {
        fc.assert(
            fc.property(rule, fc.integer({ min: 2, max: 40 }), (rr, n) => {
                const on = occurrenceOn(rr, n);
                if (rr.frequency === 'DAILY') expect((on.getTime() - rr.firstOn.getTime()) / 86_400_000).toBe((n - 1) * rr.interval);
                if (rr.frequency === 'MONTHLY' || rr.frequency === 'YEARLY') {
                    const months = (on.getUTCFullYear() - rr.firstOn.getUTCFullYear()) * 12 + on.getUTCMonth() - rr.firstOn.getUTCMonth();
                    expect(months).toBe((n - 1) * rr.interval * (rr.frequency === 'YEARLY' ? 12 : 1));
                    const last = new Date(Date.UTC(on.getUTCFullYear(), on.getUTCMonth() + 1, 0)).getUTCDate();
                    expect(on.getUTCDate()).toBe(Math.min(rr.firstOn.getUTCDate(), last));
                }
                if (rr.frequency === 'WEEKLY') {
                    const chosen = rr.weekdays.length ? rr.weekdays : [rr.firstOn.getUTCDay()];
                    expect(chosen).toContain(on.getUTCDay());
                    const monday = (d: Date) => addDays(d, -((d.getUTCDay() + 6) % 7)).getTime();
                    const weeks = Math.round((monday(on) - monday(rr.firstOn)) / (7 * 86_400_000));
                    expect(weeks % rr.interval).toBe(0);
                }
            }),
        );
    });

    it('is deterministic', () => {
        fc.assert(fc.property(rule, fc.integer({ min: 1, max: 50 }), (rr, n) => expect(occurrenceOn(rr, n)).toEqual(occurrenceOn({ ...rr }, n))));
    });
});

describe('named cases', () => {
    it('a monthly series on the 31st clamps to short months and comes back to the 31st', () => {
        expect(keys(r({ frequency: 'MONTHLY' }), 4)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
        expect(keys(r({ frequency: 'MONTHLY', firstOn: fromDayKey('2028-01-31') }), 2)).toEqual(['2028-01-31', '2028-02-29']);
    });

    it('a yearly series on 29 February lands on the 28th in common years and the 29th in leap years', () => {
        expect(keys(r({ frequency: 'YEARLY', firstOn: fromDayKey('2028-02-29') }), 5)).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
    });

    it('weekly on chosen weekdays, every two weeks, from a mid-week first date', () => {
        // 2026-11-18 is a Wednesday; Monday (1) and Friday (5), every second week.
        expect(keys(r({ frequency: 'WEEKLY', interval: 2, weekdays: [1, 5], firstOn: fromDayKey('2026-11-18') }), 5)).toEqual([
            '2026-11-18',
            '2026-11-20',
            '2026-11-30',
            '2026-12-04',
            '2026-12-14',
        ]);
    });

    it('an end date or a number of times ends the series', () => {
        const byDate = r({ endsOn: fromDayKey('2026-02-02') });
        expect(withinEnd(byDate, firstOccurrenceAfter(byDate, fromDayKey('2026-02-01')))).toBe(true);
        expect(withinEnd(byDate, firstOccurrenceAfter(byDate, fromDayKey('2026-02-02')))).toBe(false);
        const byCount = r({ maxOccurrences: 3 });
        expect(withinEnd(byCount, { on: occurrenceOn(byCount, 3), number: 3 })).toBe(true);
        expect(withinEnd(byCount, { on: occurrenceOn(byCount, 4), number: 4 })).toBe(false);
    });

    it('a rule set today waits for the first date after firstOn that is not before today', () => {
        const rr = r({ frequency: 'WEEKLY', firstOn: fromDayKey('2026-11-02') });
        expect(dayKey(nextOccurrenceFrom(rr, fromDayKey('2026-11-01'))!.on)).toBe('2026-11-09');
        expect(dayKey(nextOccurrenceFrom(rr, fromDayKey('2026-11-16'))!.on)).toBe('2026-11-16');
        expect(nextOccurrenceFrom(r({ maxOccurrences: 2 }), fromDayKey('2026-03-01'))).toBeNull();
        // With lead days, it starts where the make day is today or later.
        expect(dayKey(nextOccurrenceFrom(r({ firstOn: fromDayKey('2026-11-01') }), fromDayKey('2026-11-05'), 3)!.on)).toBe('2026-11-08');
    });

    it('a repeat set today, run nightly, makes one occurrence a night with nothing skipped (steady state)', () => {
        fc.assert(
            fc.property(rule, fc.integer({ min: 0, max: 30 }), fc.integer({ min: 0, max: 400 }), (rr, lead, offset) => {
                let today = addDays(rr.firstOn, offset);
                let next = nextOccurrenceFrom(rr, today, lead)!;
                for (let night = 0; night < 60; night++) {
                    const p = planDue(rr, next, today, lead);
                    if (p) {
                        expect(p.skipped).toBe(0);
                        expect(p.make).toEqual(next);
                        next = p.following!;
                    }
                    today = addDays(today, 1);
                }
            }),
        );
    });
});

describe('planDue (the job)', () => {
    const daily = r({ firstOn: fromDayKey('2026-11-01') });
    const next = (on: string) => ({ on: fromDayKey(on), number: numberOf(daily, fromDayKey(on))! });

    it('makes nothing before the lead window opens, and the occurrence once it does', () => {
        expect(planDue(daily, next('2026-11-10'), fromDayKey('2026-11-06'), 3)).toBeNull();
        const p = planDue(daily, next('2026-11-10'), fromDayKey('2026-11-07'), 3)!;
        expect(dayKey(p.make.on)).toBe('2026-11-10');
        expect(p.skipped).toBe(0);
        expect(dayKey(p.following!.on)).toBe('2026-11-11');
    });

    it('after an outage makes only the latest missed occurrence and counts the rest', () => {
        const p = planDue(daily, next('2026-11-10'), fromDayKey('2026-11-20'), 0)!;
        expect(dayKey(p.make.on)).toBe('2026-11-20');
        expect(p.skipped).toBe(10);
    });

    it('never makes past the end, and says when the series ends', () => {
        const ending = { ...daily, maxOccurrences: 12 };
        const p = planDue(ending, next('2026-11-10'), fromDayKey('2026-11-30'), 0)!;
        expect(dayKey(p.make.on)).toBe('2026-11-12');
        expect(p.following).toBeNull();
    });

    it('for any rule, the made occurrence is due within the window and the following one is not', () => {
        fc.assert(
            fc.property(rule, fc.integer({ min: 0, max: 400 }), fc.integer({ min: 0, max: 30 }), (rr, ahead, lead) => {
                const first = firstOccurrenceAfter(rr, rr.firstOn);
                const today = addDays(first.on, ahead - lead);
                const p = planDue(rr, first, today, lead);
                if (!p) return;
                const horizon = addDays(today, lead).getTime();
                expect(p.make.on.getTime()).toBeLessThanOrEqual(horizon);
                expect(p.make.number).toBe(first.number + p.skipped);
                expect(occurrenceOn(rr, p.make.number + 1).getTime()).toBeGreaterThan(horizon);
            }),
        );
    });

    it('addMonthsClamped never overflows a month', () => {
        fc.assert(fc.property(day, fc.integer({ min: 0, max: 600 }), (d, m) => expect(addMonthsClamped(d, m).getUTCDate()).toBeLessThanOrEqual(d.getUTCDate())));
    });
});
