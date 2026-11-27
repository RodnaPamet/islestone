-- Sub-phase 3.4a: estimates (docs/porting/maps/3.4.md, "Estimates (3.4a)";
-- ADR 0012 §1; ADR 0002 §12 and §18; owner decisions 257 to 259).
--
-- 1) Prisma's DDL: the EstimateUnit enum, Team.estimateUnit, the item's two
--    typed estimate columns, the same two on item templates (decision 258)
--    and on the transition record.
-- 2) The CHECKs Prisma cannot declare: whole points 0 to 100, minutes 0 to
--    60,000 (1,000 hours), on the item and on the item template.
-- 3) The transition record gains both columns, in the row and in the columns
--    that fire it, so the burn-up counts points or hours from recorded
--    changes (decision 259; the 2.5 map's rule for a later column).
--
-- No index: nothing filters or sorts by an estimate in 3.4a. Rows written
-- before carry NULL; nothing is backfilled.

-- ─── 1) Enum and columns ──────────────────────────────────────────
CREATE TYPE "EstimateUnit" AS ENUM ('POINTS', 'HOURS');

ALTER TABLE "Team" ADD COLUMN     "estimateUnit" "EstimateUnit";

ALTER TABLE "WorkItem" ADD COLUMN     "estimateMinutes" INTEGER,
ADD COLUMN     "estimatePoints" INTEGER;

ALTER TABLE "WorkItemTemplate" ADD COLUMN     "estimateMinutes" INTEGER,
ADD COLUMN     "estimatePoints" INTEGER;

ALTER TABLE "WorkItemTransition" ADD COLUMN     "estimateMinutes" INTEGER,
ADD COLUMN     "estimatePoints" INTEGER;

-- ─── 2) The ranges ────────────────────────────────────────────────
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_estimate_points_range"
    CHECK ("estimatePoints" IS NULL OR "estimatePoints" BETWEEN 0 AND 100);
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_estimate_minutes_range"
    CHECK ("estimateMinutes" IS NULL OR "estimateMinutes" BETWEEN 0 AND 60000);
ALTER TABLE "WorkItemTemplate" ADD CONSTRAINT "WorkItemTemplate_estimate_points_range"
    CHECK ("estimatePoints" IS NULL OR "estimatePoints" BETWEEN 0 AND 100);
ALTER TABLE "WorkItemTemplate" ADD CONSTRAINT "WorkItemTemplate_estimate_minutes_range"
    CHECK ("estimateMinutes" IS NULL OR "estimateMinutes" BETWEEN 0 AND 60000);

-- ─── 3) The transition record gains the estimate ──────────────────
--
-- The function and the update trigger are replaced with the two columns in
-- the row and in the columns that fire it; everything else is 2.4b-a's
-- (20261128120100_waiting_on). The goal stays unwatched (3.2a).
CREATE OR REPLACE FUNCTION work_item_transition_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO "WorkItemTransition"
        ("tenantId", "workItemId", "projectId", "teamId", "stateId", "stateCategory", "cycleId", "milestoneId", "waitingOnUserId",
         "estimatePoints", "estimateMinutes", "deleted", "at")
    VALUES
        (NEW."tenantId", NEW."id", NEW."projectId", NEW."teamId", NEW."stateId", NEW."stateCategory",
         NEW."cycleId", NEW."milestoneId", NEW."waitingOnUserId", NEW."estimatePoints", NEW."estimateMinutes",
         NEW."deletedAt" IS NOT NULL, clock_timestamp() AT TIME ZONE 'UTC');
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION work_item_transition_record() FROM PUBLIC;

DROP TRIGGER work_item_transition_update ON "WorkItem";
CREATE TRIGGER work_item_transition_update
    AFTER UPDATE OF "stateId", "cycleId", "milestoneId", "projectId", "deletedAt", "waitingOnUserId", "estimatePoints", "estimateMinutes" ON "WorkItem"
    FOR EACH ROW
    WHEN (
        OLD."stateId" IS DISTINCT FROM NEW."stateId"
        OR OLD."cycleId" IS DISTINCT FROM NEW."cycleId"
        OR OLD."milestoneId" IS DISTINCT FROM NEW."milestoneId"
        OR OLD."projectId" IS DISTINCT FROM NEW."projectId"
        OR OLD."waitingOnUserId" IS DISTINCT FROM NEW."waitingOnUserId"
        OR OLD."estimatePoints" IS DISTINCT FROM NEW."estimatePoints"
        OR OLD."estimateMinutes" IS DISTINCT FROM NEW."estimateMinutes"
        OR (OLD."deletedAt" IS NULL) <> (NEW."deletedAt" IS NULL)
    )
    EXECUTE FUNCTION work_item_transition_record();
