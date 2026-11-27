/**
 * The forecast's history and back-test (sub-phase 3.6c; owner decisions 318
 * and 325; Hardening H3): the window (ending yesterday, never before the
 * first record), the daily sample (non-working days folded forward, or back
 * at the window's end, nothing lost), completion spans against completion as
 * of a moment, the back-test never reading a row after its origin (a later
 * reopen changes no origin's forecast), its scoring and its calibration on a
 * stationary history.
 */
import fc from 'fast-check';
import type { WorkflowStateCategory } from '@prisma/client';

import { completionAsOf, completionSpans, daySpansOf, type SpanRow } from '@/app-layer/domain/analytics/completion';
import type { RecordFact } from '@/app-layer/domain/analytics/record';
import { backtest, recordSize, seriesAsOfStartOf, weeklyOrigins, wilsonBand, type DaySpan } from '@/app-layer/domain/forecast/backtest';
import { mulberry32 } from '@/app-layer/domain/forecast/rng';
import { dailySample, historyWindow } from '@/app-layer/domain/forecast/sample';
import { compileCalendar, isoWeekday, isWorkingDay, toEpochDay } from '@/app-layer/domain/schedule/calendar';

import { fuzzRuns } from '../../helpers/fuzz';

const monFri = (holidays: string[] = []) => compileCalendar({ id: 'c', workingWeekdays: [1, 2, 3, 4, 5], holidays: holidays.map((h) => toEpochDay(h)) });

describe('the history window (decision 318)', () => {
    const today = toEpochDay('2026-03-04');
    it('ends yesterday and runs back the chosen weeks', () => {
        expect(historyWindow(today, 12, toEpochDay('2025-01-01'))).toEqual({ from: today - 84, to: today - 1 });
    });
    it('never starts before the first recorded day, and is nothing without a record before today', () => {
        expect(historyWindow(today, 12, today - 10)).toEqual({ from: today - 10, to: today - 1 });
        expect(historyWindow(today, 12, today)).toBeNull();
        expect(historyWindow(today, 12, null)).toBeNull();
    });
});

describe('the daily sample (decision 318)', () => {
    const cal = monFri(['2026-03-03']);
    const from = toEpochDay('2026-02-27'); // a Friday
    const to = toEpochDay('2026-03-08'); // a Sunday
    it('has one count per working day, a weekend\'s completions on the next working day and the window\'s last weekend on its last working day', () => {
        const per = new Map([
            [toEpochDay('2026-02-28'), 2], // Saturday → Monday 2 March
            [toEpochDay('2026-03-03'), 1], // a holiday → Wednesday 4 March
            [toEpochDay('2026-03-07'), 4], // Saturday, nothing after in the window → Friday 6 March
            [toEpochDay('2026-03-09'), 9], // outside the window
        ]);
        const s = dailySample(per, cal, from, to);
        expect(s.days).toEqual(['2026-02-27', '2026-03-02', '2026-03-04', '2026-03-05', '2026-03-06'].map(toEpochDay));
        expect(s.counts).toEqual([0, 2, 1, 0, 4]);
        expect(s.completions).toBe(7);
    });
    it('loses no completion inside a window with a working day (property)', () => {
        fc.assert(
            fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 40 }), fc.integer({ min: 1, max: 5 })), { maxLength: 60 }), (pairs) => {
                const per = new Map<number, number>();
                for (const [off, c] of pairs) per.set(from + off, (per.get(from + off) ?? 0) + c);
                const end = from + 30;
                const s = dailySample(per, cal, from, end);
                const inWindow = [...per].filter(([d]) => d <= end).reduce((a, [, c]) => a + c, 0);
                expect(s.completions).toBe(inWindow);
                expect(s.counts.reduce((a, b) => a + b, 0)).toBe(inWindow);
                for (const d of s.days) expect(isWorkingDay(cal, d)).toBe(true);
            }),
            { numRuns: fuzzRuns() },
        );
    });
});

