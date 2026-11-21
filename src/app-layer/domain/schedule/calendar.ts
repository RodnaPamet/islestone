/**
 * Working-day arithmetic over epoch days (roadmap 3.1; ADR 0010 §1 and §5;
 * owner decisions 189 to 192).
 *
 * An epoch day is a whole number of days since 1970-01-01: a civil date,
 * never an instant. Every function here but {@link todayIn} is pure integer
 * arithmetic, so neither the process's time zone nor a daylight-saving change
 * can move a result. {@link todayIn} is the one place a time zone is read: it
 * turns an instant into the civil date it is in a named zone, through `Intl`.
 *
 * A calendar is its working weekdays (ISO: 1 Monday to 7 Sunday) and its
 * holidays (epoch days). {@link compileCalendar} turns that into a lookup the
 * other functions read: a weekday mask and the holidays that fall on working
 * weekdays, sorted, searched by bisection. Counting working days over a span
 * steps whole weeks, then the remainder, then subtracts the holidays in the
 * span, so a count is O(log h), not O(days).
 *
 * Client-safe: no server import, no clock, no `@/env`. The scheduling engine
 * (`engine.ts`), review steps (`working-days.ts`) and the browser's preview
 * read the same functions.
 *
 * Written fresh for Islestone.
 */

/** Days since 1970-01-01: a civil date. */
export type EpochDay = number;

/** An ISO weekday: 1 Monday … 7 Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const ISO_WEEKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

/** Monday to Friday: the calendar every workspace has until an admin edits one (ADR 0010 §5). */
export const DEFAULT_WORKING_WEEKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5];

/** A working calendar as plain data. */
export interface CalendarSpec {
    id: string;
    workingWeekdays: readonly IsoWeekday[];
    holidays: readonly EpochDay[];
}

/** A calendar ready for arithmetic (see {@link compileCalendar}). */
export interface CompiledCalendar {
    readonly id: string;
    /** `mask[w]` is true when ISO weekday `w` is a working weekday (index 0 unused). */
    readonly mask: readonly boolean[];
    /** Working weekdays per week, 1 to 7. */
    readonly perWeek: number;
    /** Holidays on working weekdays, sorted ascending, unique. */
    readonly holidays: Int32Array | readonly number[];
}

const MS_PER_DAY = 86_400_000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The ISO weekday of an epoch day: 1970-01-01 was a Thursday. */
export function isoWeekday(d: EpochDay): IsoWeekday {
    return ((((d + 3) % 7) + 7) % 7) + 1 as IsoWeekday;
}

/** `YYYY-MM-DD`, or a `Date` read by its UTC parts (how Prisma returns a `@db.Date`), as an epoch day. */
export function toEpochDay(value: string | Date): EpochDay {
    if (typeof value === 'string') {
        const m = DATE_ONLY.exec(value);
        if (!m) throw new RangeError(`toEpochDay: not a date (YYYY-MM-DD): ${value}`);
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        const ms = Date.UTC(y, mo - 1, d);
        const back = new Date(ms);
        if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
            throw new RangeError(`toEpochDay: no such date: ${value}`);
        }
        return Math.round(ms / MS_PER_DAY);
    }
    return Math.floor(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) / MS_PER_DAY);
}

/** An epoch day as `YYYY-MM-DD`. */
export function fromEpochDay(d: EpochDay): string {
    return new Date(d * MS_PER_DAY).toISOString().slice(0, 10);
}

/** An epoch day as the `Date` at its UTC midnight (the shape a `@db.Date` column takes). */
export function epochDayToDate(d: EpochDay): Date {
    return new Date(d * MS_PER_DAY);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
    let f = formatters.get(timeZone);
    if (!f) {
        f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
        formatters.set(timeZone, f);
    }
    return f;
}

/** True when `Intl` knows the IANA zone. */
export function isKnownTimeZone(timeZone: string): boolean {
    if (!timeZone || timeZone.length > 64) return false;
    try {
        formatterFor(timeZone);
        return true;
    } catch {
        return false;
    }
}

/**
 * The civil date an instant falls on in `timeZone`, as an epoch day. The only
 * function in the module that reads a time zone.
 */
