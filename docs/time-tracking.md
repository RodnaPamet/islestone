# Time tracking

Sub-phases 3.4b, 3.4c and 3.4d: time entries and timers, then timesheets and their weekly approval, then billable rates, Time totals and the export. The decisions are owner decisions 255 to 279, 281 and 304 to 306 (`docs/HANDOFF.md`), recorded in [ADR 0012](adr/0012-time-tracking.md) and the porting map [`docs/porting/maps/3.4.md`](porting/maps/3.4.md), whose "Rules no decision names (3.4b, as built)", "(3.4c, as built)" and "(3.4d, as built)" list the choices the builds made. Estimates (3.4a) are in [`docs/work-items.md`](work-items.md), "Estimates (3.4a)".

The words are ADR 0006's: Time entry, Timer, Time spent, Billable, Billable rate ("Rate", "Hourly rate", "No rate"), Timesheet, Time tracking settings, Time totals; "Add time", "Start timer", "Stop timer", "Timer on"; Submit, Approve, Return (decision 256), and "Take back" and "Reopen" for the person's and an approver's undoing. Never Log, Worklog, Logged time, Running, Draft, Approver, Report, Price, Fee or Billing rate.

## What a time entry is

A time entry (`TimeEntry`, `prisma/schema/time.prisma`, migration `20261221120000_time_entries`) is one person's own statement that they spent a number of minutes on one work item on one date.

- **Always one work item** (decision 260). The item must be live, in a live project the person can see, and the project must not be archived (409 `PROJECT_ARCHIVED`); closed items take time (decision 261).
- **The project stays.** `projectId` is the item's project when the entry is written. A move of the item does not move its entries (decision 261); picking another item for an entry records it in that item's project.
- **To the minute** (decision 264): 1 to 1,440 minutes, never rounded; a person's day holds at most 24 hours (409 `DAY_FULL`, with the minutes it still holds).
- **Billable** is a flag per entry. A new entry and a timer take the project's default (`Project.timeBillableByDefault`, off unless set; decision 271) unless the person says otherwise, and the person changes it while the week is open.
- **A description** is optional, at most 2,000 characters, sanitised (`sanitizePlainText`) and encrypted under the workspace's key (`ENCRYPTED_FIELDS`). It is never audited, logged or search-indexed (ADR 0008 is unchanged).
- **Not a work item and not an activity.** Time is not in the list, the board, search or the item's Activity; the item's Time panel shows it. No automation event and no watcher notice.

## The timer

A timer is the person's one entry whose `minutes` is NULL (decision 262): the partial unique index `TimeEntry_one_timer_per_person` holds one per person per workspace, kept on the server so every tab and device shows it.

- **Start** (`POST /time-entries/timer { workItemId, timeZone }`): in one transaction, the timer that was on is stopped and recorded, then a new one starts. It counts on today's date in the browser's IANA zone (decision 263; 400 `TIME_ZONE_UNKNOWN` for a name the server does not know). Two starts on two devices queue on the person's timer lock; the index answers any race with 409 `TIMER_ON`.
- **Stop** (`POST /time-entries/timer/stop { minutes? }`): the whole minutes since it started, rounded to the nearest, at least one and at most 720 (12 hours), or fewer when the person states them (more is 400 `TIMER_MINUTES`). A timer stopped under 30 seconds is discarded and audited as such. With no timer on, 409 `TIMER_OFF`.
- **No job stops a timer** (decision 263): one left on stops counting at 12 hours, and the top chrome says "Stopped counting at 12 hours".
- A running timer is not an entry to change (409 `TIMER_ON`); deleting it discards it.
- Member removal (`removeTenantMember`, in its transaction) stops and records the member's timer, within what its day still holds.

## Who may do what

The `time` permission domain (decision 265): `time.view`, `time.track`, `time.approve`, `time.rates`.

| Role | view | track | approve | rates |
|---|---|---|---|---|
| Owner, Admin | yes | yes | yes | yes |
| Member | yes | yes | | |
| Viewer | yes | | | |
| Guest | | | | |

