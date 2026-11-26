-- Owner decision 250 (issue #89; docs/performance.md, finding F3;
-- docs/search.md, "The search functions"; ADR 0008, "The bound on content
-- matches").
--
-- H2b measured `search_item_contents` ranking every matching vector before
-- it took its limit: a common word matched 33,356 vectors on the 100k seed,
-- and the palette search and the list's `q` took 0.85 to 1.2 s p95 against
-- 500 and 600 ms. Decision 250: content search ranks only a bounded set of
-- candidates, at most 2,000 matching vectors walked most recently updated
-- first through an index, then ranked; titles and keys are still searched in
-- full (their functions are unchanged); when the bound cut the matches the
-- function says so, and the palette and the list say they are showing
-- recent matches.
--
-- "Most recently updated" is the vector's own `updatedAt`: the time its
-- source's text (a description, a comment) was last written, set by
-- `SearchVectorRepository.replaceForSource` in the transaction that writes
-- the text and kept by the rebuild, which re-vectorises text nobody changed
-- (docs/search.md, "The bound on content matches"). It lives on the matched
-- row, so one index orders the walk; the item's `updatedAt` would move with
-- every state or assignee change and would need a join before the bound.
--
-- Everything decisions 245 and 249 require of a search function holds: the
-- workspace from `app.tenant_id` and never an argument, the workspace,
-- `deletedAt` (the item's and a comment's), the project's liveness, project
-- visibility and the configuration in the function's own WHERE, applied
-- BEFORE the bound (so the bound counts only matches the caller may see, and
-- the flag says nothing about anything else), a hard cap, ids and ranks
-- returned with one boolean about the caller's own result, and nothing
-- LEAKPROOF. `tests/guards/search-definer-functions.test.ts` pins the new
-- body's hash.
--
-- Rolling deploys: the previous image selects the function's first three
-- columns by name, which this definition keeps; the added "bounded" column
-- and the index are additive.

-- ─── 1) The walk's index ──────────────────────────────────────────
--
-- Tenant-leading and partial on the configuration, as `SearchVector_search_lexemes`
-- is (every match names it). The function walks it backward, newest first.
-- Prisma cannot declare a partial index; the drift check ignores it.
CREATE INDEX "SearchVector_search_recent" ON "SearchVector" ("tenantId", "updatedAt", "id")
    WHERE "configName" = 'islestone_bg_en';

-- The walk orders by these two columns: the owner reads them, and nothing else new.
GRANT SELECT ("id", "updatedAt") ON "SearchVector" TO app_search_definer;

-- ─── 2) Descriptions and comments, bounded ────────────────────────
--
-- `SearchVectorRepository.matchItems`. The candidates are the live, visible
-- vectors matching the query, newest first, at most 2,001 (one past the
-- bound, so a cut is a fact the function holds); the first 2,000 are ranked,
-- each item once with its best source, best first; "bounded" is true on
-- every row when there were more than 2,000. Two ways reach the same
-- candidates, and the cheaper one is chosen by measurement, not by the
-- planner's estimate (which multiplies the words' frequencies and so
-- under-counts a phrase several times over):
--
--   - the walk: in a large workspace (100,000 vectors or more) and for a
--     query that matches at least 100 of the 2,000 newest vectors, the
--     newest 50,000 vectors are walked on `SearchVector_search_recent`,
--     filtered by the query and the liveness and visibility predicates, and
--     the walk stops at 2,001 matches; when it reaches them, nothing older
--     can be among the newest 2,001;
--   - otherwise (a smaller workspace, a sparse query, or a walk that did not
--     reach the bound) every match is read on `SearchVector_search_lexemes`
--     and the workspace's live, visible items index-only, each in a
--     materialised step (so neither is planned around the other: the matches
--     are never reached by probing every item, and the items are hashed once,
--     not probed per match), and the newest 2,001 live, visible matches kept.
--
-- Two settings: `plan_cache_mode = force_custom_plan`, so every call is
-- planned with its query folded to a constant (a cached generic plan, which
-- a pooled connection takes after five calls, parses the query again for
-- every row the walk filters: 300 ms instead of 70 at 100k); and
-- `jit = off`, because compiling the walk's plan (an estimated cost far above
-- `jit_above_cost`) took longer than the read itself.
--
-- The return type gains a column, so the function is dropped and created
-- again (CREATE OR REPLACE cannot change it), with its owner and grants.
DROP FUNCTION search_item_contents(text, boolean, text[], integer);

