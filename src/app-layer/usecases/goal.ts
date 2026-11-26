/**
 * Goals (sub-phase 3.2a; docs/porting/maps/3.2.md; ADR 0002 §2 and §17;
 * ADR 0006 "Goal"; owner decisions 205 to 224).
 *
 *   - A goal is an outcome the workspace wants: a title, an encrypted
 *     description, a lifecycle status (any of Planned, Started, Completed,
 *     Cancelled, in any order, decision 208), an optional date-only due date
 *     (not a scheduling deadline, decision 210) and an optional Lead, an
 *     ACTIVE member (decision 209). Health (3.2b) is never touched here.
 *   - Goals nest at most three levels. Every write that changes a parent, and
 *     every delete and restore, takes the goal-tree lock FIRST
 *     (`lockGoalTree`); the cycle and depth checks count deleted goals, so a
 *     restore can never break them.
 *   - Archive (decision 218) keeps a Completed or Cancelled goal whole and
 *     hidden; an archived goal is read-only and takes no new link.
 *   - Delete is soft: the goal, every live goal below it and their live
 *     initiatives get one `deletionId`. Links from projects and items are
 *     kept. Restore brings the group back, only through its root and only
 *     while the root's parent is live. The purge (decision 219) is
 *     `goal-purge.ts`.
 *   - Reads take `goals.view`, writes `goals.manage` (decision 213). Every
 *     write is audited with the transaction client, naming changed fields,
 *     never the description.
 *
 * Written fresh for Islestone.
 */
import { randomUUID } from 'node:crypto';

import type { GoalStatus } from '@prisma/client';

import { logEvent } from '../events/audit';
import { GoalRepository, GOAL_SUBTREE_CAP, type GoalPatch, type GoalRow } from '../repositories/GoalRepository';
import { InitiativeRepository, type InitiativeRow } from '../repositories/InitiativeRepository';
import { visibleProjects } from '../policies/project-visibility';
import { goalSummariesInTx, initiativeSummariesInTx, NO_SUMMARY, workspaceToday } from './goal-progress';
import { healthHistoryInTx } from './goal-health';
import { assertCanManageGoals, assertCanReadGoals, mayReadGoals } from '../policies/goal.policies';
import { childFits, goalMoveRefusal, groupRoots, MAX_GOAL_DEPTH } from '../domain/goal-tree';
import { lockGoalTree } from './goal-tree-lock';
import {
    assertLeadMember,
    byStatusDueTitle,
    checkedDescription,
    checkedLabel,
    goalNotFound,
    parseDueDate,
    parseHealth,
    parseStatuses,
    refuseArchived,
    refuseArchivedLink,
    toGoalDto,
    toInitiativeDto,
} from './goal-shared';
import { preconditionRequired } from './work-item-shared';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { ConflictError } from '@/lib/errors/types';
import { GOAL_TITLE_MAX } from '@/lib/schemas/goal';
import type { GoalData, GoalDetail, GoalSummary, ViewGoal, ViewInitiative } from '@/lib/goals/types';

/**
 * The live, unarchived goals and initiatives the views name (the Goal picker,
 * the `goalId` and `initiativeId` filters, the project dialog's initiative);
 * both empty without `goals.view`. Never a description.
 */
export async function viewGoalsInTx(db: PrismaTx, ctx: RequestContext): Promise<{ goals: ViewGoal[]; initiatives: ViewInitiative[] }> {
    if (!mayReadGoals(ctx)) return { goals: [], initiatives: [] };
    const [goals, initiatives] = await Promise.all([GoalRepository.listLinkable(db, ctx), InitiativeRepository.listLinkable(db, ctx)]);
    return {
        goals: goals.map((g) => ({ id: g.id, parentId: g.parentId, title: g.title })),
        initiatives: initiatives.map((i) => ({ id: i.id, goalId: i.goalId, name: i.name })),
    };
}

/** The views' goals and initiatives in a transaction of their own (Settings → Projects, the project dialog). */
export async function listViewGoals(ctx: RequestContext): Promise<{ goals: ViewGoal[]; initiatives: ViewInitiative[] }> {
    return runInTenantContext(ctx, (db) => viewGoalsInTx(db, ctx));
}

