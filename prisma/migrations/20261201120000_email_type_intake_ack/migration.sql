-- Sub-phase 2.6c: the acknowledgement an emailed request's sender receives
-- when their domain's authentication passed (docs/porting/maps/2.6.md
-- "Inbound email"; owner decisions 89 and 123). A bare ADD VALUE, alone in its
-- migration (tests/guards/migration-enum-isolation.test.ts).
--
-- Its writer ships in the same release, as 2.6b's did, but cannot run until an
-- operator opens inbound email (`INTAKE_EMAIL`, off in production by default):
-- only a received email is ever acknowledged.
ALTER TYPE "EmailNotificationType" ADD VALUE 'INTAKE_RECEIVED_ACK';
