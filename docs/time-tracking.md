# Time tracking

Sub-phase 3.4b: time entries and timers. The decisions are owner decisions 255 to 279 (`docs/HANDOFF.md`), recorded in [ADR 0012](adr/0012-time-tracking.md) and the porting map [`docs/porting/maps/3.4.md`](porting/maps/3.4.md), whose "Rules no decision names (3.4b, as built)" lists the choices the build made. Estimates (3.4a) are in [`docs/work-items.md`](work-items.md), "Estimates (3.4a)". Timesheets and their approval (3.4c), billable rates, Time totals and the export (3.4d) are not built yet.

The words are ADR 0006's: Time entry, Timer, Time spent, Billable; "Add time", "Start timer", "Stop timer", "Timer on". Never Log, Worklog, Logged time or Running.

## What a time entry is

A time entry (`TimeEntry`, `prisma/schema/time.prisma`, migration `20261221120000_time_entries`) is one person's own statement that they spent a number of minutes on one work item on one date.

- **Always one work item** (decision 260). The item must be live, in a live project the person can see, and the project must not be archived (409 `PROJECT_ARCHIVED`); closed items take time (decision 261).
- **The project stays.** `projectId` is the item's project when the entry is written. A move of the item does not move its entries (decision 261); picking another item for an entry records it in that item's project.
- **To the minute** (decision 264): 1 to 1,440 minutes, never rounded; a person's day holds at most 24 hours (409 `DAY_FULL`, with the minutes it still holds).
- **Billable** is a flag per entry, unticked unless the person ticks it. 3.4d adds each project's default (decision 271).
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
- **Who sees what** (decision 266). A `time.view` holder sees who recorded how much on items they can see, with descriptions. A caller with `time.track` and not `time.view` sees only their own entries and total on an item. Another member's whole week is read only with `time.approve` (refused past the route's key with an audited 403 `TIME_APPROVE_REQUIRED`). Money is never shown before 3.4d, and then only to `time.rates`.

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

Time is kept for the workspace's life (decision 277). An entry its person deletes is removed for good, and the audit trail keeps its date and minutes (`TIME_ENTRY_DELETED`). A purged item leaves its entries (the link clears its own column, `ON DELETE SET NULL ("workItemId")`), which then read "Deleted item". A deleted project that time was recorded in is held from the purge, items and all, while its entries remain, because an entry keeps its project and `projectId` is NOT NULL (`WorkItemRepository.purgeableProjectIds`); the owner may decide otherwise (see `docs/HANDOFF.md`).

The foreign key to `User` restricts: users are not deleted before roadmap 8.3, whose user deletion must handle time entries. There is no key to the membership, so removing a member keeps their time.

## Audit, privacy and logs

- Audited `TIME_ENTRY_CREATED`, `TIME_ENTRY_UPDATED` (the changed fields; a stopped timer names `minutes` and the minutes it counted) and `TIME_ENTRY_DELETED`, each with the item, project, date, minutes, billable flag and whether it was timed: numbers, dates and ids, never the description.
- An entry is a person's own statement, never inferred from activity: no screenshots, idle detection or location; the timer records only when it started and stopped.
- Logs carry ids and counts, never a description. Metric `time.entries.recorded` (`manual`, `timer`), no workspace or person attribute.

## The pages

- **The Time entry** in the sidebar (`NAV_PATHS.time`, `/time`) for a holder of `time.track` or `time.approve`, current on every page under `/time`. 3.4c adds Timesheets, 3.4d Time totals.
- **My time** (`/time?week=`): the person's week as a `role=grid` with a roving tabindex (arrow keys, Home and End; Enter or Space opens a cell), one row per item recorded that week, seven day cells and a total, the day totals beneath. An empty cell adds time on that item and day, a cell with one entry changes it, a cell with several lists them in a sheet. "Add time" picks an item through the work-item typeahead. It opens on the week of today in `NOTIFICATIONS_TZ` (the clock seam).
- **The item's Time panel** on the detail's Overview (page and sheet): "Time spent" (or "Your time") beside an hours team's estimate, "Add time", "Start timer" or "Timer on" with "Stop timer", the entries newest first with "Load more"; one's own entries changed or deleted through the undo toast. Every button follows the read's `viewer`.
- **The top chrome's timer**: "ISL-12 · 0:42" linking to the item, with "Stop timer", read again on window focus; counted on the server's clock. The palette offers "Go to My time", "Stop timer" while one is on, and "Start timer on ISL-12" while an item's Time panel offers one.
- The data module is `src/components/time/data/use-time.ts` (and `use-work-item-time.ts` in the work-item data folder): every read and write of time, a change sent with `If-Match`, a delete held behind the undo toast, every mounted time read revalidated after a write.

## Performance

`TimeEntry` is a guarded table of the plan checks (`tests/perf/plan-capture.ts`, `tests/guards/plan-checked-queries-coverage.test.ts`): a person's week on `TimeEntry_tenantId_userId_workDate_idx`, a day's total and the running timer on it and `TimeEntry_one_timer_per_person`, and an item's total and first page on `TimeEntry_tenantId_workItemId_workDate_idx`. The scale seed writes about 29,000 entries a workspace at 10k (`scripts/seed-scale/time.ts`). Statements per request: the week 5, an item's time 6, adding time 12. See [`docs/performance.md`](performance.md).
