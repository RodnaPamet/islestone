-- Sub-phase 2.7c: the Inbox, notification preferences and the digest
-- (docs/porting/maps/2.7.md, part 4; docs/notifications.md; owner decisions
-- 132 to 136).
--
--   1. `Notification` gains `readAt`, `archivedAt` (the Inbox's Done) and
--      `workItemId`, with the Inbox's and the purge's indexes. All three are
--      nullable, so the previous image keeps reading and writing the table.
--   2. `EmailDelivery` and `NotificationPreference`: one row per member and
--      type, cascading with the membership; RLS, grants.

-- ─── 1) Notification: the Inbox's columns ───────────────────────────

ALTER TABLE "Notification" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "readAt" TIMESTAMP(3),
ADD COLUMN     "workItemId" TEXT;

-- CreateIndex
CREATE INDEX "Notification_tenantId_userId_archivedAt_createdAt_idx" ON "Notification"("tenantId", "userId", "archivedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_tenantId_workItemId_idx" ON "Notification"("tenantId", "workItemId");

-- CreateIndex
CREATE INDEX "Notification_tenantId_archivedAt_idx" ON "Notification"("tenantId", "archivedAt");

-- CreateIndex
CREATE INDEX "Notification_tenantId_read_readAt_idx" ON "Notification"("tenantId", "read", "readAt");

-- A purged work item leaves its notifications (and their links): only the
-- item column is cleared, never the workspace's (Postgres 15's column list,
-- as `WorkItem_recurrenceId_tenantId_fkey`; Prisma's schema says SetNull).
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workItemId_tenantId_fkey" FOREIGN KEY ("workItemId", "tenantId") REFERENCES "WorkItem"("id", "tenantId") ON DELETE SET NULL ("workItemId") ON UPDATE NO ACTION;

-- ─── 2) Preferences ─────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "EmailDelivery" AS ENUM ('OFF', 'IMMEDIATE', 'DAILY');

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "emailDelivery" "EmailDelivery" NOT NULL DEFAULT 'OFF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("tenantId","userId","type")
);

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A removed member's preferences go with the membership.
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "TenantMembership"("tenantId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Immediate email is offered only for the direct types (owner decision 132):
-- assigned and waiting on (mentions add theirs in 2.7d). The usecase refuses
-- it first; this holds every other writer.
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_immediate_types"
    CHECK ("emailDelivery" <> 'IMMEDIATE' OR "type" IN ('WORK_ITEM_ASSIGNED', 'WORK_ITEM_WAITING_ON'));

-- Grants and row-level security. DELETE: "reset to defaults" removes rows.
GRANT SELECT, INSERT, UPDATE, DELETE ON "NotificationPreference" TO app_user;

ALTER TABLE "NotificationPreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationPreference" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "NotificationPreference"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "NotificationPreference"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "NotificationPreference"
    USING (current_setting('role') != 'app_user');
