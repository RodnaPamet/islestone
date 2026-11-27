-- Sub-phase 3.4c: timesheets and their approval (docs/porting/maps/3.4.md,
-- "Timesheets and approval (3.4c)"; ADR 0012 §5; owner decisions 256, 268 to
-- 270 and 276; docs/time-tracking.md).
--
-- 1) Prisma's DDL: the TimesheetStatus enum, the Timesheet table (one per
--    person and week, once submitted) and TenantTimeSettings (one per
--    workspace, none being the defaults), their indexes and foreign keys.
-- 2) What Prisma cannot declare: the recipient list's link clears its own
--    column (decision 269); the CHECKs on a week's Monday, a decision's shape,
--    the explanation and who decides (never the week's own person).
-- 3) The freeze (decision 270): the trigger `time_entry_week_frozen` refuses
--    any insert, change or delete of a time entry in a SUBMITTED or APPROVED
--    week, admitting only the key rotations' re-wrap of the description, the
--    purge's clearing of the item link and the workspace's own deletion.
--    3.4d admits the approval's frozen rates when it adds those columns.
-- 4) Immediate email for a returned week (decision 276): the preference CHECK
--    is widened (the enum values were added, each alone, before this).
-- 5) Grants and the canonical RLS. A decision is history: app_user holds no
--    DELETE on Timesheet, and none on the settings row.
--
-- The tables are this image's own: the previous image never reads them. The
-- trigger refuses nothing the previous image writes, since no week can be
-- submitted before this image runs.

-- ─── 1) Prisma's DDL ─────────────────────────────────────────────
CREATE TYPE "TimesheetStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'RETURNED', 'WITHDRAWN');

CREATE TABLE "Timesheet" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "status" "TimesheetStatus" NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "returnExplanation" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TenantTimeSettings" (
    "tenantId" TEXT NOT NULL,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "approvalRecipientListId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantTimeSettings_pkey" PRIMARY KEY ("tenantId")
);

CREATE INDEX "Timesheet_tenantId_status_weekStart_idx" ON "Timesheet"("tenantId", "status", "weekStart");
CREATE UNIQUE INDEX "Timesheet_tenantId_userId_weekStart_key" ON "Timesheet"("tenantId", "userId", "weekStart");
CREATE UNIQUE INDEX "Timesheet_id_tenantId_key" ON "Timesheet"("id", "tenantId");
CREATE INDEX "TenantTimeSettings_tenantId_approvalRecipientListId_idx" ON "TenantTimeSettings"("tenantId", "approvalRecipientListId");

ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TenantTimeSettings" ADD CONSTRAINT "TenantTimeSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 2) What Prisma cannot declare ────────────────────────────────

-- The recipient list told of submitted weeks (decision 269): a list is never
-- deleted (it is archived), but one of a purged project cascades; the link
-- then clears its own column, never tenantId.
ALTER TABLE "TenantTimeSettings" ADD CONSTRAINT "TenantTimeSettings_approvalRecipientListId_tenantId_fkey" FOREIGN KEY ("approvalRecipientListId", "tenantId") REFERENCES "RecipientList"("id", "tenantId") ON DELETE SET NULL ("approvalRecipientListId") ON UPDATE NO ACTION;
ALTER TABLE "TenantTimeSettings" ADD CONSTRAINT "TenantTimeSettings_version_positive" CHECK ("version" >= 1);

-- A week is Monday to Sunday (decision 268): its row names the Monday.
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_week_starts_monday"
    CHECK (extract(isodow FROM "weekStart") = 1);
-- Decided (APPROVED or RETURNED) exactly when a decision is stamped, and both
-- stamps together.
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_decision_stamped"
    CHECK ((("status" IN ('APPROVED', 'RETURNED')) = ("decidedAt" IS NOT NULL))
       AND (("decidedAt" IS NULL) = ("decidedByUserId" IS NULL)));
-- Nobody decides their own week (decision 269).
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_not_own_decision"
    CHECK ("decidedByUserId" IS NULL OR "decidedByUserId" <> "userId");
