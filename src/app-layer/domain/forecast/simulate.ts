/**
 * The forecast (sub-phase 3.6c; ADR 0014 §3 and §4; owner decisions 318 to
 * 324; docs/porting/maps/3.6.md, "The simulation"): Monte Carlo over a scope's
 * daily completions, giving the dates by which its remaining items are 50, 85
 * and 95 percent likely to be finished, and the chance of finishing by a due
 * date. Never "confidence" (ADR 0006): these are likely dates.
 *
 *   1. **Refusals first** (decision 319), each returning no date: nothing
 *      remaining; a share of 0; fewer than 20 completions in the window;
 *      fewer than 20 working days of recorded history. Below 50 completions
 *      the answer carries a caution.
 *   2. **The generator** is mulberry32 (`rng.ts`): each trial draws from its
 *      own stream, seeded by the input's seed and the trial's number
 *      (`trialSeed`), so the answer is monotone in its inputs for one seed.
 *   3. **Each trial** (10,000): for working day `d = 1, 2, …` of the scope's
 *      calendar after today, draw one day of the sample uniformly
 *      (`floor(rng() × n)`), take its count times the share and subtract it,
 *      in whole hundredths of an item (a 50 % share of 3 is 150), so no
 *      floating-point sum enters a count; the trial ends on the `d` at which
 *      nothing is left, or beyond the cap of 520 working days (about two
 *      years).
 *   4. **Percentiles** are nearest rank over the outcomes, counted per day
 *      (no sort). A percentile beyond the cap is "later than" the cap's date;
 *      a 50th beyond it refuses.
 *   5. **Dates**: outcome `d` is the `d`-th working day after today
 *      (`addWorkingDays(calendar, today + 1, d − 1)`), holidays ahead
 *      skipped (ADR 0010 §1).
 *   6. **The chance by a due date** is the share of trials finished on or
 *      before it; a due date of today or earlier has passed (the forecast's
 *      first day is tomorrow).
 *
 * Pure and client-safe: no database, clock, zone or environment; the same
 * inputs and seed give the same answer on every engine. Items only (decision
 * 320). Never stored, cached or logged (principle 4). The Monte Carlo shell
 * (N trials, outcomes counted, percentiles read out, a histogram and "chance
 * by this date", a refusal when there is nothing to forecast) is a pattern
 * learned from jira-auto-scheduler through its study (MIT, pattern only, no
 * code copied; PROVENANCE.md); the throughput sampler is written fresh.
 */
import { addWorkingDays, isoWeekday, nextWorkingDay, workingDaysInclusive, type CompiledCalendar, type EpochDay } from '../schedule/calendar';


export const FORECAST_TRIALS = 10_000;
/** The furthest a trial runs: 520 working days, about two years (decision 319). */
export const FORECAST_CAP_WORKING_DAYS = 520;
export const FORECAST_MIN_COMPLETIONS = 20;
export const FORECAST_MIN_WORKING_DAYS = 20;
/** Below this many completions the answer carries "Based on few items; the range is wide." */
export const FORECAST_CAUTION_COMPLETIONS = 50;
/** The shares of the history's throughput a person may assume, in percent (decision 322). */
export const FORECAST_SHARES = [25, 50, 75, 100] as const;
export const FORECAST_PERCENTILES = [50, 85, 95] as const;
export type ForecastPercentile = (typeof FORECAST_PERCENTILES)[number];
/** Past this many calendar days from first to last finishing date the histogram counts by ISO week. */
export const FORECAST_DAILY_HISTOGRAM_DAYS = 92;

export interface ForecastInput {
    calendar: CompiledCalendar;
    /** The day the forecast is read on: trials begin on the first working day after it. */
    today: EpochDay;
    /** The daily completions of each working day of the history (`sample.ts`), in date order. */
    sample: readonly number[];
    /** The open items left to finish. */
    remaining: number;
    /** The share of the history's throughput these items receive, a whole percent 0 to 100. */
    sharePercent: number;
    seed: number;
    /** 10,000 unless a caller (a test, the back-test) names another. */
    trials?: number;
    /** The scope's due date, when it has one. */
    dueDate?: EpochDay | null;
}

export type ForecastRefusal =
    | { reason: 'NOTHING_REMAINING' }
    | { reason: 'NO_SHARE' }
    | { reason: 'TOO_FEW_COMPLETIONS'; completions: number; needed: number }
    | { reason: 'TOO_FEW_WORKING_DAYS'; workingDays: number; needed: number }
    | { reason: 'BEYOND_TWO_YEARS'; completions: number; capDay: EpochDay };

