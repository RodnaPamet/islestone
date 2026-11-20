/**
 * Cycles (sub-phase 2.5a, ADR 0006 "Cycle", "Cycle schedule"): the pure date
 * arithmetic of a team's cycles. No database, no clock: callers pass "today"
 * (a date-only value, UTC midnight of the calendar date in `NOTIFICATIONS_TZ`).
 *
 * Every date here is date-only, as due dates are: a `Date` at UTC midnight,
 * compared and stepped by its UTC parts and never passed through a time zone.
 * Cycle ranges are inclusive at both ends, as the `Cycle_no_overlap`
 * exclusion constraint reads them (`daterange(startsOn, endsOn, '[]')`).
 *
 * Written fresh for Islestone (docs/porting/maps/2.5.md).
 */

export const DAY_MS = 86_400_000;

/** Cycle lengths a schedule takes, in weeks (owner decision 63; CHECK). */
export const CYCLE_LENGTH_WEEKS = { min: 1, max: 8, default: 2 } as const;
/** How many upcoming cycles a schedule keeps after the current one (CHECK). */
export const CYCLE_UPCOMING_COUNT = { min: 1, max: 6, default: 2 } as const;
/** A one-off cycle's longest span, in days (twice the longest schedule). */
export const CYCLE_MAX_DAYS = 16 * 7;

export type CycleStatus = 'upcoming' | 'current' | 'ended' | 'completed';

export interface CycleRange {
    startsOn: Date;
    endsOn: Date;
}

/** `d` moved by `days` calendar days (date-only). */
export function addDays(d: Date, days: number): Date {
    return new Date(d.getTime() + days * DAY_MS);
}

/** Calendar days from `a` to `b` (date-only; negative when `b` is earlier). */
export function daysBetween(a: Date, b: Date): number {
    return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/** `YYYY-MM-DD` of a date-only value (its UTC parts). */
export function dayKey(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/** The date-only value of `YYYY-MM-DD`. */
export function fromDayKey(key: string): Date {
    return new Date(`${key}T00:00:00.000Z`);
}

/** Inclusive ranges overlap when each starts on or before the other ends. */
export function rangesOverlap(a: CycleRange, b: CycleRange): boolean {
    return a.startsOn.getTime() <= b.endsOn.getTime() && b.startsOn.getTime() <= a.endsOn.getTime();
}

/**
 * A cycle's status on `today`. `ended` is a cycle whose last day has passed
 * but which the nightly rollover has not closed yet; `completed` is closed.
 */
export function cycleStatus(c: CycleRange & { completedAt: Date | null }, today: Date): CycleStatus {
    if (c.completedAt) return 'completed';
    if (today.getTime() < c.startsOn.getTime()) return 'upcoming';
    if (today.getTime() > c.endsOn.getTime()) return 'ended';
    return 'current';
}

/** Days left in a cycle on `today`, today included (0 once it has ended). */
export function daysLeft(c: CycleRange, today: Date): number {
    if (today.getTime() > c.endsOn.getTime()) return 0;
    const from = today.getTime() < c.startsOn.getTime() ? c.startsOn : today;
    return daysBetween(from, c.endsOn) + 1;
}

export interface ScheduleShape {
    lengthWeeks: number;
    firstStartsOn: Date;
    upcomingCount: number;
}

/** The `index`th window of a schedule (index 0 starts on `firstStartsOn`). */
export function scheduledWindow(s: Pick<ScheduleShape, 'lengthWeeks' | 'firstStartsOn'>, index: number): CycleRange {
    const days = s.lengthWeeks * 7;
    const startsOn = addDays(s.firstStartsOn, index * days);
    return { startsOn, endsOn: addDays(startsOn, days - 1) };
}

/** The index of the window that contains `today` (0 while the schedule has not started). */
export function windowIndexAt(s: Pick<ScheduleShape, 'lengthWeeks' | 'firstStartsOn'>, today: Date): number {
    const elapsed = daysBetween(s.firstStartsOn, today);
    if (elapsed < 0) return 0;
    return Math.floor(elapsed / (s.lengthWeeks * 7));
}

/**
 * The windows a schedule still has to make on `today`: the one containing
 * today (or the first, before the schedule starts) and `upcomingCount` more,
 * less every window that overlaps an existing cycle of the team (a one-off
 * cycle a person made, or one the schedule made before). Returned in date
 * order; none overlaps another or an existing cycle, and none ended before
 * today. Deterministic, so a re-run makes nothing twice.
 */
export function planScheduledCycles(s: ScheduleShape, existing: readonly CycleRange[], today: Date): CycleRange[] {
    const first = windowIndexAt(s, today);
    const out: CycleRange[] = [];
    for (let i = first; i <= first + s.upcomingCount; i++) {
        const w = scheduledWindow(s, i);
        if (w.endsOn.getTime() < today.getTime()) continue;
        if (existing.some((c) => rangesOverlap(c, w))) continue;
        out.push(w);
    }
    return out;
}

/**
 * The cycle a rollover moves unfinished items to: the earliest cycle of the
 * team that starts after `endsOn` and is not completed. `null` when there is
 * none.
 */
export function nextCycleAfter<T extends CycleRange & { completedAt: Date | null }>(cycles: readonly T[], endsOn: Date): T | null {
    let best: T | null = null;
    for (const c of cycles) {
        if (c.completedAt || c.startsOn.getTime() <= endsOn.getTime()) continue;
        if (!best || c.startsOn.getTime() < best.startsOn.getTime()) best = c;
    }
    return best;
}

/** "Cycle 12", or the cycle's own name. */
export function cycleLabel(c: { number: number; name: string | null }): string {
    return c.name?.trim() ? c.name : `Cycle ${c.number}`;
}
