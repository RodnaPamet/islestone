-- ═══════════════════════════════════════════════════════════════════
-- Sub-phase 1.3 — tenancy and data core. Islestone's first migration.
--
-- Written fresh (docs/porting/maps/1.3.md, "Migration — write fresh"); no
-- inflect-compliance migration is replayed. Sections:
--   1. Enums, tables, indexes and FKs, as `prisma migrate diff` generates them
--      from prisma/schema.
--   2. The app_user role and its grants.
--   3. Class-A RLS on TenantMembership (the tenant axis).
--   4. Org-axis RLS on Organization and OrgMembership.
--   5. Tenant and User: global, no RLS.
--   6. The tenant last-owner trigger, final serialised form.
--   7. The org last-owner trigger, final serialised form.
--   8. How both triggers read under RLS.
-- The SQL in 2, 3, 4, 6 and 7 is copied from inflect-compliance at
-- 5528464fc54a8681956f3b9ce23ca9c075f0420e (PROVENANCE.md names the source
-- migrations); the role literals are Islestone's.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1) Enums, tables, indexes, FKs (generated) ───────────────────
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('ORG_OWNER', 'ORG_ADMIN', 'ORG_READER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'DEACTIVATED', 'REMOVED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgMembership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'ORG_READER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "organizationId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMembership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedAt" TIMESTAMP(3),
    "invitedByUserId" TEXT,
    "deactivatedAt" TIMESTAMP(3),
    "provisionedByOrgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "passwordHash" TEXT,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "OrgMembership_organizationId_idx" ON "OrgMembership"("organizationId");

-- CreateIndex
CREATE INDEX "OrgMembership_userId_idx" ON "OrgMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgMembership_organizationId_userId_key" ON "OrgMembership"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Tenant_organizationId_idx" ON "Tenant"("organizationId");

-- CreateIndex
CREATE INDEX "TenantMembership_tenantId_status_idx" ON "TenantMembership"("tenantId", "status");

-- CreateIndex
CREATE INDEX "TenantMembership_userId_status_idx" ON "TenantMembership"("userId", "status");

-- CreateIndex
CREATE INDEX "TenantMembership_invitedByUserId_idx" ON "TenantMembership"("invitedByUserId");

-- CreateIndex
CREATE INDEX "TenantMembership_provisionedByOrgId_idx" ON "TenantMembership"("provisionedByOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMembership_tenantId_userId_key" ON "TenantMembership"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMembership_id_tenantId_key" ON "TenantMembership"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "OrgMembership" ADD CONSTRAINT "OrgMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMembership" ADD CONSTRAINT "OrgMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_provisionedByOrgId_fkey" FOREIGN KEY ("provisionedByOrgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── 2) The app_user role and grants ──────────────────────────────
--
-- runInTenantContext switches to this NOLOGIN role (`SET LOCAL ROLE app_user`)
-- so the policies below apply. This migration never names a login role:
-- granting app_user to the login role is done outside it, by
-- prisma/init-roles.sh locally and by a CI step.

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOLOGIN;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- Every table this migration creates, granted explicitly. ALTER DEFAULT
-- PRIVILEGES covers only tables later created by the role that ran it; once
-- migrations run as a separate migrator role (sub-phase 1.8), a table without
-- its own GRANT is invisible to app_user. So every later migration that
-- creates a table carries its own `GRANT … TO app_user`, and
-- tests/integration/rls-coverage.test.ts asserts it.
GRANT SELECT, INSERT, UPDATE, DELETE ON "Organization", "OrgMembership", "Tenant", "TenantMembership", "User" TO app_user;

-- ─── 3) Class-A RLS on TenantMembership ───────────────────────────
--
-- The canonical tenant-scoped shape (docs/rls-tenant-isolation.md, "Adding a
-- new tenant-scoped table"). superuser_bypass is keyed on the role alone, with
-- no WITH CHECK.

ALTER TABLE "TenantMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantMembership" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantMembership"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "TenantMembership"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "TenantMembership"
    USING (current_setting('role') != 'app_user');

-- ─── 4) Org-axis RLS on Organization and OrgMembership ────────────
--
-- Neither table carries a tenantId. The unit of isolation is "is the
-- requesting user a member of this organization", keyed on the session
-- variable `app.user_id`.
--
-- Nothing sets `app.user_id` yet (as in inflect-compliance), so under
-- app_user both tables return zero rows: fail closed. Every organization path
-- reads and writes through the owning role (the global client or
-- runWithoutRls), gated at the API layer. Setting `app.user_id` inside
-- runInTenantContext is a separate decision, and must first change the org
-- last-owner trigger (section 8).
--
-- The app_user policies are USING-only (no WITH CHECK): under FORCE ROW LEVEL
-- SECURITY an app_user can read its own org rows but never INSERT or UPDATE,
-- because no permissive sibling policy gives it WITH CHECK access.

ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;