// ─── Completion spans ────────────────────────────────────────────────────

const CATEGORIES: WorkflowStateCategory[] = ['BACKLOG', 'UNSTARTED', 'STARTED', 'DONE', 'CANCELLED'];

describe('completion spans equal completion as of a moment (decision 311)', () => {
    it('agree at every reading moment on random histories (reopens, deletions, restores, ties)', () => {
        const rowArb = fc.record({ dt: fc.integer({ min: 0, max: 3 }), cat: fc.constantFrom(...CATEGORIES), deleted: fc.boolean(), inScope: fc.boolean() });
        fc.assert(
            fc.property(fc.array(rowArb, { minLength: 1, maxLength: 12 }), (spec) => {
                let t = 1_000;
                const facts: RecordFact[] = [];
                spec.forEach((r, i) => {
                    t += r.dt * 1000;
                    facts.push({ workItemId: 'w', projectId: r.inScope ? 'in' : 'out', teamId: 't', cycleId: null, stateCategory: r.cat, deleted: r.deleted, at: new Date(t), seq: i + 1 });
                });
                const rows: SpanRow[] = facts.map((f, i) => ({
                    at: f.at,
                    seq: f.seq,
                    stateCategory: f.stateCategory,
                    fromStateCategory: i === 0 ? null : facts[i - 1]!.stateCategory,
                    deleted: f.deleted,
                    inScope: f.projectId === 'in',
                }));
                const spans = completionSpans(rows);
                for (let r = 0; r <= t + 2000; r += 500) {
                    const c = completionAsOf(facts, r);
                    const expected = c && c.row.projectId === 'in' ? c.row.at.getTime() : null;
                    const holding = spans.filter((s) => s.from.getTime() <= r && (s.to === null || s.to.getTime() > r));
                    expect(holding.length).toBeLessThanOrEqual(1);
                    expect(holding[0]?.completedAt.getTime() ?? null).toBe(expected);
                }
            }),
            { numRuns: fuzzRuns() },
        );
    });
    it('count from the day after the row to the day of the closing row, midnight belonging to the day it begins', () => {
        const day = (ms: number) => Math.floor(ms / 86_400_000);
        const D = 86_400_000;
        const spans = daySpansOf(
            [
                { completedAt: new Date(10 * D + 5), from: new Date(10 * D + 5), to: new Date(12 * D) },
                { completedAt: new Date(20 * D), from: new Date(20 * D), to: null },
                { completedAt: new Date(30 * D + 1), from: new Date(30 * D + 1), to: new Date(30 * D + 9) }, // reopened the same day: never seen at a day's start
            ],
            (d) => day(d.getTime()),
        );
        expect(spans).toEqual([
            { day: 10, seenFrom: 11, seenUntil: 12 },
            { day: 20, seenFrom: 21, seenUntil: null },
        ]);
    });
});

// ─── The back-test ───────────────────────────────────────────────────────

/** A stationary history: each working day draws a count from `pool`, every completion still counting. */
function stationary(cal: ReturnType<typeof monFri>, from: number, to: number, pool: number[], seed: number): DaySpan[] {
    const rng = mulberry32(seed);
    const out: DaySpan[] = [];
    for (let d = from; d <= to; d += 1) {
        if (!isWorkingDay(cal, d)) continue;
        const c = pool[Math.floor(rng() * pool.length)]!;
        for (let k = 0; k < c; k += 1) out.push({ day: d, seenFrom: d + 1, seenUntil: null });
    }
    return out;
}

