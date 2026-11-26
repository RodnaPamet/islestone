/**
 * Projects and their key prefixes (sub-phase 2.1, ADR 0002 §4).
 *
 * Reads of projects carry the caller's project visibility
 * (`projectRowVisibilityWhere`), so a guest sees only granted projects and a
 * deleted project reads as absent. Written fresh for Islestone.
 */
import { Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import { SEARCH_ROW_CAP, containsPattern, prefixPattern } from '@/lib/search/query';
import { projectRowVisibilityWhere, projectVisibilityArgs, type ProjectVisibility } from '../policies/project-visibility';
import type { RequestContext } from '../types';

export const PROJECT_LIST_TAKE = 200;

export const projectSelect = {
    id: true,
    teamId: true,
    name: true,
    keyPrefix: true,
    dueDate: true,
    initiativeId: true,
    version: true,
    archivedAt: true,
    deletedAt: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.ProjectSelect;

/** One search row (`ProjectRepository.findSearchRows`, after `searchNameIds`). */
export interface ProjectSearchRow {
    id: string;
    name: string;
    keyPrefix: string;
}

/** The roadmap's project scope (3.2c, `roadmapProjects`). */
export interface RoadmapProjectScope {
    initiativeIds: readonly string[];
    /** Also the projects naming no live initiative (the "No initiative" row). */
    unlinked: boolean;
    /** Every live initiative of the workspace: a project naming another (a deleted one) is unlinked. */
    liveInitiativeIds: readonly string[];
    teamId?: string;
}

function roadmapProjectWhere(ctx: RequestContext, v: ProjectVisibility, scope: RoadmapProjectScope): Prisma.ProjectWhereInput | null {
    const or: Prisma.ProjectWhereInput[] = [];
    if (scope.initiativeIds.length > 0) or.push({ initiativeId: { in: [...scope.initiativeIds] } });
    if (scope.unlinked) {
        or.push({ initiativeId: null });
        or.push({ initiativeId: scope.liveInitiativeIds.length > 0 ? { notIn: [...scope.liveInitiativeIds] } : { not: null } });
    }
    if (or.length === 0) return null;
    return {
        tenantId: ctx.tenantId,
        ...(scope.teamId ? { teamId: scope.teamId } : {}),
        AND: [projectRowVisibilityWhere(v, { includeArchived: true }), { OR: or }],
    };
}

export class ProjectRepository {
    /**
     * Live, visible, unarchived projects whose name holds the query
     * (substring, `Project_search_name_trgm`) or all of its words (full text
     * through `islestone_bg_en`, `Project_search_name_fts`), or whose key
     * prefix is the query, as ids in candidate order (prefix, exact name,
     * name prefix, rank, similarity, id); bounded by `limit` (at most
     * `SEARCH_ROW_CAP`, which the function also caps). The read is the
     * SECURITY DEFINER function `search_project_names` (owner decision 245,
     * docs/search.md): it reads the workspace from `app.tenant_id` and
     * filters it, `deletedAt`, `archivedAt` and visibility itself. The query
     * and the patterns are bind parameters.
     */
    static async searchNameIds(
        db: PrismaTx,
        _ctx: RequestContext,
        v: ProjectVisibility,
        query: string,
        opts: { limit: number },
    ): Promise<Array<{ id: string; ordinal: number }>> {
        const limit = Math.min(Math.max(1, Math.floor(opts.limit)), SEARCH_ROW_CAP);
        const rows = await db.$queryRaw<Array<{ id: string; ordinal: number }>>(Prisma.sql`
            SELECT t."id", t."ordinal"
              FROM search_project_names(${query}::text, ${containsPattern(query)}::text, ${prefixPattern(query)}::text,
                                        ${projectVisibilityArgs(v)}, ${limit}::integer) t
             ORDER BY t."ordinal"`);
        return rows.map((r) => ({ id: r.id, ordinal: Number(r.ordinal) }));
    }

    /**
     * The search rows of projects found by `searchNameIds`: live, visible,
     * unarchived, by id, under row-level security; at most `SEARCH_ROW_CAP`.
     */
    static async findSearchRows(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, ids: readonly string[]): Promise<ProjectSearchRow[]> {
        if (ids.length === 0) return [];
        return db.project.findMany({
            where: { tenantId: ctx.tenantId, id: { in: [...ids] }, AND: [projectRowVisibilityWhere(v)] },
            take: SEARCH_ROW_CAP,
            select: { id: true, name: true, keyPrefix: true },
        });
    }

    static async list(
        db: PrismaTx,
        ctx: RequestContext,
        v: ProjectVisibility,
        opts: { teamId?: string; includeArchived?: boolean } = {},
    ) {
        return db.project.findMany({
            where: {
                tenantId: ctx.tenantId,
                ...(opts.teamId ? { teamId: opts.teamId } : {}),
                AND: [projectRowVisibilityWhere(v, { includeArchived: opts.includeArchived })],
            },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            take: PROJECT_LIST_TAKE,
            select: projectSelect,
        });
    }

    /** A visible project (archived ones included: they stay readable). */
    static async getVisible(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, id: string) {
        return db.project.findFirst({
            where: { id, tenantId: ctx.tenantId, AND: [projectRowVisibilityWhere(v, { includeArchived: true })] },
            select: projectSelect,
        });
    }

    /** The visible projects among `ids` (archived ones included: the calendar's markers, 3.3a). */
    static async visibleByIds(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, ids: readonly string[]) {
        if (ids.length === 0) return [];
        return db.project.findMany({
            where: { id: { in: [...ids] }, tenantId: ctx.tenantId, AND: [projectRowVisibilityWhere(v, { includeArchived: true })] },
            orderBy: { id: 'asc' },
            take: ids.length,
            select: projectSelect,
        });
    }

    /** Any project row of the workspace, deleted included (restore, purge). */
    static async getAny(db: PrismaTx, ctx: RequestContext, id: string) {
        return db.project.findFirst({ where: { id, tenantId: ctx.tenantId }, select: projectSelect });
    }

    /** Lock the project row for the rest of the transaction. */
    static async lock(db: PrismaTx, ctx: RequestContext, id: string): Promise<boolean> {
        const rows = await db.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "Project" WHERE "id" = ${id} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
        return rows.length === 1;
    }

    /** Whether a prefix has ever been used in the workspace (prefixes are never reused). */
    static async prefixTaken(db: PrismaTx, ctx: RequestContext, prefix: string): Promise<boolean> {
        const row = await db.projectKeyPrefix.findUnique({
            where: { tenantId_prefix: { tenantId: ctx.tenantId, prefix } },
            select: { prefix: true },
        });
        return row !== null;
    }

    /** The project a prefix (current or retired) belongs to. */
    static async projectIdForPrefix(db: PrismaTx, ctx: RequestContext, prefix: string) {
        return db.projectKeyPrefix.findUnique({
            where: { tenantId_prefix: { tenantId: ctx.tenantId, prefix } },
            select: { projectId: true, retiredAt: true },
        });
    }

    static async create(db: PrismaTx, ctx: RequestContext, data: { teamId: string; name: string; keyPrefix: string; dueDate?: Date | null; initiativeId?: string | null }) {
        const project = await db.project.create({
            data: { tenantId: ctx.tenantId, teamId: data.teamId, name: data.name, keyPrefix: data.keyPrefix, dueDate: data.dueDate ?? null, initiativeId: data.initiativeId ?? null },
            select: projectSelect,
        });
        await db.projectKeyPrefix.create({
            data: { tenantId: ctx.tenantId, prefix: data.keyPrefix, projectId: project.id },
        });
        await db.projectKeySequence.create({ data: { tenantId: ctx.tenantId, projectId: project.id, lastValue: 0 } });
        return project;
    }

    /** Rename and/or re-prefix. A prefix change retires the old prefix row. */
    static async update(
        db: PrismaTx,
        ctx: RequestContext,
        id: string,
        data: { name?: string; keyPrefix?: string; previousPrefix?: string; dueDate?: Date | null },
    ) {
        const result = await db.project.updateMany({
            where: { id, tenantId: ctx.tenantId, deletedAt: null },
            data: {
                ...(data.name !== undefined ? { name: data.name } : {}),
                ...(data.keyPrefix !== undefined ? { keyPrefix: data.keyPrefix } : {}),
                ...(data.dueDate !== undefined ? { dueDate: data.dueDate } : {}),
                version: { increment: 1 },
            },
        });
        if (result.count === 1 && data.keyPrefix !== undefined && data.previousPrefix !== undefined) {
            await db.projectKeyPrefix.updateMany({
                where: { tenantId: ctx.tenantId, prefix: data.previousPrefix, projectId: id },
                data: { retiredAt: new Date() },
            });
            await db.projectKeyPrefix.create({ data: { tenantId: ctx.tenantId, prefix: data.keyPrefix, projectId: id } });
        }
        return result;
    }

    /**
     * The due date a project template gives the project it makes (3.1,
     * decision 188), in `createProject`'s own transaction: part of the
     * create, so the version does not move.
     */
    static async setDueDateAtCreate(db: PrismaTx, ctx: RequestContext, id: string, dueDate: Date) {
        return db.project.updateMany({ where: { id, tenantId: ctx.tenantId, deletedAt: null }, data: { dueDate } });
    }

    /**
     * Name the project's initiative, or clear it (3.2a): a versioned write of
     * a live project; `expectedVersion` (from `If-Match`) must match when
     * given. Returns the rows changed.
     */
    static async setInitiative(db: PrismaTx, ctx: RequestContext, id: string, expectedVersion: number | undefined, initiativeId: string | null): Promise<number> {
        const r = await db.project.updateMany({
            where: { id, tenantId: ctx.tenantId, deletedAt: null, ...(expectedVersion !== undefined ? { version: expectedVersion } : {}) },
            data: { initiativeId, version: { increment: 1 } },
        });
        return r.count;
    }

    /** The live, visible projects of the given initiatives (the list's `initiativeId` and `goalId` filters, 3.2a). */
    static async idsOfInitiatives(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, initiativeIds: readonly string[], take: number): Promise<string[]> {
        if (initiativeIds.length === 0) return [];
        const rows = await db.project.findMany({
            where: { tenantId: ctx.tenantId, initiativeId: { in: [...initiativeIds] }, AND: [projectRowVisibilityWhere(v, { includeArchived: true })] },
            orderBy: { id: 'asc' },
            take,
            select: { id: true },
        });
        return rows.map((r) => r.id);
    }

    /** The live, visible projects (archived ones included) of the given initiatives, each with its initiative (3.2b progress), at most `take`. */
    static async linksOfInitiatives(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, initiativeIds: readonly string[], take: number): Promise<Array<{ id: string; initiativeId: string }>> {
        if (initiativeIds.length === 0) return [];
        const rows = await db.project.findMany({
            where: { tenantId: ctx.tenantId, initiativeId: { in: [...initiativeIds] }, AND: [projectRowVisibilityWhere(v, { includeArchived: true })] },
            orderBy: { id: 'asc' },
            take,
            select: { id: true, initiativeId: true },
        });
        return rows.flatMap((r) => (r.initiativeId ? [{ id: r.id, initiativeId: r.initiativeId }] : []));
    }

    /**
     * The roadmap's projects (3.2c): the live, visible projects (archived ones
     * included) of the given initiatives, and, with `unlinked`, those naming
     * no live initiative (none, or one of `liveInitiativeIds` is not theirs:
     * a deleted initiative shows as none). Narrowed to one team when asked.
     * By name, then id; at most `take`.
     */
    static async roadmapProjects(
        db: PrismaTx,
        ctx: RequestContext,
        v: ProjectVisibility,
        scope: RoadmapProjectScope,
        take: number,
    ) {
        const where = roadmapProjectWhere(ctx, v, scope);
        if (!where) return [];
        return db.project.findMany({
            where,
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            take,
            select: { id: true, name: true, keyPrefix: true, teamId: true, initiativeId: true, dueDate: true, archivedAt: true },
        });
    }

    /** How many projects `roadmapProjects` would read with no limit: the count a refusal names. */
    static async countRoadmapProjects(
        db: PrismaTx,
        ctx: RequestContext,
        v: ProjectVisibility,
        scope: RoadmapProjectScope,
    ): Promise<number> {
        const where = roadmapProjectWhere(ctx, v, scope);
        return where ? db.project.count({ where }) : 0;
    }

    /** An initiative's live, visible projects (archived ones included), by name. */
    static async listOfInitiative(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, initiativeId: string) {
        return db.project.findMany({
            where: { tenantId: ctx.tenantId, initiativeId, AND: [projectRowVisibilityWhere(v, { includeArchived: true })] },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            take: PROJECT_LIST_TAKE,
            select: projectSelect,
        });
    }

    /** How many projects (deleted ones included) name the given initiatives: what a purge unlinks. */
    static async countNamingInitiatives(db: PrismaTx, ctx: RequestContext, initiativeIds: readonly string[]): Promise<number> {
        if (initiativeIds.length === 0) return 0;
        return db.project.count({ where: { tenantId: ctx.tenantId, initiativeId: { in: [...initiativeIds] } } });
    }

    static async setArchived(db: PrismaTx, ctx: RequestContext, id: string, archivedAt: Date | null) {
        return db.project.updateMany({
            where: { id, tenantId: ctx.tenantId, deletedAt: null },
            data: { archivedAt, version: { increment: 1 } },
        });
    }

    static async softDelete(db: PrismaTx, ctx: RequestContext, id: string) {
        return db.project.updateMany({
            where: { id, tenantId: ctx.tenantId, deletedAt: null },
            data: { deletedAt: new Date(), deletedByUserId: ctx.userId, version: { increment: 1 } },
        });
    }

    static async restore(db: PrismaTx, ctx: RequestContext, id: string) {
        return db.project.updateMany({
            where: { id, tenantId: ctx.tenantId, deletedAt: { not: null } },
            data: { deletedAt: null, deletedByUserId: null, version: { increment: 1 } },
        });
    }

    /**
     * Claim the next number of a project's key sequence, atomically: the
     * upsert compiles to `INSERT … ON CONFLICT DO UPDATE`, and the row lock it
     * takes is held until the item's transaction ends, so a failed create
     * uses no number. inflect-compliance's per-tenant `TaskKeySequence`
     * pattern (`TaskRepository.ts` lines 626–638), scoped to a project.
     */
    static async claimNumber(db: PrismaTx, ctx: RequestContext, projectId: string): Promise<number> {
        const seq = await db.projectKeySequence.upsert({
            where: { projectId },
            create: { tenantId: ctx.tenantId, projectId, lastValue: 1 },
            update: { lastValue: { increment: 1 } },
            select: { lastValue: true },
        });
        return seq.lastValue;
    }

    /**
     * Claim `n` consecutive numbers (Kaneo's batch claim, `claim-task-numbers.ts`
     * at fb890b4974e6dd6c232f1de6a6b70a591dfca0a3; pattern only): returns the
     * first of the `n`.
     */
    static async claimNumbers(db: PrismaTx, ctx: RequestContext, projectId: string, n: number): Promise<number> {
        const seq = await db.projectKeySequence.upsert({
            where: { projectId },
            create: { tenantId: ctx.tenantId, projectId, lastValue: n },
            update: { lastValue: { increment: n } },
            select: { lastValue: true },
        });
        return seq.lastValue - n + 1;
    }

    /** Lock two projects' sequences in id order (moves): Kaneo `move-task.ts`'s lesson. */
    static async lockSequences(db: PrismaTx, ctx: RequestContext, projectIds: readonly string[]): Promise<void> {
        for (const id of [...new Set(projectIds)].sort()) {
            // guardrail-allow: n+1 — at most two rows, locked one by one in a fixed order.
            await db.$queryRaw`
                SELECT "projectId" FROM "ProjectKeySequence"
                 WHERE "projectId" = ${id} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
        }
    }
}
