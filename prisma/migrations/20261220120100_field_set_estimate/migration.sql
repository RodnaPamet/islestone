-- Sub-phase 3.4a: the estimate is a configurable built-in field of the field
-- sets (owner decision 257; ADR 0002 §18): a type may require or hide it. The
-- stored CHECK widens to `estimate`; every existing row passes. A rule on a
-- team that does not estimate is ignored by the evaluation
-- (src/lib/work-items/field-sets.ts), never refused here.

ALTER TABLE "WorkItemTypeField" DROP CONSTRAINT "WorkItemTypeField_built_in_known";
ALTER TABLE "WorkItemTypeField" ADD CONSTRAINT "WorkItemTypeField_built_in_known"
    CHECK ("builtInField" IS NULL OR "builtInField" IN
        ('description', 'assignee', 'waitingOn', 'priority', 'labels', 'startDate', 'dueDate', 'cycle', 'milestone', 'answer', 'goal', 'estimate'));
