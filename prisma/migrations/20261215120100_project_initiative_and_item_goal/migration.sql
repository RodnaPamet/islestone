-- Sub-phase 3.2a: a project's initiative and a work item's direct goal
-- (docs/porting/maps/3.2.md; ADR 0002 §2; owner decisions 211 and 219).
--
-- Two nullable columns the previous image never names, each with its
-- column-scoped `ON DELETE SET NULL` key, so the purge clears the link and
-- keeps `tenantId`, and the index that backs the key. The transition trigger
-- (`work_item_transition_record`) does not watch `goalId`: a goal change
-- records no transition and the purge's unlink fires none.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "initiativeId" TEXT;

-- AlterTable
ALTER TABLE "WorkItem" ADD COLUMN     "goalId" TEXT;

-- CreateIndex
CREATE INDEX "Project_tenantId_initiativeId_idx" ON "Project"("tenantId", "initiativeId");

-- CreateIndex
CREATE INDEX "WorkItem_tenantId_goalId_stateCategory_idx" ON "WorkItem"("tenantId", "goalId", "stateCategory");

ALTER TABLE "Project" ADD CONSTRAINT "Project_initiativeId_tenantId_fkey" FOREIGN KEY ("initiativeId", "tenantId") REFERENCES "Initiative"("id", "tenantId") ON DELETE SET NULL ("initiativeId") ON UPDATE NO ACTION;

ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_goalId_tenantId_fkey" FOREIGN KEY ("goalId", "tenantId") REFERENCES "Goal"("id", "tenantId") ON DELETE SET NULL ("goalId") ON UPDATE NO ACTION;
