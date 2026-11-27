# Workload: capacity and time off

Sub-phase 3.5a: capacity and time off, with a capacity-only grid. The decisions are owner decisions 282 to 303 (`docs/HANDOFF.md`), recorded in [ADR 0013](adr/0013-workload-and-capacity.md) and the porting map [`docs/porting/maps/3.5.md`](porting/maps/3.5.md), whose "Rules no decision names (3.5a, as built)" lists the choices the build made. Allocation, the over-capacity flags, the cell sheet and My Work's line (3.5b) and the ways to rebalance (3.5c) are not built yet.

The words are ADR 0006's: Capacity, Time off, Time off type, Workload, Workload settings; "Add time off". Never Availability, Leave, Day off, Absence, PTO, Allowance, Quota or Utilisation, and "Holiday" is only a working calendar's day off for everyone (decision 303): time off's types are Vacation, Sick and Other.

## Capacity

A member's capacity is the hours a week they can work.

- **The workspace's default** (`TenantWorkloadSettings.defaultWeeklyMinutes`, 0 to 6,000 minutes, CHECKed): 40 hours while no row is saved. Changed under `workload.manage` on Settings → Workload (`PUT /workload-settings`, `If-Match` the version read), audited `WORKLOAD_SETTINGS_SET` with the value before and after.
- **A member's own** (`MemberCapacity`, decision 284): from a chosen Monday (CHECKed, 400 `NOT_A_MONDAY`) until their next row, 0 to 6,000 minutes, and the team whose working calendar they count on (decision 285; NULL the workspace's). Earlier rows are kept as history. `PUT /members/:userId/capacity` replaces that Monday's row (its version named by `If-Match`, 409 `VERSION_CONFLICT`) or adds one; `DELETE /members/:userId/capacity/:id` removes only a row whose Monday is after the current week (409 `CAPACITY_IN_EFFECT`), through the undo toast. Audited `MEMBER_CAPACITY_SET` / `_REMOVED` with the person, the Monday, the minutes and the calendar.
- **A team deleted later** clears the row's calendar (`ON DELETE SET NULL ("calendarTeamId")`): the person counts on the workspace's calendar again. A team with no calendar of its own already resolves to the workspace's.
- **A deactivated member** has no capacity while deactivated; their rows are kept.

### Capacity in a week

`src/app-layer/domain/workload/capacity.ts` (pure, client-safe, property-tested):

1. The week's minutes are shared over the person's calendar's working weekdays, each `floor(W / perWeek)` and the remainder one minute at a time to the earliest, so the shares sum to `W` (40 hours on Monday to Friday is 8 hours a day).
2. A holiday on that calendar keeps its share at zero: its hours are lost, not moved.
3. A date of time off removes the day's whole share (a whole day) or `min(minutes, share)`; on a weekend, a non-working weekday or a holiday it removes nothing more. The type plays no part.

The calendars come from `resolveWorkingCalendars` and every working-day test from the scheduling module (ADR 0010: one working-day count). "Today" and the current week are the workspace calendar's.

## Time off

`TimeOff` (decision 286) is one row per person and date: the hours off (1 to 1,439 minutes) or the whole day (`minutes` NULL, kept a whole day whatever the capacity later is), with a type.

