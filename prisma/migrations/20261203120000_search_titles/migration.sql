-- Sub-phase 2.7b: search over work-item titles and keys and project names
-- (docs/porting/maps/2.7.md, part 2; ADR 0008 D1 item 1; docs/search.md).
--
-- Titles and project names are plaintext already (ADR 0002 §11), so indexing
-- them adds no exposure. Keys need no new index: a key resolves through the
-- unique `ProjectKeyPrefix (tenantId, prefix)`, `WorkItem (tenantId,
-- projectId, number)` and `WorkItemKeyAlias (tenantId, projectId, number)`.
--
-- ─── Extensions ───────────────────────────────────────────────────
--
-- `pg_trgm` (trigram matching, for `ILIKE '%…%'`) and `btree_gin` (lets a GIN
-- index lead with the scalar `tenantId`, so every index here is tenant-
-- leading). Both are contrib extensions marked trusted since PostgreSQL 13,
-- shipped in the `pgvector/pgvector:0.8.7-pg17-trixie` image that production
-- (deploy/docker-compose.prod.yml), CI's Integration and DAST services and
-- the local docker-compose.yml run. Migrations run as the database's
-- superuser (the one-shot `migrate` service in production, the `islestone`
-- login in CI and locally), as `btree_gist` did in 2.5a; the runtime role
-- (`islestone_app`, a member of `app_user`) never creates an extension. They
-- land in the `public` schema, where the app's `search_path` finds
-- `similarity()` and the operator classes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- ─── Work-item titles ─────────────────────────────────────────────
--
-- Live rows only (`deletedAt IS NULL`): every search and the list's `q`
-- filter carry that predicate, and the Deleted view is capped and ordered
-- by deletion, not searched.
--
-- 1) Trigram: serves the substring semantics of the list's `q` filter
--    (`title ILIKE '%q%'`) and the palette's substring arm.
CREATE INDEX "WorkItem_search_title_trgm" ON "WorkItem"
    USING gin ("tenantId", "title" gin_trgm_ops)
    WHERE "deletedAt" IS NULL;

-- 2) Full text: ranked word matches in the palette, in any order. The
--    `simple` configuration (no stemming) until 2.7f installs the Bulgarian
--    dictionary and replaces this index with an `islestone_bg_en` one
--    (decision 126, ADR 0008 D2). A query must spell the expression exactly,
--    `to_tsvector('simple', "title")`, for the planner to use it.
CREATE INDEX "WorkItem_search_title_fts" ON "WorkItem"
    USING gin ("tenantId", to_tsvector('simple', "title"))
    WHERE "deletedAt" IS NULL;

-- ─── Project names ────────────────────────────────────────────────
CREATE INDEX "Project_search_name_trgm" ON "Project"
    USING gin ("tenantId", "name" gin_trgm_ops)
    WHERE "deletedAt" IS NULL;

CREATE INDEX "Project_search_name_fts" ON "Project"
    USING gin ("tenantId", to_tsvector('simple', "name"))
    WHERE "deletedAt" IS NULL;
