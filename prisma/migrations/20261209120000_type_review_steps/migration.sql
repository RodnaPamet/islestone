-- Sub-phase 2.8c: default review steps per work item type, and the per-type
-- Done check (docs/porting/maps/2.8.md, part 3; ADR 0009 §14 and §15; owner
-- decisions 149 and 159; docs/work-items.md, "Reviews (2.8c)").
--
--   1. Prisma's DDL: `WorkItemType.reviewRequiredForDone` and two tenant
--      tables, the type's default steps and whom each names.
--   2. What Prisma cannot declare: the CHECKs on the step's text and days,
--      and "exactly one of a member or a list" on a default reviewer.
--   3. Grants and the canonical RLS. A type's defaults are replaced as a
--      whole, so `app_user` holds DELETE on both tables.
--
-- Nothing here touches a table the previous image writes in a way it would
-- refuse: the column has a default the previous image never reads, and the
-- new tables are this image's own.

-- ─── 1) Prisma's DDL ─────────────────────────────────────────────

-- AlterTable
ALTER TABLE "WorkItemType" ADD COLUMN     "reviewRequiredForDone" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WorkItemTypeReviewStep" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "ReviewStepMode" NOT NULL DEFAULT 'ALL',
    "dueInWorkingDays" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkItemTypeReviewStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItemTypeReviewStepReviewer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "userId" TEXT,
    "recipientListId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkItemTypeReviewStepReviewer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkItemTypeReviewStep_tenantId_typeId_idx" ON "WorkItemTypeReviewStep"("tenantId", "typeId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemTypeReviewStep_id_tenantId_key" ON "WorkItemTypeReviewStep"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemTypeReviewStep_typeId_position_key" ON "WorkItemTypeReviewStep"("typeId", "position");

-- CreateIndex
CREATE INDEX "WorkItemTypeReviewStepReviewer_tenantId_stepId_idx" ON "WorkItemTypeReviewStepReviewer"("tenantId", "stepId");

-- CreateIndex
CREATE INDEX "WorkItemTypeReviewStepReviewer_tenantId_userId_idx" ON "WorkItemTypeReviewStepReviewer"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "WorkItemTypeReviewStepReviewer_tenantId_recipientListId_idx" ON "WorkItemTypeReviewStepReviewer"("tenantId", "recipientListId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemTypeReviewStepReviewer_stepId_userId_key" ON "WorkItemTypeReviewStepReviewer"("stepId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemTypeReviewStepReviewer_stepId_recipientListId_key" ON "WorkItemTypeReviewStepReviewer"("stepId", "recipientListId");

-- AddForeignKey
ALTER TABLE "WorkItemTypeReviewStep" ADD CONSTRAINT "WorkItemTypeReviewStep_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemTypeReviewStep" ADD CONSTRAINT "WorkItemTypeReviewStep_typeId_tenantId_fkey" FOREIGN KEY ("typeId", "tenantId") REFERENCES "WorkItemType"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemTypeReviewStepReviewer" ADD CONSTRAINT "WorkItemTypeReviewStepReviewer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemTypeReviewStepReviewer" ADD CONSTRAINT "WorkItemTypeReviewStepReviewer_stepId_tenantId_fkey" FOREIGN KEY ("stepId", "tenantId") REFERENCES "WorkItemTypeReviewStep"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemTypeReviewStepReviewer" ADD CONSTRAINT "WorkItemTypeReviewStepReviewer_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "TenantMembership"("tenantId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemTypeReviewStepReviewer" ADD CONSTRAINT "WorkItemTypeReviewStepReviewer_recipientListId_tenantId_fkey" FOREIGN KEY ("recipientListId", "tenantId") REFERENCES "RecipientList"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;


-- ─── 2) What Prisma cannot declare ────────────────────────────────

ALTER TABLE "WorkItemTypeReviewStep" ADD CONSTRAINT "WorkItemTypeReviewStep_name_length"
    CHECK (char_length("name") BETWEEN 1 AND 120);
ALTER TABLE "WorkItemTypeReviewStep" ADD CONSTRAINT "WorkItemTypeReviewStep_due_in_working_days"
    CHECK ("dueInWorkingDays" BETWEEN 1 AND 60);
ALTER TABLE "WorkItemTypeReviewStep" ADD CONSTRAINT "WorkItemTypeReviewStep_position_positive" CHECK ("position" >= 1);

-- A default reviewer names a member or a list, never both and never neither.
ALTER TABLE "WorkItemTypeReviewStepReviewer" ADD CONSTRAINT "WorkItemTypeReviewStepReviewer_one_target"
    CHECK (("userId" IS NULL) <> ("recipientListId" IS NULL));

-- ─── 3) Grants and RLS ─────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON "WorkItemTypeReviewStep", "WorkItemTypeReviewStepReviewer" TO app_user;

ALTER TABLE "WorkItemTypeReviewStep" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkItemTypeReviewStep" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkItemTypeReviewStep"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "WorkItemTypeReviewStep"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "WorkItemTypeReviewStep"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "WorkItemTypeReviewStepReviewer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkItemTypeReviewStepReviewer" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkItemTypeReviewStepReviewer"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "WorkItemTypeReviewStepReviewer"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "WorkItemTypeReviewStepReviewer"
    USING (current_setting('role') != 'app_user');
