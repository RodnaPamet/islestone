/**
 * The clock seam for "today" (Hardening H2g, owner decision 180;
 * `src/lib/clock.ts`). Off the E2E server the seam returns the real instant;
 * on it (`NEXT_TEST_MODE=1` with `E2E_TODAY`), an instant on that date in
 * every zone, so the date helpers built on it read one fixed day.
 */
import { todayIn, toEpochDay } from '@/app-layer/domain/schedule/calendar';
import { classifyDueWindow, dayKeyInTz, todayInTz } from '@/app-layer/notifications/work-item-due';
import { isCalendarDate } from '@/lib/calendar-date';
import { fixedTestToday, noonIn, todayClock } from '@/lib/clock';

const SAVED = { NEXT_TEST_MODE: process.env.NEXT_TEST_MODE, E2E_TODAY: process.env.E2E_TODAY };

function setEnv(values: Partial<Record<keyof typeof SAVED, string | undefined>>) {
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
}

afterEach(() => setEnv(SAVED));

const ZONES = [
    'UTC',
    'Europe/London',
    'Europe/Sofia',
    'America/Los_Angeles',
    'Pacific/Pago_Pago', // UTC-11
    'Etc/GMT+12', // UTC-12
    'Pacific/Kiritimati', // UTC+14
    'Pacific/Auckland',
    'Asia/Kolkata', // a half-hour offset
    'Australia/Lord_Howe', // a half-hour daylight-saving change
];

describe('todayClock', () => {
    it('returns the real instant when NEXT_TEST_MODE is not 1, whatever E2E_TODAY says', () => {
        const now = new Date('2026-11-26T23:30:00Z');
        setEnv({ NEXT_TEST_MODE: undefined, E2E_TODAY: '2026-01-15' });
        expect(fixedTestToday()).toBeNull();
        expect(todayClock('Europe/Sofia', now)).toBe(now);
        setEnv({ NEXT_TEST_MODE: '0' });
        expect(todayClock('UTC', now)).toBe(now);
    });

    it('returns the real instant on the E2E server when E2E_TODAY is unset or not a date', () => {
        const now = new Date('2026-11-26T08:00:00Z');
        setEnv({ NEXT_TEST_MODE: '1', E2E_TODAY: undefined });
        expect(todayClock('UTC', now)).toBe(now);
        setEnv({ E2E_TODAY: '2026-02-30' });
        expect(fixedTestToday()).toBeNull();
        expect(todayClock('UTC', now)).toBe(now);
    });

    it('fixes today in every zone on the E2E server, for every date helper', () => {
        setEnv({ NEXT_TEST_MODE: '1', E2E_TODAY: '2026-03-29' }); // Europe's daylight-saving change
        for (const zone of ZONES) {
            const instant = todayClock(zone, new Date('2031-07-04T12:00:00Z'));
            expect({ zone, day: dayKeyInTz(instant, zone) }).toEqual({ zone, day: '2026-03-29' });
            expect({ zone, day: todayInTz(instant, zone).toISOString() }).toEqual({ zone, day: '2026-03-29T00:00:00.000Z' });
            expect({ zone, day: todayIn(zone, instant) }).toEqual({ zone, day: toEpochDay(new Date('2026-03-29T00:00:00Z')) });
        }
    });

    it('classifies a due date against the fixed day', () => {
        setEnv({ NEXT_TEST_MODE: '1', E2E_TODAY: '2026-06-10' });
        const tz = 'Europe/London';
        expect(classifyDueWindow(new Date('2026-06-10T00:00:00Z'), todayClock(tz), tz)).toBe('today');
        expect(classifyDueWindow(new Date('2026-06-11T00:00:00Z'), todayClock(tz), tz)).toBe('day');
    });
});

describe('noonIn', () => {
    it('is noon on that date in the zone, across a year of daylight-saving changes', () => {
        for (const zone of ZONES) {
            for (let month = 1; month <= 12; month++) {
                for (const day of [1, 15, 28]) {
                    const ymd = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const instant = noonIn(ymd, zone);
                    const hour = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(instant);
                    expect({ zone, ymd, day: dayKeyInTz(instant, zone), hour }).toEqual({ zone, ymd, day: ymd, hour: '12' });
                }
            }
        }
    });
});

describe('isCalendarDate', () => {
    it('accepts real dates and refuses anything else', () => {
        expect(isCalendarDate('2026-11-26')).toBe(true);
        expect(isCalendarDate('2028-02-29')).toBe(true);
        for (const bad of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-11-31', '26-11-26', '2026-1-5', '2026-11-26T00:00:00Z', ' 2026-11-26', ''])
            expect({ bad, ok: isCalendarDate(bad) }).toEqual({ bad, ok: false });
    });
});
