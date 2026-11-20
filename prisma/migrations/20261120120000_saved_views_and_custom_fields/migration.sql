-- Sub-phase 2.4: custom fields and saved views (docs/porting/maps/2.4.md;
-- ADR 0002 §5, §7, §9, §13; ADR 0006).
--
-- 1) Prisma's DDL for the three enums, the four tables and the WorkItem sort
--    column and indexes, with the edits Prisma cannot express: both "sortKey"
--    columns are COLLATE "C" (ADR 0002 §5).
-- 2) Grants, 3) row-level security, 4) the CHECKs and partial uniques of
--    CustomFieldValue, 5) the priority-rank trigger and its back-fill.
-- Each construct has a catalogue test
-- (tests/integration/custom-field-sql-constructs.test.ts).
--
-- The enums are created here with their tables; no existing enum gains a
-- value (tests/guards/migration-enum-isolation.test.ts).

-- ─── 1) Prisma DDL ────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'SELECT', 'MULTI_SELECT', 'DATE', 'PERSON', 'URL', 'CHECKBOX');

-- CreateEnum
CREATE TYPE "ViewLayout" AS ENUM ('LIST', 'BOARD', 'TIMELINE', 'CALENDAR');

-- CreateEnum
CREATE TYPE "SavedViewVisibility" AS ENUM ('PERSONAL', 'SHARED');