export function todayIn(timeZone: string, instant: Date | number): EpochDay {
    const parts = formatterFor(timeZone).formatToParts(typeof instant === 'number' ? new Date(instant) : instant);
    let y = 0;
    let m = 0;
    let d = 0;
    for (const p of parts) {
        if (p.type === 'year') y = Number(p.value);
        else if (p.type === 'month') m = Number(p.value);
        else if (p.type === 'day') d = Number(p.value);
    }
    return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/**
 * Compile a calendar for arithmetic. Throws on a calendar with no working
 * weekday (it would never finish anything) or a weekday outside 1 to 7.
 */
export function compileCalendar(spec: CalendarSpec): CompiledCalendar {
    const mask = new Array<boolean>(8).fill(false);
    for (const w of spec.workingWeekdays) {
        if (!Number.isInteger(w) || w < 1 || w > 7) throw new RangeError(`compileCalendar: weekday out of range: ${w}`);
        mask[w] = true;
    }
    const perWeek = mask.filter(Boolean).length;
    if (perWeek === 0) throw new RangeError(`compileCalendar: the calendar ${spec.id} has no working weekday`);
    const days = [...new Set(spec.holidays.filter((h) => Number.isInteger(h) && mask[isoWeekday(h)]))].sort((a, b) => a - b);
    return { id: spec.id, mask, perWeek, holidays: Int32Array.from(days) };
}

/** The calendar used when nothing is configured: Monday to Friday, no holidays. */
export function defaultCalendar(id = 'default'): CompiledCalendar {
    return compileCalendar({ id, workingWeekdays: DEFAULT_WORKING_WEEKDAYS, holidays: [] });
}

/** The index of the first holiday ≥ `d`. */
function lowerBound(holidays: CompiledCalendar['holidays'], d: number): number {
    let lo = 0;
    let hi = holidays.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if ((holidays[mid] as number) < d) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function isHoliday(c: CompiledCalendar, d: EpochDay): boolean {
    const i = lowerBound(c.holidays, d);
    return i < c.holidays.length && c.holidays[i] === d;
}

/** Holidays (on working weekdays) in the inclusive span `[a, b]`. */
function holidaysIn(c: CompiledCalendar, a: EpochDay, b: EpochDay): number {
    if (b < a) return 0;
    return lowerBound(c.holidays, b + 1) - lowerBound(c.holidays, a);
}

function isWorkingWeekday(c: CompiledCalendar, d: EpochDay): boolean {
    return c.mask[isoWeekday(d)] === true;
}

export function isWorkingDay(c: CompiledCalendar, d: EpochDay): boolean {
    return isWorkingWeekday(c, d) && !isHoliday(c, d);
}

/** `d` itself when it is a working day, else the first working day after it. */
export function nextWorkingDay(c: CompiledCalendar, d: EpochDay): EpochDay {
    let day = d;
    while (!isWorkingDay(c, day)) day += 1;
    return day;
}

/** `d` itself when it is a working day, else the last working day before it. */
export function previousWorkingDay(c: CompiledCalendar, d: EpochDay): EpochDay {
    let day = d;
    while (!isWorkingDay(c, day)) day -= 1;
    return day;
}

/** Working weekdays (holidays not subtracted) in `[a, b]`. */
function weekdaysIn(c: CompiledCalendar, a: EpochDay, b: EpochDay): number {
    if (b < a) return 0;
    const span = b - a + 1;
    const weeks = Math.floor(span / 7);
    let count = weeks * c.perWeek;
    for (let day = a + weeks * 7; day <= b; day += 1) if (isWorkingWeekday(c, day)) count += 1;
    return count;
}

/** The number of working days in the inclusive span `[a, b]` (0 when `b < a`). */
export function workingDaysInclusive(c: CompiledCalendar, a: EpochDay, b: EpochDay): number {
    if (b < a) return 0;
    return weekdaysIn(c, a, b) - holidaysIn(c, a, b);
}

/** From a working weekday `from`, the `k`-th working weekday after it (holidays ignored). */
function advanceWeekdays(c: CompiledCalendar, from: EpochDay, k: number): EpochDay {
    if (k === 0) return from;
    const weeks = Math.floor((k - 1) / c.perWeek);
    let day = from + weeks * 7;
    let left = k - weeks * c.perWeek;
    while (left > 0) {
        day += 1;
        if (isWorkingWeekday(c, day)) left -= 1;
    }
    return day;
}

/** From a working weekday `from`, the `k`-th working weekday before it (holidays ignored). */
function retreatWeekdays(c: CompiledCalendar, from: EpochDay, k: number): EpochDay {
    if (k === 0) return from;
    const weeks = Math.floor((k - 1) / c.perWeek);
    let day = from - weeks * 7;
    let left = k - weeks * c.perWeek;
    while (left > 0) {
        day -= 1;
        if (isWorkingWeekday(c, day)) left -= 1;
    }
    return day;
}

/**
 * The `n`-th working day after the first working day on or after `d`
 * (`n ≥ 0`): `addWorkingDays(c, d, 0)` is `nextWorkingDay(c, d)`. An item
 * starting on working day `s` with a duration of `k` working days finishes
 * on `addWorkingDays(c, s, k - 1)`.
 */
export function addWorkingDays(c: CompiledCalendar, d: EpochDay, n: number): EpochDay {
    if (!Number.isInteger(n) || n < 0) throw new RangeError('addWorkingDays: n must be a whole number of at least 0');
    let day = nextWorkingDay(c, d);
    let left = n;
    while (left > 0) {
        const next = advanceWeekdays(c, day, left);
        // Holidays in the span stepped over did not count: step again for them.
        left = holidaysIn(c, day + 1, next);
        day = next;
    }
    return day;
}

/** The mirror of {@link addWorkingDays}: the `n`-th working day before the last working day on or before `d`. */
export function subtractWorkingDays(c: CompiledCalendar, d: EpochDay, n: number): EpochDay {
    if (!Number.isInteger(n) || n < 0) throw new RangeError('subtractWorkingDays: n must be a whole number of at least 0');
    let day = previousWorkingDay(c, d);
    let left = n;
    while (left > 0) {
        const next = retreatWeekdays(c, day, left);
        left = holidaysIn(c, next, day - 1);
        day = next;
    }
    return day;
}

/**
 * Working days from `a` to `b`, signed: 0 when they are the same working day,
 * positive when `b` is later, negative when earlier. Both should be working
 * days; a non-working end counts as the working day before it.
 */
export function workingDayDiff(c: CompiledCalendar, a: EpochDay, b: EpochDay): number {
    if (b >= a) return workingDaysInclusive(c, a + 1, b);
    return -workingDaysInclusive(c, b + 1, a);
}

/**
 * The `n`-th working day after `d` itself, never counting `d` (`n ≥ 1`):
 * from a Friday one working day is the next Monday, and from a Saturday it
 * is also the Monday. What a review step's due day is (ADR 0009 §13).
 */
export function workingDaysAfter(c: CompiledCalendar, d: EpochDay, n: number): EpochDay {
    if (!Number.isInteger(n) || n < 1) throw new RangeError('workingDaysAfter: n must be a whole number of at least 1');
    return addWorkingDays(c, d + 1, n - 1);
}

/**
 * "Copy last year's" (decision 190): the same names on the same day of the
 * same month in `toYear`; 29 February becomes 28 February. Dates already
 * present in `existing` are skipped. A person then fixes the moveable ones.
 */
export function copyHolidaysToYear(
    holidays: ReadonlyArray<{ day: string; name: string }>,
    fromYear: number,
    toYear: number,
    existing: ReadonlySet<string> = new Set(),
): Array<{ day: string; name: string }> {
    const out = new Map<string, string>();
    for (const h of holidays) {
        const m = DATE_ONLY.exec(h.day);
        if (!m || Number(m[1]) !== fromYear) continue;
        const month = m[2]!;
        let date = m[3]!;
        if (month === '02' && date === '29') {
            const leap = new Date(Date.UTC(toYear, 1, 29)).getUTCMonth() === 1;
            if (!leap) date = '28';
        }
        const day = `${String(toYear).padStart(4, '0')}-${month}-${date}`;
        if (!existing.has(day) && !out.has(day)) out.set(day, h.name);
    }
    return [...out.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([day, name]) => ({ day, name }));
}
