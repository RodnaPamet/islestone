/**
 * A team's workflow states (sub-phase 2.1, ADR 0002 §3).
 *
 *   - A state's category is fixed at creation (and the trigger
 *     `workflow_state_category_immutable` refuses a change from any writer).
 *   - A team keeps exactly one live default, and at least one live DONE and
 *     one live CANCELLED state: archiving or deleting the last one of either
 *     is refused, and the default cannot be archived or deleted (choose
 *     another default first).
 *   - A state with items is deleted only with a target state of the same
 *     team, and its items move there in the same transaction (Kaneo's "lock
 *     the state row, then count"; pattern only). The RESTRICT foreign key is
 *     the backstop.
 *
 * Written fresh for Islestone.
 */
import type { WorkflowStateCategory } from '@prisma/client';

import { logEvent } from '../events/audit';
import { TeamRepository } from '../repositories/TeamRepository';
import { assertCanManageWorkConfig, assertCanReadWorkConfig } from '../policies/work-config.policies';
import { keyBetween } from '../domain/fractional-index';
import { isClosedCategory, stateTransitionEffects } from '../domain/workflow-state';
import { endOpenRoundsInState } from './review-engine';
import { assertReviewAllowsDoneInState } from './review-defaults';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { ConflictError, badRequest, notFound } from '@/lib/errors/types';
import { sanitizePlainText } from '@/lib/security/sanitize';

const MUST_KEEP: readonly WorkflowStateCategory[] = ['DONE', 'CANCELLED'];

export async function listWorkflowStates(ctx: RequestContext, teamId: string, opts: { includeArchived?: boolean } = {}) {
    assertCanReadWorkConfig(ctx);
    return runInTenantContext(ctx, async (db) => {
        if (!(await TeamRepository.getById(db, ctx, teamId))) throw notFound('Team not found');
        return TeamRepository.listStates(db, ctx, teamId, opts);
    });
}

/** Resolve a `{ afterId?, beforeId? }` placement among a team's states. */
async function stateSortKeyFor(
    db: PrismaTx,
    ctx: RequestContext,
    teamId: string,
    position: { afterId?: string; beforeId?: string } | undefined,
    selfId?: string,
): Promise<string> {
    if (!position || (!position.afterId && !position.beforeId)) {
        return keyBetween(await TeamRepository.lastStateSortKey(db, ctx, teamId), null);
    }
    const states = (await TeamRepository.listStates(db, ctx, teamId, { includeArchived: true })).filter((s) => s.id !== selfId);
    const index = (id: string) => {
        const i = states.findIndex((s) => s.id === id);
        if (i === -1) throw badRequest('The position names a state of another team.');
        return i;
    };
    if (position.afterId) {
        const i = index(position.afterId);
        return keyBetween(states[i]!.sortKey, states[i + 1]?.sortKey ?? null);
    }
    const j = index(position.beforeId!);
    return keyBetween(states[j - 1]?.sortKey ?? null, states[j]!.sortKey);
}

