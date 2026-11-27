/**
 * The forecasting module of sub-phase 3.6c (`src/app-layer/domain/forecast/`;
 * owner decisions 318 to 323; ADR 0014 §3 and §4; Hardening H3): mulberry32
 * and the derived seed, the refusals (no date ever below a minimum, the
 * sentence's counts named), determinism (byte-equal answers for equal
 * inputs), monotonicity (more remaining never earlier, more completions never
 * later, p50 ≤ p85 ≤ p95, the chance by a due date never falls as it moves
 * later), nearest-rank percentiles against a sorted reference, dates through
 * the calendar, integer hundredths for a share, and the histogram and curve.
 */
import fc from 'fast-check';

import { mulberry32 } from '@/app-layer/domain/forecast/rng';
import { canonicalJson, fnv1a32, forecastSeed } from '@/app-layer/domain/forecast/seed';
import {
    chanceCurveOf,
    forecastCompletion,
    histogramOf,
    nearestRankPosition,
    trialSeed,
    FORECAST_CAP_WORKING_DAYS,
    FORECAST_DAILY_HISTOGRAM_DAYS,
    type ForecastInput,
    type ForecastOutcome,
} from '@/app-layer/domain/forecast/simulate';
import { addWorkingDays, compileCalendar, isWorkingDay, toEpochDay, workingDaysInclusive } from '@/app-layer/domain/schedule/calendar';

import { fuzzRuns } from '../../helpers/fuzz';

const monFri = (holidays: string[] = []) => compileCalendar({ id: 'c', workingWeekdays: [1, 2, 3, 4, 5], holidays: holidays.map((h) => toEpochDay(h)) });
const TODAY = toEpochDay('2026-03-04'); // a Wednesday

function input(over: Partial<ForecastInput> = {}): ForecastInput {
    return { calendar: monFri(), today: TODAY, sample: Array.from({ length: 40 }, (_, i) => [0, 1, 2, 3, 5][i % 5]!), remaining: 30, sharePercent: 100, seed: 7, trials: 2_000, ...over };
}

function dated(o: ForecastOutcome): Extract<ForecastOutcome, { refused: null }> {
    if (o.refused) throw new Error(`refused: ${o.refused.reason}`);
    return o;
}

/** A history with at least the minimum: 20 working days or more, 20 completions or more. */
const histories = fc
    .array(fc.integer({ min: 0, max: 9 }), { minLength: 20, maxLength: 120 })
    .filter((s) => s.reduce((a, b) => a + b, 0) >= 20);

describe('mulberry32 (copied from inflect-compliance)', () => {
    it('gives the stream inflect-compliance\'s seededRng gives', () => {
        const rng = mulberry32(42);
        const first = [rng(), rng(), rng()];
        // Computed with inflect-compliance's src/lib/fair-math.ts seededRng(42) at 5528464.
        expect(first.map((x) => x.toFixed(10))).toEqual(['0.6011037519', '0.4482905590', '0.8524657935']);
    });
    it('stays in [0, 1) and repeats for a seed', () => {
        const a = mulberry32(123);
        const b = mulberry32(123);
        for (let i = 0; i < 1000; i += 1) {
            const x = a();
            expect(x).toBe(b());
            expect(x >= 0 && x < 1).toBe(true);
        }
    });
});

describe('each trial draws from its own mulberry32 stream', () => {
    /** The trial loop written plainly over `rng.ts`: what the module's inline stream must equal. */
    function reference(i: ForecastInput): { counts: number[]; beyond: number } {
        const counts = new Array<number>(FORECAST_CAP_WORKING_DAYS + 1).fill(0);
        let beyond = 0;
        for (let t = 0; t < (i.trials ?? 10_000); t += 1) {
            const rng = mulberry32(trialSeed(i.seed, t));
            let left = i.remaining * 100;
            let d = 0;
            while (d < FORECAST_CAP_WORKING_DAYS && left > 0) {
                d += 1;
                left -= i.sample[Math.floor(rng() * i.sample.length)]! * i.sharePercent;
            }
            if (left <= 0) counts[d] = counts[d]! + 1;
            else beyond += 1;
        }
        return { counts, beyond };
    }
    it('equals the plain loop over mulberry32(trialSeed(seed, t))', () => {
        for (const over of [{}, { sharePercent: 75, remaining: 41, seed: 99 }, { sample: [0, 0, 1, 7, 2, 0, 0, 3, 1, 1, 0, 2, 2, 0, 5, 0, 0, 1, 1, 0] }]) {
            const i = input({ ...over, trials: 1_500 });
            const o = dated(forecastCompletion(i));
            const ref = reference(i);
            expect(o.distribution.beyond).toBe(ref.beyond);
            expect(o.distribution.finishing).toEqual(ref.counts.slice(1, o.distribution.finishing.length + 1));
            expect(ref.counts.slice(o.distribution.finishing.length + 1).every((c) => c === 0)).toBe(true);
        }
    });
    it('gives trials seeds far apart', () => {
        const seeds = new Set(Array.from({ length: 10_000 }, (_, t) => trialSeed(7, t)));
        expect(seeds.size).toBe(10_000);
    });
});

