-- Sub-phase 2.7f: the stored search vectors of work-item descriptions and
-- comments (docs/porting/maps/2.7.md, part 3; ADR 0008 D1, option C; owner
-- decision 124; docs/search.md).
--
-- `SearchVector.lexemes` is a PLAINTEXT derivative of two encrypted fields
-- (`WorkItem.description`, `Comment.body`): the stemmed words of the text,
-- with positions. Owner decision 124 accepts that these words are readable in
-- the database, its dumps and the off-host backups. Nothing else is indexed
-- (ADR 0008, "What is excluded, entirely").
--
--   1. Prisma's DDL (the table, its FKs, the tenant-leading btree index).
--   2. What Prisma cannot declare: one row per source (two partial uniques)
--      and the tenant-leading GIN index over the vector (`btree_gin`, created
--      in 20261203120000_search_titles).
--   3. Grants and the canonical RLS.
--
-- Rows are written only by `SearchVectorRepository` (the usecases, in the
-- transaction that writes the text) and the `search-index-rebuild` job; the
-- item, the comment and the workspace cascade, so the purge, a comment's hard
-- delete and a workspace's purge take the vectors with the text.

-- ─── 1) Prisma's DDL ──────────────────────────────────────────────

-- CreateTable
CREATE TABLE "SearchVector" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "commentId" TEXT,
    "lexemes" tsvector NOT NULL,
    "configName" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchVector_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SearchVector_tenantId_workItemId_idx" ON "SearchVector"("tenantId", "workItemId");

-- CreateIndex
CREATE INDEX "SearchVector_tenantId_commentId_idx" ON "SearchVector"("tenantId", "commentId");

-- CreateIndex
CREATE INDEX "SearchVector_tenantId_revision_idx" ON "SearchVector"("tenantId", "revision");

-- AddForeignKey
ALTER TABLE "SearchVector" ADD CONSTRAINT "SearchVector_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchVector" ADD CONSTRAINT "SearchVector_workItemId_tenantId_fkey" FOREIGN KEY ("workItemId", "tenantId") REFERENCES "WorkItem"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- A comment's vector goes with it (the purge's hard delete); a soft delete
-- removes it in the usecase. A description row (NULL `commentId`) is not
-- checked by this key (MATCH SIMPLE).
ALTER TABLE "SearchVector" ADD CONSTRAINT "SearchVector_commentId_workItemId_tenantId_fkey" FOREIGN KEY ("commentId", "workItemId", "tenantId") REFERENCES "Comment"("id", "workItemId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 2) One row per source; the vector index ──────────────────────

CREATE UNIQUE INDEX "SearchVector_one_per_description"
    ON "SearchVector" ("tenantId", "workItemId") WHERE "commentId" IS NULL;
CREATE UNIQUE INDEX "SearchVector_one_per_comment"
    ON "SearchVector" ("tenantId", "commentId") WHERE "commentId" IS NOT NULL;

-- The match: tenant-leading (`btree_gin` lets a GIN index lead with the
-- scalar), and partial on the configuration, which every match names
-- (`"configName" = 'islestone_bg_en'`, SearchVectorRepository): a vector is
-- only comparable with a query parsed by the configuration that built it.
-- Prisma cannot declare a GIN index that leads with a text column, so it
-- lives here; the drift check ignores partial indexes.
CREATE INDEX "SearchVector_search_lexemes" ON "SearchVector"
    USING gin ("tenantId", "lexemes")
    WHERE "configName" = 'islestone_bg_en';

-- The configuration a row was built with is the one every query names; a
-- row built with any other is refused rather than silently mis-stemmed.
ALTER TABLE "SearchVector" ADD CONSTRAINT "SearchVector_config_name"
    CHECK ("configName" = 'islestone_bg_en');
ALTER TABLE "SearchVector" ADD CONSTRAINT "SearchVector_revision_positive"
    CHECK ("revision" >= 1);

-- ─── 3) Grants and canonical RLS ──────────────────────────────────

-- UPDATE: an edit replaces its row (`INSERT … ON CONFLICT DO UPDATE`).
-- DELETE: a cleared description and a deleted comment remove theirs.
GRANT SELECT, INSERT, UPDATE, DELETE ON "SearchVector" TO app_user;

ALTER TABLE "SearchVector" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SearchVector" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SearchVector"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "SearchVector"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "SearchVector"
    USING (current_setting('role') != 'app_user');
