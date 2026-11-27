/**
 * The forecast's back-test (sub-phase 3.6c; ADR 0014 §5; owner decision 325;
 * Hardening H3; docs/porting/maps/3.6.md, "Calibration").
 *
 * From weekly origins `T` (the first working day of each ISO week, from the
 * first day with a full window), it forecasts "the date of the next `N`
 * completions" with the history as it stood when `T` began (so a reopen or a
 * deletion after `T` is not seen), and scores it against the day the `N`-th
 * completion from `T` on actually happened, as the record stands now:
 *
 *   - each percentile is **scorable** at an origin when the actual day is
 *     known, or when its date has passed without it (a miss); otherwise it is
 *     left out;
 *   - a **hit** is an actual day on or before the percentile's date;
 *   - each percentile's hit rate is given with its scorable count and a 95 %
 *     binomial band (Wilson).
 *
 * The back-test never feeds an actual into a forecast (inflect-compliance's
 * `loss-calibration.ts`, pattern only). A forecast at origin `T` is the live
 * forecast read at the very end of day `T − 1`: its history ends on `T − 1`
 * and its trials begin on the first working day on or after `T`.
 *
 * The record arrives as completion spans (`domain/analytics/completion.ts`,
 * `completionSpans`): each completion's day and the days at whose start it
 * counted. Pure and client-safe. Written fresh for Islestone.
 */
import { isoWeekday, isWorkingDay, type CompiledCalendar, type EpochDay } from '../schedule/calendar';

import { dailySample, historyWindow } from './sample';
import { forecastSeed } from './seed';
import { forecastCompletion, FORECAST_PERCENTILES, type ForecastPercentile, type LikelyDate } from './simulate';

/** The sizes H3's back-test forecasts: the next 10, 25 and 50 completions. */
export const BACKTEST_SIZES = [10, 25, 50] as const;

/**
 * One completion as the record held it over time: it happened on `day`, and
 * counted at the start of every day from `seenFrom` to `seenUntil` inclusive
 * (`null`: still counting now).
 */
export interface DaySpan {
    day: EpochDay;
    seenFrom: EpochDay;
    seenUntil: EpochDay | null;
}

export interface BacktestInput {
    calendar: CompiledCalendar;
    spans: readonly DaySpan[];
    /** The first day of the history's record; origins begin once a full window lies after it. */
    firstRecordedDay: EpochDay;
    /** The day the back-test is read on: actuals are known up to it, dates passed before it. */
    today: EpochDay;
    weeks: number;
    sizes: readonly number[];
    trials: number;
    /** The scope's key, for each origin's derived seed. */
    scopeKey: unknown;
    /** No origin before this day (the per-scope record: the last 52 weeks). */
    originsFrom?: EpochDay;
}

export interface PercentileScore {
    scorable: number;
    held: number;
    /** The 95 % Wilson band of the hit rate, as fractions; null with nothing scorable. */
    band: [number, number] | null;
}

export interface BacktestSizeResult {
    size: number;
    /** Origins at which a forecast was attempted. */
    origins: number;
    /** Origins the forecast refused (too little history then). */
    refused: number;
    scores: Record<`p${ForecastPercentile}`, PercentileScore>;
    /** Each attempted origin: its forecast's days (null when refused) and the actual day (null while unknown). */
    trace: Array<{ origin: EpochDay; likely: Record<`p${ForecastPercentile}`, LikelyDate> | null; actual: EpochDay | null }>;
}

/** The first working day of each ISO week in `[from, to]` (a week with none gives no origin). */
export function weeklyOrigins(calendar: CompiledCalendar, from: EpochDay, to: EpochDay): EpochDay[] {
    const out: EpochDay[] = [];
    let monday = from - (isoWeekday(from) - 1);
    for (; monday <= to; monday += 7) {
        for (let d = monday; d < monday + 7; d += 1) {
            if (isWorkingDay(calendar, d)) {
                if (d >= from && d <= to) out.push(d);
                break;
            }
        }
    }
    return out;
}

