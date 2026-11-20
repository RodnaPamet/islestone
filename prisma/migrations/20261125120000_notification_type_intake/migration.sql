-- Sub-phase 2.6a: the two intake bell types (docs/porting/maps/2.6.md;
-- owner decisions 90 and 95). Bare ADD VALUEs, alone in their migration
-- (tests/guards/migration-enum-isolation.test.ts). The bell, the settings API
-- and the emitters ship in the same release.
ALTER TYPE "NotificationType" ADD VALUE 'INTAKE_REQUEST_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'INTAKE_REQUEST_WOKEN';
