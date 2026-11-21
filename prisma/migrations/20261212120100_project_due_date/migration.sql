-- Roadmap 3.1a: the project's due date (owner decision 188; ADR 0002 §16;
-- ADR 0010 §3). Optional and date-only, like a milestone's: a deadline for
-- the schedule and nothing else. No CHECK and no index: it is never refused
-- against its items' or milestones' dates, and it is read with its project.
--
-- An added nullable column: the previous image neither reads nor writes it.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "dueDate" DATE;
