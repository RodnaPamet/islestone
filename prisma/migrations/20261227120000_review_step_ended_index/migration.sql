-- Sub-phase 3.6b, time waiting (owner decision 317; docs/porting/maps/3.6.md,
-- "Time waiting"): a reviewer waits from a step's opening to their response,
-- their withdrawal or the step's end. The read (`ReviewRepository.reviewSpans`)
-- finds a window's steps as the open ones (`WorkItemReviewStep_tenantId_status_dueOn_idx`)
-- and the ones that ended in or after the window, by this index. Tenant-leading.
CREATE INDEX "WorkItemReviewStep_tenantId_endedAt_idx" ON "WorkItemReviewStep"("tenantId", "endedAt");
