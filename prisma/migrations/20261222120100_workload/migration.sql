-- Sub-phase 3.5a: capacity and time off (docs/porting/maps/3.5.md, "Capacity
-- (3.5a)" and "Time off (3.5a)"; ADR 0013; owner decisions 282 to 303;
-- docs/workload.md).
--
-- 1) Prisma's DDL: TenantWorkloadSettings, MemberCapacity and TimeOff, their
--    tenant-leading uniques and indexes, and their foreign keys. Capacity and
--    time off cascade with the membership (decision 289's rule): a removed
--    member's rows go in the removal's own transaction.
-- 2) What Prisma cannot declare: the team link clears only its own column; the
--    CHECKs on minutes, the Monday, the version; the type held to a ciphertext
--    shape (decision 287), so no path stores it in plaintext.
-- 3) The bell of decision 300 is in-app only (NotificationPreference's CHECK).
-- 4) Grants and the canonical RLS. The settings row is never deleted by
--    app_user; capacity rows (a future change removed) and time off (a person's
--    deletion is for good, decision 289) are.
--
-- The tables are this image's own: the previous image never reads them.

-- ─── 1) Prisma's DDL ─────────────────────────────────────────────
CREATE TABLE "TenantWorkloadSettings" (
    "tenantId" TEXT NOT NULL,
    "defaultWeeklyMinutes" INTEGER NOT NULL DEFAULT 2400,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantWorkloadSettings_pkey" PRIMARY KEY ("tenantId")
);

CREATE TABLE "MemberCapacity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "weeklyMinutes" INTEGER NOT NULL,
    "calendarTeamId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberCapacity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TimeOff" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "minutes" INTEGER,
    "type" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeOff_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MemberCapacity_tenantId_calendarTeamId_idx" ON "MemberCapacity"("tenantId", "calendarTeamId");
CREATE UNIQUE INDEX "MemberCapacity_tenantId_userId_effectiveFrom_key" ON "MemberCapacity"("tenantId", "userId", "effectiveFrom");
CREATE UNIQUE INDEX "MemberCapacity_id_tenantId_key" ON "MemberCapacity"("id", "tenantId");
CREATE UNIQUE INDEX "TimeOff_tenantId_userId_day_key" ON "TimeOff"("tenantId", "userId", "day");
CREATE UNIQUE INDEX "TimeOff_id_tenantId_key" ON "TimeOff"("id", "tenantId");

ALTER TABLE "TenantWorkloadSettings" ADD CONSTRAINT "TenantWorkloadSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberCapacity" ADD CONSTRAINT "MemberCapacity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberCapacity" ADD CONSTRAINT "MemberCapacity_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "TenantMembership"("tenantId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeOff" ADD CONSTRAINT "TimeOff_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeOff" ADD CONSTRAINT "TimeOff_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "TenantMembership"("tenantId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 2) What Prisma cannot declare ────────────────────────────────

-- A team deleted later clears only the capacity's calendar (decision 285): the
-- person falls back to the workspace's calendar; tenantId is never touched.
ALTER TABLE "MemberCapacity" ADD CONSTRAINT "MemberCapacity_calendarTeamId_tenantId_fkey" FOREIGN KEY ("calendarTeamId", "tenantId") REFERENCES "Team"("id", "tenantId") ON DELETE SET NULL ("calendarTeamId") ON UPDATE NO ACTION;

-- Weekly capacity: 0 to 6,000 minutes (100 hours), for the default and a member.
ALTER TABLE "TenantWorkloadSettings" ADD CONSTRAINT "TenantWorkloadSettings_weekly_minutes_range"
    CHECK ("defaultWeeklyMinutes" BETWEEN 0 AND 6000);
ALTER TABLE "TenantWorkloadSettings" ADD CONSTRAINT "TenantWorkloadSettings_version_positive" CHECK ("version" >= 1);
ALTER TABLE "MemberCapacity" ADD CONSTRAINT "MemberCapacity_weekly_minutes_range"
    CHECK ("weeklyMinutes" BETWEEN 0 AND 6000);
-- A row starts on a Monday, so a week has one capacity (decision 284).
ALTER TABLE "MemberCapacity" ADD CONSTRAINT "MemberCapacity_effective_monday"
    CHECK (extract(isodow from "effectiveFrom") = 1);
ALTER TABLE "MemberCapacity" ADD CONSTRAINT "MemberCapacity_version_positive" CHECK ("version" >= 1);

-- Hours off on one date: 1 to 1,439 minutes, or NULL for the whole day (decision 286).
ALTER TABLE "TimeOff" ADD CONSTRAINT "TimeOff_minutes_range"
    CHECK ("minutes" IS NULL OR "minutes" BETWEEN 1 AND 1439);
-- The type is health data when it says Sick (decision 287): only ever stored as
-- the encryption extension's envelope, never a plaintext code.
ALTER TABLE "TimeOff" ADD CONSTRAINT "TimeOff_type_ciphertext"
    CHECK ("type" ~ '^v[12]:');
ALTER TABLE "TimeOff" ADD CONSTRAINT "TimeOff_version_positive" CHECK ("version" >= 1);

-- ─── 3) The time-off bell is in-app only (decision 300) ──────────
ALTER TABLE "NotificationPreference" DROP CONSTRAINT "NotificationPreference_in_app_only_types";
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_in_app_only_types"
    CHECK ("type" NOT IN ('CALENDAR_CHANGE_NOT_APPLIED', 'TIME_OFF_CHANGED_BY_OTHER') OR "emailDelivery" = 'OFF');

-- ─── 4) Grants and RLS ─────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON "TenantWorkloadSettings" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "MemberCapacity" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "TimeOff" TO app_user;

ALTER TABLE "TenantWorkloadSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantWorkloadSettings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantWorkloadSettings"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "TenantWorkloadSettings"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "TenantWorkloadSettings"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "MemberCapacity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MemberCapacity" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MemberCapacity"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "MemberCapacity"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "MemberCapacity"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "TimeOff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimeOff" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TimeOff"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "TimeOff"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "TimeOff"
    USING (current_setting('role') != 'app_user');
