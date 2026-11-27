-- Sub-phase 3.4d: billable rates, totals and the export
-- (docs/porting/maps/3.4.md, "Rates, totals and export (3.4d)"; ADR 0012 §6
-- and §7; owner decisions 271 to 275).
--
-- 1) `BillableRate`: a rate at one level (the workspace, a project, a member),
--    in force from its date until the next row of the same level and scope; a
--    NULL rate is "no rate at this level from this date" (decision 272). One
--    row per level, scope and date (`NULLS NOT DISTINCT`, which Prisma cannot
--    declare). Rates are whole minor units of the workspace's currency
--    (decision 273), plaintext integers protected by `time.rates`.
-- 2) `Project.timeBillableByDefault` (decision 271): new entries on the
--    project are billable unless the person unticks one; off unless set.
-- 3) `TenantTimeSettings.currency`: one ISO 4217 code per workspace (the
--    pattern of inflect-compliance's `AgentSpendingAuthority`, no code copied).
-- 4) `TimeEntry.frozenRateMinor` / `frozenRateLevel`: the rate a billable
--    entry of an approved week was approved at (decision 273); both or
--    neither, and only on a billable entry. The freeze trigger admits the
--    approval's stamp and the reopening's clear, every other column unchanged.
--
-- The previous image never reads the new columns or table, and inserts
-- entries without frozen rates (allowed by every CHECK here).

-- ─── 1) Prisma's DDL ─────────────────────────────────────────────
CREATE TYPE "BillableRateLevel" AS ENUM ('WORKSPACE', 'PROJECT', 'MEMBER');

CREATE TABLE "BillableRate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "level" "BillableRateLevel" NOT NULL,
    "projectId" TEXT,
    "userId" TEXT,
    "hourlyRateMinor" INTEGER,
    "effectiveFrom" DATE NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillableRate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BillableRate_tenantId_level_effectiveFrom_idx" ON "BillableRate"("tenantId", "level", "effectiveFrom");
CREATE INDEX "BillableRate_tenantId_projectId_effectiveFrom_idx" ON "BillableRate"("tenantId", "projectId", "effectiveFrom");
CREATE INDEX "BillableRate_tenantId_userId_effectiveFrom_idx" ON "BillableRate"("tenantId", "userId", "effectiveFrom");
CREATE UNIQUE INDEX "BillableRate_id_tenantId_key" ON "BillableRate"("id", "tenantId");

ALTER TABLE "BillableRate" ADD CONSTRAINT "BillableRate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillableRate" ADD CONSTRAINT "BillableRate_projectId_tenantId_fkey" FOREIGN KEY ("projectId", "tenantId") REFERENCES "Project"("id", "tenantId") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "BillableRate" ADD CONSTRAINT "BillableRate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Project" ADD COLUMN "timeBillableByDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TenantTimeSettings" ADD COLUMN "currency" TEXT;
ALTER TABLE "TimeEntry" ADD COLUMN "frozenRateMinor" INTEGER,
                        ADD COLUMN "frozenRateLevel" "BillableRateLevel";

-- ─── 2) What Prisma cannot declare ────────────────────────────────

-- One rate per level, scope and date; a workspace row names neither scope,
-- so NULLs must collide (Prisma declares the index; it cannot say NULLS NOT
-- DISTINCT).
CREATE UNIQUE INDEX "BillableRate_tenantId_level_projectId_userId_effectiveFrom_key"
    ON "BillableRate"("tenantId", "level", "projectId", "userId", "effectiveFrom") NULLS NOT DISTINCT;

-- The level names its scope: the workspace's names neither, a project's only
-- its project, a member's only its person.
ALTER TABLE "BillableRate" ADD CONSTRAINT "BillableRate_scope_of_level"
    CHECK (("level" = 'WORKSPACE' AND "projectId" IS NULL AND "userId" IS NULL)
        OR ("level" = 'PROJECT' AND "projectId" IS NOT NULL AND "userId" IS NULL)
        OR ("level" = 'MEMBER' AND "userId" IS NOT NULL AND "projectId" IS NULL));
ALTER TABLE "BillableRate" ADD CONSTRAINT "BillableRate_rate_range"
    CHECK ("hourlyRateMinor" IS NULL OR "hourlyRateMinor" BETWEEN 0 AND 2000000000);

ALTER TABLE "TenantTimeSettings" ADD CONSTRAINT "TenantTimeSettings_currency_iso"
    CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$');

ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_frozen_rate_whole"
    CHECK (("frozenRateMinor" IS NULL) = ("frozenRateLevel" IS NULL));
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_frozen_rate_billable"
    CHECK ("frozenRateMinor" IS NULL OR ("billable" AND "frozenRateMinor" BETWEEN 0 AND 2000000000));

