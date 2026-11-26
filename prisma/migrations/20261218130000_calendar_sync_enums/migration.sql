-- Roadmap 3.3b: calendar sync's four enums (docs/porting/maps/3.3.md, "Calendar
-- sync: the model"; ADR 0011). New types, not new values of an existing type,
-- so the four share one migration; the tables follow in
-- 20261218130100_calendar_sync. Nothing in the previous image reads them.

-- CreateEnum
CREATE TYPE "CalendarProvider" AS ENUM ('GOOGLE', 'MICROSOFT');

-- CreateEnum
CREATE TYPE "CalendarConnectionState" AS ENUM ('CONNECTED', 'REVOKED', 'DISCONNECTING', 'CALENDAR_REMOVED');

-- CreateEnum
CREATE TYPE "CalendarSyncedEventState" AS ENUM ('PUSHED', 'PENDING_DELETE', 'FAILED', 'REMOVED_IN_CALENDAR');

-- CreateEnum
CREATE TYPE "CalendarSyncedEventKind" AS ENUM ('WORK_ITEM', 'MILESTONE');

