# Analytics

Sub-phase 3.6a: the transition record's `fromStateCategory`, the measures and the Analytics page. The decisions are owner decisions 309 to 334 (`docs/HANDOFF.md`), recorded in [ADR 0014](adr/0014-analytics-and-forecasting.md) and the porting map [`docs/porting/maps/3.6.md`](porting/maps/3.6.md), whose "Rules no decision names (3.6a, as built)" lists the choices the build made. Time waiting (3.6b), forecasting and its calibration (3.6c) and dashboards (3.6d) are not built yet.

The words are ADR 0006's (decision 309): Analytics, Throughput, Cycle time, Lead time, Age, Cumulative flow, Burn-up, Dashboard, Widget; "Lead time" and "Cycle time" are always written whole. Never Velocity, Burn-down, Insights, Reports, Stats, Confidence, Projection, Card, Stage or Pipeline for these.

## The record is the source

Every measure reads `WorkItemTransition` (decision 310), never a stored series; nothing computed is stored, cached or audited. Each row is an item's picture right after an insert or a change of state, cycle, milestone, project, deletion, waiting on or estimates, written only by the SECURITY DEFINER trigger `work_item_transition_record`; `app_user` holds SELECT alone, and rows outlive the purge (decision 66).

- **`fromStateCategory`** (migration `20261226120000_transition_from_state_category`): the item's state category before the change, `OLD."stateCategory"` on an update and NULL on the insert row. The trigger writes it; the migration backfilled existing rows once with `LAG("stateCategory")` in the record's order (`at`, then `id`), an item's first row keeping NULL. The trigger's `UPDATE OF` list is unchanged.
- **A completion is one row**: `"stateCategory" = 'DONE' AND "fromStateCategory" IS DISTINCT FROM 'DONE'` (an insert straight into Done counts at creation). A reopen is a row from Done to another category; a deletion, a restore, a move or an estimate change of a Done item stays Done and is not a completion.
- **The partial index** `WorkItemTransition_completions` on `("tenantId", "projectId", "at")` with exactly that predicate serves throughput and durations. Prisma cannot declare it (the drift check does not see it); a query spells the predicate exactly. `tests/integration/analytics-record.test.ts` holds the column, the trigger body and the index.
- **The only module with SQL against the record** is `WorkItemTransitionRepository` (the cycle burn-up's two reads moved into it from `CycleRepository`).

## Definitions

The pure, client-safe module `src/app-layer/domain/analytics/` holds every rule; the SQL reads implement the same rules, each with a property test against the pure module on random histories (reopens, deletions and restores, cancels, moves, inserts into Done, a deleted project, ties at one instant) in five zones.

- **A picture at an instant** is the item's latest row at or before it, ties broken by the row's id (`record.ts`).
- **Completion** (decision 311; `completion.ts`). An item is completed as of a moment `R` when its picture at `R` is in Done and not deleted; it counts once, on the day of its last entry into Done at or before `R`. A reopened item counts at its later completion; a deletion retracts it from every past day and a restore returns it; a purged item (its last row its deletion) never counts; Cancelled is never completed. A read sees only rows at or before `R`, so a past week's throughput can change after a reopen or a deletion: history is shown as it stands.
- **Cycle time** (decision 312; `durations.ts`) runs from an item's first entry into Started (at or before its completion) to its completion; an item done without starting has none and is counted as "Done without starting". **Lead time** runs from its creation (its first row) to its completion. **Age** is an open item's time in Started now, from its first entry into Started to the moment of reading.
- **Elapsed working time** (decision 313; `elapsed.ts`): the time between two instants less every whole non-working day (a weekend day or a holiday of the item's own team's calendar, else the workspace's) lying inside the span, each removed at its own length (23 or 25 hours across an offset change), in days of 24 hours to one decimal. A day only partly inside the span is never removed, so the result is never negative. Friday 16:00 to Monday 10:00 on a Monday-to-Friday calendar is 18 hours, 0.8 days to one decimal. Working days come from the scheduling module (`isWorkingDay`); a `WorkingTimeMeter` keeps a running sum per calendar so thousands of durations cost one walk of the year.
- **Percentiles** are nearest rank everywhere (`percentiles.ts`): the value at index `ceil(p × n) − 1` of the sorted values, so every value shown happened.
- **Throughput** (`throughput.ts`): completions per day in the scope's zone, summed per ISO week (Monday to Sunday); the median is over whole weeks.
- **Cumulative flow** (`flow.ts`): at the end of each day (now for today) the items in scope by category: Backlog, Unstarted and Started at that instant, Done counted only for items that entered Done on or after the window's first day; Cancelled and deleted items out.
- **The burn-up for any scope**: scope (every in-scope item, Done included), started (Started or Done), completed (Done), in items, or in points or hours when every team in scope estimates in that unit (3.4a's `burnUpMeasuresFor`, intersected; ADR 0012: never mixed or converted), unestimated items counted and named.

The flow and the burn-up are one event sweep (`flowSweep`): each item's rows are walked once and every change of bucket or weight becomes a −1 and a +1 on its day; a running sum gives each day's end. 2.5a's cycle burn-up is re-expressed over it; its per-day scan is kept in `tests/unit/domain/analytics-flow.test.ts` as the oracle of a property test. **The instant of midnight belongs to the day it begins**, for throughput and flow alike; 2.5a's scan also counted a row at exactly that instant in the day it ended, and nothing else changed.

## What counts

| Case | Rule |
|---|---|
| Parents and sub-items | Each item counts once (decision 314), as progress counts. A type filter narrows to one level. |
| Moved to another project | Judged by the recorded project at each instant (decision 315): counted in the old project before the move and the new one after; a completion counts in the project it was completed in. |
| Archived projects | Their history counts; their open items are out of the figures about now (open, started, age) unless the list's "include archived" is set, as on the list. |
| Deleted projects | Never counted (their items are deleted with them). |
| Projects the caller cannot see | Never counted, now or in history: a row counts only while its recorded project is visible (before 8.4 every role but Guest sees every live project). |
| Items before 2.5a | Counted from their first recorded row; one with no Started row has no age. |

## Filters

The reads take the list's filters through `resolveListFiltersInTx`, never a second filter path (decision 315).

- **Set aside**: the state, category and due filters describe status, which each measure owns. A read ignores them and names those set in `setAside`; the page does not offer them.
- **Recorded fields** are judged on each row as recorded: project, team, cycle, milestone, and an initiative through its projects' current links (judged against each row's recorded project).
- **Every other filter judges current values**: type, labels, assignee, waiting on, priority, custom fields, goal, created by, reviewer, watching, `q`. The usecase resolves them to the items they select now, deleted ones included (a deletion is judged by the record), at most 50,000 (`ANALYTICS_FILTER_ITEM_LIMIT`; above, 422 `ANALYTICS_TOO_LARGE` with `what: 'filter'`), and the record is read for those items only. A purged item has no current values, so such a filter excludes it. "Label is Bug" counts the items labelled Bug now, at every past instant; the page says so.
- **No measure is grouped by assignee** (decision 330); an "assignee is" filter still narrows any chart.

## Days and zones

Day boundaries are the scope's working calendar's zone (decision 316), by the calendar view's rule: one team, project, cycle or milestone, that team's calendar; anything wider, the workspace's. A calendar's zone defaults to `NOTIFICATIONS_TZ`. "Today" is read in that zone through `todayClock`; a window ends no later than today, and the moment of reading is the earlier of now and the end of the window's last day. Durations use each item's own calendar. Dates are epoch days, never passed through a zone. **The cycle burn-up** (`GET /cycles/:id/burn-up`) cuts its days in its team's calendar zone too, so the cycle page and an Analytics burn-up of the same cycle agree.

## Reads, routes and keys

**The `analytics` permission domain** (decision 329): `view` (every analytics read over the items one can see; from 3.6c forecasts; from 3.6d one's own dashboards and shared ones), `share` (shared dashboards, 3.6d), `people` (time waiting per person beyond one's own row, 3.6b). Owners and Admins hold all three, Members `view` and `share`, Viewers `view`, a Guest nothing (decision 204). In 3.6a only `view` guards a route. A custom role stored before 3.6 takes its base role's analytics keys. Pages read `analyticsAffordances` (`analytics.policies.ts`) on the server.

| Route | Answer | Bounds |
|---|---|---|
| `GET /analytics/counts?<filters>&from&to` | Open and started items now; completed and created in the window (created: an item whose first row lies in the window, its recorded scope then, live now) | the window |
| `GET /analytics/throughput?<filters>&from&to&bin=week\|day` | The bins (`start`, `end`, `count`, `whole`), the total, the median whole bin | 50,000 completions |
| `GET /analytics/durations?<filters>&from&to&measure=cycle\|lead` | Cycle time and lead time percentiles over every completion, "Done without starting", the newest 2,000 completions as points (key, title, day, both durations), and for cycle time the oldest 2,000 open, started items' age with their total | 50,000 completions |
| `GET /analytics/flow?<filters>&from&to&burnUp=0\|1&measure=items\|points\|hours` | Cumulative flow per day (per ISO week's last day beyond 92 days), the items followed, and with `burnUp=1` the burn-up and the measures the scope offers (`MEASURE_UNAVAILABLE` otherwise) | 20,000 items (every item with a row in scope up to the window's end) |

Every route is `requirePermission('analytics.view')` with a rule in `route-permissions.ts`; none is under `/admin/`. A window is at most 366 days, inclusive, and never reversed (400 `ANALYTICS_RANGE`). Over a bound the answer is a 422 `ANALYTICS_TOO_LARGE` with `{ what, count, limit }`, never a cut answer. Every answer carries its frame: the window, today, the zone, the calendar's team and the filters set aside. Reads only, never audited; no description, comment or field value is read, and the points' keys and titles are read by id under row-level security.

## The Analytics page

The **Analytics** sidebar entry (Workspace section, `analytics.view`; Viewers too, never a guest) opens `/analytics`: the counts and five fixed charts over a scope set with the list's shared filter toolbar (the status filters not offered) and a window of the last 4, 8, 12, 26 or 52 weeks (12 by default, ending today in the workspace calendar's zone). Throughput as weekly bars and cumulative flow as stacked areas on the mirrored chart platform; cycle time as a scatter of the newest completions with the 50th, 85th and 95th percentile lines and open items' age on today's column, and lead time as a distribution in whole working days, both small visx components on the same tokens; the burn-up through the cycle page's `BurnUpChart` with its measure switch. Every chart has its table (the accessible fallback, always in the document), is its own read (`src/components/analytics/data/use-analytics.ts`), and says when it is over its bound, with the count, while the others draw. From 3.6d these charts are the dashboard's default composition.

## Privacy

3.6a shows no figure about a person: no measure is grouped by assignee (decision 330), and time waiting per person is 3.6b's, behind `analytics.people`. Nothing new about people is stored. Logs carry ids and counts only, never a scope's numbers or filter values.

## Performance

Live reads with stated bounds (decision 331); pre-aggregation is the fallback only if the nightly 100k run misses the flow budget. The plan checks, statements per request and latency scenarios are in [`docs/performance.md`](performance.md), "Analytics (3.6a)".

The scale seed writes a back-dated year into the record (`scripts/seed-scale/history.ts`): every item is created, may wait on a member for a while (about 20 %), joins its cycle, is started, goes to review (about half of the done ones), is reopened once (about 8 % of done items) and moves from another project (about 3 %), and ends on its current picture, which the verifier checks for every item, with each row's `fromStateCategory` its item's previous row's category. Closings follow a non-stationary year (growth across the year, a slow quarter, a holiday dip in late December), so a back-test (3.6c) is not calibrated by construction.