-- AlterTable
ALTER TABLE "WorkItem" ADD COLUMN     "priorityRank" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "sortKey" TEXT COLLATE "C" NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldOption" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "sortKey" TEXT COLLATE "C" NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldValue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "fieldType" "CustomFieldType" NOT NULL,
    "textValue" TEXT,
    "numberValue" DECIMAL(15,6),
    "dateValue" DATE,
    "boolValue" BOOLEAN,
    "optionId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" "SavedViewVisibility" NOT NULL,
    "projectId" TEXT,
    "layout" "ViewLayout" NOT NULL DEFAULT 'LIST',
    "configJson" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomField_tenantId_projectId_sortKey_idx" ON "CustomField"("tenantId", "projectId", "sortKey");

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_id_tenantId_key" ON "CustomField"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_id_type_projectId_tenantId_key" ON "CustomField"("id", "type", "projectId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_tenantId_projectId_name_key" ON "CustomField"("tenantId", "projectId", "name");

-- CreateIndex
CREATE INDEX "CustomFieldOption_tenantId_fieldId_sortKey_idx" ON "CustomFieldOption"("tenantId", "fieldId", "sortKey");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldOption_id_tenantId_key" ON "CustomFieldOption"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldOption_id_fieldId_tenantId_key" ON "CustomFieldOption"("id", "fieldId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldOption_tenantId_fieldId_name_key" ON "CustomFieldOption"("tenantId", "fieldId", "name");

-- CreateIndex
CREATE INDEX "CustomFieldValue_tenantId_workItemId_idx" ON "CustomFieldValue"("tenantId", "workItemId");

-- CreateIndex
CREATE INDEX "CustomFieldValue_tenantId_projectId_idx" ON "CustomFieldValue"("tenantId", "projectId");

-- CreateIndex
CREATE INDEX "CustomFieldValue_tenantId_optionId_idx" ON "CustomFieldValue"("tenantId", "optionId");

-- CreateIndex
CREATE INDEX "CustomFieldValue_tenantId_userId_idx" ON "CustomFieldValue"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "CustomFieldValue_tenantId_fieldId_textValue_idx" ON "CustomFieldValue"("tenantId", "fieldId", "textValue");

-- CreateIndex
CREATE INDEX "CustomFieldValue_tenantId_fieldId_numberValue_idx" ON "CustomFieldValue"("tenantId", "fieldId", "numberValue");

-- CreateIndex
CREATE INDEX "CustomFieldValue_tenantId_fieldId_dateValue_idx" ON "CustomFieldValue"("tenantId", "fieldId", "dateValue");

-- CreateIndex
CREATE INDEX "CustomFieldValue_tenantId_fieldId_boolValue_idx" ON "CustomFieldValue"("tenantId", "fieldId", "boolValue");

-- CreateIndex
CREATE INDEX "CustomFieldValue_tenantId_fieldId_optionId_idx" ON "CustomFieldValue"("tenantId", "fieldId", "optionId");

-- CreateIndex
CREATE INDEX "CustomFieldValue_tenantId_fieldId_userId_idx" ON "CustomFieldValue"("tenantId", "fieldId", "userId");

-- CreateIndex
CREATE INDEX "SavedView_tenantId_createdByUserId_projectId_idx" ON "SavedView"("tenantId", "createdByUserId", "projectId");

-- CreateIndex
CREATE INDEX "SavedView_tenantId_visibility_projectId_idx" ON "SavedView"("tenantId", "visibility", "projectId");

-- CreateIndex
CREATE INDEX "SavedView_tenantId_projectId_idx" ON "SavedView"("tenantId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedView_id_tenantId_key" ON "SavedView"("id", "tenantId");

-- CreateIndex
CREATE INDEX "WorkItem_tenantId_projectId_createdAt_id_idx" ON "WorkItem"("tenantId", "projectId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "WorkItem_tenantId_projectId_dueDate_id_idx" ON "WorkItem"("tenantId", "projectId", "dueDate", "id");

-- CreateIndex
CREATE INDEX "WorkItem_tenantId_projectId_priorityRank_id_idx" ON "WorkItem"("tenantId", "projectId", "priorityRank", "id");

-- AddForeignKey
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_projectId_tenantId_fkey" FOREIGN KEY ("projectId", "tenantId") REFERENCES "Project"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldOption" ADD CONSTRAINT "CustomFieldOption_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldOption" ADD CONSTRAINT "CustomFieldOption_fieldId_tenantId_fkey" FOREIGN KEY ("fieldId", "tenantId") REFERENCES "CustomField"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_workItemId_projectId_tenantId_fkey" FOREIGN KEY ("workItemId", "projectId", "tenantId") REFERENCES "WorkItem"("id", "projectId", "tenantId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_fieldId_fieldType_projectId_tenantId_fkey" FOREIGN KEY ("fieldId", "fieldType", "projectId", "tenantId") REFERENCES "CustomField"("id", "type", "projectId", "tenantId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_optionId_fieldId_tenantId_fkey" FOREIGN KEY ("optionId", "fieldId", "tenantId") REFERENCES "CustomFieldOption"("id", "fieldId", "tenantId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "TenantMembership"("tenantId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_projectId_tenantId_fkey" FOREIGN KEY ("projectId", "tenantId") REFERENCES "Project"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── 2) Grants ────────────────────────────────────────────────────
--
-- `app_user` deletes values (a clear), unused options and views; fields are
-- archived by the application and removed only with their project's purge,
-- which runs as `app_user`.
GRANT SELECT, INSERT, UPDATE, DELETE ON "CustomField", "CustomFieldOption", "CustomFieldValue", "SavedView" TO app_user;

-- ─── 3) Canonical RLS on the four tenant tables ───────────────────

ALTER TABLE "CustomField" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomField" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CustomField"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "CustomField"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "CustomField"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "CustomFieldOption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomFieldOption" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CustomFieldOption"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "CustomFieldOption"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "CustomFieldOption"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "CustomFieldValue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomFieldValue" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CustomFieldValue"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "CustomFieldValue"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "CustomFieldValue"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "SavedView" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SavedView" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SavedView"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "SavedView"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "SavedView"
    USING (current_setting('role') != 'app_user');

-- ─── 4) CustomFieldValue: one typed column, capped text, one row ──
--
-- ADR 0002 §7: exactly the column of the field's type is set. A checkbox
-- stores only `true` (unchecked is no row). TEXT and URL values fit a
-- B-tree index (500 characters).
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_one_column" CHECK (
    ("fieldType" IN ('TEXT', 'URL')) = ("textValue" IS NOT NULL)
    AND ("fieldType" = 'NUMBER') = ("numberValue" IS NOT NULL)
    AND ("fieldType" = 'DATE') = ("dateValue" IS NOT NULL)
    AND ("fieldType" = 'CHECKBOX') = ("boolValue" IS NOT NULL)
    AND ("fieldType" IN ('SELECT', 'MULTI_SELECT')) = ("optionId" IS NOT NULL)
    AND ("fieldType" = 'PERSON') = ("userId" IS NOT NULL)
);
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_checkbox_true"
    CHECK ("boolValue" IS NULL OR "boolValue");
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_text_cap"
    CHECK ("textValue" IS NULL OR char_length("textValue") BETWEEN 1 AND 500);

-- One value per item and field; a multi-select holds one row per option.
CREATE UNIQUE INDEX "CustomFieldValue_one_per_item_field"
    ON "CustomFieldValue"("tenantId", "workItemId", "fieldId") WHERE "fieldType" <> 'MULTI_SELECT';
CREATE UNIQUE INDEX "CustomFieldValue_one_per_item_option"
    ON "CustomFieldValue"("tenantId", "workItemId", "fieldId", "optionId") WHERE "fieldType" = 'MULTI_SELECT';

-- ─── 5) WorkItem.priorityRank, written only by a trigger ──────────
--
-- Postgres orders an enum by declaration, so `WorkItemPriority` sorts NONE
-- first; the "urgent first" list sort (docs/pagination.md) reads this rank.
-- The trigger is its only writer: it fires on every insert and on any update
-- of either column, so no write can leave the rank stale.
CREATE OR REPLACE FUNCTION work_item_priority_rank()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW."priorityRank" := CASE NEW."priority"
        WHEN 'URGENT' THEN 1
        WHEN 'HIGH' THEN 2
        WHEN 'MEDIUM' THEN 3
        WHEN 'LOW' THEN 4
        ELSE 5
    END;
    RETURN NEW;
END;
$$;

CREATE TRIGGER work_item_priority_rank
    BEFORE INSERT OR UPDATE OF "priority", "priorityRank" ON "WorkItem"
    FOR EACH ROW EXECUTE FUNCTION work_item_priority_rank();

UPDATE "WorkItem" SET "priorityRank" = CASE "priority"
    WHEN 'URGENT' THEN 1
    WHEN 'HIGH' THEN 2
    WHEN 'MEDIUM' THEN 3
    WHEN 'LOW' THEN 4
    ELSE 5
END;