-- Visible to an app_user only when they hold an OrgMembership in this
-- organization. The EXISTS subquery is itself subject to RLS, but the
-- OrgMembership policy below filters to the requester's own rows, so the
-- subquery resolves to "does the requester have a membership row pointing at
-- this Organization", which is the intended check.
CREATE POLICY org_isolation ON "Organization"
    USING (
        EXISTS (
            SELECT 1
            FROM "OrgMembership" om
            WHERE om."organizationId" = "Organization".id
              AND om."userId" = current_setting('app.user_id', true)::text
        )
    );

CREATE POLICY superuser_bypass ON "Organization"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "OrgMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgMembership" FORCE ROW LEVEL SECURITY;

-- Each user reads only their own membership rows.
CREATE POLICY org_membership_self_isolation ON "OrgMembership"
    USING ("userId" = current_setting('app.user_id', true)::text);

CREATE POLICY superuser_bypass ON "OrgMembership"
    USING (current_setting('role') != 'app_user');

-- ─── 5) Tenant and User: global, no RLS ───────────────────────────
--
-- As in inflect-compliance. Because of the grant in section 2, a query on the
-- transaction client inside runInTenantContext can read every User row in the
-- deployment. Whether to put User behind RLS (by shared membership) or revoke
-- app_user's SELECT on it is an open hardening (H1) question, not a 1.3 change.

-- ─── 6) Tenant last-owner trigger ─────────────────────────────────
--
-- The last ACTIVE OWNER of a live workspace cannot be demoted, deactivated or
-- deleted: SQLSTATE P0001, 'LAST_OWNER_GUARD'. A soft-deleted workspace is
-- being wound down, so leaving it without an owner is allowed (the purge
-- exemption).
--
-- Before counting, the function takes a transaction-scoped advisory lock keyed
-- on the workspace, hashtext('tenant-owner:' || tenantId), the key
-- `lockTenantOwners` (src/app-layer/usecases/tenant-owner-lock.ts) takes, so
-- two OWNERs demoting each other at once queue instead of each counting the
-- other as still an owner. The `tenant-owner:` namespace is distinct from the
-- bare hashtext(tenantId) key the audit chain (sub-phase 1.5) takes.
--
-- In PL/pgSQL under READ COMMITTED every SQL statement in a VOLATILE function
-- takes a fresh snapshot, so the COUNT, which runs after the lock is granted,
-- sees the committed result of whichever change held it. Keep this function
-- VOLATILE (the default): a STABLE one would reuse the calling statement's
-- snapshot and the lock would be decorative.

CREATE OR REPLACE FUNCTION check_not_last_owner()
RETURNS TRIGGER AS $$
DECLARE
    owner_count INT;
    affected_tenant TEXT;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Care only about OWNER being demoted or deactivated.
        IF OLD.role = 'OWNER' AND OLD.status = 'ACTIVE'
           AND (NEW.role != 'OWNER' OR NEW.status != 'ACTIVE') THEN
            affected_tenant := OLD."tenantId";
        ELSE
            RETURN NEW;
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.role = 'OWNER' AND OLD.status = 'ACTIVE' THEN
            affected_tenant := OLD."tenantId";
        ELSE
            RETURN OLD;
        END IF;
    END IF;

    -- A soft-deleted tenant is being wound down; leaving it without an owner
    -- is the intended end state, not an accident to be prevented.
    IF EXISTS (
        SELECT 1 FROM "Tenant"
         WHERE "id" = affected_tenant AND "deletedAt" IS NOT NULL
    ) THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    -- Queue behind any other owner change in this tenant, so the count below
    -- reads its committed result.
    PERFORM pg_advisory_xact_lock(hashtext('tenant-owner:' || affected_tenant));

    SELECT COUNT(*) INTO owner_count
    FROM "TenantMembership"
    WHERE "tenantId" = affected_tenant
      AND "role" = 'OWNER'
      AND "status" = 'ACTIVE'
      AND "id" != OLD."id";

    IF owner_count < 1 THEN
        RAISE EXCEPTION 'LAST_OWNER_GUARD: tenant % would have zero active OWNERs', affected_tenant
            USING ERRCODE = 'P0001';
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenant_membership_last_owner_guard
BEFORE UPDATE OR DELETE ON "TenantMembership"
FOR EACH ROW EXECUTE FUNCTION check_not_last_owner();

