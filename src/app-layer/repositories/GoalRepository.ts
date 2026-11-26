/**
 * Goals (sub-phase 3.2a; docs/porting/maps/3.2.md; ADR 0002 §2 and §17).
 * Every query filters by `tenantId` (RLS also scopes it). Reads used by the
 * tree checks include deleted goals on purpose: a soft-deleted goal keeps its
 * place in the tree so a restore can never make a cycle or pass the depth cap.
 *
 * The walks are depth-capped and path-guarded recursive reads: Paperclip's
 * shape (`getAncestors`, pattern only, no code copied; PROVENANCE.md).
 *
 * Written fresh for Islestone.
 */
import type { GoalStatus, Health, Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId'>;

/** The goals a list or picker reads at once: far beyond a real workspace's. */
export const GOALS_LIST_TAKE = 2_000;
/** The most goals one delete group may hold (a goal and everything below it). */
export const GOAL_SUBTREE_CAP = 2_000;
/** A walk stops here even if a cycle ever slipped past the lock (the tree is at most 3 deep). */
export const GOAL_WALK_DEPTH = 8;

export const goalSelect = {
    id: true,
    parentId: true,
    title: true,
    description: true,
    status: true,
    dueDate: true,
    leadUserId: true,
    health: true,
    healthSetAt: true,
    healthSetByUserId: true,
    version: true,
    archivedAt: true,
    deletedAt: true,
    deletionId: true,
    createdByUserId: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.GoalSelect;

export type GoalRow = Prisma.GoalGetPayload<{ select: typeof goalSelect }>;

/** The fields of a goal a picker or a tree check reads (never the description). */
export const goalLiteSelect = {
    id: true,
    parentId: true,
    title: true,
    status: true,
    archivedAt: true,
    deletedAt: true,
    deletionId: true,
} satisfies Prisma.GoalSelect;

export type GoalLiteRow = Prisma.GoalGetPayload<{ select: typeof goalLiteSelect }>;

export interface GoalListOptions {
    /** The Deleted view: deleted goals only. */
    deleted?: boolean;
    /** Archived goals too (`archived=true`). */
    includeArchived?: boolean;
    statuses?: readonly GoalStatus[];
    leadUserId?: string;
    /** `null` in the list: goals with no health set. */
    health?: ReadonlyArray<Health | null>;
}

export type GoalPatch = Partial<{
    parentId: string | null;
    title: string;
    description: string | null;
    status: GoalStatus;
    dueDate: Date | null;
    leadUserId: string | null;
    archivedAt: Date | null;
    archivedByUserId: string | null;
    health: Health | null;
    healthSetAt: Date | null;
    healthSetByUserId: string | null;
}>;

export class GoalRepository {
    static async list(db: PrismaTx, ctx: Ctx, opts: GoalListOptions = {}): Promise<GoalRow[]> {
        const and: Prisma.GoalWhereInput[] = [];
        if (opts.health && opts.health.length > 0) {
            const values = opts.health.filter((h): h is Health => h !== null);
            const or: Prisma.GoalWhereInput[] = [];
            if (values.length) or.push({ health: { in: values } });
            if (values.length !== opts.health.length) or.push({ health: null });
            and.push({ OR: or });
        }
        return db.goal.findMany({
            where: {
                tenantId: ctx.tenantId,
                deletedAt: opts.deleted ? { not: null } : null,
                ...(opts.deleted || opts.includeArchived ? {} : { archivedAt: null }),
                ...(opts.statuses && opts.statuses.length ? { status: { in: [...opts.statuses] } } : {}),
                ...(opts.leadUserId ? { leadUserId: opts.leadUserId } : {}),
                ...(and.length ? { AND: and } : {}),
            },
            orderBy: [{ id: 'asc' }],
            take: GOALS_LIST_TAKE,
            select: goalSelect,
        });
    }

    /** Live, unarchived goals (pickers, filters): never a description. */
    static async listLinkable(db: PrismaTx, ctx: Ctx): Promise<GoalLiteRow[]> {
        return db.goal.findMany({
            where: { tenantId: ctx.tenantId, deletedAt: null, archivedAt: null },
            orderBy: [{ title: 'asc' }, { id: 'asc' }],
            take: GOALS_LIST_TAKE,
            select: goalLiteSelect,
        });
    }

    /**
     * Every live goal of the workspace, archived ones included, as a tree
     * (id and parent): progress walks it in memory (3.2b). At most `take`.
     */
    static async liveTree(db: PrismaTx, ctx: Ctx, take: number): Promise<Array<{ id: string; parentId: string | null }>> {
        return db.goal.findMany({
            where: { tenantId: ctx.tenantId, deletedAt: null },
            orderBy: { id: 'asc' },
            take,
            select: { id: true, parentId: true },
        });
    }

    /** Any goal of the workspace, deleted included. */
    static async getAny(db: PrismaTx, ctx: Ctx, id: string): Promise<GoalRow | null> {
        return db.goal.findFirst({ where: { id, tenantId: ctx.tenantId }, select: goalSelect });
    }

    /** Several goals by id, full rows (any state; the caller filters). */
    static async getMany(db: PrismaTx, ctx: Ctx, ids: readonly string[]): Promise<GoalRow[]> {
        if (ids.length === 0) return [];
        return db.goal.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...ids] } }, take: GOALS_LIST_TAKE, select: goalSelect });
    }

    /** A goal's live children (archived ones included). */
    static async liveChildren(db: PrismaTx, ctx: Ctx, parentId: string): Promise<GoalRow[]> {
        return db.goal.findMany({
            where: { tenantId: ctx.tenantId, parentId, deletedAt: null },
            orderBy: { id: 'asc' },
            take: GOALS_LIST_TAKE,
            select: goalSelect,
        });
    }

    /** Several goals by id (any state; the caller filters). */
    static async getManyLite(db: PrismaTx, ctx: Ctx, ids: readonly string[]): Promise<GoalLiteRow[]> {
        if (ids.length === 0) return [];
        return db.goal.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...ids] } }, take: GOALS_LIST_TAKE, select: goalLiteSelect });
    }

    /**
     * Read a goal `FOR KEY SHARE` in the caller's workspace (Paperclip's
     * same-workspace check, pattern only): a concurrent purge cannot delete it
     * before the caller's link commits.
     */
    static async lockForKeyShare(db: PrismaTx, ctx: Ctx, id: string): Promise<{ id: string; title: string; archivedAt: Date | null; deletedAt: Date | null } | null> {
        const rows = await db.$queryRaw<Array<{ id: string; title: string; archivedAt: Date | null; deletedAt: Date | null }>>`
            SELECT "id", "title", "archivedAt", "deletedAt" FROM "Goal"
             WHERE "id" = ${id} AND "tenantId" = ${ctx.tenantId}
             FOR KEY SHARE`;
        return rows[0] ?? null;
    }

    /** Lock one goal's row for a versioned write. */
    static async lock(db: PrismaTx, ctx: Ctx, id: string): Promise<boolean> {
        const rows = await db.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "Goal" WHERE "id" = ${id} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
        return rows.length === 1;
    }

    /**
     * The goal and its ancestors, deleted ones included, nearest first, each
     * with its distance (0 for the goal itself). Depth-capped and path-guarded.
     */
    static async ancestorsIncludingDeleted(db: PrismaTx, ctx: Ctx, id: string): Promise<Array<{ id: string; depth: number }>> {
        const rows = await db.$queryRaw<Array<{ id: string; depth: number }>>`
            WITH RECURSIVE up AS (
                SELECT g."id", g."parentId", 0 AS depth, ARRAY[g."id"] AS path
                  FROM "Goal" g
                 WHERE g."tenantId" = ${ctx.tenantId} AND g."id" = ${id}
                UNION ALL
                SELECT p."id", p."parentId", u.depth + 1, u.path || p."id"
                  FROM "Goal" p JOIN up u ON p."id" = u."parentId"
                 WHERE p."tenantId" = ${ctx.tenantId} AND u.depth < ${GOAL_WALK_DEPTH} AND NOT p."id" = ANY(u.path)
            )
            SELECT "id", depth FROM up ORDER BY depth`;
        return rows.map((r) => ({ id: r.id, depth: Number(r.depth) }));
    }

    /**
     * The goal and every goal below it, deleted ones included (the tree
     * checks and a delete's group), each with its depth below the goal (0 for
     * the goal), at most `limit` rows. Depth-capped and path-guarded; served by
     * `[tenantId, parentId]`.
     */
    static async subtreeIncludingDeleted(db: PrismaTx, ctx: Ctx, id: string, limit: number): Promise<Array<{ id: string; depth: number; deletedAt: Date | null }>> {
        const rows = await db.$queryRaw<Array<{ id: string; depth: number; deletedAt: Date | null }>>`
            WITH RECURSIVE down AS (
                SELECT g."id", g."deletedAt", 0 AS depth, ARRAY[g."id"] AS path
                  FROM "Goal" g
                 WHERE g."tenantId" = ${ctx.tenantId} AND g."id" = ${id}
                UNION ALL
                SELECT c."id", c."deletedAt", d.depth + 1, d.path || c."id"
                  FROM "Goal" c JOIN down d ON c."parentId" = d."id"
                 WHERE c."tenantId" = ${ctx.tenantId} AND d.depth < ${GOAL_WALK_DEPTH} AND NOT c."id" = ANY(d.path)
            )
            SELECT "id", depth, "deletedAt" FROM down ORDER BY depth, "id" LIMIT ${limit}`;
        return rows.map((r) => ({ id: r.id, depth: Number(r.depth), deletedAt: r.deletedAt }));
    }

    /**
     * The LIVE goals at or below the given goals (the `goalId` filter, decision
     * 220): the walk stops at a deleted goal. At most `limit` ids.
     */
    static async liveSubtreeIds(db: PrismaTx, ctx: Ctx, ids: readonly string[], limit: number): Promise<string[]> {
        if (ids.length === 0) return [];
        const rows = await db.$queryRaw<Array<{ id: string }>>`
            WITH RECURSIVE down AS (
                SELECT g."id", 0 AS depth, ARRAY[g."id"] AS path
                  FROM "Goal" g
                 WHERE g."tenantId" = ${ctx.tenantId} AND g."id" = ANY(${[...ids]}::text[]) AND g."deletedAt" IS NULL
                UNION ALL
                SELECT c."id", d.depth + 1, d.path || c."id"
                  FROM "Goal" c JOIN down d ON c."parentId" = d."id"
                 WHERE c."tenantId" = ${ctx.tenantId} AND c."deletedAt" IS NULL AND d.depth < ${GOAL_WALK_DEPTH} AND NOT c."id" = ANY(d.path)
            )
            SELECT DISTINCT "id" FROM down LIMIT ${limit}`;
        return rows.map((r) => r.id);
    }

    static async create(
        db: PrismaTx,
        ctx: Pick<RequestContext, 'tenantId' | 'userId'>,
        data: { parentId: string | null; title: string; description: string | null; status: GoalStatus; dueDate: Date | null; leadUserId: string | null },
    ): Promise<GoalRow> {
        return db.goal.create({ data: { tenantId: ctx.tenantId, createdByUserId: ctx.userId, ...data }, select: goalSelect });
    }

    /**
     * A versioned write of a live goal: the version increases; `expectedVersion`
     * (from `If-Match`) must match when given. Returns the rows changed (0 or 1).
     */
    static async updateVersioned(db: PrismaTx, ctx: Ctx, id: string, expectedVersion: number | undefined, data: GoalPatch): Promise<number> {
        const r = await db.goal.updateMany({
            where: { id, tenantId: ctx.tenantId, deletedAt: null, ...(expectedVersion !== undefined ? { version: expectedVersion } : {}) },
            data: { ...data, version: { increment: 1 } },
        });
        return r.count;
    }

    /** Soft-delete the live goals among `ids` under one group. */
    static async softDeleteMany(db: PrismaTx, ctx: Pick<RequestContext, 'tenantId' | 'userId'>, ids: readonly string[], deletionId: string, at: Date): Promise<number> {
        if (ids.length === 0) return 0;
        const r = await db.goal.updateMany({
            where: { tenantId: ctx.tenantId, id: { in: [...ids] }, deletedAt: null },
            data: { deletedAt: at, deletedByUserId: ctx.userId, deletionId, version: { increment: 1 } },
        });
        return r.count;
    }

    /** The goals of one delete group (at most the cap). */
    static async idsOfDeletion(db: PrismaTx, ctx: Ctx, deletionId: string): Promise<string[]> {
        const rows = await db.goal.findMany({
            where: { tenantId: ctx.tenantId, deletionId },
            orderBy: { id: 'asc' },
            take: GOAL_SUBTREE_CAP + 1,
            select: { id: true },
        });
        return rows.map((r) => r.id);
    }

    /** Bring a delete group back. */
    static async restoreGroup(db: PrismaTx, ctx: Ctx, deletionId: string): Promise<number> {
        const r = await db.goal.updateMany({
            where: { tenantId: ctx.tenantId, deletionId, deletedAt: { not: null } },
            data: { deletedAt: null, deletedByUserId: null, deletionId: null, version: { increment: 1 } },
        });
        return r.count;
    }

    /** Clear a leaving member's lead on every goal, deleted ones included. */
    static async clearLead(db: PrismaTx, ctx: Ctx, userId: string): Promise<Array<{ id: string; title: string }>> {
        const rows = await db.goal.findMany({
            where: { tenantId: ctx.tenantId, leadUserId: userId },
            orderBy: { id: 'asc' },
            take: GOALS_LIST_TAKE,
            select: { id: true, title: true },
        });
        if (rows.length === 0) return [];
        await db.goal.updateMany({
            where: { tenantId: ctx.tenantId, id: { in: rows.map((r) => r.id) }, leadUserId: userId },
            data: { leadUserId: null, version: { increment: 1 } },
        });
        return rows;
    }

    // ── Purge (decision 219) ─────────────────────────────────────────

    /** Goals deleted before `before`, a page in id order. */
    static async purgeableIds(db: PrismaTx, ctx: Ctx, before: Date, take: number): Promise<string[]> {
        const rows = await db.goal.findMany({
            where: { tenantId: ctx.tenantId, deletedAt: { lt: before } },
            orderBy: { id: 'asc' },
            take,
            select: { id: true },
        });
        return rows.map((r) => r.id);
    }

    /**
     * Hard-delete a page of purgeable goals: the only DELETE on `Goal`. The
     * column-scoped `SET NULL` keys clear every link to them (a child goal's
     * parent, an initiative's goal, an item's goal). Re-checks the window, so
     * a goal restored since the page was read stays.
     */
    static async purgeBatch(db: PrismaTx, ctx: Ctx, ids: readonly string[], before: Date): Promise<number> {
        if (ids.length === 0) return 0;
        const r = await db.goal.deleteMany({ where: { tenantId: ctx.tenantId, id: { in: [...ids] }, deletedAt: { lt: before } } });
        return r.count;
    }
}
