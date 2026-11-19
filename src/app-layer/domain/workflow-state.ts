/**
 * Workflow states and their categories (ADR 0002 §3).
 *
 * A team owns its workflow: an ordered list of `WorkflowState` rows, each in
 * one fixed category. The category set is the product's (`BACKLOG`,
 * `UNSTARTED`, `STARTED`, `DONE`, `CANCELLED`; ADR 0006 spelling, two Ls), and
 * "open" and "closed" are derived from it, never stored.
 *
 * The transition check keeps the shape of inflect-compliance's
 * `checkTaskTransition` (`src/app-layer/domain/task-status.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e): a pure function that returns
 * `null` or a discriminated error, and refusal messages that name states by
 * their display names. The rules are Islestone's: any state may move to any
 * other state of the same team; refused are a no-op, a state of another team
 * and an archived state. The fixed transition table, the eight statuses and
 * the review status are not carried.
 *
 * Client-safe on purpose (2.3's badges import it): no server imports, and in
 * particular not `@/lib/errors/types`, which reads `@/env`.
 */
import type { WorkflowStateCategory } from '@prisma/client';

/** Every category, in workflow order. */
export const WORKFLOW_STATE_CATEGORIES = [
    'BACKLOG',
    'UNSTARTED',
    'STARTED',
    'DONE',
    'CANCELLED',
] as const satisfies readonly WorkflowStateCategory[];

/** Open: backlog, unstarted or started. */
export const OPEN_CATEGORIES = ['BACKLOG', 'UNSTARTED', 'STARTED'] as const satisfies readonly WorkflowStateCategory[];

/** Closed: done or cancelled. */
export const CLOSED_CATEGORIES = ['DONE', 'CANCELLED'] as const satisfies readonly WorkflowStateCategory[];

/** The Prisma fragment "the item is open", for a `stateCategory` column. */
export const OPEN_CATEGORY_FILTER = { in: [...OPEN_CATEGORIES] as WorkflowStateCategory[] };

export function isClosedCategory(category: WorkflowStateCategory): boolean {
    return (CLOSED_CATEGORIES as readonly string[]).includes(category);
}

export function isOpenCategory(category: WorkflowStateCategory): boolean {
    return (OPEN_CATEGORIES as readonly string[]).includes(category);
}

/** The parts of a `WorkflowState` row the check and the messages read. */
export interface StateRef {
    id: string;
    teamId: string;
    name: string;
    category: WorkflowStateCategory;
    archivedAt?: Date | null;
}

export type StateTransitionError =
    | { kind: 'no_op'; state: StateRef }
    | { kind: 'other_team'; from: StateRef; to: StateRef }
    | { kind: 'archived'; to: StateRef };

/**
 * Pure transition check. `null` means the move is allowed; otherwise the
 * discriminated reason, which `formatStateTransitionError` renders.
 */
export function checkWorkflowStateTransition(from: StateRef, to: StateRef): StateTransitionError | null {
    if (from.id === to.id) return { kind: 'no_op', state: from };
    if (from.teamId !== to.teamId) return { kind: 'other_team', from, to };
    if (to.archivedAt) return { kind: 'archived', to };
    return null;
}

/** A refusal's message, naming states by their display names (the rows' `name`). */
export function formatStateTransitionError(err: StateTransitionError): string {
    switch (err.kind) {
        case 'no_op':
            return `The work item is already in ${err.state.name}.`;
        case 'other_team':
            return `${err.to.name} belongs to another team's workflow; the work item uses ${err.from.name}'s team.`;
        case 'archived':
            return `${err.to.name} is archived and takes no work items.`;
    }
}

/** The lifecycle timestamps a state move writes. A key absent means "unchanged". */
export interface StateTransitionEffects {
    startedAt?: Date | null;
    completedAt?: Date | null;
    cancelledAt?: Date | null;
}

/**
 * The timestamps a move from `from` to `to` writes (ADR 0002 §3), returned by
 * one function so every caller (single, bulk, move, duplicate) applies them
 * alike:
 *   - the first move into STARTED sets `startedAt` (a later one keeps it);
 *   - a move into DONE sets `completedAt`, into CANCELLED `cancelledAt`;
 *   - a move out of DONE or CANCELLED clears that timestamp (reopen).
 *
 * Ending a live agent session on a move into a closed category (ADR 0003)
 * arrives with agent sessions in 6.3.
 */
export function stateTransitionEffects(
    from: WorkflowStateCategory,
    to: WorkflowStateCategory,
    item: { startedAt?: Date | null },
    now: Date = new Date(),
): StateTransitionEffects {
    const effects: StateTransitionEffects = {};
    if (to === 'STARTED' && !item.startedAt) effects.startedAt = now;
    if (to === 'DONE' && from !== 'DONE') effects.completedAt = now;
    if (to === 'CANCELLED' && from !== 'CANCELLED') effects.cancelledAt = now;
    if (from === 'DONE' && to !== 'DONE') effects.completedAt = null;
    if (from === 'CANCELLED' && to !== 'CANCELLED') effects.cancelledAt = null;
    return effects;
}

/**
 * The workflow a new team is seeded with (ADR 0002 §3: one default, at least
 * one DONE and one CANCELLED). Names after Kaneo's default board columns
 * (`apps/api/src/project/controllers/insert-project.ts` at
 * fb890b4974e6dd6c232f1de6a6b70a591dfca0a3; pattern only), with In review.
 */
export const DEFAULT_TEAM_WORKFLOW: ReadonlyArray<{
    name: string;
    category: WorkflowStateCategory;
    isDefault: boolean;
}> = [
    { name: 'Backlog', category: 'BACKLOG', isDefault: false },
    { name: 'Todo', category: 'UNSTARTED', isDefault: true },
    { name: 'In progress', category: 'STARTED', isDefault: false },
    { name: 'In review', category: 'STARTED', isDefault: false },
    { name: 'Done', category: 'DONE', isDefault: false },
    { name: 'Cancelled', category: 'CANCELLED', isDefault: false },
];

/** The work item types a workspace is seeded with (ADR 0006 open question 6). */
export const DEFAULT_WORK_ITEM_TYPES: readonly string[] = ['Feature', 'Bug', 'Chore'];
