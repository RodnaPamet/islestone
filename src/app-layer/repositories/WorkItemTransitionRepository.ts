/**
 * The transition record's reads (sub-phases 2.5a and 3.6a;
 * docs/porting/maps/3.6.md, "The measures"; ADR 0014 §1). The only module
 * with SQL against `WorkItemTransition`: the trigger
 * `work_item_transition_record` is its only writer, and `app_user` holds
 * SELECT alone.
 *
 * Every read filters `tenantId` (row-level security scopes it again), reads
 * only rows at or before the moment of reading `R`, and judges each row's
 * recorded project against the caller's visibility (live projects, archived
 * ones included: their history counts, decision 315). The SQL reads implement
 * the pure rules of `domain/analytics/` (pictures at an instant, ties by
 * sequence id; completion as of `R`; the flow sweep), each with a property
 * test against them (`tests/integration/analytics-record.test.ts`).
 *
 * A completion is spelled exactly as the partial index
 * `WorkItemTransition_completions` is declared: `"stateCategory" = 'DONE'
 * AND "fromStateCategory" IS DISTINCT FROM 'DONE'`.
 *
 * Written fresh for Islestone.
 */
import { Prisma, type WorkflowStateCategory } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import type { EpochDay } from '../domain/schedule/calendar';
import type { FlowBucket, FlowDelta } from '../domain/analytics/flow';
import type { ProjectVisibility } from '../policies/project-visibility';
import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId'>;

/** The most items a burn-up reads; one past it marks truncation (2.5a). */
export const BURN_UP_ITEM_CAP = 5_000;
/** The most transitions a burn-up reads (several changes per item). */
export const BURN_UP_TRANSITION_CAP = 100_000;

export interface TransitionRow {
    id: bigint;
    workItemId: string;
    projectId: string;
    cycleId: string | null;
    stateCategory: WorkflowStateCategory;
    deleted: boolean;
    at: Date;
    /** The estimate the row records (3.4a); NULL in rows written before. */
    estimatePoints: number | null;
    estimateMinutes: number | null;
}

/** A filter on a recorded id column: these ids, and/or NULL ("none"). */
export interface RecordedIdFilter {
    ids: readonly string[];
    none: boolean;
}

/**
 * What a read covers. Recorded fields are judged on each row as recorded
 * (decision 315); `itemIds` is the set a filter on current values selected
 * (null: no such filter).
 */
export interface RecordScope {
    visibility: ProjectVisibility;
    projectIds: readonly string[] | null;
    teamIds: readonly string[] | null;
    cycle: RecordedIdFilter | null;
    milestone: RecordedIdFilter | null;
    itemIds: readonly string[] | null;
}

