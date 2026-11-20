-- Sub-phase 2.6c: inbound email (docs/porting/maps/2.6.md "Inbound email";
-- owner decisions 87, 98, 99 and 120 to 123).
--
-- 1) Prisma's DDL: a project's email address (`ProjectIntake.emailToken`,
--    global, resolved before any workspace is known), an emailed request's
--    sender check, reply token (global), Message-ID hash and dropped
--    attachments; the follow-ups, the blocked senders and the inbound
--    deliveries (their `svixId` and `emailId` global, so a repeat delivery is
--    a no-op); the outbox's Reply-To.
-- 2) Grants and canonical row-level security on the three new tenant tables.
-- 3) The CHECKs.
-- Each construct has a catalogue test
-- (tests/integration/intake-sql-constructs.test.ts). The acknowledgement's
-- email type is added by the migration before this one.

-- ─── 1) Prisma DDL ────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "IntakeSenderCheck" AS ENUM ('VERIFIED', 'FAILED', 'NONE');

-- CreateEnum
CREATE TYPE "IntakeInboundStatus" AS ENUM ('PENDING', 'PROCESSED', 'DROPPED', 'FAILED');

-- AlterTable
ALTER TABLE "IntakeRequest" ADD COLUMN     "attachmentsDropped" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "replyToken" TEXT,
ADD COLUMN     "senderCheck" "IntakeSenderCheck",
ADD COLUMN     "sourceDedupeHash" TEXT;

-- AlterTable
ALTER TABLE "NotificationOutbox" ADD COLUMN     "replyTo" TEXT;

-- AlterTable
ALTER TABLE "ProjectIntake" ADD COLUMN     "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailToken" TEXT,
ADD COLUMN     "emailTokenRotatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "IntakeFollowUp" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sourceDedupeHash" TEXT NOT NULL,
    "attachmentsDropped" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeBlockedSender" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "emailHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeBlockedSender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeInboundEmail" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "svixId" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "status" "IntakeInboundStatus" NOT NULL DEFAULT 'PENDING',
    "outcome" TEXT,
    "senderHash" TEXT,
    "replyToken" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requestId" TEXT,
    "followUpId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "IntakeInboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntakeFollowUp_tenantId_requestId_createdAt_idx" ON "IntakeFollowUp"("tenantId", "requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeFollowUp_tenantId_sourceDedupeHash_key" ON "IntakeFollowUp"("tenantId", "sourceDedupeHash");

-- CreateIndex
CREATE INDEX "IntakeBlockedSender_tenantId_projectId_createdAt_idx" ON "IntakeBlockedSender"("tenantId", "projectId", "createdAt");

-- CreateIndex
CREATE INDEX "IntakeBlockedSender_tenantId_emailHash_idx" ON "IntakeBlockedSender"("tenantId", "emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeBlockedSender_tenantId_projectId_emailHash_key" ON "IntakeBlockedSender"("tenantId", "projectId", "emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeInboundEmail_svixId_key" ON "IntakeInboundEmail"("svixId");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeInboundEmail_emailId_key" ON "IntakeInboundEmail"("emailId");

-- CreateIndex
CREATE INDEX "IntakeInboundEmail_tenantId_projectId_createdAt_idx" ON "IntakeInboundEmail"("tenantId", "projectId", "createdAt");

-- CreateIndex
CREATE INDEX "IntakeInboundEmail_tenantId_projectId_senderHash_createdAt_idx" ON "IntakeInboundEmail"("tenantId", "projectId", "senderHash", "createdAt");

-- CreateIndex
CREATE INDEX "IntakeInboundEmail_tenantId_createdAt_idx" ON "IntakeInboundEmail"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeInboundEmail_id_tenantId_key" ON "IntakeInboundEmail"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeRequest_replyToken_key" ON "IntakeRequest"("replyToken");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeRequest_tenantId_sourceDedupeHash_key" ON "IntakeRequest"("tenantId", "sourceDedupeHash");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectIntake_emailToken_key" ON "ProjectIntake"("emailToken");

-- AddForeignKey
ALTER TABLE "IntakeFollowUp" ADD CONSTRAINT "IntakeFollowUp_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeFollowUp" ADD CONSTRAINT "IntakeFollowUp_requestId_tenantId_fkey" FOREIGN KEY ("requestId", "tenantId") REFERENCES "IntakeRequest"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeBlockedSender" ADD CONSTRAINT "IntakeBlockedSender_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeBlockedSender" ADD CONSTRAINT "IntakeBlockedSender_projectId_tenantId_fkey" FOREIGN KEY ("projectId", "tenantId") REFERENCES "Project"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeInboundEmail" ADD CONSTRAINT "IntakeInboundEmail_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeInboundEmail" ADD CONSTRAINT "IntakeInboundEmail_projectId_tenantId_fkey" FOREIGN KEY ("projectId", "tenantId") REFERENCES "Project"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 2) Grants and row-level security ─────────────────────────────
--
-- UPDATE stays on the follow-ups and the blocked senders for the key
-- rotations' re-wrap of their encrypted columns; the purge and unblocking
-- delete.
GRANT SELECT, INSERT, UPDATE, DELETE ON "IntakeFollowUp", "IntakeBlockedSender", "IntakeInboundEmail" TO app_user;

ALTER TABLE "IntakeFollowUp" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntakeFollowUp" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IntakeFollowUp"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "IntakeFollowUp"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "IntakeFollowUp"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "IntakeBlockedSender" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntakeBlockedSender" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IntakeBlockedSender"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "IntakeBlockedSender"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "IntakeBlockedSender"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "IntakeInboundEmail" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntakeInboundEmail" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IntakeInboundEmail"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "IntakeInboundEmail"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "IntakeInboundEmail"
    USING (current_setting('role') != 'app_user');

-- ─── 3) CHECKs ────────────────────────────────────────────────────

-- An address takes mail only with a token.
ALTER TABLE "ProjectIntake" ADD CONSTRAINT "ProjectIntake_email_needs_token"
    CHECK (NOT "emailEnabled" OR "emailToken" IS NOT NULL);
-- An emailed request carries its sender check; nothing else does.
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_sender_check_with_email"
    CHECK (("channel" = 'EMAIL') = ("senderCheck" IS NOT NULL));
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_attachments_dropped_nonnegative"
    CHECK ("attachmentsDropped" >= 0);
ALTER TABLE "IntakeFollowUp" ADD CONSTRAINT "IntakeFollowUp_body_length"
    CHECK (char_length("body") >= 1);
ALTER TABLE "IntakeFollowUp" ADD CONSTRAINT "IntakeFollowUp_attachments_dropped_nonnegative"
    CHECK ("attachmentsDropped" >= 0);
-- A dropped delivery names why; a pending one names nothing.
ALTER TABLE "IntakeInboundEmail" ADD CONSTRAINT "IntakeInboundEmail_dropped_has_outcome"
    CHECK ("status" NOT IN ('DROPPED', 'FAILED') OR "outcome" IS NOT NULL);
ALTER TABLE "IntakeInboundEmail" ADD CONSTRAINT "IntakeInboundEmail_pending_has_no_outcome"
    CHECK ("status" <> 'PENDING' OR "outcome" IS NULL);

-- ─── 4) One workspace-wide block per address ──────────────────────
-- The unique above treats NULL projects as distinct, so a workspace-wide
-- block (projectId NULL) is held unique by this partial index.
CREATE UNIQUE INDEX "IntakeBlockedSender_workspace_unique"
    ON "IntakeBlockedSender"("tenantId", "emailHash") WHERE "projectId" IS NULL;
