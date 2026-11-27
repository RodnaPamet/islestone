/**
 * A member's capacity in a week (sub-phase 3.5a; docs/porting/maps/3.5.md,
 * "Capacity in a week"; ADR 0013 §1; owner decisions 284 to 286).
 *
 *   1. **Day shares.** The week's minutes are shared over the calendar's
 *      working weekdays: each gets `floor(W / perWeek)`, and the remainder goes
 *      one minute at a time to the earliest working weekdays, so the shares sum
 *      to `W` exactly (40 hours on Monday to Friday is 480 minutes a day).
 *   2. **Holidays.** A holiday on the person's calendar keeps its share at zero
 *      (`isWorkingDay` is false): its hours are lost, not moved.
 *   3. **Time off, date by date.** A whole-day row removes the day's whole
 *      share; a row of `m` minutes removes `min(m, share)`; a row on a weekend,
 *      a non-working weekday or a holiday removes nothing more.
 *   4. **Deactivated**: zero. **No capacity row**: the workspace's default on
 *      the workspace's calendar.
 *
 * Pure and client-safe, over epoch days and compiled calendars: no database,
 * no clock, no zone, no time-off type. Working days come only from the
 * scheduling module (ADR 0010 §1: never a second working-day count).
 * Pattern only from Cal.diy's availability study (weekly hours on working
 * weekdays, holidays and time off replacing a day's hours; `PROVENANCE.md`);
 * written fresh for Islestone.
 */
import { isoWeekday, isWorkingDay, type CompiledCalendar, type EpochDay } from '../schedule/calendar';

/** One stored capacity row, as plain data. `effectiveFrom` is a Monday. */
export interface CapacityRowSpec {
    effectiveFrom: EpochDay;
    weeklyMinutes: number;
    /** The team whose calendar the person counts on; NULL: the workspace's. */
    calendarTeamId: string | null;
}

/** One date of time off: NULL minutes is the whole day. */
export interface TimeOffDaySpec {
    day: EpochDay;
    minutes: number | null;
}

/** What a person is, for capacity. */
export interface CapacityPerson {
    /** False for a deactivated member: zero capacity while deactivated. */
    active: boolean;
    /** Their capacity rows, any order. */
    rows: readonly CapacityRowSpec[];
    /** Their time-off dates (at most one per date). */
    timeOff: readonly TimeOffDaySpec[];
}

/** The workspace's default and the calendars people count on. */
export interface CapacityContext {
    defaultWeeklyMinutes: number;
    /** The team's calendar, else the workspace's (`forTeam(null)` is the workspace's). */
    calendarFor(teamId: string | null): CompiledCalendar;
}

/** One person's week. */
export interface WeekCapacity {
    /** The week's Monday. */
    week: EpochDay;
    /** What they can work this week, after holidays and time off. */
    capacityMinutes: number;
    /** Their weekly hours in force (before holidays and time off). */
    weeklyMinutes: number;
    /** The minutes time off removed. */
    timeOffMinutes: number;
    /** The dates in the week that carry time off, ascending. */
    timeOffDays: EpochDay[];
    /** The team whose calendar counted; NULL the workspace's. */
    calendarTeamId: string | null;
}

/** The Monday of the week holding `d`. */
export function mondayOf(d: EpochDay): EpochDay {
    return d - (isoWeekday(d) - 1);
}

/**
 * The share of `weeklyMinutes` each ISO weekday gets (index 0 is Monday): the
 * calendar's working weekdays share it evenly, the remainder going to the
 * earliest; other weekdays get zero. Sums to `weeklyMinutes` exactly.
 */
export function weekdayShares(calendar: CompiledCalendar, weeklyMinutes: number): number[] {
    const shares = [0, 0, 0, 0, 0, 0, 0];
    const working: number[] = [];
    for (let w = 1; w <= 7; w += 1) if (calendar.mask[w] === true) working.push(w);
    if (working.length === 0) return shares;
    const base = Math.floor(weeklyMinutes / working.length);
    let remainder = weeklyMinutes - base * working.length;
    for (const w of working) {
        shares[w - 1] = base + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
    }
    return shares;
}

/** The person's row in force for the week starting `monday`: their latest row on or before it, if any. */
export function rowInForce(rows: readonly CapacityRowSpec[], monday: EpochDay): CapacityRowSpec | null {
    let best: CapacityRowSpec | null = null;
    for (const r of rows) if (r.effectiveFrom <= monday && (best === null || r.effectiveFrom > best.effectiveFrom)) best = r;
    return best;
}

/** One person's capacity in the week starting `monday` (see the module's rules). */
export function weekCapacity(person: CapacityPerson, monday: EpochDay, ctx: CapacityContext, timeOffByDay?: ReadonlyMap<EpochDay, number | null>): WeekCapacity {
    const byDay = timeOffByDay ?? new Map(person.timeOff.map((t) => [t.day, t.minutes] as const));
    const timeOffDays: EpochDay[] = [];
    for (let i = 0; i < 7; i += 1) if (byDay.has(monday + i)) timeOffDays.push(monday + i);

    const row = rowInForce(person.rows, monday);
    const weeklyMinutes = row ? row.weeklyMinutes : ctx.defaultWeeklyMinutes;
    const calendarTeamId = row ? row.calendarTeamId : null;
    if (!person.active) return { week: monday, capacityMinutes: 0, weeklyMinutes, timeOffMinutes: 0, timeOffDays, calendarTeamId };

    const calendar = ctx.calendarFor(calendarTeamId);
    const shares = weekdayShares(calendar, weeklyMinutes);
    let capacityMinutes = 0;
    let timeOffMinutes = 0;
    for (let i = 0; i < 7; i += 1) {
        const day = monday + i;
        if (!isWorkingDay(calendar, day)) continue;
        const share = shares[i]!;
        let removed = 0;
        if (byDay.has(day)) {
            const off = byDay.get(day);
            removed = off === null || off === undefined ? share : Math.min(off, share);
        }
        capacityMinutes += share - removed;
        timeOffMinutes += removed;
    }
    return { week: monday, capacityMinutes, weeklyMinutes, timeOffMinutes, timeOffDays, calendarTeamId };
}

/** One person's capacity in each week of `weeks` (each a Monday). */
export function capacityByWeek(person: CapacityPerson, weeks: readonly EpochDay[], ctx: CapacityContext): WeekCapacity[] {
    const byDay = new Map(person.timeOff.map((t) => [t.day, t.minutes] as const));
    return weeks.map((monday) => weekCapacity(person, monday, ctx, byDay));
}
