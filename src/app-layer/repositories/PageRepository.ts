/**
 * Pages (sub-phase 4.1a; docs/pages.md; ADR 0015 §1). Every query filters by
 * `tenantId` (RLS also scopes it). Reads used by the tree checks include
 * deleted pages on purpose: a soft-deleted page keeps its place in its tree,
 * so a restore can never make a cycle or pass the depth cap.
 *
 * A tree is a `projectId` (a project's) or NULL (the workspace's). The live
 * tree reads spell `projectId` and `deletedAt` as the partial indexes
 * `Page_live_project_tree` and `Page_live_workspace_tree` do. The walks are
 * depth-capped and path-guarded recursive reads (the shape of
 * `GoalRepository`'s).
 *
 * Written fresh for Islestone.
 */
import { Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import { SEARCH_ROW_CAP, containsPattern, prefixPattern } from '@/lib/search/query';
import { projectRowVisibilityWhere, projectVisibilityArgs, type ProjectVisibility } from '../policies/project-visibility';
import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId'>;

/** The most pages one delete group or one move may carry (a page and everything below it). */
export const PAGE_SUBTREE_CAP = 2_000;
/** A walk stops here even if a cycle ever slipped past the lock (the tree is at most 10 deep). */
export const PAGE_WALK_DEPTH = 16;
/** The Deleted list's bound: far beyond a real tree's deleted groups. */
export const DELETED_PAGES_TAKE = 500;

export const pageSelect = {
    id: true,
    projectId: true,
    parentId: true,
    sortKey: true,
    title: true,
    version: true,
    createdByUserId: true,
    contentUpdatedAt: true,
    deletedAt: true,
    deletedByUserId: true,
    deletionId: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.PageSelect;

export type PageRow = Prisma.PageGetPayload<{ select: typeof pageSelect }>;

/** One step of a walk up or down a tree. */
export interface PageWalkRow {
    id: string;
    parentId: string | null;
    projectId: string | null;
    title: string;
    deletedAt: Date | null;
    depth: number;
}

/** Where a tree read starts: a tree and a parent in it (null: the top level). */
export interface PageTreeSpot {
    projectId: string | null;
    parentId: string | null;
}

function liveTreeWhere(ctx: Ctx, spot: PageTreeSpot): Prisma.PageWhereInput {
    return { tenantId: ctx.tenantId, projectId: spot.projectId, parentId: spot.parentId, deletedAt: null };
}

export class PageRepository {
    /**
     * A parent's live children in a tree, in order (`sortKey`, then id), at
     * most `take`, after the sibling at (`afterKey`, `afterId`) when given.
     * Served by the partial tree indexes.
     */
    static async children(db: PrismaTx, ctx: Ctx, spot: PageTreeSpot, take: number, after?: { sortKey: string; id: string }): Promise<PageRow[]> {
        return db.page.findMany({
            where: {
                ...liveTreeWhere(ctx, spot),
                ...(after ? { OR: [{ sortKey: { gt: after.sortKey } }, { sortKey: after.sortKey, id: { gt: after.id } }] } : {}),
            },
            orderBy: [{ sortKey: 'asc' }, { id: 'asc' }],
            take,
            select: pageSelect,
        });
    }

    /** How many live children each of `parentIds` has (one grouped read). */
    static async childCounts(db: PrismaTx, ctx: Ctx, parentIds: readonly string[]): Promise<Map<string, number>> {
        if (parentIds.length === 0) return new Map();
        const rows = await db.page.groupBy({
            by: ['parentId'],
            where: { tenantId: ctx.tenantId, parentId: { in: [...parentIds] }, deletedAt: null },
            _count: { _all: true },
        });
        return new Map(rows.map((r) => [r.parentId!, r._count._all]));
    }

    /** Any page of the workspace, deleted included. */
    static async getAny(db: PrismaTx, ctx: Ctx, id: string): Promise<PageRow | null> {
        return db.page.findFirst({ where: { id, tenantId: ctx.tenantId }, select: pageSelect });
    }

    /** Lock pages for a write, in id order (decision 173); returns the ids locked. */
    static async lockForWrite(db: PrismaTx, ctx: Ctx, ids: readonly string[]): Promise<string[]> {
        if (ids.length === 0) return [];
        const rows = await db.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "Page"
             WHERE "tenantId" = ${ctx.tenantId} AND "id" = ANY(${[...ids]}::text[])
             ORDER BY "id"
             FOR UPDATE`;
        return rows.map((r) => r.id);
    }

    /**
     * The page and its ancestors, deleted ones included, nearest first, each
     * with its distance (0 for the page itself) and title: the breadcrumb
     * and the depth and cycle checks, in one depth-capped, path-guarded
     * statement.
     */
    static async chainUp(db: PrismaTx, ctx: Ctx, id: string): Promise<PageWalkRow[]> {
        const rows = await db.$queryRaw<PageWalkRow[]>`
            WITH RECURSIVE up AS (
                SELECT g."id", g."parentId", g."projectId", g."title", g."deletedAt", 0 AS depth, ARRAY[g."id"] AS path
                  FROM "Page" g
                 WHERE g."tenantId" = ${ctx.tenantId} AND g."id" = ${id}
                UNION ALL
                SELECT p."id", p."parentId", p."projectId", p."title", p."deletedAt", u.depth + 1, u.path || p."id"
                  FROM "Page" p JOIN up u ON p."id" = u."parentId"
                 WHERE p."tenantId" = ${ctx.tenantId} AND u.depth < ${PAGE_WALK_DEPTH} AND NOT p."id" = ANY(u.path)
            )
            SELECT "id", "parentId", "projectId", "title", "deletedAt", depth FROM up ORDER BY depth`;
        return rows.map((r) => ({ ...r, depth: Number(r.depth) }));
    }

    /**
     * The page and every page below it, deleted ones included (the tree
     * checks, a delete's group, a move's rows), each with its depth below the
     * page (0 for the page), at most `limit` rows. Depth-capped and
     * path-guarded; served by `[tenantId, parentId]`.
     */
    static async subtree(db: PrismaTx, ctx: Ctx, id: string, limit: number): Promise<PageWalkRow[]> {
        const rows = await db.$queryRaw<PageWalkRow[]>`
            WITH RECURSIVE down AS (
                SELECT g."id", g."parentId", g."projectId", g."title", g."deletedAt", 0 AS depth, ARRAY[g."id"] AS path
                  FROM "Page" g
                 WHERE g."tenantId" = ${ctx.tenantId} AND g."id" = ${id}
                UNION ALL
                SELECT c."id", c."parentId", c."projectId", c."title", c."deletedAt", d.depth + 1, d.path || c."id"
                  FROM "Page" c JOIN down d ON c."parentId" = d."id"
                 WHERE c."tenantId" = ${ctx.tenantId} AND d.depth < ${PAGE_WALK_DEPTH} AND NOT c."id" = ANY(d.path)
            )
            SELECT "id", "parentId", "projectId", "title", "deletedAt", depth FROM down ORDER BY depth, "id" LIMIT ${limit}`;
        return rows.map((r) => ({ ...r, depth: Number(r.depth) }));
    }

    /** The sort keys of live siblings named by id, in one tree and under one parent. */
    static async siblingKeys(db: PrismaTx, ctx: Ctx, spot: PageTreeSpot, ids: readonly string[]): Promise<Array<{ id: string; sortKey: string }>> {
        if (ids.length === 0) return [];
        return db.page.findMany({
            where: { ...liveTreeWhere(ctx, spot), id: { in: [...ids] } },
            orderBy: { id: 'asc' },
            take: ids.length,
            select: { id: true, sortKey: true },
        });
    }

    /**
     * The live sibling key nearest `key` in one direction (`after`: the
     * smallest greater key, else the largest smaller one), or with no `key`
     * the first or last of the parent's live children; ties broken by id.
     */
    static async neighbourKey(db: PrismaTx, ctx: Ctx, spot: PageTreeSpot, key: string | null, direction: 'after' | 'before', excludeId?: string): Promise<string | null> {
        const row = await db.page.findFirst({
            where: {
                ...liveTreeWhere(ctx, spot),
                ...(excludeId ? { id: { not: excludeId } } : {}),
                ...(key === null ? {} : { sortKey: direction === 'after' ? { gt: key } : { lt: key } }),
            },
            orderBy: [{ sortKey: direction === 'after' ? 'asc' : 'desc' }, { id: direction === 'after' ? 'asc' : 'desc' }],
            select: { sortKey: true },
        });
        return row?.sortKey ?? null;
    }

    /** Is a live sibling (other than `excludeId`) holding `key` under this parent? */
    static async keyTaken(db: PrismaTx, ctx: Ctx, spot: PageTreeSpot, key: string, excludeId: string): Promise<boolean> {
        const row = await db.page.findFirst({ where: { ...liveTreeWhere(ctx, spot), sortKey: key, id: { not: excludeId } }, select: { id: true } });
        return row !== null;
    }

    /** A new page and its empty content row, in the caller's transaction (decision 344). */
    static async create(
        db: PrismaTx,
        ctx: Pick<RequestContext, 'tenantId' | 'userId'>,
        data: { projectId: string | null; parentId: string | null; title: string; sortKey: string },
    ): Promise<PageRow> {
        const page = await db.page.create({ data: { tenantId: ctx.tenantId, createdByUserId: ctx.userId, ...data }, select: pageSelect });
        await db.pageContent.create({ data: { pageId: page.id, tenantId: ctx.tenantId } });
        return page;
    }

    /**
     * A versioned rename of a live page: the version increases;
     * `expectedVersion` (from `If-Match`) must match. Returns the rows changed (0 or 1).
     */
    static async rename(db: PrismaTx, ctx: Ctx, id: string, expectedVersion: number, title: string): Promise<number> {
        const r = await db.page.updateMany({
            where: { id, tenantId: ctx.tenantId, deletedAt: null, version: expectedVersion },
            data: { title, version: { increment: 1 } },
        });
        return r.count;
    }

    /** Place a live page: its parent, its sort key and its version (a placement is a change of the row). */
    static async place(db: PrismaTx, ctx: Ctx, locked: readonly string[], id: string, data: { parentId: string | null; sortKey: string }): Promise<number> {
        if (!locked.includes(id)) throw new Error('PageRepository.place writes only a row its caller locked.');
        const r = await db.page.updateMany({ where: { id, tenantId: ctx.tenantId, deletedAt: null }, data: { ...data, version: { increment: 1 } } });
        return r.count;
    }

    /** Move locked pages (a subtree, deleted rows included) to another tree. */
    static async setTree(db: PrismaTx, ctx: Ctx, locked: readonly string[], projectId: string | null): Promise<number> {
        if (locked.length === 0) return 0;
        const r = await db.page.updateMany({ where: { tenantId: ctx.tenantId, id: { in: [...locked] } }, data: { projectId } });
        return r.count;
    }

    /** A sort key alone, for the rebalance and a restored root's re-placement: no version change. */
    static async setSortKey(db: PrismaTx, ctx: Ctx, locked: readonly string[], id: string, sortKey: string): Promise<void> {
        if (!locked.includes(id)) throw new Error('PageRepository.setSortKey writes only a row its caller locked.');
        await db.page.updateMany({ where: { id, tenantId: ctx.tenantId }, data: { sortKey } });
    }

    /** New sort keys for locked rows, in one statement (the rebalance): no version change. */
    static async rewriteSortKeys(db: PrismaTx, ctx: Ctx, locked: readonly string[], ids: readonly string[], keys: readonly string[]): Promise<void> {
        if (ids.length === 0) return;
        if (ids.length !== keys.length) throw new Error('PageRepository.rewriteSortKeys takes one key per id.');
        const held = new Set(locked);
        if (ids.some((id) => !held.has(id))) throw new Error('PageRepository.rewriteSortKeys writes only rows its caller locked.');
        await db.$executeRaw`
            UPDATE "Page" AS g SET "sortKey" = v."sortKey"
              FROM unnest(${[...ids]}::text[], ${[...keys]}::text[]) AS v("id", "sortKey")
             WHERE g."tenantId" = ${ctx.tenantId} AND g."id" = v."id"`;
    }

    /** Soft-delete the live pages among `locked` under one group. */
    static async softDeleteMany(db: PrismaTx, ctx: Pick<RequestContext, 'tenantId' | 'userId'>, locked: readonly string[], deletionId: string, at: Date): Promise<number> {
        if (locked.length === 0) return 0;
        const r = await db.page.updateMany({
            where: { tenantId: ctx.tenantId, id: { in: [...locked] }, deletedAt: null },
            data: { deletedAt: at, deletedByUserId: ctx.userId, deletionId, version: { increment: 1 } },
        });
        return r.count;
    }

    /** The pages of one delete group (at most the cap), with their parents, in id order. */
    static async ofDeletion(db: PrismaTx, ctx: Ctx, deletionId: string): Promise<Array<{ id: string; parentId: string | null }>> {
        return db.page.findMany({
            where: { tenantId: ctx.tenantId, deletionId },
            orderBy: { id: 'asc' },
            take: PAGE_SUBTREE_CAP,
            select: { id: true, parentId: true },
        });
    }

    /** Bring a delete group back: every row of it live again. */
    static async restoreGroup(db: PrismaTx, ctx: Ctx, locked: readonly string[], deletionId: string): Promise<number> {
        if (locked.length === 0) return 0;
        const r = await db.page.updateMany({
            where: { tenantId: ctx.tenantId, id: { in: [...locked] }, deletionId },
            data: { deletedAt: null, deletedByUserId: null, deletionId: null, version: { increment: 1 } },
        });
        return r.count;
    }

    /**
     * The Deleted list of one tree: each deleted page whose parent is not in
     * its own group (a group's roots), newest first, with the group's size; at
     * most `DELETED_PAGES_TAKE`.
     */
    static async listDeletedRoots(db: PrismaTx, ctx: Ctx, projectId: string | null): Promise<Array<PageRow & { groupSize: number }>> {
        const rows = await db.$queryRaw<Array<{ id: string; groupSize: bigint }>>`
            SELECT g."id", (SELECT count(*) FROM "Page" m WHERE m."tenantId" = g."tenantId" AND m."deletionId" = g."deletionId") AS "groupSize"
              FROM "Page" g
             WHERE g."tenantId" = ${ctx.tenantId}
               AND ${projectId === null ? Prisma.sql`g."projectId" IS NULL` : Prisma.sql`g."projectId" = ${projectId}`}
               AND g."deletedAt" IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1 FROM "Page" p
                    WHERE p."tenantId" = g."tenantId" AND p."id" = g."parentId" AND p."deletionId" = g."deletionId")
             ORDER BY g."deletedAt" DESC, g."id" ASC
             LIMIT ${DELETED_PAGES_TAKE}`;
        if (rows.length === 0) return [];
        const full = await db.page.findMany({ where: { tenantId: ctx.tenantId, id: { in: rows.map((r) => r.id) } }, take: rows.length, select: pageSelect });
        const byId = new Map(full.map((r) => [r.id, r]));
        return rows.flatMap((r) => {
            const row = byId.get(r.id);
            return row ? [{ ...row, groupSize: Number(r.groupSize) }] : [];
        });
    }

    /** The delete groups of the workspace deleted before `before`, oldest first, at most `take`. */
    static async purgeableGroups(db: PrismaTx, ctx: Ctx, before: Date, take: number): Promise<string[]> {
        const rows = await db.page.groupBy({
            by: ['deletionId'],
            where: { tenantId: ctx.tenantId, deletedAt: { lt: before }, deletionId: { not: null } },
            _max: { deletedAt: true },
            orderBy: { _max: { deletedAt: 'asc' } },
            take,
        });
        return rows.map((r) => r.deletionId!).filter(Boolean);
    }

    /** The rows of the given groups, in id order (the purge locks them first). */
    static async idsOfGroups(db: PrismaTx, ctx: Ctx, deletionIds: readonly string[], take: number): Promise<string[]> {
        if (deletionIds.length === 0) return [];
        const rows = await db.page.findMany({
            where: { tenantId: ctx.tenantId, deletionId: { in: [...deletionIds] }, deletedAt: { not: null } },
            orderBy: { id: 'asc' },
            take,
            select: { id: true },
        });
        return rows.map((r) => r.id);
    }

    /** Hard-delete locked, deleted pages; their content cascades (decision 344). */
    static async purge(db: PrismaTx, ctx: Ctx, locked: readonly string[], before: Date): Promise<number> {
        if (locked.length === 0) return 0;
        const r = await db.page.deleteMany({ where: { tenantId: ctx.tenantId, id: { in: [...locked] }, deletedAt: { lt: before } } });
        return r.count;
    }

    /**
     * The sibling groups (tree and parent) of the workspace with a sort key
     * longer than `length` (ADR 0002 §5's rebalance rule), deleted rows
     * included; at most `take`.
     */
    static async siblingGroupsNeedingRebalance(db: PrismaTx, ctx: Ctx, length: number, take: number): Promise<PageTreeSpot[]> {
        const rows = await db.$queryRaw<PageTreeSpot[]>`
            SELECT DISTINCT "projectId", "parentId" FROM "Page"
             WHERE "tenantId" = ${ctx.tenantId} AND length("sortKey") > ${length}
             LIMIT ${take}`;
        return rows;
    }

    /** One sibling group's rows in order, deleted ones included (a deleted row keeps its place), at most `take`. */
    static async siblingsInOrder(db: PrismaTx, ctx: Ctx, spot: PageTreeSpot, take: number): Promise<Array<{ id: string; sortKey: string }>> {
        return db.page.findMany({
            where: { tenantId: ctx.tenantId, projectId: spot.projectId, parentId: spot.parentId },
            orderBy: [{ sortKey: 'asc' }, { id: 'asc' }],
            take,
            select: { id: true, sortKey: true },
        });
    }

    /**
     * Live pages whose title holds the query (`Page_search_title_trgm`) or all
     * its words (`Page_search_title_fts`), as ids in candidate order; bounded
     * by `limit` (at most `SEARCH_ROW_CAP`, which the function also caps).
     * The read is the SECURITY DEFINER function `search_page_titles` (owner
     * decision 245's pattern): it reads the workspace from `app.tenant_id`
     * and filters `deletedAt`, the project's liveness and visibility itself;
     * the caller asks `pages.view` first.
     */
    static async searchTitleIds(db: PrismaTx, _ctx: Ctx, v: ProjectVisibility, query: string, opts: { limit: number }): Promise<Array<{ id: string; ordinal: number }>> {
        const limit = Math.min(Math.max(1, Math.floor(opts.limit)), SEARCH_ROW_CAP);
        const rows = await db.$queryRaw<Array<{ id: string; ordinal: number }>>(Prisma.sql`
            SELECT t."id", t."ordinal"
              FROM search_page_titles(${query}::text, ${containsPattern(query)}::text, ${prefixPattern(query)}::text,
                                      ${projectVisibilityArgs(v)}, ${limit}::integer) t
             ORDER BY t."ordinal"`);
        return rows.map((r) => ({ id: r.id, ordinal: Number(r.ordinal) }));
    }

    /**
     * The search rows of pages found by `searchTitleIds`: live, in a tree the
     * caller reads (a workspace page, or one of a live, unarchived, visible
     * project), by id, under row-level security.
     */
    static async findSearchRows(db: PrismaTx, ctx: Ctx, v: ProjectVisibility, ids: readonly string[]): Promise<Array<{ id: string; title: string; projectId: string | null }>> {
        if (ids.length === 0) return [];
        return db.page.findMany({
            where: { tenantId: ctx.tenantId, id: { in: [...ids] }, deletedAt: null, OR: [{ projectId: null }, { project: projectRowVisibilityWhere(v) }] },
            take: SEARCH_ROW_CAP,
            select: { id: true, title: true, projectId: true },
        });
    }
}
