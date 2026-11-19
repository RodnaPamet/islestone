-- ═══════════════════════════════════════════════════════════════════
-- Sub-phase 1.5 — the security perimeter's tables and columns
-- (docs/porting/maps/1.5.md, "Prisma models and migrations").
--
-- Written fresh; no inflect-compliance migration is replayed. The final
-- shapes were read from inflect-compliance at
-- 5528464fc54a8681956f3b9ce23ca9c075f0420e (PROVENANCE.md names the source
-- migrations). Sections:
--   0. A refusal: this migration does not run against a database that
--      already holds users (their addresses are plaintext and have no
--      lookup hash, and SQL cannot compute the HMAC the app keys).
--   1. Enums, tables, columns, indexes and FKs, as `prisma migrate diff`
--      generates them from prisma/schema.
--   2. `User.emailHash` NOT NULL in the database (nullable in the schema
--      on purpose; the drift residue carries the one line this leaves).
--   3. The DEK rotation CHECK and partial index on Tenant.
--   4. Grants: SELECT and INSERT only on both audit logs; the outbox in
--      full.
--   5. Canonical RLS on AuditLog and AuditOutbox.
--   6. The immutability triggers on AuditLog (one admitted UPDATE: the
--      pseudonymisation of userId) and OrgAuditLog (none).
-- ═══════════════════════════════════════════════════════════════════

-- ─── 0) Refuse a database that already holds users ────────────────
--
-- 1.3 stored `User.email` as plaintext with no lookup hash. This
-- migration makes the column ciphertext and `emailHash` NOT NULL, and
-- the hash is an HMAC under a key only the application holds, so SQL
-- cannot backfill it. No deployment holds users yet (hosting is 1.8);
-- a database that does must be rebuilt from the migrations, or
-- backfilled by a script that loads the PII extension, before this runs.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "User") THEN
        RAISE EXCEPTION 'security_perimeter: "User" already holds rows whose email is plaintext and has no emailHash. Rebuild the database from prisma/migrations, or backfill the rows through the PII extension, before applying this migration.';
    END IF;
END
$$;

-- ─── 1) Enums, tables, columns, indexes, FKs (generated) ──────────
-- CreateEnum
CREATE TYPE "AuditOutboxStatus" AS ENUM ('PENDING', 'APPLIED', 'FAILED');

-- DropIndex
DROP INDEX "User_email_key";

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "encryptedDek" TEXT,
ADD COLUMN     "previousEncryptedDek" TEXT;

-- AlterTable
ALTER TABLE "TenantSecuritySettings" ADD COLUMN     "auditStreamSecretEncrypted" TEXT,
ADD COLUMN     "auditStreamUrl" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailHash" TEXT;

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadataJson" JSONB,
    "recordIds" JSONB,
    "requestId" TEXT,
    "diffJson" JSONB,
    "actorType" TEXT NOT NULL DEFAULT 'USER',
    "detailsJson" JSONB,
    "entryHash" TEXT,
    "previousHash" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgAuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'USER',
    "action" "OrgAuditAction" NOT NULL,
    "subjectUserId" TEXT,
    "detailsJson" JSONB,
    "requestId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entryHash" TEXT NOT NULL,
    "previousHash" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "OrgAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditOutbox" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "action" TEXT NOT NULL,
    "status" "AuditOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "appliedAuditId" TEXT,

    CONSTRAINT "AuditOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_idx" ON "AuditLog"("tenantId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_entity_idx" ON "AuditLog"("tenantId", "entity");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_action_idx" ON "AuditLog"("tenantId", "action");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_entryHash_idx" ON "AuditLog"("tenantId", "entryHash");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_id_tenantId_key" ON "AuditLog"("id", "tenantId");

-- CreateIndex
CREATE INDEX "OrgAuditLog_organizationId_occurredAt_idx" ON "OrgAuditLog"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "OrgAuditLog_organizationId_action_idx" ON "OrgAuditLog"("organizationId", "action");

-- CreateIndex
CREATE INDEX "OrgAuditLog_organizationId_entryHash_idx" ON "OrgAuditLog"("organizationId", "entryHash");

-- CreateIndex
CREATE INDEX "OrgAuditLog_actorUserId_idx" ON "OrgAuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "OrgAuditLog_subjectUserId_idx" ON "OrgAuditLog"("subjectUserId");

-- CreateIndex
CREATE INDEX "AuditOutbox_status_nextAttemptAt_idx" ON "AuditOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AuditOutbox_tenantId_idx" ON "AuditOutbox"("tenantId");

-- CreateIndex
CREATE INDEX "AuditOutbox_tenantId_status_idx" ON "AuditOutbox"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AuditOutbox_tenantId_action_status_idx" ON "AuditOutbox"("tenantId", "action", "status");

-- CreateIndex
CREATE UNIQUE INDEX "User_emailHash_key" ON "User"("emailHash");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgAuditLog" ADD CONSTRAINT "OrgAuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgAuditLog" ADD CONSTRAINT "OrgAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgAuditLog" ADD CONSTRAINT "OrgAuditLog_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditOutbox" ADD CONSTRAINT "AuditOutbox_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── 2) emailHash is NOT NULL in the database ─────────────────────
--
-- Nullable in prisma/schema on purpose (inflect-compliance GAP-21): the PII
-- extension fills it on every write, so no create has to name it, and the
-- database still refuses a row without it. tests/guards/pii-hash-not-null.test.ts
-- holds both halves; prisma/fresh-db-schema-drift.expected.sql carries the
-- `DROP NOT NULL` line this leaves.
ALTER TABLE "User" ALTER COLUMN "emailHash" SET NOT NULL;

