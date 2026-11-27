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
import { Prisma, type BillableRateLevel, type TimeEntrySource } from '@prisma/client';

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
    frozenRateMinor: true,
    frozenRateLevel: true,
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

/** Time totals' and the export's filter (3.4d): a window of dates, both ends included. */
export interface TotalsFilter {
    from: Date;
    to: Date;
    projectId?: string;
    userId?: string;
    billable?: boolean;
    /**
     * The caller's granted projects, when they do not see the whole workspace
     * (a guest after 8.4); the usecase passes it only with no `projectId`.
     */
    projectIds?: readonly string[];
}

export type TotalsGroupBy = 'project' | 'person' | 'item' | 'week';

/** The group's expression; a week is its Monday (date-only arithmetic, as the freeze trigger's). */
function groupExpr(groupBy: TotalsGroupBy): Prisma.Sql {
    switch (groupBy) {
        case 'project':
            return Prisma.sql`t."projectId"`;
        case 'person':
            return Prisma.sql`t."userId"`;
        case 'item':
            return Prisma.sql`t."workItemId"`;
        case 'week':
            return Prisma.sql`(t."workDate" - (extract(isodow FROM t."workDate")::integer - 1))`;
    }
}

function totalsWhere(ctx: Ctx, f: TotalsFilter): Prisma.Sql {
    return Prisma.sql`t."tenantId" = ${ctx.tenantId}
               AND t."workDate" BETWEEN ${f.from}::date AND ${f.to}::date
               AND t."minutes" IS NOT NULL
               ${f.projectId ? Prisma.sql`AND t."projectId" = ${f.projectId}` : Prisma.empty}
               ${f.userId ? Prisma.sql`AND t."userId" = ${f.userId}` : Prisma.empty}
               ${f.billable !== undefined ? Prisma.sql`AND t."billable" = ${f.billable}` : Prisma.empty}
               ${f.projectIds ? Prisma.sql`AND t."projectId" = ANY(${[...f.projectIds]}::text[])` : Prisma.empty}`;
}

