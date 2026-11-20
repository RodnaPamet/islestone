-- Sub-phase 2.5a: cycles, cycle schedules and work-item transitions
-- (docs/porting/maps/2.5.md; owner decisions 62 to 75; ADR 0002 §2, §10, §13;
-- ADR 0006 "Cycle", "Cycle schedule", "Transition").
--
-- 1) Prisma's DDL for the enum, the three tables and WorkItem.cycleId with its
--    composite FK and index.
-- 2) Grants: app_user holds SELECT only on WorkItemTransition, whose one
--    writer is the trigger of section 5.
-- 3) Row-level security on the three tenant tables.
-- 4) The cycle CHECKs and the no-overlap exclusion constraint.
-- 5) The transition trigger.
-- Each construct has a catalogue test
-- (tests/integration/cycles-sql-constructs.test.ts).
--
-- The enum is created here with its table; no existing enum gains a value
-- (tests/guards/migration-enum-isolation.test.ts).

-- ─── 1) Prisma DDL ────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "CycleRollover" AS ENUM ('NEXT_CYCLE', 'NO_CYCLE');

-- AlterTable
ALTER TABLE "WorkItem" ADD COLUMN     "cycleId" TEXT;

-- CreateTable
CREATE TABLE "CycleSchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lengthWeeks" INTEGER NOT NULL DEFAULT 2,
    "firstStartsOn" DATE NOT NULL,
    "upcomingCount" INTEGER NOT NULL DEFAULT 2,
    "rollover" "CycleRollover" NOT NULL DEFAULT 'NEXT_CYCLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CycleSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cycle" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "fromSchedule" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItemTransition" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "stateCategory" "WorkflowStateCategory" NOT NULL,
    "cycleId" TEXT,
    "deleted" BOOLEAN NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkItemTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CycleSchedule_tenantId_teamId_idx" ON "CycleSchedule"("tenantId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "CycleSchedule_teamId_tenantId_key" ON "CycleSchedule"("teamId", "tenantId");

-- CreateIndex
CREATE INDEX "Cycle_tenantId_teamId_startsOn_idx" ON "Cycle"("tenantId", "teamId", "startsOn");

-- CreateIndex
CREATE INDEX "Cycle_tenantId_completedAt_endsOn_idx" ON "Cycle"("tenantId", "completedAt", "endsOn");

-- CreateIndex
CREATE UNIQUE INDEX "Cycle_id_tenantId_key" ON "Cycle"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Cycle_id_teamId_tenantId_key" ON "Cycle"("id", "teamId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Cycle_tenantId_teamId_number_key" ON "Cycle"("tenantId", "teamId", "number");

-- CreateIndex
CREATE INDEX "WorkItemTransition_tenantId_cycleId_workItemId_idx" ON "WorkItemTransition"("tenantId", "cycleId", "workItemId");

-- CreateIndex
CREATE INDEX "WorkItemTransition_tenantId_workItemId_at_idx" ON "WorkItemTransition"("tenantId", "workItemId", "at");

-- CreateIndex
CREATE INDEX "WorkItemTransition_tenantId_projectId_at_idx" ON "WorkItemTransition"("tenantId", "projectId", "at");

-- CreateIndex
CREATE INDEX "WorkItem_tenantId_cycleId_stateCategory_idx" ON "WorkItem"("tenantId", "cycleId", "stateCategory");

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_cycleId_teamId_tenantId_fkey" FOREIGN KEY ("cycleId", "teamId", "tenantId") REFERENCES "Cycle"("id", "teamId", "tenantId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CycleSchedule" ADD CONSTRAINT "CycleSchedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleSchedule" ADD CONSTRAINT "CycleSchedule_teamId_tenantId_fkey" FOREIGN KEY ("teamId", "tenantId") REFERENCES "Team"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cycle" ADD CONSTRAINT "Cycle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cycle" ADD CONSTRAINT "Cycle_teamId_tenantId_fkey" FOREIGN KEY ("teamId", "tenantId") REFERENCES "Team"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemTransition" ADD CONSTRAINT "WorkItemTransition_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 2) Grants ────────────────────────────────────────────────────
--
-- Cycles and schedules are ordinary rows. Transitions are written only by
-- `work_item_transition_record` (SECURITY DEFINER, section 5): app_user may
-- read them and nothing else, so no request can forge, change or remove one.
-- The REVOKE is explicit because the database's default privileges grant
-- every new table to app_user.
GRANT SELECT, INSERT, UPDATE, DELETE ON "CycleSchedule", "Cycle" TO app_user;
GRANT SELECT ON "WorkItemTransition" TO app_user;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "WorkItemTransition" FROM app_user;
REVOKE ALL ON SEQUENCE "WorkItemTransition_id_seq" FROM app_user;

