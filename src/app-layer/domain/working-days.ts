/**
 * Working days for review steps (sub-phase 2.8a, owner decision 151; from
 * roadmap 3.1, owner decisions 191 and 192, ADR 0009 §13 as amended, ADR
 * 0010 §5): the same signatures 2.8 wrote, on a working calendar.
 *
 * The arithmetic lives in the scheduling engine's calendar module
 * (`schedule/calendar.ts`); this module keeps 2.8's `Date` shapes over it.
 * With no calendar given, it is Monday to Friday with no holidays, which is
 * also what a workspace that never edited a calendar uses: review due days
 * do not move until an admin edits one, and a stored `dueOn` never moves.
 *
 * Pure and date-only: every value is UTC midnight of a calendar date (the
 * shape Prisma reads a `@db.Date` column back as), and only its UTC parts are
 * read, so a date never meets a time zone here. "Today" is computed by the
 * caller in the calendar's time zone before it reaches this module.
 *
 * Written fresh for Islestone: inflect-compliance has no working-day
 * arithmetic, and date-fns's `addBusinessDays` works on instants, a time-zone
 * question date-only values must never meet.
 */
import {
    DEFAULT_WORKING_WEEKDAYS,
    defaultCalendar,
    epochDayToDate,
    isWorkingDay as isWorkingEpochDay,
    toEpochDay,
    workingDaysAfter,
    type CompiledCalendar,
} from './schedule/calendar';

/** The default working weekdays, as `Date.getUTCDay()` numbers: Monday (1) to Friday (5). */
export const WORKING_WEEKDAYS: ReadonlySet<number> = new Set(DEFAULT_WORKING_WEEKDAYS);

const MONDAY_TO_FRIDAY = defaultCalendar('monday-to-friday');

/** A date-only value's day, at UTC midnight. */
export function dateOnlyUtc(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function isWorkingDay(d: Date, calendar: CompiledCalendar = MONDAY_TO_FRIDAY): boolean {
    return isWorkingEpochDay(calendar, toEpochDay(d));
}

/**
 * The date `n` working days after `start` (date-only): each following day
 * that is a working day counts one, so from a Friday one working day is the
 * Monday, and from a Saturday it is also the Monday. `n` must be a positive
 * whole number; the result is always a working day of the calendar.
 */
export function addWorkingDays(start: Date, n: number, calendar: CompiledCalendar = MONDAY_TO_FRIDAY): Date {
    if (!Number.isInteger(n) || n < 1) throw new RangeError('addWorkingDays: n must be a whole number of at least 1');
    return epochDayToDate(workingDaysAfter(calendar, toEpochDay(start), n));
}

/** The next working day after `d`. */
export function nextWorkingDay(d: Date, calendar: CompiledCalendar = MONDAY_TO_FRIDAY): Date {
    return addWorkingDays(d, 1, calendar);
}
