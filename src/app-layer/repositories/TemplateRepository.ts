/**
 * Item and project templates (sub-phase 2.5c). Every query filters by
 * `tenantId` (RLS also scopes it). `WorkItemTemplate.description` and
 * `ProjectTemplate.contentJson` are encrypted and decrypted by the
 * encryption extension (manifest); this layer sees plaintext.
 *
 * Written fresh for Islestone.
 */
import type { Prisma, WorkItemPriority } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId'>;

/** A project's item templates on one read: far beyond a real project's. */
export const ITEM_TEMPLATES_PER_PROJECT_TAKE = 200;
/** The workspace's project templates on one read. */
export const PROJECT_TEMPLATES_TAKE = 200;

export const workItemTemplateSelect = {
    id: true,
    projectId: true,
    name: true,
    title: true,
    description: true,
    typeId: true,
    priority: true,
    assigneeId: true,
    dueInDays: true,
    estimatePoints: true,
    estimateMinutes: true,
    customFieldValuesJson: true,
    subItemsJson: true,
    sortKey: true,
    archivedAt: true,
    labels: { select: { labelId: true }, orderBy: { labelId: 'asc' } },
} satisfies Prisma.WorkItemTemplateSelect;

export type WorkItemTemplateRow = Prisma.WorkItemTemplateGetPayload<{ select: typeof workItemTemplateSelect }>;

export interface WorkItemTemplateData {
    name: string;
    title: string;
    description: string | null;
    typeId: string | null;
    priority: WorkItemPriority;
    assigneeId: string | null;
    dueInDays: number | null;
    /** The new item's estimate (3.4a): at most one set, the column of the project's team's unit at save. */
    estimatePoints?: number | null;
    estimateMinutes?: number | null;
    customFieldValuesJson: Prisma.InputJsonValue | typeof Prisma.DbNull;
    subItemsJson: Prisma.InputJsonValue | typeof Prisma.DbNull;
}

export const projectTemplateListSelect = {
    id: true,
    name: true,
    contentVersion: true,
    sortKey: true,
    archivedAt: true,
    createdAt: true,
} satisfies Prisma.ProjectTemplateSelect;

export type ProjectTemplateListRow = Prisma.ProjectTemplateGetPayload<{ select: typeof projectTemplateListSelect }>;

