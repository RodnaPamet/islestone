/**
 * Day boundaries in a zone (sub-phase 3.6a, owner decision 316; ADR 0014 §5).
 * The scheduling module keeps its one zone read (`todayIn`); analytics also
 * needs the instant a civil day begins in a zone, to cut a day's events and to
 * remove a non-working day's hours from a duration. Pure: no clock, no
 * database.
 *
 * `startOfDayInTz` moved here from `domain/burn-up.ts` (2.5a), which
 * re-exports it unchanged.
 *
 * Written fresh for Islestone.
 */
import { epochDayToDate, todayIn, type EpochDay } from '../schedule/calendar';

/** The offset of `tz` from UTC at the instant `at`, in milliseconds. */
function zoneOffsetMs(at: Date, tz: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(at);
    const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
    return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant the calendar date `day` (date-only) begins in `tz`. */
export function startOfDayInTz(day: Date, tz: string): Date {
    const guess = day.getTime();
    const first = guess - zoneOffsetMs(new Date(guess), tz);
    // A second pass settles a day whose start falls across an offset change.
    return new Date(guess - zoneOffsetMs(new Date(first), tz));
}

/** The instant the epoch day `d` begins in `tz`. */
export function startOfEpochDay(d: EpochDay, tz: string): Date {
    return startOfDayInTz(epochDayToDate(d), tz);
}

/** The civil day an instant falls on in `tz` (the scheduling module's `todayIn`). */
export function epochDayOf(at: Date | number, tz: string): EpochDay {
    return todayIn(tz, at);
}

/**
 * A memo of day starts for one zone: analytics cuts thousands of instants
 * into days over a window of at most a year or two, so each day's start is
 * computed once.
 */
export class DayStarts {
    private readonly memo = new Map<number, number>();

    constructor(readonly timeZone: string) {}

    /** The instant (ms) the epoch day `d` begins. */
    at(d: EpochDay): number {
        let v = this.memo.get(d);
        if (v === undefined) {
            v = startOfEpochDay(d, this.timeZone).getTime();
            this.memo.set(d, v);
        }
        return v;
    }
}
