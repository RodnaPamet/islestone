/**
 * Initiatives (sub-phase 3.2a; docs/porting/maps/3.2.md; ADR 0002 §2 and
 * §17; ADR 0006 "Initiative"; owner decisions 208 to 224).
 *
 *   - An initiative is a set of projects that together serve a goal: a name,
 *     an encrypted description, the lifecycle, a date-only due date and a
 *     Lead, as a goal has. Its goal changes under the goal-tree lock
 *     (`INITIATIVE_MOVED`).
 *   - A project names at most one initiative (`setProjectInitiative`, a
 *     project field under `projects.edit`; naming one also asks
 *     `goals.view`). Moving a project to another initiative moves nothing
 *     else: no item, milestone or cycle.
 *   - Archive, soft delete and restore as a goal's (decision 218): deleting an
 *     initiative is its own group; projects keep their link. An initiative
 *     deleted with its goal restores only through that goal
 *     (`DELETED_WITH_PARENT`), and one whose goal is deleted waits for the
 *     goal (`PARENT_DELETED`).
 *
 * Written fresh for Islestone.
 */
import { randomUUID } from 'node:crypto';

import type { InitiativeStatus } from '@prisma/client';

import { logEvent } from '../events/audit';
import { GoalRepository } from '../repositories/GoalRepository';
import { InitiativeRepository, type InitiativePatch, type InitiativeRow } from '../repositories/InitiativeRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { assertCanManageGoals, assertCanNameGoals, assertCanReadGoals } from '../policies/goal.policies';
import { assertCanEditProject } from '../policies/work-config.policies';
import { visibleProjects } from '../policies/project-visibility';
import { groupRoots } from '../domain/goal-tree';
import { isLate, NO_PROGRESS } from '../domain/progress';
import { toEpochDay } from '../domain/schedule/calendar';
import { initiativeSummariesInTx, NO_SUMMARY, projectProgressInTx, workspaceToday } from './goal-progress';
import { healthHistoryInTx } from './goal-health';
import { lateMilestoneCountsInTx } from './milestone';
import { lockGoalTree } from './goal-tree-lock';
import {
    assertLeadMember,
    byStatusDueTitle,
    checkedDescription,
    checkedLabel,
    dayOf,
    goalNotFound,
    initiativeNotFound,
    parseDueDate,
    parseHealth,
    parseStatuses,
    refuseArchived,
    refuseArchivedLink,
    toInitiativeDto,
} from './goal-shared';
import { preconditionRequired } from './work-item-shared';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { ConflictError, notFound } from '@/lib/errors/types';
import { INITIATIVE_NAME_MAX } from '@/lib/schemas/goal';
import type { InitiativeData, InitiativeDetail, InitiativeSummary } from '@/lib/goals/types';

export interface ListInitiativesQuery {
    status?: string;
    archived?: 'true' | 'false';
    deleted?: 'true' | 'false';
    leadUserId?: string;
    health?: string;
    goalId?: string;
}

/** The initiatives in status, due date and title order, each with its progress and "late" (3.2b); `deleted=true` is the Deleted view. */
export async function listInitiatives(ctx: RequestContext, query: ListInitiativesQuery = {}): Promise<{ initiatives: InitiativeSummary[] }> {
    assertCanReadGoals(ctx);
    const statuses = parseStatuses(query.status);
    const health = parseHealth(query.health);
    return runInTenantContext(ctx, async (db) => {
        const deleted = query.deleted === 'true';
        const rows = [
            ...(await InitiativeRepository.list(db, ctx, {
                deleted,
                includeArchived: query.archived === 'true',
                statuses,
                leadUserId: query.leadUserId,
                health,
                goalId: query.goalId,
            })),
        ].sort(byStatusDueTitle<InitiativeRow>((r) => r.name));
        if (deleted) return { initiatives: rows.map((r) => ({ ...toInitiativeDto(r), ...NO_SUMMARY })) };
        const v = await visibleProjects(ctx, db);
        const summaries = await initiativeSummariesInTx(db, ctx, v, rows, await workspaceToday(db, ctx));
        return { initiatives: rows.map((r) => ({ ...toInitiativeDto(r), ...(summaries.get(r.id) ?? NO_SUMMARY) })) };
    });
}

