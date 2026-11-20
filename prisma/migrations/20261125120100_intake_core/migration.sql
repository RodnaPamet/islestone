-- Sub-phase 2.6a: intake (docs/porting/maps/2.6.md; owner decisions 85 to
-- 99; ADR 0006 "Intake", "Intake request", "Intake form", "Notify list";
-- ADR 0002 "Consequences": an intake request is not a work item).
--
-- 1) Prisma's DDL for the four enums and the four tables.
-- 2) Grants: forms and project intake are never deleted by app_user; the
--    purge deletes requests, and the notify list loses members.
-- 3) Row-level security on the four tenant tables.
-- 4) The CHECKs that keep a request's status and its columns in step.
-- Each construct has a catalogue test
-- (tests/integration/intake-sql-constructs.test.ts).
--
-- The enums are created here with their tables; the two NotificationType
-- values are added by the migration before this one
-- (tests/guards/migration-enum-isolation.test.ts).

-- ─── 1) Prisma DDL ────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "IntakeChannel" AS ENUM ('INTERNAL_FORM', 'PUBLIC_FORM', 'EMAIL');

-- CreateEnum
CREATE TYPE "IntakeFormAccess" AS ENUM ('MEMBERS', 'PUBLIC');

-- CreateEnum
CREATE TYPE "IntakeRequestStatus" AS ENUM ('PENDING', 'SNOOZED', 'ACCEPTED', 'DECLINED', 'MERGED');

-- CreateEnum
CREATE TYPE "IntakeDeclineReason" AS ENUM ('NOT_PLANNED', 'OUT_OF_SCOPE', 'SPAM', 'OTHER');

