-- Sub-phase 3.4b: time entries and timers (docs/porting/maps/3.4.md, "Time
-- entries and timers (3.4b)"; ADR 0012 §2; owner decisions 260 to 267, 277
-- and 278; docs/time-tracking.md).
--
-- 1) Prisma's DDL: the TimeEntrySource enum and the TimeEntry table with its
--    three tenant-leading indexes and its foreign keys.
-- 2) What Prisma cannot declare: the work item's link clears only its own
--    column on a purge (decision 261); one running timer per person per
--    workspace (decision 262); the CHECKs on minutes, the timer and the
--    author (decision 267).
-- 3) Grants and the canonical RLS. An entry its person deletes is removed
--    for good (decision 277), so app_user holds DELETE.
--
-- The table is this image's own: the previous image never reads it. 3.4c adds
-- the week's freeze trigger, 3.4d the frozen rate columns.

-- ─── 1) Prisma's DDL ─────────────────────────────────────────────
CREATE TYPE "TimeEntrySource" AS ENUM ('MANUAL', 'TIMER');

CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workItemId" TEXT,
    "projectId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "minutes" INTEGER,
    "timerStartedAt" TIMESTAMP(3),
    "source" "TimeEntrySource" NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TimeEntry_tenantId_userId_workDate_idx" ON "TimeEntry"("tenantId", "userId", "workDate");
CREATE INDEX "TimeEntry_tenantId_workItemId_workDate_idx" ON "TimeEntry"("tenantId", "workItemId", "workDate");
CREATE INDEX "TimeEntry_tenantId_projectId_workDate_idx" ON "TimeEntry"("tenantId", "projectId", "workDate");
CREATE UNIQUE INDEX "TimeEntry_id_tenantId_key" ON "TimeEntry"("id", "tenantId");

ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_projectId_tenantId_fkey" FOREIGN KEY ("projectId", "tenantId") REFERENCES "Project"("id", "tenantId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ─── 2) What Prisma cannot declare ────────────────────────────────

-- A purged item leaves its entries, which then read "Deleted item" (decision
-- 261): the link clears its own column, never tenantId.
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_workItemId_tenantId_fkey" FOREIGN KEY ("workItemId", "tenantId") REFERENCES "WorkItem"("id", "tenantId") ON DELETE SET NULL ("workItemId") ON UPDATE NO ACTION;

-- One running timer per person per workspace (decision 262): the race of two
-- starts on two devices is answered by this index (409 TIMER_ON).
CREATE UNIQUE INDEX "TimeEntry_one_timer_per_person" ON "TimeEntry"("tenantId", "userId") WHERE "minutes" IS NULL;

-- Minutes, to the minute (decision 264): 1 to 1,440, NULL only while timing.
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_minutes_range"
    CHECK ("minutes" IS NULL OR "minutes" BETWEEN 1 AND 1440);
-- A timer's start is set exactly on TIMER entries, and only a timer runs.
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_timer_started_iff_timer"
    CHECK (("source" = 'TIMER') = ("timerStartedAt" IS NOT NULL));
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_running_is_timer"
    CHECK ("minutes" IS NOT NULL OR "source" = 'TIMER');
-- Nobody records time for someone else (decision 267).
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_own_time"
    CHECK ("createdByUserId" = "userId");
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_version_positive" CHECK ("version" >= 1);

-- ─── 3) Grants and RLS ─────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON "TimeEntry" TO app_user;

ALTER TABLE "TimeEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimeEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TimeEntry"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "TimeEntry"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "TimeEntry"
    USING (current_setting('role') != 'app_user');
