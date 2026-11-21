-- Hardening H2a: three list indexes the plan checks on the 10k seed found
-- missing (owner decisions 168 and 172; docs/performance.md, "Findings").
--
-- Each list sort is backed per project ([tenantId, projectId, <column>, id],
-- ADR 0002 §13), but three reads order across projects and read EVERY
-- matching row before sorting, so their cost grows with the workspace:
--
--   - the Work items page's default, the whole workspace in manual order
--     (`sortKey`, then `id`);
--   - My Work's "Assigned to me", a member's items in manual order (the
--     heaviest member held about a fifth of a workspace's items);
--   - the Work items page sorted by due date across projects (the map's
--     named scenario, part 1.4).
--
-- With these the planner walks the index in order and stops after one page.
-- `sortKey` is `COLLATE "C"` on the column (20261119160100_work_core), so the
-- index orders exactly as `ORDER BY "sortKey" COLLATE "C"` asks.
--
-- Additive: the previous image ignores them.

-- CreateIndex
CREATE INDEX "WorkItem_tenantId_sortKey_id_idx" ON "WorkItem"("tenantId", "sortKey", "id");

-- CreateIndex
CREATE INDEX "WorkItem_tenantId_assigneeId_sortKey_id_idx" ON "WorkItem"("tenantId", "assigneeId", "sortKey", "id");

-- CreateIndex
CREATE INDEX "WorkItem_tenantId_dueDate_id_idx" ON "WorkItem"("tenantId", "dueDate", "id");