/** An instant as the record stores it: `timestamp(3)` in UTC. */
function ts(at: Date): Prisma.Sql {
    return Prisma.sql`(${at.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

/** The epoch day a row's instant falls on in `tz`. */
function dayOf(column: Prisma.Sql, tz: string): Prisma.Sql {
    return Prisma.sql`((((${column}) AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date - DATE '1970-01-01')`;
}

function idFilterSql(column: Prisma.Sql, f: RecordedIdFilter): Prisma.Sql {
    if (f.none && f.ids.length > 0) return Prisma.sql`(${column} IS NULL OR ${column} = ANY(${[...f.ids]}::text[]))`;
    if (f.none) return Prisma.sql`${column} IS NULL`;
    return Prisma.sql`${column} = ANY(${[...f.ids]}::text[])`;
}

/** The scope's predicate on a row aliased `a`: its recorded project visible, and every recorded filter. */
function scopeSql(ctx: Ctx, a: string, s: RecordScope): Prisma.Sql {
    const col = (name: string) => Prisma.raw(`${a}."${name}"`);
    const all = s.visibility.kind === 'ALL';
    const granted = s.visibility.kind === 'GRANTED' ? [...s.visibility.projectIds] : [];
    const parts: Prisma.Sql[] = [
        Prisma.sql`${col('projectId')} IN (SELECT vp."id" FROM "Project" vp WHERE vp."tenantId" = ${ctx.tenantId} AND vp."deletedAt" IS NULL AND (${all}::boolean OR vp."id" = ANY(${granted}::text[])))`,
    ];
    if (s.projectIds) parts.push(Prisma.sql`${col('projectId')} = ANY(${[...s.projectIds]}::text[])`);
    if (s.teamIds) parts.push(Prisma.sql`${col('teamId')} = ANY(${[...s.teamIds]}::text[])`);
    if (s.cycle) parts.push(idFilterSql(col('cycleId'), s.cycle));
    if (s.milestone) parts.push(idFilterSql(col('milestoneId'), s.milestone));
    return Prisma.join(parts, ' AND ');
}

function itemSql(a: string, s: RecordScope): Prisma.Sql {
    return s.itemIds ? Prisma.sql`AND ${Prisma.raw(`${a}."workItemId"`)} = ANY(${[...s.itemIds]}::text[])` : Prisma.empty;
}

/** The completions of the window `[from, to)` that count as of `asOf` (decision 311), as a CTE body named `done`. */
function completionsCte(ctx: Ctx, s: RecordScope, from: Date, to: Date, asOf: Date): Prisma.Sql {
    const t = ctx.tenantId;
    return Prisma.sql`
        SELECT c."id", c."workItemId", c."at", c."teamId", c."projectId"
          FROM "WorkItemTransition" c
         WHERE c."tenantId" = ${t}
           AND c."stateCategory" = 'DONE' AND c."fromStateCategory" IS DISTINCT FROM 'DONE'
           AND c."at" >= ${ts(from)} AND c."at" < ${ts(to)} AND c."at" <= ${ts(asOf)}
           AND ${scopeSql(ctx, 'c', s)}
           ${itemSql('c', s)}
           AND NOT EXISTS (
               SELECT 1 FROM "WorkItemTransition" l
                WHERE l."tenantId" = ${t} AND l."workItemId" = c."workItemId"
                  AND l."at" >= c."at" AND l."at" <= ${ts(asOf)}
                  AND (l."at" > c."at" OR l."id" > c."id")
                  AND l."stateCategory" <> 'DONE')
           AND NOT COALESCE((
               SELECT z."deleted" FROM "WorkItemTransition" z
                WHERE z."tenantId" = ${t} AND z."workItemId" = c."workItemId" AND z."at" <= ${ts(asOf)}
                ORDER BY z."at" DESC, z."id" DESC LIMIT 1), true)`;
}

export interface CompletionDurationRow {
    workItemId: string;
    teamId: string;
    completedAt: Date;
    startedAt: Date | null;
    createdAt: Date;
}

export interface AgeRow {
    id: string;
    teamId: string;
    number: number;
    title: string;
    keyPrefix: string;
    startedAt: Date;
    total: number;
}

export class WorkItemTransitionRepository {
    // ── The cycle burn-up (2.5a; moved here from CycleRepository in 3.6a) ──

    /** The ids of the items with any transition naming the cycle; one past the cap marks truncation. */
    static async itemIdsEverInCycle(db: PrismaTx, ctx: Ctx, cycleId: string): Promise<string[]> {
        const rows = await db.workItemTransition.findMany({
            where: { tenantId: ctx.tenantId, cycleId },
            distinct: ['workItemId'],
            orderBy: { workItemId: 'asc' },
            take: BURN_UP_ITEM_CAP + 1,
            select: { workItemId: true },
        });
        return rows.map((r) => r.workItemId);
    }

    /** Every transition of the items up to `until` (the burn-up's facts). */
    static async transitionsOf(db: PrismaTx, ctx: Ctx, workItemIds: readonly string[], until: Date): Promise<TransitionRow[]> {
        if (workItemIds.length === 0) return [];
        return db.workItemTransition.findMany({
            where: { tenantId: ctx.tenantId, workItemId: { in: [...workItemIds] }, at: { lte: until } },
            orderBy: [{ at: 'asc' }, { id: 'asc' }],
            take: BURN_UP_TRANSITION_CAP,
            select: { id: true, workItemId: true, projectId: true, cycleId: true, stateCategory: true, deleted: true, at: true, estimatePoints: true, estimateMinutes: true },
        });
    }

    // ── Analytics (3.6a) ──────────────────────────────────────────────

    /**
     * Throughput: the completions of `[from, to)` counting as of `asOf`, per
     * day in `tz` (epoch days). Grouped in the database; the caller compares
     * the total with its bound.
     */
    static async completionsPerDay(db: PrismaTx, ctx: Ctx, s: RecordScope, window: { from: Date; to: Date; asOf: Date; tz: string }): Promise<Array<{ day: EpochDay; count: number }>> {
        const rows = await db.$queryRaw<Array<{ day: number; count: number }>>(Prisma.sql`
            WITH done AS (${completionsCte(ctx, s, window.from, window.to, window.asOf)})
            SELECT ${dayOf(Prisma.sql`done."at"`, window.tz)}::int AS "day", count(*)::int AS "count"
              FROM done
             GROUP BY 1`);
        return rows.map((r) => ({ day: Number(r.day), count: Number(r.count) }));
    }

    /**
     * Cycle time and lead time: each completion of the window counting as of
     * `asOf`, with its first entry into Started at or before it and its first
     * recorded row, the newest first; at most `take`.
     */
    static async completionDurations(db: PrismaTx, ctx: Ctx, s: RecordScope, window: { from: Date; to: Date; asOf: Date }, take: number): Promise<CompletionDurationRow[]> {
        const t = ctx.tenantId;
        return db.$queryRaw<CompletionDurationRow[]>(Prisma.sql`
            WITH done AS (${completionsCte(ctx, s, window.from, window.to, window.asOf)})
            SELECT d."workItemId", d."teamId", d."at" AS "completedAt",
                   (SELECT min(st."at") FROM "WorkItemTransition" st
                     WHERE st."tenantId" = ${t} AND st."workItemId" = d."workItemId" AND st."stateCategory" = 'STARTED' AND st."at" <= d."at") AS "startedAt",
                   (SELECT f."at" FROM "WorkItemTransition" f
                     WHERE f."tenantId" = ${t} AND f."workItemId" = d."workItemId"
                     ORDER BY f."at", f."id" LIMIT 1) AS "createdAt"
              FROM done d
             ORDER BY d."at" DESC, d."id" DESC
             LIMIT ${take}`);
    }

    /**
     * Counts: the completions of the window counting as of `asOf`, and the
     * items created in it (their first row, its recorded scope) that are live
     * as of `asOf`.
     */
    static async windowCounts(db: PrismaTx, ctx: Ctx, s: RecordScope, window: { from: Date; to: Date; asOf: Date }): Promise<{ done: number; created: number }> {
        const t = ctx.tenantId;
        const [row] = await db.$queryRaw<Array<{ done: number; created: number }>>(Prisma.sql`
            WITH done AS (${completionsCte(ctx, s, window.from, window.to, window.asOf)})
            SELECT (SELECT count(*) FROM done)::int AS "done",
                   (SELECT count(*) FROM "WorkItemTransition" c
                     WHERE c."tenantId" = ${t} AND c."fromStateCategory" IS NULL
                       AND c."at" >= ${ts(window.from)} AND c."at" < ${ts(window.to)} AND c."at" <= ${ts(window.asOf)}
                       AND ${scopeSql(ctx, 'c', s)}
                       ${itemSql('c', s)}
                       AND NOT COALESCE((
                           SELECT z."deleted" FROM "WorkItemTransition" z
                            WHERE z."tenantId" = ${t} AND z."workItemId" = c."workItemId" AND z."at" <= ${ts(window.asOf)}
                            ORDER BY z."at" DESC, z."id" DESC LIMIT 1), true))::int AS "created"`);
        return { done: Number(row?.done ?? 0), created: Number(row?.created ?? 0) };
    }

    /**
     * The items a flow follows: every item with a row in scope at or before
     * `until`, at most `take` (the caller reads one past its bound).
     */
    static async flowItemIds(db: PrismaTx, ctx: Ctx, s: RecordScope, until: Date, take: number): Promise<string[]> {
        const rows = await db.$queryRaw<Array<{ workItemId: string }>>(Prisma.sql`
            SELECT DISTINCT t."workItemId"
              FROM "WorkItemTransition" t
             WHERE t."tenantId" = ${ctx.tenantId} AND t."at" <= ${ts(until)}
               AND ${scopeSql(ctx, 't', s)}
               ${itemSql('t', s)}
             LIMIT ${take}`);
        return rows.map((r) => r.workItemId);
    }

    /**
     * The flow sweep in the database (decision 331): each row of the items
     * up to `asOf` (and before the day after `toDay` begins) given its bucket
     * (`domain/analytics/flow.ts`) and its weight under the measure; every
     * change of either becomes a −1 and a +1 on its day (rows before the
     * window on the day before it); summed per day and bucket.
     * `flowFromDeltas` turns the rows into the series. The scope's predicate
     * is COALESCEd: a NULL recorded cycle or milestone against an id filter
     * is out of scope, never "unknown".
     */
    static async flowDeltas(
        db: PrismaTx,
        ctx: Ctx,
        s: RecordScope,
        itemIds: readonly string[],
        window: { fromDay: EpochDay; end: Date; asOf: Date; tz: string; doneSince: Date | null; measure: 'items' | 'points' | 'hours' },
    ): Promise<FlowDelta[]> {
        if (itemIds.length === 0) return [];
        const t = ctx.tenantId;
        const weight =
            window.measure === 'items' ? Prisma.sql`1` : window.measure === 'points' ? Prisma.sql`t."estimatePoints"` : Prisma.sql`t."estimateMinutes"`;
        const since = window.doneSince ? Prisma.sql`${ts(window.doneSince)}` : Prisma.sql`NULL::timestamp`;
        const rows = await db.$queryRaw<Array<{ day: number; bucket: FlowBucket; count: number; weight: bigint | number; unestimated: number }>>(Prisma.sql`
            WITH r AS (
                SELECT t."workItemId", t."id", t."at",
                       CASE
                           WHEN t."deleted" OR t."stateCategory" = 'CANCELLED' OR NOT COALESCE((${scopeSql(ctx, 't', s)}), false) THEN 'OUT'
                           WHEN t."stateCategory" = 'DONE' THEN
                               CASE WHEN ${since} IS NOT NULL
                                     AND max(CASE WHEN t."stateCategory" = 'DONE' AND t."fromStateCategory" IS DISTINCT FROM 'DONE' THEN t."at" END) OVER w < ${since}
                                    THEN 'DONE_BEFORE' ELSE 'DONE' END
                           ELSE t."stateCategory"::text
                       END AS "bucket",
                       ${weight} AS "w"
                  FROM "WorkItemTransition" t
                 WHERE t."tenantId" = ${t} AND t."workItemId" = ANY(${[...itemIds]}::text[])
                   AND t."at" <= ${ts(window.asOf)} AND t."at" < ${ts(window.end)}
                WINDOW w AS (PARTITION BY t."workItemId" ORDER BY t."at", t."id" ROWS UNBOUNDED PRECEDING)
            ), b AS (
                SELECT r."workItemId", r."id", r."at", r."bucket", CASE WHEN r."bucket" = 'OUT' THEN NULL ELSE r."w" END AS "w"
                  FROM r
            ), e AS (
                SELECT b."bucket", b."w",
                       LAG(b."bucket", 1, 'OUT') OVER p AS "prevBucket",
                       LAG(b."w") OVER p AS "prevW",
                       GREATEST(${dayOf(Prisma.sql`b."at"`, window.tz)}, ${window.fromDay - 1}::int) AS "day"
                  FROM b
                WINDOW p AS (PARTITION BY b."workItemId" ORDER BY b."at", b."id")
            ), changed AS (
                SELECT * FROM e WHERE (e."bucket", e."w") IS DISTINCT FROM (e."prevBucket", e."prevW")
            ), signed AS (
                SELECT c."day", c."prevBucket" AS "bucket", -1 AS "sign", c."prevW" AS "w" FROM changed c WHERE c."prevBucket" <> 'OUT'
                UNION ALL
                SELECT c."day", c."bucket", 1 AS "sign", c."w" FROM changed c WHERE c."bucket" <> 'OUT'
            )
            SELECT s."day"::int AS "day", s."bucket",
                   sum(CASE WHEN s."w" IS NULL THEN 0 ELSE s."sign" END)::int AS "count",
                   COALESCE(sum(s."sign" * s."w"), 0)::bigint AS "weight",
                   sum(CASE WHEN s."w" IS NULL THEN s."sign" ELSE 0 END)::int AS "unestimated"
              FROM signed s
             GROUP BY s."day", s."bucket"`);
        return rows.map((r) => ({ day: Number(r.day), bucket: r.bucket, count: Number(r.count), weight: Number(r.weight), unestimated: Number(r.unestimated) }));
    }

    /**
     * Age: the live, visible items in a Started state now that the scope's
     * current values select, with their first entry into Started, the oldest
     * first; at most `take`, with the total. Reads `WorkItem` with its own
     * `deletedAt` and visibility (archived projects only with
     * `includeArchived`, as the list).
     */
    static async startedItemsByFirstStart(
        db: PrismaTx,
        ctx: Ctx,
        s: RecordScope & { includeArchived: boolean; initiativeProjectIds: readonly string[] | null },
        take: number,
    ): Promise<AgeRow[]> {
        const t = ctx.tenantId;
        const all = s.visibility.kind === 'ALL';
        const granted = s.visibility.kind === 'GRANTED' ? [...s.visibility.projectIds] : [];
        const parts: Prisma.Sql[] = [];
        if (s.projectIds) parts.push(Prisma.sql`w."projectId" = ANY(${[...s.projectIds]}::text[])`);
        if (s.initiativeProjectIds) parts.push(Prisma.sql`w."projectId" = ANY(${[...s.initiativeProjectIds]}::text[])`);
        if (s.teamIds) parts.push(Prisma.sql`w."teamId" = ANY(${[...s.teamIds]}::text[])`);
        if (s.cycle) parts.push(idFilterSql(Prisma.sql`w."cycleId"`, s.cycle));
        if (s.milestone) parts.push(idFilterSql(Prisma.sql`w."milestoneId"`, s.milestone));
        if (s.itemIds) parts.push(Prisma.sql`w."id" = ANY(${[...s.itemIds]}::text[])`);
        const extra = parts.length > 0 ? Prisma.sql`AND ${Prisma.join(parts, ' AND ')}` : Prisma.empty;
        const rows = await db.$queryRaw<Array<AgeRow & { total: bigint | number }>>(Prisma.sql`
            SELECT x."id", x."teamId", x."number", x."title", x."keyPrefix", x."startedAt", count(*) OVER () AS "total"
              FROM (
                SELECT w."id", w."teamId", w."number", w."title", p."keyPrefix",
                       (SELECT min(st."at") FROM "WorkItemTransition" st
                         WHERE st."tenantId" = ${t} AND st."workItemId" = w."id" AND st."stateCategory" = 'STARTED') AS "startedAt"
                  FROM "WorkItem" w
                  JOIN "Project" p ON p."id" = w."projectId" AND p."tenantId" = ${t} AND p."deletedAt" IS NULL
                       AND (${s.includeArchived}::boolean OR p."archivedAt" IS NULL)
                 WHERE w."tenantId" = ${t} AND w."deletedAt" IS NULL AND w."stateCategory" = 'STARTED'
                   AND (${all}::boolean OR w."projectId" = ANY(${granted}::text[]))
                   ${extra}
              ) x
             WHERE x."startedAt" IS NOT NULL
             ORDER BY x."startedAt" ASC, x."id" ASC
             LIMIT ${take}`);
        return rows.map((r) => ({ ...r, number: Number(r.number), total: Number(r.total) }));
    }
}
