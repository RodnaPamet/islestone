-- Sub-phase 3.2a: an item's direct goal is a configurable built-in field of
-- the field sets (owner decision 211; ADR 0002 §7): a type may require or
-- hide it. The stored CHECK widens to `goal`; every existing row passes.

ALTER TABLE "WorkItemTypeField" DROP CONSTRAINT "WorkItemTypeField_built_in_known";
ALTER TABLE "WorkItemTypeField" ADD CONSTRAINT "WorkItemTypeField_built_in_known"
    CHECK ("builtInField" IS NULL OR "builtInField" IN
        ('description', 'assignee', 'waitingOn', 'priority', 'labels', 'startDate', 'dueDate', 'cycle', 'milestone', 'answer', 'goal'));
