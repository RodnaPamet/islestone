-- Sub-phase 2.7c: the one daily digest email (owner decision 133), which
-- replaces 1.6's `DUE_DIGEST` (never written: it had no caller). A bare ADD
-- VALUE, alone in its migration (tests/guards/migration-enum-isolation.test.ts).
-- Its writer is the `notification-digest` job, on the worker image of the
-- same release.
ALTER TYPE "EmailNotificationType" ADD VALUE 'NOTIFICATION_DIGEST';