-- ─── 3) DEK rotation: CHECK and in-flight index on Tenant ─────────
--
-- From inflect-compliance 20260424010000_add_tenant_previous_encrypted_dek.
-- The CHECK refuses an outgoing DEK equal to the current one (a silent
-- key-mixing guard); the partial index finds rotations in flight. Prisma's
-- schema expresses neither, and `prisma migrate diff` sees neither.
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_previousEncryptedDek_differs"
    CHECK ("previousEncryptedDek" IS NULL OR "previousEncryptedDek" != "encryptedDek");
CREATE INDEX "Tenant_rotation_in_flight_idx" ON "Tenant"("id") WHERE "previousEncryptedDek" IS NOT NULL;

-- ─── 4) Grants ─────────────────────────────────────────────────────
--
-- Both logs are append-only for app_user: SELECT and INSERT, no UPDATE,
-- DELETE or TRUNCATE (inflect-compliance 20260324010000 and 20260430052807).
-- The outbox is drained and its status moved, so app_user holds the four.
GRANT SELECT, INSERT ON "AuditLog" TO app_user;
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM app_user;
GRANT SELECT, INSERT ON "OrgAuditLog" TO app_user;
REVOKE UPDATE, DELETE, TRUNCATE ON "OrgAuditLog" FROM app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "AuditOutbox" TO app_user;

-- ─── 5) Canonical RLS on the tenant tables ────────────────────────
--
-- The shape of docs/rls-tenant-isolation.md, "Adding a new tenant-scoped
-- table". OrgAuditLog is written and read with the global client, as in
-- inflect-compliance, and carries no RLS.

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "AuditLog"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "AuditLog"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "AuditOutbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditOutbox" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditOutbox"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "AuditOutbox"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "AuditOutbox"
    USING (current_setting('role') != 'app_user');

-- ─── 6) Immutability triggers ─────────────────────────────────────
--
-- AuditLog: the FINAL guard of inflect-compliance
-- 20260917130000_audit_log_immutable_permit_pseudonymization. It admits
-- exactly one UPDATE, `userId` from a value to NULL with every other
-- column unchanged (the erasure writer, sub-phase 8.3, which must also
-- record an ERASURE_EXECUTED entry so the chain still verifies), and
-- refuses every DELETE.
CREATE OR REPLACE FUNCTION audit_log_immutable_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD."userId" IS NOT NULL
       AND NEW."userId" IS NULL
       AND to_jsonb(NEW) - 'userId' = to_jsonb(OLD) - 'userId'
    THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION
        'IMMUTABLE_AUDIT_LOG: % operations on "AuditLog" are forbidden. '
        'Audit log entries are append-only and cannot be modified or removed. '
        'The ONLY permitted UPDATE is pseudonymization: "userId" from a '
        'value to NULL with every other column unchanged (docs/audit-trail.md).',
        TG_OP
    USING ERRCODE = 'restrict_violation';
    RETURN NULL; -- never reached
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_immutable
    BEFORE UPDATE OR DELETE ON "AuditLog"
    FOR EACH ROW
    EXECUTE FUNCTION audit_log_immutable_guard();

-- OrgAuditLog: from inflect-compliance 20260430052807_epic_b_org_audit_log.
-- No UPDATE and no DELETE, ever.
CREATE OR REPLACE FUNCTION org_audit_log_immutable_guard()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'IMMUTABLE_ORG_AUDIT_LOG: % operations on "OrgAuditLog" are forbidden. '
        'Org audit log entries are append-only and cannot be modified or removed.',
        TG_OP
    USING ERRCODE = 'restrict_violation';
    RETURN NULL; -- never reached
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER org_audit_log_immutable
    BEFORE UPDATE OR DELETE ON "OrgAuditLog"
    FOR EACH ROW
    EXECUTE FUNCTION org_audit_log_immutable_guard();
