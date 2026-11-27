/**
 * Initiatives (sub-phase 3.2a; docs/porting/maps/3.2.md; ADR 0002 §2 and
 * §17). Every query filters by `tenantId` (RLS also scopes it). A project's
 * link to its initiative is `Project.initiativeId`, written by
 * `ProjectRepository.setInitiative`.
 *
 * Written fresh for Islestone.
 */
import type { Health, InitiativeStatus, Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId'>;

/** The initiatives a list or picker reads at once. */
export const INITIATIVES_LIST_TAKE = 2_000;

export const initiativeSelect = {
    id: true,
    goalId: true,
    name: true,
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
} satisfies Prisma.InitiativeSelect;

export type InitiativeRow = Prisma.InitiativeGetPayload<{ select: typeof initiativeSelect }>;

export const initiativeLiteSelect = {
    id: true,
    goalId: true,
    name: true,
    status: true,
    archivedAt: true,
    deletedAt: true,
    deletionId: true,
} satisfies Prisma.InitiativeSelect;

export type InitiativeLiteRow = Prisma.InitiativeGetPayload<{ select: typeof initiativeLiteSelect }>;

export interface InitiativeListOptions {
    deleted?: boolean;
    includeArchived?: boolean;
    statuses?: readonly InitiativeStatus[];
    leadUserId?: string;
    health?: ReadonlyArray<Health | null>;
    goalId?: string;
}

export type InitiativePatch = Partial<{
    goalId: string | null;
    name: string;
    description: string | null;
    status: InitiativeStatus;
    dueDate: Date | null;
    leadUserId: string | null;
    archivedAt: Date | null;
    archivedByUserId: string | null;
    health: Health | null;
    healthSetAt: Date | null;
    healthSetByUserId: string | null;
}>;

export class InitiativeRepository {
    static async list(db: PrismaTx, ctx: Ctx, opts: InitiativeListOptions = {}): Promise<InitiativeRow[]> {
        const and: Prisma.InitiativeWhereInput[] = [];
        if (opts.health && opts.health.length > 0) {
            const values = opts.health.filter((h): h is Health => h !== null);
            const or: Prisma.InitiativeWhereInput[] = [];
            if (values.length) or.push({ health: { in: values } });
            if (values.length !== opts.health.length) or.push({ health: null });
            and.push({ OR: or });
        }
        return db.initiative.findMany({
            where: {
                tenantId: ctx.tenantId,
                deletedAt: opts.deleted ? { not: null } : null,
                ...(opts.deleted || opts.includeArchived ? {} : { archivedAt: null }),
                ...(opts.statuses && opts.statuses.length ? { status: { in: [...opts.statuses] } } : {}),
                ...(opts.leadUserId ? { leadUserId: opts.leadUserId } : {}),
                ...(opts.goalId ? { goalId: opts.goalId } : {}),
                ...(and.length ? { AND: and } : {}),
            },
            orderBy: [{ id: 'asc' }],
            take: INITIATIVES_LIST_TAKE,
            select: initiativeSelect,
        });
    }

    /** Live, unarchived initiatives (pickers, filters): never a description. */
    static async listLinkable(db: PrismaTx, ctx: Ctx): Promise<InitiativeLiteRow[]> {
        return db.initiative.findMany({
            where: { tenantId: ctx.tenantId, deletedAt: null, archivedAt: null },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            take: INITIATIVES_LIST_TAKE,
            select: initiativeLiteSelect,
        });
    }

    static async getAny(db: PrismaTx, ctx: Ctx, id: string): Promise<InitiativeRow | null> {
        return db.initiative.findFirst({ where: { id, tenantId: ctx.tenantId }, select: initiativeSelect });
    }

    /**
     * A live initiative's due date, and nothing else (3.6c: a forecast's due
     * date; never the description). Null when it is missing or deleted.
     */
    static async liveDueDate(db: PrismaTx, ctx: Ctx, id: string): Promise<{ dueDate: Date | null } | null> {
        return db.initiative.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null }, select: { dueDate: true } });
    }

    static async getManyLite(db: PrismaTx, ctx: Ctx, ids: readonly string[]): Promise<InitiativeLiteRow[]> {
        if (ids.length === 0) return [];
        return db.initiative.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...ids] } }, take: INITIATIVES_LIST_TAKE, select: initiativeLiteSelect });
    }

    /** Lock one initiative's row for a versioned write. */
    static async lock(db: PrismaTx, ctx: Ctx, id: string): Promise<boolean> {
        const rows = await db.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "Initiative" WHERE "id" = ${id} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
        return rows.length === 1;
    }

    /** Read an initiative `FOR KEY SHARE`: a concurrent purge cannot delete it before the caller's link commits. */
    static async lockForKeyShare(db: PrismaTx, ctx: Ctx, id: string): Promise<{ id: string; name: string; archivedAt: Date | null; deletedAt: Date | null } | null> {
        const rows = await db.$queryRaw<Array<{ id: string; name: string; archivedAt: Date | null; deletedAt: Date | null }>>`
            SELECT "id", "name", "archivedAt", "deletedAt" FROM "Initiative"
             WHERE "id" = ${id} AND "tenantId" = ${ctx.tenantId}
             FOR KEY SHARE`;
        return rows[0] ?? null;
    }

    /** The live initiatives of the given goals (the `goalId` filter's project path; a goal delete's group). */
    static async liveIdsOfGoals(db: PrismaTx, ctx: Ctx, goalIds: readonly string[]): Promise<string[]> {
        if (goalIds.length === 0) return [];
        const rows = await db.initiative.findMany({
            where: { tenantId: ctx.tenantId, goalId: { in: [...goalIds] }, deletedAt: null },
            orderBy: { id: 'asc' },
            take: INITIATIVES_LIST_TAKE,
            select: { id: true },
        });
        return rows.map((r) => r.id);
    }

    /** The live initiatives (archived ones included) of the given goals, each with its goal (3.2b progress). */
    static async liveOfGoals(db: PrismaTx, ctx: Ctx, goalIds: readonly string[]): Promise<Array<{ id: string; goalId: string }>> {
        if (goalIds.length === 0) return [];
        const rows = await db.initiative.findMany({
            where: { tenantId: ctx.tenantId, goalId: { in: [...goalIds] }, deletedAt: null },
            orderBy: { id: 'asc' },
            take: INITIATIVES_LIST_TAKE,
            select: { id: true, goalId: true },
        });
        return rows.flatMap((r) => (r.goalId ? [{ id: r.id, goalId: r.goalId }] : []));
    }

    static async create(
        db: PrismaTx,
        ctx: Pick<RequestContext, 'tenantId' | 'userId'>,
        data: { goalId: string | null; name: string; description: string | null; status: InitiativeStatus; dueDate: Date | null; leadUserId: string | null },
    ): Promise<InitiativeRow> {
        return db.initiative.create({ data: { tenantId: ctx.tenantId, createdByUserId: ctx.userId, ...data }, select: initiativeSelect });
    }

    static async updateVersioned(db: PrismaTx, ctx: Ctx, id: string, expectedVersion: number | undefined, data: InitiativePatch): Promise<number> {
        const r = await db.initiative.updateMany({
            where: { id, tenantId: ctx.tenantId, deletedAt: null, ...(expectedVersion !== undefined ? { version: expectedVersion } : {}) },
            data: { ...data, version: { increment: 1 } },
        });
        return r.count;
    }

    static async softDeleteMany(db: PrismaTx, ctx: Pick<RequestContext, 'tenantId' | 'userId'>, ids: readonly string[], deletionId: string, at: Date): Promise<number> {
        if (ids.length === 0) return 0;
        const r = await db.initiative.updateMany({
            where: { tenantId: ctx.tenantId, id: { in: [...ids] }, deletedAt: null },
            data: { deletedAt: at, deletedByUserId: ctx.userId, deletionId, version: { increment: 1 } },
        });
        return r.count;
    }

    static async idsOfDeletion(db: PrismaTx, ctx: Ctx, deletionId: string): Promise<string[]> {
        const rows = await db.initiative.findMany({
            where: { tenantId: ctx.tenantId, deletionId },
            orderBy: { id: 'asc' },
            take: INITIATIVES_LIST_TAKE,
            select: { id: true },
        });
        return rows.map((r) => r.id);
    }

    static async restoreGroup(db: PrismaTx, ctx: Ctx, deletionId: string): Promise<number> {
        const r = await db.initiative.updateMany({
            where: { tenantId: ctx.tenantId, deletionId, deletedAt: { not: null } },
            data: { deletedAt: null, deletedByUserId: null, deletionId: null, version: { increment: 1 } },
        });
        return r.count;
    }

    static async clearLead(db: PrismaTx, ctx: Ctx, userId: string): Promise<Array<{ id: string; name: string }>> {
        const rows = await db.initiative.findMany({
            where: { tenantId: ctx.tenantId, leadUserId: userId },
            orderBy: { id: 'asc' },
            take: INITIATIVES_LIST_TAKE,
            select: { id: true, name: true },
        });
        if (rows.length === 0) return [];
        await db.initiative.updateMany({
            where: { tenantId: ctx.tenantId, id: { in: rows.map((r) => r.id) }, leadUserId: userId },
            data: { leadUserId: null, version: { increment: 1 } },
        });
        return rows;
    }

    // ── Purge (decision 219) ─────────────────────────────────────────

    static async purgeableIds(db: PrismaTx, ctx: Ctx, before: Date, take: number): Promise<string[]> {
        const rows = await db.initiative.findMany({
            where: { tenantId: ctx.tenantId, deletedAt: { lt: before } },
            orderBy: { id: 'asc' },
            take,
            select: { id: true },
        });
        return rows.map((r) => r.id);
    }

    /** Hard-delete a page: the only DELETE on `Initiative`; the `SET NULL` key clears projects' links. */
    static async purgeBatch(db: PrismaTx, ctx: Ctx, ids: readonly string[], before: Date): Promise<number> {
        if (ids.length === 0) return 0;
        const r = await db.initiative.deleteMany({ where: { tenantId: ctx.tenantId, id: { in: [...ids] }, deletedAt: { lt: before } } });
        return r.count;
    }
}
