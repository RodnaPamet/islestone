-- Sub-phase 2.2: the due-date reminder's bell type (owner decision,
-- 2026-11-18, "In 2.2"). A bare ADD VALUE, alone in its migration
-- (tests/guards/migration-enum-isolation.test.ts). No reader meets it before
-- this release: the bell, the settings API and the emitter ship together, and
-- nothing has been deployed.
ALTER TYPE "NotificationType" ADD VALUE 'WORK_ITEM_DUE';
