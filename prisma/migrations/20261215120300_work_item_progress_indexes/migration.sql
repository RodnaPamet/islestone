-- Sub-phase 3.2: a project's items by category, the project path of an
-- initiative's and a goal's progress (docs/porting/maps/3.2.md, "The model";
-- decision 212). The direct-goal path reads
-- `WorkItem_tenantId_goalId_stateCategory_idx` (the previous migration).

-- CreateIndex
CREATE INDEX "WorkItem_tenantId_projectId_stateCategory_idx" ON "WorkItem"("tenantId", "projectId", "stateCategory");
