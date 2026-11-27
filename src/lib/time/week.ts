/**
 * The week of sub-phase 3.4 (docs/porting/maps/3.4.md; ADR 0012 §3; owner
 * decision 268): Monday to Sunday, by each entry's date, as the product's
 * date pickers start their weeks (`WEEK_STARTS_ON = 1`). Date-only
 * arithmetic over `YYYY-MM-DD` keys: no time zone enters once a date is set,
 * so the week of a date is the same in every process zone.
 *
 * Client-safe and pure. Written fresh for Islestone.
 */
import { WEEK_STARTS_ON } from '@/components/ui/date-picker/week-start';
import { isCalendarDate } from '@/lib/calendar-date';

const DAY_MS = 86_400_000;

function utcOf(ymd: string): number {
    const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
}

function keyOf(utc: number): string {
    return new Date(utc).toISOString().slice(0, 10);
}

/** `ymd` moved by `days` calendar days. */
export function addDays(ymd: string, days: number): string {
    return keyOf(utcOf(ymd) + days * DAY_MS);
}

/** The ISO weekday of `ymd`: 1 = Monday … 7 = Sunday. */
export function isoWeekday(ymd: string): number {
    const day = new Date(utcOf(ymd)).getUTCDay();
    return day === 0 ? 7 : day;
}

/** The Monday that starts the week holding `ymd`. */
export function weekStartOf(ymd: string): string {
    const day = new Date(utcOf(ymd)).getUTCDay();
    const back = (day - WEEK_STARTS_ON + 7) % 7;
    return addDays(ymd, -back);
}

/** Whether `ymd` is a calendar date that starts a week. */
export function isWeekStart(ymd: string): boolean {
    return isCalendarDate(ymd) && weekStartOf(ymd) === ymd;
}

/** The seven dates of the week starting `weekStart`, Monday first. */
export function weekDays(weekStart: string): string[] {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** The date-only value Prisma stores for `ymd` (UTC midnight). */
export function dateOnlyValue(ymd: string): Date {
    return new Date(`${ymd}T00:00:00.000Z`);
}

/** The `YYYY-MM-DD` key of a stored date-only value (its UTC parts, never converted). */
export function dateKeyOf(d: Date): string {
    return d.toISOString().slice(0, 10);
}
