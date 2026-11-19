/**
 * Moving work items (sub-phase 2.2, ADR 0002 §2, §5 and §10): reorder,
 * re-parent, and move to another project (which may be another team's).
 * Each verb is one transaction.
 *
 *   - Reorder writes one `sortKey` between the two neighbours and does not
 *     increase the version (order belongs to the list, ADR 0002 §5).
 *   - Re-parent takes the graph lock FIRST, then refuses a parent in another
 *     project, the item itself or one of its descendants (a cycle), and a
 *     depth past five levels counting the moved subtree's own height.
 *   - A move to another project is refused for a sub-item on its own (owner
 *     decision, 2026-11-19). It moves the item's whole live subtree in one
 *     transaction: each row gets a new number from the destination's
 *     sequence and keeps its old key in `WorkItemKeyAlias`; the conditional
 *     `UPDATE … WHERE projectId = <source>` refuses a concurrent move. To a
 *     project of another team, each item's state maps to the destination
 *     team's default state of the same category, written in the same UPDATE
 *     as `teamId` (the composite foreign keys check them together), and the
 *     old team's labels are detached. Cycles and milestones (2.5) have
 *     nothing to clear yet; a guest assignee who cannot see the destination
 *     (8.4) has nothing to clear while guests are not assignable.
 *   - A board drop (sub-phase 2.3) changes the state and the place among the
 *     destination column's neighbours in ONE transaction, with the state
 *     change's audit entry and effects as `setWorkItemState` writes them and
 *     the reorder's own entry; after the COMMIT, the state change's
 *     automation event and watcher fan-out. The state half is versioned
 *     (`If-Match` optional, as for the state route); the place is not.
 *   - Source and destination sequences are locked in id order (Kaneo
 *     `move-task.ts` at fb890b4974e6dd6c232f1de6a6b70a591dfca0a3; pattern
 *     only), after the graph lock.
 *
 * Written fresh for Islestone.
 */
import type { WorkflowStateCategory } from '@prisma/client';

import { logEvent } from '../events/audit';
import { LabelRepository } from '../repositories/LabelRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { TeamRepository } from '../repositories/TeamRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import { assertCanCreateWorkItem, assertCanEditWorkItems } from '../policies/work-item.policies';
import { visibleProjects } from '../policies/project-visibility';
import { formatKey } from '../domain/work-item-key';
import { checkWorkflowStateTransition, formatStateTransitionError, stateTransitionEffects } from '../domain/workflow-state';
import { lockWorkItemGraph } from './work-item-graph-lock';
import { afterStateCommit, applyStateAudit, assertParentAllowed, getWorkItem, sortKeyForPosition } from './work-item';
import { assertProjectWritable, emitWatcherActivity, keyOf, loadWritableItem, throwWriteConflict } from './work-item-shared';
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { ConflictError, badRequest, notFound } from '@/lib/errors/types';

export interface Position {
    afterId?: string;
    beforeId?: string;
}

