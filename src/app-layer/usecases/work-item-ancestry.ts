/**
 * A work item's ancestry (sub-phase 3.2a; docs/porting/maps/3.2.md, "The
 * ancestry query"; ADR 0002 §2; decisions 211 and 220): "why does this item
 * exist", answered in one statement (`WorkItemRepository.ancestry`).
 *
 *   - Parents root-first, the project, its live initiative, that initiative's
 *     goal chain root-first, and the item's own direct goal's chain
 *     root-first (`null` when it names none). A deleted initiative or goal
 *     shows nothing (the walk stops at a deleted goal).
 *   - Read under `work_items.view`; 404 when the item is missing, deleted or
 *     invisible. The initiative and the goals are shown only to a caller who
 *     may read goals: otherwise each is left out and counted in
 *     `hiddenLevels`, never named.
 *   - Never a description; nothing is audited (a read).
 *
 * Written fresh for Islestone.
 */
import { formatKey } from '../domain/work-item-key';
import { WorkItemRepository, type AncestryRow } from '../repositories/WorkItemRepository';
import { mayReadGoals } from '../policies/goal.policies';
import { assertCanReadWorkItems } from '../policies/work-item.policies';
import { visibleProjects } from '../policies/project-visibility';
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { notFound } from '@/lib/errors/types';
import type { AncestryGoal, GoalStatusValue, WorkItemAncestry } from '@/lib/goals/types';

/** Rows of one kind, root first (the walk's depth counts up from the item or the nearest goal). */
function rootFirst(rows: readonly AncestryRow[], kind: AncestryRow['kind']): AncestryRow[] {
    return rows.filter((r) => r.kind === kind).sort((a, b) => b.depth - a.depth);
}

function goalOf(r: AncestryRow): AncestryGoal {
    return { id: r.id, title: r.label, status: (r.code ?? 'PLANNED') as GoalStatusValue, archived: r.archived };
}

/** Assemble the statement's rows (pure; the usecase and its tests share it). */
export function assembleAncestry(rows: readonly AncestryRow[], seesGoals: boolean): WorkItemAncestry | null {
    const project = rows.find((r) => r.kind === 'project');
    const items = rootFirst(rows, 'item');
    const self = items.find((r) => r.depth === 0);
    if (!project || !self) return null;
    const keyOf = (r: AncestryRow) => formatKey(project.code ?? '', r.num ?? 0);
    const initiativeRow = rows.find((r) => r.kind === 'initiative') ?? null;
    const goals = rootFirst(rows, 'goal').map(goalOf);
    const direct = rootFirst(rows, 'direct_goal').map(goalOf);
    const hiddenLevels = seesGoals ? 0 : (initiativeRow ? 1 : 0) + goals.length + direct.length;
    return {
        item: { id: self.id, key: keyOf(self), title: self.label },
        parents: items.filter((r) => r.depth > 0).map((r) => ({ id: r.id, key: keyOf(r), title: r.label })),
        project: { id: project.id, name: project.label, keyPrefix: project.code ?? '', archived: project.archived },
        initiative: seesGoals && initiativeRow ? { id: initiativeRow.id, name: initiativeRow.label, status: (initiativeRow.code ?? 'PLANNED') as GoalStatusValue, archived: initiativeRow.archived } : null,
        goals: seesGoals ? goals : [],
        directGoals: seesGoals && direct.length > 0 ? direct : null,
        hiddenLevels,
    };
}

export async function getWorkItemAncestry(ctx: RequestContext, id: string): Promise<WorkItemAncestry> {
    assertCanReadWorkItems(ctx);
    return runInTenantContext(ctx, async (db) => {
        const rows = await WorkItemRepository.ancestry(db, ctx, await visibleProjects(ctx, db), id);
        const ancestry = assembleAncestry(rows, mayReadGoals(ctx));
        if (!ancestry) throw notFound('Work item not found');
        return ancestry;
    });
}
