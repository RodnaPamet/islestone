/**
 * Elapsed working time (sub-phase 3.6a, owner decision 313; ADR 0014 §3;
 * docs/porting/maps/3.6.md, "Cycle time and lead time").
 *
 * The time between two instants less every WHOLE non-working day (a weekend
 * day or a holiday of the calendar) lying between them, measured in the
 * calendar's zone, in days of 24 hours. Started and finished the same
 * afternoon is a fraction of a day; Friday 16:00 to Monday 10:00 on a Monday
 * to Friday calendar is 0.75 days. A day only partly inside the span is never
 * removed, so the result is never negative and never more than the elapsed
 * time. A day's length is its own (23 or 25 hours across a change of offset).
 *
 * Working days come from the scheduling module (`isWorkingDay`; ADR 0010 §1),
 * never a second rule; day starts from `zone.ts`.
 *
 * Pure. Written fresh for Islestone.
 */
import { isWorkingDay, type CompiledCalendar, type EpochDay } from '../schedule/calendar';
import { DayStarts, epochDayOf } from './zone';

const DAY_MS = 86_400_000;

/** A calendar for durations: its working days and the zone its days are cut in. */
export interface DurationCalendar {
    compiled: CompiledCalendar;
    timeZone: string;
}

/** Milliseconds as days to one decimal (24 hours is one day). */
export function toTenthsOfDays(ms: number): number {
    return Math.round((ms / DAY_MS) * 10) / 10;
}

/**
 * A meter for one calendar: remembers each day's start and a running sum of
 * non-working days' lengths, so thousands of durations over a year cost one
 * walk of that year.
 */
export class WorkingTimeMeter {
    private readonly starts: DayStarts;
    private base = 0;
    /** `prefix[i]`: the summed length of the non-working days `base … base + i − 1`. */
    private prefix: number[] = [0];

    constructor(readonly calendar: DurationCalendar) {
        this.starts = new DayStarts(calendar.timeZone);
    }

    private ensure(lo: EpochDay, hi: EpochDay): void {
        const end = this.base + this.prefix.length - 1; // first day not covered
        if (this.prefix.length > 1 && lo >= this.base && hi < end) return;
        const from = this.prefix.length > 1 ? Math.min(lo, this.base) : lo;
        const to = this.prefix.length > 1 ? Math.max(hi, end - 1) : hi;
        const prefix = [0];
        let sum = 0;
        for (let d = from; d <= to; d++) {
            if (!isWorkingDay(this.calendar.compiled, d)) sum += this.starts.at(d + 1) - this.starts.at(d);
            prefix.push(sum);
        }
        this.base = from;
        this.prefix = prefix;
    }

    /** The summed length (ms) of the non-working days in the inclusive span `[a, b]`. */
    private nonWorkingMs(a: EpochDay, b: EpochDay): number {
        if (b < a) return 0;
        this.ensure(a, b);
        return this.prefix[b - this.base + 1]! - this.prefix[a - this.base]!;
    }

    /** Elapsed working time in milliseconds. */
    elapsedMs(start: Date, end: Date): number {
        const s = start.getTime();
        const e = end.getTime();
        if (!(e > s)) return 0;
        const tz = this.calendar.timeZone;
        const d0 = epochDayOf(s, tz);
        const d1 = epochDayOf(e, tz);
        // The whole days inside [s, e]: from d0 when s is its very start, else
        // d0 + 1; to d1 − 1 (d1 itself ends after e).
        const first = this.starts.at(d0) === s ? d0 : d0 + 1;
        const last = d1 - 1;
        return e - s - this.nonWorkingMs(first, last);
    }

    /** Elapsed working time in days to one decimal. */
    elapsedDays(start: Date, end: Date): number {
        return toTenthsOfDays(this.elapsedMs(start, end));
    }
}

/** Elapsed working time between two instants on `calendar`, in days to one decimal. */
export function elapsedWorkingDays(start: Date, end: Date, calendar: DurationCalendar): number {
    return new WorkingTimeMeter(calendar).elapsedDays(start, end);
}
