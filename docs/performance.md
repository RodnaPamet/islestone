# Performance

Hardening H2's performance half (`docs/porting/maps/H2.md` part 1; owner decisions 166 to 172). H2a, built here, is the seed and the deterministic checks that block every pull request; H2b adds the latency budgets, the harness and the nightly 100k run.

| Part | What | Blocks | Where |
|---|---|---|---|
| The seed (1.1) | Two workspaces of 10,000 or 100,000 items, verified, cached as a dump | (it is the input) | `scripts/seed-scale/` |
| Plan checks (1.2) | Every named query's plan on the seeded database: no sequential scan on a guarded table, its indexes used, a buffer budget | every pull request, at 10k | `tests/perf/plans.test.ts`, `tests/perf/plan-checked-queries.ts` |
| Statements per request (1.3) | How many statements each scenario's request runs, and that a list's count does not grow with its page size | every pull request, at 10k | `tests/perf/statements.test.ts` |
| Latency (1.4 to 1.6) | Response budgets on the reference machine | the nightly 100k run (H2b) | not built yet |

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

**How a plan is captured.** `plans.test.ts` imports `plan-env.ts` first: the application's client connects DIRECTLY to Postgres with `auto_explain` loaded for the session through libpq startup options (`session_preload_libraries`, `log_min_duration=0`, `log_analyze`, `log_buffers`, `log_format=json`, `log_level=notice`; PgBouncer would refuse the options), and every pg client records the NOTICE each statement's plan arrives in. Each named query runs its real repository methods with realistic arguments, as the heavy member, inside `runInTenantContext`: as `app_user`, with row-level security on, exactly as a request runs them. Nothing is re-planned from copied SQL.

**What each query must hold** (`judgePlans`, `conditionMisses` in `plan-capture.ts`, unit-tested in `tests/unit/perf/plan-capture.test.ts`):

- no `Seq Scan` on `WorkItem`, `Comment`, `SearchVector`, `WorkItemTransition` or `AuditLog`;
- every index it names used by at least one of its statements (`a|b` for either), or a stated reason it needs none (`noIndexBecause`: the working-calendar tables hold a few rows at any size);
- for a search index, the operator in the index condition (`conditions`): a GIN index read on its leading `tenantId` alone returns every row of the workspace, so "the index was used" proves nothing;
- the shared buffers (hit plus read) of all its statements within its budget, about twice what H2a measured at 10k (closer where the data fixes the count: a lock takes every row it names). At another shape the buffers are reported, not judged; the 100k budgets arrive with H2b.

**The registry.** `PLAN_CHECKED_QUERIES` (`tests/perf/plan-checked-queries.ts`) names 45 queries: the list in every sort the API offers, its second page, the workspace-wide list in manual order and by due date with two filters, the label and custom-field filters, the custom-field sort, the list's `q`, the Deleted view, a board column of the largest project, My Work's six sections, the detail and what the sheet loads (comments, sub-items, subtree), the metrics and the cycle, milestone and state counts, the search usecase's raw reads, the timeline's scope and context rows (3.1b) and the working calendars it reads (3.1a), the placement reads, a member's removal, deletion groups, the cycle and milestone deletes and the rollover, the templates' open items, and the jobs (due reminders, the digest, the purge, a purged project, the rebalance, the search-index rebuild). `tests/guards/plan-checked-queries-coverage.test.ts` holds it to the code: every repository method that reads `WorkItem`, `Comment` or `SearchVector` is named by a query or exempt with a reason in `PLAN_CHECK_EXEMPT` (reads by primary key or a unique key), with no stale entries either way. **A new list query joins `PLAN_CHECKED_QUERIES`**, with a runner in `plans.test.ts`.

**Known findings.** A query whose finding is reported and not yet fixed carries `knownFinding` (below): the one check it fails runs as `it.failing`, so the suite stays green while the defect stands and turns red the day it is fixed, until the marker is removed and the check holds for good.

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
| Create with a description | 25 | 32 | three hash-chained audit entries (lock, chain head, insert: nine statements), the number claim, the vector, the field set, the type's review defaults, the read back |

A budget only goes down. A count that grows with the page size or the workspace is a query in a loop the lexical guard (`query-shape-guardrails.test.ts`, D1) missed.

## In CI

