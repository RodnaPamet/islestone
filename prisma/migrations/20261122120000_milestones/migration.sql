-- Sub-phase 2.5b: milestones (docs/porting/maps/2.5.md; owner decisions 62
-- and 71–74; ADR 0002 §2, §10, §13; ADR 0006 "Milestone").
--
-- 1) Prisma's DDL for Milestone, WorkItem.milestoneId with its composite FK
--    and index, and WorkItemTransition.milestoneId, with the edit Prisma
--    cannot express: "sortKey" is COLLATE "C" (ADR 0002 §5).
-- 2) The grant, 3) row-level security, 4) the transition trigger records the
--    milestone too. Each construct has a catalogue test
--    (tests/integration/milestones.test.ts).
--
-- The item's FK to its milestone is NO ACTION, not RESTRICT: a project purge
-- deletes the project's items and milestones in one cascading statement, and
-- NO ACTION checks the reference at its end. A delete of a milestone an item
-- still names is refused all the same; the usecase clears the items first.

-- ─── 1) Prisma DDL ────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "WorkItem" ADD COLUMN     "milestoneId" TEXT;

-- AlterTable
ALTER TABLE "WorkItemTransition" ADD COLUMN     "milestoneId" TEXT;

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dueDate" DATE,
    "sortKey" TEXT COLLATE "C" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Milestone_tenantId_projectId_sortKey_idx" ON "Milestone"("tenantId", "projectId", "sortKey");

-- CreateIndex
CREATE UNIQUE INDEX "Milestone_id_tenantId_key" ON "Milestone"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Milestone_id_projectId_tenantId_key" ON "Milestone"("id", "projectId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Milestone_tenantId_projectId_name_key" ON "Milestone"("tenantId", "projectId", "name");

-- CreateIndex
CREATE INDEX "WorkItem_tenantId_milestoneId_stateCategory_idx" ON "WorkItem"("tenantId", "milestoneId", "stateCategory");

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_milestoneId_projectId_tenantId_fkey" FOREIGN KEY ("milestoneId", "projectId", "tenantId") REFERENCES "Milestone"("id", "projectId", "tenantId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_projectId_tenantId_fkey" FOREIGN KEY ("projectId", "tenantId") REFERENCES "Project"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 2) Grant ─────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON "Milestone" TO app_user;

-- ─── 3) Canonical RLS ─────────────────────────────────────────────

ALTER TABLE "Milestone" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Milestone" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Milestone"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "Milestone"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "Milestone"
    USING (current_setting('role') != 'app_user');

-- ─── 4) The transition record gains the milestone ─────────────────
--
-- The function and the update trigger are replaced with the milestone in the
-- row and in the columns that fire it; everything else is 2.5a's
-- (20261121120000_cycles_and_transitions). Rows written before carry NULL.
CREATE OR REPLACE FUNCTION work_item_transition_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO "WorkItemTransition"
        ("tenantId", "workItemId", "projectId", "teamId", "stateId", "stateCategory", "cycleId", "milestoneId", "deleted", "at")
    VALUES
        (NEW."tenantId", NEW."id", NEW."projectId", NEW."teamId", NEW."stateId", NEW."stateCategory",
         NEW."cycleId", NEW."milestoneId", NEW."deletedAt" IS NOT NULL, clock_timestamp() AT TIME ZONE 'UTC');
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION work_item_transition_record() FROM PUBLIC;

DROP TRIGGER work_item_transition_update ON "WorkItem";
CREATE TRIGGER work_item_transition_update
    AFTER UPDATE OF "stateId", "cycleId", "milestoneId", "projectId", "deletedAt" ON "WorkItem"
    FOR EACH ROW
    WHEN (
        OLD."stateId" IS DISTINCT FROM NEW."stateId"
        OR OLD."cycleId" IS DISTINCT FROM NEW."cycleId"
        OR OLD."milestoneId" IS DISTINCT FROM NEW."milestoneId"
        OR OLD."projectId" IS DISTINCT FROM NEW."projectId"
        OR (OLD."deletedAt" IS NULL) <> (NEW."deletedAt" IS NULL)
    )
    EXECUTE FUNCTION work_item_transition_record();
