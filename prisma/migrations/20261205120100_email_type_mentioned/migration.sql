-- Sub-phase 2.7d: the email a mentioned person receives at once when their
-- preference for mentions says IMMEDIATE (owner decisions 128, 130 and 132;
-- the default). A bare ADD VALUE, alone in its migration
-- (tests/guards/migration-enum-isolation.test.ts).
--
-- Its writer ships in the same release and is reachable at once. While
-- Watchtower rolls the images, a worker still on the previous image cannot
-- read an outbox row of this type: its drain fails that tick and the next
-- tick on the new image sends the row (each row is claimed before its send).
ALTER TYPE "EmailNotificationType" ADD VALUE 'WORK_ITEM_MENTIONED';