async function loadLiveInitiative(db: PrismaTx, ctx: RequestContext, id: string): Promise<InitiativeRow> {
    const row = await InitiativeRepository.getAny(db, ctx, id);
    if (!row || row.deletedAt) initiativeNotFound();
    return row;
}

/**
 * An initiative's page, the roadmap's "portfolio page" (decision 221): the
 * initiative with its progress, its goal and the goal's live ancestors (the
 * breadcrumb), its visible projects (archived ones included) each with its
 * progress, "late" and late milestones, and its health history.
 */
export async function getInitiative(ctx: RequestContext, id: string): Promise<InitiativeDetail> {
    assertCanReadGoals(ctx);
    return runInTenantContext(ctx, async (db) => {
        const row = await loadLiveInitiative(db, ctx, id);
        const goal = row.goalId ? await GoalRepository.getAny(db, ctx, row.goalId) : null;
        const liveGoal = goal && !goal.deletedAt ? goal : null;
        const goals: Array<{ id: string; title: string }> = [];
        if (liveGoal) {
            const chain = await GoalRepository.ancestorsIncludingDeleted(db, ctx, liveGoal.id);
            const byId = new Map((await GoalRepository.getManyLite(db, ctx, chain.map((c) => c.id))).map((g) => [g.id, g]));
            for (const step of chain) {
                const g = byId.get(step.id);
                if (!g || g.deletedAt) break;
                goals.push({ id: g.id, title: g.title });
            }
            goals.reverse();
        }
        const v = await visibleProjects(ctx, db);
        const today = await workspaceToday(db, ctx);
        const projects = await ProjectRepository.listOfInitiative(db, ctx, v, row.id);
        const summaries = await initiativeSummariesInTx(db, ctx, v, [row], today);
        const byProject = await projectProgressInTx(db, ctx, v, projects.map((p) => p.id));
        const lateMilestones = await lateMilestoneCountsInTx(db, ctx, v, projects.map((p) => p.id));
        return {
            initiative: { ...toInitiativeDto(row), ...(summaries.get(row.id) ?? NO_SUMMARY) },
            goal: liveGoal ? { id: liveGoal.id, title: liveGoal.title, status: liveGoal.status, archived: liveGoal.archivedAt !== null } : null,
            goals,
            projects: projects.map((p) => {
                const progress = byProject.get(p.id) ?? { ...NO_PROGRESS };
                return {
                    id: p.id,
                    name: p.name,
                    keyPrefix: p.keyPrefix,
                    teamId: p.teamId,
                    archived: p.archivedAt !== null,
                    dueDate: dayOf(p.dueDate),
                    progress,
                    late: p.dueDate !== null && isLate(toEpochDay(p.dueDate), progress, today),
                    lateMilestones: lateMilestones.get(p.id) ?? 0,
                };
            }),
            healthHistory: await healthHistoryInTx(db, ctx, 'Initiative', row.id),
        };
    });
}

/** A goal a new link may name: live (404) and unarchived (409 `GOAL_ARCHIVED`), read `FOR KEY SHARE`. */
async function lockLinkableGoal(db: PrismaTx, ctx: RequestContext, id: string) {
    const goal = await GoalRepository.lockForKeyShare(db, ctx, id);
    if (!goal || goal.deletedAt) goalNotFound();
    if (goal.archivedAt) refuseArchivedLink('goal', goal.title);
    return goal;
}

export interface CreateInitiativeInput {
    name: string;
    description?: string | null;
    goalId?: string | null;
    status?: InitiativeStatus;
    dueDate?: string | null;
    leadUserId?: string | null;
}

