-- Sub-phase 2.8a: review rounds, steps and reviewers (docs/porting/maps/2.8.md;
-- ADR 0009; owner decisions 148 to 165; docs/work-items.md, "Reviews (2.8a)").
--
--   1. Prisma's DDL: four enums and four tenant tables.
--   2. What Prisma cannot declare: one live round per item, one open step per
--      round, the CHECKs on the text and response columns.
--   3. The triggers that keep a review's record from being rewritten:
--        - an ended round (COMPLETED, RETURNED, WITHDRAWN) is never changed,
--          and neither is any of its steps, step lists or reviewer rows;
--        - an ended step (COMPLETED, RETURNED, SKIPPED, WITHDRAWN) and its
--          reviewers' responses are frozen (decision 162: a response may
--          change only while its step is open);
--        - a step's name, mode, days and position change only while PENDING;
--        - a reviewer row is withdrawn, never deleted, and never un-withdrawn;
--          a response is never taken back.
--      The one admitted change to a frozen row is the key rotations'
--      re-wrap of `WorkItemReviewer.responseText` (one ciphertext for
--      another, every other column unchanged), as every write-once trigger
--      on an encrypted column must admit. A cascade from the item's purge or
--      the workspace's delete passes (`pg_trigger_depth() > 1`: the
--      referential action is itself a trigger).
--   4. Grants and the canonical RLS. `app_user` holds no DELETE on rounds or
--      reviewer rows: the record keeps who was asked.
--   5. Immediate email is offered for review requested and returned
--      (decision 161): the preference CHECK is widened. Both values were added
--      in 20261208120000 and 20261208120200, which have committed.
--
-- Nothing here touches a table the previous image writes in a way it would
-- refuse: the new tables are its own, and the CHECK only widens.

-- ─── 1) Prisma's DDL ──────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "ReviewRoundStatus" AS ENUM ('PLANNED', 'OPEN', 'COMPLETED', 'RETURNED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ReviewStepMode" AS ENUM ('ALL', 'ANY');

