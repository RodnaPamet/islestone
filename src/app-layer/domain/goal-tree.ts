/**
 * The goal tree's rules (sub-phase 3.2a; ADR 0002 §2; docs/porting/maps/3.2.md,
 * "The tree rules"), pure and client-safe. The usecases read the rows under
 * the goal-tree lock and ask these; the "Add child goal" button (3.2b) asks
 * the same depth rule.
 *
 *   - Goals nest at most three levels (decision 24): a root goal is level 1.
 *   - Re-parenting refuses a new parent inside the moved goal's own subtree,
 *     deleted goals included (a cycle), and a new parent whose level plus the
 *     moved subtree's height passes three.
 *   - A delete group's root is the one goal of the group whose parent is not
 *     in the group (decision 218): only it restores the group.
 *
 * Written fresh for Islestone.
 */

export const MAX_GOAL_DEPTH = 3;

export type GoalMoveRefusal = { reason: 'GOAL_WOULD_CYCLE' } | { reason: 'GOAL_TOO_DEEP'; depth: number };

/**
 * Can a goal whose subtree (itself at depth 0) has the given depths move
 * under a parent whose chain (the parent itself first, deleted goals
 * included) is `parentChain`? `null` when it can; `parentChain` empty is a
 * move to the root.
 */
export function goalMoveRefusal(goalId: string, parentChain: readonly string[], subtreeIds: readonly string[], subtreeDepths: readonly number[]): GoalMoveRefusal | null {
    if (parentChain.length > 0 && (parentChain.includes(goalId) || subtreeIds.includes(parentChain[0]!))) return { reason: 'GOAL_WOULD_CYCLE' };
    const height = (subtreeDepths.length ? Math.max(...subtreeDepths) : 0) + 1;
    const depth = parentChain.length + height;
    return depth > MAX_GOAL_DEPTH ? { reason: 'GOAL_TOO_DEEP', depth } : null;
}

/** Can a new goal go under a parent whose chain (parent first) is `parentChain`? */
export function childFits(parentChain: readonly string[]): boolean {
    return parentChain.length + 1 <= MAX_GOAL_DEPTH;
}

/** The roots of a delete group: goals whose parent is not in the group. */
export function groupRoots(goals: ReadonlyArray<{ id: string; parentId: string | null }>): string[] {
    const ids = new Set(goals.map((g) => g.id));
    return goals.filter((g) => g.parentId === null || !ids.has(g.parentId)).map((g) => g.id).sort();
}
