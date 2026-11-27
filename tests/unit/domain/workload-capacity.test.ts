/**
 * A member's capacity in a week (sub-phase 3.5a; docs/porting/maps/3.5.md,
 * "Capacity in a week" and "H3 and 3.5": a week's capacity equals the day
 * shares' sum, never negative, never above the weekly hours; adding a
 * time-off date or a holiday never raises it; a whole-day row removes exactly
 * its day's share and a row on a non-working day removes nothing).
 */
import fc from 'fast-check';

import { compileCalendar, defaultCalendar, isWorkingDay, toEpochDay, type IsoWeekday } from '@/app-layer/domain/schedule/calendar';
import { capacityByWeek, mondayOf, rowInForce, weekCapacity, weekdayShares, type CapacityContext, type CapacityPerson } from '@/app-layer/domain/workload/capacity';

const day = toEpochDay;
const MON = day('2026-12-07');

function ctxOf(defaultWeeklyMinutes = 2400, cal = defaultCalendar(), teams: Record<string, ReturnType<typeof compileCalendar>> = {}): CapacityContext {
    return { defaultWeeklyMinutes, calendarFor: (t) => (t && teams[t]) || cal };
}

const person = (p: Partial<CapacityPerson> = {}): CapacityPerson => ({ active: true, rows: [], timeOff: [], ...p });

describe('day shares', () => {
    it('shares 40 hours as 480 minutes over Monday to Friday, and 37.5 as 450', () => {
        expect(weekdayShares(defaultCalendar(), 2400)).toEqual([480, 480, 480, 480, 480, 0, 0]);
        expect(weekdayShares(defaultCalendar(), 2250)).toEqual([450, 450, 450, 450, 450, 0, 0]);
    });

    it('gives the remainder one minute at a time to the earliest working weekdays', () => {
        expect(weekdayShares(defaultCalendar(), 2402)).toEqual([481, 481, 480, 480, 480, 0, 0]);
        const tueToSat = compileCalendar({ id: 'c', workingWeekdays: [2, 3, 4, 5, 6], holidays: [] });
        expect(weekdayShares(tueToSat, 7)).toEqual([0, 2, 2, 1, 1, 1, 0]);
    });

    it('always sums to the weekly minutes', () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 6000 }), fc.subarray([1, 2, 3, 4, 5, 6, 7] as IsoWeekday[], { minLength: 1 }), (w, days) => {
                const shares = weekdayShares(compileCalendar({ id: 'c', workingWeekdays: days, holidays: [] }), w);
                expect(shares.reduce((a, b) => a + b, 0)).toBe(w);
                expect(Math.max(...shares) - Math.min(...shares.filter((_, i) => days.includes((i + 1) as IsoWeekday)))).toBeLessThanOrEqual(1);
            }),
        );
    });
});

describe('the row in force', () => {
    const rows = [
        { effectiveFrom: day('2026-11-02'), weeklyMinutes: 1440, calendarTeamId: null },
        { effectiveFrom: day('2027-02-01'), weeklyMinutes: 1800, calendarTeamId: 't1' },
    ];

    it('is the latest row on or before the Monday, none before the first', () => {
        expect(rowInForce(rows, day('2026-10-26'))).toBeNull();
        expect(rowInForce(rows, day('2026-11-02'))?.weeklyMinutes).toBe(1440);
        expect(rowInForce(rows, day('2027-01-25'))?.weeklyMinutes).toBe(1440);
        expect(rowInForce(rows, day('2027-02-01'))?.weeklyMinutes).toBe(1800);
    });

    it('falls back to the workspace default on the workspace calendar', () => {
        const w = weekCapacity(person({ rows }), day('2026-10-26'), ctxOf(2000));
        expect(w).toMatchObject({ weeklyMinutes: 2000, capacityMinutes: 2000, calendarTeamId: null });
    });

    it("counts on the named team's calendar", () => {
        const fourDays = compileCalendar({ id: 't1', workingWeekdays: [1, 2, 3, 4], holidays: [] });
        const w = weekCapacity(person({ rows }), day('2027-02-01'), ctxOf(2400, defaultCalendar(), { t1: fourDays }));
        expect(w).toMatchObject({ weeklyMinutes: 1800, capacityMinutes: 1800, calendarTeamId: 't1' });
    });
});

