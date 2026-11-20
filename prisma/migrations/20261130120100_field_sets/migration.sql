-- Sub-phase 2.4b-b: field sets (docs/porting/maps/2.4b.md; ADR 0002 §1 and
-- §7; owner decisions 101 and 108 to 112).
--
-- 1) Prisma's DDL for FieldRequirement, WorkItemTypeField and the
--    CustomField unique its composite FK targets.
-- 2) What Prisma cannot declare: the CHECKs and the two partial uniques.
-- 3) The grant and the canonical RLS.

-- ─── 1) Prisma's DDL ──────────────────────────────────────────────
CREATE TYPE "FieldRequirement" AS ENUM ('REQUIRED', 'OPTIONAL', 'HIDDEN');

CREATE TABLE "WorkItemTypeField" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "projectId" TEXT,
    "builtInField" TEXT,
    "customFieldId" TEXT,
    "requirement" "FieldRequirement" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkItemTypeField_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkItemTypeField_tenantId_typeId_idx" ON "WorkItemTypeField"("tenantId", "typeId");

CREATE INDEX "WorkItemTypeField_tenantId_projectId_typeId_idx" ON "WorkItemTypeField"("tenantId", "projectId", "typeId");

CREATE INDEX "WorkItemTypeField_tenantId_customFieldId_idx" ON "WorkItemTypeField"("tenantId", "customFieldId");

CREATE UNIQUE INDEX "CustomField_id_projectId_tenantId_key" ON "CustomField"("id", "projectId", "tenantId");

ALTER TABLE "WorkItemTypeField" ADD CONSTRAINT "WorkItemTypeField_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkItemTypeField" ADD CONSTRAINT "WorkItemTypeField_typeId_tenantId_fkey" FOREIGN KEY ("typeId", "tenantId") REFERENCES "WorkItemType"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkItemTypeField" ADD CONSTRAINT "WorkItemTypeField_projectId_tenantId_fkey" FOREIGN KEY ("projectId", "tenantId") REFERENCES "Project"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkItemTypeField" ADD CONSTRAINT "WorkItemTypeField_customFieldId_projectId_tenantId_fkey" FOREIGN KEY ("customFieldId", "projectId", "tenantId") REFERENCES "CustomField"("id", "projectId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 2) The CHECKs and the partial uniques ────────────────────────
--
-- A rule names exactly one field: a built-in one (workspace-wide, no
-- project) or a custom one (in its project). The built-in names are
-- CONFIGURABLE_BUILT_IN_FIELDS (src/lib/work-items/field-sets.ts); a later
-- field (3.4's estimate) widens this CHECK in its own migration. The answer
-- is shown or hidden, never required (decision 110).
ALTER TABLE "WorkItemTypeField" ADD CONSTRAINT "WorkItemTypeField_one_field"
    CHECK (("builtInField" IS NULL) <> ("customFieldId" IS NULL));
ALTER TABLE "WorkItemTypeField" ADD CONSTRAINT "WorkItemTypeField_scope"
    CHECK (("builtInField" IS NOT NULL AND "projectId" IS NULL) OR ("customFieldId" IS NOT NULL AND "projectId" IS NOT NULL));
ALTER TABLE "WorkItemTypeField" ADD CONSTRAINT "WorkItemTypeField_built_in_known"
    CHECK ("builtInField" IS NULL OR "builtInField" IN
        ('description', 'assignee', 'waitingOn', 'priority', 'labels', 'startDate', 'dueDate', 'cycle', 'milestone', 'answer'));
ALTER TABLE "WorkItemTypeField" ADD CONSTRAINT "WorkItemTypeField_answer_never_required"
    CHECK (NOT ("builtInField" = 'answer' AND "requirement" = 'REQUIRED'));

-- One rule per type and field.
CREATE UNIQUE INDEX "WorkItemTypeField_one_built_in_rule"
    ON "WorkItemTypeField" ("tenantId", "typeId", "builtInField") WHERE "builtInField" IS NOT NULL;
CREATE UNIQUE INDEX "WorkItemTypeField_one_custom_rule"
    ON "WorkItemTypeField" ("tenantId", "typeId", "customFieldId") WHERE "customFieldId" IS NOT NULL;

-- ─── 3) Grant and canonical RLS ───────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON "WorkItemTypeField" TO app_user;

ALTER TABLE "WorkItemTypeField" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkItemTypeField" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkItemTypeField"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "WorkItemTypeField"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "WorkItemTypeField"
    USING (current_setting('role') != 'app_user');
