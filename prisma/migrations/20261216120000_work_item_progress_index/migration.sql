-- Sub-phase 3.2b: the project path of an initiative's and a goal's progress
-- (docs/porting/maps/3.2.md, "Progress, derived"; owner decision 212). The
-- direct-goal path reads `WorkItem_tenantId_goalId_stateCategory_idx` (3.2a).
--
-- Partial, and only in SQL (Prisma cannot declare the predicate): the
-- progress count reads live, non-cancelled items only (`countsByProjects`
-- names both predicates), and nothing else does. A plain
-- [tenantId, projectId, stateCategory] index measured on the 10k seed pulled
-- the list sorted by key, the templates' open items and a purged project's
-- read off their indexes (a purged project's 418 buffers against its 400);
-- partial, no other read's predicate implies it but the count's, and every
-- plan check keeps its index (docs/goals.md, "Progress").

-- CreateIndex
CREATE INDEX "WorkItem_progress_project_path" ON "WorkItem"("tenantId", "projectId", "stateCategory")
    WHERE "deletedAt" IS NULL AND "stateCategory" <> 'CANCELLED';
