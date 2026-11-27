/**
 * Teams and their workflow states (sub-phase 2.1, ADR 0002 §3).
 *
 * Every query filters by `tenantId` (RLS also scopes it). Written fresh for
 * Islestone.
 */
import type { EstimateUnit, Prisma, WorkflowStateCategory } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import type { RequestContext } from '../types';
import type { LockedWorkItemIds } from './work-item-locks';

/** A team's workflow is small; a page this size holds any real one. */
export const TEAM_STATES_TAKE = 100;
export const TEAM_LIST_TAKE = 200;

const stateSelect = {
    id: true,
    teamId: true,
    name: true,
    category: true,
    sortKey: true,
    isDefault: true,
    archivedAt: true,
} satisfies Prisma.WorkflowStateSelect;

export class TeamRepository {
    static async list(db: PrismaTx, ctx: RequestContext) {
        return db.team.findMany({
            where: { tenantId: ctx.tenantId },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            take: TEAM_LIST_TAKE,
            select: { id: true, name: true, estimateUnit: true, createdAt: true, updatedAt: true },
        });
    }

    static async getById(db: PrismaTx, ctx: RequestContext, id: string) {
        return db.team.findFirst({
            where: { id, tenantId: ctx.tenantId },
            select: { id: true, name: true, estimateUnit: true, createdAt: true, updatedAt: true },
        });
    }

    static async create(db: PrismaTx, ctx: RequestContext, name: string) {
        return db.team.create({
            data: { tenantId: ctx.tenantId, name },
            select: { id: true, name: true, estimateUnit: true, createdAt: true, updatedAt: true },
        });
    }

    static async rename(db: PrismaTx, ctx: RequestContext, id: string, name: string) {
        return db.team.updateMany({ where: { id, tenantId: ctx.tenantId }, data: { name } });
    }

    /** Change a team's name and estimate unit (3.4a); only the keys given. */
    static async update(db: PrismaTx, ctx: RequestContext, id: string, data: { name?: string; estimateUnit?: EstimateUnit | null }) {
        return db.team.updateMany({ where: { id, tenantId: ctx.tenantId }, data });
    }

    /** The estimate unit of a team (3.4a); `undefined` when there is no such team. */
    static async estimateUnitOf(db: PrismaTx, ctx: RequestContext, teamId: string): Promise<EstimateUnit | null | undefined> {
        const row = await db.team.findFirst({ where: { id: teamId, tenantId: ctx.tenantId }, select: { estimateUnit: true } });
        return row ? row.estimateUnit : undefined;
    }

    /** The estimate unit of a project's team (3.4a): the field set's estimate rule depends on it. */
    static async estimateUnitOfProject(db: PrismaTx, ctx: RequestContext, projectId: string): Promise<EstimateUnit | null | undefined> {
        const row = await db.project.findFirst({ where: { id: projectId, tenantId: ctx.tenantId }, select: { team: { select: { estimateUnit: true } } } });
        // A tombstone has no team (issue #120); it takes no estimate.
        return row ? (row.team?.estimateUnit ?? null) : undefined;
    }

    static async countProjects(db: PrismaTx, ctx: RequestContext, teamId: string) {
        // Every project, deleted ones included: a deleted project is restorable
        // until the purge, and its items still name the team's states. A
        // tombstone names no team (issue #120, decision 305), so it never holds one.
        return db.project.count({ where: { tenantId: ctx.tenantId, teamId } });
    }

    static async delete(db: PrismaTx, ctx: RequestContext, id: string) {
        return db.team.deleteMany({ where: { id, tenantId: ctx.tenantId } });
    }

    // ── Workflow states ──────────────────────────────────────────────

