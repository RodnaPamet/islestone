-- Sub-phase 2.6b: the four outbound email types a public form's requester
-- may receive (docs/porting/maps/2.6.md, "What the requester sees"; owner
-- decision 89). Bare ADD VALUEs, alone in their migration
-- (tests/guards/migration-enum-isolation.test.ts).
--
-- Their writers ship in the same release, as 2.6a's bell types did, but no
-- row of these types can be written until an operator opens public forms
-- (`INTAKE_PUBLIC_FORMS`, off in production by default, decision 86): only a
-- public request is ever confirmed or told anything, so the release is live
-- on both images before the first such outbox row exists.
ALTER TYPE "EmailNotificationType" ADD VALUE 'INTAKE_CONFIRM_ADDRESS';
ALTER TYPE "EmailNotificationType" ADD VALUE 'INTAKE_ACCEPTED';
ALTER TYPE "EmailNotificationType" ADD VALUE 'INTAKE_DECLINED';
ALTER TYPE "EmailNotificationType" ADD VALUE 'INTAKE_MERGED';
