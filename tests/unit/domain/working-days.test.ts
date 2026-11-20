/**
 * Working days (sub-phase 2.8a; owner decision 151): Monday to Friday, no
 * holidays, date-only. Fixed cases across week, month and year ends, then
 * properties over random dates and counts.
 */
import fc from 'fast-check';

import { addWorkingDays, isWorkingDay, nextWorkingDay, WORKING_WEEKDAYS } from '@/app-layer/domain/working-days';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const ymd = (x: Date) => x.toISOString().slice(0, 10);
const MS = 86_400_000;

describe('addWorkingDays', () => {
    it.each([
        ['2026-11-20', 1, '2026-11-23'], // Friday → Monday
        ['2026-11-21', 1, '2026-11-23'], // Saturday → Monday
        ['2026-11-22', 1, '2026-11-23'], // Sunday → Monday
        ['2026-11-23', 1, '2026-11-24'], // Monday → Tuesday
        ['2026-11-23', 5, '2026-11-30'], // a full week ahead
        ['2026-11-20', 5, '2026-11-27'], // Friday + 5 → next Friday
        ['2026-12-31', 1, '2027-01-01'], // year end, Thursday → Friday
        ['2027-01-01', 1, '2027-01-04'], // Friday → Monday, across nothing else
        ['2026-02-27', 1, '2026-03-02'], // Friday at a month end → Monday
        ['2028-02-28', 1, '2028-02-29'], // leap day is a working day (Tuesday)
        ['2026-11-20', 60, '2027-02-12'],
    ])('%s + %i working day(s) is %s', (start, n, want) => {
        expect(ymd(addWorkingDays(d(start), n))).toBe(want);
    });

    it('refuses zero, a negative and a fraction', () => {
        expect(() => addWorkingDays(d('2026-11-20'), 0)).toThrow(RangeError);
        expect(() => addWorkingDays(d('2026-11-20'), -1)).toThrow(RangeError);
        expect(() => addWorkingDays(d('2026-11-20'), 1.5)).toThrow(RangeError);
    });

    it('reads only the date: a time of day in the input never moves the result', () => {
        expect(ymd(addWorkingDays(new Date('2026-11-20T23:59:00Z'), 1))).toBe('2026-11-23');
    });

    it('is Monday to Friday', () => {
        expect([...WORKING_WEEKDAYS].sort()).toEqual([1, 2, 3, 4, 5]);
        expect(isWorkingDay(d('2026-11-21'))).toBe(false);
        expect(ymd(nextWorkingDay(d('2026-11-20')))).toBe('2026-11-23');
    });

    const dates = fc.integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2100, 0, 1) }).map((ms) => new Date(Math.floor(ms / MS) * MS));
    const counts = fc.integer({ min: 1, max: 60 });

    it('never lands on a non-working day, and lands after the start', () => {
        fc.assert(
            fc.property(dates, counts, (start, n) => {
                const out = addWorkingDays(start, n);
                return isWorkingDay(out) && out.getTime() > start.getTime();
            }),
        );
    });

    it('counts exactly n working days after the start', () => {
        fc.assert(
            fc.property(dates, counts, (start, n) => {
                const out = addWorkingDays(start, n);
                let count = 0;
                for (let t = start.getTime() + MS; t <= out.getTime(); t += MS) if (isWorkingDay(new Date(t))) count += 1;
                return count === n;
            }),
        );
    });

    it('is strictly monotone in n, and n working days span at most n + 2·⌈n/5⌉ + 2 calendar days', () => {
        fc.assert(
            fc.property(dates, fc.integer({ min: 1, max: 59 }), (start, n) => {
                const a = addWorkingDays(start, n).getTime();
                const b = addWorkingDays(start, n + 1).getTime();
                const span = (a - start.getTime()) / MS;
                return b > a && span <= n + 2 * Math.ceil(n / 5) + 2;
            }),
        );
    });

    it('five working days from a working day is the same weekday a week later', () => {
        fc.assert(
            fc.property(dates.filter(isWorkingDay), (start) => addWorkingDays(start, 5).getTime() - start.getTime() === 7 * MS),
        );
    });
});
