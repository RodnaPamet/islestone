-- Sub-phase 2.7e: recipient lists (docs/porting/maps/2.7.md, part 6;
-- owner decisions 79 and 138 to 142; ADR 0006 "Recipient list").
--
--   1. `RecipientList`: a workspace list (`projectId` NULL) or one project's;
--      `RecipientListMember`: its people, each a tenant member (the
--      membership FK cascades, so a removed member leaves every list).
--   2. `ProjectIntake.recipientListId`: the one list a project's intake may
--      name beside its notify list's member rows (decision 142). A cascade
--      that removes the list leaves the intake and clears the pointer only.
--   3. What Prisma cannot declare: one name per scope (two partial uniques,
--      archived lists included, so a restore never collides) and the length
--      CHECKs.
--   4. Grants and the canonical RLS. Lists are archived and restored, never
--      deleted (decision 141): `app_user` holds no DELETE on them. Members
--      are replaced and removed, so `app_user` holds DELETE on members.
--
-- Nothing here touches a table the previous image writes in a way it would
-- refuse: `ProjectIntake` gains a nullable column it never names.

-- ─── 1) Prisma's DDL ──────────────────────────────────────────────

-- CreateTable
CREATE TABLE "RecipientList" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipientList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipientListMember" (
    "tenantId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecipientListMember_pkey" PRIMARY KEY ("listId","userId")
);

-- CreateIndex
CREATE INDEX "RecipientList_tenantId_projectId_archivedAt_idx" ON "RecipientList"("tenantId", "projectId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecipientList_id_tenantId_key" ON "RecipientList"("id", "tenantId");

-- CreateIndex
CREATE INDEX "RecipientListMember_tenantId_listId_idx" ON "RecipientListMember"("tenantId", "listId");

-- CreateIndex
CREATE INDEX "RecipientListMember_tenantId_userId_idx" ON "RecipientListMember"("tenantId", "userId");

-- AddForeignKey
ALTER TABLE "RecipientList" ADD CONSTRAINT "RecipientList_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipientList" ADD CONSTRAINT "RecipientList_projectId_tenantId_fkey" FOREIGN KEY ("projectId", "tenantId") REFERENCES "Project"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipientListMember" ADD CONSTRAINT "RecipientListMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipientListMember" ADD CONSTRAINT "RecipientListMember_listId_tenantId_fkey" FOREIGN KEY ("listId", "tenantId") REFERENCES "RecipientList"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- A removed member leaves every list with the membership.
ALTER TABLE "RecipientListMember" ADD CONSTRAINT "RecipientListMember_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "TenantMembership"("tenantId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 2) The intake's list ─────────────────────────────────────────

-- AlterTable
ALTER TABLE "ProjectIntake" ADD COLUMN "recipientListId" TEXT;

-- CreateIndex
CREATE INDEX "ProjectIntake_tenantId_recipientListId_idx" ON "ProjectIntake"("tenantId", "recipientListId");

-- Only the list column is cleared: `tenantId` is NOT NULL and keeps its value.
ALTER TABLE "ProjectIntake" ADD CONSTRAINT "ProjectIntake_recipientListId_tenantId_fkey" FOREIGN KEY ("recipientListId", "tenantId") REFERENCES "RecipientList"("id", "tenantId") ON DELETE SET NULL ("recipientListId") ON UPDATE NO ACTION;

-- ─── 3) One name per scope; lengths ───────────────────────────────

CREATE UNIQUE INDEX "RecipientList_workspace_name"
    ON "RecipientList" ("tenantId", "name") WHERE "projectId" IS NULL;
CREATE UNIQUE INDEX "RecipientList_project_name"
    ON "RecipientList" ("tenantId", "projectId", "name") WHERE "projectId" IS NOT NULL;

ALTER TABLE "RecipientList" ADD CONSTRAINT "RecipientList_name_length"
    CHECK (char_length("name") BETWEEN 1 AND 80);
ALTER TABLE "RecipientList" ADD CONSTRAINT "RecipientList_description_length"
    CHECK ("description" IS NULL OR char_length("description") <= 500);

-- ─── 4) Grants and canonical RLS ──────────────────────────────────

-- No DELETE: a list is archived and restored, never deleted (decision 141).
-- The REVOKE is explicit because the database's default privileges grant
-- DELETE on every new table (20261119120000_tenancy_core).
GRANT SELECT, INSERT, UPDATE ON "RecipientList" TO app_user;
REVOKE DELETE, TRUNCATE ON "RecipientList" FROM app_user;
-- DELETE: setting a list's members removes the rows of the people it drops.
GRANT SELECT, INSERT, UPDATE, DELETE ON "RecipientListMember" TO app_user;

ALTER TABLE "RecipientList" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecipientList" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RecipientList"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "RecipientList"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "RecipientList"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "RecipientListMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecipientListMember" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RecipientListMember"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "RecipientListMember"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "RecipientListMember"
    USING (current_setting('role') != 'app_user');
