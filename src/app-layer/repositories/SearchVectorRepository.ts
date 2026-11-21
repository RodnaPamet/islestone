/**
 * `SearchVector` rows (sub-phase 2.7f; ADR 0008 D1, option C; owner decisions
 * 124 and 126; docs/search.md): the full-text vectors of work-item
 * descriptions and comments.
 *
 * THE ONE SEAM. This is the only module that issues SQL against the table
 * (`tests/guards/search-vector-write-seam.test.ts`). A vector is written by
 * the usecase that holds the plaintext, in the transaction that writes the
 * encrypted text, through `replaceForSource`; the nightly and on-demand
 * `search-index-rebuild` job uses the same method. The plaintext crosses to
 * PostgreSQL only as a bind parameter of `to_tsvector('islestone_bg_en', $1)`
 * and is never logged. The configuration is spelled as a literal in the SQL
 * text, never a parameter (`tests/guards/search-configuration-literal.test.ts`):
 * a planner matches an expression index only on a constant.
 *
 * Every read filters the workspace, the item's `deletedAt`, a comment's
 * `deletedAt` and project visibility in its own `WHERE`
 * (`tests/unit/repositories/search-repository-predicates.test.ts`), and names
 * the configuration (the GIN index is partial on it).
 *
 * Written fresh for Islestone.
 */
import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { projectVisibilitySql, type ProjectVisibility } from '../policies/project-visibility';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { SEARCH_VECTOR_REVISION, searchableText } from '@/lib/search/configuration';

/** One indexed source: a comment, or the item's description (`commentId` null). */
export interface SearchVectorSource {
    workItemId: string;
    commentId: string | null;
}

/** One matched item: its best-ranked source. */
export interface SearchVectorMatch {
    workItemId: string;
    /** `null`: the description matched best; otherwise that comment. */
    commentId: string | null;
    rank: number;
}

/** The most matched items one read returns (the list filter's bound). */
export const SEARCH_MATCH_CAP = 1000;

/** One page of sources the rebuild reads. */
export const REBUILD_PAGE_SIZE = 500;

/** The most sources one bulk seed statement writes (`insertBulkForSeed`). */
export const SEED_BULK_MAX = 10_000;

export class SearchVectorRepository {
    /**
     * Write (or replace) one source's vector from its plaintext, in the
     * caller's transaction; an empty text (after `searchableText`) removes it.
     */
    static async replaceForSource(db: PrismaTx, ctx: RequestContext, source: SearchVectorSource, plaintext: string | null | undefined): Promise<void> {
        const text = searchableText(plaintext);
        if (!text) {
            await SearchVectorRepository.removeForSource(db, ctx, source);
            return;
        }
        const id = randomUUID();
        if (source.commentId === null) {
            await db.$executeRaw(Prisma.sql`
                INSERT INTO "SearchVector" ("id", "tenantId", "workItemId", "commentId", "lexemes", "configName", "revision", "updatedAt")
                VALUES (${id}, ${ctx.tenantId}, ${source.workItemId}, NULL,
                        to_tsvector('islestone_bg_en', ${text}), 'islestone_bg_en', ${SEARCH_VECTOR_REVISION}, now())
                ON CONFLICT ("tenantId", "workItemId") WHERE "commentId" IS NULL
                DO UPDATE SET "lexemes" = EXCLUDED."lexemes", "configName" = EXCLUDED."configName",
                              "revision" = EXCLUDED."revision", "updatedAt" = EXCLUDED."updatedAt"`);
            return;
        }
        await db.$executeRaw(Prisma.sql`
            INSERT INTO "SearchVector" ("id", "tenantId", "workItemId", "commentId", "lexemes", "configName", "revision", "updatedAt")
            VALUES (${id}, ${ctx.tenantId}, ${source.workItemId}, ${source.commentId},
                    to_tsvector('islestone_bg_en', ${text}), 'islestone_bg_en', ${SEARCH_VECTOR_REVISION}, now())
            ON CONFLICT ("tenantId", "commentId") WHERE "commentId" IS NOT NULL
            DO UPDATE SET "lexemes" = EXCLUDED."lexemes", "configName" = EXCLUDED."configName",
                          "revision" = EXCLUDED."revision", "updatedAt" = EXCLUDED."updatedAt"`);
    }

