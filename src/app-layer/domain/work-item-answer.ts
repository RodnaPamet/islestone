/**
 * Marking a work item's answer (sub-phase 2.4b-c; ADR 0002 §15; owner
 * decisions 114 and 115), as a pure plan the usecase applies:
 *
 *   - an open item moves to a Done state in the same write: the one the
 *     person chose, which must be a live Done state of the item's team, or
 *     else the first live Done state in the team's order (decision 114);
 *   - a closed item (Done or Cancelled) keeps its state: marking changes only
 *     the answer (decision 115).
 *
 * Written fresh for Islestone.
 */
import type { WorkflowStateCategory } from '@prisma/client';

export interface AnswerStateRef {
    id: string;
    teamId: string;
    name: string;
    category: WorkflowStateCategory;
    archivedAt: Date | null;
}

export type AnswerPlan =
    | { kind: 'pointer-only' }
    | { kind: 'move'; to: AnswerStateRef }
    | { kind: 'refused'; reason: 'NO_DONE_STATE' | 'NOT_A_DONE_STATE' };

/** Closed means Done or Cancelled. */
export function isClosedForAnswer(category: WorkflowStateCategory): boolean {
    return category === 'DONE' || category === 'CANCELLED';
}

/**
 * @param item        the item's team and current category
 * @param teamStates  the team's states in its order (archived ones may be included; they are skipped)
 * @param chosenStateId the Done state the person chose, when they chose one
 */
export function planAnswerMark(
    item: { teamId: string; stateCategory: WorkflowStateCategory },
    teamStates: readonly AnswerStateRef[],
    chosenStateId?: string | null,
): AnswerPlan {
    if (isClosedForAnswer(item.stateCategory)) return { kind: 'pointer-only' };
    const done = teamStates.filter((s) => s.teamId === item.teamId && s.category === 'DONE' && s.archivedAt === null);
    if (chosenStateId) {
        const chosen = done.find((s) => s.id === chosenStateId);
        return chosen ? { kind: 'move', to: chosen } : { kind: 'refused', reason: 'NOT_A_DONE_STATE' };
    }
    const first = done[0];
    return first ? { kind: 'move', to: first } : { kind: 'refused', reason: 'NO_DONE_STATE' };
}
