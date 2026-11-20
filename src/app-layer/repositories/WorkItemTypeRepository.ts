/**
 * Work item types (sub-phase 2.1, ADR 0002 §1). Written fresh for Islestone.
 */
import type { Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import type { RequestContext } from '../types';

export const WORK_ITEM_TYPE_TAKE = 200;

const typeSelect = {
    id: true,
    name: true,
    icon: true,
    color: true,
    sortKey: true,
    archivedAt: true,
    /** Review must finish before Done (2.8c, decision 149). */
    reviewRequiredForDone: true,
} satisfies Prisma.WorkItemTypeSelect;

export class WorkItemTypeRepository {
    static async list(db: PrismaTx, ctx: RequestContext, opts: { includeArchived?: boolean } = {}) {
        return db.workItemType.findMany({
            where: { tenantId: ctx.tenantId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
            orderBy: [{ sortKey: 'asc' }, { id: 'asc' }],
            take: WORK_ITEM_TYPE_TAKE,
            select: typeSelect,
        });
    }

    static async count(db: PrismaTx, ctx: RequestContext) {
        return db.workItemType.count({ where: { tenantId: ctx.tenantId } });
    }

    static async getById(db: PrismaTx, ctx: RequestContext, id: string) {
        return db.workItemType.findFirst({ where: { id, tenantId: ctx.tenantId }, select: typeSelect });
    }

    static async lastSortKey(db: PrismaTx, ctx: RequestContext): Promise<string | null> {
        const last = await db.workItemType.findFirst({
            where: { tenantId: ctx.tenantId },
            orderBy: [{ sortKey: 'desc' }, { id: 'desc' }],
            select: { sortKey: true },
        });
        return last?.sortKey ?? null;
    }

    static async create(
        db: PrismaTx,
        ctx: RequestContext,
        data: { name: string; icon?: string | null; color?: string | null; sortKey: string },
    ) {
        return db.workItemType.create({ data: { tenantId: ctx.tenantId, ...data }, select: typeSelect });
    }

    /** Seed rows, skipping names the workspace already has. */
    static async createMany(db: PrismaTx, ctx: RequestContext, rows: ReadonlyArray<{ name: string; sortKey: string }>) {
        return db.workItemType.createMany({
            data: rows.map((r) => ({ tenantId: ctx.tenantId, name: r.name, sortKey: r.sortKey })),
            skipDuplicates: true,
        });
    }

    static async update(
        db: PrismaTx,
        ctx: RequestContext,
        id: string,
        data: { name?: string; icon?: string | null; color?: string | null; sortKey?: string; archivedAt?: Date | null },
    ) {
        return db.workItemType.updateMany({ where: { id, tenantId: ctx.tenantId }, data });
    }
}