describe('holidays, time off and deactivation', () => {
    it('loses a holiday\'s share rather than moving it', () => {
        const cal = compileCalendar({ id: 'w', workingWeekdays: [1, 2, 3, 4, 5], holidays: [MON + 2] });
        expect(weekCapacity(person(), MON, ctxOf(2400, cal)).capacityMinutes).toBe(1920);
    });

    it('removes a whole day, part of a day, and nothing on a weekend or a holiday', () => {
        const cal = compileCalendar({ id: 'w', workingWeekdays: [1, 2, 3, 4, 5], holidays: [MON + 3] });
        const w = weekCapacity(
            person({ timeOff: [{ day: MON, minutes: null }, { day: MON + 1, minutes: 240 }, { day: MON + 2, minutes: 900 }, { day: MON + 3, minutes: null }, { day: MON + 5, minutes: null }] }),
            MON,
            ctxOf(2400, cal),
        );
        // Mon whole (480), Tue 240, Wed capped at its share (480); Thu is a holiday, Sat no working day.
        expect(w.timeOffMinutes).toBe(1200);
        expect(w.capacityMinutes).toBe(2400 - 480 - 1200);
        expect(w.timeOffDays).toEqual([MON, MON + 1, MON + 2, MON + 3, MON + 5]);
    });

    it('gives a deactivated member nothing', () => {
        expect(weekCapacity(person({ active: false }), MON, ctxOf()).capacityMinutes).toBe(0);
    });

    it('reads weeks from their Mondays', () => {
        expect(mondayOf(day('2026-12-13'))).toBe(MON);
        expect(mondayOf(MON)).toBe(MON);
        const weeks = capacityByWeek(person({ timeOff: [{ day: MON + 7, minutes: null }] }), [MON, MON + 7], ctxOf());
        expect(weeks.map((w) => w.capacityMinutes)).toEqual([2400, 1920]);
    });
});

describe('properties', () => {
    const calendarArb = fc.record({
        days: fc.subarray([1, 2, 3, 4, 5, 6, 7] as IsoWeekday[], { minLength: 1 }),
        holidays: fc.uniqueArray(fc.integer({ min: 0, max: 6 }), { maxLength: 3 }),
    });
    const offArb = fc.uniqueArray(fc.record({ i: fc.integer({ min: 0, max: 6 }), minutes: fc.option(fc.integer({ min: 1, max: 1439 }), { nil: null }) }), {
        selector: (o) => o.i,
        maxLength: 7,
    });

    it('stays between zero and the weekly minutes, and time off or a holiday never raises it', () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 6000 }), calendarArb, offArb, fc.integer({ min: 0, max: 6 }), (w, c, off, extra) => {
                const cal = compileCalendar({ id: 'w', workingWeekdays: c.days, holidays: c.holidays.map((h) => MON + h) });
                const timeOff = off.map((o) => ({ day: MON + o.i, minutes: o.minutes }));
                const base = weekCapacity(person({ timeOff }), MON, ctxOf(w, cal));
                expect(base.capacityMinutes).toBeGreaterThanOrEqual(0);
                expect(base.capacityMinutes).toBeLessThanOrEqual(w);
                expect(base.capacityMinutes + base.timeOffMinutes).toBeLessThanOrEqual(w);

                const more = weekCapacity(person({ timeOff: [...timeOff.filter((t) => t.day !== MON + extra), { day: MON + extra, minutes: null }] }), MON, ctxOf(w, cal));
                expect(more.capacityMinutes).toBeLessThanOrEqual(base.capacityMinutes);

                const withHoliday = compileCalendar({ id: 'w', workingWeekdays: c.days, holidays: [...c.holidays, extra].map((h) => MON + h) });
                expect(weekCapacity(person({ timeOff }), MON, ctxOf(w, withHoliday)).capacityMinutes).toBeLessThanOrEqual(base.capacityMinutes);
            }),
        );
    });

    it("removes exactly the day's share for a whole day, and nothing on a non-working day", () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 6000 }), calendarArb, fc.integer({ min: 0, max: 6 }), (w, c, i) => {
                const cal = compileCalendar({ id: 'w', workingWeekdays: c.days, holidays: c.holidays.map((h) => MON + h) });
                const without = weekCapacity(person(), MON, ctxOf(w, cal));
                const withDay = weekCapacity(person({ timeOff: [{ day: MON + i, minutes: null }] }), MON, ctxOf(w, cal));
                const share = isWorkingDay(cal, MON + i) ? weekdayShares(cal, w)[i]! : 0;
                expect(without.capacityMinutes - withDay.capacityMinutes).toBe(share);
                expect(withDay.timeOffMinutes).toBe(share);
            }),
        );
    });
});
