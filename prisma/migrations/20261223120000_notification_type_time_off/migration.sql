-- Sub-phase 3.5a: the time-off bell (docs/porting/maps/3.5.md, "Notifications";
-- ADR 0013; owner decision 300): someone else added, changed or removed your
-- time off. A bare ADD VALUE, alone in its migration
-- (tests/guards/migration-enum-isolation.test.ts). The preference CHECK that
-- names it follows in 20261223120100_workload, after this migration has
-- committed (Postgres refuses a new enum value in the transaction that added
-- it). Its writer ships in the same release; the previous image never reads it.
ALTER TYPE "NotificationType" ADD VALUE 'TIME_OFF_CHANGED_BY_OTHER';
