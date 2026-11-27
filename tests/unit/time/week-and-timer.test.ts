/**
 * The week and the timer's arithmetic (sub-phase 3.4b; owner decisions 263,
 * 264 and 268; `src/lib/time/week.ts`, `src/lib/time/entries.ts`).
 *
 *   - The week of a date is Monday to Sunday, date-only: byte-equal under
 *     five process time zones, and a property against a reference walk.
 *   - A timer counts the whole minutes since it started, rounded to the
 *     nearest, at least one, at most 720; under 30 seconds it counts nothing.
 */
import fc from 'fast-check';

import { TIME_LIMITS, isValidEntryMinutes, timerMinutes, timerStoppedCounting } from '@/lib/time/entries';
import { addDays, dateKeyOf, dateOnlyValue, isWeekStart, isoWeekday, weekDays, weekStartOf } from '@/lib/time/week';

const ZONES = ['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Europe/Sofia', 'America/St_Johns'];
const dateArb = fc.integer({ min: 0, max: 365 * 200 }).map((n) => new Date(Date.UTC(1950, 0, 1) + n * 86_400_000).toISOString().slice(0, 10));

describe('the week (decision 268)', () => {
    it('starts on Monday and holds seven dates', () => {
        expect(weekStartOf('2026-11-27')).toBe('2026-11-23');
        expect(weekStartOf('2026-11-23')).toBe('2026-11-23');
        expect(weekStartOf('2026-11-29')).toBe('2026-11-23');
        expect(weekStartOf('2027-01-01')).toBe('2026-12-28');
        expect(weekDays('2026-11-23')).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
        expect(isWeekStart('2026-11-23')).toBe(true);
        expect(isWeekStart('2026-11-24')).toBe(false);
        expect(isWeekStart('2026-02-30')).toBe(false);
        expect(isoWeekday('2026-11-29')).toBe(7);
    });

    it('is the same in every process time zone', () => {
        const saved = process.env.TZ;
        const samples = fc.sample(dateArb, 200);
        try {
            const answers = ZONES.map((zone) => {
                process.env.TZ = zone;
                return samples.map((d) => `${weekStartOf(d)}|${addDays(d, 9)}|${dateKeyOf(dateOnlyValue(d))}`).join(',');
            });
            for (const a of answers) expect(a).toBe(answers[0]);
        } finally {
            if (saved === undefined) delete process.env.TZ;
            else process.env.TZ = saved;
        }
    });

    it('equals a reference walk back to the previous Monday', () => {
        fc.assert(
            fc.property(dateArb, (d) => {
                let back = d;
                while (isoWeekday(back) !== 1) back = addDays(back, -1);
                return weekStartOf(d) === back && weekDays(back).includes(d) && dateKeyOf(dateOnlyValue(d)) === d;
            }),
        );
    });
});

describe('the timer (decisions 263 and 264)', () => {
    const at = new Date('2026-11-27T08:00:00Z');
    const after = (ms: number) => new Date(at.getTime() + ms);

    it('discards under 30 seconds and counts at least a minute after', () => {
        expect(timerMinutes(at, after(29_999))).toBe(0);
        expect(timerMinutes(at, after(30_000))).toBe(1);
        expect(timerMinutes(at, after(89_999))).toBe(1);
        expect(timerMinutes(at, after(90_000))).toBe(2);
        expect(timerMinutes(at, after(-60_000))).toBe(0);
    });

    it('stops counting at 12 hours', () => {
        expect(timerMinutes(at, after(12 * 3_600_000 - 1))).toBe(720);
        expect(timerMinutes(at, after(30 * 3_600_000))).toBe(720);
        expect(timerStoppedCounting(at, after(12 * 3_600_000 - 1))).toBe(false);
        expect(timerStoppedCounting(at, after(12 * 3_600_000))).toBe(true);
    });

    it('is the nearest whole minute within its bounds, monotone in time', () => {
        fc.assert(
            fc.property(fc.integer({ min: 30_000, max: 20 * 3_600_000 }), fc.integer({ min: 0, max: 600_000 }), (ms, more) => {
                const m = timerMinutes(at, after(ms));
                const expected = Math.min(TIME_LIMITS.timerCapMinutes, Math.max(1, Math.round(ms / 60_000)));
                return m === expected && isValidEntryMinutes(m) && timerMinutes(at, after(ms + more)) >= m;
            }),
        );
    });

    it('takes whole minutes from 1 to 1,440 as an entry', () => {
        expect(isValidEntryMinutes(1)).toBe(true);
        expect(isValidEntryMinutes(1_440)).toBe(true);
        expect(isValidEntryMinutes(0)).toBe(false);
        expect(isValidEntryMinutes(1_441)).toBe(false);
        expect(isValidEntryMinutes(1.5)).toBe(false);
    });
});
