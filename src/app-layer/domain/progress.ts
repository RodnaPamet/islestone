/**
 * Progress, derived and never stored (sub-phase 3.2b; docs/porting/maps/3.2.md,
 * "Progress, derived"; owner decisions 211 and 212; milestones since 2.5b).
 *
 * Pure: no database, no clock, no zone. The callers read grouped counts of
 * live, visible items by state category and pass them in; this module turns
 * them into `{ scope, done, started }`:
 *
 *   - **scope** is every counted item that is not cancelled;
 *   - **done** the ones in a Done state, **started** the ones in a Started one;
 *   - zero items is "No items", never complete (`isComplete` needs a scope).
 *
 * A goal counts the items of its initiatives' projects (the project path) and
 * the items naming it, or a goal below it, directly (decision 211), each item
 * once. The reads group the project path by project and the direct path by
 * goal AND project, so `goalProgress` adds a direct row only when its project
 * is not already on the goal's project path: an item reached both ways is
 * counted through its project and never again.
 *
 * Written fresh for Islestone (generalised from 2.5b's `progressOf` and
 * `isLate`, which lived in `usecases/milestone.ts`).
 */
import type { WorkflowStateCategory } from '@prisma/client';

/** `{ scope, done, started }`: scope leaves cancelled items out. */
export interface Progress {
    scope: number;
    done: number;
    started: number;
}

export const NO_PROGRESS: Readonly<Progress> = Object.freeze({ scope: 0, done: 0, started: 0 });

/** One grouped count: a state category and how many items are in it. */
export interface CategoryCount {
    stateCategory: WorkflowStateCategory;
    count: number;
}

function add(p: Progress, row: CategoryCount): void {
    if (row.stateCategory === 'CANCELLED') return;
    p.scope += row.count;
    if (row.stateCategory === 'DONE') p.done += row.count;
    else if (row.stateCategory === 'STARTED') p.started += row.count;
}

/** The progress of one set of counts. */
export function progressOf(rows: Iterable<CategoryCount>): Progress {
    const p = { ...NO_PROGRESS };
    for (const r of rows) add(p, r);
    return p;
}

/** Counts keyed by something (a milestone, a project), tallied per key; rows with a `null` key are left out. */
export function progressByKey<K>(rows: Iterable<CategoryCount & { key: K | null }>): Map<K, Progress> {
    const out = new Map<K, Progress>();
    for (const r of rows) {
        if (r.key === null) continue;
        let p = out.get(r.key);
        if (!p) {
            p = { ...NO_PROGRESS };
            out.set(r.key, p);
        }
        add(p, r);
    }
    return out;
}

/** Several progresses added together (an initiative's projects; each item belongs to one project). */
export function sumProgress(parts: Iterable<Progress | undefined>): Progress {
    const p = { ...NO_PROGRESS };
    for (const part of parts) {
        if (!part) continue;
        p.scope += part.scope;
        p.done += part.done;
        p.started += part.started;
    }
    return p;
}

/** A direct-goal count: items naming `goalId`, of project `projectId`, in a category. */
export interface DirectGoalCount extends CategoryCount {
    goalId: string;
    projectId: string;
}

/**
 * A goal's progress (decisions 211 and 212): the items of the projects on its
 * project path (`projectIds`, the live projects of the live initiatives of the
 * goal and of every live goal below it), plus the items naming one of
 * `goalIds` (the goal and its live descendants) directly whose project is NOT
 * on the project path. Each item is counted once: it has one project, and a
 * direct row is added only when that project was not counted already.
 */
export function goalProgress(
    projectIds: ReadonlySet<string>,
    goalIds: ReadonlySet<string>,
    byProject: ReadonlyMap<string, Progress>,
    direct: Iterable<DirectGoalCount>,
): Progress {
    const p = sumProgress([...projectIds].map((id) => byProject.get(id)));
    for (const r of direct) {
        if (!goalIds.has(r.goalId) || projectIds.has(r.projectId)) continue;
        add(p, r);
    }
    return p;
}

/** Every item in scope is done, and there is at least one (zero items is never complete). */
export function isComplete(p: Progress): boolean {
    return p.scope > 0 && p.done === p.scope;
}

/**
 * "Late": a due date before `today` with open (scoped, not done) items left.
 * Dates are compared as given; the callers pass date-only values in one form
 * (a `Date` at UTC midnight, or epoch days).
 */
export function isLate(dueDate: Date | number | null, progress: Progress | { scope: number; done: number }, today: Date | number): boolean {
    if (dueDate === null) return false;
    const due = typeof dueDate === 'number' ? dueDate : dueDate.getTime();
    const on = typeof today === 'number' ? today : today.getTime();
    return due < on && progress.scope > progress.done;
}

/** The share done, 0 to 100, rounded; 0 for an empty scope (shown "No items", never 100 %). */
export function percentDone(p: { scope: number; done: number }): number {
    return p.scope === 0 ? 0 : Math.round((p.done / p.scope) * 100);
}
