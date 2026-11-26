-- Roadmap 3.3c: the calendar read-back's one bell type (docs/porting/maps/3.3.md,
-- "The read-back"; ADR 0011 §1; owner decisions 227 and 230). A bare ADD VALUE,
-- alone in its migration (tests/guards/migration-enum-isolation.test.ts). Its
-- writer (`createCalendarChangeNotAppliedNotification`) ships in the same
-- release; the preference CHECK that names it follows in
-- 20261219120100_calendar_read_back, after this migration has committed
-- (Postgres refuses a new enum value in the transaction that added it).
ALTER TYPE "NotificationType" ADD VALUE 'CALENDAR_CHANGE_NOT_APPLIED';
