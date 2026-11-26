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
 * The match (`matchItems`) is the SECURITY DEFINER function
 * `search_item_contents` (owner decision 245, issue #78; migration
 * `20261214120000_search_definer_functions`; docs/search.md, "The search
 * functions"): under row-level security `@@` could not be an index condition,
 * so the function, which reads the workspace from `app.tenant_id` itself,
 * filters the workspace, the item's and a comment's `deletedAt`, the
 * configuration and project visibility in its own `WHERE`, and returns ids
 * and ranks only. This module is its only caller
 * (`tests/guards/search-vector-write-seam.test.ts`). The rebuild's reads stay
 * plain SQL under row-level security, in pages bounded to their own rows.
 *
 * Written fresh for Islestone.
 */
import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { projectVisibilityArgs, type ProjectVisibility } from '../policies/project-visibility';
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

/**
 * One page of the rebuild's walk: the stale sources among the page's rows,
 * and the cursor of the next page (null when the walk is over).
 */
export interface RebuildPage {
    ids: string[];
    next: string | null;
}

function rebuildPageOf(rows: ReadonlyArray<{ id: string; stale: boolean }>): RebuildPage {
    return {
        ids: rows.filter((r) => r.stale).map((r) => r.id),
        next: rows.length === REBUILD_PAGE_SIZE ? rows[rows.length - 1]!.id : null,
    };
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
     * {@link SEARCH_MATCH_CAP}, which the function also caps). The workspace
     * is the transaction's `app.tenant_id`, read by the function; `ctx` names
     * nothing to it.
     */
    static async matchItems(db: PrismaTx, _ctx: RequestContext, v: ProjectVisibility, query: string, cap: number): Promise<SearchVectorMatch[]> {
        const limit = Math.min(Math.max(1, Math.floor(cap)), SEARCH_MATCH_CAP);
        const rows = await db.$queryRaw<Array<{ workItemId: string; commentId: string | null; rank: number }>>(Prisma.sql`
            SELECT m."workItemId", m."commentId", m."rank"
              FROM search_item_contents(${query}::text, ${projectVisibilityArgs(v)}, ${limit}::integer) m`);
        return rows.map((r) => ({ workItemId: r.workItemId, commentId: r.commentId, rank: Number(r.rank) }));
    }

    // ── The rebuild (search-index-rebuild) ──────────────────────────────

    /**
     * One page of the rebuild's walk over work items with a description (issue
     * #79): the next {@link REBUILD_PAGE_SIZE} of them after `afterId` in id
     * order, and of those the ones whose description vector is missing, older
     * than the current revision or built with another configuration (all of
     * them when `force`). The page reads only its own rows: the items by the
     * `(id, tenantId)` key from the cursor, then each one's vector through
     * `SearchVector_one_per_description`, never the workspace's whole vector
     * table. `next` is the last item the page read (the cursor of the next
     * page), or null when the walk is over. Deleted items are included: a
     * restore needs no rebuild. Ids only; the caller reads the text through
     * the decrypting client.
     */
    static async staleDescriptionPage(db: PrismaTx, ctx: RequestContext, afterId: string | null, opts: { force: boolean }): Promise<RebuildPage> {
        const after = afterId === null ? Prisma.empty : Prisma.sql`AND w."id" > ${afterId}`;
        const rows = await db.$queryRaw<Array<{ id: string; stale: boolean }>>(Prisma.sql`
            SELECT page."id",
                   (${opts.force} OR s."revision" IS NULL OR s."revision" < ${SEARCH_VECTOR_REVISION} OR s."configName" <> 'islestone_bg_en') AS "stale"
              FROM (
                SELECT w."id"
                  FROM "WorkItem" w
                 WHERE w."tenantId" = ${ctx.tenantId}
                   AND w."description" IS NOT NULL
                   ${after}
                 ORDER BY w."id" ASC
                 LIMIT ${REBUILD_PAGE_SIZE}
              ) page
              LEFT JOIN LATERAL (
                SELECT v."revision", v."configName"
                  FROM "SearchVector" v
                 WHERE v."tenantId" = ${ctx.tenantId}
                   AND v."workItemId" = page."id"
                   AND v."commentId" IS NULL
              ) s ON true
             ORDER BY page."id" ASC`);
        return rebuildPageOf(rows);
    }

    /** As {@link staleDescriptionPage}, for live comments (`SearchVector_one_per_comment`). */
    static async staleCommentPage(db: PrismaTx, ctx: RequestContext, afterId: string | null, opts: { force: boolean }): Promise<RebuildPage> {
        const after = afterId === null ? Prisma.empty : Prisma.sql`AND c."id" > ${afterId}`;
        const rows = await db.$queryRaw<Array<{ id: string; stale: boolean }>>(Prisma.sql`
            SELECT page."id",
                   (${opts.force} OR s."revision" IS NULL OR s."revision" < ${SEARCH_VECTOR_REVISION} OR s."configName" <> 'islestone_bg_en') AS "stale"
              FROM (
                SELECT c."id"
                  FROM "Comment" c
                 WHERE c."tenantId" = ${ctx.tenantId}
                   AND c."deletedAt" IS NULL
                   ${after}
                 ORDER BY c."id" ASC
                 LIMIT ${REBUILD_PAGE_SIZE}
              ) page
              LEFT JOIN LATERAL (
                SELECT v."revision", v."configName"
                  FROM "SearchVector" v
                 WHERE v."tenantId" = ${ctx.tenantId}
                   AND v."commentId" = page."id"
              ) s ON true
             ORDER BY page."id" ASC`);
        return rebuildPageOf(rows);
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
