-- Sub-phase 3.4c: timesheets and their approval (docs/porting/maps/3.4.md,
-- "Notifications (decision 276)"; ADR 0012 §8; owner decision 276). A bare
-- ADD VALUE, alone in its migration (tests/guards/migration-enum-isolation.test.ts):
-- Postgres refuses a new enum value in the transaction that added it, so the
-- preference CHECK that names TIMESHEET_RETURNED is widened in
-- 20261222120500_timesheets, after this has committed.
--
-- A member submitted their week: to whoever approves weeks (the settings' recipient list, else every holder of time.approve).
ALTER TYPE "NotificationType" ADD VALUE 'TIMESHEET_SUBMITTED';
