-- Sub-phase 3.6d: dashboards (docs/porting/maps/3.6.md, "Dashboards (3.6d)";
-- ADR 0014 §6; owner decisions 326 to 329).
--
-- 1) `Dashboard`: a page of analytics widgets, PERSONAL (its creator's) or
--    SHARED (every holder of `analytics.view`). `createdByUserId` is an actor
--    stamp with no FK: removing a member deletes their personal dashboards in
--    the removal's transaction, and a shared one keeps the stamp ("Created by
--    a former member"). `version` is the dashboard's `If-Match`.
-- 2) `DashboardWidget`: one chart or figure, its type, an optional title, its
--    configuration (validated by the application on every write and read)
--    and its place on the grid, inflect-compliance's bounds (x, y 0..47;
--    w 1..12; h 1..24). It goes with its dashboard (ON DELETE CASCADE).
--
-- Both are tenant tables: tenant-leading indexes, the four row-level-security
-- policies with FORCE, and their own grants. The previous image never reads
-- either table.

-- ─── 1) Prisma's DDL ─────────────────────────────────────────────
CREATE TYPE "DashboardVisibility" AS ENUM ('PERSONAL', 'SHARED');

CREATE TYPE "DashboardWidgetType" AS ENUM ('COUNTS', 'THROUGHPUT', 'CYCLE_TIME', 'LEAD_TIME', 'CUMULATIVE_FLOW', 'BURN_UP', 'FORECAST', 'TIME_WAITING');

CREATE TABLE "Dashboard" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" "DashboardVisibility" NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dashboard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DashboardWidget" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "type" "DashboardWidgetType" NOT NULL,
    "title" TEXT,
    "configJson" JSONB NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "w" INTEGER NOT NULL,
    "h" INTEGER NOT NULL,

    CONSTRAINT "DashboardWidget_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Dashboard_tenantId_createdByUserId_idx" ON "Dashboard"("tenantId", "createdByUserId");
CREATE INDEX "Dashboard_tenantId_visibility_idx" ON "Dashboard"("tenantId", "visibility");
CREATE UNIQUE INDEX "Dashboard_id_tenantId_key" ON "Dashboard"("id", "tenantId");
CREATE INDEX "DashboardWidget_tenantId_dashboardId_idx" ON "DashboardWidget"("tenantId", "dashboardId");
CREATE UNIQUE INDEX "DashboardWidget_id_tenantId_key" ON "DashboardWidget"("id", "tenantId");

ALTER TABLE "Dashboard" ADD CONSTRAINT "Dashboard_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DashboardWidget" ADD CONSTRAINT "DashboardWidget_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DashboardWidget" ADD CONSTRAINT "DashboardWidget_dashboardId_tenantId_fkey" FOREIGN KEY ("dashboardId", "tenantId") REFERENCES "Dashboard"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 2) What Prisma cannot declare ────────────────────────────────

-- A name of 1 to 80 characters and a version of 1 or more.
ALTER TABLE "Dashboard" ADD CONSTRAINT "Dashboard_name_length"
    CHECK (char_length("name") BETWEEN 1 AND 80);
ALTER TABLE "Dashboard" ADD CONSTRAINT "Dashboard_version_positive"
    CHECK ("version" >= 1);

-- A title of at most 120 characters (NULL: the type's default), the grid's
-- bounds, and a configuration that is a JSON object.
ALTER TABLE "DashboardWidget" ADD CONSTRAINT "DashboardWidget_title_length"
    CHECK ("title" IS NULL OR char_length("title") BETWEEN 1 AND 120);
ALTER TABLE "DashboardWidget" ADD CONSTRAINT "DashboardWidget_grid_bounds"
    CHECK ("x" BETWEEN 0 AND 47 AND "y" BETWEEN 0 AND 47 AND "w" BETWEEN 1 AND 12 AND "h" BETWEEN 1 AND 24);
ALTER TABLE "DashboardWidget" ADD CONSTRAINT "DashboardWidget_config_object"
    CHECK (jsonb_typeof("configJson") = 'object');

-- ─── 3) Grants and row-level security ─────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON "Dashboard" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "DashboardWidget" TO app_user;

ALTER TABLE "Dashboard" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Dashboard" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Dashboard"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "Dashboard"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "Dashboard"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "DashboardWidget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DashboardWidget" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DashboardWidget"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "DashboardWidget"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "DashboardWidget"
    USING (current_setting('role') != 'app_user');