- **A range is entered as a range** ("Add time off": from, to, the type, whole days or hours each day) and stored date by date on the working days of the person's calendar; the dialog previews them, each date can be left out, and dates already holding time off are named as replaced. Each date can then be changed or removed on its own.
- **Who** (decision 288): the person records, changes and removes their own (`workload.time_off`: Owners, Admins, Members and Viewers); a holder of `workload.manage` records anyone's. Nobody approves time off: Islestone is not an HR system. When someone else writes your time off you get one bell, `TIME_OFF_CHANGED_BY_OTHER` (decision 300; bell only, never email), naming who and the dates, never the type; the date shows "Recorded by someone else".
- **A person only.** An API key, an agent, a job and the system user never write capacity or time off (403 `NOT_A_PERSON`, audited), and never read a type (ADR 0003 §4).
- **Writes are batches, all or nothing.** `PUT /time-off/days { userId?, days: [{ day, minutes, type, version? }] }` and `POST /time-off/days/remove { userId?, days: [{ day, version }] }`, at most 366 dates. Each changed date names the version read (none for a new date); one mismatch refuses the whole write, 409 `VERSION_CONFLICT` naming the dates. Every write takes the person's advisory lock first, then their membership `FOR KEY SHARE`; a person who is no longer an active member is a 400 `NOT_A_MEMBER`. Audited `TIME_OFF_SET` and `TIME_OFF_REMOVED` with dates and hours only.
- **Kept for the workspace's life** (decision 289): no job deletes time off. A removed member's capacity and time off go with the membership (their keys cascade, in `removeTenantMember`'s own transaction); a deactivated member keeps theirs.
- **Time off shapes no schedule** (decision 290) and reaches no external calendar (decision 291): the timeline, the calendar view, review steps' due days and calendar sync are unchanged.

### The type, held apart

"Sick" is health data, a special category of personal data. Islestone processes it on the workspace's behalf, and **a workspace that marks dates "Sick" records health data visible to the person and to whoever holds `workload.manage`** (Owners and Admins, or a custom role). It is treated as the most sensitive value in the product:

- **Encrypted** under the workspace's data key (`ENCRYPTED_FIELDS.TimeOff = ['type']`), never a Postgres enum; both key rotations rewrite it.
- **One length for every value.** `TimeOffRepository` pads the code (`VACATION`, `SICK`, `OTHER`) to 8 characters before it is encrypted and trims it after, so the ciphertexts have equal lengths (`VACATION` is exactly 8).
- **Never plaintext**: the CHECK `TimeOff_type_ciphertext` refuses a value that is not an envelope.
- **Never audited, logged, indexed, searched, notified, exported or counted.** The Prisma audit extension names the field on a row write and never records its value; the audit entries carry dates and hours.
- **Absent from every read for a caller who may not see it** (`mayReadTimeOffType`: the person, or a holder of `workload.manage`, signed in): the workload read never selects it, and `GET /time-off` omits the key, never sending `null`. Everyone holding `workload.view` sees the dates and hours.

## Who may do what

The `workload` permission domain (decision 298):

| Role | view | time_off | manage |
|---|---|---|---|
| Owner, Admin | yes | yes | yes |
| Member, Viewer | yes | yes | |
| Guest | | | |

The granular key decides (`src/app-layer/policies/workload.policies.ts`); a custom role stored before 3.5 takes its base role's `workload` keys. Pages read `workloadAffordances` on the server.

| Act | Route | Key |
|---|---|---|
| Capacity per person per week | `GET /workload?from&weeks&userId` | `workload.view` |
| Settings → Workload's members | `GET /workload/members` | `workload.manage` |
| The default | `GET` / `PUT /workload-settings` | `workload.view` / `workload.manage` |
| A member's capacity | `GET` / `PUT /members/:userId/capacity` | `workload.view` / `workload.manage` |
| Remove a future change | `DELETE /members/:userId/capacity/:id` | `workload.manage` |
| A person's time off | `GET /time-off?from&to&userId` | `workload.view` |
| Record, remove dates | `PUT /time-off/days`, `POST /time-off/days/remove` | `workload.time_off` (another person's also `workload.manage`, audited 403 `WORKLOAD_MANAGE_REQUIRED`) |

None sits under `/admin/`, which the edge refuses to non-admins.

## The Workload page (3.5a)

The Workload sidebar entry (`workload.view`) opens `/workload`:

- **My capacity and time off**: the person's capacity in force ("40h a week · Workspace calendar", or the workspace's default) and their time off as a month of dates (a `role=grid` with a roving tabindex), each date showing its hours or "Whole day" and its type; "Add time off"; a date opened to change it in place or remove it through the undo toast.
- **Capacity by week**: one row per active member (every role but Guest), one column per week, twelve weeks from the current one (at most 26 per read; never before the current week, 400 `WORKLOAD_RANGE`; at most 500 people, 422 `WORKLOAD_TOO_LARGE`, never cut). Each cell is the week's capacity after holidays and time off, with "Time off 8h" when time off removed some; its label says it in words. Never a type.

Settings → Workload (`/settings/workload`): the default weekly hours, the members table (capacity in force, its calendar, the next change; "Change capacity" from a Monday; removing a future change), and any member's time off with its types.

The data is `src/components/workload/data/` (`use-workload.ts`, `use-time-off.ts`).

## Privacy

| Concern | 3.5a |
|---|---|
| Records | Hours a week, dates and hours away, and a three-word reason, one of which is health data. Nothing is inferred from activity. |
| Retention | The workspace's life; the person or a manager deletes any date; a removed member's rows go with the membership. |
| Logs | Never a person's capacity, time off or type; ids and counts. |
| Search, export, calendar sync | None. |
