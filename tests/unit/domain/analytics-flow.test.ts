/**
 * The event sweep (`src/app-layer/domain/analytics/flow.ts`, sub-phase 3.6a):
 * 2.5a's per-day scan kept here as the oracle (the burn-up re-expressed over
 * the sweep must give the same series on random histories, in five zones and
 * under every measure), cumulative flow's Done counted from the window's
 * start, the scope judged by each row's recorded fields (a moved item counts
 * in each project for its time there), and rows after the moment of reading
 * never read.
 */
import fc from 'fast-check';
import type { WorkflowStateCategory } from '@prisma/client';

import { burnUp, type BurnUpMeasure, type BurnUpPoint, type TransitionFact } from '@/app-layer/domain/burn-up';
import { cumulativeFlowOf, flowSweep } from '@/app-layer/domain/analytics/flow';
import { startOfDayInTz } from '@/app-layer/domain/analytics/zone';
import type { RecordFact } from '@/app-layer/domain/analytics/record';
import { addDays, dayKey, daysBetween, fromDayKey } from '@/app-layer/domain/cycle';
import { toEpochDay } from '@/app-layer/domain/schedule/calendar';

/** 2.5a's and 3.4a's per-day scan, verbatim but for its imports: the oracle. */
function oracleBurnUp(input: { cycleId: string; startsOn: Date; endsOn: Date; today: Date; now: Date; tz: string; transitions: readonly TransitionFact[]; measure?: BurnUpMeasure }): BurnUpPoint[] {
    const later = (a: TransitionFact, b: TransitionFact) => (a.at.getTime() !== b.at.getTime() ? a.at.getTime() > b.at.getTime() : a.seq > b.seq);
    const weightOf = (s: TransitionFact, m: BurnUpMeasure) => (m === 'items' ? 1 : ((m === 'points' ? s.estimatePoints : s.estimateMinutes) ?? null));
    const lastDay = input.today.getTime() < input.endsOn.getTime() ? input.today : input.endsOn;
    const days = daysBetween(input.startsOn, lastDay);
    if (days < 0) return [];
    const byItem = new Map<string, TransitionFact[]>();
    for (const t of input.transitions) byItem.set(t.workItemId, [...(byItem.get(t.workItemId) ?? []), t]);
    const points: BurnUpPoint[] = [];
    for (let i = 0; i <= days; i++) {
        const day = addDays(input.startsOn, i);
        const isToday = day.getTime() === input.today.getTime();
        const cutoff = isToday ? input.now.getTime() : startOfDayInTz(addDays(day, 1), input.tz).getTime();
        let scope = 0;
        let started = 0;
        let completed = 0;
        let unestimated = 0;
        const measure = input.measure ?? 'items';
        for (const list of byItem.values()) {
            let state: TransitionFact | null = null;
            for (const t of list) {
                if (t.at.getTime() > cutoff) continue;
                if (!state || later(t, state)) state = t;
            }
            if (!state || state.cycleId !== input.cycleId || state.deleted || state.stateCategory === 'CANCELLED') continue;
            const weight = weightOf(state, measure);
            if (weight === null) {
                unestimated += 1;
                continue;
            }
            scope += weight;
            if (state.stateCategory === 'STARTED' || state.stateCategory === 'DONE') started += weight;
            if (state.stateCategory === 'DONE') completed += weight;
        }
        points.push(measure === 'items' ? { date: dayKey(day), scope, started, completed } : { date: dayKey(day), scope, started, completed, unestimated });
    }
    return points;
}

const CATEGORY = fc.constantFrom<WorkflowStateCategory>('BACKLOG', 'UNSTARTED', 'STARTED', 'DONE', 'CANCELLED');
const ZONE = fc.constantFrom('UTC', 'Europe/Sofia', 'America/New_York', 'Asia/Tokyo', 'Europe/London');
const START = Date.UTC(2026, 9, 20);

/** A random row: never exactly on an instant of midnight (a whole second plus 1 to 999 ms). */
const ROW = fc.record({
    item: fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f'),
    offset: fc.integer({ min: 0, max: 30 * 86_400 }),
    ms: fc.integer({ min: 1, max: 999 }),
    category: CATEGORY,
    inCycle: fc.constantFrom<'c1' | 'c2' | null>('c1', 'c1', 'c2', null),
    deleted: fc.boolean(),
    points: fc.option(fc.integer({ min: 0, max: 13 }), { nil: null }),
});

describe('the burn-up over the sweep equals 2.5a’s scan', () => {
    it('on random histories, in five zones, under every measure', () => {
        fc.assert(
            fc.property(
                fc.array(ROW, { maxLength: 40 }),
                ZONE,
                fc.integer({ min: 0, max: 12 }),
                fc.integer({ min: 1, max: 20 }),
                fc.integer({ min: 0, max: 28 }),
                fc.constantFrom<BurnUpMeasure>('items', 'points', 'hours'),
                (raw, tz, startOffset, length, todayOffset, measure) => {
                    const transitions: TransitionFact[] = raw.map((r, i) => ({
                        workItemId: r.item,
                        cycleId: r.inCycle,
                        stateCategory: r.category,
                        deleted: r.deleted,
                        at: new Date(START + r.offset * 1000 + r.ms),
                        seq: i + 1,
                        estimatePoints: r.points,
                        estimateMinutes: r.points === null ? null : r.points * 60,
                    }));
                    const startsOn = addDays(fromDayKey('2026-10-20'), startOffset);
                    const endsOn = addDays(startsOn, length);
                    const today = addDays(fromDayKey('2026-10-20'), todayOffset);
                    const now = new Date(startOfDayInTz(today, tz).getTime() + 13 * 3_600_000 + 17);
                    const input = { cycleId: 'c1', startsOn, endsOn, today, now, tz, transitions, measure };
                    expect(burnUp(input)).toEqual(oracleBurnUp(input));
                },
            ),
            { numRuns: 400 },
        );
    });
});