The granular key decides (`src/app-layer/policies/time.policies.ts`): a custom role may grant any of them, and nothing rides on `work_items.edit`, so a member whose role cannot edit items still records time. A custom role stored before 3.4 takes its base role's `time` keys.

- **Only a signed-in person records, changes or deletes time, and only their own** (decisions 267 and 278). An API key, an agent, a job and the workspace system user are refused with a hash-chained `AUTHZ_DENIED` entry and a 403 `NOT_A_PERSON`; another person's entry is a 404. The CHECK `TimeEntry_own_time` holds the author equal to the person.
- **Who sees what** (decision 266). A `time.view` holder sees who recorded how much on items they can see, with descriptions. A caller with `time.track` and not `time.view` sees only their own entries and total on an item. Another member's whole week is read only with `time.approve` (refused past the route's key with an audited 403 `TIME_APPROVE_REQUIRED`). Money (rates and amounts) is shown only to `time.rates` (decision 274): a Member sees hours and billable flags, never money, their own included.

## Routes

| Route | Key | What |
|---|---|---|
| `GET /time-entries?week=YYYY-MM-DD[&userId=]` | `time.track` (another member's week also `time.approve`) | The Monday-to-Sunday week holding the date: entries with their items (a deleted one reads "Deleted item", one out of sight "Item you cannot see"), day totals, the week's total, `viewer.edit`. At most 1,000 entries (422 `TIME_WEEK_TOO_LARGE`). |
| `POST /time-entries` | `time.track` | Add time by hand. |
| `PATCH /time-entries/:id` | `time.track` | Change one's own finished entry; `If-Match` optional (409 `VERSION_CONFLICT` with the current entry). |
| `DELETE /time-entries/:id` | `time.track` | Delete one's own entry for good, or discard a running timer. |
| `GET`/`POST /time-entries/timer` | `time.track` | The running timer (with `serverNow` and `stoppedCounting`), or start one. |
| `POST /time-entries/timer/stop` | `time.track` | Stop the timer. |
| `GET /work-items/:id/time?cursor=` | `work_items.view`, then `time.view` or `time.track` in the usecase | The item's total (everyone's; NULL without `time.view`), the caller's own, its finished entries newest first, 50 a page, and `viewer` (`track`, `viewAll`). |

The usecases are `src/app-layer/usecases/time-entry.ts`, the only writer of `TimeEntry` (`tests/guards/time-entry-write-seam.test.ts`: only `TimeEntryRepository` reaches the table, only the writing usecases call its writes, every exported write asks for a person, no job imports them). Every write takes the person's week lock (`timesheet:<workspace>:<person>:<Monday>`, both weeks in date order when an entry moves between them) before it reads a total; 3.4c's submit and approval take the same key.

## Deletes and keeping time

