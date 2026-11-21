/**
 * Working-day arithmetic over epoch days (roadmap 3.1; ADR 0010 §5; H3:
 * "calendars correct across time zones and daylight-saving changes"). Fixed
 * cases first, then properties against a day-by-day reference.
 */
import fc from 'fast-check';

import {
    addWorkingDays,
    compileCalendar,
    copyHolidaysToYear,
    defaultCalendar,
    fromEpochDay,
    isKnownTimeZone,
    isoWeekday,
    isWorkingDay,
    nextWorkingDay,
    previousWorkingDay,
    subtractWorkingDays,
    toEpochDay,
    todayIn,
    workingDayDiff,
    workingDaysAfter,
    workingDaysInclusive,
    type IsoWeekday,
} from '@/app-layer/domain/schedule/calendar';

const day = toEpochDay;
const ymd = fromEpochDay;

describe('epoch days', () => {
    it('round-trips dates and knows 1970-01-01 was a Thursday', () => {
        expect(day('1970-01-01')).toBe(0);
        expect(isoWeekday(0)).toBe(4);
        expect(isoWeekday(day('2026-11-23'))).toBe(1);
        expect(isoWeekday(day('2026-11-22'))).toBe(7);
        expect(isoWeekday(day('1969-12-29'))).toBe(1);
        expect(ymd(day('2028-02-29'))).toBe('2028-02-29');
        expect(day(new Date('2026-11-20T23:59:59.999Z'))).toBe(day('2026-11-20'));
    });

    it('refuses what is not a date', () => {
        expect(() => day('2026-02-30')).toThrow(RangeError);
        expect(() => day('20261120')).toThrow(RangeError);
    });

    it('round-trips every day across two centuries', () => {
        fc.assert(fc.property(fc.integer({ min: -36_500, max: 73_000 }), (n) => day(ymd(n)) === n));
    });
});

describe('the default calendar (Monday to Friday)', () => {
    const c = defaultCalendar();
    it.each([
        ['2026-11-20', 0, '2026-11-20'], // a Friday is itself
        ['2026-11-21', 0, '2026-11-23'], // Saturday → Monday
        ['2026-11-20', 1, '2026-11-23'],
        ['2026-11-23', 4, '2026-11-27'],
        ['2026-11-23', 5, '2026-11-30'],
        ['2026-11-20', 60, '2027-02-12'],
    ])('addWorkingDays(%s, %i) is %s', (from, n, want) => {
        expect(ymd(addWorkingDays(c, day(from), n))).toBe(want);
    });

    it('counts, steps back and measures', () => {
        expect(workingDaysInclusive(c, day('2026-11-23'), day('2026-11-29'))).toBe(5);
        expect(workingDaysInclusive(c, day('2026-11-29'), day('2026-11-23'))).toBe(0);
        expect(ymd(previousWorkingDay(c, day('2026-11-22')))).toBe('2026-11-20');
        expect(ymd(subtractWorkingDays(c, day('2026-11-23'), 1))).toBe('2026-11-20');
        expect(workingDayDiff(c, day('2026-11-20'), day('2026-11-23'))).toBe(1);
        expect(workingDayDiff(c, day('2026-11-23'), day('2026-11-20'))).toBe(-1);
        expect(ymd(workingDaysAfter(c, day('2026-11-20'), 1))).toBe('2026-11-23');
        expect(ymd(workingDaysAfter(c, day('2026-11-21'), 1))).toBe('2026-11-23');
    });
});

describe('holidays', () => {
    const c = compileCalendar({ id: 'bg', workingWeekdays: [1, 2, 3, 4, 5], holidays: [day('2026-12-24'), day('2026-12-25'), day('2026-12-26'), day('2026-12-31')] });
    it('are skipped by every step', () => {
        expect(isWorkingDay(c, day('2026-12-24'))).toBe(false);
        expect(ymd(nextWorkingDay(c, day('2026-12-24')))).toBe('2026-12-28');
        expect(ymd(addWorkingDays(c, day('2026-12-23'), 1))).toBe('2026-12-28');
        expect(ymd(addWorkingDays(c, day('2026-12-22'), 5))).toBe('2027-01-01');
        expect(workingDaysInclusive(c, day('2026-12-21'), day('2027-01-01'))).toBe(7); // 26 December is a Saturday
        expect(ymd(subtractWorkingDays(c, day('2027-01-01'), 3))).toBe('2026-12-28');
    });

    it('on a weekend change nothing', () => {
        const a = compileCalendar({ id: 'a', workingWeekdays: [1, 2, 3, 4, 5], holidays: [day('2026-11-21')] });
        expect(a.holidays.length).toBe(0);
    });
});

