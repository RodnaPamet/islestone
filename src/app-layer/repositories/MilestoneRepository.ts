/**
 * Milestones (sub-phase 2.5b, docs/porting/maps/2.5.md). Every query filters
 * by `tenantId` (RLS also scopes it). The `WorkItem` reads and writes a
 * milestone needs (its items' counts, clearing them) live in
 * `WorkItemRepository`, beside its other predicates.
 *
 * Written fresh for Islestone.
 */
import type { Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId'>;

/** A project's milestones on one read: far beyond a real project's. */
export const MILESTONES_PER_PROJECT_TAKE = 200;
/** The milestones the views name across visible projects. */
export const MILESTONES_VIEW_TAKE = 2_000;

export const milestoneSelect = {
    id: true,
    projectId: true,
    name: true,
    dueDate: true,
    sortKey: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.MilestoneSelect;

export type MilestoneRow = Prisma.MilestoneGetPayload<{ select: typeof milestoneSelect }>;

export class MilestoneRepository {
    static async listForProject(db: PrismaTx, ctx: Ctx, projectId: string): Promise<MilestoneRow[]> {
        return db.milestone.findMany({
            where: { tenantId: ctx.tenantId, projectId },
            orderBy: [{ sortKey: 'asc' }, { id: 'asc' }],
            take: MILESTONES_PER_PROJECT_TAKE,
            select: milestoneSelect,
        });
    }

    /** The milestones of the given projects (the views' pickers, filters and lanes). */
    static async listForProjects(db: PrismaTx, ctx: Ctx, projectIds: readonly string[]): Promise<MilestoneRow[]> {
        if (projectIds.length === 0) return [];
        return db.milestone.findMany({
            where: { tenantId: ctx.tenantId, projectId: { in: [...projectIds] } },
            orderBy: [{ projectId: 'asc' }, { sortKey: 'asc' }, { id: 'asc' }],
            take: MILESTONES_VIEW_TAKE,
            select: milestoneSelect,
        });
    }

    /**
     * The dated milestones of the given projects (the roadmap's diamonds,
     * 3.2c): an undated milestone has no diamond and is never late. By due
     * date, then id; at most `take`.
     */
    static async datedForProjects(db: PrismaTx, ctx: Ctx, projectIds: readonly string[], take: number) {
        if (projectIds.length === 0) return [];
        return db.milestone.findMany({
            where: { tenantId: ctx.tenantId, projectId: { in: [...projectIds] }, dueDate: { not: null } },
            orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
            take,
            select: { id: true, projectId: true, name: true, dueDate: true },
        });
    }

    /**
     * The milestones of the named projects due in `[from, to]` (the
     * calendar's markers, 3.3a); by due date, then id; at most `take`.
     */
    static async datedInWindow(db: PrismaTx, ctx: Ctx, projectIds: readonly string[], from: Date, to: Date, take: number) {
        if (projectIds.length === 0) return [];
        return db.milestone.findMany({
            where: { tenantId: ctx.tenantId, projectId: { in: [...projectIds] }, dueDate: { gte: from, lte: to } },
            orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
            take,
            select: { id: true, projectId: true, name: true, dueDate: true },
        });
    }

    /** The named milestones (a calendar's `milestoneId` filter, 3.3a), at most as many as named. */
    static async byIds(db: PrismaTx, ctx: Ctx, ids: readonly string[]) {
        if (ids.length === 0) return [];
        return db.milestone.findMany({
            where: { tenantId: ctx.tenantId, id: { in: [...ids] } },
            orderBy: { id: 'asc' },
            take: ids.length,
            select: { id: true, projectId: true, name: true, dueDate: true },
        });
    }

    static async getById(db: PrismaTx, ctx: Ctx, id: string): Promise<MilestoneRow | null> {
        return db.milestone.findFirst({ where: { id, tenantId: ctx.tenantId }, select: milestoneSelect });
    }

    static async nameTaken(db: PrismaTx, ctx: Ctx, projectId: string, name: string, exceptId?: string): Promise<boolean> {
        const hit = await db.milestone.findFirst({
            where: { tenantId: ctx.tenantId, projectId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
            select: { id: true },
        });
        return hit !== null;
    }

    static async lastSortKey(db: PrismaTx, ctx: Ctx, projectId: string): Promise<string | null> {
        const last = await db.milestone.findFirst({
            where: { tenantId: ctx.tenantId, projectId },
            orderBy: { sortKey: 'desc' },
            select: { sortKey: true },
        });
        return last?.sortKey ?? null;
    }

    /** The milestone next to `anchor` on `side`, other than `exceptId` (the one being moved). */
    static async neighbour(db: PrismaTx, ctx: Ctx, projectId: string, anchor: { sortKey: string }, side: 'after' | 'before', exceptId: string) {
        return db.milestone.findFirst({
            where: {
                tenantId: ctx.tenantId,
                projectId,
                id: { not: exceptId },
                sortKey: side === 'after' ? { gt: anchor.sortKey } : { lt: anchor.sortKey },
            },
            orderBy: { sortKey: side === 'after' ? 'asc' : 'desc' },
            select: { id: true, sortKey: true },
        });
    }

    static async create(db: PrismaTx, ctx: Ctx, data: { projectId: string; name: string; dueDate: Date | null; sortKey: string }): Promise<MilestoneRow> {
        return db.milestone.create({ data: { tenantId: ctx.tenantId, ...data }, select: milestoneSelect });
    }

    static async update(db: PrismaTx, ctx: Ctx, id: string, data: Partial<{ name: string; dueDate: Date | null; sortKey: string }>): Promise<number> {
        const r = await db.milestone.updateMany({ where: { id, tenantId: ctx.tenantId }, data });
        return r.count;
    }

    static async delete(db: PrismaTx, ctx: Ctx, id: string): Promise<number> {
        const r = await db.milestone.deleteMany({ where: { id, tenantId: ctx.tenantId } });
        return r.count;
    }
}
