/**
 * The roadmap's view model (sub-phase 3.2c; decisions 210, 215 and 217): the
 * rows, bars and diamonds the chart draws, the table, the "No dates" list,
 * and where each row's timeline is. It lays out the server's answer and
 * decides nothing.
 */
import { buildRoadmapModel, roadmapTaskId, timelinePathOf } from '@/components/work-items/timeline/roadmap-model';
import type { RoadmapResponse } from '@/lib/goals/roadmap';

import { goal, initiative, project, ROADMAP } from '../../helpers/roadmap-fixture';

const LABELS = { unlinked: 'No initiative', noGoal: 'No goal' };

describe('the roadmap model, grouped by initiative', () => {
    const { model, cells } = buildRoadmapModel(ROADMAP, LABELS);
    const task = (id: string) => model.tasks.find((t) => t.id === id);

    it('draws an initiative as a plain task spanning exactly the server\'s span, its projects under it', () => {
        expect(task(roadmapTaskId.initiative('i1'))).toMatchObject({ type: 'task', parent: 0, start: '2051-03-03', end: '2051-05-31', kind: 'initiative' });
        expect(task(roadmapTaskId.project('p1'))).toMatchObject({ type: 'task', parent: 'initiative:i1', start: '2051-03-03', end: '2051-04-17', kind: 'roadmap-project' });
        expect(task(roadmapTaskId.project('p2'))).toMatchObject({ late: true });
    });

    it('draws due dates as diamonds under their row, flagged when a project finishes after them', () => {
        expect(task('due:initiative:i1')).toMatchObject({ type: 'milestone', parent: 'initiative:i1', start: '2051-04-30', end: '2051-04-30', kind: 'initiative-due', late: true });
        expect(task('due:project:p1')).toMatchObject({ parent: 'project:p1', start: '2051-04-20', kind: 'project-due', late: false });
        expect(task('milestone:m1')).toMatchObject({ parent: 'project:p2', start: '2051-05-15', kind: 'milestone', late: true });
    });

    it('puts an undated record in "No dates", keeping its diamond, and draws no bar for it', () => {
        expect(task(roadmapTaskId.initiative('i2'))).toBeUndefined();
        expect(task(roadmapTaskId.project('p4'))).toBeUndefined();
        expect(task('due:project:p4')).toMatchObject({ parent: 0, start: '2051-06-01' });
        expect(model.noDates.map((r) => r.id)).toEqual(['initiative:i2', 'project:p4']);
    });

    it('holds the unlinked projects under "No initiative", last', () => {
        expect(task(roadmapTaskId.unlinked)).toMatchObject({ text: 'No initiative', start: '2051-02-15', end: '2051-02-15' });
        expect(task(roadmapTaskId.project('p3'))).toMatchObject({ parent: 'unlinked' });
        expect(model.table.at(-1)?.id).toBe('project:p3');
    });

    it('orders parents before children (the widget builds its tree from `parent`)', () => {
        const seen = new Set<string>();
        for (const t of model.tasks) {
            if (t.parent !== 0) expect(seen.has(t.parent)).toBe(true);
            seen.add(t.id);
        }
    });

    it('fills the table with the same rows: goal, initiative and project, dates, progress, health, flags and the timeline', () => {
        const p2 = model.table.find((r) => r.id === 'project:p2')!;
        expect(p2).toMatchObject({ goal: 'Grow', initiative: 'Launch', project: 'Beta', start: '2051-05-02', finish: '2051-05-31', flags: ['lateMilestones', 'finishesAfterInitiativeDue'], lateMilestones: 1 });
        expect(p2.target).toEqual({ kind: 'project', keyPrefix: 'BET' });
        expect(model.table.find((r) => r.id === 'initiative:i1')).toMatchObject({ health: 'AT_RISK', flags: ['finishesAfterDue'], target: { kind: 'initiative', id: 'i1' } });
        expect(cells.get('initiative:i1')).toEqual({ progress: { scope: 10, done: 4, started: 0 }, health: 'AT_RISK' });
        expect(cells.get('project:p1')?.health).toBeUndefined();
    });

    it('shows today and a margin in the chart\'s range', () => {
        expect(model.range.start <= '2051-02-15').toBe(true);
        expect(model.range.end >= '2051-06-01').toBe(true);
    });
});

describe('the roadmap model, grouped by goal', () => {
    const resp: RoadmapResponse = {
        ...ROADMAP,
        groupBy: 'goal',
        goals: [goal('g1', { title: 'Grow', span: { start: '2051-02-01', end: '2051-09-01' }, dueDate: '2051-05-15', finishesAfterDue: true }), goal('g2', { title: 'Abroad', parentId: 'g1', span: null })],
        initiatives: [initiative('i1', { goalId: 'g1', span: { start: '2051-03-03', end: '2051-05-31' } }), initiative('i3', { goalId: null, span: { start: '2051-07-01', end: '2051-07-31' } })],
        projects: [project('p1', { initiativeId: 'i1', span: { start: '2051-03-03', end: '2051-04-17' } }), project('p9', { initiativeId: 'i3', span: { start: '2051-07-01', end: '2051-07-31' } })],
        milestones: [],
        unlinked: { shown: false, span: null, progress: { scope: 0, done: 0, started: 0 } },
    };
    const { model } = buildRoadmapModel(resp, LABELS);
    const task = (id: string) => model.tasks.find((t) => t.id === id);

    it('nests goals, then their initiatives, and gathers initiatives serving no goal under "No goal"', () => {
        expect(task('goal:g1')).toMatchObject({ parent: 0, kind: 'goal', start: '2051-02-01', end: '2051-09-01' });
        expect(task('due:goal:g1')).toMatchObject({ kind: 'goal-due', late: true });
        expect(task('initiative:i1')).toMatchObject({ parent: 'goal:g1' });
        expect(task('no-goal')).toMatchObject({ text: 'No goal', start: '2051-07-01', end: '2051-07-31' });
        expect(task('initiative:i3')).toMatchObject({ parent: 'no-goal' });
        expect(model.table.find((r) => r.id === 'goal:g2')).toMatchObject({ depth: 1, target: { kind: 'goal', id: 'g2' } });
        expect(model.noDates.map((r) => r.id)).toEqual(['goal:g2']);
        expect(task(roadmapTaskId.unlinked)).toBeUndefined();
    });
});

describe('a row opens the item timeline (decision 217)', () => {
    it('a project its page in the Timeline layout; an initiative or a goal the Work items page filtered by it', () => {
        expect(timelinePathOf({ kind: 'project', keyPrefix: 'ALP' })).toBe('/projects/ALP?layout=timeline');
        expect(timelinePathOf({ kind: 'initiative', id: 'i1' })).toBe('/work-items?layout=timeline&initiativeId=i1');
        expect(timelinePathOf({ kind: 'goal', id: 'g1' })).toBe('/work-items?layout=timeline&goalId=g1');
    });
});
