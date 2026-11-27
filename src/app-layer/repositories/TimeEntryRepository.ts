/**
 * Time entries (sub-phase 3.4b; docs/porting/maps/3.4.md, "Time entries and
 * timers (3.4b)"; ADR 0012 §2). Every query filters by `tenantId` (RLS also
 * scopes it). The only caller that writes is `usecases/time-entry.ts`
 * (`tests/guards/time-entry-write-seam.test.ts`).
 *
 *   - A person's week and a day's total read `TimeEntry_tenantId_userId_workDate_idx`.
 *   - An item's total and page read `TimeEntry_tenantId_workItemId_workDate_idx`.
 *   - The running timer is the person's one entry whose `minutes` is NULL
 *     (the partial unique `TimeEntry_one_timer_per_person`).
 *
 * Every read is plan-checked (`tests/perf/plan-checked-queries.ts`).
 *
 * Written fresh for Islestone.
 */
import { Prisma, type TimeEntrySource } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import { buildKeysetWhere, keysetOrderBy, type CursorPayload, type KeysetOrder } from '@/lib/pagination';
import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId'>;

/** The most entries a week read returns; it reads one past and the usecase refuses above (422). */
export const WEEK_ENTRIES_TAKE = 1_000;

/** An item's entries, newest first (`workDate`, then `id`). */
export const ITEM_TIME_ORDER: KeysetOrder<'workDate'> = { column: 'workDate', direction: 'desc', kind: 'date' };

