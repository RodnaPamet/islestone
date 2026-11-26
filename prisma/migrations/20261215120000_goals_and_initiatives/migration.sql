-- Sub-phase 3.2a: goals and initiatives (docs/porting/maps/3.2.md, "The
-- model"; ADR 0002 §2 and §17; ADR 0006 "Goal and roadmap words of
-- sub-phase 3.2"; owner decisions 205 to 224).
--
--   1. The three enums: `Health` (a person's judgement, decision 205),
--      `GoalStatus` and `InitiativeStatus` (the lifecycle, decision 208).
--   2. `Goal` and `Initiative`: workspace-scoped records above projects,
--      never work items. Descriptions are encrypted by the application
--      (the manifest), titles and names plaintext.
--   3. What Prisma cannot declare: the parent goal and an initiative's goal
--      are column-scoped `ON DELETE SET NULL`, so only the purge (decision
--      219) deletes a row and the database clears the link without touching
--      `tenantId`; the length CHECKs; archive only while Completed or
--      Cancelled (decision 218); `deletedAt` and `deletionId` together; a goal
--      is never its own parent.
--   4. Grants and the canonical RLS. `app_user` holds DELETE on both tables
--      for the purge alone (`GoalRepository.purgeBatch`,
--      `InitiativeRepository.purgeBatch`), as it does for the work-item purge.
--
-- Nothing here touches a table the previous image reads.

-- ─── 1) Enums ─────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "Health" AS ENUM ('ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'COMPLETED');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('PLANNED', 'STARTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InitiativeStatus" AS ENUM ('PLANNED', 'STARTED', 'COMPLETED', 'CANCELLED');

-- ─── 2) Prisma's DDL ──────────────────────────────────────────────

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "GoalStatus" NOT NULL DEFAULT 'PLANNED',
    "dueDate" DATE,
    "leadUserId" TEXT,
    "health" "Health",
    "healthSetAt" TIMESTAMP(3),
    "healthSetByUserId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "archivedByUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,
    "deletionId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Initiative" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "goalId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "InitiativeStatus" NOT NULL DEFAULT 'PLANNED',
    "dueDate" DATE,
    "leadUserId" TEXT,
    "health" "Health",
    "healthSetAt" TIMESTAMP(3),
    "healthSetByUserId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "archivedByUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,
    "deletionId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Initiative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Goal_tenantId_parentId_idx" ON "Goal"("tenantId", "parentId");

-- CreateIndex
CREATE INDEX "Goal_tenantId_leadUserId_idx" ON "Goal"("tenantId", "leadUserId");

-- CreateIndex
CREATE INDEX "Goal_tenantId_deletedAt_archivedAt_status_idx" ON "Goal"("tenantId", "deletedAt", "archivedAt", "status");

-- CreateIndex
CREATE INDEX "Goal_tenantId_deletionId_idx" ON "Goal"("tenantId", "deletionId");

-- CreateIndex
CREATE UNIQUE INDEX "Goal_id_tenantId_key" ON "Goal"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Initiative_tenantId_goalId_idx" ON "Initiative"("tenantId", "goalId");

-- CreateIndex
CREATE INDEX "Initiative_tenantId_leadUserId_idx" ON "Initiative"("tenantId", "leadUserId");

-- CreateIndex
CREATE INDEX "Initiative_tenantId_deletedAt_archivedAt_status_idx" ON "Initiative"("tenantId", "deletedAt", "archivedAt", "status");

-- CreateIndex
CREATE INDEX "Initiative_tenantId_deletionId_idx" ON "Initiative"("tenantId", "deletionId");

-- CreateIndex
CREATE UNIQUE INDEX "Initiative_id_tenantId_key" ON "Initiative"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_tenantId_leadUserId_fkey" FOREIGN KEY ("tenantId", "leadUserId") REFERENCES "TenantMembership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Initiative" ADD CONSTRAINT "Initiative_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Initiative" ADD CONSTRAINT "Initiative_tenantId_leadUserId_fkey" FOREIGN KEY ("tenantId", "leadUserId") REFERENCES "TenantMembership"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── 3) The tree's keys, column-scoped (decision 219) ─────────────

-- Only the link column is cleared when the purge deletes the parent:
-- `tenantId` is NOT NULL and keeps its value.
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_parentId_tenantId_fkey" FOREIGN KEY ("parentId", "tenantId") REFERENCES "Goal"("id", "tenantId") ON DELETE SET NULL ("parentId") ON UPDATE NO ACTION;

ALTER TABLE "Initiative" ADD CONSTRAINT "Initiative_goalId_tenantId_fkey" FOREIGN KEY ("goalId", "tenantId") REFERENCES "Goal"("id", "tenantId") ON DELETE SET NULL ("goalId") ON UPDATE NO ACTION;

-- ─── 4) CHECKs ────────────────────────────────────────────────────

ALTER TABLE "Goal" ADD CONSTRAINT "Goal_title_length"
    CHECK (char_length("title") BETWEEN 1 AND 200);
ALTER TABLE "Initiative" ADD CONSTRAINT "Initiative_name_length"
    CHECK (char_length("name") BETWEEN 1 AND 120);
-- Archive keeps a finished goal or initiative whole and hidden (decision 218).
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_archived_finished_only"
    CHECK ("archivedAt" IS NULL OR "status" IN ('COMPLETED', 'CANCELLED'));
ALTER TABLE "Initiative" ADD CONSTRAINT "Initiative_archived_finished_only"
    CHECK ("archivedAt" IS NULL OR "status" IN ('COMPLETED', 'CANCELLED'));
-- One group per delete: both or neither.
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_deletion_group"
    CHECK (("deletedAt" IS NULL) = ("deletionId" IS NULL));
ALTER TABLE "Initiative" ADD CONSTRAINT "Initiative_deletion_group"
    CHECK (("deletedAt" IS NULL) = ("deletionId" IS NULL));
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_not_own_parent"
    CHECK ("parentId" IS NULL OR "parentId" <> "id");

-- ─── 5) Grants and canonical RLS ──────────────────────────────────

-- DELETE: used by the purge alone (decision 219); the usecases soft-delete.
GRANT SELECT, INSERT, UPDATE, DELETE ON "Goal" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Initiative" TO app_user;

ALTER TABLE "Goal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Goal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Goal"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "Goal"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "Goal"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "Initiative" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Initiative" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Initiative"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "Initiative"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "Initiative"
    USING (current_setting('role') != 'app_user');