export async function reorderWorkItem(ctx: RequestContext, id: string, position: Position) {
    assertCanEditWorkItems(ctx);
    if (!position.afterId && !position.beforeId) throw badRequest('Give afterId or beforeId.');
    await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const item = await loadWritableItem(db, ctx, v, id);
        // Placements in one project are serialised on its key sequence row.
        await ProjectRepository.lockSequences(db, ctx, [item.projectId]);
        const sortKey = await sortKeyForPosition(db, ctx, item.projectId, position, id);
        await WorkItemRepository.setSortKey(db, ctx, v, id, sortKey);
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_REORDERED',
            entityType: 'WorkItem',
            entityId: id,
            details: `Reordered ${keyOf(item)}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItem', operation: 'updated', changedFields: ['sortKey'] },
            metadata: { afterId: position.afterId ?? null, beforeId: position.beforeId ?? null },
        });
    });
    return getWorkItem(ctx, id);
}

/**
 * A board drop: move the item to `stateId` (a state of its team; a refusal
 * names the reason) and, when a `position` is given, between the neighbours
 * it names. A drop into the item's own column is a plain reorder.
 */
export async function moveWorkItemOnBoard(
    ctx: RequestContext,
    id: string,
    input: { stateId: string; position?: Position },
    expectedVersion?: number,
) {
    assertCanEditWorkItems(ctx);
    const outcome = await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const item = await loadWritableItem(db, ctx, v, id);
        let change: Parameters<typeof afterStateCommit>[1][number] | null = null;
        if (item.stateId !== input.stateId) {
            const [from, to] = await Promise.all([TeamRepository.getState(db, ctx, item.stateId), TeamRepository.getState(db, ctx, input.stateId)]);
            if (!to) throw notFound('Workflow state not found');
            const err = checkWorkflowStateTransition(from!, to);
            if (err) throw badRequest(formatStateTransitionError(err), { reason: err.kind });
            const count = await WorkItemRepository.updateVersioned(db, ctx, v, id, expectedVersion, {
                stateId: to.id,
                stateCategory: to.category,
                ...stateTransitionEffects(from!.category, to.category, item),
            });
            if (count === 0) await throwWriteConflict(db, ctx, v, id);
            await applyStateAudit(db, ctx, item, from!, to);
            change = { item, from: from!, to };
        }
        if (input.position && (input.position.afterId || input.position.beforeId)) {
            await ProjectRepository.lockSequences(db, ctx, [item.projectId]);
            await WorkItemRepository.setSortKey(db, ctx, v, id, await sortKeyForPosition(db, ctx, item.projectId, input.position, id));
            await logEvent(db, ctx, {
                action: 'WORK_ITEM_REORDERED',
                entityType: 'WorkItem',
                entityId: id,
                details: `Reordered ${keyOf(item)}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItem', operation: 'updated', changedFields: ['sortKey'] },
                metadata: { afterId: input.position.afterId ?? null, beforeId: input.position.beforeId ?? null },
            });
        }
        return change;
    });
    if (outcome) await afterStateCommit(ctx, [outcome]);
    return getWorkItem(ctx, id);
}

