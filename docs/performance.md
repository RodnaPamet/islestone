# Performance

Hardening H2's performance half (`docs/porting/maps/H2.md` part 1; owner decisions 166 to 172). H2a is the seed and the deterministic checks that block every pull request; H2b is the latency budgets, the harness, the 100k buffer budgets and the nightly 100k run.

| Part | What | Blocks | Where |
|---|---|---|---|
| The seed (1.1) | Two workspaces of 10,000 or 100,000 items, verified, cached as a dump | (it is the input) | `scripts/seed-scale/` |
| Plan checks (1.2) | Every named query's plan on the seeded database: no sequential scan on a guarded table, its indexes used, a buffer budget | every pull request at 10k; the nightly run at 100k (the 100k budgets, H2b) | `tests/perf/plans.test.ts`, `tests/perf/plan-checked-queries.ts` |
| Statements per request (1.3) | How many statements each scenario's request runs, and that a list's count does not grow with its page size | every pull request at 10k; the nightly run at 100k | `tests/perf/statements.test.ts` |
| Latency (1.4 to 1.6) | Response times of the built app on the reference machine against the budgets of decision 167; a concurrent pass; browser timings | a run that measured nothing: every pull request; the budgets: the nightly 100k run | `scripts/perf/run.mjs`, `scripts/perf/budgets.json`, `.github/workflows/perf.yml` |

## The seed

`npx tsx scripts/seed-scale/index.ts --shape 10k` (`npm run seed:scale -- --shape 10k`) seeds `perf-10k` and its sibling `perf-10k-sibling` into a migrated database. It needs the app's database environment: `DATABASE_URL` (the application's connection; through PgBouncer in CI, as production) and `DIRECT_DATABASE_URL` (the superuser, directly), plus what `src/env.ts` validates (`AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`). A workspace already complete is kept; a partial one refuses (seed into an empty database). `--verify-only` checks a restored dump. Exit 0 verified, 1 a failure, 2 a usage error.

### The shapes (decision 170)

| Shape | Per workspace | Projects | Teams | Members |
|---|---|---|---|---|
| `10k` | 10,000 items | 10 × 1,000 | 1 | 40 |
| `100k` | 100,000 items | one of 20,000 and nineteen sharing 80,000 (4,210 or 4,211) | 5 | 200 |
| `mini` | 500 items | 300 and 200 | 1 | 6 |

The map's "19 × 4,200" sums to 99,800; the decision's totals (100,000, one project of 20,000) win. `mini` is not measured: the integration suite seeds it (`tests/integration/seed-scale.test.ts`) so the seeder runs on every pull request even when the Performance job restores a cached dump.

Each workspace has the ratios of the map's part 1.1 (`RATIOS` in `scripts/seed-scale/shapes.ts`): about 3 comments, 1.5 labels and 0.3 BLOCKS edges per item (always from an earlier item to a later one of the same project, so the graph is acyclic), five custom fields per project (stage, points, target date, reviewer, customer) filled for 60 % of items, three milestones per project, a working calendar for the workspace and one for the first team with holidays, 26 fortnightly cycles per team (thirteen ended and completed, thirteen from the current one on), 20 % sub-items nested at most five levels, 70 % with a description, 80 % assigned (Zipf over the members, so the heaviest member holds about a fifth of the items and My Work has heavy and light users), 10 % of open items waiting on somebody, 60 % with a due date spread over ±180 days around the run day, half with a watcher, about 1 % soft-deleted (a sub-item of a deleted item with it, under one deletion id), and the state mix of a real backlog (45 % Done, 10 % Cancelled, 25 % Backlog, 12 % Todo, 8 % started). Text is Bulgarian, English or both, drawn from the committed word list (`words.ts`), so both halves of `islestone_bg_en` are exercised.

