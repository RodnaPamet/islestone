-- ═══════════════════════════════════════════════════════════════════
-- Sub-phase 1.4 — authentication, sign-in sessions, MFA, invites and
-- custom roles (docs/porting/maps/1.4.md, "Prisma models and migrations").
--
-- Written fresh; no inflect-compliance migration is replayed. The final
-- shapes were read from inflect-compliance at
-- 5528464fc54a8681956f3b9ce23ca9c075f0420e (PROVENANCE.md names the source
-- migrations). Sections:
--   1. Enums, tables, indexes and FKs, as `prisma migrate diff` generates
--      them from prisma/schema.
--   2. Grants to app_user for every table created here.
--   3. Canonical RLS on the direct tenant tables.
--   4. The asymmetric single policy on UserSession (nullable tenantId).
--   5. CHECKs: no custom role on an OWNER membership; no custom role built
--      on OWNER. Both VALID from the start: the tables are new. And the
--      partial unique index on live custom-role names.
--   6. Account, VerificationToken, PasswordResetToken (global) and OrgInvite
--      (org-scoped): no RLS.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1) Enums, tables, indexes, FKs (generated) ───────────────────
-- CreateEnum
CREATE TYPE "MfaPolicy" AS ENUM ('DISABLED', 'OPTIONAL', 'REQUIRED');

-- CreateEnum
CREATE TYPE "MfaType" AS ENUM ('TOTP');

-- CreateEnum
CREATE TYPE "OrgAuditAction" AS ENUM ('ORG_MEMBER_ADDED', 'ORG_MEMBER_REMOVED', 'ORG_MEMBER_ROLE_CHANGED', 'ORG_ADMIN_PROVISIONED_TO_TENANTS', 'ORG_ADMIN_DEPROVISIONED_FROM_TENANTS', 'ORG_INVITE_CREATED', 'ORG_INVITE_REDEEMED', 'ORG_INVITE_REVOKED', 'ORG_AUTHZ_DENIED');

-- AlterTable
ALTER TABLE "TenantMembership" ADD COLUMN     "customRoleId" TEXT;

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "mfaPassedTenantIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMfaEnrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "MfaType" NOT NULL DEFAULT 'TOTP',
    "secretEncrypted" TEXT NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "lastChallengeAt" TIMESTAMP(3),
    "lastAcceptedTotpStep" INTEGER,
    "backupCodesHashJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMfaEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSecuritySettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mfaPolicy" "MfaPolicy" NOT NULL DEFAULT 'DISABLED',
    "sessionMaxAgeMinutes" INTEGER,
    "maxConcurrentSessions" INTEGER,
    "mfaFailClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSecuritySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantInvite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "token" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'ORG_READER',
    "token" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantCustomRole" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "baseRole" "Role" NOT NULL DEFAULT 'VIEWER',
    "grantsJson" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantCustomRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_sessionId_key" ON "UserSession"("sessionId");

-- CreateIndex
CREATE INDEX "UserSession_tenantId_idx" ON "UserSession"("tenantId");

-- CreateIndex
CREATE INDEX "UserSession_tenantId_revokedAt_idx" ON "UserSession"("tenantId", "revokedAt");

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");

-- CreateIndex
CREATE INDEX "UserSession_userId_revokedAt_idx" ON "UserSession"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "UserMfaEnrollment_tenantId_idx" ON "UserMfaEnrollment"("tenantId");

