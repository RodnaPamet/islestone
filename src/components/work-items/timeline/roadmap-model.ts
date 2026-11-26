/**
 * The roadmap's view model (sub-phase 3.2c; docs/porting/maps/3.2.md, "The
 * client"; owner decisions 210, 215, 216 and 217): the adapter's second row
 * model, beside `timeline-model.ts`. Pure, so the chart, the table and the
 * "No dates" list are built from ONE reading of the server's answer and
 * tested without a browser. It decides nothing: every span, progress and
 * flag is the server's (`getRoadmap`); this module only lays the rows out.
 *
 *   - **Rows.** Grouped by initiative (the default): each initiative, then
 *     "No initiative", each holding its projects. Grouped by goal: the goal
 *     tree, each goal holding its child goals and its initiatives, then "No
 *     goal" for the initiatives serving none, then "No initiative".
 *   - **A bar is the server's span** (decision 215). A row drawn as a bar is
 *     a plain task, never the widget's summary type, so the widget cannot
 *     widen it to cover a diamond: an initiative's bar is exactly the span of
 *     its projects.
 *   - **Diamonds** (decision 210): a goal's, an initiative's and a project's
 *     due date, and each dated milestone, as milestone tasks under their
 *     row; flagged (`late`) when a project finishes after the goal's or
 *     initiative's due date, or the milestone is late.
 *   - **No span, no bar**: the row goes in the "No dates" list (its diamond,
 *     if it has one, is still drawn).
 *   - **Every row opens the timeline** (decision 217): a project its own page
 *     in the Timeline layout, an initiative or a goal the Work items page in
 *     the Timeline layout filtered by `initiativeId` or `goalId`.
 *
 * Written fresh for Islestone.
 */
import { fromEpochDay, toEpochDay } from '@/app-layer/domain/schedule/calendar';
import type { HealthValue, ProgressData } from '@/lib/goals/types';
import type { RoadmapGoal, RoadmapInitiative, RoadmapProject, RoadmapResponse, RoadmapSpan } from '@/lib/goals/roadmap';

import { treeOrder, type ChartTask } from './timeline-model';

export type RoadmapZoom = 'month' | 'quarter';
export const ROADMAP_ZOOMS: readonly RoadmapZoom[] = ['month', 'quarter'];
export const DEFAULT_ROADMAP_ZOOM: RoadmapZoom = 'quarter';

/** Where a row's "Open timeline" goes (decision 217). */
export type RoadmapTarget = { kind: 'project'; keyPrefix: string } | { kind: 'initiative'; id: string } | { kind: 'goal'; id: string };

/** The page a row's timeline is (decision 217): a tenant-relative path; the scope is decision 220's list filter. */
export function timelinePathOf(target: RoadmapTarget): string {
    if (target.kind === 'project') return `/projects/${encodeURIComponent(target.keyPrefix)}?layout=timeline`;
    const key = target.kind === 'initiative' ? 'initiativeId' : 'goalId';
    return `/work-items?layout=timeline&${key}=${encodeURIComponent(target.id)}`;
}

/** Why a row is flagged; the page words each one. */
export type RoadmapFlag = 'overdue' | 'itemDueAfter' | 'lateMilestones' | 'finishesAfterInitiativeDue' | 'finishesAfterGoalDue' | 'finishesAfterDue' | 'late';

export type RoadmapRowKind = 'goal' | 'initiative' | 'project' | 'unlinked' | 'no-goal';

/** One row of the table (decision 203's rule, applied again): the same rows and numbers as the chart. */
export interface RoadmapTableRow {
    /** The chart task's id. */
    id: string;
    kind: RoadmapRowKind;
    depth: number;
    name: string;
    /** The goal, initiative and project the row sits under (or is). */
    goal: string | null;
    initiative: string | null;
    project: string | null;
    start: string | null;
    finish: string | null;
    dueDate: string | null;
    progress: ProgressData | null;
    /** `undefined` for a row that carries no health (a project, a group). */
    health: HealthValue | null | undefined;
    flags: RoadmapFlag[];
    lateMilestones: number;
    archived: boolean;
    target: RoadmapTarget | null;
}

export interface RoadmapModel {
    tasks: ChartTask[];
    table: RoadmapTableRow[];
    /** Rows with no bar (nothing under them is dated): beside the chart. */
    noDates: RoadmapTableRow[];
    /** The span the chart shows, `YYYY-MM-DD`, inclusive. */
    range: { start: string; end: string };
    asOf: string;
}

/** The grid's progress and health cells, keyed by chart task id. */
export interface RoadmapCells {
    progress: ProgressData | null;
    health: HealthValue | null | undefined;
}

const minDay = (a: string, b: string) => (a < b ? a : b);
const maxDay = (a: string, b: string) => (a > b ? a : b);
const addDays = (day: string, n: number) => fromEpochDay(toEpochDay(day) + n);

const BASE = { key: '', critical: false, late: false, lateDays: 0, conflicts: [] as const, context: false, done: false, totalFloat: null } satisfies Partial<ChartTask>;