Time is kept for the workspace's life (decision 277). An entry its person deletes is removed for good, and the audit trail keeps its date and minutes (`TIME_ENTRY_DELETED`). A purged item leaves its entries (the link clears its own column, `ON DELETE SET NULL ("workItemId")`), which then read "Deleted item". A deleted project that time was recorded in leaves a tombstone when it is purged (issue #117, owner decision 281; `docs/work-items.md`, "The purge"): its items and everything it holds go, and a minimal row with its key, name and deletion stays, marked `purgedAt`, so its entries keep their project, the week's and the totals' sums stay what they were, its billable rates stay (3.4d: an entry's amount does not move because its project was purged), and the key is never reused. Its team is cleared (issue #120, owner decision 305), so the team can be deleted; Time totals and the export name the tombstone's project by its key and name with no team. Only time reads a tombstone.

The foreign key to `User` restricts: users are not deleted before roadmap 8.3, whose user deletion must handle time entries. There is no key to the membership, so removing a member keeps their time.

## Timesheets (3.4c)

A timesheet (`Timesheet`, migration `20261222120500_timesheets`) is one person's week, Monday to Sunday by each entry's date (decision 268), once they submit it: no row is a week not submitted. Its statuses are `SUBMITTED`, `APPROVED`, `RETURNED` (with an explanation) and `WITHDRAWN` (taken back).

- **Off by default** (decision 268). An Owner or Admin (`admin.manage`) turns on "Timesheets need approval" in Settings → Time tracking (`TenantTimeSettings`, no row the defaults). Turning it off leaves submitted weeks to be decided and taken back; no week is submitted while it is off (409 `APPROVAL_OFF`).
- **Submit** (`time.track`, a person). One's own week, once it has begun (today in `NOTIFICATIONS_TZ`; 400 `WEEK_IN_FUTURE`), while no timer counts on one of its days (409 `TIMER_ON_IN_WEEK`), from no row, `RETURNED` or `WITHDRAWN` (409 `TIMESHEET_SUBMITTED` / `TIMESHEET_APPROVED` otherwise). An empty week is allowed; My time asks first. **Take back** a submitted week until it is decided (`WITHDRAWN`).
- **Approve, Return, Reopen** (`time.approve`, a person, decision 269): anyone holding it decides a member's whole week, never their own (an audited 403 `OWN_TIMESHEET`; the CHECK `Timesheet_not_own_decision` holds it). Return asks for an explanation (1 to 2,000 characters, sanitised, encrypted, `returnExplanation`); Reopen moves an approved week back to `RETURNED` with an explanation (decision 270). Resubmitting clears the explanation (owner decision 306): the audit trail records that the week was returned, never why.
- **The freeze** (decision 270). The trigger `time_entry_week_frozen` refuses every insert, change or delete of a time entry in a `SUBMITTED` or `APPROVED` week, for every writer, answered 409 `TIMESHEET_FROZEN`. It admits the key rotations' re-wrap of the description, the purge's clearing of the item link, the workspace's own deletion, and (3.4d) the approval's stamp of the frozen rates and a reopening's clear, every other column unchanged. A week returned or taken back is open again.
- **Locks.** Every act takes the week's advisory lock (`timeWeekLockKey`, the key the entry writes take), then the row `FOR UPDATE`, and claims it with one conditional update naming its starting status and version (`If-Match` optional; 409 `VERSION_CONFLICT`).
- **Notifications** (decision 276): `TIMESHEET_SUBMITTED` to whoever approves (the settings' workspace recipient list resolved now, its members who hold `time.approve`; with none, every ACTIVE holder of `time.approve`, at most 50, the most senior first; never the person), `TIMESHEET_RETURNED` to the person with an immediate email (also for a reopening, titled "Timesheet reopened"), `TIMESHEET_APPROVED` to the person, and the Monday reminder `TIMESHEET_REMINDER` (the `timesheet-reminder` job, Mondays 09:20 in `NOTIFICATIONS_TZ`, while approval is on, to every ACTIVE member holding `time.track` who recorded time last week and has not submitted it). There is no reminder to approvers beyond these (owner decision 304): they see the waiting weeks on the Timesheets page and get a bell on each submit. Each under the person's preferences; none ever carries the explanation's text.
- **Pages.** My time's status line (Submit or Take back, the explanation of a returned week, a frozen week's cells read-only); the Timesheets page (`/time/timesheets`, for `time.approve`): the weeks waiting for a decision, oldest first, and those decided in the last 12 weeks, a week opening read-only in a sheet with Approve, Return or Reopen; Settings → Time tracking.

| Route | Key | What |
|---|---|---|
| `GET`/`PUT /time-settings` | `time.view` / `admin.manage` | "Timesheets need approval", the recipient list (a live workspace list, 400 `RECIPIENT_LIST_UNKNOWN`) and (3.4d) the currency (also `time.rates`). |
| `POST /timesheets { week }` | `time.track` | Submit one's own week. |
| `GET /timesheets?status=SUBMITTED\|DECIDED&cursor=` | `time.approve` | 50 weeks a page with their sums (minutes, billable, entries) and who decided. |
| `GET /timesheets/week?week=[&userId=]` | `time.track` (another member's also `time.approve`) | A week's status line: the switch, the row, the sums, `timerOn`, `viewer` (`submit`, `withdraw`, `edit`). |
| `GET /timesheets/:id` | `time.approve` | A member's week with its entries, read-only, and `viewer` (`approve`, `return`, `reopen`). |
| `POST /timesheets/:id/withdraw` | `time.track` | Take one's own submitted week back; another person's is a 404. |
| `POST /timesheets/:id/approve`, `/return { explanation }`, `/reopen { explanation }` | `time.approve` | Decide a member's week. |

The usecases are `src/app-layer/usecases/timesheet.ts` (the only writer of `Timesheet` and `TenantTimeSettings`) and `timesheet-reminder.ts`; the client's are `src/components/time/data/use-timesheets.ts` (every act on a week sends its version).

## Rates, totals and export (3.4d)

Owner decisions 271 to 275; ADR 0012 §6 and §7.

### Rates

- **The cascade** (decision 272): an entry's rate is the one in force on its date at the project level for its project, else at the member level for its person, else at the workspace level. A row whose rate is NULL means "no rate at this level from this date" and falls through to the next level. No rate anywhere is "No rate": the entry has no amount. One pure function, `resolveRate` (`src/app-layer/domain/billable-rate.ts`, property-tested against a day-by-day reference), and every reader calls it.
- **History** (decision 273): `BillableRate` (`prisma/schema/time.prisma`, migration `20261224120100_billable_rates`) holds a level, its scope (a project or a person, by CHECK), an hourly rate in whole minor units (0 to 2,000,000,000, CHECK) or NULL, and the date it applies from; one row per level, scope and date (a unique index `NULLS NOT DISTINCT`). Setting a rate for a date replaces that date's row. A row is removed only while its date has not come (409 `RATE_IN_FORCE` once it has: a later row changes a past rate). A member's rate needs an ACTIVE member; its rows outlive the membership.
- **One currency** (decision 273): `TenantTimeSettings.currency`, an ISO 4217 code (CHECK `^[A-Z]{3}$`, and one `Intl` knows, 400 `CURRENCY_UNKNOWN`), required before the first rate (409 `CURRENCY_REQUIRED`) and not changed while any rate exists (409 `CURRENCY_IN_USE`). It is set through `PUT /time-settings` by whoever manages the workspace and also holds `time.rates` (403 `TIME_RATES_REQUIRED` otherwise). Every rate write takes the settings row's lock, as the currency's change does. Amounts are formatted with `Intl.NumberFormat` in the currency's own minor digits (`src/lib/time/money.ts`): JPY shows none.
- **Amounts** (decision 273): a billable entry's amount is `round_half_up(minutes × hourly rate / 60)` in minor units, rounded per entry, so a total is the sum of its lines; a non-billable entry has none. Computed on read, never stored.
- **Frozen at approval** (decision 273): approving a week stamps each billable finished entry with the rate the cascade resolves on its date (`TimeEntry.frozenRateMinor` and `frozenRateLevel`, both or neither, only on a billable entry, by CHECK); a billable entry with no rate stays unstamped and reads "No rate" while the week stays approved. A reopening clears the stamps, and the week is priced from the history again. The freeze trigger admits the stamp and the clear alone, every other column unchanged. An entry's rate is therefore its stamp in an approved week (or none) and the history otherwise (`entryRate`).
- **Rates are plaintext integers**, protected by the `time.rates` key, not by encryption: totals and exports read them on the server.
- **A project's default** (decision 271): `PUT /projects/:id/billable-default { billableByDefault }` under `time.rates`, versioned (`If-Match` optional), audited `PROJECT_UPDATED` naming `timeBillableByDefault`. Entries already recorded keep their own flag.

### Time totals

`GET /time-totals?from&to&groupBy=project|person|item|week[&projectId][&userId][&billable]` (`time.view`; `getTimeTotals` in `src/app-layer/usecases/time-totals.ts`): finished entries dated in a window of at most 366 days (400 `TIME_RANGE`), grouped in one aggregate over `TimeEntry` (minutes, billable minutes, entries), at most 2,000 groups read one past and refused 422 `TIME_TOTALS_TOO_LARGE` with the count, never cut. Every project the caller's role sees counts: for a role that sees the workspace, deleted projects and tombstones too (their time stays theirs), each group naming the project by key and name, deleted ones marked. A deleted item's time is one "Deleted item" group. For a rates holder the read adds the currency, the rate book, the approved weeks of the window and the billable lines alike entries collapsed into (`amountLines`), priced per entry by `timeAmounts`; a group's billable minutes with no rate are counted apart (`noRateMinutes`). Not audited.

### The export

`GET /time-totals/export?format=csv|xlsx&from&to[&projectId][&userId][&billable]` (`time.view`; `exportTimeEntries`; decision 275, the owner's choice C): the finished entries behind the same filter, by date, person and id, at most 50,000 (422 `TIME_EXPORT_TOO_LARGE`, never cut), as `text/csv` (UTF-8 with a byte-order mark, RFC 4180 quoting, CRLF lines) or an Excel workbook of one sheet, "Time entries". The columns are date, person, project key, item key, title, hours (two decimals), minutes, billable, then for a rates holder the rate and the amount in the currency's digits, then the description, shown only for the caller's own entries or with `time.approve`. One pure table (`timeExportTable`, `src/lib/time/export.ts`) feeds two writers (`toCsv`, and `toXlsx` in `export-xlsx.ts`, server only, on `write-excel-file` 4.1.1 with `fflate`, both MIT). Every text cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with `'` in both formats; numbers and dates are typed cells; the workbook writes no formula. Audited `TIME_EXPORTED` (`data_lifecycle`, `exported`; the format, the filter and the row count, never content). The route is charged to the mutation tier's budget as well as the read tier's (`rateLimit.everyMethod`), since it decrypts.

### Routes (3.4d)

| Route | Key | What |
|---|---|---|
| `GET /billable-rates` | `time.rates` | Every rate of the workspace (at most 10,000; 422 `BILLABLE_RATES_TOO_MANY`), the currency and today, each row saying whether it may be removed. |
| `PUT /billable-rates/workspace` | `time.rates` | The workspace's rate from a date `{ effectiveFrom, hourlyRateMinor }`. |
| `PUT /projects/:id/billable-rates` | `time.rates` | A live project's rate from a date (archived ones included). |
| `PUT /members/:userId/billable-rates` | `time.rates` | An ACTIVE member's rate from a date. |
| `DELETE /billable-rates/:id` | `time.rates` | Remove a rate whose date has not come. |
| `PUT /projects/:id/billable-default` | `time.rates` | Whether new entries on the project are billable. |
| `GET /time-totals` | `time.view` | Time totals, amounts for `time.rates`. |
| `GET /time-totals/export` | `time.view` | The CSV or Excel export. |

Audited `BILLABLE_RATE_SET` (created or updated; the level, scope, date, rate, the rate it replaced and the currency) and `BILLABLE_RATE_REMOVED`. The usecases are `src/app-layer/usecases/billable-rate.ts` (the only writer of `BillableRate` and of a project's billable default; the purge writes a tombstone's rates back) and `time-totals.ts`; the client's are `src/components/time/data/use-time-totals.ts` (a future rate's removal through the undo toast).

## Audit, privacy and logs

- Audited `TIME_ENTRY_CREATED`, `TIME_ENTRY_UPDATED` (the changed fields; a stopped timer names `minutes` and the minutes it counted) and `TIME_ENTRY_DELETED`, each with the item, project, date, minutes, billable flag and whether it was timed: numbers, dates and ids, never the description. Timesheets: `TIMESHEET_SUBMITTED`, `_WITHDRAWN`, `_APPROVED` (with how many rates it froze), `_RETURNED`, `_REOPENED` (with how many it cleared) (a status change, with the person, the week, its minutes, billable minutes and entries, never the explanation) and `TIME_SETTINGS_SET` (the changed fields, the currency among them). Rates and money (3.4d): `BILLABLE_RATE_SET`, `BILLABLE_RATE_REMOVED`, `PROJECT_UPDATED` (`timeBillableByDefault`) and `TIME_EXPORTED` (format, filter, rows).
- An entry is a person's own statement, never inferred from activity: no screenshots, idle detection or location; the timer records only when it started and stopped.
- Logs carry ids and counts, never a description, an explanation or an amount. Metrics `time.entries.recorded` (`manual`, `timer`) and `time.timesheets.decided` (`approved`, `returned`, `reopened`), no workspace or person attribute.

## The pages

- **The Time entry** in the sidebar for a holder of `time.track`, `time.approve` or `time.view`, current on every page under `/time`: it opens My time (`NAV_PATHS.time`, `/time`) for whoever records or approves time, else Time totals (`timeLandingOf`); the tabs are My time, Timesheets (`time.approve`) and Time totals (`time.view`), shown when there are two or more. A `time.view` holder alone opening `/time` is sent to Time totals.
- **Time totals** (`/time/totals`, `TimeTotalsView`, `timeTotalsPageContext`): the window (this month to today by default), a project, a person and billable as filters, "Add up by" Project, Person, Item or Week, the shared `DataTable` with time spent, billable time, entries and (a rates holder) the amount with its "No rate" part, the total line, and "Export CSV" and "Export Excel" (a download through `apiGetFile`; a refusal is a toast).
- **Rates** for a rates holder: Settings → Time tracking's Rates section (the currency, fixed once rates exist; the workspace rate's history; members' rates, `RateHistory`), and a project's billable default and rates (`ProjectTimeDialog`) from Settings → Projects' "Time" and the project page's "Time". A new entry's billable box starts at its project's default where the page knows it; an item just picked leaves it to the server ("Left as it is, the project's default applies").
- **My time** (`/time?week=`): the person's week as a `role=grid` with a roving tabindex (arrow keys, Home and End; Enter or Space opens a cell), one row per item recorded that week, seven day cells and a total, the day totals beneath. An empty cell adds time on that item and day, a cell with one entry changes it, a cell with several lists them in a sheet. "Add time" picks an item through the work-item typeahead. It opens on the week of today in `NOTIFICATIONS_TZ` (the clock seam).
- **The item's Time panel** on the detail's Overview (page and sheet): "Time spent" (or "Your time") beside an hours team's estimate, "Add time", "Start timer" or "Timer on" with "Stop timer", the entries newest first with "Load more"; one's own entries changed or deleted through the undo toast. Every button follows the read's `viewer`.
- **The top chrome's timer**: "ISL-12 · 0:42" linking to the item, with "Stop timer", read again on window focus; counted on the server's clock. The palette offers "Go to My time", "Stop timer" while one is on, and "Start timer on ISL-12" while an item's Time panel offers one.
- The data module is `src/components/time/data/use-time.ts` (and `use-work-item-time.ts` in the work-item data folder): every read and write of time, a change sent with `If-Match`, a delete held behind the undo toast, every mounted time read revalidated after a write.

## Performance

`TimeEntry` is a guarded table of the plan checks (`tests/perf/plan-capture.ts`, `tests/guards/plan-checked-queries-coverage.test.ts`): a person's week on `TimeEntry_tenantId_userId_workDate_idx`, a day's total and the running timer on it and `TimeEntry_one_timer_per_person`, and an item's total and first page on `TimeEntry_tenantId_workItemId_workDate_idx`. The scale seed writes about 29,000 entries a workspace at 10k (`scripts/seed-scale/time.ts`). Statements per request: the week 5, an item's time 6, adding time 12 (unchanged by 3.4c: an entry write reads no timesheet, the trigger refuses a frozen week). 3.4c adds three plan checks on the person's index (10k measured: a week's sums 119 buffers, a page of 50 weeks' sums 2,973, a lateral read per week, and the reminder's members who recorded time 162, a probe per member) and statements per request (a week's status 4, the waiting weeks 4, a submit 24, an approval 23; an approval of a week with billable time also reads the week's entries and rates and writes the stamps). 3.4d adds three plan checks (Time totals over a quarter by person and by project, the quarter's priced lines, the export's month), statements per request for the totals and the export, the seed's rates at the three levels and approved weeks with their rates stamped, and the latency scenarios `time-week`, `time-item`, `time-totals` and `time-add`. See [`docs/performance.md`](performance.md).
