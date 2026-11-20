-- Sub-phase 2.7c: the email the person a work item now waits on receives at
-- once when their preference says IMMEDIATE (docs/porting/maps/2.7.md,
-- part 4; owner decision 132). A bare ADD VALUE, alone in its migration
-- (tests/guards/migration-enum-isolation.test.ts).
--
-- Its writer ships in the same release and is reachable at once. While
-- Watchtower rolls the images, a worker still on the previous image cannot
-- read an outbox row of this type: its drain fails that tick and the next
-- tick on the new image sends the row (each row is claimed before its send).
ALTER TYPE "EmailNotificationType" ADD VALUE 'WORK_ITEM_WAITING_ON';