-- ─── 3) Canonical RLS on the three tenant tables ──────────────────

ALTER TABLE "CycleSchedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CycleSchedule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CycleSchedule"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "CycleSchedule"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "CycleSchedule"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "Cycle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Cycle" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Cycle"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "Cycle"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "Cycle"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "WorkItemTransition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkItemTransition" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkItemTransition"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "WorkItemTransition"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "WorkItemTransition"
    USING (current_setting('role') != 'app_user');

-- ─── 4) Cycles: ranges and no overlap ─────────────────────────────

ALTER TABLE "Cycle" ADD CONSTRAINT "Cycle_dates_ordered" CHECK ("endsOn" >= "startsOn");
ALTER TABLE "Cycle" ADD CONSTRAINT "Cycle_number_positive" CHECK ("number" >= 1);
ALTER TABLE "CycleSchedule" ADD CONSTRAINT "CycleSchedule_length_range" CHECK ("lengthWeeks" BETWEEN 1 AND 8);
ALTER TABLE "CycleSchedule" ADD CONSTRAINT "CycleSchedule_upcoming_range" CHECK ("upcomingCount" BETWEEN 1 AND 6);

-- A team's cycles never overlap (dates inclusive at both ends). btree_gist
-- lets the GiST index compare the text columns for equality; it is a trusted
-- contrib extension, present in the pgvector image (docker-compose.yml) and
-- in the CI service. The usecases check the same rule under the team's cycle
-- lock, so a person sees a 409 rather than this constraint's error.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Cycle" ADD CONSTRAINT "Cycle_no_overlap" EXCLUDE USING gist (
    "tenantId" WITH =,
    "teamId" WITH =,
    daterange("startsOn", "endsOn", '[]') WITH &&
);

-- ─── 5) The transition record, written only by a trigger ──────────
--
-- After every insert, and after an update that changes the item's state,
-- cycle, project or deletion, one row with the item's picture after the
-- change. `at` is the wall clock in UTC (not the transaction start), so two
-- changes in one transaction keep their order; `id` breaks ties. SECURITY
-- DEFINER with a pinned search_path: the function inserts as its owner, so
-- app_user needs (and holds) no INSERT. The row's tenantId is the item's, so
-- the insert policy holds under a tenant context and the bypass policy under
-- a sanctioned bypass.
CREATE OR REPLACE FUNCTION work_item_transition_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO "WorkItemTransition"
        ("tenantId", "workItemId", "projectId", "teamId", "stateId", "stateCategory", "cycleId", "deleted", "at")
    VALUES
        (NEW."tenantId", NEW."id", NEW."projectId", NEW."teamId", NEW."stateId", NEW."stateCategory",
         NEW."cycleId", NEW."deletedAt" IS NOT NULL, clock_timestamp() AT TIME ZONE 'UTC');
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION work_item_transition_record() FROM PUBLIC;

CREATE TRIGGER work_item_transition_insert
    AFTER INSERT ON "WorkItem"
    FOR EACH ROW EXECUTE FUNCTION work_item_transition_record();

CREATE TRIGGER work_item_transition_update
    AFTER UPDATE OF "stateId", "cycleId", "projectId", "deletedAt" ON "WorkItem"
    FOR EACH ROW
    WHEN (
        OLD."stateId" IS DISTINCT FROM NEW."stateId"
        OR OLD."cycleId" IS DISTINCT FROM NEW."cycleId"
        OR OLD."projectId" IS DISTINCT FROM NEW."projectId"
        OR (OLD."deletedAt" IS NULL) <> (NEW."deletedAt" IS NULL)
    )
    EXECUTE FUNCTION work_item_transition_record();
