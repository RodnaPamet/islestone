/**
 * Labels and their attachment to work items (sub-phase 2.1).
 *
 * The "being deleted" mark (`deletionStartedAt`) follows Kaneo's label
 * deletion lock (`apps/api/src/label/deletion-lock.ts` at
 * fb890b4974e6dd6c232f1de6a6b70a591dfca0a3; pattern only, no code copied).
 * Written fresh for Islestone.
 */
import type { Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import type { RequestContext } from '../types';

export const LABEL_LIST_TAKE = 500;
/** Labels on one item. */
export const ITEM_LABELS_TAKE = 50;
/** Detach rows per statement when a label is deleted. */
export const LABEL_DETACH_BATCH = 500;

const labelSelect = {
    id: true,
    teamId: true,
    name: true,
    color: true,
    sortKey: true,
    deletionStartedAt: true,
} satisfies Prisma.LabelSelect;

export class LabelRepository {
    static async list(db: PrismaTx, ctx: RequestContext, opts: { teamId?: string } = {}) {
        return db.label.findMany({
            where: {
                tenantId: ctx.tenantId,
                deletionStartedAt: null,
                ...(opts.teamId ? { OR: [{ teamId: null }, { teamId: opts.teamId }] } : {}),
            },
            orderBy: [{ sortKey: 'asc' }, { id: 'asc' }],
            take: LABEL_LIST_TAKE,
            select: labelSelect,
        });
    }

    static async getById(db: PrismaTx, ctx: RequestContext, id: string) {
        return db.label.findFirst({ where: { id, tenantId: ctx.tenantId }, select: labelSelect });
    }

    static async getMany(db: PrismaTx, ctx: RequestContext, ids: readonly string[]) {
        return db.label.findMany({
            where: { tenantId: ctx.tenantId, id: { in: [...ids] } },
            take: ids.length,
            select: labelSelect,
        });
    }

    static async nameTaken(db: PrismaTx, ctx: RequestContext, teamId: string | null, name: string, exceptId?: string) {
        const row = await db.label.findFirst({
            where: { tenantId: ctx.tenantId, teamId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
            select: { id: true },
        });
        return row !== null;
    }

    static async lastSortKey(db: PrismaTx, ctx: RequestContext): Promise<string | null> {
        const last = await db.label.findFirst({
            where: { tenantId: ctx.tenantId },
            orderBy: [{ sortKey: 'desc' }, { id: 'desc' }],
            select: { sortKey: true },
        });
        return last?.sortKey ?? null;
    }

    static async create(
        db: PrismaTx,
        ctx: RequestContext,
        data: { teamId: string | null; name: string; color?: string | null; sortKey: string },
    ) {
        return db.label.create({ data: { tenantId: ctx.tenantId, ...data }, select: labelSelect });
    }

    static async update(db: PrismaTx, ctx: RequestContext, id: string, data: { name?: string; color?: string | null; sortKey?: string }) {
        return db.label.updateMany({ where: { id, tenantId: ctx.tenantId, deletionStartedAt: null }, data });
    }

    static async markDeleting(db: PrismaTx, ctx: RequestContext, id: string) {
        return db.label.updateMany({
            where: { id, tenantId: ctx.tenantId, deletionStartedAt: null },
            data: { deletionStartedAt: new Date() },
        });
    }

    /** One batch of the items a label is on, for the batched detach. */
    static async attachedItemIds(db: PrismaTx, ctx: RequestContext, labelId: string): Promise<string[]> {
        const rows = await db.workItemLabel.findMany({
            where: { tenantId: ctx.tenantId, labelId },
            // Ascending, so a drain's batches lock rows in id order (decision 173).
            orderBy: { workItemId: 'asc' },
            take: LABEL_DETACH_BATCH,
            select: { workItemId: true },
        });
        return rows.map((r) => r.workItemId);
    }

    static async detachFrom(db: PrismaTx, ctx: RequestContext, labelId: string, workItemIds: readonly string[]) {
        return db.workItemLabel.deleteMany({ where: { tenantId: ctx.tenantId, labelId, workItemId: { in: [...workItemIds] } } });
    }

    static async delete(db: PrismaTx, ctx: RequestContext, id: string) {
        return db.label.deleteMany({ where: { id, tenantId: ctx.tenantId } });
    }

    // ── On an item ───────────────────────────────────────────────────

    static async listForItem(db: PrismaTx, ctx: RequestContext, workItemId: string) {
        return db.workItemLabel.findMany({
            where: { tenantId: ctx.tenantId, workItemId },
            take: ITEM_LABELS_TAKE,
            orderBy: [{ createdAt: 'asc' }, { labelId: 'asc' }],
            select: { labelId: true },
        });
    }

    static async attach(db: PrismaTx, ctx: RequestContext, workItemId: string, labelIds: readonly string[]) {
        if (labelIds.length === 0) return { count: 0 };
        return db.workItemLabel.createMany({
            data: labelIds.map((labelId) => ({ tenantId: ctx.tenantId, workItemId, labelId })),
            skipDuplicates: true,
        });
    }

    static async detach(db: PrismaTx, ctx: RequestContext, workItemId: string, labelIds: readonly string[]) {
        if (labelIds.length === 0) return { count: 0 };
        return db.workItemLabel.deleteMany({ where: { tenantId: ctx.tenantId, workItemId, labelId: { in: [...labelIds] } } });
    }

    /** Detach every label of a team from items (a move to another team). */
    static async detachTeamLabels(db: PrismaTx, ctx: RequestContext, workItemIds: readonly string[], teamId: string) {
        return db.workItemLabel.deleteMany({
            where: { tenantId: ctx.tenantId, workItemId: { in: [...workItemIds] }, label: { teamId } },
        });
    }
}
