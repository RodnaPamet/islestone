/**
 * A work item's direct goal (sub-phase 3.2a; docs/porting/maps/3.2.md, "The
 * item's direct goal"; ADR 0002 §2; owner decision 211).
 *
 *   - `WorkItem.goalId` is one goal of the workspace, set by a person on that
 *     item. It may be a goal the item's project's initiative does not serve.
 *     Nothing is inherited: a sub-item does not take its parent's, a new item
 *     does not take its project's initiative's goal, and moving a project to
 *     another initiative rewrites no item. A move to another project or team
 *     keeps it (goals are workspace-wide).
 *   - Setting it is a single-field change (`If-Match` optional, the version
 *     increases) under `work_items.edit`; naming a goal also asks
 *     `goals.view` (clearing needs only the edit key). The goal must be live
 *     (404 `GOAL_NOT_FOUND`) and unarchived (409 `GOAL_ARCHIVED`), read `FOR
 *     KEY SHARE` so a concurrent purge cannot remove it under the write; the
 *     field set must not hide it (400 `FIELD_HIDDEN`). Closed items may be
 *     given or cleared a goal, as their milestone may.
 *   - Audited `WORK_ITEM_GOAL_CHANGED` (the old and new goal ids); after the
 *     commit, the same watcher fan-out as a milestone change. The transition
 *     trigger does not watch it.
 *
 * Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import { assertFieldWrite } from './field-set';
import { GoalRepository } from '../repositories/GoalRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import { assertCanNameGoals } from '../policies/goal.policies';
import { assertCanEditWorkItems } from '../policies/work-item.policies';
import { visibleProjects } from '../policies/project-visibility';
import { goalNotFound, refuseArchivedLink } from './goal-shared';
import { getWorkItem } from './work-item';
import { emitWatcherActivity, keyOf, loadWritableItem, throwWriteConflict } from './work-item-shared';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';

/**
 * A goal an item may name: live (404 `GOAL_NOT_FOUND`) and unarchived (409
 * `GOAL_ARCHIVED`), read `FOR KEY SHARE` in the caller's workspace. Also
 * asks `goals.view`. Every create path and the goal write call it.
 */
export async function assertGoalLinkable(db: PrismaTx, ctx: RequestContext, goalId: string): Promise<{ id: string; title: string }> {
    assertCanNameGoals(ctx);
    const goal = await GoalRepository.lockForKeyShare(db, ctx, goalId);
    if (!goal || goal.deletedAt) goalNotFound();
    if (goal.archivedAt) refuseArchivedLink('goal', goal.title);
    return goal;
}

/** Name the item's goal, or clear it (`null`). */
export async function setWorkItemGoal(ctx: RequestContext, id: string, input: { goalId: string | null }, expectedVersion?: number) {
    assertCanEditWorkItems(ctx);
    if (input.goalId) assertCanNameGoals(ctx);
    const result = await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const item = await loadWritableItem(db, ctx, v, id);
        if (item.goalId === input.goalId) return { changed: false as const };
        await assertFieldWrite(db, ctx, item, { goalId: input.goalId });
        const to = input.goalId ? await assertGoalLinkable(db, ctx, input.goalId) : null;
        const count = await WorkItemRepository.updateVersioned(db, ctx, v, id, expectedVersion, { goalId: to?.id ?? null });
        if (count === 0) await throwWriteConflict(db, ctx, v, id);
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_GOAL_CHANGED',
            entityType: 'WorkItem',
            entityId: id,
            details: to ? `Linked ${keyOf(item)} to goal ${to.title}` : `Took ${keyOf(item)} off its goal`,
            detailsJson: { category: 'custom', event: 'goal_changed', fromGoalId: item.goalId, toGoalId: to?.id ?? null },
            metadata: { fromGoalId: item.goalId, toGoalId: to?.id ?? null },
        });
        return { changed: true as const, detail: to ? `goal ${to.title}` : 'goal cleared' };
    });
    const after = await getWorkItem(ctx, id);
    if (result.changed) {
        await emitWatcherActivity(ctx, [{ workItemId: id, kind: 'updated', discriminator: `v${after.version}`, detail: result.detail }]);
    }
    return after;
}
