-- Issue #117 (owner decision 281, 2026-11-27): a purged project with time
-- entries leaves a tombstone (docs/work-items.md, "The purge"; the 3.4 map,
-- "Rules no decision names (3.4c, as built)").
--
-- Time entries are kept for the workspace's life, each with the project it
-- was recorded in (decisions 261 and 277; `TimeEntry.projectId` is NOT NULL).
-- The work-item purge removes a deleted project's items and everything the
-- project holds, but where time entries name it, it keeps a minimal project
-- row: the id, the workspace, the team, the name, the key prefix and when it
-- was deleted and by whom, marked `purgedAt`. Totals and exports stay
-- correct, and the key prefix is never reused (`Project_tenantId_keyPrefix_key`
-- and `ProjectKeyPrefix` both still hold it).
--
-- 1) `Project.purgedAt`: set only on a tombstone. A tombstone is deleted (so
--    every live read, visibility and search already leaves it out), names no
--    due date and no initiative, and can never be restored (the CHECK keeps
--    `deletedAt` set while `purgedAt` is).
-- 2) The time entries' link to their project becomes DEFERRABLE INITIALLY
--    IMMEDIATE: unchanged for every other write. The purge defers it in its
--    own transaction, deletes the project row (so every child goes by the
--    cascades the database already declares, as when a project without time
--    is purged) and inserts the tombstone under the same id before the
--    commit, when the deferred check finds the project again.
--
-- The previous image never reads `purgedAt` and never writes it; it purges
-- no project time names (3.4b's hold), so nothing it does meets the CHECK.

-- ─── 1) The tombstone's mark ──────────────────────────────────────
ALTER TABLE "Project" ADD COLUMN "purgedAt" TIMESTAMP(3);

ALTER TABLE "Project" ADD CONSTRAINT "Project_purged_is_tombstone"
    CHECK ("purgedAt" IS NULL OR ("deletedAt" IS NOT NULL AND "dueDate" IS NULL AND "initiativeId" IS NULL));

-- ─── 2) The deferrable link ───────────────────────────────────────
ALTER TABLE "TimeEntry" ALTER CONSTRAINT "TimeEntry_projectId_tenantId_fkey" DEFERRABLE INITIALLY IMMEDIATE;
