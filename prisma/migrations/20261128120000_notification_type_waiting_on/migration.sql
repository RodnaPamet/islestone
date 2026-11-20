-- Sub-phase 2.4b-a: the waiting-on bell type (docs/porting/maps/2.4b.md;
-- owner decision 105). A bare ADD VALUE, alone in its migration
-- (tests/guards/migration-enum-isolation.test.ts). The bell, the settings API
-- entry and the emitter ship in the same release.
ALTER TYPE "NotificationType" ADD VALUE 'WORK_ITEM_WAITING_ON';
