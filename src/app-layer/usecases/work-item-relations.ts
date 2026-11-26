/**
 * Relations between work items (sub-phases 2.1–2.2, ADR 0002 §6).
 *
 *   - BLOCKS is directed and refused when it would close a cycle: a recursive
 *     `UNION` query over every BLOCKS edge (edges to deleted items included),
 *     run after taking the workspace's graph lock FIRST, so two concurrent
 *     inserts cannot each pass the check and together close a cycle.
 *   - RELATES is symmetric and stored once with `fromId < toId` (a CHECK holds
 *     it too).
 *   - DUPLICATES points from the duplicate to the original: an item
 *     duplicates at most one item, the original may not itself be a
 *     duplicate, and nothing may duplicate an item that is one (no chains).
 *     Marking a duplicate moves the item to its team's CANCELLED state.
 *   - No relation is made to or from a deleted item (or one in a deleted or
 *     invisible project), and removal is scoped to the item that owns the
 *     relation (inflect-compliance `TaskLinkRepository.unlink`'s fix).
 *   - Self-relations are a 400, and a repeat of an existing relation a 409,
 *     checked in either direction for BLOCKS (Kaneo
 *     `create-task-relation.ts` at fb890b4974e6dd6c232f1de6a6b70a591dfca0a3;
 *     pattern only). Kaneo has no cycle check; this one is Islestone's.
 *
 * Written fresh for Islestone.
 */
import type { WorkItemRelationType } from '@prisma/client';

import { logEvent } from '../events/audit';
import { TeamRepository } from '../repositories/TeamRepository';
import { WorkItemRelationRepository } from '../repositories/WorkItemRelationRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import { assertCanEditWorkItems, assertCanReadWorkItems } from '../policies/work-item.policies';
import { visibleProjects } from '../policies/project-visibility';
import { formatKey } from '../domain/work-item-key';
import { stateTransitionEffects } from '../domain/workflow-state';
import { endOpenRoundsOnClose } from './review-engine';
import { lockWorkItemGraph } from './work-item-graph-lock';
import { inWorkItemGraphQueue } from './work-item-graph-queue';
import { afterStateCommit, applyStateAudit } from './work-item';
import { keyOf, loadVisibleItem, loadWritableItem } from './work-item-shared';
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { ConflictError, badRequest, notFound } from '@/lib/errors/types';

export async function listWorkItemRelations(ctx: RequestContext, workItemId: string) {
    assertCanReadWorkItems(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        await loadVisibleItem(db, ctx, v, workItemId);
        const { outgoing, incoming } = await WorkItemRelationRepository.listForItem(db, ctx, workItemId);
        const otherIds = [...outgoing.map((r) => r.toId), ...incoming.map((r) => r.fromId)];
        const visible = await WorkItemRelationRepository.visibleIds(db, ctx, v, otherIds);
        // An end the reader may not see (deleted, in a deleted or ungranted
        // project) is returned as `{ id, hidden: true }`, with no title.
        const end = (other: { id: string; number: number; title: string; stateCategory: string; project: { keyPrefix: string } }) =>
            visible.has(other.id)
                ? { id: other.id, key: formatKey(other.project.keyPrefix, other.number), title: other.title, stateCategory: other.stateCategory, hidden: false }
                : { id: other.id, hidden: true };
        return {
            outgoing: outgoing.map((r) => ({ id: r.id, type: r.type, createdAt: r.createdAt, item: end(r.to) })),
            incoming: incoming.map((r) => ({ id: r.id, type: r.type, createdAt: r.createdAt, item: end(r.from) })),
        };
    });
}

