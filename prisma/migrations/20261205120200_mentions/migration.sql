-- Sub-phase 2.7d: mentions (docs/porting/maps/2.7.md, part 5;
-- docs/work-items.md, "Mentions (2.7d)"; owner decisions 127 to 131).
--
--   1. `Mention`: one row per source (a comment, or the item's description
--      when `commentId` is NULL) and person. The rows are the authority, not
--      the text: a `<@userId>` token renders as a chip only when its source
--      has a row. The item, the comment and the membership cascade.
--   2. What Prisma cannot declare: one row per source and person (two
--      partial uniques).
--   3. Grants and the canonical RLS.
--   4. Immediate email is offered for mentions too (owner decision 132): the
--      preference CHECK is widened. The value was added in
--      20261205120000_notification_type_mentioned, which has committed.
--
-- Nothing here touches a table the previous image writes in a way it would
-- refuse: the CHECK only widens.

-- ─── 1) Prisma's DDL ──────────────────────────────────────────────

-- CreateTable
CREATE TABLE "Mention" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "commentId" TEXT,
    "mentionedUserId" TEXT NOT NULL,
    "mentionedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Mention_tenantId_mentionedUserId_createdAt_idx" ON "Mention"("tenantId", "mentionedUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Mention_tenantId_workItemId_idx" ON "Mention"("tenantId", "workItemId");

-- CreateIndex
CREATE INDEX "Mention_tenantId_commentId_idx" ON "Mention"("tenantId", "commentId");

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_workItemId_tenantId_fkey" FOREIGN KEY ("workItemId", "tenantId") REFERENCES "WorkItem"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- A comment's mentions go with it (the purge's hard delete); a soft delete
-- removes them in the usecase. A description mention (NULL `commentId`) is
-- not checked by this key (MATCH SIMPLE).
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_commentId_workItemId_tenantId_fkey" FOREIGN KEY ("commentId", "workItemId", "tenantId") REFERENCES "Comment"("id", "workItemId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- A removed member's mentions go with the membership, and render as text.
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_tenantId_mentionedUserId_fkey" FOREIGN KEY ("tenantId", "mentionedUserId") REFERENCES "TenantMembership"("tenantId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 2) One row per source and person ─────────────────────────────

CREATE UNIQUE INDEX "Mention_one_per_description_person"
    ON "Mention" ("tenantId", "workItemId", "mentionedUserId") WHERE "commentId" IS NULL;
CREATE UNIQUE INDEX "Mention_one_per_comment_person"
    ON "Mention" ("tenantId", "commentId", "mentionedUserId") WHERE "commentId" IS NOT NULL;

-- ─── 3) Grants and canonical RLS ──────────────────────────────────

-- DELETE: an edit that removes a token removes its row, and so does a
-- comment's soft delete. The application never updates a row (it is
-- written once); UPDATE is granted as on every tenant table, so a later
-- move of a row is a usecase change rather than a grant migration.
GRANT SELECT, INSERT, UPDATE, DELETE ON "Mention" TO app_user;

ALTER TABLE "Mention" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Mention" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Mention"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "Mention"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "Mention"
    USING (current_setting('role') != 'app_user');

-- ─── 4) Immediate email for mentions ──────────────────────────────

ALTER TABLE "NotificationPreference" DROP CONSTRAINT "NotificationPreference_immediate_types";
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_immediate_types"
    CHECK ("emailDelivery" <> 'IMMEDIATE' OR "type" IN ('WORK_ITEM_ASSIGNED', 'WORK_ITEM_WAITING_ON', 'WORK_ITEM_MENTIONED'));