-- ─── 7) Org last-owner trigger ────────────────────────────────────
--
-- The last ORG_OWNER of an organization cannot be demoted or deleted:
-- SQLSTATE P0001, 'LAST_ORG_OWNER_GUARD'. Deleting the ORGANIZATION cascades
-- past the guard (its row is already gone when the cascade deletes the
-- memberships). The lock key, hashtext('org-owner:' || organizationId), is the
-- one `lockOrgOwners` (src/app-layer/usecases/org-owner-lock.ts) takes; keep
-- this function VOLATILE for the same reason as section 6.

CREATE OR REPLACE FUNCTION check_not_last_org_owner()
RETURNS TRIGGER AS $$
DECLARE
    owner_count INT;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NOT (OLD."role" = 'ORG_OWNER' AND NEW."role" <> 'ORG_OWNER') THEN
            RETURN NEW;
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD."role" <> 'ORG_OWNER' THEN
            RETURN OLD;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM "Organization" WHERE "id" = OLD."organizationId") THEN
            RETURN OLD;
        END IF;
    END IF;

    -- Queue behind any other owner change in this organization, so the count
    -- below reads its committed result.
    PERFORM pg_advisory_xact_lock(hashtext('org-owner:' || OLD."organizationId"));

    SELECT COUNT(*) INTO owner_count
    FROM "OrgMembership"
    WHERE "organizationId" = OLD."organizationId"
      AND "role" = 'ORG_OWNER'
      AND "id" <> OLD."id";

    IF owner_count < 1 THEN
        RAISE EXCEPTION 'LAST_ORG_OWNER_GUARD: organization % would have no ORG_OWNER', OLD."organizationId"
            USING ERRCODE = 'P0001';
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER org_membership_last_owner_guard
BEFORE UPDATE OR DELETE ON "OrgMembership"
FOR EACH ROW EXECUTE FUNCTION check_not_last_org_owner();

-- ─── 8) How the triggers read under RLS ───────────────────────────
--
-- Neither function is SECURITY DEFINER, so their reads run as the writer and
-- are RLS-filtered when the writer is app_user.
--
-- * The tenant trigger is correct under app_user. Inside runInTenantContext
--   the only TenantMembership rows a writer can touch are those of
--   app.tenant_id, and the trigger counts rows of that same tenant, so the
--   filter hides nothing it needs. Its Tenant.deletedAt check reads a table
--   with no RLS.
--
-- * The org trigger is correct only on the owning role. Under app_user, the
--   NOT EXISTS (SELECT 1 FROM "Organization" …) goes through org_isolation
--   (keyed on app.user_id). With app.user_id unset the organization reads as
--   gone, so a delete would be treated as the organization's own cascade and
--   let through; today that cannot happen, because the same unset app.user_id
--   hides every OrgMembership row from the writer, so there is nothing to
--   delete. With app.user_id set, the COUNT sees only the caller's own
--   OrgMembership rows, so a second owner is invisible and a legitimate
--   demotion is refused.
--
--   So every org-membership write stays on the owning role (the global client
--   or runWithoutRls). Whoever later sets app.user_id must first fix the
--   function: make it SECURITY DEFINER with SET search_path = public, owned by
--   a role that bypasses RLS (FORCE applies to a plain table owner, and
--   superuser_bypass reads the `role` GUC, which SECURITY DEFINER does not
--   change), or give the trigger its own policy, and add a test then.
