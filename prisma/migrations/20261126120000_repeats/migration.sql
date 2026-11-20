-- Sub-phase 2.5d: repeats (docs/porting/maps/2.5.md; owner decisions 67
-- to 70).
--
-- 1) Prisma's DDL for the two enums, WorkItemRecurrence and the item's
--    recurrenceId / occurrenceOn, with the edit Prisma cannot express: the
--    item's rule link is ON DELETE SET NULL ("recurrenceId") (Postgres 15's
--    column list), so stopping a repeat leaves its earlier items in place
--    without touching their tenantId.
-- 2) The grant and the canonical RLS policies on WorkItemRecurrence.
-- 3) The CHECKs: interval 1..99, leadDays 0..30, maxOccurrences 2..1000,
--    weekdays 0..6 and only on a weekly rule, endsOn not before firstOn, a
--    paused rule names its reason; an occurrence item carries its date.
-- 4) The occurrence unique: one item per (recurrenceId, occurrenceOn), the
--    backstop to the job's claim on the stamped next date.
-- Each construct has a catalogue test (tests/integration/repeats.test.ts).

-- ─── 1) Prisma DDL ────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "RecurrenceHold" AS ENUM ('OWNER_NOT_ACTIVE', 'OWNER_NOT_PERMITTED', 'SOURCE_DELETED', 'PROJECT_ARCHIVED', 'ENDED', 'HELD_BY_MEMBER');


-- AlterTable
ALTER TABLE "WorkItem" ADD COLUMN     "occurrenceOn" DATE,
ADD COLUMN     "recurrenceId" TEXT;

-- CreateTable
CREATE TABLE "WorkItemRecurrence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceWorkItemId" TEXT NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "weekdays" INTEGER[],
    "firstOn" DATE NOT NULL,
    "endsOn" DATE,
    "maxOccurrences" INTEGER,
    "leadDays" INTEGER NOT NULL DEFAULT 3,
    "nextOccurrenceOn" DATE,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 0,
    "ownerUserId" TEXT NOT NULL,
    "heldAt" TIMESTAMP(3),
    "heldReason" "RecurrenceHold",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkItemRecurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkItemRecurrence_tenantId_nextOccurrenceOn_idx" ON "WorkItemRecurrence"("tenantId", "nextOccurrenceOn");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemRecurrence_id_tenantId_key" ON "WorkItemRecurrence"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemRecurrence_sourceWorkItemId_tenantId_key" ON "WorkItemRecurrence"("sourceWorkItemId", "tenantId");

-- CreateIndex
CREATE INDEX "WorkItem_tenantId_recurrenceId_idx" ON "WorkItem"("tenantId", "recurrenceId");

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_recurrenceId_tenantId_fkey" FOREIGN KEY ("recurrenceId", "tenantId") REFERENCES "WorkItemRecurrence"("id", "tenantId") ON DELETE SET NULL ("recurrenceId") ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WorkItemRecurrence" ADD CONSTRAINT "WorkItemRecurrence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemRecurrence" ADD CONSTRAINT "WorkItemRecurrence_sourceWorkItemId_tenantId_fkey" FOREIGN KEY ("sourceWorkItemId", "tenantId") REFERENCES "WorkItem"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 2) Grant and canonical RLS ───────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON "WorkItemRecurrence" TO app_user;
ALTER TABLE "WorkItemRecurrence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkItemRecurrence" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkItemRecurrence"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "WorkItemRecurrence"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "WorkItemRecurrence"
    USING (current_setting('role') != 'app_user');

-- ─── 3) CHECKs ────────────────────────────────────────────────────

ALTER TABLE "WorkItemRecurrence" ADD CONSTRAINT "WorkItemRecurrence_interval_range"
    CHECK ("interval" BETWEEN 1 AND 99);
ALTER TABLE "WorkItemRecurrence" ADD CONSTRAINT "WorkItemRecurrence_lead_days_range"
    CHECK ("leadDays" BETWEEN 0 AND 30);
ALTER TABLE "WorkItemRecurrence" ADD CONSTRAINT "WorkItemRecurrence_max_occurrences_range"
    CHECK ("maxOccurrences" IS NULL OR "maxOccurrences" BETWEEN 2 AND 1000);
ALTER TABLE "WorkItemRecurrence" ADD CONSTRAINT "WorkItemRecurrence_weekdays_valid"
    CHECK ("weekdays" <@ ARRAY[0,1,2,3,4,5,6] AND ("frequency" = 'WEEKLY' OR cardinality("weekdays") = 0));
ALTER TABLE "WorkItemRecurrence" ADD CONSTRAINT "WorkItemRecurrence_ends_after_first"
    CHECK ("endsOn" IS NULL OR "endsOn" >= "firstOn");
ALTER TABLE "WorkItemRecurrence" ADD CONSTRAINT "WorkItemRecurrence_held_has_reason"
    CHECK (("heldAt" IS NULL) = ("heldReason" IS NULL));
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_occurrence_has_date"
    CHECK ("recurrenceId" IS NULL OR "occurrenceOn" IS NOT NULL);

-- ─── 4) The occurrence unique ─────────────────────────────────────

CREATE UNIQUE INDEX "WorkItem_recurrence_occurrence_key"
    ON "WorkItem"("recurrenceId", "occurrenceOn") WHERE "recurrenceId" IS NOT NULL;