CREATE FUNCTION search_item_contents(
    p_query text,
    p_all_projects boolean,
    p_project_ids text[],
    p_limit integer
)
RETURNS TABLE ("workItemId" text, "commentId" text, "rank" double precision, "bounded" boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET plan_cache_mode = force_custom_plan
SET jit = off
AS $fn$
#variable_conflict use_column
DECLARE
    v_tenant text := NULLIF(current_setting('app.tenant_id', true), '');
BEGIN
    IF v_tenant IS NULL THEN
        RETURN;
    END IF;
    RETURN QUERY
    WITH sized AS MATERIALIZED (
        -- A large workspace: 100,000 vectors or more (the walk's index,
        -- index-only, at most 100,000 entries read).
        SELECT count(*) >= 100000 AS "large"
          FROM (SELECT s."id" FROM public."SearchVector" s
                 WHERE s."tenantId" = v_tenant AND s."configName" = 'islestone_bg_en'
                 ORDER BY s."updatedAt" DESC, s."id" DESC
                 LIMIT 100000) z
    ), dense AS MATERIALIZED (
        -- Do the workspace's 2,000 most recently written vectors hold at
        -- least 100 matches (5 %)? Then the walk below is expected to reach
        -- the bound within its window (2,001 matches in about 40,000 vectors).
        SELECT count(*) >= 100 AS "dense"
          FROM (SELECT s."lexemes" FROM public."SearchVector" s
                 WHERE s."tenantId" = v_tenant AND s."configName" = 'islestone_bg_en'
                 ORDER BY s."updatedAt" DESC, s."id" DESC
                 LIMIT 2000) z
         WHERE z."lexemes" @@ websearch_to_tsquery('islestone_bg_en', p_query)
    ), recent AS MATERIALIZED (
        -- The walk: the matches among the workspace's 50,000 most recently
        -- written vectors, newest first, stopping at 2,001. Only in a large
        -- workspace (where it reads at most half of it) and for a query dense
        -- among the newest vectors; `sized` is read first, so a small
        -- workspace never reads `dense`.
        SELECT s."id", s."workItemId", s."commentId", s."lexemes", s."updatedAt"
          FROM (SELECT s."id", s."tenantId", s."workItemId", s."commentId", s."lexemes", s."updatedAt"
                  FROM public."SearchVector" s
                 WHERE s."tenantId" = v_tenant AND s."configName" = 'islestone_bg_en'
                 ORDER BY s."updatedAt" DESC, s."id" DESC
                 LIMIT 50000) s
          JOIN public."WorkItem" w ON w."id" = s."workItemId" AND w."tenantId" = s."tenantId"
          JOIN public."Project" p ON p."id" = w."projectId" AND p."tenantId" = w."tenantId"
         WHERE (SELECT z."large" FROM sized z) AND (SELECT z."dense" FROM dense z)
           AND s."lexemes" @@ websearch_to_tsquery('islestone_bg_en', p_query)
           AND w."deletedAt" IS NULL
           AND (s."commentId" IS NULL
                OR EXISTS (SELECT 1 FROM public."Comment" c
                            WHERE c."id" = s."commentId" AND c."tenantId" = v_tenant AND c."deletedAt" IS NULL))
           AND p."deletedAt" IS NULL AND p."archivedAt" IS NULL
           AND (p_all_projects IS TRUE OR w."projectId" = ANY (COALESCE(p_project_ids, '{}'::text[])))
         ORDER BY s."updatedAt" DESC, s."id" DESC
         LIMIT 2001
    ), matched AS MATERIALIZED (
        -- Every match, on the vector index; read only when the walk did not
        -- reach the bound. Materialised, so no join is planned around it.
        SELECT s."id", s."workItemId", s."commentId", s."lexemes", s."updatedAt"
          FROM public."SearchVector" s
         WHERE s."tenantId" = v_tenant AND s."configName" = 'islestone_bg_en'
           AND s."lexemes" @@ websearch_to_tsquery('islestone_bg_en', p_query)
    ), live AS MATERIALIZED (
        -- The live, visible items, index-only (`WorkItem_search_live_ids`),
        -- hashed once against the matches rather than probed per match.
        SELECT w."id"
          FROM public."WorkItem" w
          JOIN public."Project" p ON p."id" = w."projectId" AND p."tenantId" = w."tenantId"
         WHERE w."tenantId" = v_tenant
           AND w."deletedAt" IS NULL
           AND p."deletedAt" IS NULL AND p."archivedAt" IS NULL
           AND (p_all_projects IS TRUE OR w."projectId" = ANY (COALESCE(p_project_ids, '{}'::text[])))
    ), candidates AS MATERIALIZED (
        -- The walk's matches when they reach the bound (anything outside the
        -- window is older than all of them); otherwise the newest live,
        -- visible matches of every match, one past the bound.
        SELECT k."id", k."workItemId", k."commentId", k."lexemes", k."updatedAt"
          FROM recent k
         WHERE (SELECT count(*) FROM recent) > 2000
        UNION ALL
        SELECT k."id", k."workItemId", k."commentId", k."lexemes", k."updatedAt"
          FROM (
            SELECT s."id", s."workItemId", s."commentId", s."lexemes", s."updatedAt"
              FROM matched s
              JOIN live l ON l."id" = s."workItemId"
             WHERE (s."commentId" IS NULL
                    OR EXISTS (SELECT 1 FROM public."Comment" c
                                WHERE c."id" = s."commentId" AND c."tenantId" = v_tenant AND c."deletedAt" IS NULL))
             ORDER BY s."updatedAt" DESC, s."id" DESC
             LIMIT 2001
          ) k
         WHERE (SELECT count(*) FROM recent) <= 2000
    )
    SELECT /* islestone:search-definer */ m."workItemId", m."commentId", m."rank", m."bounded"
      FROM (
        SELECT DISTINCT ON (r."workItemId") r."workItemId", r."commentId",
               ts_rank(r."lexemes", websearch_to_tsquery('islestone_bg_en', p_query))::double precision AS "rank",
               r."bounded"
          FROM (
            SELECT k."workItemId", k."commentId", k."lexemes",
                   (count(*) OVER ()) > 2000 AS "bounded",
                   row_number() OVER (ORDER BY k."updatedAt" DESC, k."id" DESC) AS "recency"
              FROM candidates k
          ) r
         WHERE r."recency" <= 2000
         ORDER BY r."workItemId", "rank" DESC, (r."commentId" IS NULL) DESC, r."commentId" ASC
      ) m
     ORDER BY m."rank" DESC, m."workItemId" ASC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 1000);
END;
$fn$;

-- ─── 3) Ownership and EXECUTE ─────────────────────────────────────

ALTER FUNCTION search_item_contents(text, boolean, text[], integer) OWNER TO app_search_definer;
REVOKE ALL ON FUNCTION search_item_contents(text, boolean, text[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_item_contents(text, boolean, text[], integer) TO app_user;
