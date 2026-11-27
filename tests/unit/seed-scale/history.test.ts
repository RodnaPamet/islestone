/**
 * The scale seed's back-dated record (sub-phase 3.6a,
 * `scripts/seed-scale/history.ts`): every item's history ends on its current
 * picture, is strictly increasing in time and before the anchor, chains
 * `fromStateCategory` to the previous row, and the year is non-stationary
 * (growth, a slow quarter, a holiday dip). Pure: no database.
 */
import fc from 'fast-check';
import type { WorkflowStateCategory } from '@prisma/client';

import { itemHistory, weekWeight } from '../../../scripts/seed-scale/history';
import { stream } from '../../../scripts/seed-scale/random';

const ANCHOR = new Date('2026-11-27T00:00:00Z');
const DAY = 86_400_000;
const weeks = Array.from({ length: 52 }, (_, w) => [w, weekWeight(w, new Date(ANCHOR.getTime() - (52 - w) * 7 * DAY))] as const);
const ctx = {
    tenantId: 't1',
    anchor: ANCHOR,
    weeks,
    statesOf: () => ({ BACKLOG: 's-backlog', UNSTARTED: 's-todo', STARTED: 's-progress', REVIEW: 's-review', DONE: 's-done' }),
    otherProject: (projectId: string) => (projectId === 'p1' ? { projectId: 'p2', teamId: 'team-2' } : { projectId: 'p1', teamId: 'team-1' }),
    members: ['u1', 'u2', 'u3'],
};

describe('itemHistory', () => {
    it('ends on the current picture, strictly increasing before the anchor, with fromStateCategory chained', () => {
        fc.assert(
            fc.property(
                fc.constantFrom<WorkflowStateCategory>('BACKLOG', 'UNSTARTED', 'STARTED', 'DONE', 'CANCELLED'),
                fc.boolean(),
                fc.option(fc.constantFrom('c1', 'c2'), { nil: null }),
                fc.option(fc.constantFrom('u1', 'u2'), { nil: null }),
                fc.string({ minLength: 1, maxLength: 8 }),
                (category, deleted, cycleId, waitingOn, key) => {
                    const item = {
                        id: 'w1',
                        number: 1,
                        keyPrefix: key,
                        projectId: 'p1',
                        teamId: 'team-1',
                        stateId: `s-${category}`,
                        stateCategory: category,
                        cycleId,
                        milestoneId: null,
                        waitingOnUserId: category === 'DONE' || category === 'CANCELLED' ? null : waitingOn,
                        estimatePoints: 3,
                        estimateMinutes: null,
                        deletedAt: deleted ? new Date() : null,
                    };
                    const rows = itemHistory(stream('t', key), item, ctx);
                    const last = rows.at(-1)!;
                    expect([last.projectId, last.teamId, last.stateId, last.stateCategory, last.cycleId, last.waitingOnUserId, last.estimatePoints, last.deleted]).toEqual([
                        'p1', 'team-1', item.stateId, category, cycleId, item.waitingOnUserId, 3, deleted,
                    ]);
                    expect(rows[0]!.fromStateCategory).toBeNull();
                    for (let i = 1; i < rows.length; i++) {
                        expect(rows[i]!.at.getTime()).toBeGreaterThan(rows[i - 1]!.at.getTime());
                        expect(rows[i]!.fromStateCategory).toBe(rows[i - 1]!.stateCategory);
                    }
                    expect(last.at.getTime()).toBeLessThan(ANCHOR.getTime());
                    expect(rows[0]!.at.getTime()).toBeGreaterThan(ANCHOR.getTime() - 430 * DAY);
                },
            ),
            { numRuns: 300 },
        );
    });

    it('is deterministic for one stream', () => {
        const item = { id: 'w1', number: 1, keyPrefix: 'A', projectId: 'p1', teamId: 'team-1', stateId: 's-done', stateCategory: 'DONE' as const, cycleId: null, milestoneId: null, waitingOnUserId: null, estimatePoints: null, estimateMinutes: null, deletedAt: null };
        expect(itemHistory(stream('s', 'A-1'), item, ctx)).toEqual(itemHistory(stream('s', 'A-1'), item, ctx));
    });
});

describe('weekWeight', () => {
    it('grows across the year, slows in one quarter and dips over the December holidays', () => {
        const monday = (s: string) => new Date(`${s}T00:00:00Z`);
        expect(weekWeight(51, monday('2026-11-16'))).toBeGreaterThan(weekWeight(0, monday('2025-12-01')));
        expect(weekWeight(30, monday('2026-06-22'))).toBeLessThan(weekWeight(25, monday('2026-05-18')));
        expect(weekWeight(4, monday('2025-12-22'))).toBeLessThan(weekWeight(3, monday('2025-12-15')) / 2);
    });
});
