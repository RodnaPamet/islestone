/**
 * The burn-up (sub-phase 2.5a, `src/app-layer/domain/burn-up.ts`): what counts
 * on each day, the day boundary in the reminder zone, and property tests for
 * the rules it must never break: the order of the rows does not matter, a
 * change after the cycle ended changes nothing, and completed ≤ started ≤
 * scope on every day.
 */
import fc from 'fast-check';
import type { WorkflowStateCategory } from '@prisma/client';

import { burnUp, startOfDayInTz, type TransitionFact } from '@/app-layer/domain/burn-up';
import { addDays, fromDayKey } from '@/app-layer/domain/cycle';

const d = fromDayKey;
const C = 'cycle-1';
let seq = 0;
function t(workItemId: string, at: string, stateCategory: WorkflowStateCategory, cycleId: string | null = C, deleted = false): TransitionFact {
    seq += 1;
    return { workItemId, cycleId, stateCategory, deleted, at: new Date(at), seq };
}

const base = { cycleId: C, startsOn: d('2026-11-02'), endsOn: d('2026-11-08'), tz: 'UTC' };

describe('burnUp', () => {
    it('has no points before the cycle starts', () => {
        expect(burnUp({ ...base, today: d('2026-11-01'), now: new Date('2026-11-01T12:00:00Z'), transitions: [] })).toEqual([]);
    });

    it('counts scope, started and completed at the end of each day, today at now', () => {
        const rows = [
            t('a', '2026-11-01T10:00:00Z', 'UNSTARTED'),
            t('b', '2026-11-02T10:00:00Z', 'UNSTARTED'),
            t('a', '2026-11-03T09:00:00Z', 'STARTED'),
            t('a', '2026-11-04T09:00:00Z', 'DONE'),
            t('c', '2026-11-04T09:00:00Z', 'UNSTARTED', 'other-cycle'),
            t('b', '2026-11-04T15:00:00Z', 'UNSTARTED', null),
        ];
        const points = burnUp({ ...base, today: d('2026-11-04'), now: new Date('2026-11-04T12:00:00Z'), transitions: rows });
        expect(points).toEqual([
            { date: '2026-11-02', scope: 2, started: 0, completed: 0 },
            { date: '2026-11-03', scope: 2, started: 1, completed: 0 },
            // Today at noon: b has not left the cycle yet.
            { date: '2026-11-04', scope: 2, started: 1, completed: 1 },
        ]);
    });

    it('drops cancelled and deleted items from the scope', () => {
        const rows = [
            t('a', '2026-11-02T08:00:00Z', 'UNSTARTED'),
            t('b', '2026-11-02T08:00:00Z', 'UNSTARTED'),
            t('a', '2026-11-03T08:00:00Z', 'CANCELLED'),
            t('b', '2026-11-03T08:00:00Z', 'UNSTARTED', C, true),
        ];
        const points = burnUp({ ...base, today: d('2026-11-03'), now: new Date('2026-11-03T23:00:00Z'), transitions: rows });
        expect(points.map((p) => p.scope)).toEqual([2, 0]);
    });

    it('breaks a tie at one instant by the row order', () => {
        const rows = [t('a', '2026-11-02T08:00:00Z', 'UNSTARTED'), t('a', '2026-11-02T08:00:00Z', 'DONE')];
        const [p] = burnUp({ ...base, today: d('2026-11-02'), now: new Date('2026-11-02T09:00:00Z'), transitions: [...rows].reverse() });
        expect(p?.completed).toBe(1);
    });

    it('ends each day at midnight in the zone', () => {
        // 23:30 in London on 2 November is 23:30 UTC (no summer time); in
        // Tokyo it is already 3 November.
        const rows = [t('a', '2026-11-01T00:00:00Z', 'UNSTARTED'), t('a', '2026-11-02T23:30:00Z', 'DONE')];
        const london = burnUp({ ...base, tz: 'Europe/London', today: d('2026-11-03'), now: new Date('2026-11-03T12:00:00Z'), transitions: rows });
        expect(london[0]?.completed).toBe(1);
        const tokyo = burnUp({ ...base, tz: 'Asia/Tokyo', today: d('2026-11-03'), now: new Date('2026-11-03T12:00:00Z'), transitions: rows });
        expect(tokyo[0]?.completed).toBe(0);
        expect(tokyo[1]?.completed).toBe(1);
    });

    it('stops at the last day of an ended cycle', () => {
        const points = burnUp({ ...base, today: d('2026-11-20'), now: new Date('2026-11-20T12:00:00Z'), transitions: [] });
        expect(points.map((p) => p.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
    });
});

describe('startOfDayInTz', () => {
    it('finds the instant a calendar day begins, across a daylight-saving change', () => {
        expect(startOfDayInTz(d('2026-07-01'), 'Europe/London').toISOString()).toBe('2026-06-30T23:00:00.000Z');
        expect(startOfDayInTz(d('2026-12-01'), 'Europe/London').toISOString()).toBe('2026-12-01T00:00:00.000Z');
        expect(startOfDayInTz(d('2026-03-29'), 'Europe/London').toISOString()).toBe('2026-03-29T00:00:00.000Z');
        expect(startOfDayInTz(d('2026-03-30'), 'Europe/London').toISOString()).toBe('2026-03-29T23:00:00.000Z');
        expect(startOfDayInTz(d('2026-11-02'), 'America/New_York').toISOString()).toBe('2026-11-02T05:00:00.000Z');
    });
});

describe('burnUp properties', () => {
    const category = fc.constantFrom<WorkflowStateCategory>('BACKLOG', 'UNSTARTED', 'STARTED', 'DONE', 'CANCELLED');
    const fact = fc
        .record({
            item: fc.constantFrom('a', 'b', 'c', 'd'),
            minute: fc.integer({ min: 0, max: 12 * 24 * 60 }),
            stateCategory: category,
            inCycle: fc.boolean(),
            deleted: fc.boolean(),
        })
        .map(
            (r): Omit<TransitionFact, 'seq'> => ({
                workItemId: r.item,
                at: new Date(Date.parse('2026-10-31T00:00:00Z') + r.minute * 60_000),
                stateCategory: r.stateCategory,
                cycleId: r.inCycle ? C : null,
                deleted: r.deleted,
            }),
        );
    const facts = fc.array(fact, { maxLength: 30 }).map((rows) => rows.map((r, i) => ({ ...r, seq: i + 1 })));
    const run = (transitions: TransitionFact[]) =>
        burnUp({ ...base, today: d('2026-11-08'), now: new Date('2026-11-08T12:00:00Z'), transitions });

    it('ignores the order of the rows', () => {
        fc.assert(fc.property(facts, (rows) => expect(run([...rows].reverse())).toEqual(run(rows))));
    });

    it('keeps completed ≤ started ≤ scope on every day', () => {
        fc.assert(
            fc.property(facts, (rows) => {
                for (const p of run(rows)) {
                    expect(p.completed).toBeLessThanOrEqual(p.started);
                    expect(p.started).toBeLessThanOrEqual(p.scope);
                }
            }),
        );
    });

    it('is unchanged by a change after the cycle ended', () => {
        fc.assert(
            fc.property(facts, category, (rows, late) => {
                const after = burnUp({ ...base, today: d('2026-11-20'), now: new Date('2026-11-20T12:00:00Z'), transitions: rows });
                const extra = { workItemId: 'a', at: new Date(addDays(d('2026-11-09'), 1).getTime() + 1), stateCategory: late, cycleId: C, deleted: false, seq: 999 };
                expect(burnUp({ ...base, today: d('2026-11-20'), now: new Date('2026-11-20T12:00:00Z'), transitions: [...rows, extra] })).toEqual(after);
            }),
        );
    });
});
