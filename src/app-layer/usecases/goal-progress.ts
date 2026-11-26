/**
 * Goals' and initiatives' progress (sub-phase 3.2b; docs/porting/maps/3.2.md,
 * "Progress, derived"; owner decisions 211 and 212). Not stored, not cached,
 * no job: computed on every read of a goal, an initiative and their lists.
 *
 *   - **An initiative** counts the live, visible, non-cancelled items of its
 *     live projects, archived projects included (decision 212).
 *   - **A goal** counts the same for every live initiative of the goal and of
 *     every live goal below it, plus every such item naming the goal or a live
 *     goal below it directly (decision 211), each item once (`goalProgress`).
 *   - At most `GOAL_PROGRESS_PROJECT_CAP` projects per goal or initiative;
 *     above it the progress is refused with the count (`tooManyProjects`),
 *     never a cut count.
 *   - "Late": a due date before today in the workspace calendar's zone (as
 *     3.1, decision 191) with open items.
 *
 * Whatever the number of goals or initiatives shown, the reads are fixed: the
 * live goal tree, the initiatives, their projects, one grouped count by
 * project and one by direct goal (and the workspace calendar). Nothing is
 * read per row.
 *
 * Written fresh for Islestone.
 */
import { GoalRepository, GOALS_LIST_TAKE } from '../repositories/GoalRepository';
import { InitiativeRepository } from '../repositories/InitiativeRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import type { ProjectVisibility } from '../policies/project-visibility';
import { goalProgress, isLate, progressByKey, sumProgress, type DirectGoalCount, type Progress } from '../domain/progress';
import { toEpochDay, todayIn } from '../domain/schedule/calendar';
import { resolveWorkingCalendars } from './working-calendar';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { AppError } from '@/lib/errors/types';
import type { ProgressSummary } from '@/lib/goals/types';

/** The projects one goal's or initiative's progress counts at most (the `goalId` filter's cap, 3.2a). */
export const GOAL_PROGRESS_PROJECT_CAP = 1_000;
/** The projects one progress read reaches across every row shown. */
const PROGRESS_PROJECT_READ_CAP = 10_000;

function progressTooLarge(what: string, count: number, limit: number): AppError {
    return new AppError(`Progress here would count more than ${limit} ${what} (${count}).`, 'GOAL_PROGRESS_TOO_LARGE', 422, true, {
        reason: 'GOAL_PROGRESS_TOO_LARGE',
        count,
        limit,
    });
}

/** A row that shows no progress (a deleted one). */
export const NO_SUMMARY: ProgressSummary = Object.freeze({ progress: null, late: false, tooManyProjects: null });

/** Today, as an epoch day, in the workspace calendar's zone (3.1, decision 191). */
export async function workspaceToday(db: PrismaTx, ctx: Pick<RequestContext, 'tenantId'>): Promise<number> {
    const calendars = await resolveWorkingCalendars(db, ctx, []);
    return todayIn(calendars.workspace.timeZone, new Date());
}

function summaryOf(progress: Progress | null, projectCount: number, dueDate: Date | null, today: number): ProgressSummary {
    if (projectCount > GOAL_PROGRESS_PROJECT_CAP) return { progress: null, late: false, tooManyProjects: projectCount };
    return {
        progress,
        late: progress !== null && dueDate !== null && isLate(toEpochDay(dueDate), progress, today),
        tooManyProjects: null,
    };
}

async function projectLinks(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, initiativeIds: readonly string[]) {
    const links = await ProjectRepository.linksOfInitiatives(db, ctx, v, initiativeIds, PROGRESS_PROJECT_READ_CAP + 1);
    if (links.length > PROGRESS_PROJECT_READ_CAP) throw progressTooLarge('projects', links.length, PROGRESS_PROJECT_READ_CAP);
    return links;
}

async function byProjectProgress(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, projectIds: readonly string[]): Promise<Map<string, Progress>> {
    const rows = await WorkItemRepository.countsByProjects(db, ctx, v, projectIds);
    return progressByKey(rows.map((r) => ({ key: r.projectId, stateCategory: r.stateCategory, count: r.count })));
}

/** The progress of each project given, keyed by id (an initiative's projects table). */
export async function projectProgressInTx(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, projectIds: readonly string[]): Promise<Map<string, Progress>> {
    return byProjectProgress(db, ctx, v, projectIds);
}

