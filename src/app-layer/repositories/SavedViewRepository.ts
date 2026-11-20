/**
 * Saved views (sub-phase 2.4, ADR 0006 "View").
 *
 * Every read carries the visibility rule in its own `where`: the caller's own
 * views, and the SHARED views whose scope is the workspace or a project the
 * caller can see (`projectRowVisibilityWhere`). A personal view is never
 * read for anybody but its creator.
 *
 * Written fresh for Islestone.
 */
import type { Prisma, SavedViewVisibility, ViewLayout } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import { projectRowVisibilityWhere, type ProjectVisibility } from '../policies/project-visibility';
import type { RequestContext } from '../types';

/** Views one list returns (one past it marks truncation). */
export const SAVED_VIEW_LIST_CAP = 200;

export const savedViewSelect = {
    id: true,
    name: true,
    visibility: true,
    projectId: true,
    layout: true,
    configJson: true,
    createdByUserId: true,
    createdAt: true,
    updatedAt: true,
    project: { select: { keyPrefix: true, name: true } },
} satisfies Prisma.SavedViewSelect;

export type SavedViewRow = Prisma.SavedViewGetPayload<{ select: typeof savedViewSelect }>;

/** `undefined`: every scope; `null`: the workspace's; a string: one project's. */
export type SavedViewScopeFilter = string | null | undefined;

function readableWhere(ctx: RequestContext, v: ProjectVisibility): Prisma.SavedViewWhereInput {
    return {
        tenantId: ctx.tenantId,
        AND: [
            { OR: [{ createdByUserId: ctx.userId }, { visibility: 'SHARED' }] },
            { OR: [{ projectId: null }, { project: projectRowVisibilityWhere(v, { includeArchived: true }) }] },
        ],
    };
}

export class SavedViewRepository {
    static async list(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, scope: SavedViewScopeFilter) {
        const where = readableWhere(ctx, v);
        if (scope !== undefined) (where.AND as Prisma.SavedViewWhereInput[]).push({ projectId: scope });
        return db.savedView.findMany({
            where,
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            take: SAVED_VIEW_LIST_CAP + 1,
            select: savedViewSelect,
        });
    }

    /** One view the caller may read, or null. */
    static async getReadable(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, id: string) {
        const where = readableWhere(ctx, v);
        where.id = id;
        return db.savedView.findFirst({ where, select: savedViewSelect });
    }

    static async create(
        db: PrismaTx,
        ctx: RequestContext,
        data: { name: string; visibility: SavedViewVisibility; projectId: string | null; layout: ViewLayout; configJson: Prisma.InputJsonValue },
    ) {
        return db.savedView.create({ data: { tenantId: ctx.tenantId, createdByUserId: ctx.userId, ...data }, select: savedViewSelect });
    }

    static async update(
        db: PrismaTx,
        ctx: RequestContext,
        id: string,
        data: { name?: string; visibility?: SavedViewVisibility; layout?: ViewLayout; configJson?: Prisma.InputJsonValue },
    ) {
        const result = await db.savedView.updateMany({ where: { id, tenantId: ctx.tenantId }, data });
        return result.count;
    }

    static async delete(db: PrismaTx, ctx: RequestContext, id: string) {
        const result = await db.savedView.deleteMany({ where: { id, tenantId: ctx.tenantId } });
        return result.count;
    }
}
