/**
 * The mark planner (sub-phase 2.4b-c; decisions 114 and 115): an open item
 * moves to the chosen live Done state of its team, or the first in the team's
 * order; a closed item keeps its state; a team with no live Done state, or a
 * choice that is not one, is refused.
 */
import type { WorkflowStateCategory } from '@prisma/client';

import { planAnswerMark, type AnswerStateRef } from '@/app-layer/domain/work-item-answer';

const state = (id: string, category: WorkflowStateCategory, extra: Partial<AnswerStateRef> = {}): AnswerStateRef => ({
    id,
    teamId: 't1',
    name: id,
    category,
    archivedAt: null,
    ...extra,
});
const TEAM = [
    state('todo', 'UNSTARTED'),
    state('done-old', 'DONE', { archivedAt: new Date() }),
    state('done', 'DONE'),
    state('released', 'DONE'),
    state('other-team-done', 'DONE', { teamId: 't2' }),
    state('wontdo', 'CANCELLED'),
];

describe('planAnswerMark', () => {
    it("moves an open item to the team's first live Done state", () => {
        expect(planAnswerMark({ teamId: 't1', stateCategory: 'STARTED' }, TEAM)).toEqual({ kind: 'move', to: TEAM[2] });
    });

    it('moves it to the Done state the person chose', () => {
        expect(planAnswerMark({ teamId: 't1', stateCategory: 'BACKLOG' }, TEAM, 'released')).toEqual({ kind: 'move', to: TEAM[3] });
    });

    it('refuses a choice that is not a live Done state of the team', () => {
        for (const id of ['done-old', 'other-team-done', 'wontdo', 'nope']) {
            expect(planAnswerMark({ teamId: 't1', stateCategory: 'STARTED' }, TEAM, id)).toEqual({ kind: 'refused', reason: 'NOT_A_DONE_STATE' });
        }
    });

    it('refuses when the team has no live Done state', () => {
        expect(planAnswerMark({ teamId: 't1', stateCategory: 'STARTED' }, [TEAM[0]!, TEAM[1]!])).toEqual({ kind: 'refused', reason: 'NO_DONE_STATE' });
    });

    it('keeps a closed item where it is: marking changes only the answer (decision 115)', () => {
        expect(planAnswerMark({ teamId: 't1', stateCategory: 'DONE' }, TEAM, 'released')).toEqual({ kind: 'pointer-only' });
        expect(planAnswerMark({ teamId: 't1', stateCategory: 'CANCELLED' }, TEAM)).toEqual({ kind: 'pointer-only' });
    });
});
