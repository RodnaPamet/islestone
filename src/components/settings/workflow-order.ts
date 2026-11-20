/**
 * How the Settings workflow page orders a team's states and where "move up"
 * or "move down" places one (decision 55). Pure and client-safe, so the
 * rendered tests and the integration test read the same rule the page uses.
 *
 * A team's states are one ordered list (`sortKey`, compared with `<`, never
 * `localeCompare`; CLAUDE.md "Order"); the page shows them by category, in
 * workflow order, and a move names the neighbour in the same category, so a
 * state never leaves its category by being moved.
 *
 * Written fresh for Islestone.
 */
import { WORKFLOW_STATE_CATEGORIES } from '@/app-layer/domain/workflow-state';
import type { WorkflowStateCategory } from '@/lib/work-items/types';

export interface OrderedState {
    id: string;
    category: WorkflowStateCategory;
    sortKey: string;
}

/** The states by category (workflow order), each category in the team's order. */
export function orderStates<S extends OrderedState>(states: readonly S[]): S[] {
    const rank = new Map<string, number>(WORKFLOW_STATE_CATEGORIES.map((c, i) => [c, i]));
    return states
        .map((s, i) => ({ s, i }))
        .sort(
            (a, b) =>
                (rank.get(a.s.category) ?? 0) - (rank.get(b.s.category) ?? 0) ||
                (a.s.sortKey < b.s.sortKey ? -1 : a.s.sortKey > b.s.sortKey ? 1 : a.i - b.i),
        )
        .map((x) => x.s);
}

/** The `position` that moves `state` past its neighbour in the same category, or null at the category's edge. */
export function neighbourPosition(
    ordered: readonly OrderedState[],
    state: OrderedState,
    direction: 'up' | 'down',
): { beforeId: string } | { afterId: string } | null {
    const same = ordered.filter((s) => s.category === state.category);
    const i = same.findIndex((s) => s.id === state.id);
    if (i < 0) return null;
    if (direction === 'up') return i > 0 ? { beforeId: same[i - 1]!.id } : null;
    return i < same.length - 1 ? { afterId: same[i + 1]!.id } : null;
}
