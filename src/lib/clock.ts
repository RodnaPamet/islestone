/**
 * The clock seam for "today" (Hardening H2g, owner decision 180;
 * docs/porting/maps/H2.md part 7).
 *
 * Every usecase, notification writer and job that asks what day it is takes
 * its instant from `todayClock(timeZone)` and turns it into a day with the
 * date helpers it already uses (`todayInTz`, `dayKeyInTz`, `todayIn`,
 * `classifyDueWindow`). Outside the E2E server it returns the real instant
 * (`now`, `new Date()` by default), so nothing changes. On the E2E server
 * (`NEXT_TEST_MODE=1`, set only by the Playwright webServer) with `E2E_TODAY`
 * set, it returns noon of that date in `timeZone`: every cycle, repeat, due
 * window, reminder, milestone and calendar reads one fixed day for the whole
 * run, so a run that crosses midnight cannot split a spec across two days.
 *
 * Only "today" moves. Stored instants (`createdAt`, `startedAt`, a
 * transition's time) stay the database's and the process's real time; a
 * conversion of a stored instant to a day never goes through this seam.
 *
 * `src/env.ts` refuses `E2E_TODAY` in production unless `NEXT_TEST_MODE=1`,
 * as it refuses `AUTH_TEST_MODE`, and the startup check refuses it again
 * (`src/lib/security/startup-test-clock-check.ts`). This module is the only
 * reader of the value; `tests/guards/today-clock-seam.test.ts` holds the
 * callers to it.
 */
import { env } from '@/env';
import { isCalendarDate } from '@/lib/calendar-date';

/** The E2E server's fixed date (`YYYY-MM-DD`), or `null` when the seam is off. */
export function fixedTestToday(): string | null {
    if (env.NEXT_TEST_MODE !== '1') return null;
    const value = env.E2E_TODAY as string | undefined;
    return value && isCalendarDate(value) ? value : null;
}

/**
 * An instant that falls on today's date in `timeZone`. Off the E2E server,
 * `now` itself. On it, noon of `E2E_TODAY` in `timeZone` (noon, so a
 * daylight-saving change cannot move it to another date).
 */
export function todayClock(timeZone: string, now: Date = new Date()): Date {
    const fixed = fixedTestToday();
    return fixed ? noonIn(fixed, timeZone) : now;
}

/** Noon of the calendar date `ymd` as seen in IANA zone `timeZone`. */
export function noonIn(ymd: string, timeZone: string): Date {
    const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
    const utcNoon = Date.UTC(y, m - 1, d, 12);
    return new Date(utcNoon - offsetAt(utcNoon, timeZone));
}

/** The zone's offset from UTC, in milliseconds, at the instant `at`. */
function offsetAt(at: number, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(new Date(at));
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
    return wall - at;
}
