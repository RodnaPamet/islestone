# Scheduling and working calendars

Roadmap 3.1 (`docs/porting/maps/3.1.md`), [ADR 0010](adr/0010-scheduling-and-working-calendars.md), owner decisions 182 to 203. This page describes what sub-phase 3.1a built: the scheduling engine, working calendars, review steps on calendars, the project's due date and the start-after-due rule. The timeline view (3.1b) and changing dates from it (3.1c) are not built yet.

## The engine

`src/app-layer/domain/schedule/` is pure and client-safe: plain data in, plain data out, no database, no clock, no time zone, no `@/env`. The server and (from 3.1c) the browser run the same module; there is no second implementation.

| File | What it holds |
|---|---|
| `calendar.ts` | Epoch days (`toEpochDay`, `fromEpochDay`, `epochDayToDate`), `compileCalendar`, `isWorkingDay`, `nextWorkingDay` / `previousWorkingDay` (the day itself when it works), `addWorkingDays` / `subtractWorkingDays` (`n ≥ 0`, counting from the first working day on or after the day), `workingDaysInclusive`, `workingDayDiff`, `workingDaysAfter` (a review step's due day: the day itself never counts), `todayIn` (the only function that reads a zone, through `Intl`), `isKnownTimeZone` and `copyHolidaysToYear` ("Copy last year's"). |
| `types.ts` | `ScheduleInput`, `ScheduleItem`, `ScheduleEdge`, `ItemSchedule`, `ScheduleResult`, `SCHEDULE_ITEM_LIMIT` (20,000). |
| `engine.ts` | `computeSchedule(input)`. |

An epoch day is a whole number of days since 1970-01-01: a civil date, never an instant. A calendar compiles to a weekday mask and its holidays on working weekdays, sorted; a count over a span steps whole weeks, the remainder and the holidays in range by bisection, so it is O(log h).

### The rules (ADR 0010 §2 to §4)

1. **Validate.** A duplicate item or calendar, an unknown calendar or an edge to an unknown item throws (a programmer error). Over 20,000 items returns `TOO_LARGE` before any work.
2. **Summaries** (decision 186). An item with sub-items in the input is a summary, not scheduled itself; a blocks relation into it applies to every leaf sub-item and one out of it leaves from every leaf. A relation between an item and its own sub-item is left out and named (`EDGE_INSIDE_SUMMARY`). A summary's result spans its leaves; `SUMMARY_OUTSIDE_PLANNED_DATES` names one whose leaves run past its own dates.
3. **Duration** on the item's calendar (decisions 184, 185): both dates, the working days between them (at least 1); one date, 1; neither, 0 and `unscheduled` ("No dates"); start after due, `DATES_REVERSED` and 1 day at the due date. An undated item inside a chain counts zero days and is named (`UNSCHEDULED_IN_CHAIN`).
4. **Order.** Kahn's sort with the ready set ordered by id. A remainder is `CYCLE`, naming one cycle in blocks order from its smallest id; it answers exactly when `wouldCreateCycle` would (a property test).
5. **Forward pass** (decision 187). Done: fixed at its actual dates (`startedAt`, `completedAt` in its calendar's zone, else its planned dates); it holds nothing back after it finished and is never critical. Started: from its actual start, never finishing before today. Open: not before today, its start date or the day after each blocker's earliest finish, on its own calendar's next working day, so a cross-team relation needs no common unit. `STARTS_BEFORE_BLOCKER_FINISHES` when its plan (the start date, or a due-only item's due day) is before an open or started blocker's finish.
6. **Backward pass.** The latest finish is the earliest of the finish in view, the item's milestone's due date, its project's due date (decision 188) and the day before each open successor's latest start. A successor already started or done bounds nothing.
7. **Float** in working days on the item's calendar: total float from earliest to latest finish (negative when a deadline is missed: `lateDays`, "Late by N days"), free float to the earliest successor start, never negative nor more than a positive total float. `MISSES_MILESTONE_DUE_DATE` and `MISSES_PROJECT_DUE_DATE` are reported each on its own.
8. **Critical** (decision 198): the open and started items with the least total float in view, when that is 0 or less, and the input edges between two critical items that leave no gap. An undated item with no relation is never critical.

Results are sorted by id; every number is an integer. Nothing here writes a date (decision 184).

### Tests (H3)

`tests/unit/domain/schedule-engine.test.ts` (vectors written by hand: the float vector, a weekend, a holiday inside a duration, two calendars across an edge, a started item past its due date, a done item, deadlines earlier, later and equal, summaries, a cycle), `schedule-properties.test.ts` (cycles refused exactly when the relation usecase would, reordering, idempotence, monotonicity in edges, today and holidays, the critical path, no date of an open item on a non-working day), `schedule-calendar.test.ts` (the arithmetic against a day-by-day reference; `todayIn` one second either side of every offset change of six zones from 2020 to 2030, the date line and Apia's skipped day), `schedule-timezones.test.ts` (byte-equal results under five process time zones, each in its own process) and `schedule-performance.test.ts` (5,000 items and 10,000 relations; about 20 ms median and 30 ms p95 alone in Node on the development machine; the test fails at four times the 50 ms p95 budget).

## Working calendars

`WorkingCalendar` and `WorkingCalendarHoliday` (`prisma/schema/scheduling.prisma`, migration `20261212120000_working_calendars`): one workspace calendar (`teamId` NULL) and at most one per team (two partial uniques), each a name, an IANA time zone, working weekdays (ISO 1 to 7: non-empty, ascending, unique, by CHECK) and a `version` every change moves; holidays a date and a name, unique per calendar. Names are plaintext workspace configuration, sanitised, at most 80 characters (CHECK); not personal data, so not encrypted. A team's deletion removes its calendar.

- **Which calendar** (decision 189): an item's team's, else the workspace's. A workspace with no row counts Monday to Friday, no holidays, in `NOTIFICATIONS_TZ`; Settings shows that default, and the first save, or the first holiday added, stores it.
- **"Today"** (decision 191) is today in the calendar's zone (`todayIn`); the nightly jobs keep firing in `NOTIFICATIONS_TZ`.
- **Holidays** (decision 190) are entered by hand. "Copy last year's" and "Copy the workspace's holidays" are computed in the browser (`copyHolidaysToYear`; 29 February becomes 28) and posted to the add route, which skips a date already there and answers `added` and `skipped`. At most 500 holidays per calendar (`TOO_MANY_HOLIDAYS`), 100 per request, in the years 2000 to 2199.
- **Keys** (decision 193): read under `projects.view`, written under `admin.manage` (`workConfigAffordances().manageWorkConfig` on the page).
- **Routes:** `GET`/`PUT /working-calendar` (the workspace's, with which teams have their own), `POST /working-calendar/holidays`, `DELETE /working-calendar/holidays/:holidayId`, `GET`/`PUT`/`DELETE /teams/:teamId/working-calendar`, `POST /teams/:teamId/working-calendar/holidays`, `DELETE /teams/:teamId/working-calendar/holidays/:holidayId`. Refusals: `TIME_ZONE_UNKNOWN` (a zone both `Intl` and `pg_timezone_names` must know), `WEEKDAYS_INVALID`, `NAME_INVALID`, `HOLIDAY_DATE_INVALID`, `NO_TEAM_CALENDAR` (a team holiday before the team has its own calendar).
- **Audit** (`category: 'entity_lifecycle'`): `WORKING_CALENDAR_SET` (scope, team, zone and weekdays, before and after), `WORKING_CALENDAR_HOLIDAYS_CHANGED` (the dates added and removed, never the names), `WORKING_CALENDAR_REMOVED`.
- **One read for arithmetic:** `resolveWorkingCalendars(db, ctx, teamIds?)` (`usecases/working-calendar.ts`) returns the workspace's calendar and `forTeam(teamId)`, compiled; every caller that counts working days uses it.
- **Settings → Working calendars** (`settings/working-calendars`, and a team's at `settings/working-calendars/[teamId]`; `WorkingCalendarSettings.tsx`): the zone, the weekdays, the holidays, the teams. Removing a holiday and taking a team back to the workspace's calendar go through the undo toast (`use-undo-delete.ts`). Copy is `settings.workingCalendars.*`.

Changing a calendar changes no stored date (ADR 0010 §5).

## Review steps on calendars (decision 192)

A step opened from 3.1a stores its due day as `workingDaysAfter(calendar, today in the calendar's zone, n)` on the item's team's calendar, else the workspace's (`openStepInTx` in `review-engine.ts`). With no calendar edited that is exactly 2.8's Monday to Friday in `NOTIFICATIONS_TZ` (`tests/integration/working-calendars.test.ts` proves it). A stored `dueOn` never moves (ADR 0009 §13). The 08:00 job reads the same calendar for "today" and "the next working day" of each pending reviewer's item. `src/app-layer/domain/working-days.ts` keeps 2.8's `Date` signatures over the calendar module, Monday to Friday when no calendar is given.

## The project's due date (decision 188)

`Project.dueDate` (migration `20261212120100_project_due_date`), optional and date-only, set on `POST /projects` (`projects.create`) and `PATCH /projects/:id` (`projects.edit`), returned as `YYYY-MM-DD`, audited by naming the field in `PROJECT_CREATED` / `PROJECT_UPDATED`. It is a deadline for the schedule and nothing else: it moves no item or milestone, is never refused against them and rings nothing (ADR 0002 §16). A project template carries it as `projectDueInDays` (an offset from the day the template is saved), dated from today when used, unless the create names a due date (`null` included). UI: the create dialog's Due date, Settings → Projects' "Change due date" and column, the Projects list's column and the project page's header (`ProjectDueDate`, offered with `editProject` on an unarchived project). Copy is `settings.projects.dueDate*` and `workItems.projects.dueDate.*`.

## Start after due (ADR 0010 §3)

A write that would leave an item's start date after its due date is refused, 400 `START_AFTER_DUE` (`assertStartNotAfterDue` in `work-item-shared.ts`): every create (`createWorkItemInTx`, so the dialog, the API, intake accept, templates and repeat copies), an edit of either date (`updateWorkItem`), and the bulk due-date change (naming the items in `details.workItemIds`). A write that touches neither date is not refused, and rows written before are never rewritten: the schedule reports them (`DATES_REVERSED`). A repeat whose source has its start after its due date makes copies without a start, named `startDate:afterDue` in `skipped`.
