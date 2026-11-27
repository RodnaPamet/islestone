-- Sub-phase 4.1a: pages and the tree (docs/porting/maps/4.1.md, "The model
-- (4.1a)"; ADR 0015 §1 to §3; ADR 0006 "Page words of sub-phase 4.1"; owner
-- decisions 341 to 347).
--
--   1. `Page` and `PageContent` (Prisma's DDL), with one hand edit Prisma
--      cannot express: `sortKey` is COLLATE "C" (ADR 0002 §5), and the parent
--      key is NO ACTION DEFERRABLE INITIALLY DEFERRED, as the work-item parent
--      link is (a subtree move or a purge is one transaction).
--   2. A page's parent is in its own tree (decision 341): the deferred
--      constraint trigger `page_same_scope`, checked at commit, refuses a
--      row whose parent's `projectId` differs, and a row whose children's
--      differs (a composite key cannot carry a nullable scope column).
--   3. CHECKs: the title's length (decision 343), `deletedAt` and
--      `deletionId` together, never its own parent.
--   4. The live tree reads (decision 341): two partial indexes, one per kind
--      of tree, each leading with `tenantId`.
--   5. Title search (decision 347's titles): the trigram and full-text GIN
--      indexes over live titles, and `search_page_titles` on decision 245's
--      pattern (SECURITY DEFINER, owned by `app_search_definer`, the
--      workspace from `app.tenant_id`, liveness and visibility in its own
--      WHERE, bounded, ids and ranks only). Page bodies and comments are
--      4.1f's.
--   6. Grants and the canonical RLS. `app_user` holds DELETE on `Page` for
--      the purge alone; `PageContent` rows go with their page's cascade.
--
-- Additive: the previous image reads none of it.

-- ─── 1) Prisma's DDL ──────────────────────────────────────────────

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "parentId" TEXT,
    "sortKey" TEXT COLLATE "C" NOT NULL,
    "title" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "contentUpdatedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,
    "deletionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageContent" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "state" TEXT,
    "contentJson" TEXT,
    "plainText" TEXT,
    "schemaRevision" INTEGER NOT NULL DEFAULT 0,
    "stateBytes" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageContent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Page_tenantId_projectId_parentId_sortKey_idx" ON "Page"("tenantId", "projectId", "parentId", "sortKey");

-- CreateIndex
CREATE INDEX "Page_tenantId_parentId_idx" ON "Page"("tenantId", "parentId");

-- CreateIndex
CREATE INDEX "Page_tenantId_deletionId_idx" ON "Page"("tenantId", "deletionId");

-- CreateIndex
CREATE INDEX "Page_deletedAt_idx" ON "Page"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Page_id_tenantId_key" ON "Page"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_id_projectId_tenantId_key" ON "Page"("id", "projectId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PageContent_pageId_key" ON "PageContent"("pageId");

-- CreateIndex
CREATE INDEX "PageContent_tenantId_idx" ON "PageContent"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PageContent_pageId_tenantId_key" ON "PageContent"("pageId", "tenantId");

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_projectId_tenantId_fkey" FOREIGN KEY ("projectId", "tenantId") REFERENCES "Project"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (hand edit: deferred to commit; Postgres defers only NO ACTION checks)
ALTER TABLE "Page" ADD CONSTRAINT "Page_parentId_tenantId_fkey" FOREIGN KEY ("parentId", "tenantId") REFERENCES "Page"("id", "tenantId") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;

-- AddForeignKey
ALTER TABLE "PageContent" ADD CONSTRAINT "PageContent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageContent" ADD CONSTRAINT "PageContent_pageId_tenantId_fkey" FOREIGN KEY ("pageId", "tenantId") REFERENCES "Page"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 2) A page's parent is in its own tree (decision 341) ─────────

-- Checked at commit, so a move that rewrites a subtree's `projectId` row by
-- row is judged on its result. The usecases check the same under the
-- page-tree lock first; this is the backstop for any other writer.
CREATE FUNCTION page_same_scope() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
    v_row "Page"%ROWTYPE;
    v_parent_project text;
BEGIN
    -- The row as it stands at commit; it may be gone (purged in the same transaction).
    SELECT * INTO v_row FROM "Page" WHERE "id" = NEW."id";
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    IF v_row."parentId" IS NOT NULL THEN
        SELECT "projectId" INTO v_parent_project FROM "Page"
         WHERE "id" = v_row."parentId" AND "tenantId" = v_row."tenantId";
        IF FOUND AND v_parent_project IS DISTINCT FROM v_row."projectId" THEN
            RAISE EXCEPTION 'PAGE_SCOPE: page % is not in its parent''s tree', v_row."id";
        END IF;
    END IF;
    IF EXISTS (
        SELECT 1 FROM "Page" c
         WHERE c."parentId" = v_row."id" AND c."tenantId" = v_row."tenantId"
           AND c."projectId" IS DISTINCT FROM v_row."projectId"
    ) THEN
        RAISE EXCEPTION 'PAGE_SCOPE: a page below % is not in its tree', v_row."id";
    END IF;
    RETURN NULL;
END;
$fn$;

CREATE CONSTRAINT TRIGGER page_same_scope
    AFTER INSERT OR UPDATE OF "parentId", "projectId" ON "Page"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION page_same_scope();

-- ─── 3) CHECKs ────────────────────────────────────────────────────