export const timeEntrySelect = {
    id: true,
    userId: true,
    workItemId: true,
    projectId: true,
    workDate: true,
    minutes: true,
    timerStartedAt: true,
    source: true,
    billable: true,
    description: true,
    version: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.TimeEntrySelect;

export type TimeEntryRow = Prisma.TimeEntryGetPayload<{ select: typeof timeEntrySelect }>;

export interface TimeEntryInsert {
    userId: string;
    workItemId: string;
    projectId: string;
    workDate: Date;
    minutes: number | null;
    timerStartedAt: Date | null;
    source: TimeEntrySource;
    billable: boolean;
    description: string | null;
}

export type TimeEntryPatch = Partial<Pick<TimeEntryRow, 'workItemId' | 'projectId' | 'workDate' | 'minutes' | 'billable' | 'description'>>;

export class TimeEntryRepository {
    /** One entry of the workspace, or null. */
    static async get(db: PrismaTx, ctx: Ctx, id: string): Promise<TimeEntryRow | null> {
        return db.timeEntry.findFirst({ where: { id, tenantId: ctx.tenantId }, select: timeEntrySelect });
    }

    /** The person's running timer, if any (at most one, by the partial unique). */
    static async running(db: PrismaTx, ctx: Ctx, userId: string): Promise<TimeEntryRow | null> {
        return db.timeEntry.findFirst({ where: { tenantId: ctx.tenantId, userId, minutes: null }, select: timeEntrySelect });
    }

    /** The person's entries dated in `[from, to]`, running timers included, oldest first; at most `WEEK_ENTRIES_TAKE + 1`. */
    static async listForPerson(db: PrismaTx, ctx: Ctx, userId: string, from: Date, to: Date): Promise<TimeEntryRow[]> {
        return db.timeEntry.findMany({
            where: { tenantId: ctx.tenantId, userId, workDate: { gte: from, lte: to } },
            orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
            take: WEEK_ENTRIES_TAKE + 1,
            select: timeEntrySelect,
        });
    }

    /** The person's finished minutes on `day`, leaving out `exceptId` (the entry being changed). */
    static async dayTotal(db: PrismaTx, ctx: Ctx, userId: string, day: Date, exceptId?: string): Promise<number> {
        const agg = await db.timeEntry.aggregate({
            where: { tenantId: ctx.tenantId, userId, workDate: day, minutes: { not: null }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
            _sum: { minutes: true },
        });
        return agg._sum.minutes ?? 0;
    }

    /** The item's finished minutes, all people and `userId`'s own, in one statement. */
    static async itemTotals(db: PrismaTx, ctx: Ctx, workItemId: string, userId: string): Promise<{ total: number; own: number }> {
        const rows = await db.$queryRaw<Array<{ total: bigint | null; own: bigint | null }>>(Prisma.sql`
            SELECT SUM(t."minutes") AS total,
                   SUM(t."minutes") FILTER (WHERE t."userId" = ${userId}) AS own
              FROM "TimeEntry" t
             WHERE t."tenantId" = ${ctx.tenantId}
               AND t."workItemId" = ${workItemId}
               AND t."minutes" IS NOT NULL`);
        const row = rows[0];
        return { total: Number(row?.total ?? 0), own: Number(row?.own ?? 0) };
    }

    /**
     * One page of the item's finished entries, newest first: `limit + 1`
     * rows after the cursor, each with its person's name. `onlyUserId` narrows
     * to one person's own (a caller without `time.view`, decision 266).
     */
    static async itemPage(
        db: PrismaTx,
        ctx: Ctx,
        workItemId: string,
        page: { limit: number; cursor?: CursorPayload; onlyUserId?: string },
    ) {
        return db.timeEntry.findMany({
            where: {
                tenantId: ctx.tenantId,
                workItemId,
                minutes: { not: null },
                ...(page.onlyUserId ? { userId: page.onlyUserId } : {}),
                ...(page.cursor ? buildKeysetWhere(ITEM_TIME_ORDER, page.cursor) : {}),
            },
            orderBy: keysetOrderBy(ITEM_TIME_ORDER),
            take: page.limit + 1,
            select: { ...timeEntrySelect, user: { select: { name: true } } },
        });
    }

    /**
     * The person's week in one statement (3.4c): finished minutes, billable
     * minutes and entries dated in `[from, to]`, and whether a timer counts on
     * one of its days (decision 263: such a week is not submitted).
     */
    static async weekSums(db: PrismaTx, ctx: Ctx, userId: string, from: Date, to: Date): Promise<{ minutes: number; billableMinutes: number; entries: number; timerOn: boolean }> {
        const rows = await db.$queryRaw<Array<{ minutes: bigint | null; billable: bigint | null; entries: bigint; timer: boolean | null }>>(Prisma.sql`
            SELECT SUM(t."minutes") AS minutes,
                   SUM(t."minutes") FILTER (WHERE t."billable") AS billable,
                   COUNT(t."minutes") AS entries,
                   BOOL_OR(t."minutes" IS NULL) AS timer
              FROM "TimeEntry" t
             WHERE t."tenantId" = ${ctx.tenantId}
               AND t."userId" = ${userId}
               AND t."workDate" BETWEEN ${from}::date AND ${to}::date`);
        const row = rows[0];
        return { minutes: Number(row?.minutes ?? 0), billableMinutes: Number(row?.billable ?? 0), entries: Number(row?.entries ?? 0), timerOn: row?.timer === true };
    }

    /**
     * The sums of several people's weeks in one statement (the Timesheets
     * page, 3.4c): finished minutes, billable minutes and entries per
     * `(userId, weekStart)` pair, each week seven days from its Monday.
     */
    static async sumsForWeeks(db: PrismaTx, ctx: Ctx, weeks: ReadonlyArray<{ userId: string; weekStart: Date }>): Promise<Map<string, { minutes: number; billableMinutes: number; entries: number }>> {
        const out = new Map<string, { minutes: number; billableMinutes: number; entries: number }>();
        if (weeks.length === 0) return out;
        const rows = await db.$queryRaw<Array<{ userId: string; weekStart: Date; minutes: bigint | null; billable: bigint | null; entries: bigint }>>(Prisma.sql`
            SELECT w."userId", w."weekStart",
                   SUM(t."minutes") AS minutes,
                   SUM(t."minutes") FILTER (WHERE t."billable") AS billable,
                   COUNT(t."minutes") AS entries
              FROM unnest(${weeks.map((w) => w.userId)}::text[], ${weeks.map((w) => w.weekStart)}::date[]) AS w("userId", "weekStart")
              JOIN "TimeEntry" t
                ON t."tenantId" = ${ctx.tenantId}
               AND t."userId" = w."userId"
               AND t."workDate" BETWEEN w."weekStart" AND w."weekStart" + 6
               AND t."minutes" IS NOT NULL
             GROUP BY w."userId", w."weekStart"`);
        for (const r of rows) {
            out.set(`${r.userId}:${r.weekStart.toISOString().slice(0, 10)}`, { minutes: Number(r.minutes ?? 0), billableMinutes: Number(r.billable ?? 0), entries: Number(r.entries) });
        }
        return out;
    }

    /** The people who recorded finished time dated in `[from, to]`, at most `take` (the Monday reminder, 3.4c). */
    static async peopleWithTimeIn(db: PrismaTx, ctx: Ctx, from: Date, to: Date, take: number): Promise<string[]> {
        const rows = await db.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
            SELECT DISTINCT t."userId"
              FROM "TimeEntry" t
             WHERE t."tenantId" = ${ctx.tenantId}
               AND t."workDate" BETWEEN ${from}::date AND ${to}::date
               AND t."minutes" IS NOT NULL
             ORDER BY t."userId"
             LIMIT ${take}`);
        return rows.map((r) => r.userId);
    }

    /** Whether any entry names the project (the purge's choice between a tombstone and a delete, issue #117). */
    static async anyInProject(db: PrismaTx, ctx: Ctx, projectId: string): Promise<boolean> {
        const row = await db.timeEntry.findFirst({ where: { tenantId: ctx.tenantId, projectId }, select: { id: true } });
        return row !== null;
    }

    static async create(db: PrismaTx, ctx: Ctx, data: TimeEntryInsert): Promise<TimeEntryRow> {
        return db.timeEntry.create({
            data: { tenantId: ctx.tenantId, createdByUserId: data.userId, ...data },
            select: timeEntrySelect,
        });
    }

    /**
     * Change the person's own entry when it is still at `expectedVersion`
     * (when given); the version increases. Returns the rows changed (0 on a
     * missing entry, another person's, or a version that moved).
     */
    static async updateVersioned(db: PrismaTx, ctx: Ctx, id: string, userId: string, expectedVersion: number | undefined, patch: TimeEntryPatch): Promise<number> {
        const result = await db.timeEntry.updateMany({
            where: { id, tenantId: ctx.tenantId, userId, ...(expectedVersion !== undefined ? { version: expectedVersion } : {}) },
            data: { ...patch, version: { increment: 1 } },
        });
        return result.count;
    }

    /** Finish the person's running timer with `minutes`; 0 when it is no longer running. */
    static async finishTimer(db: PrismaTx, ctx: Ctx, id: string, userId: string, minutes: number): Promise<number> {
        const result = await db.timeEntry.updateMany({
            where: { id, tenantId: ctx.tenantId, userId, minutes: null },
            data: { minutes, version: { increment: 1 } },
        });
        return result.count;
    }

    /** Remove the person's own entry for good (decision 277). */
    static async delete(db: PrismaTx, ctx: Ctx, id: string, userId: string): Promise<number> {
        const result = await db.timeEntry.deleteMany({ where: { id, tenantId: ctx.tenantId, userId } });
        return result.count;
    }
}