/**
 * Each live initiative's progress summary, keyed by id. A deleted initiative
 * shows none (the caller passes only live rows).
 */
export async function initiativeSummariesInTx(
    db: PrismaTx,
    ctx: RequestContext,
    v: ProjectVisibility,
    rows: ReadonlyArray<{ id: string; dueDate: Date | null }>,
    today: number,
): Promise<Map<string, ProgressSummary>> {
    const out = new Map<string, ProgressSummary>();
    if (rows.length === 0) return out;
    const links = await projectLinks(db, ctx, v, rows.map((r) => r.id));
    const byProject = await byProjectProgress(db, ctx, v, [...new Set(links.map((l) => l.id))]);
    const projectsOf = new Map<string, string[]>();
    for (const l of links) projectsOf.set(l.initiativeId, [...(projectsOf.get(l.initiativeId) ?? []), l.id]);
    for (const r of rows) {
        const projects = projectsOf.get(r.id) ?? [];
        out.set(r.id, summaryOf(sumProgress(projects.map((id) => byProject.get(id))), projects.length, r.dueDate, today));
    }
    return out;
}

/** The live goals at or below `id` in a tree of live goals (each at most three deep). */
function liveSubtree(id: string, children: ReadonlyMap<string, readonly string[]>): Set<string> {
    const out = new Set<string>([id]);
    const stack = [id];
    while (stack.length > 0) {
        for (const c of children.get(stack.pop()!) ?? []) {
            if (out.has(c)) continue;
            out.add(c);
            stack.push(c);
        }
    }
    return out;
}

export interface GoalProgressRead {
    summaries: Map<string, ProgressSummary>;
    /** Live, visible, non-cancelled items naming exactly each goal (decision 211). */
    directItems: Map<string, number>;
}

/**
 * Each live goal's progress summary, keyed by id, over both paths (decisions
 * 211 and 212), each item counted once per goal.
 */
export async function goalSummariesInTx(
    db: PrismaTx,
    ctx: RequestContext,
    v: ProjectVisibility,
    rows: ReadonlyArray<{ id: string; dueDate: Date | null }>,
    today: number,
): Promise<GoalProgressRead> {
    const summaries = new Map<string, ProgressSummary>();
    const directItems = new Map<string, number>();
    if (rows.length === 0) return { summaries, directItems };
    const tree = await GoalRepository.liveTree(db, ctx, GOALS_LIST_TAKE + 1);
    if (tree.length > GOALS_LIST_TAKE) throw progressTooLarge('goals', tree.length, GOALS_LIST_TAKE);
    const children = new Map<string, string[]>();
    for (const g of tree) if (g.parentId) children.set(g.parentId, [...(children.get(g.parentId) ?? []), g.id]);
    const subtrees = new Map(rows.map((r) => [r.id, liveSubtree(r.id, children)]));
    const allGoals = [...new Set([...subtrees.values()].flatMap((s) => [...s]))];

    const initiatives = await InitiativeRepository.liveOfGoals(db, ctx, allGoals);
    const links = await projectLinks(db, ctx, v, initiatives.map((i) => i.id));
    const byProject = await byProjectProgress(db, ctx, v, [...new Set(links.map((l) => l.id))]);
    const direct: DirectGoalCount[] = (await WorkItemRepository.countsByGoals(db, ctx, v, allGoals)).flatMap((r) =>
        r.goalId ? [{ goalId: r.goalId, projectId: r.projectId, stateCategory: r.stateCategory, count: r._count._all }] : [],
    );

    const initiativesOf = new Map<string, string[]>();
    for (const i of initiatives) initiativesOf.set(i.goalId, [...(initiativesOf.get(i.goalId) ?? []), i.id]);
    const projectsOf = new Map<string, string[]>();
    for (const l of links) projectsOf.set(l.initiativeId, [...(projectsOf.get(l.initiativeId) ?? []), l.id]);

    for (const r of rows) {
        const goalIds = subtrees.get(r.id)!;
        const projectIds = new Set([...goalIds].flatMap((g) => (initiativesOf.get(g) ?? []).flatMap((i) => projectsOf.get(i) ?? [])));
        summaries.set(r.id, summaryOf(goalProgress(projectIds, goalIds, byProject, direct), projectIds.size, r.dueDate, today));
        directItems.set(r.id, direct.filter((d) => d.goalId === r.id).reduce((n, d) => n + d.count, 0));
    }
    return { summaries, directItems };
}