export interface ListGoalsQuery {
    status?: string;
    archived?: 'true' | 'false';
    deleted?: 'true' | 'false';
    leadUserId?: string;
    health?: string;
}

/**
 * The goals, flat with `parentId`, in status, due date and title order, each
 * with its progress and "late" (3.2b); `deleted=true` is the Deleted view,
 * where none shows progress.
 */
export async function listGoals(ctx: RequestContext, query: ListGoalsQuery = {}): Promise<{ goals: GoalSummary[] }> {
    assertCanReadGoals(ctx);
    const statuses = parseStatuses(query.status);
    const health = parseHealth(query.health);
    return runInTenantContext(ctx, async (db) => {
        const deleted = query.deleted === 'true';
        const rows = [
            ...(await GoalRepository.list(db, ctx, {
                deleted,
                includeArchived: query.archived === 'true',
                statuses,
                leadUserId: query.leadUserId,
                health,
            })),
        ].sort(byStatusDueTitle<GoalRow>((r) => r.title));
        if (deleted) return { goals: rows.map((r) => ({ ...toGoalDto(r), ...NO_SUMMARY })) };
        const v = await visibleProjects(ctx, db);
        const { summaries } = await goalSummariesInTx(db, ctx, v, rows, await workspaceToday(db, ctx));
        return { goals: rows.map((r) => ({ ...toGoalDto(r), ...(summaries.get(r.id) ?? NO_SUMMARY) })) };
    });
}

/** A live goal, or a 404 (`GOAL_NOT_FOUND`): a deleted goal reads as absent. */
async function loadLiveGoal(db: PrismaTx, ctx: RequestContext, id: string): Promise<GoalRow> {
    const goal = await GoalRepository.getAny(db, ctx, id);
    if (!goal || goal.deletedAt) goalNotFound();
    return goal;
}

/**
 * A goal's page (3.2b): the goal with its progress, its live ancestors (root
 * first, the walk stopping at a deleted one), its live children and
 * initiatives with theirs, its level and whether a child goal fits, the items
 * naming it directly, and its health history.
 */
export async function getGoal(ctx: RequestContext, id: string): Promise<GoalDetail> {
    assertCanReadGoals(ctx);
    return runInTenantContext(ctx, async (db) => {
        const goal = await loadLiveGoal(db, ctx, id);
        const fullChain = await GoalRepository.ancestorsIncludingDeleted(db, ctx, goal.id);
        const chain = fullChain.slice(1);
        const byId = new Map((await GoalRepository.getMany(db, ctx, chain.map((c) => c.id))).map((g) => [g.id, g]));
        const ancestorRows: GoalRow[] = [];
        for (const step of chain) {
            const row = byId.get(step.id);
            if (!row || row.deletedAt) break;
            ancestorRows.push(row);
        }
        const children = (await GoalRepository.liveChildren(db, ctx, goal.id)).sort(byStatusDueTitle<GoalRow>((r) => r.title));
        const initiatives = (await InitiativeRepository.list(db, ctx, { includeArchived: true, goalId: goal.id })).sort(byStatusDueTitle<InitiativeRow>((r) => r.name));
        const v = await visibleProjects(ctx, db);
        const today = await workspaceToday(db, ctx);
        const { summaries, directItems } = await goalSummariesInTx(db, ctx, v, [goal, ...children], today);
        const initiativeSummaries = await initiativeSummariesInTx(db, ctx, v, initiatives, today);
        return {
            goal: { ...toGoalDto(goal), ...(summaries.get(goal.id) ?? NO_SUMMARY) },
            ancestors: ancestorRows.reverse().map(toGoalDto),
            children: children.map((c) => ({ ...toGoalDto(c), ...(summaries.get(c.id) ?? NO_SUMMARY) })),
            initiatives: initiatives.map((i) => ({ ...toInitiativeDto(i), ...(initiativeSummaries.get(i.id) ?? NO_SUMMARY) })),
            depth: fullChain.length,
            childFits: childFits(fullChain.map((c) => c.id)),
            directItems: directItems.get(goal.id) ?? 0,
            healthHistory: await healthHistoryInTx(db, ctx, 'Goal', goal.id),
        };
    });
}