export async function reparentWorkItem(
    ctx: RequestContext,
    id: string,
    input: { parentId: string | null; position?: Position },
    expectedVersion?: number,
) {
    assertCanEditWorkItems(ctx);
    const moved = await runInTenantContext(ctx, async (db) => {
        // FIRST: the graph lock (ADR 0002 §6), before any row read.
        await lockWorkItemGraph(db, ctx.tenantId);
        const v = await visibleProjects(ctx, db);
        const item = await loadWritableItem(db, ctx, v, id);
        if (item.parentId === input.parentId) return { item, changed: false };
        if (input.parentId) {
            const height = await WorkItemRepository.subtreeHeight(db, ctx, id);
            await assertParentAllowed(db, ctx, v, input.parentId, { id, projectId: item.projectId, subtreeHeight: height });
        }
        const count = await WorkItemRepository.updateVersioned(db, ctx, v, id, expectedVersion, { parentId: input.parentId });
        if (count === 0) await throwWriteConflict(db, ctx, v, id);
        if (input.position && (input.position.afterId || input.position.beforeId)) {
            await ProjectRepository.lockSequences(db, ctx, [item.projectId]);
            await WorkItemRepository.setSortKey(db, ctx, v, id, await sortKeyForPosition(db, ctx, item.projectId, input.position, id));
        }
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_REPARENTED',
            entityType: 'WorkItem',
            entityId: id,
            details: `Moved ${keyOf(item)} ${input.parentId ? 'under another work item' : 'to the top level'}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItem', operation: 'updated', changedFields: ['parentId'] },
            metadata: { fromParentId: item.parentId, toParentId: input.parentId },
        });
        return { item, changed: true };
    });
    if (moved.changed) {
        await emitWatcherActivity(ctx, [
            {
                workItemId: id,
                kind: 'updated',
                discriminator: `parent:${input.parentId ?? 'none'}`,
                detail: input.parentId ? 'moved under another work item' : 'moved to the top level',
            },
        ]);
    }
    return getWorkItem(ctx, id);
}

export async function moveWorkItemToProject(ctx: RequestContext, id: string, input: { projectId: string; position?: Position }) {
    assertCanEditWorkItems(ctx);
    // The destination receives new items: its create gate applies too.
    assertCanCreateWorkItem(ctx);
    const outcome = await runInTenantContext(ctx, async (db) => {
        await lockWorkItemGraph(db, ctx.tenantId);
        const v = await visibleProjects(ctx, db);
        const item = await loadWritableItem(db, ctx, v, id);
        if (item.parentId) {
            throw new ConflictError('A sub-item moves to another project only with its parent.', { reason: 'SUB_ITEM_MOVE_REFUSED' });
        }
        if (item.projectId === input.projectId) throw badRequest('The work item is already in that project.');
        const dest = await ProjectRepository.getVisible(db, ctx, v, input.projectId);
        if (!dest) throw notFound('Project not found');
        assertProjectWritable(dest);
        await ProjectRepository.lockSequences(db, ctx, [item.projectId, dest.id]);

        const subtree = await WorkItemRepository.liveSubtree(db, ctx, [id]);
        const depthOf = new Map(subtree.map((r) => [r.id, r.depth]));
        const rows = (await WorkItemRepository.listByIds(db, ctx, v, subtree.map((r) => r.id))).sort(
            (a, b) => (depthOf.get(a.id) ?? 0) - (depthOf.get(b.id) ?? 0) || (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0),
        );

        const crossTeam = dest.teamId !== item.teamId;
        const stateFor = new Map<WorkflowStateCategory, { id: string; category: WorkflowStateCategory }>();
        if (crossTeam) {
            const destStates = await TeamRepository.liveStatesOfTeams(db, ctx, [dest.teamId]);
            for (const category of new Set(rows.map((r) => r.stateCategory))) {
                const ofCategory = destStates.filter((s) => s.category === category);
                const target = ofCategory.find((s) => s.isDefault) ?? ofCategory[0];
                if (!target) {
                    throw new ConflictError(`The destination team has no live ${category} state.`, {
                        reason: 'NO_STATE_OF_CATEGORY',
                        category,
                    });
                }
                stateFor.set(category, target);
            }
        }

        const first = await ProjectRepository.claimNumbers(db, ctx, dest.id, rows.length);
        const rootKey = await sortKeyForPosition(db, ctx, dest.id, input.position);
        const stateRemapped: Array<{ id: string; fromStateId: string; toStateId: string }> = [];
        const aliases: Array<{ projectId: string; number: number; workItemId: string }> = [];
        let n = first;
        for (const row of rows) {
            const target = crossTeam ? stateFor.get(row.stateCategory)! : { id: row.stateId, category: row.stateCategory };
            if (crossTeam) stateRemapped.push({ id: row.id, fromStateId: row.stateId, toStateId: target.id });
            const count = await WorkItemRepository.moveRow(db, ctx, row.id, item.projectId, {
                projectId: dest.id,
                teamId: dest.teamId,
                number: n,
                stateId: target.id,
                stateCategory: target.category,
                ...(row.id === id ? { sortKey: rootKey } : {}),
            });
            if (count === 0) {
                throw new ConflictError('The work item was moved by someone else.', { reason: 'CONCURRENT_MOVE' });
            }
            aliases.push({ projectId: item.projectId, number: row.number, workItemId: row.id });
            n += 1;
        }
        await WorkItemRepository.createAliases(db, ctx, aliases);
        if (crossTeam) await LabelRepository.detachTeamLabels(db, ctx, rows.map((r) => r.id), item.teamId);

        const fromKey = keyOf(item);
        const toKey = formatKey(dest.keyPrefix, first);
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_MOVED',
            entityType: 'WorkItem',
            entityId: id,
            details: `Moved ${fromKey} to ${toKey}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItem', operation: 'updated', changedFields: ['projectId'] },
            metadata: {
                fromProjectId: item.projectId,
                toProjectId: dest.id,
                fromKey,
                toKey,
                movedCount: rows.length,
                stateRemapped,
            },
        });
        return { fromKey, toKey, movedCount: rows.length };
    });
    await emitWatcherActivity(ctx, [
        { workItemId: id, kind: 'updated', discriminator: `move:${outcome.toKey}`, detail: `moved from ${outcome.fromKey} to ${outcome.toKey}` },
    ]);
    return { ...outcome, item: await getWorkItem(ctx, id) };
}