describe('a Sunday-to-Thursday calendar', () => {
    const c = compileCalendar({ id: 'il', workingWeekdays: [7, 1, 2, 3, 4], holidays: [] });
    it('works Sunday and rests Friday and Saturday', () => {
        expect(isWorkingDay(c, day('2026-11-22'))).toBe(true);
        expect(isWorkingDay(c, day('2026-11-20'))).toBe(false);
        expect(ymd(addWorkingDays(c, day('2026-11-19'), 1))).toBe('2026-11-22');
    });
});

describe('refusals', () => {
    it('a calendar with no working weekday, a weekday out of range, a negative step', () => {
        expect(() => compileCalendar({ id: 'x', workingWeekdays: [], holidays: [] })).toThrow(RangeError);
        expect(() => compileCalendar({ id: 'x', workingWeekdays: [0 as IsoWeekday], holidays: [] })).toThrow(RangeError);
        expect(() => addWorkingDays(defaultCalendar(), 0, -1)).toThrow(RangeError);
        expect(() => workingDaysAfter(defaultCalendar(), 0, 0)).toThrow(RangeError);
    });
});

// ─── Properties against a day-by-day reference ──────────────────────────────

const weekdaySets = fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 7 }) as fc.Arbitrary<IsoWeekday[]>;
const days = fc.integer({ min: day('2020-01-01'), max: day('2031-12-31') });
const calendars = fc
    .tuple(weekdaySets, fc.uniqueArray(fc.integer({ min: day('2020-01-01'), max: day('2032-12-31') }), { maxLength: 60 }))
    .map(([w, h]) => compileCalendar({ id: 'c', workingWeekdays: w, holidays: h }));

/** The slow reference: one day at a time. */
function refAdd(c: ReturnType<typeof compileCalendar>, d: number, n: number): number {
    let x = d;
    while (!isWorkingDay(c, x)) x += 1;
    let left = n;
    while (left > 0) {
        x += 1;
        if (isWorkingDay(c, x)) left -= 1;
    }
    return x;
}
function refCount(c: ReturnType<typeof compileCalendar>, a: number, b: number): number {
    let n = 0;
    for (let x = a; x <= b; x += 1) if (isWorkingDay(c, x)) n += 1;
    return n;
}

describe('working-day arithmetic — properties', () => {
    it('addWorkingDays and subtractWorkingDays equal stepping one day at a time', () => {
        fc.assert(
            fc.property(calendars, days, fc.integer({ min: 0, max: 400 }), (c, d, n) => {
                const fwd = addWorkingDays(c, d, n);
                if (fwd !== refAdd(c, d, n)) return false;
                const back = subtractWorkingDays(c, fwd, n);
                return back === nextWorkingDay(c, d);
            }),
            { numRuns: 400 },
        );
    });

    it('workingDaysInclusive equals counting one day at a time', () => {
        fc.assert(fc.property(calendars, days, fc.integer({ min: -10, max: 800 }), (c, a, span) => workingDaysInclusive(c, a, a + span) === refCount(c, a, a + span)), {
            numRuns: 400,
        });
    });

    it('never lands on a non-working day; strictly increasing in n; n working days are counted', () => {
        fc.assert(
            fc.property(calendars, days, fc.integer({ min: 1, max: 300 }), (c, d, n) => {
                const a = addWorkingDays(c, d, n - 1);
                const b = addWorkingDays(c, d, n);
                const start = nextWorkingDay(c, d);
                return isWorkingDay(c, a) && isWorkingDay(c, b) && b > a && workingDaysInclusive(c, start, a) === n && workingDayDiff(c, a, b) === 1;
            }),
            { numRuns: 400 },
        );
    });

    it('a calendar of seven working days and no holidays is plain day arithmetic', () => {
        const c = compileCalendar({ id: 'all', workingWeekdays: [1, 2, 3, 4, 5, 6, 7], holidays: [] });
        fc.assert(fc.property(days, fc.integer({ min: 0, max: 1000 }), (d, n) => addWorkingDays(c, d, n) === d + n && workingDaysInclusive(c, d, d + n) === n + 1));
    });
});

