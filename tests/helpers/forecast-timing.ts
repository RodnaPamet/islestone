/**
 * Time the forecasting module in plain Node and print p50 and p95 as JSON
 * (tests/unit/domain/forecast-performance.test.ts runs it in its own
 * process: inside Jest's module sandbox, a `vm` context, V8 does not inline
 * `Math.imul`, and the 5.2 million draws run thirty times slower than they
 * do in the app or the browser). Each sample is the smaller of wall-clock
 * and processor time (#95).
 */
import { forecastCompletion, FORECAST_CAP_WORKING_DAYS, type ForecastInput } from '../../src/app-layer/domain/forecast/simulate';
import { compileCalendar, toEpochDay } from '../../src/app-layer/domain/schedule/calendar';

const calendar = compileCalendar({ id: 'c', workingWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-12-25', '2027-01-01', '2027-12-24'].map((d) => toEpochDay(d)) });
const today = toEpochDay('2026-11-27');

function timed(input: ForecastInput): { p50: number; p95: number; refused: string | null; trials: number } {
    const first = forecastCompletion(input);
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
    return { p50: times[Math.floor(times.length * 0.5)]!, p95: times[Math.ceil(times.length * 0.95) - 1]!, refused: first.refused?.reason ?? null, trials: first.trials };
}

const worst = timed({ calendar, today, sample: Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? 2 : i % 3 === 1 ? 1 : 0)), remaining: 2_000, sharePercent: 100, seed: 1 });
const typical = timed({ calendar, today, sample: Array.from({ length: 60 }, (_, i) => 3 + (i % 7)), remaining: 500, sharePercent: 100, seed: 2 });
process.stdout.write(JSON.stringify({ cap: FORECAST_CAP_WORKING_DAYS, worst, typical }));
