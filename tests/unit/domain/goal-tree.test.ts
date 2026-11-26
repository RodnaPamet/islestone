/**
 * The goal tree's rules (sub-phase 3.2a; ADR 0002 §2; decisions 24 and 218):
 * three levels at most, a move refused into its own subtree, a delete
 * group's root the goal whose parent is outside the group.
 */
import { childFits, goalMoveRefusal, groupRoots, MAX_GOAL_DEPTH } from '@/app-layer/domain/goal-tree';

describe('the goal tree', () => {
    it('three levels at most', () => {
        expect(MAX_GOAL_DEPTH).toBe(3);
        expect(childFits([])).toBe(true);
        expect(childFits(['p'])).toBe(true);
        expect(childFits(['p', 'gp'])).toBe(true);
        expect(childFits(['p', 'gp', 'ggp'])).toBe(false);
    });

    it('a move: to the root, under a goal, too deep by height, into its own subtree', () => {
        expect(goalMoveRefusal('g', [], ['g'], [0])).toBeNull();
        expect(goalMoveRefusal('g', ['p'], ['g', 'c'], [0, 1])).toBeNull();
        expect(goalMoveRefusal('g', ['p', 'gp'], ['g', 'c'], [0, 1])).toEqual({ reason: 'GOAL_TOO_DEEP', depth: 4 });
        expect(goalMoveRefusal('g', ['c', 'g'], ['g', 'c'], [0, 1])).toEqual({ reason: 'GOAL_WOULD_CYCLE' });
        expect(goalMoveRefusal('g', ['g'], ['g'], [0])).toEqual({ reason: 'GOAL_WOULD_CYCLE' });
        // A deleted child still counts in the height the caller passes.
        expect(goalMoveRefusal('g', ['p', 'gp'], ['g'], [0])).toBeNull();
    });

    it("a group's roots: goals whose parent is not in the group", () => {
        expect(groupRoots([{ id: 'b', parentId: 'a' }, { id: 'a', parentId: 'x' }, { id: 'c', parentId: 'b' }])).toEqual(['a']);
        expect(groupRoots([{ id: 'z', parentId: null }, { id: 'y', parentId: 'q' }])).toEqual(['y', 'z']);
        expect(groupRoots([])).toEqual([]);
    });
});
