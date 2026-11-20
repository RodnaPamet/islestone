-- Sub-phase 2.4b-b: a repeat whose copy would break its type's field set is
-- held with this reason (docs/porting/maps/2.4b.md; owner decision 111). A
-- bare ADD VALUE, alone in its migration
-- (tests/guards/migration-enum-isolation.test.ts).
ALTER TYPE "RecurrenceHold" ADD VALUE 'FIELD_SET_UNMET';
