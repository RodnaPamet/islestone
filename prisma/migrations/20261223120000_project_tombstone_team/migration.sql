-- Issue #120 (owner decision 305, 2026-11-27): a purged project's tombstone
-- drops its team, so the team can be deleted (docs/work-items.md, "The purge
-- and project tombstones").
--
-- `Project.teamId` is NULL only on a tombstone (CHECK
-- `Project_team_unless_tombstone`): a live or deleted project always has its
-- team. The purge clears it in the transaction that writes the tombstone
-- (`WorkItemRepository.tombstoneProject`), and a team's delete then counts no
-- tombstone (`TeamRepository.countProjects` counts the rows naming the team).
--
-- The composite keys that pair a project with its team cannot break: only
-- `WorkItem` references `Project(id, teamId, tenantId)`, and a tombstone has
-- no work item left (its children went by their cascades before it was
-- written); its cycles and states are its team's, never its own.
--
-- Tombstones written before this migration (3.4c) drop their team here. The
-- previous image writes a tombstone with its team, which the CHECK allows
-- (it asks a team only of a project that is not a tombstone), and never
-- reads a tombstone's team.

UPDATE "Project" SET "teamId" = NULL WHERE "purgedAt" IS NOT NULL;
ALTER TABLE "Project" ALTER COLUMN "teamId" DROP NOT NULL;
ALTER TABLE "Project" ADD CONSTRAINT "Project_team_unless_tombstone"
    CHECK ("teamId" IS NOT NULL OR "purgedAt" IS NOT NULL);