export async function createInitiative(ctx: RequestContext, input: CreateInitiativeInput): Promise<InitiativeData> {
    assertCanManageGoals(ctx);
    const name = checkedLabel(sanitizePlainText(input.name), INITIATIVE_NAME_MAX, 'An initiative');
    const description = checkedDescription(input.description == null ? input.description : sanitizePlainText(input.description)) ?? null;
    const dueDate = parseDueDate(input.dueDate) ?? null;
    return runInTenantContext(ctx, async (db) => {
        if (input.goalId) await lockGoalTree(db, ctx.tenantId);
        if (input.leadUserId) await assertLeadMember(db, ctx, input.leadUserId);
        if (input.goalId) await lockLinkableGoal(db, ctx, input.goalId);
        const row = await InitiativeRepository.create(db, ctx, {
            goalId: input.goalId ?? null,
            name,
            description,
            status: input.status ?? 'PLANNED',
            dueDate,
            leadUserId: input.leadUserId ?? null,
        });
        await logEvent(db, ctx, {
            action: 'INITIATIVE_CREATED',
            entityType: 'Initiative',
            entityId: row.id,
            details: `Created initiative ${name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Initiative', operation: 'created', summary: 'INITIATIVE_CREATED' },
            metadata: { goalId: row.goalId, status: row.status, dueDate: input.dueDate ?? null, leadUserId: row.leadUserId },
        });
        return toInitiativeDto(row);
    });
}

export interface UpdateInitiativeInput {
    name?: string;
    description?: string | null;
    goalId?: string | null;
    status?: InitiativeStatus;
    dueDate?: string | null;
    leadUserId?: string | null;
}

async function throwInitiativeConflict(db: PrismaTx, ctx: RequestContext, id: string): Promise<never> {
    const current = await InitiativeRepository.getAny(db, ctx, id);
    if (!current || current.deletedAt) initiativeNotFound();
    throw new ConflictError('The initiative changed since you read it.', { reason: 'VERSION_CONFLICT', version: current.version, initiative: toInitiativeDto(current) });
}

export async function updateInitiative(ctx: RequestContext, id: string, input: UpdateInitiativeInput, expectedVersion?: number): Promise<InitiativeData> {
    assertCanManageGoals(ctx);
    if ((input.name !== undefined || input.description !== undefined) && expectedVersion === undefined) throw preconditionRequired();
    const name = input.name !== undefined ? checkedLabel(sanitizePlainText(input.name), INITIATIVE_NAME_MAX, 'An initiative') : undefined;
    const description = checkedDescription(input.description == null ? input.description : sanitizePlainText(input.description));
    const dueDate = parseDueDate(input.dueDate);
    return runInTenantContext(ctx, async (db) => {
        if (input.goalId !== undefined) await lockGoalTree(db, ctx.tenantId);
        // A new Lead: the initiative's row, then the person's membership (issue #113).
        if (input.leadUserId) await InitiativeRepository.lock(db, ctx, id);
        const row = await loadLiveInitiative(db, ctx, id);
        if (row.archivedAt) refuseArchived('initiative');
        const patch: InitiativePatch = {};
        const changed: string[] = [];
        if (name !== undefined && name !== row.name) {
            patch.name = name;
            changed.push('name');
        }
        if (description !== undefined && description !== row.description) {
            patch.description = description;
            changed.push('description');
        }
        if (input.status !== undefined && input.status !== row.status) {
            patch.status = input.status;
            changed.push('status');
        }
        if (dueDate !== undefined && (dueDate?.getTime() ?? null) !== (row.dueDate?.getTime() ?? null)) {
            patch.dueDate = dueDate;
            changed.push('dueDate');
        }
        if (input.leadUserId !== undefined && input.leadUserId !== row.leadUserId) {
            if (input.leadUserId) await assertLeadMember(db, ctx, input.leadUserId);
            patch.leadUserId = input.leadUserId;
            changed.push('leadUserId');
        }
        const moving = input.goalId !== undefined && input.goalId !== row.goalId;
        if (moving) {
            if (input.goalId) await lockLinkableGoal(db, ctx, input.goalId);
            patch.goalId = input.goalId ?? null;
        }
        if (changed.length === 0 && !moving) return toInitiativeDto(row);
        const count = await InitiativeRepository.updateVersioned(db, ctx, row.id, expectedVersion, patch);
        if (count === 0) await throwInitiativeConflict(db, ctx, row.id);
        if (changed.length > 0) {
            await logEvent(db, ctx, {
                action: 'INITIATIVE_UPDATED',
                entityType: 'Initiative',
                entityId: row.id,
                details: `Changed initiative ${patch.name ?? row.name}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'Initiative', operation: 'updated', changedFields: changed },
                metadata: {
                    changedFields: changed,
                    ...(patch.status ? { fromStatus: row.status, toStatus: patch.status } : {}),
                    ...(patch.leadUserId !== undefined ? { fromLeadUserId: row.leadUserId, toLeadUserId: patch.leadUserId } : {}),
                },
            });
        }
        if (moving) {
            await logEvent(db, ctx, {
                action: 'INITIATIVE_MOVED',
                entityType: 'Initiative',
                entityId: row.id,
                details: `Moved initiative ${patch.name ?? row.name}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'Initiative', operation: 'updated', changedFields: ['goalId'] },
                metadata: { fromGoalId: row.goalId, toGoalId: patch.goalId ?? null },
            });
        }
        return toInitiativeDto((await InitiativeRepository.getAny(db, ctx, row.id))!);
    });
}

export async function setInitiativeArchived(ctx: RequestContext, id: string, archived: boolean): Promise<InitiativeData> {
    assertCanManageGoals(ctx);
    return runInTenantContext(ctx, async (db) => {
        const row = await loadLiveInitiative(db, ctx, id);
        if ((row.archivedAt !== null) === archived) return toInitiativeDto(row);
        if (archived && row.status !== 'COMPLETED' && row.status !== 'CANCELLED') {
            throw new ConflictError('Only a Completed or Cancelled initiative can be archived.', { reason: 'INITIATIVE_NOT_FINISHED' });
        }
        const count = await InitiativeRepository.updateVersioned(db, ctx, row.id, undefined, archived ? { archivedAt: new Date(), archivedByUserId: ctx.userId } : { archivedAt: null, archivedByUserId: null });
        if (count === 0) await throwInitiativeConflict(db, ctx, row.id);
        await logEvent(db, ctx, {
            action: archived ? 'INITIATIVE_ARCHIVED' : 'INITIATIVE_UNARCHIVED',
            entityType: 'Initiative',
            entityId: row.id,
            details: `${archived ? 'Archived' : 'Unarchived'} initiative ${row.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Initiative', operation: 'updated', changedFields: ['archivedAt'] },
        });
        return toInitiativeDto((await InitiativeRepository.getAny(db, ctx, row.id))!);
    });
}