-- ─── 3) The freeze admits the approval's stamp ───────────────────
-- As 20261222120500_timesheets, with the frozen rates in every column list
-- and one more admitted write: the frozen rates set or cleared, every other
-- column unchanged (the approval stamps them in the week it approves; the
-- reopening clears them).
CREATE OR REPLACE FUNCTION time_entry_week_frozen() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Only the workspace's deletion cascades into TimeEntry (the person is
        -- RESTRICT, the project NO ACTION): it passes every week.
        IF pg_trigger_depth() > 1 THEN
            RETURN OLD;
        END IF;
        PERFORM time_entry_assert_week_open(OLD."tenantId", OLD."userId", OLD."workDate");
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- The key rotations' re-wrap: one ciphertext of the description for
        -- another, every other column unchanged.
        IF NEW."description" IS DISTINCT FROM OLD."description"
           AND OLD."description" ~ '^v[0-9]+:' AND NEW."description" ~ '^v[0-9]+:'
           AND (NEW."id", NEW."tenantId", NEW."userId", NEW."workItemId", NEW."projectId", NEW."workDate", NEW."minutes",
                NEW."timerStartedAt", NEW."source", NEW."billable", NEW."frozenRateMinor", NEW."frozenRateLevel",
                NEW."version", NEW."createdByUserId", NEW."createdAt")
               IS NOT DISTINCT FROM
               (OLD."id", OLD."tenantId", OLD."userId", OLD."workItemId", OLD."projectId", OLD."workDate", OLD."minutes",
                OLD."timerStartedAt", OLD."source", OLD."billable", OLD."frozenRateMinor", OLD."frozenRateLevel",
                OLD."version", OLD."createdByUserId", OLD."createdAt") THEN
            RETURN NEW;
        END IF;
        -- The purge's clearing of the item link (decision 261: the entry
        -- outlives its item), every other column unchanged.
        IF OLD."workItemId" IS NOT NULL AND NEW."workItemId" IS NULL
           AND (NEW."id", NEW."tenantId", NEW."userId", NEW."projectId", NEW."workDate", NEW."minutes", NEW."timerStartedAt",
                NEW."source", NEW."billable", NEW."description", NEW."frozenRateMinor", NEW."frozenRateLevel",
                NEW."version", NEW."createdByUserId", NEW."createdAt")
               IS NOT DISTINCT FROM
               (OLD."id", OLD."tenantId", OLD."userId", OLD."projectId", OLD."workDate", OLD."minutes", OLD."timerStartedAt",
                OLD."source", OLD."billable", OLD."description", OLD."frozenRateMinor", OLD."frozenRateLevel",
                OLD."version", OLD."createdByUserId", OLD."createdAt") THEN
            RETURN NEW;
        END IF;
        -- The approval's stamp of the frozen rates, or the reopening's clear
        -- (decision 273), every other column unchanged.
        IF (NEW."frozenRateMinor", NEW."frozenRateLevel") IS DISTINCT FROM (OLD."frozenRateMinor", OLD."frozenRateLevel")
           AND (NEW."id", NEW."tenantId", NEW."userId", NEW."workItemId", NEW."projectId", NEW."workDate", NEW."minutes",
                NEW."timerStartedAt", NEW."source", NEW."billable", NEW."description", NEW."version",
                NEW."createdByUserId", NEW."createdAt")
               IS NOT DISTINCT FROM
               (OLD."id", OLD."tenantId", OLD."userId", OLD."workItemId", OLD."projectId", OLD."workDate", OLD."minutes",
                OLD."timerStartedAt", OLD."source", OLD."billable", OLD."description", OLD."version",
                OLD."createdByUserId", OLD."createdAt") THEN
            RETURN NEW;
        END IF;
        PERFORM time_entry_assert_week_open(OLD."tenantId", OLD."userId", OLD."workDate");
        IF NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."workDate" IS DISTINCT FROM OLD."workDate" THEN
            PERFORM time_entry_assert_week_open(NEW."tenantId", NEW."userId", NEW."workDate");
        END IF;
        RETURN NEW;
    END IF;

    PERFORM time_entry_assert_week_open(NEW."tenantId", NEW."userId", NEW."workDate");
    RETURN NEW;
END;
$$;

-- ─── 4) Grants and RLS ─────────────────────────────────────────────
-- A future rate may be removed until its date passes (the usecase's rule), so
-- app_user holds DELETE.
GRANT SELECT, INSERT, UPDATE, DELETE ON "BillableRate" TO app_user;

ALTER TABLE "BillableRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillableRate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BillableRate"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "BillableRate"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "BillableRate"
    USING (current_setting('role') != 'app_user');