describe('the back-test (decision 325, H3)', () => {
    const cal = monFri();
    const first = toEpochDay('2025-01-06');
    const today = toEpochDay('2026-01-05');

    it('places origins on the first working day of each ISO week', () => {
        const o = weeklyOrigins(monFri(['2026-01-05']), toEpochDay('2025-12-29'), toEpochDay('2026-01-19'));
        expect(o).toEqual(['2025-12-29', '2026-01-06', '2026-01-12', '2026-01-19'].map(toEpochDay));
        for (const d of weeklyOrigins(cal, first, today)) expect(isoWeekday(d)).toBe(1);
    });

    it('reads the series as it stood when the origin began', () => {
        const spans: DaySpan[] = [
            { day: 10, seenFrom: 11, seenUntil: 14 }, // reopened on day 14
            { day: 12, seenFrom: 13, seenUntil: null },
        ];
        expect([...seriesAsOfStartOf(spans, 12)]).toEqual([[10, 1]]);
        expect([...seriesAsOfStartOf(spans, 14)].sort()).toEqual([
            [10, 1],
            [12, 1],
        ]);
        expect([...seriesAsOfStartOf(spans, 15)]).toEqual([[12, 1]]);
    });

    it('never sees a row after its origin: a later reopen changes no earlier origin\'s forecast', () => {
        const spans = stationary(cal, first, today, [0, 1, 2, 3, 4, 6], 3);
        const late = toEpochDay('2025-10-01');
        const base = { calendar: cal, firstRecordedDay: first, today, weeks: 12, sizes: [25], trials: 1_000, scopeKey: 's', originsFrom: undefined };
        // Reopen (end the counting of) every completion of the summer, from 1 October on.
        const reopened = spans.map((s) => (s.day < late && s.day > late - 60 ? { ...s, seenUntil: late } : s));
        const [before] = backtest({ ...base, spans });
        const [after] = backtest({ ...base, spans: reopened });
        // Every origin up to 1 October forecasts as it did; only the actuals, read as the record stands now, move.
        const upTo = (r: typeof before) => r!.trace.filter((x) => x.origin <= late).map((x) => [x.origin, x.likely]);
        expect(upTo(before).length).toBeGreaterThan(20);
        expect(upTo(after)).toEqual(upTo(before));
        expect(after!.trace.filter((x) => x.origin > late).map((x) => x.likely)).not.toEqual(before!.trace.filter((x) => x.origin > late).map((x) => x.likely));
    });

    it('scores a stationary history close to its percentiles (calibrated by construction)', () => {
        const spans = stationary(cal, first, today, [0, 1, 1, 2, 3, 3, 4, 5, 8], 11);
        const [r] = backtest({ calendar: cal, spans, firstRecordedDay: first, today, weeks: 12, sizes: [25], trials: 2_000, scopeKey: 'stationary' });
        expect(r!.refused).toBe(0);
        expect(r!.scores.p85.scorable).toBeGreaterThanOrEqual(30);
        const rate = r!.scores.p85.held / r!.scores.p85.scorable;
        expect(rate).toBeGreaterThan(0.65);
        expect(r!.scores.p50.held).toBeLessThanOrEqual(r!.scores.p85.held);
        expect(r!.scores.p85.held).toBeLessThanOrEqual(r!.scores.p95.held);
    });

    it('counts a passed date with no actual as a miss and leaves an unknown one out', () => {
        // Twenty working days of one a day, then nothing: a forecast of the next 10 from the last origins never resolves.
        const spans: DaySpan[] = [];
        for (let d = first; d < first + 120; d += 1) if (isWorkingDay(cal, d)) spans.push({ day: d, seenFrom: d + 1, seenUntil: null });
        const [r] = backtest({ calendar: cal, spans, firstRecordedDay: first, today: first + 200, weeks: 4, sizes: [10], trials: 500, scopeKey: 'k' });
        expect(r!.scores.p95.scorable).toBeGreaterThan(r!.scores.p95.held);
    });

    it('gives a Wilson band and the record\'s size', () => {
        expect(wilsonBand(0, 0)).toBeNull();
        const [lo, hi] = wilsonBand(85, 100)!;
        expect(lo).toBeCloseTo(0.767, 2);
        expect(hi).toBeCloseTo(0.907, 2);
        expect(recordSize(30, 100)).toBe(30);
        expect(recordSize(30, 25)).toBe(120);
        expect(recordSize(7, 75)).toBe(10);
    });
});
