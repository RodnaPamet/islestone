/**
 * Working days (sub-phase 2.8a; owner decision 151): Monday to Friday, no
 * holidays, until roadmap 3.1 brings teams' working calendars, which replace
 * {@link WORKING_WEEKDAYS} for steps opened after it.
 *
 * Pure and date-only: every value is UTC midnight of a calendar date (the
 * shape Prisma reads a `@db.Date` column back as), and only its UTC parts are
 * read, so a date never meets a time zone here. "Today" is computed by the
 * caller in `NOTIFICATIONS_TZ` (`todayInTz`) before it reaches this module.
 *
 * Written fresh for Islestone: inflect-compliance has no working-day
 * arithmetic, and date-fns's `addBusinessDays` works on instants, a time-zone
 * question date-only values must never meet.
 */

const MS_PER_DAY = 86_400_000;

/** The working weekdays, as `Date.getUTCDay()` numbers: Monday (1) to Friday (5). */
export const WORKING_WEEKDAYS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);

/** A date-only value's day, at UTC midnight. */
export function dateOnlyUtc(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function isWorkingDay(d: Date): boolean {
    return WORKING_WEEKDAYS.has(d.getUTCDay());
}

/**
 * The date `n` working days after `start` (date-only): each following day
 * that is a working day counts one, so from a Friday one working day is the
 * Monday, and from a Saturday it is also the Monday. `n` must be a positive
 * whole number; the result is always a working day.
 */
export function addWorkingDays(start: Date, n: number): Date {
    if (!Number.isInteger(n) || n < 1) throw new RangeError('addWorkingDays: n must be a whole number of at least 1');
    let day = dateOnlyUtc(start).getTime();
    let counted = 0;
    while (counted < n) {
        day += MS_PER_DAY;
        if (WORKING_WEEKDAYS.has(new Date(day).getUTCDay())) counted += 1;
    }
    return new Date(day);
}

/** The next working day after `d`. */
export function nextWorkingDay(d: Date): Date {
    return addWorkingDays(d, 1);
}
