-- Owner decision 245 (issue #78; docs/porting/maps/H2.md, "Finding F1,
-- decided"; docs/search.md, "The search functions"; docs/rls-tenant-isolation.md,
-- "The search functions: a named exception").
--
-- Under row-level security a full-text (`@@`), `ILIKE` or trigram condition
-- cannot be an index condition: those operators are not LEAKPROOF, so the
-- planner must apply the policy's qual first, and every search read the
-- workspace's whole entry of its tenant-leading GIN index and filtered it
-- (H2a's finding F1, docs/performance.md). Nothing here marks an operator or a
-- function LEAKPROOF, and nothing changes a table's row-level security.
--
-- Instead each search read is one SECURITY DEFINER function:
--
--   - owned by `app_search_definer`, a role created here that cannot log in,
--     is not a superuser, inherits nothing, is a member of nothing and has no
--     members, holds SELECT on exactly the columns the functions read and
--     nothing else, and is BYPASSRLS, so the planner applies no policy qual
--     inside the function and may use the GIN index with its operator;
--   - reading the workspace from `app.tenant_id` (the setting every policy
--     reads, bound by `runInTenantContext`), NEVER from an argument; a call
--     without it set returns no rows, as the policies return none;
--   - filtering the workspace, `deletedAt` (the item's, and a comment's) and
--     project visibility itself, in its own WHERE, with the input
--     `projectVisibilitySql` took (every live project, or the granted ids);
--   - bounded by a LIMIT parameter clamped to a hard cap in the body;
--   - returning ids and the candidate order or rank only, never text: the
--     caller reads the rows it shows by id, under row-level security, as
--     before;
--   - with a fixed `search_path` (pg_catalog first, pg_temp last) and every
--     table named with its schema, so nothing a caller creates can shadow
--     what the function reads;
--   - executable by `app_user` alone (EXECUTE revoked from PUBLIC).
--
-- `tests/integration/search-definer.test.ts` pins every part against the
-- catalogue and each body against this file (the tenant, `deletedAt` and
-- visibility predicates, the bound, no tenant argument);
-- `tests/guards/search-definer-functions.test.ts` pins each body's hash, so a
-- change to what a definer function reads is a reviewed diff.
--
-- Additive: the previous image does not call them.

-- ─── 1) The owner ─────────────────────────────────────────────────

-- Roles are per cluster: another database on the same server may have made it.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_search_definer') THEN
        CREATE ROLE app_search_definer NOLOGIN;
    END IF;
END
$$;
-- Converge the attributes whoever made it.
ALTER ROLE app_search_definer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS CONNECTION LIMIT 0;

GRANT USAGE ON SCHEMA public TO app_search_definer;
-- Exactly the columns the functions read; never a description, a comment's
-- body or anything else.
GRANT SELECT ("id", "tenantId", "projectId", "title", "deletedAt") ON "WorkItem" TO app_search_definer;
GRANT SELECT ("id", "tenantId", "name", "keyPrefix", "deletedAt", "archivedAt") ON "Project" TO app_search_definer;
GRANT SELECT ("id", "tenantId", "deletedAt") ON "Comment" TO app_search_definer;
GRANT SELECT ("tenantId", "workItemId", "commentId", "lexemes", "configName") ON "SearchVector" TO app_search_definer;

-- ─── 2) The liveness the functions check, index-only ──────────────
--
-- A description or comment match is live only when its item, and its
-- comment, are. For a broad query that is a large share of the workspace, so
-- the checks read these two narrow partial indexes (index-only: the live ids,
-- and an item's project) instead of the tables' rows. Prisma cannot declare a
-- partial index; the drift check ignores them.
CREATE INDEX "WorkItem_search_live_ids" ON "WorkItem" ("tenantId", "id") INCLUDE ("projectId") WHERE "deletedAt" IS NULL;
CREATE INDEX "Comment_search_live_ids" ON "Comment" ("tenantId", "id") WHERE "deletedAt" IS NULL;

-- ─── 3) Work-item titles and keys: the command palette ────────────
--
-- `WorkItemRepository.searchTitleIds`. A title holding the query (trigram,
-- `WorkItem_search_title_trgm`) or all its words (`WorkItem_search_title_fts`),
-- plus the item a typed key resolved to; ordered so the best candidates make
-- the cut (the key hit, an exact title, a prefix, the full-text rank, the
-- trigram similarity, then the id). `p_contains` and `p_prefix` are the
-- escaped patterns of `containsPattern` and `prefixPattern`.
CREATE FUNCTION search_work_item_titles(
    p_query text,
    p_contains text,
    p_prefix text,
    p_key_hit_id text,
    p_all_projects boolean,
    p_project_ids text[],
    p_limit integer
)
RETURNS TABLE ("id" text, "ordinal" integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
    v_tenant text := NULLIF(current_setting('app.tenant_id', true), '');
BEGIN
    IF v_tenant IS NULL THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT /* islestone:search-definer */ m."id", m."ordinal"::integer
      FROM (
        SELECT w."id",
               row_number() OVER (
                   ORDER BY (w."id" = p_key_hit_id) IS TRUE DESC,
                            (lower(w."title") = lower(p_query)) DESC,
                            (w."title" ILIKE p_prefix) DESC,
                            ts_rank(to_tsvector('islestone_bg_en', w."title"), plainto_tsquery('islestone_bg_en', p_query)) DESC,
                            public.similarity(w."title", p_query) DESC,
                            w."id" ASC
               ) AS "ordinal"
          FROM public."WorkItem" w
          JOIN public."Project" p ON p."id" = w."projectId" AND p."tenantId" = w."tenantId"
         WHERE w."tenantId" = v_tenant
           AND w."deletedAt" IS NULL
           AND p."deletedAt" IS NULL AND p."archivedAt" IS NULL
           AND (p_all_projects IS TRUE OR w."projectId" = ANY (COALESCE(p_project_ids, '{}'::text[])))
           AND (w."title" ILIKE p_contains
                OR to_tsvector('islestone_bg_en', w."title") @@ plainto_tsquery('islestone_bg_en', p_query)
                OR w."id" = p_key_hit_id)
      ) m
     ORDER BY m."ordinal"
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 100);
END;
$fn$;