export const roadmapTaskId = {
    goal: (id: string) => `goal:${id}`,
    initiative: (id: string) => `initiative:${id}`,
    project: (id: string) => `project:${id}`,
    unlinked: 'unlinked',
    noGoal: 'no-goal',
} as const;

function projectFlags(p: RoadmapProject): RoadmapFlag[] {
    const out: RoadmapFlag[] = [];
    if (p.overdue) out.push('overdue');
    if (p.itemDueAfter) out.push('itemDueAfter');
    if (p.lateMilestones > 0) out.push('lateMilestones');
    if (p.finishesAfterInitiativeDue) out.push('finishesAfterInitiativeDue');
    if (p.finishesAfterGoalDue) out.push('finishesAfterGoalDue');
    return out;
}

function recordFlags(r: RoadmapGoal | RoadmapInitiative): RoadmapFlag[] {
    const out: RoadmapFlag[] = [];
    if (r.late) out.push('late');
    if (r.finishesAfterDue) out.push('finishesAfterDue');
    return out;
}

export function buildRoadmapModel(resp: RoadmapResponse, labels: { unlinked: string; noGoal: string }): { model: RoadmapModel; cells: ReadonlyMap<string, RoadmapCells> } {
    const tasks: ChartTask[] = [];
    const table: RoadmapTableRow[] = [];
    const cells = new Map<string, RoadmapCells>();
    const goalsById = new Map(resp.goals.map((g) => [g.id, g]));
    const milestonesOf = new Map<string, typeof resp.milestones>();
    for (const m of resp.milestones) milestonesOf.set(m.projectId, [...(milestonesOf.get(m.projectId) ?? []), m]);
    const projectsOf = new Map<string | null, RoadmapProject[]>();
    for (const p of resp.projects) projectsOf.set(p.initiativeId, [...(projectsOf.get(p.initiativeId) ?? []), p]);

    const bar = (id: string, parent: string | 0, text: string, key: string, span: RoadmapSpan | null, kind: ChartTask['kind'], opts: { late?: boolean; done?: boolean } = {}) => {
        if (!span) return false;
        tasks.push({ ...BASE, id, parent, type: 'task', text, key, start: span.start, end: span.end, kind, late: opts.late ?? false, done: opts.done ?? false });
        return true;
    };
    const diamond = (id: string, parent: string | 0, text: string, date: string | null, kind: ChartTask['kind'], late: boolean) => {
        if (!date) return;
        tasks.push({ ...BASE, id, parent, type: 'milestone', text, key: '', start: date, end: date, kind, late });
    };
    const goalNameOf = (id: string | null) => (id ? (goalsById.get(id)?.title ?? null) : null);

    const addProject = (p: RoadmapProject, parent: string | 0, depth: number, initiative: RoadmapInitiative | undefined) => {
        const id = roadmapTaskId.project(p.id);
        const drawn = bar(id, parent, p.name, p.keyPrefix, p.span, 'roadmap-project', { late: p.late, done: p.archived });
        diamond(`due:${id}`, drawn ? id : parent, p.name, p.dueDate, 'project-due', p.overdue || p.itemDueAfter);
        for (const m of milestonesOf.get(p.id) ?? []) diamond(`milestone:${m.id}`, drawn ? id : parent, m.name, m.dueDate, 'milestone', m.late);
        cells.set(id, { progress: p.progress, health: undefined });
        const row: RoadmapTableRow = {
            id,
            kind: 'project',
            depth,
            name: p.name,
            goal: goalNameOf(initiative?.goalId ?? null),
            initiative: initiative?.name ?? null,
            project: p.name,
            start: p.span?.start ?? null,
            finish: p.span?.end ?? null,
            dueDate: p.dueDate,
            progress: p.progress,
            health: undefined,
            flags: projectFlags(p),
            lateMilestones: p.lateMilestones,
            archived: p.archived,
            target: { kind: 'project', keyPrefix: p.keyPrefix },
        };
        table.push(row);
    };

    const addInitiative = (i: RoadmapInitiative, parent: string | 0, depth: number) => {
        const id = roadmapTaskId.initiative(i.id);
        const drawn = bar(id, parent, i.name, '', i.span, 'initiative', { late: i.late, done: i.archived });
        diamond(`due:${id}`, drawn ? id : parent, i.name, i.dueDate, 'initiative-due', i.finishesAfterDue);
        cells.set(id, { progress: i.progress, health: i.health });
        table.push({
            id,
            kind: 'initiative',
            depth,
            name: i.name,
            goal: goalNameOf(i.goalId),
            initiative: i.name,
            project: null,
            start: i.span?.start ?? null,
            finish: i.span?.end ?? null,
            dueDate: i.dueDate,
            progress: i.progress,
            health: i.health,
            flags: recordFlags(i),
            lateMilestones: 0,
            archived: i.archived,
            target: { kind: 'initiative', id: i.id },
        });
        for (const p of projectsOf.get(i.id) ?? []) addProject(p, drawn ? id : parent, depth + 1, i);
    };

    const addUnlinked = (label: string, depth: number) => {
        const projects = projectsOf.get(null) ?? [];
        if (!resp.unlinked.shown || projects.length === 0) return;
        const drawn = bar(roadmapTaskId.unlinked, 0, label, '', resp.unlinked.span, 'unlinked');
        cells.set(roadmapTaskId.unlinked, { progress: resp.unlinked.progress, health: undefined });
        table.push({
            id: roadmapTaskId.unlinked,
            kind: 'unlinked',
            depth,
            name: label,
            goal: null,
            initiative: null,
            project: null,
            start: resp.unlinked.span?.start ?? null,
            finish: resp.unlinked.span?.end ?? null,
            dueDate: null,
            progress: resp.unlinked.progress,
            health: undefined,
            flags: [],
            lateMilestones: 0,
            archived: false,
            target: null,
        });
        for (const p of projects) addProject(p, drawn ? roadmapTaskId.unlinked : 0, depth + 1, undefined);
    };

    if (resp.groupBy === 'goal') {
        const shown = new Set(resp.goals.map((g) => g.id));
        const childGoals = new Map<string | null, RoadmapGoal[]>();
        for (const g of resp.goals) {
            const parent = g.parentId && shown.has(g.parentId) ? g.parentId : null;
            childGoals.set(parent, [...(childGoals.get(parent) ?? []), g]);
        }
        const initiativesOfGoal = new Map<string | null, RoadmapInitiative[]>();
        for (const i of resp.initiatives) {
            const key = i.goalId && shown.has(i.goalId) ? i.goalId : null;
            initiativesOfGoal.set(key, [...(initiativesOfGoal.get(key) ?? []), i]);
        }
        const addGoal = (g: RoadmapGoal, parent: string | 0, depth: number, seen: Set<string>) => {
            if (seen.has(g.id)) return;
            seen.add(g.id);
            const id = roadmapTaskId.goal(g.id);
            const drawn = bar(id, parent, g.title, '', g.span, 'goal', { late: g.late, done: g.archived });
            diamond(`due:${id}`, drawn ? id : parent, g.title, g.dueDate, 'goal-due', g.finishesAfterDue);
            cells.set(id, { progress: g.progress, health: g.health });
            table.push({
                id,
                kind: 'goal',
                depth,
                name: g.title,
                goal: g.title,
                initiative: null,
                project: null,
                start: g.span?.start ?? null,
                finish: g.span?.end ?? null,
                dueDate: g.dueDate,
                progress: g.progress,
                health: g.health,
                flags: recordFlags(g),
                lateMilestones: 0,
                archived: g.archived,
                target: { kind: 'goal', id: g.id },
            });
            const under = drawn ? id : parent;
            for (const c of childGoals.get(g.id) ?? []) addGoal(c, under, depth + 1, seen);
            for (const i of initiativesOfGoal.get(g.id) ?? []) addInitiative(i, under, depth + 1);
        };
        const seen = new Set<string>();
        for (const g of childGoals.get(null) ?? []) addGoal(g, 0, 0, seen);
        const orphans = initiativesOfGoal.get(null) ?? [];
        if (orphans.length > 0) {
            const spans = orphans.flatMap((i) => (i.span ? [i.span] : []));
            const span = spans.length > 0 ? { start: spans.map((s) => s.start).reduce(minDay), end: spans.map((s) => s.end).reduce(maxDay) } : null;
            const drawn = bar(roadmapTaskId.noGoal, 0, labels.noGoal, '', span, 'no-goal');
            cells.set(roadmapTaskId.noGoal, { progress: null, health: undefined });
            table.push({
                id: roadmapTaskId.noGoal,
                kind: 'no-goal',
                depth: 0,
                name: labels.noGoal,
                goal: null,
                initiative: null,
                project: null,
                start: span?.start ?? null,
                finish: span?.end ?? null,
                dueDate: null,
                progress: null,
                health: undefined,
                flags: [],
                lateMilestones: 0,
                archived: false,
                target: null,
            });
            for (const i of orphans) addInitiative(i, drawn ? roadmapTaskId.noGoal : 0, 1);
        }
    } else {
        for (const i of resp.initiatives) addInitiative(i, 0, 0);
    }
    addUnlinked(labels.unlinked, 0);

    const ordered = treeOrder(tasks);
    const bounds = ordered.length > 0 ? { start: ordered.map((t) => t.start).reduce(minDay), end: ordered.map((t) => t.end).reduce(maxDay) } : { start: resp.asOf, end: resp.asOf };
    const range = { start: addDays(minDay(bounds.start, resp.asOf), -14), end: addDays(maxDay(bounds.end, resp.asOf), 45) };
    const noDates = table.filter((r) => r.start === null && r.kind !== 'unlinked' && r.kind !== 'no-goal');
    return { model: { tasks: ordered, table, noDates, range, asOf: resp.asOf }, cells };
}