-- CreateIndex
CREATE INDEX "UserMfaEnrollment_userId_idx" ON "UserMfaEnrollment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserMfaEnrollment_userId_tenantId_type_key" ON "UserMfaEnrollment"("userId", "tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "TenantSecuritySettings_tenantId_key" ON "TenantSecuritySettings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantInvite_token_key" ON "TenantInvite"("token");

-- CreateIndex
CREATE INDEX "TenantInvite_tenantId_idx" ON "TenantInvite"("tenantId");

-- CreateIndex
CREATE INDEX "TenantInvite_invitedById_idx" ON "TenantInvite"("invitedById");

-- CreateIndex
CREATE UNIQUE INDEX "TenantInvite_tenantId_email_key" ON "TenantInvite"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "OrgInvite_token_key" ON "OrgInvite"("token");

-- CreateIndex
CREATE INDEX "OrgInvite_organizationId_idx" ON "OrgInvite"("organizationId");

-- CreateIndex
CREATE INDEX "OrgInvite_invitedById_idx" ON "OrgInvite"("invitedById");

-- CreateIndex
CREATE UNIQUE INDEX "OrgInvite_organizationId_email_key" ON "OrgInvite"("organizationId", "email");

-- CreateIndex
CREATE INDEX "TenantCustomRole_tenantId_idx" ON "TenantCustomRole"("tenantId");

-- CreateIndex
CREATE INDEX "TenantCustomRole_tenantId_isActive_idx" ON "TenantCustomRole"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "TenantCustomRole_tenantId_name_idx" ON "TenantCustomRole"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TenantCustomRole_id_tenantId_key" ON "TenantCustomRole"("id", "tenantId");

-- CreateIndex
CREATE INDEX "TenantMembership_customRoleId_idx" ON "TenantMembership"("customRoleId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMfaEnrollment" ADD CONSTRAINT "UserMfaEnrollment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMfaEnrollment" ADD CONSTRAINT "UserMfaEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSecuritySettings" ADD CONSTRAINT "TenantSecuritySettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantInvite" ADD CONSTRAINT "TenantInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantInvite" ADD CONSTRAINT "TenantInvite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgInvite" ADD CONSTRAINT "OrgInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgInvite" ADD CONSTRAINT "OrgInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantCustomRole" ADD CONSTRAINT "TenantCustomRole_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "TenantCustomRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── 2) Grants ────────────────────────────────────────────────────
--
-- Every table this migration creates, granted explicitly (see the 1.3
-- migration, section 2, for why ALTER DEFAULT PRIVILEGES is not enough).
GRANT SELECT, INSERT, UPDATE, DELETE ON "Account", "UserSession", "VerificationToken", "PasswordResetToken", "UserMfaEnrollment", "TenantSecuritySettings", "TenantInvite", "OrgInvite", "TenantCustomRole" TO app_user;

-- ─── 3) Canonical RLS on the direct tenant tables ─────────────────
--
-- The shape of docs/rls-tenant-isolation.md, "Adding a new tenant-scoped
-- table": tenant_isolation, tenant_isolation_insert, superuser_bypass keyed
-- on the role alone, ENABLE and FORCE.

ALTER TABLE "UserMfaEnrollment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserMfaEnrollment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "UserMfaEnrollment"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "UserMfaEnrollment"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "UserMfaEnrollment"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "TenantSecuritySettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantSecuritySettings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantSecuritySettings"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "TenantSecuritySettings"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "TenantSecuritySettings"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "TenantInvite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantInvite" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantInvite"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "TenantInvite"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "TenantInvite"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "TenantCustomRole" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantCustomRole" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantCustomRole"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "TenantCustomRole"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "TenantCustomRole"
    USING (current_setting('role') != 'app_user');

-- ─── 4) UserSession: the asymmetric single policy ─────────────────
--
-- `tenantId` is nullable: a session row may be written before a workspace
-- is chosen. ONE tenant_isolation policy: USING admits the caller's own
-- tenant and NULL rows, WITH CHECK admits only the caller's own tenant. A
-- separate tenant_isolation_insert would be a permissive sibling that lets
-- app_user UPDATE a NULL row to any tenantId. Copied from inflect-compliance
-- `20260423150000_epic_d1_user_session_rls`.

ALTER TABLE "UserSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserSession" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "UserSession"
    USING (
        "tenantId" IS NULL
        OR "tenantId" = current_setting('app.tenant_id', true)::text
    )
    WITH CHECK (
        "tenantId" = current_setting('app.tenant_id', true)::text
    );
CREATE POLICY superuser_bypass ON "UserSession"
    USING (current_setting('role') != 'app_user');

-- ─── 5) Built-in-scope CHECKs ─────────────────────────────────────
--
-- A custom role REPLACES a membership's permissions, so on an OWNER it would
-- be a demotion an ADMIN could perform while every last-OWNER check still
-- read OWNER. Neither table holds rows yet, so both are VALID at once (the
-- parent's NOT VALID dance existed for legacy rows). Phase 6 adds AI_ADMIN
-- to both lists.

ALTER TABLE "TenantMembership"
    ADD CONSTRAINT "TenantMembership_built_in_scope_role_no_custom_role"
    CHECK (NOT ("role" = 'OWNER' AND "customRoleId" IS NOT NULL));

ALTER TABLE "TenantCustomRole"
    ADD CONSTRAINT "TenantCustomRole_base_role_not_built_in_scope"
    CHECK ("baseRole" <> 'OWNER');

-- A live custom role's name is unique in its workspace; a deactivated one
-- frees its name. Prisma cannot express a partial index, and `prisma migrate
-- diff` ignores one, so it lives here only; `assertCustomRoleNameFree` in
-- src/app-layer/usecases/custom-roles.ts mirrors it to give a readable 409.
-- Source: inflect-compliance `20261029190000_custom_role_name_unique_among_live`.
CREATE UNIQUE INDEX "TenantCustomRole_tenantId_name_key"
    ON "TenantCustomRole"("tenantId", "name")
    WHERE "isActive";

-- ─── 6) No RLS on the global and org-scoped tables ────────────────
--
-- Account, VerificationToken and PasswordResetToken belong to a user, not a
-- workspace: sign-in, email verification and password reset run before any
-- workspace is chosen, on the global client. OrgInvite is org-scoped and is
-- isolated by getOrgCtx, as Organization and OrgMembership are.
