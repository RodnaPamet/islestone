-- Sub-phase 2.6b: public intake forms (docs/porting/maps/2.6.md, "Tenant
-- resolution and the public surface"; owner decisions 86, 88, 89 and 98).
--
-- 1) Prisma's DDL: the requester's columns on "IntakeRequest" (name and
--    address encrypted in place by the PII extension, the address matched
--    through its lookup hash), the update opt-in and its confirmation, the
--    confirmation link's token hash (global: the link is resolved before any
--    workspace is known), the signed form token's nonce (one request per
--    token), and their indexes.
-- 2) The CHECKs that keep those columns in step with the channel.
-- No new table, so no new grant or policy: "IntakeRequest" keeps 2.6a's.
-- Each construct has a catalogue test
-- (tests/integration/intake-sql-constructs.test.ts).

-- ─── 1) Prisma DDL ────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "IntakeRequest" ADD COLUMN     "confirmTokenHash" TEXT,
ADD COLUMN     "formTokenNonce" TEXT,
ADD COLUMN     "requesterEmail" TEXT,
ADD COLUMN     "requesterEmailHash" TEXT,
ADD COLUMN     "requesterName" TEXT,
ADD COLUMN     "updatesConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "updatesRequested" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "IntakeRequest_confirmTokenHash_key" ON "IntakeRequest"("confirmTokenHash");

-- CreateIndex
CREATE INDEX "IntakeRequest_tenantId_requesterEmailHash_createdAt_idx" ON "IntakeRequest"("tenantId", "requesterEmailHash", "createdAt");

-- CreateIndex
CREATE INDEX "IntakeRequest_tenantId_channel_createdAt_idx" ON "IntakeRequest"("tenantId", "channel", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeRequest_tenantId_formTokenNonce_key" ON "IntakeRequest"("tenantId", "formTokenNonce");

-- ─── 2) CHECKs ────────────────────────────────────────────────────

-- A public request names the form it answered (forms are never deleted; a
-- project's purge removes its forms and requests together).
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_public_has_form"
    CHECK ("channel" <> 'PUBLIC_FORM' OR "formId" IS NOT NULL);
-- A member's request carries no outsider's details and no form token.
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_internal_has_no_outsider"
    CHECK ("channel" <> 'INTERNAL_FORM' OR ("requesterName" IS NULL AND "requesterEmail" IS NULL AND "formTokenNonce" IS NULL));
-- An address is stored with its lookup hash, never without.
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_email_has_hash"
    CHECK (("requesterEmail" IS NULL) = ("requesterEmailHash" IS NULL));
-- Updates are asked for, and confirmed, only with an address.
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_updates_need_email"
    CHECK (NOT "updatesRequested" OR "requesterEmail" IS NOT NULL);
ALTER TABLE "IntakeRequest" ADD CONSTRAINT "IntakeRequest_confirmed_asked"
    CHECK ("updatesConfirmedAt" IS NULL OR "updatesRequested");