-- ─── 4) Work-item titles, stemmed: the list's `q` ─────────────────
--
-- `WorkItemRepository.titleFullTextIds`: titles matching the query in full
-- text (`websearch_to_tsquery`), `WorkItem_search_title_fts`.
CREATE FUNCTION search_work_item_title_words(
    p_query text,
    p_all_projects boolean,
    p_project_ids text[],
    p_limit integer
)
RETURNS TABLE ("id" text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
    v_tenant text := NULLIF(current_setting('app.tenant_id', true), '');
BEGIN
    IF v_tenant IS NULL THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT /* islestone:search-definer */ w."id"
      FROM public."WorkItem" w
      JOIN public."Project" p ON p."id" = w."projectId" AND p."tenantId" = w."tenantId"
     WHERE w."tenantId" = v_tenant
       AND w."deletedAt" IS NULL
       AND p."deletedAt" IS NULL AND p."archivedAt" IS NULL
       AND (p_all_projects IS TRUE OR w."projectId" = ANY (COALESCE(p_project_ids, '{}'::text[])))
       AND to_tsvector('islestone_bg_en', w."title") @@ websearch_to_tsquery('islestone_bg_en', p_query)
     ORDER BY w."id" ASC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 1000);
END;
$fn$;

-- ─── 5) Work-item titles, substring: the list's `q` ───────────────
--
-- `WorkItemRepository.titleSubstringIds`: titles holding the escaped pattern
-- (`WorkItem_search_title_trgm`). A set, not an order: the caller uses the
-- ids only when fewer than the cap came back, and otherwise filters the list
-- by the pattern itself (docs/search.md, "The list's q filter").
CREATE FUNCTION search_work_item_title_substring(
    p_contains text,
    p_all_projects boolean,
    p_project_ids text[],
    p_limit integer
)
RETURNS TABLE ("id" text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
    v_tenant text := NULLIF(current_setting('app.tenant_id', true), '');
BEGIN
    IF v_tenant IS NULL THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT /* islestone:search-definer */ w."id"
      FROM public."WorkItem" w
      JOIN public."Project" p ON p."id" = w."projectId" AND p."tenantId" = w."tenantId"
     WHERE w."tenantId" = v_tenant
       AND w."deletedAt" IS NULL
       AND p."deletedAt" IS NULL AND p."archivedAt" IS NULL
       AND (p_all_projects IS TRUE OR w."projectId" = ANY (COALESCE(p_project_ids, '{}'::text[])))
       AND w."title" ILIKE p_contains
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 1000);
END;
$fn$;

