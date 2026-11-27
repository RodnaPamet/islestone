# Workload: capacity, time off and allocation

Sub-phases 3.5a (capacity and time off) and 3.5b (allocation and the Workload view). The decisions are owner decisions 282 to 303 (`docs/HANDOFF.md`), recorded in [ADR 0013](adr/0013-workload-and-capacity.md) and the porting map [`docs/porting/maps/3.5.md`](porting/maps/3.5.md), whose "Rules no decision names (3.5a, as built)" and "(3.5b, as built)" list the choices the builds made. The ways to rebalance (3.5c) are not built yet.

The words are ADR 0006's: Capacity, Time off, Time off type, Workload, Allocated, Over capacity, Free, Workload settings; "Add time off", "Over by 6h". Never Availability, Leave, Day off, Absence, PTO, Allowance, Quota, Utilisation, Booked, Overbooked, Overloaded or Overtime, and "Holiday" is only a working calendar's day off for everyone (decision 303): time off's types are Vacation, Sick and Other.

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

## Allocation (3.5b)

Allocation is computed on every read and never stored (decisions 292 to 296; ADR 0013 §6 and §7).

### What counts

An item counts toward its **assignee** when it is live, open (Backlog, Unstarted or Started), in a visible, unarchived project, and its team estimates in hours with an estimate (decision 292). Each item counts its own estimate: a parent and its sub-items each count what they hold. Waiting on and reviewers carry no allocation. Beside the hours each row names what could not be placed:

- **No dates**: counted items with neither date (their count and remaining hours);
- **Not estimated**: open assigned items with no hours estimate, in hours teams and in teams that do not estimate (their count);
- **Points work**: open assigned items of points teams (their count and points). Points are never converted to hours (decision 294, ADR 0012).
- **Later**: hours placed in weeks after the ones shown.

Work assigned to nobody is a row of its own, **Unassigned**, never compared with a capacity. A deactivated member who still holds open work is a row with no capacity, so their work shows as over capacity and can be handed on.

### Placing hours into weeks

`src/app-layer/domain/workload/allocation.ts` (pure, client-safe, property-tested), each item on **its own** calendar (its team's, else the workspace's; ADR 0010 §5), "today" in that calendar's zone:

1. **Remaining**: the estimate less the finished time recorded on the item, never below zero, when the viewer holds `time.view` (decision 295: the total every holder of `time.view` already sees on the item); otherwise the whole estimate, and the page says so.
2. **The span** is the engine's `plannedSpanOf`: start to due; one date, one working day on it; start after due, one day at the due date.
3. **From today**: the hours run from the later of the span's start and today's next working day to the span's end. An item whose span ended before today is **overdue**: all of it falls on today's next working day, marked. A span with no working day left in it falls on the first working day after.
4. **Into weeks**: week `k` gets `⌈R·C(k)/D⌉ − ⌈R·C(k−1)/D⌉`, `D` the working days and `C(k)` those up to week `k`'s Sunday. Every week is within one minute of its exact share, the odd minute goes to the earlier week, the weeks sum to the remaining minutes exactly, a later due date never moves minutes earlier, and a week's figure does not depend on which weeks are shown.

Weeks are Monday to Sunday by date. An item's hours land on its own calendar's working days even when its assignee is off: the week then shows over capacity (decision 290). `src/app-layer/domain/workload/workload.ts` sums the placements per person and week beside their capacity.

### Over capacity

A week is **over capacity** when its allocated hours exceed its capacity, shown as "Over by 6h"; any allocation in a week with no capacity (all time off, a deactivated member) is over (decision 296). Nothing is enforced: assigning work into a full week is never refused, and nobody is notified.

### The read

`GET /workload?from&weeks&userId&projectId&teamId&recipientListId&over` (`workload.view`, `getWorkload` in `src/app-layer/usecases/workload.ts`):

- `from` a Monday, not before the current week (400 `WORKLOAD_RANGE`); 1 to 26 weeks, twelve by default.
- **The people**: every active member but guests (at most 500, 422 `WORKLOAD_TOO_LARGE`, never cut) and the deactivated members who still hold open work.
- **The filters narrow the people, never their figures** (decision 297): named people (`userId`, comma-separated, `me` the caller, at most 50), the people a workspace recipient list resolves to (`resolveListRecipients` at read time), those with counted work of a project or team in the weeks shown (their cells then also show that share, "12h of 38h in Website"), and those over capacity in some week shown (`over=true`). The Unassigned row shows when no people filter is set.
- **The work**: one read of the counted items (`WorkItemRepository.listForWorkload`, at most 20,000, 422 `WORKLOAD_TOO_LARGE`, never cut), one grouped count of the unplaced work (`workloadUnplacedCounts`), one grouped read of the time on the counted items (`TimeEntryRepository.totalsForItems`) for a holder of `time.view`. A window that starts after the current week reads only what is due in it or later (overdue work is on today, in the current week). No description, comment or field value.
- **Never** a time-off type, a person's recorded week (decision 266) or anything stored, audited or logged per person.