describe('the derived seed (decision 323)', () => {
    it('is FNV-1a over canonical JSON, whatever order the keys were written in', () => {
        expect(fnv1a32('')).toBe(0x811c9dc5);
        expect(fnv1a32('a')).toBe(0xe40c292c);
        expect(canonicalJson({ b: 1, a: [2, { d: true, c: 'x' }] })).toBe('{"a":[2,{"c":"x","d":true}],"b":1}');
        const one = forecastSeed({ scope: { projectId: 'p', teamId: 't' }, day: TODAY, sample: [1, 2], remaining: 3, share: 100, trials: 10_000 });
        const two = forecastSeed({ trials: 10_000, share: 100, remaining: 3, sample: [1, 2], day: TODAY, scope: { teamId: 't', projectId: 'p' } });
        expect(one).toBe(two);
    });
    it('changes with every input', () => {
        const base = { scope: 's', day: TODAY, sample: [1, 2, 3], remaining: 5, share: 100, trials: 10_000 };
        const s = forecastSeed(base);
        for (const change of [{ scope: 't' }, { day: TODAY + 1 }, { sample: [1, 2, 4] }, { remaining: 6 }, { share: 50 }, { trials: 2_000 }]) {
            expect(forecastSeed({ ...base, ...change })).not.toBe(s);
        }
    });
});

describe('refusals first (decision 319): never a date below the minimums', () => {
    it('refuses nothing remaining, a share of 0, too few completions and too few working days, naming the counts', () => {
        expect(forecastCompletion(input({ remaining: 0 })).refused).toEqual({ reason: 'NOTHING_REMAINING' });
        expect(forecastCompletion(input({ sharePercent: 0 })).refused).toEqual({ reason: 'NO_SHARE' });
        expect(forecastCompletion(input({ sample: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0] .map((c, i) => (i < 12 ? c : 0)) })).refused).toEqual({
            reason: 'TOO_FEW_COMPLETIONS',
            completions: 12,
            needed: 20,
        });
        expect(forecastCompletion(input({ sample: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5] })).refused).toEqual({ reason: 'TOO_FEW_WORKING_DAYS', workingDays: 11, needed: 20 });
    });
    it('refuses a 50th percentile past two years, with the cap\'s day', () => {
        const sample = Array.from({ length: 60 }, (_, i) => (i < 20 ? 1 : 0));
        const o = forecastCompletion(input({ sample, remaining: 2_000 }));
        expect(o.refused).toEqual({ reason: 'BEYOND_TWO_YEARS', completions: 20, capDay: addWorkingDays(monFri(), TODAY + 1, FORECAST_CAP_WORKING_DAYS - 1) });
    });
    it('cautions under 50 completions and not from 50', () => {
        expect(dated(forecastCompletion(input({ sample: Array.from({ length: 49 }, () => 1) }))).cautions).toEqual(['FEW_COMPLETIONS']);
        expect(dated(forecastCompletion(input({ sample: Array.from({ length: 50 }, () => 1) }))).cautions).toEqual([]);
    });
    it('never returns a date for a history below either minimum (property)', () => {
        const thin = fc.oneof(
            fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 0, maxLength: 19 }),
            fc.array(fc.integer({ min: 0, max: 1 }), { minLength: 20, maxLength: 200 }).filter((s) => s.reduce((a, b) => a + b, 0) < 20),
        );
        fc.assert(
            fc.property(thin, fc.integer({ min: 1, max: 500 }), fc.integer({ min: 0, max: 2 ** 32 - 1 }), (sample, remaining, seed) => {
                const o = forecastCompletion(input({ sample, remaining, seed, trials: 200 }));
                expect(o.refused).not.toBeNull();
                expect('likely' in o).toBe(false);
                const r = o.refused!;
                if (r.reason === 'TOO_FEW_COMPLETIONS') expect(r.completions).toBe(sample.reduce((a, b) => a + b, 0));
                else expect(r).toEqual({ reason: 'TOO_FEW_WORKING_DAYS', workingDays: sample.length, needed: 20 });
            }),
            { numRuns: fuzzRuns() },
        );
    });
});