/** A parent a new link may name: live (404) and unarchived (409 `GOAL_ARCHIVED`), read `FOR KEY SHARE`. */
async function lockLinkableGoal(db: PrismaTx, ctx: RequestContext, id: string) {
    const goal = await GoalRepository.lockForKeyShare(db, ctx, id);
    if (!goal || goal.deletedAt) goalNotFound();
    if (goal.archivedAt) refuseArchivedLink('goal', goal.title);
    return goal;
}

function tooDeep(depth: number): never {
    throw new ConflictError(`Goals nest at most ${MAX_GOAL_DEPTH} levels; this would make ${depth}.`, { reason: 'GOAL_TOO_DEEP', depth });
}

export interface CreateGoalInput {
    title: string;
    description?: string | null;
    parentId?: string | null;
    status?: GoalStatus;
    dueDate?: string | null;
    leadUserId?: string | null;
}

export async function createGoal(ctx: RequestContext, input: CreateGoalInput): Promise<GoalData> {
    assertCanManageGoals(ctx);
    const title = checkedLabel(sanitizePlainText(input.title), GOAL_TITLE_MAX, 'A goal');
    const description = checkedDescription(input.description == null ? input.description : sanitizePlainText(input.description)) ?? null;
    const dueDate = parseDueDate(input.dueDate) ?? null;
    return runInTenantContext(ctx, async (db) => {
        // The tree lock FIRST: a new child changes the tree under its parent.
        if (input.parentId) await lockGoalTree(db, ctx.tenantId);
        if (input.leadUserId) await assertLeadMember(db, ctx, input.leadUserId);
        if (input.parentId) {
            await lockLinkableGoal(db, ctx, input.parentId);
            const chain = await GoalRepository.ancestorsIncludingDeleted(db, ctx, input.parentId);
            if (!childFits(chain.map((c) => c.id))) tooDeep(chain.length + 1);
        }
        const goal = await GoalRepository.create(db, ctx, {
            parentId: input.parentId ?? null,
            title,
            description,
            status: input.status ?? 'PLANNED',
            dueDate,
            leadUserId: input.leadUserId ?? null,
        });
        await logEvent(db, ctx, {
            action: 'GOAL_CREATED',
            entityType: 'Goal',
            entityId: goal.id,
            details: `Created goal ${title}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Goal', operation: 'created', summary: 'GOAL_CREATED' },
            metadata: { parentId: goal.parentId, status: goal.status, dueDate: input.dueDate ?? null, leadUserId: goal.leadUserId },
        });
        return toGoalDto(goal);
    });
}

export interface UpdateGoalInput {
    title?: string;
    description?: string | null;
    parentId?: string | null;
    status?: GoalStatus;
    dueDate?: string | null;
    leadUserId?: string | null;
}

async function throwGoalConflict(db: PrismaTx, ctx: RequestContext, id: string): Promise<never> {
    const current = await GoalRepository.getAny(db, ctx, id);
    if (!current || current.deletedAt) goalNotFound();
    throw new ConflictError('The goal changed since you read it.', { reason: 'VERSION_CONFLICT', version: current.version, goal: toGoalDto(current) });
}

/**
 * Change a goal's title, description, status, due date, lead or parent. A
 * title or description change names the version it was based on (428
 * without `If-Match`); a parent change takes the tree lock and is checked for
 * cycles and depth (`GOAL_WOULD_CYCLE`, `GOAL_TOO_DEEP`), audited
 * `GOAL_MOVED`; the rest is `GOAL_UPDATED`, naming the fields.
 */
export async function updateGoal(ctx: RequestContext, id: string, input: UpdateGoalInput, expectedVersion?: number): Promise<GoalData> {
    assertCanManageGoals(ctx);
    if ((input.title !== undefined || input.description !== undefined) && expectedVersion === undefined) throw preconditionRequired();
    const title = input.title !== undefined ? checkedLabel(sanitizePlainText(input.title), GOAL_TITLE_MAX, 'A goal') : undefined;
    const description = checkedDescription(input.description == null ? input.description : sanitizePlainText(input.description));
    const dueDate = parseDueDate(input.dueDate);
    return runInTenantContext(ctx, async (db) => {
        if (input.parentId !== undefined) await lockGoalTree(db, ctx.tenantId);
        const goal = await loadLiveGoal(db, ctx, id);
        if (goal.archivedAt) refuseArchived('goal');
        const patch: GoalPatch = {};
        const changed: string[] = [];
        if (title !== undefined && title !== goal.title) {
            patch.title = title;
            changed.push('title');
        }
        if (description !== undefined && description !== goal.description) {
            patch.description = description;
            changed.push('description');
        }
        if (input.status !== undefined && input.status !== goal.status) {
            patch.status = input.status;
            changed.push('status');
        }
        if (dueDate !== undefined && (dueDate?.getTime() ?? null) !== (goal.dueDate?.getTime() ?? null)) {
            patch.dueDate = dueDate;
            changed.push('dueDate');
        }
        if (input.leadUserId !== undefined && input.leadUserId !== goal.leadUserId) {
            if (input.leadUserId) await assertLeadMember(db, ctx, input.leadUserId);
            patch.leadUserId = input.leadUserId;
            changed.push('leadUserId');
        }
        const moving = input.parentId !== undefined && input.parentId !== goal.parentId;
        if (moving) {
            const parentId = input.parentId ?? null;
            let chain: string[] = [];
            if (parentId) {
                await lockLinkableGoal(db, ctx, parentId);
                chain = (await GoalRepository.ancestorsIncludingDeleted(db, ctx, parentId)).map((c) => c.id);
            }
            const subtree = await GoalRepository.subtreeIncludingDeleted(db, ctx, goal.id, GOAL_SUBTREE_CAP + 1);
            const refusal = goalMoveRefusal(goal.id, chain, subtree.map((s) => s.id), subtree.map((s) => s.depth));
            if (refusal?.reason === 'GOAL_WOULD_CYCLE') throw new ConflictError('A goal cannot be placed under itself or a goal below it.', { reason: 'GOAL_WOULD_CYCLE' });
            if (refusal?.reason === 'GOAL_TOO_DEEP') tooDeep(refusal.depth);
            patch.parentId = parentId;
        }
        if (changed.length === 0 && !moving) return toGoalDto(goal);
        const count = await GoalRepository.updateVersioned(db, ctx, goal.id, expectedVersion, patch);
        if (count === 0) await throwGoalConflict(db, ctx, goal.id);
        if (changed.length > 0) {
            await logEvent(db, ctx, {
                action: 'GOAL_UPDATED',
                entityType: 'Goal',
                entityId: goal.id,
                details: `Changed goal ${patch.title ?? goal.title}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'Goal', operation: 'updated', changedFields: changed },
                metadata: {
                    changedFields: changed,
                    ...(patch.status ? { fromStatus: goal.status, toStatus: patch.status } : {}),
                    ...(patch.leadUserId !== undefined ? { fromLeadUserId: goal.leadUserId, toLeadUserId: patch.leadUserId } : {}),
                },
            });
        }
        if (moving) {
            await logEvent(db, ctx, {
                action: 'GOAL_MOVED',
                entityType: 'Goal',
                entityId: goal.id,
                details: `Moved goal ${patch.title ?? goal.title}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'Goal', operation: 'updated', changedFields: ['parentId'] },
                metadata: { fromParentId: goal.parentId, toParentId: patch.parentId ?? null },
            });
        }
        return toGoalDto((await GoalRepository.getAny(db, ctx, goal.id))!);
    });
}

/** Archive a Completed or Cancelled goal (409 `GOAL_NOT_FINISHED` otherwise), or unarchive it. Nothing below it changes. */
export async function setGoalArchived(ctx: RequestContext, id: string, archived: boolean): Promise<GoalData> {
    assertCanManageGoals(ctx);
    return runInTenantContext(ctx, async (db) => {
        const goal = await loadLiveGoal(db, ctx, id);
        if ((goal.archivedAt !== null) === archived) return toGoalDto(goal);
        if (archived && goal.status !== 'COMPLETED' && goal.status !== 'CANCELLED') {
            throw new ConflictError('Only a Completed or Cancelled goal can be archived.', { reason: 'GOAL_NOT_FINISHED' });
        }
        const count = await GoalRepository.updateVersioned(db, ctx, goal.id, undefined, archived ? { archivedAt: new Date(), archivedByUserId: ctx.userId } : { archivedAt: null, archivedByUserId: null });
        if (count === 0) await throwGoalConflict(db, ctx, goal.id);
        await logEvent(db, ctx, {
            action: archived ? 'GOAL_ARCHIVED' : 'GOAL_UNARCHIVED',
            entityType: 'Goal',
            entityId: goal.id,
            details: `${archived ? 'Archived' : 'Unarchived'} goal ${goal.title}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Goal', operation: 'updated', changedFields: ['archivedAt'] },
        });
        return toGoalDto((await GoalRepository.getAny(db, ctx, goal.id))!);
    });
}