-- A returned week says why (decision 270); no other status carries a reason.
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_explanation_iff_returned"
    CHECK (("status" = 'RETURNED') = ("returnExplanation" IS NOT NULL));
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_version_positive" CHECK ("version" >= 1);

-- ─── 3) The freeze ────────────────────────────────────────────────

-- Refuse a write to `userId`'s week holding `day` while it is SUBMITTED or
-- APPROVED. Reads the week's row FOR SHARE, so a decision committing at the
-- same moment is waited for; the usecases take the week's advisory lock
-- first (`timesheet:<workspace>:<person>:<Monday>`), so this is the backstop.
CREATE OR REPLACE FUNCTION time_entry_assert_week_open(p_tenant TEXT, p_user TEXT, p_day DATE) RETURNS void
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    week_status "TimesheetStatus";
BEGIN
    SELECT t."status" INTO week_status
      FROM "Timesheet" t
     WHERE t."tenantId" = p_tenant
       AND t."userId" = p_user
       AND t."weekStart" = p_day - (extract(isodow FROM p_day)::integer - 1)
       FOR SHARE;
    IF week_status IN ('SUBMITTED', 'APPROVED') THEN
        RAISE EXCEPTION 'TIMESHEET_FROZEN: the week of % is %; its time entries do not change', p_day, lower(week_status::text)
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;

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
                NEW."timerStartedAt", NEW."source", NEW."billable", NEW."version", NEW."createdByUserId", NEW."createdAt")
               IS NOT DISTINCT FROM
               (OLD."id", OLD."tenantId", OLD."userId", OLD."workItemId", OLD."projectId", OLD."workDate", OLD."minutes",
                OLD."timerStartedAt", OLD."source", OLD."billable", OLD."version", OLD."createdByUserId", OLD."createdAt") THEN
            RETURN NEW;
        END IF;
        -- The purge's clearing of the item link (decision 261: the entry
        -- outlives its item), every other column unchanged.
        IF OLD."workItemId" IS NOT NULL AND NEW."workItemId" IS NULL
           AND (NEW."id", NEW."tenantId", NEW."userId", NEW."projectId", NEW."workDate", NEW."minutes", NEW."timerStartedAt",
                NEW."source", NEW."billable", NEW."description", NEW."version", NEW."createdByUserId", NEW."createdAt")
               IS NOT DISTINCT FROM
               (OLD."id", OLD."tenantId", OLD."userId", OLD."projectId", OLD."workDate", OLD."minutes", OLD."timerStartedAt",
                OLD."source", OLD."billable", OLD."description", OLD."version", OLD."createdByUserId", OLD."createdAt") THEN
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

CREATE TRIGGER time_entry_week_frozen
    BEFORE INSERT OR UPDATE OR DELETE ON "TimeEntry"
    FOR EACH ROW EXECUTE FUNCTION time_entry_week_frozen();

-- ─── 4) Immediate email for a returned week ──────────────────────
ALTER TABLE "NotificationPreference" DROP CONSTRAINT "NotificationPreference_immediate_types";
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_immediate_types"
    CHECK ("emailDelivery" <> 'IMMEDIATE' OR "type" IN ('WORK_ITEM_ASSIGNED', 'WORK_ITEM_WAITING_ON', 'WORK_ITEM_MENTIONED', 'WORK_ITEM_REVIEW_REQUESTED', 'WORK_ITEM_REVIEW_RETURNED', 'TIMESHEET_RETURNED'));

-- ─── 5) Grants and RLS ─────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON "Timesheet" TO app_user;
REVOKE DELETE, TRUNCATE ON "Timesheet" FROM app_user;
GRANT SELECT, INSERT, UPDATE ON "TenantTimeSettings" TO app_user;
REVOKE DELETE, TRUNCATE ON "TenantTimeSettings" FROM app_user;

ALTER TABLE "Timesheet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Timesheet" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Timesheet"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "Timesheet"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "Timesheet"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "TenantTimeSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantTimeSettings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantTimeSettings"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "TenantTimeSettings"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "TenantTimeSettings"
    USING (current_setting('role') != 'app_user');
