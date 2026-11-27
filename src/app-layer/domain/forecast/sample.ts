/**
 * The forecast's history (sub-phase 3.6c; ADR 0014 §3; owner decision 318;
 * docs/porting/maps/3.6.md, "The history").
 *
 *   - **The window**: the last 4, 8, 12 or 26 weeks ending yesterday (today's
 *     partial day is left out), never starting before the history's first
 *     recorded row, so a two-week-old project is not read as ten weeks of
 *     zeros.
 *   - **The sample**: the daily completion counts of each working day of the
 *     scope's calendar in the window, in date order. A completion on a
 *     non-working day is added to the next working day in the window, or,
 *     when the window ends first, to its last working day, so nothing is
 *     lost.
 *
 * Pure and client-safe: epoch days and the scheduling module's calendar only.
 * Written fresh for Islestone.
 */
import { isWorkingDay, nextWorkingDay, previousWorkingDay, type CompiledCalendar, type EpochDay } from '../schedule/calendar';

/** The windows a forecast offers, in weeks (decision 318). */
export const FORECAST_HISTORY_WEEKS = [4, 8, 12, 26] as const;
export type ForecastHistoryWeeks = (typeof FORECAST_HISTORY_WEEKS)[number];
export const DEFAULT_FORECAST_HISTORY_WEEKS: ForecastHistoryWeeks = 12;

/**
 * The history's days for a forecast read on `today`: from `weeks` weeks back
 * (or the first recorded day, if later) to yesterday, inclusive. Null when
 * nothing was recorded before today.
 */
export function historyWindow(today: EpochDay, weeks: number, firstRecordedDay: EpochDay | null): { from: EpochDay; to: EpochDay } | null {
    if (!Number.isInteger(weeks) || weeks < 1) throw new RangeError('historyWindow: weeks must be a whole number of at least 1');
    const to = today - 1;
    if (firstRecordedDay === null || firstRecordedDay > to) return null;
    return { from: Math.max(to - 7 * weeks + 1, firstRecordedDay), to };
}

export interface DailySample {
    /** The working days of the window, ascending. */
    days: EpochDay[];
    /** The completions counted on each of them. */
    counts: number[];
    /** Their sum: every completion in the window (none is lost to a non-working day). */
    completions: number;
}

/**
 * The daily sample of the window `[from, to]` from completions per day
 * (decision 318). Days outside the window are ignored; with no working day in
 * the window the sample is empty.
 */
export function dailySample(perDay: ReadonlyMap<EpochDay, number> | Iterable<readonly [EpochDay, number]>, calendar: CompiledCalendar, from: EpochDay, to: EpochDay): DailySample {
    const days: EpochDay[] = [];
    for (let d = from; d <= to; d += 1) if (isWorkingDay(calendar, d)) days.push(d);
    const counts = new Array<number>(days.length).fill(0);
    if (days.length === 0) return { days, counts, completions: 0 };
    const index = new Map<EpochDay, number>(days.map((d, i) => [d, i]));
    let completions = 0;
    for (const [day, count] of perDay instanceof Map ? perDay.entries() : perDay) {
        if (day < from || day > to || count <= 0) continue;
        let target = isWorkingDay(calendar, day) ? day : nextWorkingDay(calendar, day);
        if (target > to) target = previousWorkingDay(calendar, day);
        const i = index.get(target);
        if (i === undefined) continue;
        counts[i] = counts[i]! + count;
        completions += count;
    }
    return { days, counts, completions };
}