`GET /workload/cell?userId&week` (`workload.view`; `userId` a person, `me`, or `unassigned`): one week's capacity, allocation, over-capacity minutes and time-off dates with their hours (never a type), and the items that fill it, most minutes first, at most 200, each with its minutes there, its dates, its remaining hours and why it is there (spread over N working days, on one day, overdue). The items are listed only for a caller who may read work items (`itemsShown`); the figures are shown either way.

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
| Capacity and allocation per person per week | `GET /workload?from&weeks&userId&projectId&teamId&recipientListId&over` | `workload.view` |
| A week's items | `GET /workload/cell?userId&week` | `workload.view` |
| Settings → Workload's members | `GET /workload/members` | `workload.manage` |
| The default | `GET` / `PUT /workload-settings` | `workload.view` / `workload.manage` |
| A member's capacity | `GET` / `PUT /members/:userId/capacity` | `workload.view` / `workload.manage` |
| Remove a future change | `DELETE /members/:userId/capacity/:id` | `workload.manage` |
| A person's time off | `GET /time-off?from&to&userId` | `workload.view` |
| Record, remove dates | `PUT /time-off/days`, `POST /time-off/days/remove` | `workload.time_off` (another person's also `workload.manage`, audited 403 `WORKLOAD_MANAGE_REQUIRED`) |

None sits under `/admin/`, which the edge refuses to non-admins.

## The Workload page

The Workload sidebar entry (`workload.view`) opens `/workload`:

- **My capacity and time off**: the person's capacity in force ("40h a week · Workspace calendar", or the workspace's default) and their time off as a month of dates (a `role=grid` with a roving tabindex), each date showing its hours or "Whole day" and its type; "Add time off"; a date opened to change it in place or remove it through the undo toast.
- **Workload by week** (`WorkloadGrid`, a `role=grid` with a roving tabindex): one row per person, then the Unassigned row, one column per week, twelve weeks from the current one with "Previous weeks", "This week" and "Next weeks". Each cell shows "34h / 40h", a bar whose width and colour follow allocated ÷ capacity (`useHeatScale`), a red edge and "Over by 6h" when over, a filter's share, and "Time off 8h" when time off removed some; its label says all of it in words, so colour never carries meaning alone. A row ends with No dates, Not estimated, Points work and Later. The filters (people, project, team, recipient list, over capacity only) are the shared filter toolbar, kept in the address.
- **A week's items**: Enter, Space or a click on a cell opens `WorkloadCellSheet`: the week's figures and time off, then its items in the shared `DataTable` (key, title, hours this week and remaining, dates, why), each opening the item's sheet.
- **My Work's line** (decision 300): above My Work's sections, for a holder of `workload.view`, "This week 34h of 40h · next week over by 6h" with a link to the Workload page filtered to the person (`MyWorkloadLine`, the workload read for the caller's two weeks); hidden when they have no counted work in either week.

A work-item write anywhere re-reads every mounted workload read (`registerWorkload` in `work-item-cache.ts`): a change of assignee, dates, estimate or state moves hours between rows and weeks that only the server recomputes.

Settings → Workload (`/settings/workload`): the default weekly hours, the members table (capacity in force, its calendar, the next change; "Change capacity" from a Monday; removing a future change), and any member's time off with its types.

The data is `src/components/workload/data/` (`use-workload.ts`, `use-time-off.ts`).

## Performance

Measured on the 10k seed (which writes estimates on 60 % of the hours team's items, capacity for a quarter of the members and about 25 dates of time off for half of them; `scripts/seed-scale/workload.ts`):

- **Statements per request**: the view 12 (the context, the calendars and their holidays, the people and their names, the teams' units, the unplaced counts, the settings, the capacity rows, the time-off dates, the counted items, their time), My Work's line 12, a cell 12. None is per person or per item.
- **Plan checks**: "workload: open assigned items of every member over 12 weeks" (the hours teams' items on the team index, which the planner prefers to the assignee index when every assignee is asked for), "workload: one person, two weeks" (the assignee index), "time: totals for a set of items" (the item index of `TimeEntry`) and "workload: time-off dates in a window" (`TimeOff_tenantId_userId_day_key`).
- **The pure modules**: 500 people, 20,000 items, about 12,500 dates of time off and 26 weeks within 100 ms p95 in Node (`tests/unit/domain/workload-performance.test.ts`, failing at four times the budget), byte-equal under five process time zones.
- **Latency**: the `workload` scenario (twelve weeks, every member; p50 250 ms, p95 600 ms at 10k; 400 and 900 at 100k) is reported, not enforced until the nightly 100k run has measured it; `time-off-set` is a write, run last.

## Privacy

| Concern | 3.5a and 3.5b |
|---|---|
| Records | Hours a week, dates and hours away, and a three-word reason, one of which is health data. Nothing is inferred from activity. Allocation is computed on every read from items' estimates and dates and never stored. |
| Recorded time | Shrinks an item's remaining hours only for a viewer who already sees its total (`time.view`); a person's recorded week is never shown (decision 266). |
| Retention | The workspace's life; the person or a manager deletes any date; a removed member's rows go with the membership. |
| Logs | Never a person's capacity, time off, allocation or type; ids and counts. |
| Search, export, calendar sync | None. |