export type ForecastCaution = 'FEW_COMPLETIONS';

/** A likely date: the day, or (`beyond`) later than the cap's day. */
export interface LikelyDate {
    day: EpochDay;
    beyond: boolean;
}

export interface ForecastDistribution {
    /** `days[i]` is working day `i + 1` after today. */
    days: EpochDay[];
    /** `finishing[i]` trials finished on `days[i]`; as long as the latest outcome within the cap. */
    finishing: number[];
    /** Trials not finished within the cap. */
    beyond: number;
    /** The cap's day: working day 520. */
    capDay: EpochDay;
}

interface Common {
    trials: number;
    seed: number;
    completions: number;
    workingDays: number;
    remaining: number;
    sharePercent: number;
}

export type ForecastOutcome =
    | (Common & { refused: ForecastRefusal })
    | (Common & {
          refused: null;
          likely: Record<`p${ForecastPercentile}`, LikelyDate>;
          /** Trials finished on or before the due date; `passed` when it is today or earlier; null with none. */
          due: { day: EpochDay; finished: number; passed: false } | { day: EpochDay; finished: null; passed: true } | null;
          distribution: ForecastDistribution;
          cautions: ForecastCaution[];
      });

/**
 * Trial `t`'s seed: murmur3's 32-bit finaliser over the forecast's seed plus
 * `t` golden-ratio steps, so the trials' streams start far apart in
 * mulberry32's sequence.
 */
