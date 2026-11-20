/**
 * Repeats (sub-phase 2.5d). Every query filters by `tenantId` (RLS also
 * scopes it). The job's claim is a conditional `updateMany` on the stamped
 * `nextOccurrenceOn`, so a second or concurrent run changes nothing.
 *
 * Written fresh for Islestone.
 */
import type { Prisma, RecurrenceFrequency, RecurrenceHold } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId'>;

/** The rules one run visits in a workspace; the rest wait for the next night. */
export const RECURRENCE_DUE_TAKE = 1_000;

export const recurrenceSelect = {
    id: true,
    sourceWorkItemId: true,
    frequency: true,
    interval: true,
    weekdays: true,
    firstOn: true,
    endsOn: true,
    maxOccurrences: true,
    leadDays: true,
    nextOccurrenceOn: true,
    occurrenceCount: true,
    ownerUserId: true,
    heldAt: true,
    heldReason: true,
} satisfies Prisma.WorkItemRecurrenceSelect;

export type RecurrenceRow = Prisma.WorkItemRecurrenceGetPayload<{ select: typeof recurrenceSelect }>;

export interface RecurrenceRuleData {
    frequency: RecurrenceFrequency;
    interval: number;
    weekdays: number[];
    firstOn: Date;
    endsOn: Date | null;
    maxOccurrences: number | null;
    leadDays: number;
    nextOccurrenceOn: Date | null;
    ownerUserId: string;
    heldAt: Date | null;
    heldReason: RecurrenceHold | null;
}

export class RecurrenceRepository {
    static async getBySource(db: PrismaTx, ctx: Ctx, sourceWorkItemId: string): Promise<RecurrenceRow | null> {
        return db.workItemRecurrence.findFirst({ where: { tenantId: ctx.tenantId, sourceWorkItemId }, select: recurrenceSelect });
    }

    static async getById(db: PrismaTx, ctx: Ctx, id: string): Promise<RecurrenceRow | null> {
        return db.workItemRecurrence.findFirst({ where: { id, tenantId: ctx.tenantId }, select: recurrenceSelect });
    }

    static async create(db: PrismaTx, ctx: Ctx, sourceWorkItemId: string, data: RecurrenceRuleData): Promise<RecurrenceRow> {
        return db.workItemRecurrence.create({ data: { tenantId: ctx.tenantId, sourceWorkItemId, ...data }, select: recurrenceSelect });
    }

    static async update(db: PrismaTx, ctx: Ctx, id: string, data: Partial<RecurrenceRuleData>): Promise<number> {
        return (await db.workItemRecurrence.updateMany({ where: { id, tenantId: ctx.tenantId }, data })).count;
    }

    static async delete(db: PrismaTx, ctx: Ctx, id: string): Promise<number> {
        return (await db.workItemRecurrence.deleteMany({ where: { id, tenantId: ctx.tenantId } })).count;
    }

    /** Live rules whose next occurrence is on or before `horizon` (the job narrows by each rule's lead days). */
    static async due(db: PrismaTx, ctx: Ctx, horizon: Date): Promise<RecurrenceRow[]> {
        return db.workItemRecurrence.findMany({
            where: { tenantId: ctx.tenantId, heldAt: null, nextOccurrenceOn: { not: null, lte: horizon } },
            orderBy: [{ nextOccurrenceOn: 'asc' }, { id: 'asc' }],
            take: RECURRENCE_DUE_TAKE,
            select: recurrenceSelect,
        });
    }

    /**
     * Claim the occurrence a run makes: only while the rule still waits for
     * the date the run read and is not on hold. `0` means another run (or a
     * person's change) got there first.
     */
    static async claim(
        db: PrismaTx,
        ctx: Ctx,
        id: string,
        stamped: Date,
        next: { nextOccurrenceOn: Date | null; ended: boolean; at: Date },
    ): Promise<number> {
        const r = await db.workItemRecurrence.updateMany({
            where: { id, tenantId: ctx.tenantId, nextOccurrenceOn: stamped, heldAt: null },
            data: {
                nextOccurrenceOn: next.nextOccurrenceOn,
                occurrenceCount: { increment: 1 },
                ...(next.ended ? { heldAt: next.at, heldReason: 'ENDED' as const } : {}),
            },
        });
        return r.count;
    }

    /** Put a rule on hold, unless something already did or its stamped date moved. */
    static async hold(db: PrismaTx, ctx: Ctx, id: string, stamped: Date | null, reason: RecurrenceHold, at: Date): Promise<number> {
        const r = await db.workItemRecurrence.updateMany({
            where: { id, tenantId: ctx.tenantId, heldAt: null, nextOccurrenceOn: stamped },
            data: { heldAt: at, heldReason: reason },
        });
        return r.count;
    }

    /** The workspace's occurrences of a rule, for the series mark (bounded). */
    static async sourceOf(db: PrismaTx, ctx: Ctx, recurrenceId: string) {
        return db.workItemRecurrence.findFirst({
            where: { id: recurrenceId, tenantId: ctx.tenantId },
            select: { id: true, source: { select: { id: true, number: true, deletedAt: true, project: { select: { keyPrefix: true } } } } },
        });
    }
}
