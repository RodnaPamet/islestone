-- Sub-phase 2.8a: review steps (docs/porting/maps/2.8.md; ADR 0009; owner
-- decision 161). A bare ADD VALUE, alone in its migration
-- (tests/guards/migration-enum-isolation.test.ts): Postgres refuses a new
-- enum value in the transaction that added it, so the preference CHECK that
-- names it is widened in 20261208120600_reviews, after this has committed.
--
-- A reviewer returned the item: to its assignee and whoever sent the round.
ALTER TYPE "NotificationType" ADD VALUE 'WORK_ITEM_REVIEW_RETURNED';
