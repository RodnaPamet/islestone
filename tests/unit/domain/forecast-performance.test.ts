/**
 * The forecasting module at its worst case (sub-phase 3.6c;
 * docs/porting/maps/3.6.md, "Performance of the module"): 10,000 trials over
 * 2,000 remaining items at about one completion a day, every trial running
 * to the 520-day cap (5.2 million draws). The budget is p95 150 ms in Node,
 * and the typical case (500 remaining, six a day) 20 ms; a test runner shares
 * its machine, so this test fails only at four times each budget, takes each
 * sample as the smaller of wall-clock and processor time (#95, as the
 * engine's and the workload modules' performance tests do), and logs the
 * measure. Jest's sandbox is itself a test: a global read in the trial loop
 * (`Math.imul`) costs twenty times as much there, which this budget catches.
 */
import { forecastCompletion, FORECAST_CAP_WORKING_DAYS, type ForecastInput } from '@/app-layer/domain/forecast/simulate';
import { compileCalendar, toEpochDay } from '@/app-layer/domain/schedule/calendar';

const calendar = compileCalendar({ id: 'c', workingWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-12-25', '2027-01-01', '2027-12-24'].map((d) => toEpochDay(d)) });
const today = toEpochDay('2026-11-27');

function timed(input: ForecastInput): { p50: number; p95: number } {
    for (let k = 0; k < 3; k += 1) forecastCompletion(input);
    const times: number[] = [];
    for (let k = 0; k < 20; k += 1) {
        const cpu0 = process.cpuUsage();
        const t0 = performance.now();
        forecastCompletion(input);
        const wall = performance.now() - t0;
        const cpu = process.cpuUsage(cpu0);
        times.push(Math.min(wall, (cpu.user + cpu.system) / 1000));
    }
    times.sort((a, b) => a - b);
    return { p50: times[Math.floor(times.length * 0.5)]!, p95: times[Math.ceil(times.length * 0.95) - 1]! };
}

describe('the forecast at its worst and typical cases', () => {
    it('runs 10,000 trials to the cap within four times its 150 ms budget at p95', () => {
        const input = { calendar, today, sample: Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? 2 : i % 3 === 1 ? 1 : 0)), remaining: 2_000, sharePercent: 100, seed: 1 };
        const outcome = forecastCompletion(input);
        // Every trial reached the cap: the work measured is the whole 5.2 million draws.
        expect(outcome.refused).toEqual(expect.objectContaining({ reason: 'BEYOND_TWO_YEARS' }));
        expect(FORECAST_CAP_WORKING_DAYS * outcome.trials).toBe(5_200_000);
        const { p50, p95 } = timed(input);
        console.log(`forecast worst case: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
        expect(p95).toBeLessThan(150 * 4);
    }, 60_000);

    it('answers the typical case within four times its 20 ms budget at p95', () => {
        const input = { calendar, today, sample: Array.from({ length: 60 }, (_, i) => 3 + (i % 7)), remaining: 500, sharePercent: 100, seed: 2 };
        expect(forecastCompletion(input).refused).toBeNull();
        const { p50, p95 } = timed(input);
        console.log(`forecast typical case: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
        expect(p95).toBeLessThan(20 * 4);
    }, 60_000);
});