-- CreateTable
CREATE TABLE "ProjectIntake" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeNotifyMember" (
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeNotifyMember_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "IntakeForm" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "access" "IntakeFormAccess" NOT NULL DEFAULT 'MEMBERS',
    "publicId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "definitionJson" JSONB NOT NULL,
    "definitionVersion" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "dailyCap" INTEGER NOT NULL DEFAULT 200,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "channel" "IntakeChannel" NOT NULL,
    "formId" TEXT,
    "formDefinitionVersion" INTEGER,
    "status" "IntakeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "answersJson" TEXT,
    "requesterUserId" TEXT,
    "snoozedUntil" DATE,
    "snoozedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "declineReason" "IntakeDeclineReason",
    "declineExplanation" TEXT,
    "internalRemark" TEXT,
    "workItemId" TEXT,
    "mergedIntoWorkItemId" TEXT,
    "mergedIntoRequestId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectIntake_tenantId_projectId_idx" ON "ProjectIntake"("tenantId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectIntake_projectId_tenantId_key" ON "ProjectIntake"("projectId", "tenantId");

-- CreateIndex
CREATE INDEX "IntakeNotifyMember_tenantId_userId_idx" ON "IntakeNotifyMember"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "IntakeNotifyMember_tenantId_projectId_idx" ON "IntakeNotifyMember"("tenantId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeForm_publicId_key" ON "IntakeForm"("publicId");

-- CreateIndex
CREATE INDEX "IntakeForm_tenantId_projectId_archivedAt_idx" ON "IntakeForm"("tenantId", "projectId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeForm_id_tenantId_key" ON "IntakeForm"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeForm_tenantId_projectId_name_key" ON "IntakeForm"("tenantId", "projectId", "name");

-- CreateIndex
CREATE INDEX "IntakeRequest_tenantId_projectId_status_createdAt_idx" ON "IntakeRequest"("tenantId", "projectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "IntakeRequest_tenantId_status_createdAt_idx" ON "IntakeRequest"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "IntakeRequest_tenantId_status_snoozedUntil_idx" ON "IntakeRequest"("tenantId", "status", "snoozedUntil");

-- CreateIndex
CREATE INDEX "IntakeRequest_tenantId_status_decidedAt_idx" ON "IntakeRequest"("tenantId", "status", "decidedAt");

-- CreateIndex
CREATE INDEX "IntakeRequest_tenantId_formId_createdAt_idx" ON "IntakeRequest"("tenantId", "formId", "createdAt");

-- CreateIndex
CREATE INDEX "IntakeRequest_tenantId_requesterUserId_createdAt_idx" ON "IntakeRequest"("tenantId", "requesterUserId", "createdAt");

-- CreateIndex
CREATE INDEX "IntakeRequest_tenantId_workItemId_idx" ON "IntakeRequest"("tenantId", "workItemId");

-- CreateIndex
CREATE INDEX "IntakeRequest_tenantId_mergedIntoWorkItemId_idx" ON "IntakeRequest"("tenantId", "mergedIntoWorkItemId");

-- CreateIndex
CREATE INDEX "IntakeRequest_tenantId_mergedIntoRequestId_idx" ON "IntakeRequest"("tenantId", "mergedIntoRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeRequest_id_tenantId_key" ON "IntakeRequest"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "ProjectIntake" ADD CONSTRAINT "ProjectIntake_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectIntake" ADD CONSTRAINT "ProjectIntake_projectId_tenantId_fkey" FOREIGN KEY ("projectId", "tenantId") REFERENCES "Project"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeNotifyMember" ADD CONSTRAINT "IntakeNotifyMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeNotifyMember" ADD CONSTRAINT "IntakeNotifyMember_projectId_tenantId_fkey" FOREIGN KEY ("projectId", "tenantId") REFERENCES "Project"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeNotifyMember" ADD CONSTRAINT "IntakeNotifyMember_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "TenantMembership"("tenantId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeForm" ADD CONSTRAINT "IntakeForm_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeForm" ADD CONSTRAINT "IntakeForm_projectId_tenantId_fkey" FOREIGN KEY ("projectId", "tenantId") REFERENCES "Project"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_projectId_tenantId_fkey" FOREIGN KEY ("projectId", "tenantId") REFERENCES "Project"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_formId_tenantId_fkey" FOREIGN KEY ("formId", "tenantId") REFERENCES "IntakeForm"("id", "tenantId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ─── 2) Grants ────────────────────────────────────────────────────
--
-- The database's default privileges grant every new table to app_user; the
-- REVOKEs make the two configuration tables archive-only.
GRANT SELECT, INSERT, UPDATE, DELETE ON "IntakeRequest", "IntakeNotifyMember" TO app_user;
GRANT SELECT, INSERT, UPDATE ON "ProjectIntake", "IntakeForm" TO app_user;
REVOKE DELETE, TRUNCATE ON "ProjectIntake", "IntakeForm" FROM app_user;

-- ─── 3) Canonical RLS on the four tenant tables ───────────────────

ALTER TABLE "ProjectIntake" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectIntake" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProjectIntake"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "ProjectIntake"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "ProjectIntake"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "IntakeNotifyMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntakeNotifyMember" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IntakeNotifyMember"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "IntakeNotifyMember"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "IntakeNotifyMember"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "IntakeForm" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntakeForm" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IntakeForm"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "IntakeForm"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "IntakeForm"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "IntakeRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntakeRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IntakeRequest"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "IntakeRequest"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "IntakeRequest"
    USING (current_setting('role') != 'app_user');

-- ─── 4) A request's status and its columns ────────────────────────
--
-- The usecases write each status with exactly these columns; the CHECKs make
-- any other shape unstorable. The merge and accept targets are plain columns
-- (the item or request may be purged while this row is kept), so the CHECKs
-- never meet a nulled foreign key.

ALTER TABLE "IntakeForm" ADD CONSTRAINT "IntakeForm_name_length" CHECK (char_length("name") BETWEEN 1 AND 100);
ALTER TABLE "IntakeForm" ADD CONSTRAINT "IntakeForm_daily_cap_range" CHECK ("dailyCap" BETWEEN 1 AND 5000);

ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_title_length" CHECK (char_length("title") BETWEEN 1 AND 200);
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_internal_has_requester"
    CHECK ("channel" <> 'INTERNAL_FORM' OR "requesterUserId" IS NOT NULL);
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_decided_when_decided"
    CHECK (("status" IN ('ACCEPTED', 'DECLINED', 'MERGED')) = ("decidedAt" IS NOT NULL));
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_snoozed_has_date"
    CHECK (("status" = 'SNOOZED') = ("snoozedUntil" IS NOT NULL));
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_declined_has_reason"
    CHECK (("status" = 'DECLINED') = ("declineReason" IS NOT NULL));
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_accepted_has_item"
    CHECK (("status" = 'ACCEPTED') = ("workItemId" IS NOT NULL));
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_merged_has_one_target"
    CHECK (
        CASE WHEN "status" = 'MERGED'
            THEN ("mergedIntoWorkItemId" IS NOT NULL) <> ("mergedIntoRequestId" IS NOT NULL)
            ELSE "mergedIntoWorkItemId" IS NULL AND "mergedIntoRequestId" IS NULL
        END
    );
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_not_merged_into_itself"
    CHECK ("mergedIntoRequestId" IS NULL OR "mergedIntoRequestId" <> "id");
