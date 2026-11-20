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
import { projectRowVisibilityWhere, projectVisibilitySql, type ProjectVisibility } from '../policies/project-visibility';
import type { RequestContext } from '../types';

export const PROJECT_LIST_TAKE = 200;

export const projectSelect = {
    id: true,
    teamId: true,
    name: true,
    keyPrefix: true,
    version: true,
    archivedAt: true,
    deletedAt: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.ProjectSelect;

/** One search candidate (`ProjectRepository.searchNames`). */
export interface ProjectSearchRow {
    id: string;
    name: string;
    keyPrefix: string;
}

export class ProjectRepository {
    /**
     * Live, visible, unarchived projects whose name holds the query
     * (substring, `Project_search_name_trgm`) or all of its words (full text
     * through `islestone_bg_en`, `Project_search_name_fts`), or whose key prefix is the query
     * (the unique `(tenantId, keyPrefix)`). Ordered so the best candidates
     * make the cut; bounded by `limit` (at most `SEARCH_ROW_CAP`). Raw SQL
     * because Prisma cannot order by a rank (sub-phase 2.7b, docs/search.md);
     * the query is a bind parameter.
     */
    static async searchNames(
        db: PrismaTx,
        ctx: RequestContext,
        v: ProjectVisibility,
        query: string,
        opts: { limit: number },
    ): Promise<ProjectSearchRow[]> {
        const limit = Math.min(Math.max(1, Math.floor(opts.limit)), SEARCH_ROW_CAP);
        return db.$queryRaw<ProjectSearchRow[]>(Prisma.sql`
            SELECT p."id", p."name", p."keyPrefix"
              FROM "Project" p
             WHERE p."tenantId" = ${ctx.tenantId}
               AND ${projectVisibilitySql(v, { projectAlias: 'p', projectIdColumn: 'p."id"' })}
               AND (p."name" ILIKE ${containsPattern(query)}
                    OR to_tsvector('islestone_bg_en', p."name") @@ plainto_tsquery('islestone_bg_en', ${query})
                    OR p."keyPrefix" = upper(${query}))
             ORDER BY (p."keyPrefix" = upper(${query})) DESC,
                      (lower(p."name") = lower(${query})) DESC,
                      (p."name" ILIKE ${prefixPattern(query)}) DESC,
                      ts_rank(to_tsvector('islestone_bg_en', p."name"), plainto_tsquery('islestone_bg_en', ${query})) DESC,
                      similarity(p."name", ${query}) DESC,
                      p."id" ASC
             LIMIT ${limit}`);
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

    static async create(db: PrismaTx, ctx: RequestContext, data: { teamId: string; name: string; keyPrefix: string }) {
        const project = await db.project.create({
            data: { tenantId: ctx.tenantId, teamId: data.teamId, name: data.name, keyPrefix: data.keyPrefix },
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
        data: { name?: string; keyPrefix?: string; previousPrefix?: string },
    ) {
        const result = await db.project.updateMany({
            where: { id, tenantId: ctx.tenantId, deletedAt: null },
            data: {
                ...(data.name !== undefined ? { name: data.name } : {}),
                ...(data.keyPrefix !== undefined ? { keyPrefix: data.keyPrefix } : {}),
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
