/**
 * Billable rates (sub-phase 3.4d; docs/porting/maps/3.4.md, "Rates, totals
 * and export (3.4d)"; ADR 0012 §6). Every query filters by `tenantId` (RLS
 * also scopes it). The only caller that writes is `usecases/billable-rate.ts`
 * (and the purge's tombstone, which writes a purged project's rows back under
 * their own ids, `WorkItemRepository.tombstoneProject`).
 *
 *   - One row per level, scope and date (the unique index, NULLS NOT
 *     DISTINCT): setting a rate for a date replaces that date's row.
 *   - The cascade's reads take every row dated on or before a day, at most
 *     `TIME_TOTALS_LIMITS.rateRowsMax + 1`; the usecase refuses above.
 *
 * Written fresh for Islestone.
 */
import type { BillableRateLevel, Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import { TIME_TOTALS_LIMITS } from '@/lib/time/totals';
import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId'>;

export const billableRateSelect = {
    id: true,
    level: true,
    projectId: true,
    userId: true,
    hourlyRateMinor: true,
    effectiveFrom: true,
    createdAt: true,
} satisfies Prisma.BillableRateSelect;

export type BillableRateRow = Prisma.BillableRateGetPayload<{ select: typeof billableRateSelect }>;

export interface RateScope {
    level: BillableRateLevel;
    projectId: string | null;
    userId: string | null;
}

export class BillableRateRepository {
    /** Every rate of the workspace dated on or before `until` (all when omitted), by level, scope and date; one past the cap. */
    static async listUntil(db: PrismaTx, ctx: Ctx, until?: Date): Promise<BillableRateRow[]> {
        return db.billableRate.findMany({
            where: { tenantId: ctx.tenantId, ...(until ? { effectiveFrom: { lte: until } } : {}) },
            orderBy: [{ level: 'asc' }, { projectId: 'asc' }, { userId: 'asc' }, { effectiveFrom: 'asc' }],
            take: TIME_TOTALS_LIMITS.rateRowsMax + 1,
            select: billableRateSelect,
        });
    }

    /**
     * The rates a person's week needs (the approval's stamp): the workspace's,
     * the person's and the given projects', dated on or before `until`.
     */
    static async forPersonAndProjects(db: PrismaTx, ctx: Ctx, userId: string, projectIds: readonly string[], until: Date): Promise<BillableRateRow[]> {
        return db.billableRate.findMany({
            where: {
                tenantId: ctx.tenantId,
                effectiveFrom: { lte: until },
                OR: [
                    { level: 'WORKSPACE' },
                    { level: 'MEMBER', userId },
                    ...(projectIds.length > 0 ? [{ level: 'PROJECT' as const, projectId: { in: [...projectIds] } }] : []),
                ],
            },
            orderBy: { effectiveFrom: 'asc' },
            take: TIME_TOTALS_LIMITS.rateRowsMax + 1,
            select: billableRateSelect,
        });
    }

    static async get(db: PrismaTx, ctx: Ctx, id: string): Promise<BillableRateRow | null> {
        return db.billableRate.findFirst({ where: { id, tenantId: ctx.tenantId }, select: billableRateSelect });
    }

    /** Whether the workspace holds any rate (the currency is not changed while one exists). */
    static async any(db: PrismaTx, ctx: Ctx): Promise<boolean> {
        const row = await db.billableRate.findFirst({ where: { tenantId: ctx.tenantId }, select: { id: true } });
        return row !== null;
    }

    /** The row of a scope for a date, or null. */
    static async forDate(db: PrismaTx, ctx: Ctx, scope: RateScope, effectiveFrom: Date): Promise<BillableRateRow | null> {
        return db.billableRate.findFirst({
            where: { tenantId: ctx.tenantId, level: scope.level, projectId: scope.projectId, userId: scope.userId, effectiveFrom },
            select: billableRateSelect,
        });
    }

    static async create(db: PrismaTx, ctx: Ctx, scope: RateScope, data: { hourlyRateMinor: number | null; effectiveFrom: Date; createdByUserId: string }): Promise<BillableRateRow> {
        return db.billableRate.create({ data: { tenantId: ctx.tenantId, ...scope, ...data }, select: billableRateSelect });
    }

    /** Replace a date's rate. */
    static async setRate(db: PrismaTx, ctx: Ctx, id: string, hourlyRateMinor: number | null, createdByUserId: string): Promise<number> {
        const result = await db.billableRate.updateMany({ where: { id, tenantId: ctx.tenantId }, data: { hourlyRateMinor, createdByUserId } });
        return result.count;
    }

    static async delete(db: PrismaTx, ctx: Ctx, id: string): Promise<number> {
        const result = await db.billableRate.deleteMany({ where: { id, tenantId: ctx.tenantId } });
        return result.count;
    }
}
