/**
 * A roadmap answer for the model's unit tests and the rendered tests
 * (sub-phase 3.2c): two initiatives (one serving a goal, one undated), an
 * archived project hidden, a project with no dated item, an unlinked
 * project, a late milestone.
 */
import type { RoadmapGoal, RoadmapInitiative, RoadmapProject, RoadmapResponse } from '@/lib/goals/roadmap';

const P = (scope: number, done: number) => ({ scope, done, started: 0 });

export function project(id: string, over: Partial<RoadmapProject> = {}): RoadmapProject {
    return {
        id,
        name: `Project ${id}`,
        keyPrefix: id.toUpperCase(),
        teamId: 'team-1',
        initiativeId: null,
        dueDate: null,
        archived: false,
        span: null,
        progress: P(0, 0),
        overdue: false,
        itemDueAfter: false,
        lateMilestones: 0,
        late: false,
        finishesAfterInitiativeDue: false,
        finishesAfterGoalDue: false,
        ...over,
    };
}

export function initiative(id: string, over: Partial<RoadmapInitiative> = {}): RoadmapInitiative {
    return {
        id,
        goalId: null,
        name: `Initiative ${id}`,
        status: 'STARTED',
        dueDate: null,
        health: null,
        leadUserId: null,
        archived: false,
        span: null,
        progress: P(0, 0),
        late: false,
        finishesAfterDue: false,
        ...over,
    };
}

export function goal(id: string, over: Partial<RoadmapGoal> = {}): RoadmapGoal {
    return {
        id,
        parentId: null,
        title: `Goal ${id}`,
        status: 'STARTED',
        dueDate: null,
        health: null,
        leadUserId: null,
        archived: false,
        span: null,
        progress: P(0, 0),
        late: false,
        finishesAfterDue: false,
        ...over,
    };
}

export const ROADMAP: RoadmapResponse = {
    asOf: '2051-03-01',
    groupBy: 'initiative',
    goals: [goal('g1', { title: 'Grow' })],
    initiatives: [
        initiative('i1', { goalId: 'g1', name: 'Launch', dueDate: '2051-04-30', health: 'AT_RISK', span: { start: '2051-03-03', end: '2051-05-31' }, progress: P(10, 4), finishesAfterDue: true }),
        initiative('i2', { name: 'Someday' }),
    ],
    projects: [
        project('p1', { name: 'Alpha', keyPrefix: 'ALP', initiativeId: 'i1', span: { start: '2051-03-03', end: '2051-04-17' }, progress: P(6, 4), dueDate: '2051-04-20' }),
        project('p2', { name: 'Beta', keyPrefix: 'BET', initiativeId: 'i1', span: { start: '2051-05-02', end: '2051-05-31' }, progress: P(4, 0), finishesAfterInitiativeDue: true, lateMilestones: 1, late: true }),
        project('p3', { name: 'Gamma', keyPrefix: 'GAM', span: { start: '2051-02-15', end: '2051-02-15' }, progress: P(1, 1) }),
        project('p4', { name: 'Delta', keyPrefix: 'DEL', initiativeId: 'i2', dueDate: '2051-06-01' }),
    ],
    milestones: [{ id: 'm1', projectId: 'p2', name: 'Beta ready', dueDate: '2051-05-15', late: true }],
    unlinked: { shown: true, span: { start: '2051-02-15', end: '2051-02-15' }, progress: P(1, 1) },
};