-- ─── 6) Project names and key prefixes: the command palette ───────
--
-- `ProjectRepository.searchNameIds`: a name holding the query
-- (`Project_search_name_trgm`) or all its words (`Project_search_name_fts`),
-- or a key prefix equal to it; ordered as the palette ranks candidates.
CREATE FUNCTION search_project_names(
    p_query text,
    p_contains text,
    p_prefix text,
    p_all_projects boolean,
    p_project_ids text[],
    p_limit integer
)
RETURNS TABLE ("id" text, "ordinal" integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
    v_tenant text := NULLIF(current_setting('app.tenant_id', true), '');
BEGIN
    IF v_tenant IS NULL THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT /* islestone:search-definer */ m."id", m."ordinal"::integer
      FROM (
        SELECT p."id",
               row_number() OVER (
                   ORDER BY (p."keyPrefix" = upper(p_query)) DESC,
                            (lower(p."name") = lower(p_query)) DESC,
                            (p."name" ILIKE p_prefix) DESC,
                            ts_rank(to_tsvector('islestone_bg_en', p."name"), plainto_tsquery('islestone_bg_en', p_query)) DESC,
                            public.similarity(p."name", p_query) DESC,
                            p."id" ASC
               ) AS "ordinal"
          FROM public."Project" p
         WHERE p."tenantId" = v_tenant
           AND p."deletedAt" IS NULL AND p."archivedAt" IS NULL
           AND (p_all_projects IS TRUE OR p."id" = ANY (COALESCE(p_project_ids, '{}'::text[])))
           AND (p."name" ILIKE p_contains
                OR to_tsvector('islestone_bg_en', p."name") @@ plainto_tsquery('islestone_bg_en', p_query)
                OR p."keyPrefix" = upper(p_query))
      ) m
     ORDER BY m."ordinal"
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 100);
END;
$fn$;

-- ─── 7) Descriptions and comments ─────────────────────────────────
--
-- `SearchVectorRepository.matchItems`: the live, visible items whose
-- description or a live comment matches the query (`websearch_to_tsquery`,
-- `SearchVector_search_lexemes`), each once with its best source, best first.
-- `SearchVectorRepository` is the only module that calls it
-- (`tests/guards/search-vector-write-seam.test.ts`).
CREATE FUNCTION search_item_contents(
    p_query text,
    p_all_projects boolean,
    p_project_ids text[],
    p_limit integer
)
RETURNS TABLE ("workItemId" text, "commentId" text, "rank" double precision)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
    v_tenant text := NULLIF(current_setting('app.tenant_id', true), '');
BEGIN
    IF v_tenant IS NULL THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT /* islestone:search-definer */ m."workItemId", m."commentId", m."rank"
      FROM (
        SELECT DISTINCT ON (s."workItemId") s."workItemId", s."commentId",
               ts_rank(s."lexemes", websearch_to_tsquery('islestone_bg_en', p_query))::double precision AS "rank"
          FROM public."SearchVector" s
          JOIN public."WorkItem" w ON w."id" = s."workItemId" AND w."tenantId" = s."tenantId"
          JOIN public."Project" p ON p."id" = w."projectId" AND p."tenantId" = w."tenantId"
         WHERE s."tenantId" = v_tenant
           AND s."configName" = 'islestone_bg_en'
           AND s."lexemes" @@ websearch_to_tsquery('islestone_bg_en', p_query)
           AND w."deletedAt" IS NULL
           AND (s."commentId" IS NULL
                OR EXISTS (SELECT 1 FROM public."Comment" c
                            WHERE c."id" = s."commentId" AND c."tenantId" = v_tenant AND c."deletedAt" IS NULL))
           AND p."deletedAt" IS NULL AND p."archivedAt" IS NULL
           AND (p_all_projects IS TRUE OR w."projectId" = ANY (COALESCE(p_project_ids, '{}'::text[])))
         ORDER BY s."workItemId", "rank" DESC, (s."commentId" IS NULL) DESC, s."commentId" ASC
      ) m
     ORDER BY m."rank" DESC, m."workItemId" ASC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 1000);
END;
$fn$;

-- ─── 8) Ownership and EXECUTE ─────────────────────────────────────

ALTER FUNCTION search_work_item_titles(text, text, text, text, boolean, text[], integer) OWNER TO app_search_definer;
ALTER FUNCTION search_work_item_title_words(text, boolean, text[], integer) OWNER TO app_search_definer;
ALTER FUNCTION search_work_item_title_substring(text, boolean, text[], integer) OWNER TO app_search_definer;
ALTER FUNCTION search_project_names(text, text, text, boolean, text[], integer) OWNER TO app_search_definer;
ALTER FUNCTION search_item_contents(text, boolean, text[], integer) OWNER TO app_search_definer;

REVOKE ALL ON FUNCTION search_work_item_titles(text, text, text, text, boolean, text[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION search_work_item_title_words(text, boolean, text[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION search_work_item_title_substring(text, boolean, text[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION search_project_names(text, text, text, boolean, text[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION search_item_contents(text, boolean, text[], integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION search_work_item_titles(text, text, text, text, boolean, text[], integer) TO app_user;
GRANT EXECUTE ON FUNCTION search_work_item_title_words(text, boolean, text[], integer) TO app_user;
GRANT EXECUTE ON FUNCTION search_work_item_title_substring(text, boolean, text[], integer) TO app_user;
GRANT EXECUTE ON FUNCTION search_project_names(text, text, text, boolean, text[], integer) TO app_user;
GRANT EXECUTE ON FUNCTION search_item_contents(text, boolean, text[], integer) TO app_user;