`ci.yml`'s `Performance (10k)` job, on every pull request: Postgres with `pg_stat_statements` and PgBouncer (`scripts/ci-postgres.sh islestone_perf --pgbouncer --pg-stat-statements`); the cached dump restored, or the shape seeded, dumped and cached; the restored seed verified; then `npm run test:perf`, blocking. Locally the steps after `npm ci` took about 25 s with a warm cache (restore and verify 11 s, the perf project 11 s) and about 2.5 minutes cold.

Locally, beside another run, under other container names and ports:

```bash
CI_PG_PREFIX=islestone-perf PG_PORT=55432 PGBOUNCER_PORT=56432 scripts/ci-postgres.sh islestone_perf --pgbouncer --pg-stat-statements
export DATABASE_URL=postgresql://islestone:islestone_ci@127.0.0.1:56432/islestone_perf
export DIRECT_DATABASE_URL=postgresql://islestone:islestone_ci@127.0.0.1:55432/islestone_perf
export AUTH_SECRET=local-throwaway NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100 LOG_LEVEL=warn   # pragma: allowlist secret
npm run migrate:deploy && npm run seed:scale -- --shape 10k
docker exec islestone-perf-postgres psql -U islestone -d islestone_perf -c 'CREATE EXTENSION pg_stat_statements'
npm run test:perf
```

The create scenario adds five items to the seeded workspace, so re-verify only a fresh seed or a restored dump.

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

## Findings

What H2a's checks found on the 10k seed (decision 172: fixed before the gate closes, or reported when the fix is large).

| Id | Finding | State |
|---|---|---|
| — | Three reads ordered across projects and read every matching row before sorting: the Work items page's default (the whole workspace in manual order), My Work's "Assigned to me" in manual order (the heaviest member's 2,160 items read and sorted for one page: 2,088 buffers at 10k, about 13,000 at 100k), and the Work items page by due date across projects. | **Fixed:** migration `20261213120000_list_scale_indexes` adds `WorkItem(tenantId, sortKey, id)`, `(tenantId, assigneeId, sortKey, id)` and `(tenantId, dueDate, id)`, with their Layer C entries; the three reads now walk their index for one page (403, 483 and 1,294 buffers). |
| — | A member's removal locked its rows with one `OR` across `assigneeId`, `waitingOnUserId`, a person value and the reviewer rows, which no index serves. | **Fixed:** `WorkItemRepository.lockItemsOfPerson` takes a `UNION` of one indexed read per reason; the lock itself still takes every row it names. |
| F1 | **Full-text and trigram conditions are filters under row-level security.** `@@` (`ts_match_vq`), `ILIKE` (`texticlike`) and `%` are not `LEAKPROOF`, so PostgreSQL may not use a user condition built on them as an index condition ahead of the RLS policy's qual: `WorkItem_search_title_fts`, `WorkItem_search_title_trgm` and `SearchVector_search_lexemes` are read on `tenantId` alone, every row of the workspace is fetched and filtered (36,481 vectors for a search matching 3,264; the same search as the superuser reads 1,836 buffers instead of 2,303, and a rare word a handful). Every search and the list's `q` cost grows with the workspace: at 100k one palette search touched 511,194 buffers. `tests/integration/search.test.ts` checks the plans as the superuser, so it never saw it. | **Reported.** A security decision: marking those functions `LEAKPROOF` (a migration as the superuser, after reviewing that they raise no data-dependent errors), or reading the matches through a narrowly scoped `SECURITY DEFINER` function that applies the workspace itself. The three plan checks carry `knownFinding: F1`. |
| F2 | **The search-index rebuild's stale-page reads hash-join the workspace's whole vector table** (`staleDescriptionPage`, `staleCommentPage`: sequential scans of `SearchVector` and `Comment`, 11,652 buffers at 10k). Nightly with nothing stale that is one pass; a forced rebuild (the admin route) repeats it for every page of 500, quadratic in the workspace. | **Reported.** A keyset walk over a tenant-leading id index with `NOT EXISTS` probes, or collecting the stale ids once. The plan check carries `knownFinding: F2`. |
| — | The workspace-wide list sorted by updated, created, priority or key reads every matching item before sorting (as the three fixed reads did). Not in the map's scenario list; each would need one more `WorkItem` index. | **Reported** for H2b's 100k measurements to decide. |