Every draw comes from a stream named by the seed string (`--seed`, default `islestone-h2`) and a purpose (`random.ts`: sfc32 seeded through cyrb128), so the same seed and shape give the same workspaces, row for row, apart from what the application itself generates (the sample's ids, data keys, IVs) and the dates, which are relative to the run day.

### How it writes (decision 171)

- **Through the application's code:** the bootstrap registration performs (the workspace with its wrapped data key, the owner, their membership), member accounts as registration makes them, then everything a member would do: invitations and their redemption, teams with their workflows, working calendars and holidays, labels, projects, custom fields and options, milestones, the cycles from the current one on, and **1 % of each project's items** (`createWorkItem` as their planned creators, with labels, fields, cycle, milestone, waiting on; `addComment`; `addWorkItemRelation`; and for 40 % of the sample's open items one review step with two reviewers, sent). So the sample carries real audit entries, vectors written by the seam, transitions, watchers, notifications and review rounds.
- **In bulk for the rest,** as the superuser, in batches of 5,000 multi-row inserts, each batch one transaction (`bulk.ts`): the batch's numbers claimed from `ProjectKeySequence` first (`lastValue + n … RETURNING`), `sortKey` from `fractional-index.ts`, descriptions and comment bodies sanitised as the usecases sanitise them and encrypted with the workspace's data key by `encryptWithKey` (the `v2:` envelope the field-encryption middleware writes; a plaintext row would make every read fail closed), and `SearchVector` rows computed by PostgreSQL through the seam's bulk path, `SearchVectorRepository.insertBulkForSeed` (the same `searchableText` and the same configuration as `replaceForSource`; `tests/guards/search-vector-write-seam.test.ts` holds the seeder its only caller and forbids any other write to the table from `scripts/`). Transitions and `priorityRank` are written by their triggers. The ended cycles are inserted completed, since the usecase makes only cycles that end today or later. Nothing updates an existing item, so decision 173's lock order has nothing to order.

### Verification

Every run ends with `verify.ts`, on a fresh seed and on a restored dump alike: row counts against the shape, every project's sequence equal to its highest number and its item count, exactly one search vector per description and live comment, a transition per item, every description and body in the `v2:` envelope; `verifyAuditChain` valid and non-empty for both workspaces; 100 random descriptions per workspace read through the application's decrypting client in the workspace's context and each found by the real content search (`matchItems`) on a phrase of its own first sentence, which proves ciphertext, key and vector agree; and a two-tenant read through `runInTenantContext` (in one workspace's context the other's rows read as nothing and its own in full).

### The cached dump

`scripts/seed-scale/cache.sh save|restore <database> <file>` runs `pg_dump --format=custom` and `pg_restore --jobs=4` inside the container `scripts/ci-postgres.sh` started (the runner's own client tools are older than the image's PostgreSQL 17), then `ANALYZE`. CI caches the dump under `hashFiles('prisma/migrations/**', 'scripts/seed-scale/**', 'deploy/postgres/**')`; a change to any of those reseeds. A change to a usecase the seeder calls does not invalidate the cache; the integration suite's `mini` seed covers it.

Measured on the development machine (4 CPUs, 16 GB, Docker), with PgBouncer in front as CI runs it: the 10k shape seeds and verifies in about 2 minutes (112 s) into a 261 MB database; its dump is 38 MB, and a restore with its verification takes 11 s. The 100k shape seeds and verifies in about 16 minutes (978 s) into a 2.4 GB database: too slow and too large for every pull request, which is why the nightly (H2b) caches it.

### What the seed leaves out

- **The audit trail is sampled.** Bulk rows have no audit entries, so `AuditLog` holds about 2,400 rows per 10k workspace, far fewer than a real one; Activity is measured on the sample's items (map part 1.5).
- **Reviews are only in the sample** (about twenty open steps per 10k workspace), so the reviewer tables are small and "To review" reads them whole; the plan check says so (`noIndexBecause`). A later shape adds review volume in bulk.
- **No intake requests, notifications at volume, templates, recurrences or saved views.** None is on a list path the gate names.
- **Dates move with the run day**, and a cached dump keeps the day it was built; a month-old cache is still realistic (due dates spread ±180 days).

## Plan checks

`npm run test:perf` (the Jest project `perf`, never run by `npm test`) against the seeded database. `tests/setup/perf-env.ts` refuses to run without `DATABASE_URL` and `DIRECT_DATABASE_URL`: a perf job that measured nothing must not pass.

**How a plan is captured.** `plans.test.ts` imports `plan-env.ts` first: the application's client connects DIRECTLY to Postgres with `auto_explain` loaded for the session through libpq startup options (`session_preload_libraries`, `log_min_duration=0`, `log_analyze`, `log_buffers`, `log_format=json`, `log_level=notice`; PgBouncer would refuse the options), and every pg client records the NOTICE each statement's plan arrives in. Each named query runs its real repository methods with realistic arguments, as the heavy member, inside `runInTenantContext`: as `app_user`, with row-level security on, exactly as a request runs them. Nothing is re-planned from copied SQL. `auto_explain.log_nested_statements` is on too, so a search function's own statement (owner decision 245; `docs/search.md`, "The search functions") is captured: its index and the operator in its condition are checked like any statement's, and its buffers are counted once, in the function scan of the statement that called it (a nested plan carries the `islestone:search-definer` marker in its query text; `isNestedSearchPlan`).

**Deterministic plans.** Before it checks anything the suite runs `VACUUM` (so index-only scans fetch no heap pages at random) and `ANALYZE` with `default_statistics_target = 1000`, which samples every row at 10k: with the default target the sample is 30,000 random rows and a query could take another plan, and another buffer count, on the next run (H2a saw the content search swing between 14,000 and 23,000 buffers before this). Three runs on one seed, and runs on two fresh seeds, then measured the same within a few buffers.

**What each query must hold** (`judgePlans`, `conditionMisses` in `plan-capture.ts`, unit-tested in `tests/unit/perf/plan-capture.test.ts`):

- no `Seq Scan` on `WorkItem`, `Comment`, `SearchVector`, `WorkItemTransition` or `AuditLog`;
- every index it names used by at least one of its statements (`a|b` for either), or a stated reason it needs none (`noIndexBecause`: the working-calendar tables hold a few rows at any size);
- for a search index, the operator in the index condition (`conditions`): a GIN index read on its leading `tenantId` alone returns every row of the workspace, so "the index was used" proves nothing;
- the shared buffers (hit plus read) of all its statements within its budget, about twice what H2a measured at 10k (closer where the data fixes the count: a lock takes every row it names; for the search reads and the rebuild, about twice what the fixes of F1 and F2 measured). At another shape the buffers are reported, not judged; the 100k budgets arrive with H2b.

**The registry.** `PLAN_CHECKED_QUERIES` (`tests/perf/plan-checked-queries.ts`) names 54 queries: the list in every sort the API offers, its second page, the workspace-wide list in manual order and by due date with two filters, the label and custom-field filters, the custom-field sort, the list's `q`, the Deleted view, a board column of the largest project, My Work's six sections, the detail and what the sheet loads (comments, sub-items, subtree), the metrics and the cycle, milestone and state counts, the search usecase's raw reads, the timeline's scope and context rows (3.1b) and the working calendars it reads (3.1a), the goal and initiative filters and the ancestry (3.2a), the two progress counts (3.2b: the project path on the partial `WorkItem_progress_project_path`, the direct goal path), the roadmap's aggregate (3.2c), the calendar's window and undated count for the workspace and a project (3.3a), a member's calendar sync push set (3.3b: their open assigned items in the window, the count and their projects), the placement reads, a member's removal, deletion groups, the cycle and milestone deletes and the rollover, the templates' open items, and the jobs (due reminders, the digest, the purge, the goal purge's unlinked items (3.2a), a purged project, the rebalance, the search-index rebuild). `tests/guards/plan-checked-queries-coverage.test.ts` holds it to the code: every repository method that reads `WorkItem`, `Comment` or `SearchVector` is named by a query or exempt with a reason in `PLAN_CHECK_EXEMPT` (reads by primary key or a unique key), with no stale entries either way. **A new list query joins `PLAN_CHECKED_QUERIES`**, with a runner in `plans.test.ts`.

**Known findings.** A query whose finding is reported and not yet fixed carries `knownFinding` (below): the one check it fails runs as `it.failing`, so the suite stays green while the defect stands and turns red the day it is fixed, until the marker is removed and the check holds for good. None carries one since F1 and F2 were fixed. A sequential scan the executor never started (`Actual Loops` 0, a branch behind a one-time filter, such as the content match's walk in a small workspace, decision 250) reads nothing and is not counted; an index or condition is checked on the plan as planned.

**Reading a failure.** With `PERF_REPORT_DIR` set, the suite writes `plans.json` (each query's verdict) and `plan-trees.json` (every statement's full plan); CI uploads them as `perf-report-10k` and writes the table to the job summary.

## Statements per request

`scripts/ci-postgres.sh --pg-stat-statements` starts Postgres with `pg_stat_statements` preloaded (top-level statements, utility statements such as `BEGIN` and `SET` not counted); the job creates the extension in the seeded database. `statements.test.ts` drives each scenario's real route handler as the heavy member through PgBouncer (the session is replaced, as the integration API suites do), warms it once, resets the counters, runs it five times and divides. The count must be a whole number (every request ran the same statements) and within the budget. Two lists also run with `limit=10` and `limit=100`: the counts must be equal, so nothing is read per row.

| Scenario | Map's target | Measured, the budget | Why |
|---|---:|---:|---|
| List, one project, first page | 8 | 8 | the item page, then one statement per relation it carries (state, project, labels, fields, reviews, recurrence), and the tenant binding |
| Board column of the largest project | 8 | 8 | the same read with a state |
| Search, the command palette | 10 | 6 | titles, keys, projects, contents and snippets |
| Detail | 12 | 14 | thirteen relations, one statement each, and the binding |
| My Work, assigned | 8 | 8 | the list read |
| The roadmap, the whole workspace (and grouped by goal) | 7 | 7 | the tenant binding, the goals and initiatives (one statement), the projects, their dated milestones, the aggregate, the calendars and their holidays (3.2c) |
| The calendar, a month grid (the workspace's, and one project's) | — | 8 | the tenant binding (two), the visible projects, the window's items, the undated count, the cycles, the milestones, the working calendar (3.3a) |
| Create with a description | 25 | 32 | three hash-chained audit entries (lock, chain head, insert: nine statements), the number claim, the vector, the field set, the type's review defaults, the read back |

A budget only goes down. A count that grows with the page size or the workspace is a query in a loop the lexical guard (`query-shape-guardrails.test.ts`, D1) missed.

## Latency (H2b)

Decisions 166 to 169: the budgets of the map's part 1.4, measured on a stated reference machine (GitHub's `ubuntu-24.04` runner: 4 CPUs, 16 GB, Islestone's Postgres image behind PgBouncer in transaction mode, Redis, the standalone build), by a small in-house script, blocking only the nightly 100k run.

### The harness

`node scripts/perf/run.mjs` (plain Node: `undici` and `perf_hooks`, already installed; the browser timings through `@playwright/test`'s Chromium). It needs the built app on the seeded database: `scripts/perf/serve.sh start` runs the standalone server (`npm run build` first) with rate limits off (`RATE_LIMIT_ENABLED=0`: 200 samples a minute would trip the read tier) and nothing else changed from production, and it must have the seed's `DATA_ENCRYPTION_KEY`, because a workspace's data key is wrapped by it and the seed's email hashes are derived from it.

1. **Signs in** through NextAuth's credentials flow (the CSRF token, then the callback, as the sign-in page posts it) as the seed's heavy member (`member003@perf-<shape>.seed.invalid`, `SEED_PASSWORD`), and checks the session names that member and the workspace. The map asked for "a member with a typical load"; only the owner and the heavy member have passwords, and the heavy member (about a fifth of the assigned items, so My Work's worst case) is the stricter choice.
2. **Finds its targets through the API**: the first project (`AA`), the largest (`AT`, 20,000 items at 100k), its team's states, the project's select field, the item of the first page with the most sub-items and comments (as `tests/perf/perf-world.ts` picks), open items for the writes, and the largest timeline scope the read accepts (at most 5,000 items: the workspace's open items at 10k, a project of about 4,200 at 100k; the 5,000-item project H3 names is not in the seed).
3. **Measures each scenario** of `budgets.json`: 20 warm-up requests, then 200 sequential samples (50 for the bulk change, which takes a second each), each timed from the request to the last byte of its body with `accept-encoding: gzip`, as a browser waits for it; p50 and p95 through `perf_hooks.createHistogram`. Reads first, then the concurrent pass, then the browser, then the writes, so the rows the writes add and the vacuum they cause never sit under a read's figures.
4. **The concurrent pass** (reported, never budgeted): 10 clients, 25 rounds each over a project's list, a board column, the palette search and the detail.
5. **The browser timings** (`--browser`, reported only; 2 warm-up runs, then 20, each in a fresh page of one signed-in context): navigation to the list's first row, navigation to every board column's first card in the largest project, a card's click to the sheet's title (a list row's title links to the full page, and clicking the row selects it, so the sheet is opened from a card, as `tests/e2e/work-items.spec.ts` opens it), and navigation to the timeline's first bars. The layout is set in local storage before the page loads, as a returning member's choice is.

It writes `perf-summary.json` and `perf-summary.md` to `--out` (`PERF_REPORT_DIR`, else `perf-report`) and the Markdown to the job summary. Exit 0 measured (and within budget when enforced), 1 refused or missed, 2 a usage error or no sign-in. `--only a,b`, `--samples`, `--warmup`, `--browser-runs` and `--concurrency-clients 0` shorten a local run; an enforced run uses none of them.

### What it refuses

**A run that measured nothing fails, everywhere** (decision 168; inflect-compliance's k6 gate measured a month of signed-out requests as green): a scenario with fewer successful samples than it asked for (a failed or signed-out request is not a sample), an empty histogram, a response its own check refused (a list with no rows, a detail of another item, a timeline without rows), or a browser scenario that did not reach its mark on every run. `lib.mjs`'s `refusalsOf`; `tests/unit/perf/harness.test.ts`.

**A budget** fails only an enforced run (`--enforce`, the nightly 100k): a figure above its budget plus the 25 % tolerance is a miss, the scenario is re-run once, and the run is red only if both attempts missed. **The ratio rules** (`--compare` the 10k summary of the same night) are judged with the same tolerance: the detail's p95 at 100k within 1.2× of 10k's (it must not depend on the workspace's size), a project's first page within 1.5× (keyset pagination is nearly flat); a rule with no baseline is never passed.

**A known finding** is a scenario's `knownFinding` in `budgets.json` (its id, the shapes it holds at, why): its miss is reported and never red, and the night it measures within its budget the run is red until the marker is removed with the fix: the twin of the plan checks' `knownFinding`.

### The budgets (decision 167)

`scripts/perf/budgets.json` is their one owner; `tests/unit/perf/harness.test.ts` holds every one at or below the decided table, so a budget only goes down. In milliseconds, p50 / p95, measured on the development machine (4 CPUs, 16 GB, Docker; not the reference runner), 10k on a freshly restored seed and 100k on a fresh seed after one earlier run:

| Scenario (what is sent) | 10k budget | 10k measured | 100k budget | 100k measured |
|---|---:|---:|---:|---:|
| List, a project's first page of 50, manual order | 80 / 200 | 29 / 37 | 100 / 250 | 24 / 33 |
| List, the workspace, two filters (open, high and urgent), by due date | 120 / 300 | 34 / 39 | 180 / 450 | 27 / 35 |
| List, sorted by a select field | 150 / 350 | 38 / 48 | 250 / 600 | 47 / 60 |
| List with `q` (titles, stemmed titles, contents) | 150 / 270 | 91 / 134 | 250 / 320 | 126 / 159 (F3 fixed; 836 / 968 before) |
| Board, a column of the largest project | 80 / 200 | 28 / 33 | 100 / 250 | 27 / 35 |
| Board, first load: the page, then every column at once (wall clock) | 250 / 500 | 120 / 146 | 300 / 700 | 131 / 165 |
| Search, the palette (`limit=20`) | 100 / 250 | 85 / 141 | 200 / 330 | 133 / 164 (F3 fixed; 838 / 985 before) |
| Detail, the item | 50 / 120 | 22 / 28 | 50 / 120 | 20 / 30 |
| Detail, what the sheet loads at once: item, comments, activity, sub-items, fields | 150 / 350 | 41 / 55 | 150 / 350 | 48 / 75 |
| My Work, six sections at once | 300 / 600 | 62 / 81 | 400 / 800 | 74 / 106 |
| Timeline read, the largest scope under 5,000 items (H3's budget, reported) | 400 / 900 | 395 / 480 | 400 / 900 | 228 / 318 |
| Create with a description | — / 400 | 45 / 65 | — / 400 | 41 / 51 |
| Edit the title (`If-Match`) | — / 400 | 39 / 57 | — / 400 | 35 / 43 |
| Move on the board (another state) | — / 400 | 49 / 67 | — / 400 | 40 / 49 |
| Reorder | — / 400 | 50 / 73 | — / 400 | 38 / 48 |
| Bulk state change of 100 items | — / 2,000 | 1,110 / 1,313 | — / 2,000 | 1,279 / 1,426 |

The roadmap read (3.2c, `roadmap`, p50 300 / p95 700 at both shapes) is reported, not enforced: the map's budget names a reference seed of 500 projects and 100,000 items that H2's shapes do not hold (10 projects at 10k, 20 at 100k). Measured in process on the development machine (the usecase alone, 200 samples after 20 warm-ups, direct connection): 20 / 34 ms on the 10k seed (19 / 30 grouped by goal), an 8 KB answer; and on a 500-project shape seeded once for the purpose (500 projects of 20 items, 1,500 milestones; not committed) 62 / 87 ms, a 392 KB answer against the map's 400 KB, 1,040 buffers for the aggregate and the same seven statements. The harness's first run measures it through the built app.

The calendar read (3.3a) has no scenario in the harness: H2's per-surface table names none for it. Measured in process on the development machine (the usecase alone, 200 samples after 20 warm-ups, direct connection, the 10k seed's heavy member, the 42 days around today): the workspace 36 / 50 ms (p50 / p95; 734 items, a 300 KB answer), the largest project 13 / 19 ms (71 items, 30 KB).

The writes have a p95 budget only, as the table decided. An earlier 10k run measured the palette search's p50 at 101 ms against 100 (within the tolerance, and 10k is never enforced). The ratio rules held: the detail's p95 1.10× (1.20× in an earlier run), a project's first page 0.92×. The timeline's answer is 3.4 to 3.9 MB, 475 to 545 KB gzipped (3.1's budget: 1.5 MB and 250 KB; reported in the summary, issue #73).

The concurrent pass (10 clients, 1,000 requests): 54 requests a second at 10k, 17 at 100k, where the palette search's p95 under load was 3.1 s (F3); the other three stay near 100 ms. Since the fix of F3 (decision 250): 50 requests a second at 100k, the palette search's p95 under load 788 ms, the other three under 180 ms.

**The fix of F3, measured** (decision 250; the same development machine, the 100k seed after one earlier run, the app built from `main` and then from the fix, the same session): the list's `q` 836 / 968 ms p50 / p95 before, 126 / 159 after; the palette search 838 / 985 before, 133 / 164 after; at 10k, on a fresh seed, 91 / 134 and 85 / 141 (H2b measured 108 / 135 and 93 / 130 before). The two scenarios' budgets were lowered to about twice the new figures where that is below decision 167's (a budget only goes down): the list's `q` 270 ms p95 at 10k and 320 at 100k, the palette search 330 at 100k. The other scenarios of that 100k run all held their budgets.

| Browser (reported only) | Target p95 | 10k p50 / p95 | 100k p50 / p95 |
|---|---:|---:|---:|
| Navigation to the list's first row | 1,300 | 635 / 801 | 581 / 684 |
| Navigation to every column's first card | 2,000 | 843 / 1,211 | 675 / 1,038 |
| A card's click to the sheet's title | 600 | 230 / 376 | 228 / 319 |
| Navigation to the timeline's first bars | 2,000 | **2,437 / 2,605** | **2,052 / 2,144** |

The timeline's first bars miss 3.1's 2.0 s (issue #73, H3's; measured here, not redesigned). A first 100k run measured the list and board navigations at 2.7 and 3.8 s p95 because they ran right after 200 creates and 50 bulk changes of 100 items, under the vacuum those caused; that is why the writes now run last.

## In CI

`ci.yml`'s `Performance (10k)` job, on every pull request: Postgres with `pg_stat_statements` and PgBouncer (`scripts/ci-postgres.sh islestone_perf --pgbouncer --pg-stat-statements`); the cached dump restored, or the shape seeded, dumped and cached; the restored seed verified; then `npm run test:perf`, blocking; then (H2b) the build job's app started (`scripts/perf/serve.sh start`, a Redis service beside it) and the harness at 10k: a scenario that measured nothing fails the job, latency is reported in the job summary and `perf-report-10k`. Locally the steps after `npm ci` took about 25 s with a warm cache (restore and verify 11 s, the perf project 11 s) and about 2.5 minutes cold, and the harness about 6 minutes without the browser timings.

The seed and the app share one throwaway `DATA_ENCRYPTION_KEY` (set on the job, the same in `perf.yml`); the dumps' cache keys carry `k1` for it, so a change of key changes the suffix too.

Locally, beside another run, under other container names and ports:

```bash
CI_PG_PREFIX=islestone-perf PG_PORT=55432 PGBOUNCER_PORT=56432 scripts/ci-postgres.sh islestone_perf --pgbouncer --pg-stat-statements
export DATABASE_URL=postgresql://islestone:islestone_ci@127.0.0.1:56432/islestone_perf
export DIRECT_DATABASE_URL=postgresql://islestone:islestone_ci@127.0.0.1:55432/islestone_perf
export AUTH_SECRET=local-throwaway NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100 LOG_LEVEL=warn   # pragma: allowlist secret
export DATA_ENCRYPTION_KEY=local-perf-data-encryption-key-not-a-secret   # pragma: allowlist secret
npm run migrate:deploy && npm run seed:scale -- --shape 10k
docker exec islestone-perf-postgres psql -U islestone -d islestone_perf -c 'CREATE EXTENSION pg_stat_statements'
npm run test:perf
# The latency harness: the built app on the seed, with a Redis (here the local compose one).
export REDIS_URL=redis://:islestone_dev@127.0.0.1:6379   # pragma: allowlist secret
npm run build && scripts/perf/serve.sh start
node scripts/perf/run.mjs --shape 10k            # add --browser (PW_CHROMIUM_PATH for a preinstalled Chromium), --enforce
scripts/perf/serve.sh stop
```

Export `DATA_ENCRYPTION_KEY` before seeding: the seed wraps each workspace's data key and hashes its emails with it, and the app must read them with the same key. The create scenario adds five items to the seeded workspace, and the harness's writes add and change more, so re-verify only a fresh seed or a restored dump, and restore the dump before a run whose figures you will compare.


## The nightly run (H2b)

`.github/workflows/perf.yml`, nightly at 02:41 UTC (off the hour, away from DAST's 03:17): the app built, Postgres and PgBouncer as above, a Redis service and Playwright's Chromium; then the 10k shape (cached dump, verified) and the harness at 10k, reported, as the ratio rules' baseline; the database emptied (`scripts/perf/nightly-seed.sh reset`); the 100k shape (`perf-seed-100k-k1-<hash>`; a cold seed takes about 17 minutes); the plan checks and statements per request at 100k, blocking, with the 100k buffer budgets; and the harness at 100k with `--enforce`, `--compare` and `--browser`. `perf-summary-100k` (both shapes' summaries, the plans and the server's log) is kept 90 days, so a trend can be read. A red night (any step) runs the `report` job, which runs no repository code and alone holds `issues: write`: it opens the issue "Nightly performance run is red", or comments on it when it is open, with the night's summary. `workflow_dispatch` runs either shape (budgets enforced at 100k only); a push to `main` runs 10k for the job summary, reported. Every action is pinned by commit.

## The 100k run (once, in H2a)

The perf project ran once against the 100k shape (`PERF_SHAPE=100k`, both URLs direct; buffers reported, not judged). Every plan kept its rules (no sequential scan on a guarded table but F2's, every expected index used, two of them an equivalent one the planner preferred at that size), and every statements-per-request count was identical to 10k's: nothing reads per row or per item. The buffers H2b's budgets must start from, besides the first pages that stayed flat (a project's list 386, the workspace's 455, a board column 407, My Work's assigned 555, the detail 33):

| Query | 10k | 100k | Why |
|---|---:|---:|---|
| Search: contents and snippets | 12,278 | 511,194 | F1: the planner walks every item and probes its vectors |
| The list's `q` | 14,365 | 524,430 | F1, the same read |
| The search-index rebuild | 11,661 | 126,464 | F2 (and a sequential scan of `WorkItem` too) |
| A member's removal | 5,863 | 43,856 | the lock takes every row of the heaviest member (about 20,000) |
| A list sorted by a custom field | 2,693 | 12,186 | the field's value rows in value order, then the items |
| Items in a state | 3,151 | 10,325 | a state's delete locks every item in it |
| Search: titles | 1,200 | 10,320 | F1 |
| My Work: to review | 77 | 7,689 | the sample's few reviewer rows read whole |

The F1 and F2 rows are the numbers before their fixes (decision 245, issues #78 and #79); the fixes were measured at 10k only (below). The content and title reads now grow with the matches rather than the workspace, and a rebuild page with its own 500 rows; H2b's 100k run measures them again.

## The 100k budgets (H2b)

The plan checks' `maxBuffers100k` (`tests/perf/plan-checked-queries.ts`), judged by the nightly run: about twice what H2b measured on the 100k seed (two runs, the larger), and never below the query's 10k budget. Every plan rule held at 100k (no sequential scan on a guarded table, every expected index used, each search index searched with its operator), and every statements-per-request count equalled 10k's. The first pages stayed flat (a project's list 386 buffers, the workspace's 453, a board column 408, My Work's assigned 555, the detail 33). What grows with the workspace, and why:

| Query | 100k measured | 100k budget | Why |
|---|---:|---:|---|
| The list's `q` | 42,920 | 86,000 | F3 fixed (decision 250): the walk reads at most the newest 50,000 vectors and stops at 2,001 matches (90,394 before) |
| Search: contents and snippets | 36,242 | 73,000 | F3 fixed (86,569 before) |
| A member's removal | 43,855 | 88,000 | the lock takes every row of the heaviest member |
| A list sorted by a custom field | 12,157 | 25,000 | the field's value rows in value order, then the items |
| Items in a state | 10,340 | 21,000 | a state's delete locks every item in it |
| My Work: to review | 7,687 | 16,000 | the sample's few reviewer rows read whole (`noIndexBecause`) |
| Search: titles | 6,552 | 14,000 | grows with the title matches |
| The search-index rebuild | 4,930 | 10,000 | one page of each kind, whatever the size (#79's fix holds) |

**Calendar sync's push set (3.3b) is not measured at 100k either**: its `maxBuffers100k` (75,000) is an estimate, about ten times the 10k figure, to be replaced with about twice the nightly's first measurement. At 10k the heavy member's push set reads 3,718 buffers (budget 7,500): the window's items and their count on `WorkItem_tenantId_assigneeId_stateCategory_dueDate_idx` and every open assigned item grouped by project, with no sequential scan. It runs in a job, once per connection a quarter hour, never on a request.

**The calendar's two reads (3.3a) are not measured at 100k** (the session that built them had no disk for the 100k seed): their `maxBuffers100k` are estimates written beside them in the registry (40,000 for the workspace, whose month holds more than the 2,000-item limit at 100k so the read becomes the refusal with its counts; 10,000 for a project), to be replaced with about twice the nightly's first 100k measurement. At 10k the workspace month reads 2,566 buffers (budget 5,200), the window per visible project on `WorkItem_tenantId_projectId_dueDate_id_idx` and the undated count as a tenant bitmap, with no sequential scan; a project month 472 (budget 1,000).

**The roadmap's aggregate (3.2c) is not measured at 100k**: its `maxBuffers100k` (20,000) is ten times its 10k budget, since the read covers the items of every project shown, until the nightly's first 100k measurement replaces it with about twice what it reads. At 10k it reads 1,007 buffers (budget 2,000) with both its indexes and no sequential scan.

The goal and initiative reads of 3.2a and 3.2b, measured once at 100k on the rebased tree (the seed holds no goals, so the goal paths name none): the goal filter 1,470 buffers (budget 3,000), the initiative filter 363 (750), the ancestry 15 (50), the goal purge's unlinked items 3 (50), progress by the project path 41 on `WorkItem_progress_project_path` (100), progress by the direct goal path 4 (50).

The statement counts needed nothing new, but the statements suite's fixture reads take more than a test's 120 s on a cold 100k cache, so its `beforeAll` has 600 s, as the plan checks' has.

## Findings

What H2a's checks found on the 10k seed (decision 172: fixed before the gate closes, or reported when the fix is large).

| Id | Finding | State |
|---|---|---|
| — | Three reads ordered across projects and read every matching row before sorting: the Work items page's default (the whole workspace in manual order), My Work's "Assigned to me" in manual order (the heaviest member's 2,160 items read and sorted for one page: 2,088 buffers at 10k, about 13,000 at 100k), and the Work items page by due date across projects. | **Fixed:** migration `20261213120000_list_scale_indexes` adds `WorkItem(tenantId, sortKey, id)`, `(tenantId, assigneeId, sortKey, id)` and `(tenantId, dueDate, id)`, with their Layer C entries; the three reads now walk their index for one page (403, 483 and 1,294 buffers). |
| — | A member's removal locked its rows with one `OR` across `assigneeId`, `waitingOnUserId`, a person value and the reviewer rows, which no index serves. | **Fixed:** `WorkItemRepository.lockItemsOfPerson` takes a `UNION` of one indexed read per reason; the lock itself still takes every row it names. |
| F1 | **Full-text and trigram conditions are filters under row-level security.** `@@` (`ts_match_vq`), `ILIKE` (`texticlike`) and `%` are not `LEAKPROOF`, so PostgreSQL may not use a user condition built on them as an index condition ahead of the RLS policy's qual: `WorkItem_search_title_fts`, `WorkItem_search_title_trgm` and `SearchVector_search_lexemes` were read on `tenantId` alone, every row of the workspace fetched and filtered (36,481 vectors for a search matching 3,264). Every search and the list's `q` cost grew with the workspace: at 100k one palette search touched 511,194 buffers. `tests/integration/search.test.ts` checked the plans as the superuser, so it never saw it. | **Fixed** by owner decision 245 (issue #78): every search read is a scoped `SECURITY DEFINER` function (migration `20261214120000_search_definer_functions`; `docs/search.md`, "The search functions"), owned by a NOLOGIN `BYPASSRLS` role with column `SELECT` only, which reads the workspace from `app.tenant_id` and applies `deletedAt` and visibility itself; nothing is `LEAKPROOF` and row-level security is unchanged. Each GIN index is now searched with its operator in the index condition, and a broad content match checks liveness index-only (`WorkItem_search_live_ids`, `Comment_search_live_ids`). At 10k: the list's `q` 16,378 → 3,535 buffers, the content search with its snippets 14,298 → 2,433, the title search 1,193 → 907 (budgets 7,000, 5,000 and 1,800). `search.test.ts` and `search-vectors.test.ts` now check the functions' own plans as `app_user`. |
| F2 | **The search-index rebuild's stale-page reads hash-joined the workspace's whole vector table** (`staleDescriptionPage`, `staleCommentPage`: sequential scans of `SearchVector` and `Comment`, 11,650 buffers at 10k for the two first pages). Nightly with nothing stale that was one pass; a forced rebuild (the admin route) repeated it for every page of 500, quadratic in the workspace. | **Fixed** (issue #79): a page is a keyset read of the next 500 sources after its cursor (`Comment_search_live_ids` for comments, `WorkItem_pkey` for items) with each one's vector probed by its own key (`SearchVector_one_per_description`, `SearchVector_one_per_comment`); the page returns its stale ids and the next cursor, and the job walks every page, so a run is linear. One page of each kind: 4,944 buffers (budget 10,000), whatever the workspace's size. |
| — | The workspace-wide list sorted by updated, created, priority or key reads every matching item before sorting (as the three fixed reads did). Not in the map's scenario list; each would need one more `WorkItem` index. | **Decided by H2b's measurement: no index.** At 100k each answers its first page in 94 to 134 ms (manual order 28 ms), within the workspace-wide list's budget (180 / 450 ms). |
| F3 | **Search at 100k grows with its matches.** The content match (`search_item_contents`) ranks every matching vector before it takes its limit, and the list's `q` reads up to 1,000 ranked matches: the measured query (`задачата проекта`) matches 33,356 of the 100k workspace's 370,476 vectors (28,756 items), so the palette search and the list's `q` take about 0.8 s p50 and 0.85 to 1.0 s p95 against 500 and 600 ms, and 3.1 s p95 under ten clients; at 10k (about a tenth of the matches) both are within budget. The seed's small word list makes every word common, so a real workspace's query matches fewer items; a common word still behaves like this. The plans hold their indexes (decision 245's fix); the cost is the ranking. | **Fixed** by owner decision 250 (issue #89; migration `20261217120000_search_recent_candidates`; `docs/search.md`, "The bound on content matches"): the content match ranks only the caller's 2,000 most recently written live, visible matching vectors, and says when it cut them (`bounded`; the palette and the list say they show recent matches). In a large workspace (100,000 vectors or more), for a query matching at least 100 of the 2,000 newest vectors, the newest 50,000 are walked on the new index `SearchVector_search_recent` until 2,001 matches; otherwise every match is read on `SearchVector_search_lexemes` and the newest kept. The choice is measured, not estimated: the planner multiplies the words' frequencies, and estimated 15,970 matches for the measured query's 33,130, so it read every match. Measured on the development machine (`задачата проекта`, 100k): the list's `q` 836 / 968 → 126 / 159 ms p50 / p95, the palette search 838 / 985 → 133 / 164, 788 ms p95 under ten clients; buffers 90,394 → 42,920 and 86,569 → 36,242 on a fresh seed (budgets 86,000 and 73,000; every plan check held at 100k). In the function alone (psql, warm, a fresh 100k seed): a common query 55 to 100 ms and 21,000 to 55,000 buffers (the walk); a medium one (about one match in 50 vectors, `проблема издание`: 7,036 matches) 155 ms and 25,000 buffers and a rare one 17 ms and 3,000 buffers (the vector index). At 10k (always the vector index, a workspace under 100,000 vectors): 5,865 and 3,150 buffers, within their budgets (7,000 and 5,000; 3,535 and 2,433 before, the difference being the size count and the live items read once). Two settings on the function: `plan_cache_mode = force_custom_plan` (a cached generic plan parses the query once per row the walk filters: 300 ms instead of 70) and `jit = off` (compiling the walk's plan cost about 240 ms). The plan checks no longer count a sequential scan the executor never started (`seqScansOn`): at 10k the walk is planned but never run. |
| #73 | **The timeline at 5,000 items**, H3's (3.1's "Performance"). The read is within its latency budget at both sizes (p95 480 ms at 10k on 4,515 items, 318 ms at 100k on 4,399), but its answer is 3.4 to 3.9 MB, 475 to 545 KB gzipped (budget 1.5 MB and 250 KB), and its first bars take 2.1 to 2.6 s p95 in the browser (budget 2.0 s). | **Reported** (issue #73; the timeline read is `enforced: false` with H3's numbers until H3). |