describe('determinism (H3: same seed, same forecast)', () => {
    it('gives byte-equal answers for equal inputs', () => {
        fc.assert(
            fc.property(histories, fc.integer({ min: 1, max: 300 }), fc.integer({ min: 0, max: 2 ** 32 - 1 }), (sample, remaining, seed) => {
                const a = forecastCompletion(input({ sample, remaining, seed, trials: 300 }));
                const b = forecastCompletion(input({ sample: [...sample], remaining, seed, trials: 300 }));
                expect(JSON.stringify(a)).toBe(JSON.stringify(b));
            }),
            { numRuns: fuzzRuns(0.5) },
        );
    });
    it('keeps every percentile within the sampling error for another seed', () => {
        const a = dated(forecastCompletion(input({ seed: 1, trials: 10_000 })));
        const b = dated(forecastCompletion(input({ seed: 2, trials: 10_000 })));
        // 10,000 trials put a percentile within a working day or two of another draw's (the spread here is about two weeks).
        for (const p of ['p50', 'p85', 'p95'] as const) expect(Math.abs(workingDaysInclusive(monFri(), Math.min(a.likely[p].day, b.likely[p].day), Math.max(a.likely[p].day, b.likely[p].day)) - 1)).toBeLessThanOrEqual(2);
    });
});

describe('monotonicity (H3)', () => {
    it('p50 ≤ p85 ≤ p95, and every date a working day after today', () => {
        fc.assert(
            fc.property(histories, fc.integer({ min: 1, max: 400 }), fc.integer({ min: 0, max: 2 ** 32 - 1 }), (sample, remaining, seed) => {
                const o = forecastCompletion(input({ sample, remaining, seed, trials: 300 }));
                if (o.refused) return;
                const { p50, p85, p95 } = o.likely;
                expect(p50.day <= p85.day && p85.day <= p95.day).toBe(true);
                for (const p of [p50, p85, p95]) {
                    expect(p.day).toBeGreaterThan(TODAY);
                    expect(isWorkingDay(monFri(), p.day)).toBe(true);
                }
            }),
            { numRuns: fuzzRuns(0.5) },
        );
    });
    it('more remaining items never give an earlier date, with one seed', () => {
        fc.assert(
            fc.property(histories, fc.integer({ min: 1, max: 200 }), fc.integer({ min: 1, max: 100 }), fc.integer({ min: 0, max: 2 ** 32 - 1 }), (sample, remaining, more, seed) => {
                const a = forecastCompletion(input({ sample, remaining, seed, trials: 300 }));
                const b = forecastCompletion(input({ sample, remaining: remaining + more, seed, trials: 300 }));
                if (a.refused || b.refused) return;
                for (const p of ['p50', 'p85', 'p95'] as const) expect(b.likely[p].day).toBeGreaterThanOrEqual(a.likely[p].day);
            }),
            { numRuns: fuzzRuns(0.5) },
        );
    });
    it('a larger count on every sampled day never gives a later date, with one seed', () => {
        fc.assert(
            fc.property(histories, fc.integer({ min: 1, max: 300 }), fc.integer({ min: 1, max: 5 }), fc.integer({ min: 0, max: 2 ** 32 - 1 }), (sample, remaining, plus, seed) => {
                const a = forecastCompletion(input({ sample, remaining, seed, trials: 300 }));
                const b = forecastCompletion(input({ sample: sample.map((c) => c + plus), remaining, seed, trials: 300 }));
                if (a.refused) return;
                const bd = dated(b);
                for (const p of ['p50', 'p85', 'p95'] as const) expect(bd.likely[p].day).toBeLessThanOrEqual(a.likely[p].day);
            }),
            { numRuns: fuzzRuns(0.5) },
        );
    });
    it('the chance by a due date never falls as the due date moves later', () => {
        const days = Array.from({ length: 80 }, (_, i) => TODAY - 2 + i);
        let previous = -1;
        for (const due of days) {
            const o = dated(forecastCompletion(input({ dueDate: due, trials: 3_000 })));
            if (due <= TODAY) {
                expect(o.due).toEqual({ day: due, finished: null, passed: true });
                continue;
            }
            expect(o.due!.passed).toBe(false);
            expect(o.due!.finished!).toBeGreaterThanOrEqual(previous);
            previous = o.due!.finished!;
        }
        expect(previous).toBe(3_000);
    });
});