let seq = 0;
function f(workItemId: string, at: string, stateCategory: WorkflowStateCategory, extra: Partial<RecordFact> = {}): RecordFact {
    seq += 1;
    return { workItemId, projectId: 'p1', teamId: 't1', cycleId: null, stateCategory, deleted: false, at: new Date(at), seq, ...extra };
}

describe('cumulative flow', () => {
    const day = (s: string) => toEpochDay(s);
    const base = { timeZone: 'UTC', now: new Date('2026-11-06T12:00:00Z'), fromDay: day('2026-11-02'), toDay: day('2026-11-06') };

    it('counts the open categories at each day’s end and Done only since the window’s start', () => {
        const facts = [
            f('old', '2026-10-01T09:00:00Z', 'DONE'),
            f('a', '2026-10-30T09:00:00Z', 'BACKLOG'),
            f('a', '2026-11-03T09:00:00Z', 'STARTED'),
            f('a', '2026-11-05T09:00:00Z', 'DONE'),
            f('b', '2026-11-02T10:00:00Z', 'UNSTARTED'),
            f('b', '2026-11-04T10:00:00Z', 'CANCELLED'),
        ];
        const series = flowSweep({ ...base, facts, inScope: () => true, doneSince: startOfDayInTz(fromDayKey('2026-11-02'), 'UTC') }).map(cumulativeFlowOf);
        expect(series).toEqual([
            { backlog: 1, unstarted: 1, started: 0, done: 0 },
            { backlog: 0, unstarted: 1, started: 1, done: 0 },
            { backlog: 0, unstarted: 0, started: 1, done: 0 },
            { backlog: 0, unstarted: 0, started: 0, done: 1 },
            { backlog: 0, unstarted: 0, started: 0, done: 1 },
        ]);
    });

    it('judges the scope by each row’s recorded project: a moved item counts in each project for its time there', () => {
        const facts = [f('m', '2026-11-01T09:00:00Z', 'STARTED', { projectId: 'p1' }), f('m', '2026-11-04T09:00:00Z', 'STARTED', { projectId: 'p2' })];
        const inP1 = flowSweep({ ...base, facts, inScope: (r) => r.projectId === 'p1', doneSince: null }).map((d) => d.counts.STARTED);
        const inP2 = flowSweep({ ...base, facts, inScope: (r) => r.projectId === 'p2', doneSince: null }).map((d) => d.counts.STARTED);
        expect(inP1).toEqual([1, 1, 0, 0, 0]);
        expect(inP2).toEqual([0, 0, 1, 1, 1]);
    });

    it('drops a deleted item while deleted and returns it when restored, and never reads past now', () => {
        const facts = [
            f('d', '2026-11-01T09:00:00Z', 'UNSTARTED'),
            f('d', '2026-11-03T09:00:00Z', 'UNSTARTED', { deleted: true }),
            f('d', '2026-11-05T09:00:00Z', 'UNSTARTED'),
            f('d', '2026-11-06T15:00:00Z', 'STARTED'),
        ];
        const series = flowSweep({ ...base, facts, inScope: () => true, doneSince: null }).map((x) => [x.counts.UNSTARTED, x.counts.STARTED]);
        expect(series).toEqual([[1, 0], [0, 0], [0, 0], [1, 0], [1, 0]]);
    });

    it('places a row on the day of its instant in the zone, midnight belonging to the day it begins', () => {
        const facts = [f('z', '2026-11-03T00:00:00Z', 'STARTED')];
        expect(flowSweep({ ...base, facts, inScope: () => true, doneSince: null }).map((x) => x.counts.STARTED)).toEqual([0, 1, 1, 1, 1]);
        const tokyo = flowSweep({ ...base, timeZone: 'Asia/Tokyo', facts: [f('z', '2026-11-02T16:00:00Z', 'STARTED')], inScope: () => true, doneSince: null });
        expect(tokyo.map((x) => x.counts.STARTED)).toEqual([0, 1, 1, 1, 1]);
    });

    it('never counts more done than the window started with plus what entered, and every band is never negative', () => {
        fc.assert(
            fc.property(fc.array(ROW, { maxLength: 40 }), ZONE, (raw, tz) => {
                const facts = raw.map((r, i) => ({ ...f(r.item, new Date(START + r.offset * 1000 + r.ms).toISOString(), r.category, { deleted: r.deleted, projectId: r.inCycle ?? 'none' }), seq: i + 1 }));
                const series = flowSweep({ timeZone: tz, now: new Date(START + 31 * 86_400_000), fromDay: toEpochDay(new Date(START)) + 5, toDay: toEpochDay(new Date(START)) + 25, facts, inScope: (r) => r.projectId === 'c1', doneSince: new Date(START + 5 * 86_400_000) });
                for (const d of series) for (const v of Object.values(d.counts)) expect(v).toBeGreaterThanOrEqual(0);
                expect(series).toHaveLength(21);
            }),
        );
    });
});