export async function addWorkItemRelation(ctx: RequestContext, workItemId: string, input: { type: WorkItemRelationType; toId: string }) {
    assertCanEditWorkItems(ctx);
    if (input.toId === workItemId) throw badRequest('A work item cannot be related to itself.');
    // The workspace's graph turn before the transaction (decision 254).
    const outcome = await inWorkItemGraphQueue(ctx.tenantId, () => runInTenantContext(ctx, async (db) => {
        // FIRST, before any row read: the graph lock (ADR 0002 §6).
        await lockWorkItemGraph(db, ctx.tenantId);
        const v = await visibleProjects(ctx, db);
        const from = await loadWritableItem(db, ctx, v, workItemId);
        const to = await WorkItemRepository.findVisible(db, ctx, v, input.toId);
        if (!to) throw notFound('Related work item not found');

        let fromId = from.id;
        let toId = to.id;
        if (input.type === 'RELATES' && !(fromId < toId)) [fromId, toId] = [toId, fromId];

        if (await WorkItemRelationRepository.find(db, ctx, input.type, fromId, toId)) {
            throw new ConflictError('These work items already have that relation.', { reason: 'RELATION_EXISTS' });
        }
        if (input.type === 'BLOCKS') {
            if (await WorkItemRelationRepository.find(db, ctx, 'BLOCKS', toId, fromId)) {
                throw new ConflictError('The other work item already blocks this one.', { reason: 'RELATION_EXISTS' });
            }
            if (await WorkItemRelationRepository.blocksPathExists(db, ctx, toId, fromId)) {
                throw new ConflictError('That relation would create a dependency cycle.', { reason: 'RELATION_WOULD_CYCLE' });
            }
        }
        let duplicateMove: Awaited<ReturnType<typeof markDuplicateCancelled>> = null;
        if (input.type === 'DUPLICATES') {
            if (await WorkItemRelationRepository.duplicateOf(db, ctx, fromId)) {
                throw new ConflictError('This work item is already marked as a duplicate.', { reason: 'ALREADY_DUPLICATE' });
            }
            if (await WorkItemRelationRepository.duplicateOf(db, ctx, toId)) {
                throw new ConflictError('The original is itself a duplicate; point at its original instead.', { reason: 'TARGET_IS_DUPLICATE' });
            }
            if (await WorkItemRelationRepository.isDuplicated(db, ctx, fromId)) {
                throw new ConflictError('Other work items duplicate this one; it cannot become a duplicate.', { reason: 'DUPLICATE_CHAIN' });
            }
        }

        const relation = await WorkItemRelationRepository.create(db, ctx, { type: input.type, fromId, toId });
        for (const [self, other] of [
            [from, to],
            [to, from],
        ] as const) {
            await logEvent(db, ctx, {
                action: 'WORK_ITEM_RELATION_ADDED',
                entityType: 'WorkItem',
                entityId: self.id,
                details: `Related ${keyOf(self)} and ${keyOf(other)} (${input.type})`,
                detailsJson: {
                    category: 'relationship',
                    operation: 'linked',
                    sourceEntity: 'WorkItem',
                    sourceId: relation.fromId,
                    targetEntity: 'WorkItem',
                    targetId: relation.toId,
                    relation: input.type,
                },
                metadata: { relationId: relation.id, otherId: other.id },
            });
        }
        if (input.type === 'DUPLICATES') duplicateMove = await markDuplicateCancelled(db, ctx, v, from);
        return { relation, duplicateMove };
    }));
    if (outcome.duplicateMove) await afterStateCommit(ctx, [outcome.duplicateMove]);
    return outcome.relation;
}

/** Move a newly marked duplicate to its team's CANCELLED default, unless it is closed already. */
async function markDuplicateCancelled(
    db: Parameters<typeof loadWritableItem>[0],
    ctx: RequestContext,
    v: Awaited<ReturnType<typeof visibleProjects>>,
    item: Awaited<ReturnType<typeof loadWritableItem>>,
) {
    if (item.stateCategory === 'DONE' || item.stateCategory === 'CANCELLED') return null;
    const [from, to] = await Promise.all([
        TeamRepository.getState(db, ctx, item.stateId),
        TeamRepository.defaultStateOfCategory(db, ctx, item.teamId, 'CANCELLED'),
    ]);
    if (!to) throw new ConflictError('The team has no live CANCELLED state.', { reason: 'NO_CANCELLED_STATE' });
    const effects = stateTransitionEffects(from!.category, to.category, item);
    await WorkItemRepository.updateVersioned(db, ctx, v, item.id, undefined, { stateId: to.id, stateCategory: to.category, ...effects });
    // A close withdraws an open review round (decision 149).
    await endOpenRoundsOnClose(db, ctx, [item.id], 'ITEM_CLOSED');
    await applyStateAudit(db, ctx, item, from!, to);
    return { item, from: from!, to };
}

export async function removeWorkItemRelation(ctx: RequestContext, workItemId: string, relationId: string) {
    assertCanEditWorkItems(ctx);
    // The workspace's graph turn before the transaction (decision 254).
    return inWorkItemGraphQueue(ctx.tenantId, () => runInTenantContext(ctx, async (db) => {
        await lockWorkItemGraph(db, ctx.tenantId);
        const v = await visibleProjects(ctx, db);
        const item = await loadWritableItem(db, ctx, v, workItemId);
        const relation = await WorkItemRelationRepository.getForItem(db, ctx, workItemId, relationId);
        if (!relation) throw notFound('Relation not found');
        await WorkItemRelationRepository.delete(db, ctx, relationId);
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_RELATION_REMOVED',
            entityType: 'WorkItem',
            entityId: workItemId,
            details: `Removed a ${relation.type} relation from ${keyOf(item)}`,
            detailsJson: {
                category: 'relationship',
                operation: 'unlinked',
                sourceEntity: 'WorkItem',
                sourceId: relation.fromId,
                targetEntity: 'WorkItem',
                targetId: relation.toId,
                relation: relation.type,
            },
            metadata: { relationId },
        });
        return { deleted: true };
    }));
}
