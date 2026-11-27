-- Sub-phase 3.6a: the transition record learns the state category an item
-- came from (owner decision 310; docs/porting/maps/3.6.md, "One new column";
-- ADR 0014 §1, ADR 0002 §14).
--
-- `fromStateCategory` is the item's state category BEFORE the change: the
-- old row's on an update, NULL on the insert row. A completion is then one
-- row, `"stateCategory" = 'DONE' AND "fromStateCategory" IS DISTINCT FROM
-- 'DONE'` (an insert straight into Done counts at creation), found through
-- the partial index below, so throughput, cycle time and lead time never
-- reconstruct every item's history. The trigger stays the only writer; its
-- `UPDATE OF` list is unchanged (3.4a's, 20261220120000_estimates).

-- ─── 1) The column ────────────────────────────────────────────────
ALTER TABLE "WorkItemTransition" ADD COLUMN "fromStateCategory" "WorkflowStateCategory";

-- ─── 2) The trigger writes it ─────────────────────────────────────
--
-- 3.4a's function with the one column added: OLD is read on an update only.
CREATE OR REPLACE FUNCTION work_item_transition_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    from_category "WorkflowStateCategory" := NULL;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        from_category := OLD."stateCategory";
    END IF;
    INSERT INTO "WorkItemTransition"
        ("tenantId", "workItemId", "projectId", "teamId", "stateId", "stateCategory", "fromStateCategory", "cycleId", "milestoneId",
         "waitingOnUserId", "estimatePoints", "estimateMinutes", "deleted", "at")
    VALUES
        (NEW."tenantId", NEW."id", NEW."projectId", NEW."teamId", NEW."stateId", NEW."stateCategory", from_category,
         NEW."cycleId", NEW."milestoneId", NEW."waitingOnUserId", NEW."estimatePoints", NEW."estimateMinutes",
         NEW."deletedAt" IS NOT NULL, clock_timestamp() AT TIME ZONE 'UTC');
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION work_item_transition_record() FROM PUBLIC;

-- ─── 3) The backfill, once ────────────────────────────────────────
--
-- Each existing row takes its item's previous row's category, in the
-- record's own order (`at`, then `id`); an item's first row keeps NULL, as an
-- insert row does. Run by the migration's superuser: `app_user` still holds
-- SELECT alone on the record.
UPDATE "WorkItemTransition" AS t
SET "fromStateCategory" = p."previous"
FROM (
    SELECT "id", LAG("stateCategory") OVER (PARTITION BY "tenantId", "workItemId" ORDER BY "at", "id") AS "previous"
    FROM "WorkItemTransition"
) AS p
WHERE t."id" = p."id" AND p."previous" IS NOT NULL;

-- ─── 4) Completions, by an index ──────────────────────────────────
--
-- Prisma cannot declare a partial index; the drift check does not see it
-- (as 2.7b's search indexes and 3.2b's progress index). A query spells the
-- predicate exactly.
CREATE INDEX "WorkItemTransition_completions" ON "WorkItemTransition"("tenantId", "projectId", "at")
    WHERE "stateCategory" = 'DONE' AND "fromStateCategory" IS DISTINCT FROM 'DONE';