describe('percentiles, dates and the distribution', () => {
    it('read the nearest rank of the outcomes, as a sort would', () => {
        expect(nearestRankPosition(50, 10_000)).toBe(5_000);
        expect(nearestRankPosition(85, 20)).toBe(17);
        expect(nearestRankPosition(95, 1)).toBe(1);
        fc.assert(
            fc.property(histories, fc.integer({ min: 1, max: 200 }), fc.integer({ min: 0, max: 2 ** 32 - 1 }), (sample, remaining, seed) => {
                const o = forecastCompletion(input({ sample, remaining, seed, trials: 301 }));
                if (o.refused) return;
                const outcomes: number[] = [];
                o.distribution.finishing.forEach((c, i) => {
                    for (let k = 0; k < c; k += 1) outcomes.push(o.distribution.days[i]!);
                });
                for (let k = 0; k < o.distribution.beyond; k += 1) outcomes.push(Number.MAX_SAFE_INTEGER);
                expect(outcomes).toHaveLength(301);
                outcomes.sort((x, y) => x - y);
                for (const p of [50, 85, 95] as const) {
                    const v = outcomes[Math.ceil((p * 301) / 100) - 1]!;
                    const likely = o.likely[`p${p}`];
                    expect(likely.beyond ? Number.MAX_SAFE_INTEGER : likely.day).toBe(v);
                }
            }),
            { numRuns: fuzzRuns(0.5) },
        );
    });
    it('turn working day d into the d-th working day after today, holidays ahead skipped', () => {
        const cal = monFri(['2026-03-06', '2026-03-09']);
        const o = dated(forecastCompletion(input({ calendar: cal, trials: 500 })));
        o.distribution.days.forEach((day, i) => expect(day).toBe(addWorkingDays(cal, TODAY + 1, i)));
        expect(o.distribution.days[1]).toBe(toEpochDay('2026-03-10')); // Thu 5th, then past Fri 6th, the weekend and Mon 9th
    });
    it('count a share in whole hundredths of an item: half of three is one and a half', () => {
        // Every day finishes 3; at 50 % that is 150 hundredths a day, so 3 items take 2 days and 4 take 3.
        const flat = Array.from({ length: 20 }, () => 3);
        expect(dated(forecastCompletion(input({ sample: flat, remaining: 3, sharePercent: 50 }))).likely.p95.day).toBe(addWorkingDays(monFri(), TODAY + 1, 1));
        expect(dated(forecastCompletion(input({ sample: flat, remaining: 4, sharePercent: 50 }))).likely.p50.day).toBe(addWorkingDays(monFri(), TODAY + 1, 2));
    });
    it('shows a percentile past the cap as later than the cap\'s day', () => {
        // One day in 200 finishes 20: two such days in 520 are likely (the 50th within the cap), three are not.
        const sample = Array.from({ length: 200 }, (_, i) => (i === 0 ? 20 : 0));
        const o = dated(forecastCompletion(input({ sample, remaining: 40, trials: 2_000 })));
        expect(o.likely.p95.beyond).toBe(true);
        expect(o.likely.p95.day).toBe(o.distribution.capDay);
        expect(o.distribution.beyond).toBeGreaterThan(0);
    });
    it('draws a histogram per working day, by ISO week past 92 days, and a curve that ends at the finished trials', () => {
        const o = dated(forecastCompletion(input({ trials: 2_000 })));
        const daily = histogramOf(o.distribution);
        expect(daily.resolution).toBe('day');
        expect(daily.buckets.reduce((s, b) => s + b.trials, 0)).toBe(2_000 - o.distribution.beyond);
        const curve = chanceCurveOf(o.distribution);
        expect(curve.at(-1)!.finished).toBe(2_000 - o.distribution.beyond);
        for (let i = 1; i < curve.length; i += 1) expect(curve[i]!.finished).toBeGreaterThanOrEqual(curve[i - 1]!.finished);

        const slow = dated(forecastCompletion(input({ sample: Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 1 : 0)), remaining: 60, trials: 2_000 })));
        const weekly = histogramOf(slow.distribution);
        expect(weekly.resolution).toBe('week');
        const first = slow.distribution.days[slow.distribution.finishing.findIndex((c) => c > 0)]!;
        expect(slow.distribution.days.at(-1)! - first).toBeGreaterThan(FORECAST_DAILY_HISTOGRAM_DAYS);
        expect(weekly.buckets.reduce((s, b) => s + b.trials, 0)).toBe(2_000 - slow.distribution.beyond);
        for (const b of weekly.buckets) expect(b.end - b.start).toBeLessThan(7);
    });
});