    /**
     * The scale seeder's bulk path (Hardening H2a, owner decision 171;
     * docs/performance.md): the vectors of many NEW sources in one statement,
     * each computed by PostgreSQL from its plaintext through the same
     * `searchableText` and the same configuration as `replaceForSource`, so a
     * seeded vector equals the one the seam would have written. Inserts only,
     * at most {@link SEED_BULK_MAX} sources; an empty text writes nothing. Its
     * one caller is `scripts/seed-scale/` (`tests/guards/search-vector-write-seam.test.ts`
     * pins it): the application writes a vector through `replaceForSource`,
     * in the transaction that writes the text. Returns the rows written.
     */
    static async insertBulkForSeed(
        db: PrismaTx,
        ctx: RequestContext,
        sources: ReadonlyArray<SearchVectorSource & { plaintext: string | null }>,
    ): Promise<number> {
        if (sources.length > SEED_BULK_MAX) throw new Error(`insertBulkForSeed takes at most ${SEED_BULK_MAX} sources`);
        const ids: string[] = [];
        const items: string[] = [];
        const comments: Array<string | null> = [];
        const texts: string[] = [];
        for (const s of sources) {
            const text = searchableText(s.plaintext);
            if (!text) continue;
            ids.push(randomUUID());
            items.push(s.workItemId);
            comments.push(s.commentId);
            texts.push(text);
        }
        if (ids.length === 0) return 0;
        return db.$executeRaw(Prisma.sql`
            INSERT INTO "SearchVector" ("id", "tenantId", "workItemId", "commentId", "lexemes", "configName", "revision", "updatedAt")
            SELECT t."id", ${ctx.tenantId}, t."workItemId", t."commentId",
                   to_tsvector('islestone_bg_en', t."text"), 'islestone_bg_en', ${SEARCH_VECTOR_REVISION}, now()
              FROM unnest(${ids}::text[], ${items}::text[], ${comments}::text[], ${texts}::text[]) AS t("id", "workItemId", "commentId", "text")`);
    }

    /** Remove one source's vector (a cleared description, a deleted comment). */
    static async removeForSource(db: PrismaTx, ctx: RequestContext, source: SearchVectorSource): Promise<void> {
        await db.$executeRaw(Prisma.sql`
            DELETE FROM "SearchVector"
             WHERE "tenantId" = ${ctx.tenantId}
               AND "workItemId" = ${source.workItemId}
               AND "commentId" ${source.commentId === null ? Prisma.sql`IS NULL` : Prisma.sql`= ${source.commentId}`}`);
    }

    /**
     * The live, visible items whose description or a live comment matches the
     * query (`websearch_to_tsquery`: words, "phrases", `or`, `-word`), best
     * first, each once with its best source; at most `cap` (at most
     * {@link SEARCH_MATCH_CAP}).
     */
    static async matchItems(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, query: string, cap: number): Promise<SearchVectorMatch[]> {
        const limit = Math.min(Math.max(1, Math.floor(cap)), SEARCH_MATCH_CAP);
        const rows = await db.$queryRaw<Array<{ workItemId: string; commentId: string | null; rank: number }>>(Prisma.sql`
            SELECT m."workItemId", m."commentId", m."rank"
              FROM (
                SELECT DISTINCT ON (s."workItemId") s."workItemId", s."commentId",
                       ts_rank(s."lexemes", websearch_to_tsquery('islestone_bg_en', ${query}))::float8 AS "rank"
                  FROM "SearchVector" s
                  JOIN "WorkItem" w ON w."id" = s."workItemId" AND w."tenantId" = s."tenantId"
                  JOIN "Project" p ON p."id" = w."projectId" AND p."tenantId" = w."tenantId"
                  LEFT JOIN "Comment" c ON c."id" = s."commentId" AND c."tenantId" = s."tenantId"
                 WHERE s."tenantId" = ${ctx.tenantId}
                   AND s."configName" = 'islestone_bg_en'
                   AND s."lexemes" @@ websearch_to_tsquery('islestone_bg_en', ${query})
                   AND w."deletedAt" IS NULL
                   AND (s."commentId" IS NULL OR c."deletedAt" IS NULL)
                   AND ${projectVisibilitySql(v, { projectAlias: 'p', projectIdColumn: 'w."projectId"' })}
                 ORDER BY s."workItemId", "rank" DESC, (s."commentId" IS NULL) DESC, s."commentId" ASC
              ) m
             ORDER BY m."rank" DESC, m."workItemId" ASC
             LIMIT ${limit}`);
        return rows.map((r) => ({ workItemId: r.workItemId, commentId: r.commentId, rank: Number(r.rank) }));
    }

