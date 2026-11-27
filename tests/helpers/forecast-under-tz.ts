/**
 * Run the forecasting module on fixed inputs and print its answers as JSON
 * (tests/unit/domain/forecast-timezones.test.ts runs it under several `TZ`
 * values, each in its own process, so the zone is set before any module
 * loads): a forecast with a due date, its histogram and curve, and a
 * back-test over a fixed history.
 */
import { backtest, type DaySpan } from '../../src/app-layer/domain/forecast/backtest';
import { mulberry32 } from '../../src/app-layer/domain/forecast/rng';
import { forecastSeed } from '../../src/app-layer/domain/forecast/seed';
import { chanceCurveOf, forecastCompletion, histogramOf } from '../../src/app-layer/domain/forecast/simulate';
import { compileCalendar, isWorkingDay, toEpochDay } from '../../src/app-layer/domain/schedule/calendar';

const calendar = compileCalendar({ id: 'c', workingWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-12-25', '2027-01-01'].map((d) => toEpochDay(d)) });
const today = toEpochDay('2026-11-27');
const sample = Array.from({ length: 60 }, (_, i) => [0, 1, 2, 3, 5, 8][(i * 7) % 6]!);
const seed = forecastSeed({ scope: { projectId: 'p' }, day: today, sample, remaining: 120, share: 75, trials: 10_000 });
const outcome = forecastCompletion({ calendar, today, sample, remaining: 120, sharePercent: 75, seed, dueDate: toEpochDay('2027-02-15') });
const dist = outcome.refused ? null : outcome.distribution;

const rng = mulberry32(5);
const spans: DaySpan[] = [];
for (let d = toEpochDay('2026-01-05'); d < today; d += 1) {
    if (!isWorkingDay(calendar, d)) continue;
    const c = Math.floor(rng() * 6);
    for (let k = 0; k < c; k += 1) spans.push({ day: d, seenFrom: d + 1, seenUntil: rng() < 0.05 ? d + 20 : null });
}
const record = backtest({ calendar, spans, firstRecordedDay: toEpochDay('2026-01-05'), today, weeks: 12, sizes: [10, 25], trials: 500, scopeKey: 'tz' });

process.stdout.write(
    JSON.stringify({
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        result: { seed, outcome, histogram: dist ? histogramOf(dist) : null, curve: dist ? chanceCurveOf(dist) : null, record },
    }),
);
