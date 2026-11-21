-- Roadmap 3.1a: working calendars (docs/porting/maps/3.1.md, "Working
-- calendars"; ADR 0010 §5; owner decisions 189 to 193; docs/scheduling.md).
--
--   1. Prisma's DDL: two tenant tables, a workspace's or a team's working
--      calendar and its holidays.
--   2. What Prisma cannot declare: one workspace calendar per workspace and
--      one calendar per team (partial uniques), the working weekdays (a
--      non-empty, ascending, unique set of ISO weekdays 1 to 7), the names'
--      and the time zone's lengths.
--   3. Grants and the canonical RLS. A team's calendar is removed and a
--      holiday deleted, so `app_user` holds DELETE on both tables.
--
-- The tables are this image's own: the previous image never reads them.

-- ─── 1) Prisma's DDL ─────────────────────────────────────────────

-- CreateTable
CREATE TABLE "WorkingCalendar" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "teamId" TEXT,
    "name" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "workingWeekdays" INTEGER[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkingCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkingCalendarHoliday" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkingCalendarHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkingCalendar_tenantId_teamId_idx" ON "WorkingCalendar"("tenantId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkingCalendar_id_tenantId_key" ON "WorkingCalendar"("id", "tenantId");

-- CreateIndex
CREATE INDEX "WorkingCalendarHoliday_tenantId_calendarId_day_idx" ON "WorkingCalendarHoliday"("tenantId", "calendarId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "WorkingCalendarHoliday_calendarId_day_key" ON "WorkingCalendarHoliday"("calendarId", "day");

-- AddForeignKey
ALTER TABLE "WorkingCalendar" ADD CONSTRAINT "WorkingCalendar_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingCalendar" ADD CONSTRAINT "WorkingCalendar_teamId_tenantId_fkey" FOREIGN KEY ("teamId", "tenantId") REFERENCES "Team"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingCalendarHoliday" ADD CONSTRAINT "WorkingCalendarHoliday_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingCalendarHoliday" ADD CONSTRAINT "WorkingCalendarHoliday_calendarId_tenantId_fkey" FOREIGN KEY ("calendarId", "tenantId") REFERENCES "WorkingCalendar"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── 2) What Prisma cannot declare ────────────────────────────────

-- One workspace calendar per workspace, one calendar per team.
CREATE UNIQUE INDEX "WorkingCalendar_one_workspace_calendar" ON "WorkingCalendar"("tenantId") WHERE "teamId" IS NULL;
CREATE UNIQUE INDEX "WorkingCalendar_one_per_team" ON "WorkingCalendar"("tenantId", "teamId") WHERE "teamId" IS NOT NULL;

-- A set of ISO weekdays: non-empty, each 1 to 7, ascending and unique (the
-- usecase sorts and de-duplicates before it writes).
CREATE FUNCTION working_calendar_weekdays_valid(days integer[]) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT days IS NOT NULL
       AND cardinality(days) BETWEEN 1 AND 7
       AND array_position(days, NULL) IS NULL
       AND days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]
       AND days = ARRAY(SELECT DISTINCT d FROM unnest(days) AS d ORDER BY d)
$$;

ALTER TABLE "WorkingCalendar" ADD CONSTRAINT "WorkingCalendar_working_weekdays"
    CHECK (working_calendar_weekdays_valid("workingWeekdays"));
ALTER TABLE "WorkingCalendar" ADD CONSTRAINT "WorkingCalendar_name_length"
    CHECK (char_length("name") BETWEEN 1 AND 80);
ALTER TABLE "WorkingCalendar" ADD CONSTRAINT "WorkingCalendar_time_zone_length"
    CHECK (char_length("timeZone") BETWEEN 1 AND 64);
ALTER TABLE "WorkingCalendar" ADD CONSTRAINT "WorkingCalendar_version_positive" CHECK ("version" >= 1);
ALTER TABLE "WorkingCalendarHoliday" ADD CONSTRAINT "WorkingCalendarHoliday_name_length"
    CHECK (char_length("name") BETWEEN 1 AND 80);

-- ─── 3) Grants and RLS ─────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON "WorkingCalendar", "WorkingCalendarHoliday" TO app_user;

ALTER TABLE "WorkingCalendar" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkingCalendar" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkingCalendar"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "WorkingCalendar"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "WorkingCalendar"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "WorkingCalendarHoliday" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkingCalendarHoliday" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkingCalendarHoliday"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "WorkingCalendarHoliday"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "WorkingCalendarHoliday"
    USING (current_setting('role') != 'app_user');