    // ── The rebuild (search-index-rebuild) ──────────────────────────────

    /**
     * One page of work items, after `afterId` in id order, whose description
     * vector is missing or older than the current revision (all of them when
     * `force`). Deleted items are included: a restore needs no rebuild. Ids
     * only; the caller reads the text through the decrypting client.
     */
    static async staleDescriptionPage(db: PrismaTx, ctx: RequestContext, afterId: string | null, opts: { force: boolean }): Promise<string[]> {
        const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT w."id"
              FROM "WorkItem" w
              LEFT JOIN "SearchVector" s
                ON s."tenantId" = w."tenantId" AND s."workItemId" = w."id" AND s."commentId" IS NULL
             WHERE w."tenantId" = ${ctx.tenantId}
               AND w."description" IS NOT NULL
               AND (${afterId}::text IS NULL OR w."id" > ${afterId})
               AND (${opts.force} OR s."id" IS NULL OR s."revision" < ${SEARCH_VECTOR_REVISION} OR s."configName" <> 'islestone_bg_en')
             ORDER BY w."id" ASC
             LIMIT ${REBUILD_PAGE_SIZE}`);
        return rows.map((r) => r.id);
    }

    /** As {@link staleDescriptionPage}, for live comments. */
    static async staleCommentPage(db: PrismaTx, ctx: RequestContext, afterId: string | null, opts: { force: boolean }): Promise<string[]> {
        const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT c."id"
              FROM "Comment" c
              LEFT JOIN "SearchVector" s
                ON s."tenantId" = c."tenantId" AND s."commentId" = c."id"
             WHERE c."tenantId" = ${ctx.tenantId}
               AND c."deletedAt" IS NULL
               AND (${afterId}::text IS NULL OR c."id" > ${afterId})
               AND (${opts.force} OR s."id" IS NULL OR s."revision" < ${SEARCH_VECTOR_REVISION} OR s."configName" <> 'islestone_bg_en')
             ORDER BY c."id" ASC
             LIMIT ${REBUILD_PAGE_SIZE}`);
        return rows.map((r) => r.id);
    }

    /**
     * The decrypted descriptions of one rebuild page, by id. Deleted items
     * are read too, BY DESIGN (a restore needs no rebuild); this read feeds
     * only `replaceForSource`, never a person. At most one page.
     */
    static async descriptionTexts(db: PrismaTx, ctx: RequestContext, ids: readonly string[]): Promise<Map<string, string | null>> {
        if (ids.length === 0) return new Map();
        const rows = await db.workItem.findMany({
            where: { tenantId: ctx.tenantId, id: { in: [...ids] } },
            take: REBUILD_PAGE_SIZE,
            select: { id: true, description: true },
        });
        return new Map(rows.map((r) => [r.id, r.description] as const));
    }

    /** The decrypted bodies of one rebuild page of live comments, by id. */
    static async commentTexts(db: PrismaTx, ctx: RequestContext, ids: readonly string[]): Promise<Array<{ id: string; workItemId: string; body: string }>> {
        if (ids.length === 0) return [];
        return db.comment.findMany({
            where: { tenantId: ctx.tenantId, id: { in: [...ids] }, deletedAt: null },
            take: REBUILD_PAGE_SIZE,
            select: { id: true, workItemId: true, body: true },
        });
    }

    /**
     * Rows a source no longer has a reason to keep: a deleted comment's vector
     * (a soft delete before 2.7f, or one that raced the delete). Removed by the
     * rebuild so a search never reads them, even past the join's filter.
     */
    static async removeDeletedCommentRows(db: PrismaTx, ctx: RequestContext): Promise<number> {
        return db.$executeRaw(Prisma.sql`
            DELETE FROM "SearchVector" s
             USING "Comment" c
             WHERE s."tenantId" = ${ctx.tenantId}
               AND c."tenantId" = s."tenantId"
               AND c."id" = s."commentId"
               AND c."deletedAt" IS NOT NULL`);
    }
}