/**
 * Soft-delete a goal (decision 218): the goal, every live goal below it and
 * the live initiatives of all of them, under one new `deletionId`. Projects
 * keep `initiativeId` and items keep `goalId`.
 */
export async function deleteGoal(ctx: RequestContext, id: string): Promise<{ deleted: true; deletionId: string; goals: number; initiatives: number }> {
    assertCanManageGoals(ctx);
    return runInTenantContext(ctx, async (db) => {
        await lockGoalTree(db, ctx.tenantId);
        const goal = await loadLiveGoal(db, ctx, id);
        const subtree = await GoalRepository.subtreeIncludingDeleted(db, ctx, goal.id, GOAL_SUBTREE_CAP + 1);
        if (subtree.length > GOAL_SUBTREE_CAP) {
            throw new ConflictError('This goal holds too many goals below it to delete in one step.', { reason: 'GOAL_TREE_TOO_LARGE' });
        }
        const goalIds = subtree.filter((s) => s.deletedAt === null).map((s) => s.id);
        const initiativeIds = await InitiativeRepository.liveIdsOfGoals(db, ctx, goalIds);
        const deletionId = randomUUID();
        const at = new Date();
        const goals = await GoalRepository.softDeleteMany(db, ctx, goalIds, deletionId, at);
        const initiatives = await InitiativeRepository.softDeleteMany(db, ctx, initiativeIds, deletionId, at);
        await logEvent(db, ctx, {
            action: 'GOAL_DELETED',
            entityType: 'Goal',
            entityId: goal.id,
            details: `Deleted goal ${goal.title}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Goal', operation: 'deleted', summary: 'GOAL_DELETED' },
            metadata: { deletionId, goalIds, initiativeIds, goals, initiatives },
        });
        return { deleted: true as const, deletionId, goals, initiatives };
    });
}

/**
 * Restore a deleted goal's group (its `deletionId`): the goals and the
 * initiatives deleted with it, links intact. Only the group's root restores
 * it (409 `DELETED_WITH_PARENT`, naming the root), and only while the root's
 * parent is live (409 `PARENT_DELETED`, naming it).
 */
export async function restoreGoal(ctx: RequestContext, id: string): Promise<GoalData> {
    assertCanManageGoals(ctx);
    return runInTenantContext(ctx, async (db) => {
        await lockGoalTree(db, ctx.tenantId);
        const goal = await GoalRepository.getAny(db, ctx, id);
        if (!goal || !goal.deletedAt || !goal.deletionId) goalNotFound();
        const groupIds = await GoalRepository.idsOfDeletion(db, ctx, goal.deletionId);
        const roots = groupRoots(await GoalRepository.getManyLite(db, ctx, groupIds));
        if (!roots.includes(goal.id)) {
            throw new ConflictError('This goal was deleted with the goal above it. Restore that goal instead.', { reason: 'DELETED_WITH_PARENT', rootId: roots[0] ?? null });
        }
        if (goal.parentId) {
            const parent = await GoalRepository.getAny(db, ctx, goal.parentId);
            if (parent?.deletedAt) {
                throw new ConflictError(`Restore the goal ${parent.title} first.`, { reason: 'PARENT_DELETED', parentId: parent.id });
            }
        }
        const goals = await GoalRepository.restoreGroup(db, ctx, goal.deletionId);
        const initiatives = await InitiativeRepository.restoreGroup(db, ctx, goal.deletionId);
        await logEvent(db, ctx, {
            action: 'GOAL_RESTORED',
            entityType: 'Goal',
            entityId: goal.id,
            details: `Restored goal ${goal.title}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Goal', operation: 'restored', summary: 'GOAL_RESTORED' },
            metadata: { deletionId: goal.deletionId, goals, initiatives },
        });
        return toGoalDto((await GoalRepository.getAny(db, ctx, goal.id))!);
    });
}