// ─── "Today" in a time zone ──────────────────────────────────────────────────

describe('todayIn', () => {
    it('knows the date line and a skipped day (Pacific/Apia skipped 30 December 2011)', () => {
        expect(ymd(todayIn('Pacific/Apia', new Date('2011-12-30T09:59:59Z')))).toBe('2011-12-29');
        expect(ymd(todayIn('Pacific/Apia', new Date('2011-12-30T10:00:00Z')))).toBe('2011-12-31');
        expect(ymd(todayIn('Pacific/Kiritimati', new Date('2026-11-20T10:00:00Z')))).toBe('2026-11-21');
        expect(ymd(todayIn('Pacific/Pago_Pago', new Date('2026-11-20T10:00:00Z')))).toBe('2026-11-19');
    });

    it('crosses a midnight daylight-saving change (America/Sao_Paulo, 4 November 2018)', () => {
        expect(ymd(todayIn('America/Sao_Paulo', new Date('2018-11-04T02:59:59Z')))).toBe('2018-11-03');
        expect(ymd(todayIn('America/Sao_Paulo', new Date('2018-11-04T03:00:00Z')))).toBe('2018-11-04');
    });

    const zones = ['Europe/London', 'America/Sao_Paulo', 'Australia/Lord_Howe', 'Pacific/Apia', 'UTC', 'Europe/Sofia'];

    /** The instants (ms) in [from, to) where the zone's UTC offset changes, found hourly then by bisection. */
    function transitions(zone: string, from: number, to: number): number[] {
        const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
        const offset = (t: number) => f.formatToParts(new Date(t)).find((p) => p.type === 'timeZoneName')?.value ?? '';
        const out: number[] = [];
        // Offsets change at most a few times a year: a six-hour step finds each.
        const step = 6 * 3_600_000;
        let prev = offset(from);
        for (let t = from + step; t < to; t += step) {
            const cur = offset(t);
            if (cur !== prev) {
                let lo = t - step;
                let hi = t;
                while (hi - lo > 1000) {
                    const mid = lo + Math.floor((hi - lo) / 2000) * 1000;
                    if (offset(mid) === prev) lo = mid;
                    else hi = mid;
                }
                out.push(hi);
                prev = cur;
            }
        }
        return out;
    }

    it.each(zones)('agrees with the wall clock one second either side of every offset change in %s, 2020 to 2030', (zone) => {
        const ts = transitions(zone, Date.UTC(2020, 0, 1), Date.UTC(2030, 11, 31));
        if (zone === 'UTC') expect(ts).toEqual([]);
        if (zone === 'Europe/London' || zone === 'Australia/Lord_Howe') expect(ts.length).toBeGreaterThanOrEqual(20);
        for (const t of ts) {
            for (const at of [t - 1000, t, t + 1000]) {
                // An independent reading of the wall clock: the date part of the locale string.
                const wall = new Date(at).toLocaleString('sv-SE', { timeZone: zone }).slice(0, 10);
                expect(ymd(todayIn(zone, at))).toBe(wall);
            }
        }
    });

    it('knows a zone, refuses a made-up one', () => {
        expect(isKnownTimeZone('Europe/Sofia')).toBe(true);
        expect(isKnownTimeZone('UTC')).toBe(true);
        expect(isKnownTimeZone('Mars/Olympus_Mons')).toBe(false);
        expect(isKnownTimeZone('')).toBe(false);
    });
});

describe('copyHolidaysToYear (Copy last year\'s)', () => {
    it('keeps names and days of the month, clamps 29 February, skips dates already there', () => {
        const out = copyHolidaysToYear(
            [
                { day: '2028-01-01', name: 'New Year' },
                { day: '2028-02-29', name: 'Leap' },
                { day: '2028-12-25', name: 'Christmas' },
                { day: '2027-05-01', name: 'Other year' },
            ],
            2028,
            2029,
            new Set(['2029-12-25']),
        );
        expect(out).toEqual([
            { day: '2029-01-01', name: 'New Year' },
            { day: '2029-02-28', name: 'Leap' },
        ]);
    });
});