    static async listStates(db: PrismaTx, ctx: RequestContext, teamId: string, opts: { includeArchived?: boolean } = {}) {
        return db.workflowState.findMany({
            where: { tenantId: ctx.tenantId, teamId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
            orderBy: [{ sortKey: 'asc' }, { id: 'asc' }],
            take: TEAM_STATES_TAKE,
            select: stateSelect,
        });
    }

    static async getState(db: PrismaTx, ctx: RequestContext, id: string) {
        return db.workflowState.findFirst({ where: { id, tenantId: ctx.tenantId }, select: stateSelect });
    }

    /** The state rows for a set of ids (bulk state changes). */
    static async getStates(db: PrismaTx, ctx: RequestContext, ids: readonly string[]) {
        return db.workflowState.findMany({
            where: { tenantId: ctx.tenantId, id: { in: [...ids] } },
            take: ids.length,
            select: stateSelect,
        });
    }

    static async defaultState(db: PrismaTx, ctx: RequestContext, teamId: string) {
        return db.workflowState.findFirst({
            where: { tenantId: ctx.tenantId, teamId, isDefault: true, archivedAt: null },
            select: stateSelect,
        });
    }

    /**
     * The state a cross-team move or a bulk set by category lands an item in:
     * the team's default when it has that category, else the first live state
     * of the category in the team's order.
     */
    static async defaultStateOfCategory(db: PrismaTx, ctx: RequestContext, teamId: string, category: WorkflowStateCategory) {
        return db.workflowState.findFirst({
            where: { tenantId: ctx.tenantId, teamId, category, archivedAt: null },
            orderBy: [{ isDefault: 'desc' }, { sortKey: 'asc' }, { id: 'asc' }],
            select: stateSelect,
        });
    }

    /** Every live state of the given teams, in one read (bulk state changes, moves). */
    static async liveStatesOfTeams(db: PrismaTx, ctx: RequestContext, teamIds: readonly string[]) {
        if (teamIds.length === 0) return [];
        return db.workflowState.findMany({
            where: { tenantId: ctx.tenantId, teamId: { in: [...teamIds] }, archivedAt: null },
            orderBy: [{ teamId: 'asc' }, { sortKey: 'asc' }, { id: 'asc' }],
            take: teamIds.length * TEAM_STATES_TAKE,
            select: stateSelect,
        });
    }

    /** Live state counts by category, for "at least one DONE and one CANCELLED". */
    static async countLiveStatesOfCategory(db: PrismaTx, ctx: RequestContext, teamId: string, category: WorkflowStateCategory) {
        return db.workflowState.count({ where: { tenantId: ctx.tenantId, teamId, category, archivedAt: null } });
    }

    static async lastStateSortKey(db: PrismaTx, ctx: RequestContext, teamId: string): Promise<string | null> {
        const last = await db.workflowState.findFirst({
            where: { tenantId: ctx.tenantId, teamId },
            orderBy: [{ sortKey: 'desc' }, { id: 'desc' }],
            select: { sortKey: true },
        });
        return last?.sortKey ?? null;
    }

    static async createState(
        db: PrismaTx,
        ctx: RequestContext,
        data: { teamId: string; name: string; category: WorkflowStateCategory; sortKey: string; isDefault: boolean },
    ) {
        return db.workflowState.create({ data: { tenantId: ctx.tenantId, ...data }, select: stateSelect });
    }

    static async createStates(
        db: PrismaTx,
        ctx: RequestContext,
        rows: ReadonlyArray<{ teamId: string; name: string; category: WorkflowStateCategory; sortKey: string; isDefault: boolean }>,
    ) {
        return db.workflowState.createMany({ data: rows.map((r) => ({ tenantId: ctx.tenantId, ...r })) });
    }

    static async updateState(
        db: PrismaTx,
        ctx: RequestContext,
        id: string,
        data: { name?: string; sortKey?: string; isDefault?: boolean; archivedAt?: Date | null },
    ) {
        return db.workflowState.updateMany({ where: { id, tenantId: ctx.tenantId }, data });
    }

    static async clearDefault(db: PrismaTx, ctx: RequestContext, teamId: string) {
        return db.workflowState.updateMany({ where: { tenantId: ctx.tenantId, teamId, isDefault: true }, data: { isDefault: false } });
    }

    /** Locks the state row (Kaneo's "lock the state row, then count"). */
    static async lockState(db: PrismaTx, ctx: RequestContext, id: string): Promise<boolean> {
        const rows = await db.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "WorkflowState" WHERE "id" = ${id} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
        return rows.length === 1;
    }

    /** Every item in the state, live or deleted: the RESTRICT FK counts them all. */
    static async countItemsInState(db: PrismaTx, ctx: RequestContext, stateId: string) {
        return db.workItem.count({ where: { tenantId: ctx.tenantId, stateId } });
    }

    /**
     * Move every item in a state (deleted ones included: the FK counts them
     * all) to another state of the same team, with the lifecycle timestamps
     * the move writes; `stampStartedAt` sets `startedAt` where none is.
     */
    static async moveItemsToState(
        db: PrismaTx,
        ctx: RequestContext,
        fromStateId: string,
        to: { id: string; category: WorkflowStateCategory },
        effects: { completedAt?: Date | null; cancelledAt?: Date | null; waitingOnUserId?: null },
        stampStartedAt: Date | null,
        _locked: LockedWorkItemIds,
    ): Promise<number> {
        // After `WorkItemRepository.lockInState` (decision 173). The predicate,
        // not the locked ids: this statement's fresh snapshot also catches a
        // row moved into the state by a writer we waited on, which the FK
        // would otherwise refuse when the state is deleted.
        const result = await db.workItem.updateMany({
            where: { tenantId: ctx.tenantId, stateId: fromStateId },
            data: { stateId: to.id, stateCategory: to.category, ...effects, version: { increment: 1 } },
        });
        if (stampStartedAt) {
            await db.workItem.updateMany({
                where: { tenantId: ctx.tenantId, stateId: to.id, startedAt: null },
                data: { startedAt: stampStartedAt },
            });
        }
        return result.count;
    }

    static async deleteState(db: PrismaTx, ctx: RequestContext, id: string) {
        return db.workflowState.deleteMany({ where: { id, tenantId: ctx.tenantId } });
    }
}