-- CreateEnum
CREATE TYPE "ReviewStepStatus" AS ENUM ('PENDING', 'OPEN', 'COMPLETED', 'RETURNED', 'SKIPPED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ReviewOutcome" AS ENUM ('SIGNED_OFF', 'RETURNED');



-- CreateTable
CREATE TABLE "WorkItemReviewRound" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "ReviewRoundStatus" NOT NULL DEFAULT 'PLANNED',
    "startedByUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endedByUserId" TEXT,
    "endReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkItemReviewRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItemReviewStep" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "ReviewStepMode" NOT NULL DEFAULT 'ALL',
    "dueInWorkingDays" INTEGER NOT NULL,
    "status" "ReviewStepStatus" NOT NULL DEFAULT 'PENDING',
    "openedAt" TIMESTAMP(3),
    "dueOn" DATE,
    "endedAt" TIMESTAMP(3),
    "skippedByUserId" TEXT,
    "skipReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkItemReviewStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItemReviewStepList" (
    "tenantId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "recipientListId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkItemReviewStepList_pkey" PRIMARY KEY ("stepId","recipientListId")
);

-- CreateTable
CREATE TABLE "WorkItemReviewer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "viaRecipientListId" TEXT,
    "outcome" "ReviewOutcome",
    "respondedAt" TIMESTAMP(3),
    "responseText" TEXT,
    "itemVersionAt" INTEGER,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnReason" TEXT,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkItemReviewer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkItemReviewRound_tenantId_status_idx" ON "WorkItemReviewRound"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemReviewRound_id_tenantId_key" ON "WorkItemReviewRound"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemReviewRound_id_workItemId_tenantId_key" ON "WorkItemReviewRound"("id", "workItemId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemReviewRound_tenantId_workItemId_number_key" ON "WorkItemReviewRound"("tenantId", "workItemId", "number");

-- CreateIndex
CREATE INDEX "WorkItemReviewStep_tenantId_roundId_workItemId_idx" ON "WorkItemReviewStep"("tenantId", "roundId", "workItemId");

-- CreateIndex
CREATE INDEX "WorkItemReviewStep_tenantId_status_dueOn_idx" ON "WorkItemReviewStep"("tenantId", "status", "dueOn");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemReviewStep_id_tenantId_key" ON "WorkItemReviewStep"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemReviewStep_id_roundId_workItemId_tenantId_key" ON "WorkItemReviewStep"("id", "roundId", "workItemId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemReviewStep_roundId_position_key" ON "WorkItemReviewStep"("roundId", "position");

-- CreateIndex
CREATE INDEX "WorkItemReviewStepList_tenantId_stepId_idx" ON "WorkItemReviewStepList"("tenantId", "stepId");

-- CreateIndex
CREATE INDEX "WorkItemReviewStepList_tenantId_recipientListId_idx" ON "WorkItemReviewStepList"("tenantId", "recipientListId");

-- CreateIndex
CREATE INDEX "WorkItemReviewer_tenantId_stepId_roundId_workItemId_idx" ON "WorkItemReviewer"("tenantId", "stepId", "roundId", "workItemId");

-- CreateIndex
CREATE INDEX "WorkItemReviewer_tenantId_userId_withdrawnAt_idx" ON "WorkItemReviewer"("tenantId", "userId", "withdrawnAt");

-- CreateIndex
CREATE INDEX "WorkItemReviewer_tenantId_workItemId_idx" ON "WorkItemReviewer"("tenantId", "workItemId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemReviewer_stepId_userId_key" ON "WorkItemReviewer"("stepId", "userId");

-- AddForeignKey
ALTER TABLE "WorkItemReviewRound" ADD CONSTRAINT "WorkItemReviewRound_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemReviewRound" ADD CONSTRAINT "WorkItemReviewRound_workItemId_tenantId_fkey" FOREIGN KEY ("workItemId", "tenantId") REFERENCES "WorkItem"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemReviewStep" ADD CONSTRAINT "WorkItemReviewStep_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemReviewStep" ADD CONSTRAINT "WorkItemReviewStep_roundId_workItemId_tenantId_fkey" FOREIGN KEY ("roundId", "workItemId", "tenantId") REFERENCES "WorkItemReviewRound"("id", "workItemId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemReviewStepList" ADD CONSTRAINT "WorkItemReviewStepList_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemReviewStepList" ADD CONSTRAINT "WorkItemReviewStepList_stepId_tenantId_fkey" FOREIGN KEY ("stepId", "tenantId") REFERENCES "WorkItemReviewStep"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemReviewStepList" ADD CONSTRAINT "WorkItemReviewStepList_recipientListId_tenantId_fkey" FOREIGN KEY ("recipientListId", "tenantId") REFERENCES "RecipientList"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemReviewer" ADD CONSTRAINT "WorkItemReviewer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemReviewer" ADD CONSTRAINT "WorkItemReviewer_stepId_roundId_workItemId_tenantId_fkey" FOREIGN KEY ("stepId", "roundId", "workItemId", "tenantId") REFERENCES "WorkItemReviewStep"("id", "roundId", "workItemId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemReviewer" ADD CONSTRAINT "WorkItemReviewer_workItemId_tenantId_fkey" FOREIGN KEY ("workItemId", "tenantId") REFERENCES "WorkItem"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemReviewer" ADD CONSTRAINT "WorkItemReviewer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── 2) What Prisma cannot declare ────────────────────────────────

-- At most one PLANNED or OPEN round per item (ADR 0009 §1).
CREATE UNIQUE INDEX "WorkItemReviewRound_one_live_per_item"
    ON "WorkItemReviewRound" ("tenantId", "workItemId") WHERE "status" IN ('PLANNED', 'OPEN');

-- At most one OPEN step per round: steps run in order.
CREATE UNIQUE INDEX "WorkItemReviewStep_one_open_per_round"
    ON "WorkItemReviewStep" ("roundId") WHERE "status" = 'OPEN';

ALTER TABLE "WorkItemReviewRound" ADD CONSTRAINT "WorkItemReviewRound_number_positive" CHECK ("number" >= 1);
ALTER TABLE "WorkItemReviewRound" ADD CONSTRAINT "WorkItemReviewRound_version_positive" CHECK ("version" >= 1);
ALTER TABLE "WorkItemReviewRound" ADD CONSTRAINT "WorkItemReviewRound_started"
    CHECK ("status" = 'PLANNED' OR ("startedAt" IS NOT NULL AND "startedByUserId" IS NOT NULL));
ALTER TABLE "WorkItemReviewRound" ADD CONSTRAINT "WorkItemReviewRound_ended"
    CHECK (("status" IN ('PLANNED', 'OPEN')) = ("endedAt" IS NULL AND "endReason" IS NULL));
ALTER TABLE "WorkItemReviewRound" ADD CONSTRAINT "WorkItemReviewRound_end_reason"
    CHECK ("endReason" IS NULL OR "endReason" IN ('COMPLETED', 'RETURNED', 'ITEM_CLOSED', 'ITEM_DELETED', 'WITHDRAWN_BY_PERSON'));

ALTER TABLE "WorkItemReviewStep" ADD CONSTRAINT "WorkItemReviewStep_name_length"
    CHECK (char_length("name") BETWEEN 1 AND 120);
ALTER TABLE "WorkItemReviewStep" ADD CONSTRAINT "WorkItemReviewStep_due_in_working_days"
    CHECK ("dueInWorkingDays" BETWEEN 1 AND 60);
ALTER TABLE "WorkItemReviewStep" ADD CONSTRAINT "WorkItemReviewStep_position_positive" CHECK ("position" >= 1);
ALTER TABLE "WorkItemReviewStep" ADD CONSTRAINT "WorkItemReviewStep_opened"
    CHECK (("openedAt" IS NULL) = ("dueOn" IS NULL) AND ("status" <> 'OPEN' OR "openedAt" IS NOT NULL));
ALTER TABLE "WorkItemReviewStep" ADD CONSTRAINT "WorkItemReviewStep_ended"
    CHECK (("status" IN ('PENDING', 'OPEN')) = ("endedAt" IS NULL));
ALTER TABLE "WorkItemReviewStep" ADD CONSTRAINT "WorkItemReviewStep_skip"
    CHECK ((("status" = 'SKIPPED') = ("skipReason" IS NOT NULL))
       AND ("skipReason" IS NULL OR "skipReason" IN ('PERSON_SKIPPED', 'NO_REVIEWERS_LEFT')));

-- A response has its time and the item's version; a Return has its text
-- (decision 157); a withdrawn row has its reason and no response.
ALTER TABLE "WorkItemReviewer" ADD CONSTRAINT "WorkItemReviewer_response"
    CHECK (("outcome" IS NULL) = ("respondedAt" IS NULL) AND ("outcome" IS NULL) = ("itemVersionAt" IS NULL));
ALTER TABLE "WorkItemReviewer" ADD CONSTRAINT "WorkItemReviewer_return_has_text"
    CHECK ("outcome" IS DISTINCT FROM 'RETURNED' OR ("responseText" IS NOT NULL AND "responseText" <> ''));
ALTER TABLE "WorkItemReviewer" ADD CONSTRAINT "WorkItemReviewer_text_with_response"
    CHECK ("responseText" IS NULL OR "outcome" IS NOT NULL);
ALTER TABLE "WorkItemReviewer" ADD CONSTRAINT "WorkItemReviewer_withdrawn"
    CHECK ((("withdrawnAt" IS NULL) = ("withdrawnReason" IS NULL))
       AND NOT ("withdrawnAt" IS NOT NULL AND "outcome" IS NOT NULL)
       AND ("withdrawnReason" IS NULL OR "withdrawnReason" IN ('MEMBER_REMOVED', 'STEP_ENDED', 'REMOVED_BY_PERSON', 'BECAME_ASSIGNEE', 'NOT_ELIGIBLE')));

-- ─── 3) The record is never rewritten ─────────────────────────────

-- A round: once ended, nothing changes; its identity never changes; it never
-- moves back to PLANNED; a direct delete of an ended round is refused (the
-- purge's cascade passes).
CREATE OR REPLACE FUNCTION work_item_review_round_frozen() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF pg_trigger_depth() = 1 AND OLD."status" IN ('COMPLETED', 'RETURNED', 'WITHDRAWN') THEN
            RAISE EXCEPTION 'REVIEW_ROUND_ENDED: an ended review round is never rewritten' USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD."status" IN ('COMPLETED', 'RETURNED', 'WITHDRAWN') THEN
        RAISE EXCEPTION 'REVIEW_ROUND_ENDED: an ended review round is never rewritten' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."id" <> OLD."id" OR NEW."tenantId" <> OLD."tenantId" OR NEW."workItemId" <> OLD."workItemId"
       OR NEW."number" <> OLD."number" OR NEW."createdById" <> OLD."createdById" OR NEW."createdAt" <> OLD."createdAt" THEN
        RAISE EXCEPTION 'REVIEW_ROUND_IDENTITY: a review round''s identity never changes' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'OPEN' AND NEW."status" = 'PLANNED' THEN
        RAISE EXCEPTION 'REVIEW_ROUND_REWOUND: an open review round never returns to planned' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER work_item_review_round_frozen
    BEFORE UPDATE OR DELETE ON "WorkItemReviewRound"
    FOR EACH ROW EXECUTE FUNCTION work_item_review_round_frozen();

-- A step: inserted only PENDING into a live round; edited only while
-- PENDING; frozen once ended or once its round ended; deleted directly only
-- while PENDING in a live round.
CREATE OR REPLACE FUNCTION work_item_review_step_frozen() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    round_status "ReviewRoundStatus";
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF pg_trigger_depth() > 1 THEN
            RETURN OLD;
        END IF;
        SELECT "status" INTO round_status FROM "WorkItemReviewRound" WHERE "id" = OLD."roundId";
        IF OLD."status" <> 'PENDING' OR round_status IN ('COMPLETED', 'RETURNED', 'WITHDRAWN') THEN
            RAISE EXCEPTION 'REVIEW_STEP_FROZEN: only a step not yet opened, in a live round, is removed' USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    SELECT "status" INTO round_status FROM "WorkItemReviewRound" WHERE "id" = NEW."roundId";
    IF round_status IN ('COMPLETED', 'RETURNED', 'WITHDRAWN') THEN
        RAISE EXCEPTION 'REVIEW_ROUND_ENDED: an ended review round is never rewritten' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'PENDING' THEN
            RAISE EXCEPTION 'REVIEW_STEP_FROZEN: a step starts PENDING' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD."status" NOT IN ('PENDING', 'OPEN') THEN
        RAISE EXCEPTION 'REVIEW_STEP_FROZEN: an ended review step is never rewritten' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."id" <> OLD."id" OR NEW."tenantId" <> OLD."tenantId" OR NEW."roundId" <> OLD."roundId"
       OR NEW."workItemId" <> OLD."workItemId" OR NEW."createdAt" <> OLD."createdAt" THEN
        RAISE EXCEPTION 'REVIEW_STEP_FROZEN: a review step''s identity never changes' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" <> 'PENDING' AND (NEW."name" <> OLD."name" OR NEW."mode" <> OLD."mode"
       OR NEW."dueInWorkingDays" <> OLD."dueInWorkingDays" OR NEW."position" <> OLD."position") THEN
        RAISE EXCEPTION 'REVIEW_STEP_FROZEN: an opened review step is not edited' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."status" = 'OPEN' AND NEW."status" = 'PENDING' THEN
        RAISE EXCEPTION 'REVIEW_STEP_FROZEN: an open review step never returns to pending' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."openedAt" IS NOT NULL AND (NEW."openedAt" IS DISTINCT FROM OLD."openedAt" OR NEW."dueOn" IS DISTINCT FROM OLD."dueOn") THEN
        RAISE EXCEPTION 'REVIEW_STEP_FROZEN: an opened step keeps its due date' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER work_item_review_step_frozen
    BEFORE INSERT OR UPDATE OR DELETE ON "WorkItemReviewStep"
    FOR EACH ROW EXECUTE FUNCTION work_item_review_step_frozen();

-- A step's lists: changed only while the step is PENDING in a live round.
CREATE OR REPLACE FUNCTION work_item_review_step_list_frozen() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    step_status "ReviewStepStatus";
    round_status "ReviewRoundStatus";
    the_step TEXT;
BEGIN
    IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
        RETURN OLD;
    END IF;
    the_step := CASE WHEN TG_OP = 'DELETE' THEN OLD."stepId" ELSE NEW."stepId" END;
    SELECT s."status", r."status" INTO step_status, round_status
      FROM "WorkItemReviewStep" s JOIN "WorkItemReviewRound" r ON r."id" = s."roundId"
     WHERE s."id" = the_step;
    IF step_status <> 'PENDING' OR round_status IN ('COMPLETED', 'RETURNED', 'WITHDRAWN')
       OR (TG_OP = 'UPDATE' AND OLD."stepId" <> NEW."stepId") THEN
        RAISE EXCEPTION 'REVIEW_STEP_FROZEN: a step''s lists change only before it opens' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER work_item_review_step_list_frozen
    BEFORE INSERT OR UPDATE OR DELETE ON "WorkItemReviewStepList"
    FOR EACH ROW EXECUTE FUNCTION work_item_review_step_list_frozen();

-- A reviewer row: added only to a PENDING or OPEN step of a live round, with
-- no response; responds only while its step is OPEN; the response may change
-- while the step is OPEN (decision 162) and is never taken back; frozen once
-- the step or the round ended, or once withdrawn; never deleted directly. The
-- key rotations' re-wrap of `responseText` passes on any row.
CREATE OR REPLACE FUNCTION work_item_reviewer_frozen() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    step_status "ReviewStepStatus";
    round_status "ReviewRoundStatus";
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF pg_trigger_depth() > 1 THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'REVIEWER_NEVER_DELETED: a reviewer is withdrawn, never removed' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE'
       AND NEW."responseText" IS DISTINCT FROM OLD."responseText"
       AND OLD."responseText" ~ '^v[0-9]+:' AND NEW."responseText" ~ '^v[0-9]+:'
       AND (NEW."id", NEW."tenantId", NEW."stepId", NEW."roundId", NEW."workItemId", NEW."userId", NEW."viaRecipientListId",
            NEW."outcome", NEW."respondedAt", NEW."itemVersionAt", NEW."withdrawnAt", NEW."withdrawnReason", NEW."addedById", NEW."createdAt")
           IS NOT DISTINCT FROM
           (OLD."id", OLD."tenantId", OLD."stepId", OLD."roundId", OLD."workItemId", OLD."userId", OLD."viaRecipientListId",
            OLD."outcome", OLD."respondedAt", OLD."itemVersionAt", OLD."withdrawnAt", OLD."withdrawnReason", OLD."addedById", OLD."createdAt") THEN
        -- The key rotations' re-wrap: one ciphertext for another.
        RETURN NEW;
    END IF;
    SELECT s."status", r."status" INTO step_status, round_status
      FROM "WorkItemReviewStep" s JOIN "WorkItemReviewRound" r ON r."id" = s."roundId"
     WHERE s."id" = NEW."stepId";
    IF round_status IN ('COMPLETED', 'RETURNED', 'WITHDRAWN') THEN
        RAISE EXCEPTION 'REVIEW_ROUND_ENDED: an ended review round is never rewritten' USING ERRCODE = 'check_violation';
    END IF;
    IF step_status NOT IN ('PENDING', 'OPEN') THEN
        RAISE EXCEPTION 'REVIEW_RESPONSE_FROZEN: a completed review step and its responses are never rewritten' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW."outcome" IS NOT NULL OR NEW."withdrawnAt" IS NOT NULL THEN
            RAISE EXCEPTION 'REVIEW_RESPONSE_FROZEN: a reviewer is added with no response' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD."withdrawnAt" IS NOT NULL THEN
        RAISE EXCEPTION 'REVIEW_RESPONSE_FROZEN: a withdrawn reviewer stays withdrawn' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."id" <> OLD."id" OR NEW."tenantId" <> OLD."tenantId" OR NEW."stepId" <> OLD."stepId"
       OR NEW."roundId" <> OLD."roundId" OR NEW."workItemId" <> OLD."workItemId" OR NEW."userId" <> OLD."userId"
       OR NEW."viaRecipientListId" IS DISTINCT FROM OLD."viaRecipientListId"
       OR NEW."addedById" <> OLD."addedById" OR NEW."createdAt" <> OLD."createdAt" THEN
        RAISE EXCEPTION 'REVIEW_RESPONSE_FROZEN: a reviewer row''s identity never changes' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."outcome" IS NOT NULL AND NEW."outcome" IS NULL THEN
        RAISE EXCEPTION 'REVIEW_RESPONSE_FROZEN: a response is changed, never taken back' USING ERRCODE = 'check_violation';
    END IF;
    IF step_status <> 'OPEN' AND NEW."outcome" IS DISTINCT FROM OLD."outcome" THEN
        RAISE EXCEPTION 'REVIEW_RESPONSE_FROZEN: a review step is responded to only while it is open' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER work_item_reviewer_frozen
    BEFORE INSERT OR UPDATE OR DELETE ON "WorkItemReviewer"
    FOR EACH ROW EXECUTE FUNCTION work_item_reviewer_frozen();

-- ─── 4) Grants and canonical RLS ──────────────────────────────────

-- No DELETE on rounds or reviewer rows: the record keeps who was asked. The
-- REVOKE is explicit because the database's default privileges grant
-- DELETE on every new table. Steps not yet opened are removed (and their
-- named reviewers with them, by cascade as the table owner), so steps and
-- their lists keep DELETE, held by the triggers above.
GRANT SELECT, INSERT, UPDATE ON "WorkItemReviewRound", "WorkItemReviewer" TO app_user;
REVOKE DELETE, TRUNCATE ON "WorkItemReviewRound", "WorkItemReviewer" FROM app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "WorkItemReviewStep", "WorkItemReviewStepList" TO app_user;

ALTER TABLE "WorkItemReviewRound" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkItemReviewRound" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkItemReviewRound"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "WorkItemReviewRound"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "WorkItemReviewRound"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "WorkItemReviewStep" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkItemReviewStep" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkItemReviewStep"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "WorkItemReviewStep"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "WorkItemReviewStep"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "WorkItemReviewStepList" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkItemReviewStepList" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkItemReviewStepList"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "WorkItemReviewStepList"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "WorkItemReviewStepList"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "WorkItemReviewer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkItemReviewer" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkItemReviewer"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "WorkItemReviewer"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "WorkItemReviewer"
    USING (current_setting('role') != 'app_user');

-- ─── 5) Immediate email for review requested and returned ─────────

ALTER TABLE "NotificationPreference" DROP CONSTRAINT "NotificationPreference_immediate_types";
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_immediate_types"
    CHECK ("emailDelivery" <> 'IMMEDIATE' OR "type" IN ('WORK_ITEM_ASSIGNED', 'WORK_ITEM_WAITING_ON', 'WORK_ITEM_MENTIONED', 'WORK_ITEM_REVIEW_REQUESTED', 'WORK_ITEM_REVIEW_RETURNED'));