export class WorkItemTemplateRepository {
    static async list(db: PrismaTx, ctx: Ctx, projectId: string, opts: { includeArchived?: boolean } = {}): Promise<WorkItemTemplateRow[]> {
        return db.workItemTemplate.findMany({
            where: { tenantId: ctx.tenantId, projectId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
            orderBy: [{ sortKey: 'asc' }, { id: 'asc' }],
            take: ITEM_TEMPLATES_PER_PROJECT_TAKE,
            select: workItemTemplateSelect,
        });
    }

    /** Lock one item template's row for a write that may name a person (issue #113: the row, then the membership). */
    static async lock(db: PrismaTx, ctx: Ctx, id: string): Promise<boolean> {
        const rows = await db.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "WorkItemTemplate" WHERE "id" = ${id} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
        return rows.length === 1;
    }

    static async getById(db: PrismaTx, ctx: Ctx, id: string): Promise<WorkItemTemplateRow | null> {
        return db.workItemTemplate.findFirst({ where: { id, tenantId: ctx.tenantId }, select: workItemTemplateSelect });
    }

    static async nameTaken(db: PrismaTx, ctx: Ctx, projectId: string, name: string, exceptId?: string): Promise<boolean> {
        const hit = await db.workItemTemplate.findFirst({
            where: { tenantId: ctx.tenantId, projectId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
            select: { id: true },
        });
        return hit !== null;
    }

    static async lastSortKey(db: PrismaTx, ctx: Ctx, projectId: string): Promise<string | null> {
        const last = await db.workItemTemplate.findFirst({ where: { tenantId: ctx.tenantId, projectId }, orderBy: { sortKey: 'desc' }, select: { sortKey: true } });
        return last?.sortKey ?? null;
    }

    static async neighbour(db: PrismaTx, ctx: Ctx, projectId: string, anchor: { sortKey: string }, side: 'after' | 'before', exceptId: string) {
        return db.workItemTemplate.findFirst({
            where: { tenantId: ctx.tenantId, projectId, id: { not: exceptId }, sortKey: side === 'after' ? { gt: anchor.sortKey } : { lt: anchor.sortKey } },
            orderBy: { sortKey: side === 'after' ? 'asc' : 'desc' },
            select: { id: true, sortKey: true },
        });
    }

    static async create(
        db: PrismaTx,
        ctx: Pick<RequestContext, 'tenantId' | 'userId'>,
        data: WorkItemTemplateData & { projectId: string; sortKey: string; labelIds: readonly string[] },
    ): Promise<WorkItemTemplateRow> {
        const { labelIds, ...rest } = data;
        const row = await db.workItemTemplate.create({ data: { tenantId: ctx.tenantId, createdByUserId: ctx.userId, ...rest }, select: { id: true } });
        if (labelIds.length > 0) {
            await db.workItemTemplateLabel.createMany({ data: labelIds.map((labelId) => ({ tenantId: ctx.tenantId, templateId: row.id, labelId })) });
        }
        return (await WorkItemTemplateRepository.getById(db, ctx, row.id))!;
    }

    static async update(
        db: PrismaTx,
        ctx: Ctx,
        id: string,
        data: Partial<WorkItemTemplateData> & { sortKey?: string; archivedAt?: Date | null },
        labelIds?: readonly string[],
    ): Promise<number> {
        const r = await db.workItemTemplate.updateMany({ where: { id, tenantId: ctx.tenantId }, data });
        if (labelIds !== undefined) {
            await db.workItemTemplateLabel.deleteMany({ where: { tenantId: ctx.tenantId, templateId: id } });
            if (labelIds.length > 0) {
                await db.workItemTemplateLabel.createMany({ data: labelIds.map((labelId) => ({ tenantId: ctx.tenantId, templateId: id, labelId })) });
            }
        }
        return r.count;
    }

    static async delete(db: PrismaTx, ctx: Ctx, id: string): Promise<number> {
        return (await db.workItemTemplate.deleteMany({ where: { id, tenantId: ctx.tenantId } })).count;
    }

    /** Clear a removed member from every template that names them (member removal). */
    static async clearAssignee(db: PrismaTx, ctx: Ctx, userId: string): Promise<number> {
        return (await db.workItemTemplate.updateMany({ where: { tenantId: ctx.tenantId, assigneeId: userId }, data: { assigneeId: null } })).count;
    }
}

export class ProjectTemplateRepository {
    static async list(db: PrismaTx, ctx: Ctx, opts: { includeArchived?: boolean } = {}): Promise<ProjectTemplateListRow[]> {
        return db.projectTemplate.findMany({
            where: { tenantId: ctx.tenantId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
            orderBy: [{ sortKey: 'asc' }, { id: 'asc' }],
            take: PROJECT_TEMPLATES_TAKE,
            select: projectTemplateListSelect,
        });
    }

    /** The same list with each template's content (an admin's list counts what each holds). */
    static async listWithContent(db: PrismaTx, ctx: Ctx, opts: { includeArchived?: boolean } = {}) {
        return db.projectTemplate.findMany({
            where: { tenantId: ctx.tenantId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
            orderBy: [{ sortKey: 'asc' }, { id: 'asc' }],
            take: PROJECT_TEMPLATES_TAKE,
            select: { ...projectTemplateListSelect, contentJson: true },
        });
    }

    static async getById(db: PrismaTx, ctx: Ctx, id: string) {
        return db.projectTemplate.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { ...projectTemplateListSelect, contentJson: true } });
    }

    static async nameTaken(db: PrismaTx, ctx: Ctx, name: string, exceptId?: string): Promise<boolean> {
        const hit = await db.projectTemplate.findFirst({ where: { tenantId: ctx.tenantId, name, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
        return hit !== null;
    }

    static async lastSortKey(db: PrismaTx, ctx: Ctx): Promise<string | null> {
        const last = await db.projectTemplate.findFirst({ where: { tenantId: ctx.tenantId }, orderBy: { sortKey: 'desc' }, select: { sortKey: true } });
        return last?.sortKey ?? null;
    }

    static async create(db: PrismaTx, ctx: Pick<RequestContext, 'tenantId' | 'userId'>, data: { name: string; contentJson: string; sortKey: string }) {
        return db.projectTemplate.create({ data: { tenantId: ctx.tenantId, createdByUserId: ctx.userId, contentVersion: 1, ...data }, select: projectTemplateListSelect });
    }

    static async update(db: PrismaTx, ctx: Ctx, id: string, data: { name?: string; archivedAt?: Date | null }): Promise<number> {
        return (await db.projectTemplate.updateMany({ where: { id, tenantId: ctx.tenantId }, data })).count;
    }

    static async delete(db: PrismaTx, ctx: Ctx, id: string): Promise<number> {
        return (await db.projectTemplate.deleteMany({ where: { id, tenantId: ctx.tenantId } })).count;
    }
}
