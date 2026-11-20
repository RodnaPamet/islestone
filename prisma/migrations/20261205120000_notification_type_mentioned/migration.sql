-- Sub-phase 2.7d: the mention bell type (docs/porting/maps/2.7.md, part 5;
-- owner decisions 127 to 130). A bare ADD VALUE, alone in its migration
-- (tests/guards/migration-enum-isolation.test.ts). Its writer
-- (`createMentionNotifications`) ships in the same release; the preference
-- CHECK that names it is widened in 20261205120200_mentions, after this
-- migration has committed (Postgres refuses a new enum value in the
-- transaction that added it).
ALTER TYPE "NotificationType" ADD VALUE 'WORK_ITEM_MENTIONED';