/** The 95 % Wilson score interval of `held` successes in `n` trials. */
export function wilsonBand(held: number, n: number): [number, number] | null {
    if (n <= 0) return null;
    const z = 1.959963984540054;
    const p = held / n;
    const denom = 1 + (z * z) / n;
    const centre = (p + (z * z) / (2 * n)) / denom;
    const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
    return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** The completions per day as the record stood when `origin` began. */
export function seriesAsOfStartOf(spans: readonly DaySpan[], origin: EpochDay): Map<EpochDay, number> {
    const out = new Map<EpochDay, number>();
    for (const s of spans) {
        if (s.seenFrom <= origin && (s.seenUntil === null || s.seenUntil >= origin)) out.set(s.day, (out.get(s.day) ?? 0) + 1);
    }
    return out;
}

/** Run the back-test (see the module's header). */
export function backtest(input: BacktestInput): BacktestSizeResult[] {
    const current = input.spans
        .filter((s) => s.seenUntil === null)
        .map((s) => s.day)
        .sort((a, b) => a - b);
    const firstOrigin = Math.max(input.firstRecordedDay + 7 * input.weeks, input.originsFrom ?? -Infinity);
    const origins = weeklyOrigins(input.calendar, firstOrigin, input.today);
    const results: BacktestSizeResult[] = input.sizes.map((size) => ({
        size,
        origins: 0,
        refused: 0,
        scores: { p50: { scorable: 0, held: 0, band: null }, p85: { scorable: 0, held: 0, band: null }, p95: { scorable: 0, held: 0, band: null } },
        trace: [],
    }));

    let cursor = 0;
    for (const origin of origins) {
        // The current completions from the origin on, for the actual days.
        while (cursor < current.length && current[cursor]! < origin) cursor += 1;
        const window = historyWindow(origin, input.weeks, input.firstRecordedDay);
        if (!window) continue;
        const sample = dailySample(seriesAsOfStartOf(input.spans, origin), input.calendar, window.from, window.to);
        const maxDaily = sample.counts.reduce((m, c) => Math.max(m, c), 0);
        for (const result of results) {
            const actualIndex = cursor + result.size - 1;
            const actual = actualIndex < current.length ? current[actualIndex]! : null;
            // Nothing scorable when the actual is unknown and even the fastest forecast lies ahead.
            // (Its date is at least that many calendar days on; such an origin is left out unattempted.)
            if (actual === null && maxDaily > 0 && origin + Math.ceil(result.size / maxDaily) - 1 >= input.today) continue;
            result.origins += 1;
            const outcome = forecastCompletion({
                calendar: input.calendar,
                today: origin - 1,
                sample: sample.counts,
                remaining: result.size,
                sharePercent: 100,
                trials: input.trials,
                seed: forecastSeed({ scope: input.scopeKey, day: origin - 1, sample: sample.counts, remaining: result.size, share: 100, trials: input.trials }),
            });
            if (outcome.refused) {
                result.refused += 1;
                result.trace.push({ origin, likely: null, actual });
                continue;
            }
            result.trace.push({ origin, likely: outcome.likely, actual });
            for (const p of FORECAST_PERCENTILES) {
                const likely: LikelyDate = outcome.likely[`p${p}`];
                const score = result.scores[`p${p}`];
                if (actual !== null) {
                    score.scorable += 1;
                    if (!likely.beyond && actual <= likely.day) score.held += 1;
                } else if (!likely.beyond && likely.day < input.today) {
                    score.scorable += 1;
                }
            }
        }
    }
    for (const r of results) for (const p of FORECAST_PERCENTILES) r.scores[`p${p}`].band = wilsonBand(r.scores[`p${p}`].held, r.scores[`p${p}`].scorable);
    return results;
}

/** The scope's own record (decision 325): origins over the last 52 weeks … */
export const RECORD_WEEKS = 52;
/** … shown with at least 10 scorable origins of the 85th percentile … */
export const RECORD_MIN_SCORABLE = 10;
/** … each a forecast of 2,000 trials (a hit rate needs the percentile's day, not its last decimal). */
export const RECORD_TRIALS = 2_000;
/** The most items with a completion the record reads; above, it is not shown (the forecast still is). */
export const RECORD_COMPLETION_LIMIT = 20_000;

/**
 * The size of the record's earlier forecasts: the history's own completions
 * in which these items, at this share, are finished (`remaining × 100 /
 * share`, rounded up). Scoring needs the history's own completions, and a
 * forecast of `R` items at share `s` is the forecast of `R × 100 / s` of
 * them at the whole share.
 */
export function recordSize(remaining: number, sharePercent: number): number {
    return Math.max(1, Math.ceil((remaining * 100) / Math.max(1, sharePercent)));
}