/** Soft-delete one initiative under its own group; its projects keep the link. */
export async function deleteInitiative(ctx: RequestContext, id: string): Promise<{ deleted: true; deletionId: string }> {
    assertCanManageGoals(ctx);
    return runInTenantContext(ctx, async (db) => {
        const row = await loadLiveInitiative(db, ctx, id);
        const deletionId = randomUUID();
        await InitiativeRepository.softDeleteMany(db, ctx, [row.id], deletionId, new Date());
        await logEvent(db, ctx, {
            action: 'INITIATIVE_DELETED',
            entityType: 'Initiative',
            entityId: row.id,
            details: `Deleted initiative ${row.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Initiative', operation: 'deleted', summary: 'INITIATIVE_DELETED' },
            metadata: { deletionId },
        });
        return { deleted: true as const, deletionId };
    });
}

/**
 * Restore a deleted initiative: its own group. One deleted with its goal is
 * restored through that goal (409 `DELETED_WITH_PARENT`, naming the group's
 * root goal); one whose goal is deleted waits for the goal (409
 * `PARENT_DELETED`).
 */
export async function restoreInitiative(ctx: RequestContext, id: string): Promise<InitiativeData> {
    assertCanManageGoals(ctx);
    return runInTenantContext(ctx, async (db) => {
        // The tree lock: a goal restore and this one read the same group.
        await lockGoalTree(db, ctx.tenantId);
        const row = await InitiativeRepository.getAny(db, ctx, id);
        if (!row || !row.deletedAt || !row.deletionId) initiativeNotFound();
        const groupGoals = await GoalRepository.getManyLite(db, ctx, await GoalRepository.idsOfDeletion(db, ctx, row.deletionId));
        if (groupGoals.length > 0) {
            throw new ConflictError('This initiative was deleted with its goal. Restore that goal instead.', { reason: 'DELETED_WITH_PARENT', rootId: groupRoots(groupGoals)[0] ?? null });
        }
        if (row.goalId) {
            const goal = await GoalRepository.getAny(db, ctx, row.goalId);
            if (goal?.deletedAt) throw new ConflictError(`Restore the goal ${goal.title} first.`, { reason: 'PARENT_DELETED', parentId: goal.id });
        }
        await InitiativeRepository.restoreGroup(db, ctx, row.deletionId);
        await logEvent(db, ctx, {
            action: 'INITIATIVE_RESTORED',
            entityType: 'Initiative',
            entityId: row.id,
            details: `Restored initiative ${row.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Initiative', operation: 'restored', summary: 'INITIATIVE_RESTORED' },
            metadata: { deletionId: row.deletionId },
        });
        return toInitiativeDto((await InitiativeRepository.getAny(db, ctx, row.id))!);
    });
}

// ─── A project's initiative ───────────────────────────────────────────────

/** An initiative a new link may name: live (404) and unarchived (409 `INITIATIVE_ARCHIVED`), read `FOR KEY SHARE`. */
export async function lockLinkableInitiative(db: PrismaTx, ctx: RequestContext, id: string) {
    const row = await InitiativeRepository.lockForKeyShare(db, ctx, id);
    if (!row || row.deletedAt) initiativeNotFound();
    if (row.archivedAt) refuseArchivedLink('initiative', row.name);
    return row;
}

/**
 * Name a project's initiative, or clear it (`null`): a versioned project
 * write (`If-Match` optional), audited `PROJECT_UPDATED` naming
 * `initiativeId`. Naming one also asks `goals.view`; the initiative must be
 * live (404) and unarchived (409). An archived project may be linked: an
 * initiative's finished projects are usually archived.
 */
export async function setProjectInitiative(ctx: RequestContext, projectId: string, input: { initiativeId: string | null }, expectedVersion?: number) {
    assertCanEditProject(ctx);
    if (input.initiativeId) assertCanNameGoals(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const project = await ProjectRepository.getVisible(db, ctx, v, projectId);
        if (!project) throw notFound('Project not found');
        if (project.initiativeId === input.initiativeId) return { ...project, dueDate: dayOf(project.dueDate) };
        const to = input.initiativeId ? await lockLinkableInitiative(db, ctx, input.initiativeId) : null;
        const count = await ProjectRepository.setInitiative(db, ctx, project.id, expectedVersion, to?.id ?? null);
        if (count === 0) {
            const current = await ProjectRepository.getVisible(db, ctx, v, projectId);
            if (!current) throw notFound('Project not found');
            throw new ConflictError('The project changed since you read it.', { reason: 'VERSION_CONFLICT', version: current.version, project: { ...current, dueDate: dayOf(current.dueDate) } });
        }
        await logEvent(db, ctx, {
            action: 'PROJECT_UPDATED',
            entityType: 'Project',
            entityId: project.id,
            details: to ? `Linked project ${project.name} to initiative ${to.name}` : `Took project ${project.name} off its initiative`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Project', operation: 'updated', changedFields: ['initiativeId'] },
            metadata: { fromInitiativeId: project.initiativeId, toInitiativeId: to?.id ?? null },
        });
        const after = (await ProjectRepository.getVisible(db, ctx, v, projectId))!;
        return { ...after, dueDate: dayOf(after.dueDate) };
    });
}
