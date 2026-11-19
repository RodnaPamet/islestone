/**
 * Workflow states by category (ADR 0002 §3): the category partition, the
 * pure transition check with its discriminated errors and display-name
 * messages, and the lifecycle effects every path applies.
 *
 * Copied in shape from inflect-compliance's
 * `tests/unit/usecases/task-state-machine.test.ts` and
 * `tests/unit/task-status.test.ts` at 5528464fc54a8681956f3b9ce23ca9c075f0420e,
 * rewritten for configurable states: no fixed transition table, so the cases
 * are no_op, other_team and archived.
 */
import type { WorkflowStateCategory } from '@prisma/client';

import {
    CLOSED_CATEGORIES,
    DEFAULT_TEAM_WORKFLOW,
    OPEN_CATEGORIES,
    WORKFLOW_STATE_CATEGORIES,
    checkWorkflowStateTransition,
    formatStateTransitionError,
    isClosedCategory,
    stateTransitionEffects,
    type StateRef,
} from '@/app-layer/domain/workflow-state';

const state = (over: Partial<StateRef> = {}): StateRef => ({ id: 's1', teamId: 't1', name: 'Todo', category: 'UNSTARTED', archivedAt: null, ...over });
const NOW = new Date('2030-01-01T00:00:00Z');

describe('categories', () => {
    it('open and closed partition the enum, with no overlap, in the ADR spelling', () => {
        expect([...OPEN_CATEGORIES, ...CLOSED_CATEGORIES].sort()).toEqual([...WORKFLOW_STATE_CATEGORIES].sort());
        expect(OPEN_CATEGORIES.filter((c) => (CLOSED_CATEGORIES as readonly string[]).includes(c))).toEqual([]);
        expect(WORKFLOW_STATE_CATEGORIES).toContain('CANCELLED');
        expect(isClosedCategory('DONE')).toBe(true);
        expect(isClosedCategory('STARTED')).toBe(false);
    });

    it('the seeded workflow has one default and a DONE and a CANCELLED state', () => {
        expect(DEFAULT_TEAM_WORKFLOW.filter((s) => s.isDefault)).toHaveLength(1);
        expect(DEFAULT_TEAM_WORKFLOW.map((s) => s.category)).toEqual(expect.arrayContaining(['DONE', 'CANCELLED']));
    });
});

describe('checkWorkflowStateTransition', () => {
    it('allows any state to any other of the same team, closed ones included (reopen)', () => {
        expect(checkWorkflowStateTransition(state({ category: 'DONE', name: 'Done' }), state({ id: 's2', name: 'Todo' }))).toBeNull();
        expect(checkWorkflowStateTransition(state(), state({ id: 's2', category: 'CANCELLED', name: 'Cancelled' }))).toBeNull();
    });

    it('refuses a no-op, another team\'s state and an archived state, with display names', () => {
        const noOp = checkWorkflowStateTransition(state(), state());
        expect(noOp?.kind).toBe('no_op');
        expect(formatStateTransitionError(noOp!)).toBe('The work item is already in Todo.');
        const other = checkWorkflowStateTransition(state(), state({ id: 'x', teamId: 't2', name: 'Their Todo' }));
        expect(other?.kind).toBe('other_team');
        expect(formatStateTransitionError(other!)).toContain('Their Todo');
        const archived = checkWorkflowStateTransition(state(), state({ id: 'y', name: 'Old', archivedAt: NOW }));
        expect(archived?.kind).toBe('archived');
        expect(formatStateTransitionError(archived!)).toBe('Old is archived and takes no work items.');
    });
});

describe('stateTransitionEffects', () => {
    const cases: Array<[WorkflowStateCategory, WorkflowStateCategory, { startedAt?: Date | null }, Record<string, Date | null>]> = [
        ['UNSTARTED', 'STARTED', {}, { startedAt: NOW }],
        ['UNSTARTED', 'STARTED', { startedAt: new Date(0) }, {}],
        ['STARTED', 'DONE', { startedAt: new Date(0) }, { completedAt: NOW }],
        ['STARTED', 'CANCELLED', {}, { cancelledAt: NOW }],
        ['DONE', 'STARTED', { startedAt: new Date(0) }, { completedAt: null }],
        ['CANCELLED', 'DONE', {}, { cancelledAt: null, completedAt: NOW }],
        ['BACKLOG', 'UNSTARTED', {}, {}],
    ];
    it.each(cases)('%s → %s', (from, to, item, expected) => {
        expect(stateTransitionEffects(from, to, item, NOW)).toEqual(expected);
    });
});