/** A group key as text: a date key for a week. */
function keyText(key: string | Date | null): string | null {
    if (key === null) return null;
    return key instanceof Date ? key.toISOString().slice(0, 10) : key;
}

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
        // One lateral read per week, each on the person's index (a join over every week at once let the planner
        // walk the workspace's dates instead). The week's last day is passed, not computed: under row-level
        // security `"weekStart" + 6` (a function that is not LEAKPROOF) stays a filter, and the scan would walk
        // every later entry of the person.
        const rows = await db.$queryRaw<Array<{ userId: string; weekStart: Date; minutes: bigint | null; billable: bigint | null; entries: bigint }>>(Prisma.sql`
            SELECT w."userId", w."weekStart", s.minutes, s.billable, s.entries
              FROM unnest(${weeks.map((w) => w.userId)}::text[], ${weeks.map((w) => w.weekStart)}::date[], ${weeks.map((w) => new Date(w.weekStart.getTime() + 6 * 86_400_000))}::date[]) AS w("userId", "weekStart", "weekEnd")
             CROSS JOIN LATERAL (
                   SELECT SUM(t."minutes") AS minutes,
                          SUM(t."minutes") FILTER (WHERE t."billable") AS billable,
                          COUNT(t."minutes") AS entries
                     FROM "TimeEntry" t
                    WHERE t."tenantId" = ${ctx.tenantId}
                      AND t."userId" = w."userId"
                      AND t."workDate" BETWEEN w."weekStart" AND w."weekEnd"
                      AND t."minutes" IS NOT NULL
                   ) s`);
        for (const r of rows) {
            out.set(`${r.userId}:${r.weekStart.toISOString().slice(0, 10)}`, { minutes: Number(r.minutes ?? 0), billableMinutes: Number(r.billable ?? 0), entries: Number(r.entries) });
        }
        return out;
    }

    /**
     * The workspace's ACTIVE members who recorded finished time dated in
     * `[from, to]`, at most `take` (the Monday reminder, 3.4c): per member one
     * probe on the person's index, so the read grows with the members, not the
     * entries.
     */
    static async activeMembersWithTimeIn(db: PrismaTx, ctx: Ctx, from: Date, to: Date, take: number): Promise<string[]> {
        const rows = await db.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
            SELECT m."userId"
              FROM "TenantMembership" m
             WHERE m."tenantId" = ${ctx.tenantId}
               AND m."status" = 'ACTIVE'
               AND EXISTS (
                   SELECT 1 FROM "TimeEntry" t
                    WHERE t."tenantId" = ${ctx.tenantId}
                      AND t."userId" = m."userId"
                      AND t."workDate" BETWEEN ${from}::date AND ${to}::date
                      AND t."minutes" IS NOT NULL)
             ORDER BY m."userId"
             LIMIT ${take}`);
        return rows.map((r) => r.userId);
    }

    // ── Time totals and the export (3.4d) ──────────────────────────────

    /**
     * Time totals' one aggregate (3.4d): finished entries dated in the
     * filter's window, grouped by project, person, item (NULL: a deleted
     * item) or week (its Monday), with minutes, billable minutes and entries
     * per group; at most `take` groups, by key. `projectIds` (the caller's
     * granted projects when visibility is not the whole workspace) narrows it.
     */
    static async totals(db: PrismaTx, ctx: Ctx, filter: TotalsFilter, groupBy: TotalsGroupBy, take: number): Promise<Array<{ key: string | null; minutes: number; billable: number; entries: number }>> {
        const g = groupExpr(groupBy);
        const rows = await db.$queryRaw<Array<{ key: string | Date | null; minutes: bigint; billable: bigint | null; entries: bigint }>>(Prisma.sql`
            SELECT ${g} AS key,
                   SUM(t."minutes") AS minutes,
                   SUM(t."minutes") FILTER (WHERE t."billable") AS billable,
                   COUNT(*) AS entries
              FROM "TimeEntry" t
             WHERE ${totalsWhere(ctx, filter)}
             GROUP BY 1
             ORDER BY 1 NULLS LAST
             LIMIT ${take}`);
        return rows.map((r) => ({ key: keyText(r.key), minutes: Number(r.minutes), billable: Number(r.billable ?? 0), entries: Number(r.entries) }));
    }

    /** How many groups `totals` would answer with no limit: the count a refusal names. */
    static async countTotalsGroups(db: PrismaTx, ctx: Ctx, filter: TotalsFilter, groupBy: TotalsGroupBy): Promise<number> {
        const rows = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
            SELECT COUNT(DISTINCT ${groupExpr(groupBy)}) + MAX(CASE WHEN ${groupExpr(groupBy)} IS NULL THEN 1 ELSE 0 END) AS n
              FROM "TimeEntry" t
             WHERE ${totalsWhere(ctx, filter)}`);
        return Number(rows[0]?.n ?? 0);
    }

    /**
     * The billable lines amounts are priced from (3.4d, a rates holder only):
     * the filter's billable finished entries, alike ones counted together per
     * group, person, project, date, minutes and frozen rate, so each entry is
     * read once and rounded once (decision 273) by `timeAmounts`.
     */
    static async amountLines(db: PrismaTx, ctx: Ctx, filter: TotalsFilter, groupBy: TotalsGroupBy) {
        const rows = await db.$queryRaw<
            Array<{ key: string | Date | null; projectId: string; userId: string; workDate: Date; minutes: number; frozenRateMinor: number | null; frozenRateLevel: BillableRateLevel | null; count: bigint }>
        >(Prisma.sql`
            SELECT ${groupExpr(groupBy)} AS key, t."projectId", t."userId", t."workDate", t."minutes", t."frozenRateMinor", t."frozenRateLevel", COUNT(*) AS count
              FROM "TimeEntry" t
             WHERE ${totalsWhere(ctx, { ...filter, billable: true })}
             GROUP BY 1, 2, 3, 4, 5, 6, 7`);
        return rows.map((r) => ({ ...r, key: keyText(r.key), count: Number(r.count) }));
    }

    /**
     * The export's entries (3.4d): the filter's finished entries, by date,
     * person and id, at most `take` (the usecase reads one past its cap and
     * refuses above). The description is read (decrypted) and shown only
     * where the caller may read it.
     */
    static async forExport(db: PrismaTx, ctx: Ctx, filter: TotalsFilter, take: number) {
        return db.timeEntry.findMany({
            where: {
                tenantId: ctx.tenantId,
                workDate: { gte: filter.from, lte: filter.to },
                minutes: { not: null },
                ...(filter.projectId ? { projectId: filter.projectId } : {}),
                ...(filter.userId ? { userId: filter.userId } : {}),
                ...(filter.billable !== undefined ? { billable: filter.billable } : {}),
                // The usecase passes the grants only when it names no project (a named one is checked against them first).
                ...(filter.projectIds && !filter.projectId ? { projectId: { in: [...filter.projectIds] } } : {}),
            },
            orderBy: [{ workDate: 'asc' }, { userId: 'asc' }, { id: 'asc' }],
            take,
            select: { id: true, userId: true, projectId: true, workItemId: true, workDate: true, minutes: true, billable: true, description: true, frozenRateMinor: true, frozenRateLevel: true },
        });
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

    /**
     * Stamp the rates an approved week's billable entries were approved at
     * (3.4d, decision 273), in one statement; only the person's entries in
     * `[from, to]`. The freeze trigger admits this write: the frozen columns
     * change and nothing else (no version bump: it is not the person's change).
     */
    static async stampFrozenRates(
        db: PrismaTx,
        ctx: Ctx,
        userId: string,
        from: Date,
        to: Date,
        stamps: ReadonlyArray<{ id: string; hourlyRateMinor: number; level: BillableRateLevel }>,
    ): Promise<number> {
        if (stamps.length === 0) return 0;
        return db.$executeRaw(Prisma.sql`
            UPDATE "TimeEntry" t
               SET "frozenRateMinor" = s.rate, "frozenRateLevel" = s.level::"BillableRateLevel", "updatedAt" = now()
              FROM unnest(${stamps.map((x) => x.id)}::text[], ${stamps.map((x) => x.hourlyRateMinor)}::int[], ${stamps.map((x) => x.level)}::text[]) AS s(id, rate, level)
             WHERE t."id" = s.id
               AND t."tenantId" = ${ctx.tenantId}
               AND t."userId" = ${userId}
               AND t."workDate" BETWEEN ${from}::date AND ${to}::date
               AND t."billable"`);
    }

    /** Clear the person's frozen rates in `[from, to]` (a reopened week, 3.4d). */
    static async clearFrozenRates(db: PrismaTx, ctx: Ctx, userId: string, from: Date, to: Date): Promise<number> {
        const result = await db.timeEntry.updateMany({
            where: { tenantId: ctx.tenantId, userId, workDate: { gte: from, lte: to }, frozenRateMinor: { not: null } },
            data: { frozenRateMinor: null, frozenRateLevel: null },
        });
        return result.count;
    }

    /** Remove the person's own entry for good (decision 277). */
    static async delete(db: PrismaTx, ctx: Ctx, id: string, userId: string): Promise<number> {
        const result = await db.timeEntry.deleteMany({ where: { id, tenantId: ctx.tenantId, userId } });
        return result.count;
    }
}
