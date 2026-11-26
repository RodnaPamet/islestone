/**
 * Progress (sub-phase 3.2b; owner decisions 211 and 212): scope leaves
 * cancelled items out, zero is never complete, "late" needs open items, and a
 * goal counts every item reached through its project path or its own goal
 * exactly once. The property checks `goalProgress` over the two grouped reads
 * against a naive per-item count.
 */
import fc from 'fast-check';
import type { WorkflowStateCategory } from '@prisma/client';

import { goalProgress, isComplete, isLate, percentDone, progressByKey, progressOf, sumProgress, type DirectGoalCount, type Progress } from '@/app-layer/domain/progress';

const CATEGORIES: WorkflowStateCategory[] = ['BACKLOG', 'UNSTARTED', 'STARTED', 'DONE', 'CANCELLED'];

describe('progressOf', () => {
    it('counts scope without cancelled items, done and started', () => {
        expect(
            progressOf([
                { stateCategory: 'BACKLOG', count: 2 },
                { stateCategory: 'STARTED', count: 3 },
                { stateCategory: 'DONE', count: 4 },
                { stateCategory: 'CANCELLED', count: 9 },
            ]),
        ).toEqual({ scope: 9, done: 4, started: 3 });
    });

    it('zero items is not complete and shows 0 %, never 100 %', () => {
        const none = progressOf([]);
        expect(none).toEqual({ scope: 0, done: 0, started: 0 });
        expect(isComplete(none)).toBe(false);
        expect(percentDone(none)).toBe(0);
        // Only cancelled items: still nothing in scope.
        expect(isComplete(progressOf([{ stateCategory: 'CANCELLED', count: 3 }]))).toBe(false);
    });

    it('is complete when every scoped item is done', () => {
        expect(isComplete(progressOf([{ stateCategory: 'DONE', count: 2 }, { stateCategory: 'CANCELLED', count: 1 }]))).toBe(true);
        expect(percentDone({ scope: 3, done: 1 })).toBe(33);
    });
});

describe('progressByKey and sumProgress', () => {
    it('tallies per key and leaves a null key out', () => {
        const m = progressByKey([
            { key: 'a', stateCategory: 'DONE', count: 1 },
            { key: 'a', stateCategory: 'BACKLOG', count: 1 },
            { key: 'b', stateCategory: 'STARTED', count: 2 },
            { key: null, stateCategory: 'DONE', count: 5 },
        ]);
        expect(Object.fromEntries(m)).toEqual({ a: { scope: 2, done: 1, started: 0 }, b: { scope: 2, done: 0, started: 2 } });
        expect(sumProgress([m.get('a'), m.get('b'), undefined])).toEqual({ scope: 4, done: 1, started: 2 });
    });
});

describe('isLate', () => {
    const p = (scope: number, done: number): Progress => ({ scope, done, started: 0 });
    it('a passed due date with open items is late', () => {
        expect(isLate(10, p(2, 1), 11)).toBe(true);
    });
    it('not on the due date itself, not with everything done, not with no due date, not with no items', () => {
        expect(isLate(11, p(2, 1), 11)).toBe(false);
        expect(isLate(10, p(2, 2), 11)).toBe(false);
        expect(isLate(null, p(2, 1), 11)).toBe(false);
        expect(isLate(10, p(0, 0), 11)).toBe(false);
    });
    it('reads date-only values as dates too', () => {
        expect(isLate(new Date(Date.UTC(2026, 0, 1)), p(1, 0), new Date(Date.UTC(2026, 0, 2)))).toBe(true);
    });
});

describe('goalProgress', () => {
    it('counts an item reached through its project and its own goal once', () => {
        const byProject = new Map<string, Progress>([['p1', { scope: 2, done: 1, started: 0 }]]);
        const direct: DirectGoalCount[] = [
            // Names the goal AND sits in the goal's project: already counted.
            { goalId: 'g1', projectId: 'p1', stateCategory: 'DONE', count: 1 },
            // Names a goal below it, in another project: counted once more.
            { goalId: 'g2', projectId: 'p9', stateCategory: 'STARTED', count: 1 },
            // Names a goal outside the subtree: not counted.
            { goalId: 'gx', projectId: 'p9', stateCategory: 'DONE', count: 4 },
        ];
        expect(goalProgress(new Set(['p1']), new Set(['g1', 'g2']), byProject, direct)).toEqual({ scope: 3, done: 1, started: 1 });
    });

    it('a goal with no initiatives and no direct items has no items', () => {
        expect(goalProgress(new Set(), new Set(['g1']), new Map(), [])).toEqual({ scope: 0, done: 0, started: 0 });
    });

    it('matches a naive per-item count over random workspaces', () => {
        const item = fc.record({
            project: fc.integer({ min: 0, max: 5 }),
            goal: fc.option(fc.integer({ min: 0, max: 5 }), { nil: null }),
            category: fc.constantFrom(...CATEGORIES),
        });
        fc.assert(
            fc.property(fc.array(item, { maxLength: 60 }), fc.uniqueArray(fc.integer({ min: 0, max: 5 })), fc.uniqueArray(fc.integer({ min: 0, max: 5 })), (items, pathProjects, subtree) => {
                const projectIds = new Set(pathProjects.map((p) => `p${p}`));
                const goalIds = new Set(subtree.map((g) => `g${g}`));
                // The two grouped reads, as the repository returns them.
                const byProject = progressByKey(items.map((i) => ({ key: `p${i.project}`, stateCategory: i.category, count: 1 })));
                const direct: DirectGoalCount[] = items.flatMap((i) => (i.goal === null ? [] : [{ goalId: `g${i.goal}`, projectId: `p${i.project}`, stateCategory: i.category, count: 1 }]));
                // Naive: each item at most once, when it is reached either way.
                const reached = items.filter((i) => projectIds.has(`p${i.project}`) || (i.goal !== null && goalIds.has(`g${i.goal}`)));
                const naive = progressOf(reached.map((i) => ({ stateCategory: i.category, count: 1 })));
                expect(goalProgress(projectIds, goalIds, byProject, direct)).toEqual(naive);
            }),
        );
    });
});