ALTER TABLE "Page" ADD CONSTRAINT "Page_title_length"
    CHECK (char_length("title") BETWEEN 1 AND 200);
-- One group per delete: both or neither.
ALTER TABLE "Page" ADD CONSTRAINT "Page_deletion_group"
    CHECK (("deletedAt" IS NULL) = ("deletionId" IS NULL));
ALTER TABLE "Page" ADD CONSTRAINT "Page_not_own_parent"
    CHECK ("parentId" IS NULL OR "parentId" <> "id");
ALTER TABLE "PageContent" ADD CONSTRAINT "PageContent_sizes"
    CHECK ("schemaRevision" >= 0 AND "stateBytes" >= 0);

-- ─── 4) The live tree reads (decision 341) ────────────────────────
--
-- Children of one parent in one tree, in order. Prisma cannot declare a
-- partial index; the drift check ignores them; `tests/integration/pages.test.ts`
-- checks the catalogue.
CREATE INDEX "Page_live_project_tree" ON "Page" ("tenantId", "projectId", "parentId", "sortKey")
    WHERE "deletedAt" IS NULL AND "projectId" IS NOT NULL;
CREATE INDEX "Page_live_workspace_tree" ON "Page" ("tenantId", "parentId", "sortKey")
    WHERE "deletedAt" IS NULL AND "projectId" IS NULL;

-- ─── 5) Title search (decision 347's titles) ──────────────────────
--
-- A query must spell the expression exactly. Every to_tsvector names the
-- workspace's one configuration as a literal (2.7f).
CREATE INDEX "Page_search_title_trgm" ON "Page" USING gin ("tenantId", "title" gin_trgm_ops)
    WHERE "deletedAt" IS NULL;
CREATE INDEX "Page_search_title_fts" ON "Page" USING gin ("tenantId", to_tsvector('islestone_bg_en', "title"))
    WHERE "deletedAt" IS NULL;

-- Exactly the columns `search_page_titles` reads; never a page's content.
GRANT SELECT ("id", "tenantId", "projectId", "title", "deletedAt") ON "Page" TO app_search_definer;

-- `PageRepository.searchTitleIds`: a live page whose title holds the query
-- (`Page_search_title_trgm`) or all its words (`Page_search_title_fts`), in a
-- tree the caller reads: a workspace page (the caller holds `pages.view`,
-- asked before the call), or a page of a live, unarchived project in the
-- visibility input, as the item search reads projects; ordered so the best
-- candidates make the cut (an exact title, a prefix, the full-text rank, the
-- trigram similarity, then the id).
CREATE FUNCTION search_page_titles(
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
        SELECT g."id",
               row_number() OVER (
                   ORDER BY (lower(g."title") = lower(p_query)) DESC,
                            (g."title" ILIKE p_prefix) DESC,
                            ts_rank(to_tsvector('islestone_bg_en', g."title"), plainto_tsquery('islestone_bg_en', p_query)) DESC,
                            public.similarity(g."title", p_query) DESC,
                            g."id" ASC
               ) AS "ordinal"
          FROM public."Page" g
          LEFT JOIN public."Project" p ON p."id" = g."projectId" AND p."tenantId" = g."tenantId"
         WHERE g."tenantId" = v_tenant
           AND g."deletedAt" IS NULL
           AND (g."projectId" IS NULL OR (p."deletedAt" IS NULL AND p."archivedAt" IS NULL AND (p_all_projects IS TRUE OR g."projectId" = ANY (COALESCE(p_project_ids, '{}'::text[])))))
           AND (g."title" ILIKE p_contains
                OR to_tsvector('islestone_bg_en', g."title") @@ plainto_tsquery('islestone_bg_en', p_query))
      ) m
     ORDER BY m."ordinal"
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 100);
END;
$fn$;

ALTER FUNCTION search_page_titles(text, text, text, boolean, text[], integer) OWNER TO app_search_definer;
REVOKE ALL ON FUNCTION search_page_titles(text, text, text, boolean, text[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_page_titles(text, text, text, boolean, text[], integer) TO app_user;

-- ─── 6) Grants and canonical RLS ──────────────────────────────────

-- DELETE on Page: the purge alone (decision 344); the usecases soft-delete.
-- PageContent: SELECT, INSERT and UPDATE; its rows go with their page.
GRANT SELECT, INSERT, UPDATE, DELETE ON "Page" TO app_user;
GRANT SELECT, INSERT, UPDATE ON "PageContent" TO app_user;
-- The schema's default privileges grant DELETE on every new table; take it back.
REVOKE DELETE, TRUNCATE ON "PageContent" FROM app_user;

ALTER TABLE "Page" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Page" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Page"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "Page"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "Page"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "PageContent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PageContent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PageContent"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "PageContent"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "PageContent"
    USING (current_setting('role') != 'app_user');