export async function createWorkflowState(
    ctx: RequestContext,
    teamId: string,
    input: { name: string; category: WorkflowStateCategory; isDefault?: boolean; position?: { afterId?: string; beforeId?: string } },
) {
    assertCanManageWorkConfig(ctx);
    const name = sanitizePlainText(input.name).trim();
    return runInTenantContext(ctx, async (db) => {
        if (!(await TeamRepository.getById(db, ctx, teamId))) throw notFound('Team not found');
        const sortKey = await stateSortKeyFor(db, ctx, teamId, input.position);
        if (input.isDefault) await TeamRepository.clearDefault(db, ctx, teamId);
        const state = await TeamRepository.createState(db, ctx, {
            teamId,
            name,
            category: input.category,
            sortKey,
            isDefault: input.isDefault === true,
        });
        await logEvent(db, ctx, {
            action: 'WORKFLOW_STATE_CREATED',
            entityType: 'WorkflowState',
            entityId: state.id,
            details: `Created workflow state ${name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkflowState', operation: 'created' },
            metadata: { teamId, category: input.category, isDefault: state.isDefault },
        });
        return state;
    });
}

export async function updateWorkflowState(
    ctx: RequestContext,
    stateId: string,
    input: {
        name?: string;
        isDefault?: true;
        archived?: boolean;
        position?: { afterId?: string; beforeId?: string };
    },
) {
    assertCanManageWorkConfig(ctx);
    return runInTenantContext(ctx, async (db) => {
        const state = await TeamRepository.getState(db, ctx, stateId);
        if (!state) throw notFound('Workflow state not found');
        const data: { name?: string; sortKey?: string; isDefault?: boolean; archivedAt?: Date | null } = {};
        const changed: string[] = [];

        if (input.name !== undefined) {
            data.name = sanitizePlainText(input.name).trim();
            changed.push('name');
        }
        if (input.position) {
            data.sortKey = await stateSortKeyFor(db, ctx, state.teamId, input.position, state.id);
            changed.push('sortKey');
        }
        if (input.archived === true && !state.archivedAt) {
            if (state.isDefault) {
                throw new ConflictError('The default state cannot be archived. Choose another default first.', { reason: 'STATE_IS_DEFAULT' });
            }
            if (MUST_KEEP.includes(state.category) && (await TeamRepository.countLiveStatesOfCategory(db, ctx, state.teamId, state.category)) <= 1) {
                throw new ConflictError(`A team keeps at least one live ${state.category} state.`, { reason: 'LAST_STATE_OF_CATEGORY' });
            }
            data.archivedAt = new Date();
            changed.push('archivedAt');
        } else if (input.archived === false && state.archivedAt) {
            data.archivedAt = null;
            changed.push('archivedAt');
        }
        if (input.isDefault === true && !state.isDefault) {
            if (state.archivedAt && data.archivedAt !== null) {
                throw new ConflictError('An archived state cannot be the default.', { reason: 'STATE_ARCHIVED' });
            }
            await TeamRepository.clearDefault(db, ctx, state.teamId);
            data.isDefault = true;
            changed.push('isDefault');
        }
        if (changed.length === 0) return state;

        await TeamRepository.updateState(db, ctx, stateId, data);
        await logEvent(db, ctx, {
            action: 'WORKFLOW_STATE_UPDATED',
            entityType: 'WorkflowState',
            entityId: stateId,
            details: `Updated workflow state ${state.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkflowState', operation: 'updated', changedFields: changed },
        });
        return TeamRepository.getState(db, ctx, stateId);
    });
}

/**
 * Delete a state. When items are in it, `moveToStateId` names a live state
 * of the same team and every item moves there in this transaction, with the
 * lifecycle timestamps a move between those categories writes.
 */
export async function deleteWorkflowState(ctx: RequestContext, stateId: string, input: { moveToStateId?: string } = {}) {
    assertCanManageWorkConfig(ctx);
    return runInTenantContext(ctx, async (db) => {
        if (!(await TeamRepository.lockState(db, ctx, stateId))) throw notFound('Workflow state not found');
        const state = (await TeamRepository.getState(db, ctx, stateId))!;
        if (state.isDefault) {
            throw new ConflictError('The default state cannot be deleted. Choose another default first.', { reason: 'STATE_IS_DEFAULT' });
        }
        if (MUST_KEEP.includes(state.category) && !state.archivedAt) {
            if ((await TeamRepository.countLiveStatesOfCategory(db, ctx, state.teamId, state.category)) <= 1) {
                throw new ConflictError(`A team keeps at least one live ${state.category} state.`, { reason: 'LAST_STATE_OF_CATEGORY' });
            }
        }
        const itemCount = await TeamRepository.countItemsInState(db, ctx, stateId);
        let moved = 0;
        if (itemCount > 0) {
            if (!input.moveToStateId) {
                throw new ConflictError('This state has work items. Name the state to move them to.', {
                    reason: 'STATE_HAS_WORK_ITEMS',
                    itemCount,
                });
            }
            const target = await TeamRepository.getState(db, ctx, input.moveToStateId);
            if (!target || target.teamId !== state.teamId || target.archivedAt || target.id === state.id) {
                throw badRequest('The target state must be another live state of the same team.');
            }
            moved = await moveItemsBetweenStates(db, ctx, state, target);
        }
        await TeamRepository.deleteState(db, ctx, stateId);
        await logEvent(db, ctx, {
            action: 'WORKFLOW_STATE_DELETED',
            entityType: 'WorkflowState',
            entityId: stateId,
            details: `Deleted workflow state ${state.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkflowState', operation: 'deleted' },
            metadata: { movedItems: moved, moveToStateId: input.moveToStateId ?? null },
        });
        return { deleted: true, movedItems: moved };
    });
}

async function moveItemsBetweenStates(
    db: PrismaTx,
    ctx: RequestContext,
    from: { id: string; category: WorkflowStateCategory },
    to: { id: string; category: WorkflowStateCategory },
): Promise<number> {
    // Their types may require their review to finish before Done (2.8c, decision 149).
    await assertReviewAllowsDoneInState(db, ctx, from, to);
    const now = new Date();
    // A close withdraws the moved items' open review rounds (decision 149).
    if (isClosedCategory(to.category) && !isClosedCategory(from.category)) await endOpenRoundsInState(db, ctx, from.id, now);
    // `startedAt` is set only where none is (the first move into STARTED).
    const { startedAt: _first, ...effects } = stateTransitionEffects(from.category, to.category, { startedAt: now }, now);
    void _first;
    return TeamRepository.moveItemsToState(db, ctx, from.id, { id: to.id, category: to.category }, effects, to.category === 'STARTED' ? now : null);
}
