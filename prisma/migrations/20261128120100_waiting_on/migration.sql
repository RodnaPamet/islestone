-- Sub-phase 2.4b-a: waiting on (docs/porting/maps/2.4b.md; ADR 0002 §14;
-- owner decisions 100 and 103 to 107).
--
-- 1) Prisma's DDL for WorkItem.waitingOnUserId (composite FK to the member,
--    RESTRICT as the assignee's, and its index) and
--    WorkItemTransition.waitingOnUserId.
-- 2) The CHECK Prisma cannot declare: a closed item names nobody.
-- 3) The transition record gains the column, in the row and in the columns
--    that fire it, so 3.6 counts time waiting from recorded changes.
--
-- From 6.3 a nullable agent-session reference joins waitingOnUserId (owner
-- decision 106), with a CHECK that at most one of the two is set and the
-- CHECK below widened to both. Nothing here is rewritten for it.

-- ─── 1) Columns, index and FK ─────────────────────────────────────
ALTER TABLE "WorkItem" ADD COLUMN     "waitingOnUserId" TEXT;

ALTER TABLE "WorkItemTransition" ADD COLUMN     "waitingOnUserId" TEXT;

CREATE INDEX "WorkItem_tenantId_waitingOnUserId_stateCategory_dueDate_idx" ON "WorkItem"("tenantId", "waitingOnUserId", "stateCategory", "dueDate");

ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_tenantId_waitingOnUserId_fkey" FOREIGN KEY ("tenantId", "waitingOnUserId") REFERENCES "TenantMembership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── 2) A closed item waits on nobody ─────────────────────────────
--
-- Every move into DONE or CANCELLED clears the column through
-- `stateTransitionEffects`; this CHECK makes a path that forgets it fail
-- instead of leaving a stale name.
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_waiting_on_open_only"
    CHECK ("stateCategory" NOT IN ('DONE', 'CANCELLED') OR "waitingOnUserId" IS NULL);

-- ─── 3) The transition record gains waiting on ────────────────────
--
-- The function and the update trigger are replaced with the column in the
-- row and in the columns that fire it; everything else is 2.5b's
-- (20261122120000_milestones). Rows written before carry NULL.
CREATE OR REPLACE FUNCTION work_item_transition_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO "WorkItemTransition"
        ("tenantId", "workItemId", "projectId", "teamId", "stateId", "stateCategory", "cycleId", "milestoneId", "waitingOnUserId", "deleted", "at")
    VALUES
        (NEW."tenantId", NEW."id", NEW."projectId", NEW."teamId", NEW."stateId", NEW."stateCategory",
         NEW."cycleId", NEW."milestoneId", NEW."waitingOnUserId", NEW."deletedAt" IS NOT NULL, clock_timestamp() AT TIME ZONE 'UTC');
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION work_item_transition_record() FROM PUBLIC;

DROP TRIGGER work_item_transition_update ON "WorkItem";
CREATE TRIGGER work_item_transition_update
    AFTER UPDATE OF "stateId", "cycleId", "milestoneId", "projectId", "deletedAt", "waitingOnUserId" ON "WorkItem"
    FOR EACH ROW
    WHEN (
        OLD."stateId" IS DISTINCT FROM NEW."stateId"
        OR OLD."cycleId" IS DISTINCT FROM NEW."cycleId"
        OR OLD."milestoneId" IS DISTINCT FROM NEW."milestoneId"
        OR OLD."projectId" IS DISTINCT FROM NEW."projectId"
        OR OLD."waitingOnUserId" IS DISTINCT FROM NEW."waitingOnUserId"
        OR (OLD."deletedAt" IS NULL) <> (NEW."deletedAt" IS NULL)
    )
    EXECUTE FUNCTION work_item_transition_record();