export function trialSeed(seed: number, t: number): number {
    let h = (seed + Math.imul(t, 0x9e3779b9)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
}

/** The nearest-rank position of the `p`-th percentile among `n` outcomes: `ceil(p × n / 100)`, at least 1. */
export function nearestRankPosition(p: number, n: number): number {
    return Math.max(1, Math.floor((p * n + 99) / 100));
}

function checkInput(input: ForecastInput, trials: number): void {
    if (!Number.isInteger(input.remaining) || input.remaining < 0) throw new RangeError('forecastCompletion: remaining must be a whole number of at least 0');
    if (!Number.isInteger(input.sharePercent) || input.sharePercent < 0 || input.sharePercent > 100) throw new RangeError('forecastCompletion: sharePercent must be a whole number from 0 to 100');
    if (!Number.isInteger(trials) || trials < 1) throw new RangeError('forecastCompletion: trials must be a whole number of at least 1');
    for (const c of input.sample) if (!Number.isInteger(c) || c < 0) throw new RangeError('forecastCompletion: the sample holds whole counts of at least 0');
}

/** Run the forecast (see the module's header). */
export function forecastCompletion(input: ForecastInput): ForecastOutcome {
    const trials = input.trials ?? FORECAST_TRIALS;
    checkInput(input, trials);
    const completions = input.sample.reduce((s, c) => s + c, 0);
    const workingDays = input.sample.length;
    const common: Common = { trials, seed: input.seed >>> 0, completions, workingDays, remaining: input.remaining, sharePercent: input.sharePercent };

    if (input.remaining === 0) return { ...common, refused: { reason: 'NOTHING_REMAINING' } };
    if (input.sharePercent === 0) return { ...common, refused: { reason: 'NO_SHARE' } };
    if (completions < FORECAST_MIN_COMPLETIONS) return { ...common, refused: { reason: 'TOO_FEW_COMPLETIONS', completions, needed: FORECAST_MIN_COMPLETIONS } };
    if (workingDays < FORECAST_MIN_WORKING_DAYS) return { ...common, refused: { reason: 'TOO_FEW_WORKING_DAYS', workingDays, needed: FORECAST_MIN_WORKING_DAYS } };

    // Counts in hundredths of an item: integers throughout.
    const scaled = Int32Array.from(input.sample, (c) => c * input.sharePercent);
    const n = scaled.length;
    const target = input.remaining * 100;
    const counts = new Int32Array(FORECAST_CAP_WORKING_DAYS + 1);
    let beyond = 0;
    for (let t = 0; t < trials; t += 1) {
        // Each trial its own stream, so one trial's draws never depend on how many another made: with one
        // seed, more remaining items never finish earlier and a larger count never finishes later. The
        // stream is mulberry32 (`rng.ts`) written inline: a closure per trial costs more than the draws.
        let a = trialSeed(common.seed, t);
        let left = target;
        let d = 0;
        while (d < FORECAST_CAP_WORKING_DAYS) {
            d += 1;
            a = (a + 0x6d2b79f5) | 0;
            let x = Math.imul(a ^ (a >>> 15), 1 | a);
            x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
            left -= scaled[Math.floor((((x ^ (x >>> 14)) >>> 0) / 4294967296) * n)]!;
            if (left <= 0) break;
        }
        if (left <= 0) counts[d] = counts[d]! + 1;
        else beyond += 1;
    }

    let latest = 0;
    for (let d = FORECAST_CAP_WORKING_DAYS; d >= 1; d -= 1) {
        if (counts[d]! > 0) {
            latest = d;
            break;
        }
    }
    const days: EpochDay[] = [];
    let day = nextWorkingDay(input.calendar, input.today + 1);
    for (let d = 1; d <= latest; d += 1) {
        days.push(day);
        day = nextWorkingDay(input.calendar, day + 1);
    }
    const capDay = addWorkingDays(input.calendar, input.today + 1, FORECAST_CAP_WORKING_DAYS - 1);

    const percentile = (p: number): LikelyDate => {
        const rank = nearestRankPosition(p, trials);
        let seen = 0;
        for (let d = 1; d <= FORECAST_CAP_WORKING_DAYS; d += 1) {
            seen += counts[d]!;
            if (seen >= rank) return { day: days[d - 1]!, beyond: false };
        }
        return { day: capDay, beyond: true };
    };
    const likely = { p50: percentile(50), p85: percentile(85), p95: percentile(95) };
    if (likely.p50.beyond) return { ...common, refused: { reason: 'BEYOND_TWO_YEARS', completions, capDay } };

    let due: Extract<ForecastOutcome, { refused: null }>['due'] = null;
    if (input.dueDate !== undefined && input.dueDate !== null) {
        if (input.dueDate <= input.today) due = { day: input.dueDate, finished: null, passed: true };
        else {
            const k = Math.min(FORECAST_CAP_WORKING_DAYS, workingDaysInclusive(input.calendar, input.today + 1, input.dueDate));
            let finished = 0;
            for (let d = 1; d <= k; d += 1) finished += counts[d]!;
            due = { day: input.dueDate, finished, passed: false };
        }
    }

    return {
        ...common,
        refused: null,
        likely,
        due,
        distribution: { days, finishing: Array.from(counts.subarray(1, latest + 1)), beyond, capDay },
        cautions: completions < FORECAST_CAUTION_COMPLETIONS ? ['FEW_COMPLETIONS'] : [],
    };
}

export interface HistogramBucket {
    /** The bucket's first day and last day, inclusive (one working day, or an ISO week cut to the outcomes). */
    start: EpochDay;
    end: EpochDay;
    trials: number;
}

/**
 * The distribution as a histogram: one bucket per working day from the first
 * finishing day to the last, or, when they lie more than 92 days apart, one
 * per ISO week (Monday to Sunday). Trials beyond the cap are not a bucket.
 */
export function histogramOf(dist: ForecastDistribution): { resolution: 'day' | 'week'; buckets: HistogramBucket[] } {
    const first = dist.finishing.findIndex((c) => c > 0);
    if (first < 0) return { resolution: 'day', buckets: [] };
    const days = dist.days.slice(first);
    const finishing = dist.finishing.slice(first);
    const span = days[days.length - 1]! - days[0]!;
    if (span <= FORECAST_DAILY_HISTOGRAM_DAYS) {
        return { resolution: 'day', buckets: days.map((d, i) => ({ start: d, end: d, trials: finishing[i]! })) };
    }
    const buckets: HistogramBucket[] = [];
    for (let i = 0; i < days.length; i += 1) {
        const d = days[i]!;
        const monday = d - (isoWeekday(d) - 1);
        const last = buckets[buckets.length - 1];
        if (last && last.start - (isoWeekday(last.start) - 1) === monday) {
            last.end = d;
            last.trials += finishing[i]!;
        } else buckets.push({ start: d, end: d, trials: finishing[i]! });
    }
    return { resolution: 'week', buckets };
}

/** "Chance finished by": for each working day of the distribution, the trials finished on or before it. */
export function chanceCurveOf(dist: ForecastDistribution): Array<{ day: EpochDay; finished: number }> {
    const out: Array<{ day: EpochDay; finished: number }> = [];
    let seen = 0;
    for (let i = 0; i < dist.days.length; i += 1) {
        seen += dist.finishing[i]!;
        out.push({ day: dist.days[i]!, finished: seen });
    }
    return out;
}
