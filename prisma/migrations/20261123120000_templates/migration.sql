-- Sub-phase 2.5c: item and project templates (docs/porting/maps/2.5.md;
-- owner decisions 71 and 73).
--
-- 1) Prisma's DDL for WorkItemTemplate, WorkItemTemplateLabel and
--    ProjectTemplate, with the edit Prisma cannot express: each "sortKey" is
--    COLLATE "C" (ADR 0002 §5).
-- 2) The grants and the canonical RLS policies on the three tables.
-- 3) A CHECK keeping an item template's "dueInDays" between 0 and 3650.
-- Each construct has a catalogue test (tests/integration/templates.test.ts).
--
-- WorkItemTemplate.description and ProjectTemplate.contentJson are encrypted
-- under the workspace key by the application (src/lib/security/encrypted-fields.ts);
-- the database sees ciphertext.

-- ─── 1) Prisma DDL ────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "WorkItemTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "typeId" TEXT,
    "priority" "WorkItemPriority" NOT NULL DEFAULT 'NONE',
    "assigneeId" TEXT,
    "dueInDays" INTEGER,
    "customFieldValuesJson" JSONB,
    "subItemsJson" JSONB,
    "sortKey" TEXT COLLATE "C" NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkItemTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItemTemplateLabel" (
    "tenantId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkItemTemplateLabel_pkey" PRIMARY KEY ("templateId","labelId")
);

-- CreateTable
CREATE TABLE "ProjectTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentJson" TEXT NOT NULL,
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "sortKey" TEXT COLLATE "C" NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkItemTemplate_tenantId_projectId_sortKey_idx" ON "WorkItemTemplate"("tenantId", "projectId", "sortKey");

-- CreateIndex
CREATE INDEX "WorkItemTemplate_tenantId_typeId_idx" ON "WorkItemTemplate"("tenantId", "typeId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemTemplate_id_tenantId_key" ON "WorkItemTemplate"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemTemplate_tenantId_projectId_name_key" ON "WorkItemTemplate"("tenantId", "projectId", "name");

-- CreateIndex
CREATE INDEX "WorkItemTemplateLabel_tenantId_templateId_idx" ON "WorkItemTemplateLabel"("tenantId", "templateId");

-- CreateIndex
CREATE INDEX "WorkItemTemplateLabel_tenantId_labelId_idx" ON "WorkItemTemplateLabel"("tenantId", "labelId");

-- CreateIndex
CREATE INDEX "ProjectTemplate_tenantId_sortKey_idx" ON "ProjectTemplate"("tenantId", "sortKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTemplate_id_tenantId_key" ON "ProjectTemplate"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTemplate_tenantId_name_key" ON "ProjectTemplate"("tenantId", "name");

-- AddForeignKey
ALTER TABLE "WorkItemTemplate" ADD CONSTRAINT "WorkItemTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemTemplate" ADD CONSTRAINT "WorkItemTemplate_projectId_tenantId_fkey" FOREIGN KEY ("projectId", "tenantId") REFERENCES "Project"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemTemplate" ADD CONSTRAINT "WorkItemTemplate_typeId_tenantId_fkey" FOREIGN KEY ("typeId", "tenantId") REFERENCES "WorkItemType"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemTemplateLabel" ADD CONSTRAINT "WorkItemTemplateLabel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemTemplateLabel" ADD CONSTRAINT "WorkItemTemplateLabel_templateId_tenantId_fkey" FOREIGN KEY ("templateId", "tenantId") REFERENCES "WorkItemTemplate"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemTemplateLabel" ADD CONSTRAINT "WorkItemTemplateLabel_labelId_tenantId_fkey" FOREIGN KEY ("labelId", "tenantId") REFERENCES "Label"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTemplate" ADD CONSTRAINT "ProjectTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 2) Grants and canonical RLS ──────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON "WorkItemTemplate" TO app_user;
ALTER TABLE "WorkItemTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkItemTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkItemTemplate"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "WorkItemTemplate"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "WorkItemTemplate"
    USING (current_setting('role') != 'app_user');

GRANT SELECT, INSERT, UPDATE, DELETE ON "WorkItemTemplateLabel" TO app_user;
ALTER TABLE "WorkItemTemplateLabel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkItemTemplateLabel" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkItemTemplateLabel"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "WorkItemTemplateLabel"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "WorkItemTemplateLabel"
    USING (current_setting('role') != 'app_user');

GRANT SELECT, INSERT, UPDATE, DELETE ON "ProjectTemplate" TO app_user;
ALTER TABLE "ProjectTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProjectTemplate"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "ProjectTemplate"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "ProjectTemplate"
    USING (current_setting('role') != 'app_user');

-- ─── 3) CHECK ─────────────────────────────────────────────────────

ALTER TABLE "WorkItemTemplate" ADD CONSTRAINT "WorkItemTemplate_due_in_days_range"
    CHECK ("dueInDays" IS NULL OR ("dueInDays" >= 0 AND "dueInDays" <= 3650));
