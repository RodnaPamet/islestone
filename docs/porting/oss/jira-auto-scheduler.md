# jira-auto-scheduler study

Studied 2026-11-18 for Islestone roadmap sub-phase 3.6 (analytics and forecasting), with notes for 3.1, 3.5, 7.5 and hardening gate H3. Read-only study: nothing in the clone was installed, built or executed.

## 1. Pin and licence facts

| Fact | Value | How verified |
|---|---|---|
| Repository | `https://github.com/bitovi/jira-auto-scheduler` | `git remote -v` in the clone |
| Pinned commit | `39323ed28d7d7e2223853f67a098dd9a23f2773f` (2025-03-26, "Merge pull request #99 from bitovi/discovery-fix") | `git log -1`; `git ls-remote origin HEAD` returned the same hash on 2026-11-18, so this is the default branch's head today |
| Clone | `/tmp/claude-0/-home-user/0c23d429-765a-50a1-803a-34c6b03926ac/scratchpad/oss-pins/jira-auto-scheduler/repo` (`--filter=blob:none`), 84 tracked files, 195 commits | `git ls-files`, `git log` |
| Licence (controlling) | **MIT**, root `LICENSE`, "Copyright (c) 2021 Bitovi". Standard MIT text, unmodified. It is the only licence file in the tree (no COPYING, NOTICE, CLA or CONTRIBUTING file). SHA-256 `c5e2b1d9080beaa56e4f73dd3e05208cb974c4d8213b89f8d7f424722d30102b`. | Read in full at the pinned commit; independently fetched from `raw.githubusercontent.com/bitovi/jira-auto-scheduler/39323ed…/LICENSE` (HTTP 200), byte-identical to the clone's copy |
| LICENSE history | Added in `93d5a21` (2021-04-04); never changed since | `git log -- LICENSE` |
| Conflict | `package.json` says `"license": "ISC"`. It has said ISC since `package.json` first appeared (`4be3013`, 2023-04-16), in all six revisions of the file: it is the `npm init` default, never edited. | `git show 4be3013:package.json`; `"license"` read from every revision in `git log -- package.json` |
| Reading of the conflict | Islestone's PROVENANCE rule is "licence read from its LICENSE file, not from a README or a registry page", so record **MIT** and note the ISC field. Both are permissive notice-only licences, so the obligations do not differ in practice. Owner may still want to ask Bitovi to fix the field. | Judgement, not verified with Bitovi |
| Restricted (non-permissive) directories | None found. | Whole tree listed |
| Third-party material inside the repo | `public/can.js` (44,562 lines, a CanJS bundle with no licence header of its own); its only notices are two copies of "Copyright 2012-2016 The Dojo Foundation" (lines 4621 and 31503), each directly under "// From lodash lodash 4.6.1 <https://lodash.com/>" on an inlined binary-search fragment. `public/json-logic/json-logic.js` (449 lines, appears to be a copy of json-logic-js; no licence header, its only header comment cites a UMD cheatsheet URL). `public/dist/*` (minified builds with source maps): `production.css` opens with the banner "tailwindcss v3.3.5 \| MIT License", and `main-uqpITCg1.js.map` embeds the same lodash/Dojo notice. `public/images/bitovi-logo.png` and social images (branding). | `git grep -i "spdx\|licen[cs]e\|copyright"` over all 84 tracked files, then reading each hit in context |
| Runtime dependency of the Monte Carlo | **jStat**, loaded at runtime from `https://cdn.jsdelivr.net/jstat/latest/jstat.min.js` (`public/shared/jstat.js`, 9 lines), i.e. an unpinned remote script. npm `jstat@1.9.6` (the `package.json` dependency, used by `server/stats.js`; `package-lock.json` resolves exactly 1.9.6) has no `license` field, **but declares MIT through the legacy `licenses` array**: `[{"type": "MIT", "url": "http://www.opensource.org/licenses/mit-license.php"}]`. Its `gitHead` is `7c4d63ffdd9961f151aebc2ff78b3dc68c17143e`; jStat's `LICENSE` at that commit is MIT-form text, "Copyright (c) 2013 jStat" (no "MIT License" title line), byte-identical to `master` today. | `curl registry.npmjs.org/jstat/1.9.6` (version document); `curl raw.githubusercontent.com/jstat/jstat/7c4d63ff…/LICENSE` and `…/master/LICENSE`, both HTTP 200, same SHA-256 `854847b5…dd800` |

Not verified: whether Bitovi holds copyright in every contributor's commits (no CLA file in the repo; 96 of 195 commits are authored from `gmail.com` addresses, 91 from `bitovi.com`, 8 from GitHub noreply); the licence of the CanJS bundle itself (`can.js` states none; the lodash fragment's upstream licence was not fetched); whether `json-logic.js` is in fact json-logic-js, and that project's licence; that the npm tarball's own `package.json` matches the registry version document (the tarball was not downloaded).

## 2. What the tool actually does (and the mismatch with 3.6)

**Important for the roadmap:** roadmap 3.6 cites this repository "for the Monte Carlo approach" and asks for Monte Carlo "over historical throughput". **jira-auto-scheduler does not do throughput forecasting.** It never reads completed items, cycle times or history. It is an **estimate-driven, resource-constrained schedule simulation**:

- input per epic: a median estimate in story points, a confidence (10-100 %), blockers, a team;
- input per team: a velocity (points per sprint, typed in; default 21), a sprint length (working days; default 10) and a number of parallel tracks (default 1);
- each trial samples every epic's duration from a lognormal around its median, then list-schedules all epics onto their team's tracks respecting blockers;
- after N trials it reports, per epic and for the whole plan, start and due dates at a user-chosen probability threshold (50-90 %, or the mean), plus 10/90/95 % markers and a per-day histogram;
- it can write the chosen dates (and an uncertainty-adjusted story-point value) back to Jira after a review table.

So the parts that transfer to 3.6's throughput forecast are the **outer shell** (N trials, sorted outcomes, percentile read-out, histogram and cumulative-probability display, business-day conversion, "refuse when there is no work"), not the sampling model. The throughput sampler has no source here and must be written fresh. The estimate-driven model is a second, separate forecasting mode that fits better with 3.1 (scheduling engine), 3.5 (capacity) and 7.5 (forecast explanation and rescheduling).

## 3. Files worth studying, with line counts

Own code (excluding `can.js`, `json-logic`, `dist`) is about 6,600 lines of browser JavaScript on CanJS observables; the forecasting core is under 1,000 of them. Line counts are `wc -l` at the pinned commit.

| File | Lines | Part worth studying | Lines of interest | Verdict |
|---|---|---|---|---|
| `public/shared/confidence.js` | 42 | Confidence-to-sigma mapping; lognormal sample and quantile of the "extra" work | `toStandardDeviations` 3-13; `estimateExtraPoints` 21-29; `sampleExtraPoints` 32-36; `toP` 39-42 (unused anywhere) | **Core idea.** Re-implement; no jStat |
| `server/stats.js` | 27 | Server-side duplicate of `estimateExtraPoints` | whole file | Ignore (duplicate) |
| `public/schedule-prepare-issues.js` | 427 | Per-trial work-item preparation: filter done, build parent/child and blocker graph, duration sampling, cycle check | `getDaysOfWork` 137-139; `createWork` 145-211; `linkDirectBlocks` 276-297; `linkIndirectBlocks` + helpers 236-312 (feature flag `useParentBlockers`); `checkForCycles` 314-332; defaults 29-68 | Study `createWork` and the graph build; do not port the defaults or the Jira field readers (383-427) |
| `public/schedule.js` | 148 | The list scheduler: priority by longest downstream chain, recursive placement once all blockers are placed | `scheduleIssues` 10-52; `blocksWorkDepth` 56-67; `deterministicBlocksWorkDepth` 70-81; `planIssue` 86-117; `earliestStartTimeFromBlockers` 144-148 | **Core idea** for estimate mode |
| `public/work-plans.js` | 186 | Per-team tracks (parallel lanes) as doubly linked lists; first-fit gap insertion | `ScheduledWorkNode.isPrependPossible` 11-21; `WorkPlan.earliestStartDay` 51-69; `append` 96-115; `WorkPlans.sheduleWork` 150-169 (dead code 170-184) | Idea only; an interval list per lane is simpler |
| `public/monte-carlo.js` | 700 | Trial loop, batching, per-epic statistics, plan-level completion ("Due Date" row) | `WorkItem` statistics class 40-123; `runOneSimulation` 351-378; `afterFirstSimulation` (trial loop, batching, `addResults`) 379-485; `toBaseWorkPlans` 582-615; constants 275-276; deterministic feature flag 125-135 | **Core idea** for the shell; the UI (139-262, 486-699) is not useful |
| `public/simulation-data.js` | 443 | Per-day histogram and the cumulative-probability tooltip; conversion of day indices to dates | `showProbabilityData` 83-100; `getDatesFromWork` 273-301; `createColumnData` 308-330; commented-out d3 version 332-~425 | Idea for the forecast chart |
| `public/critical-path-report.js` | 214 | "Long poles": greedy longest chain by downstream depth, plus the remaining blocked work | `criticalPaths` getter 106-168 | Idea for 7.5 explanations; 3.1's real CPM replaces it |
| `public/shared/dateUtils.js` | 422 | Business-day arithmetic (Mon-Fri, UTC, no holidays); "best fit" axis ranges | `getUTCEndDateFromStartDateAndBusinessDays` 105-131; `bestFitRanges` 409-422 | Too weak for H3 (no holidays, no zones); 3.1's calendar replaces it |
| `public/update-epics.js` | 265 | Review-before-write table, then writes Start date, Due date and adjusted points back | diff highlighting 202-207; `save` 208-235; `newStoryPoints` 196-198 | Pattern for "a change the user confirms" (3.1) |
| `public/components/velocities-from-issue.js` | 298 | Team configuration (velocity, tracks, sprint length) read from a table in a Jira issue's description | getters 39-82; aliases 87-106 | Not needed; Islestone stores this as data |
| `public/jira-auto-scheduler.js` | 357 | Probability-threshold slider (50-90 step 5; 55 means "average") | 78-103, 180-187 | UX note only |

## 4. Data model (in memory; the tool has no database)

There are no tables. Everything is a plain or observable object rebuilt on each trial. Transcribed compactly:

```
Issue (normalised from Jira; key fields)
  key            string            "Issue key"
  summary        string
  type           {name, hierarchyLevel}   only type "Epic" (level 1) is scheduled
  projectKey     string
  team           string?           default team = Team.name or projectKey (JSON-logic rule)
  parentKey      string?           "Parent.key"
  blocksKeys     string[]          Jira "blocks" links
  statusCategory string            "Done" items are dropped before scheduling
  medianEstimate number?           e.g. "Story points median"
  confidence     number?           10..100, e.g. "Story points confidence"
  startDate, dueDate   date?       written back
  -- graph built per run --
  blocks[], blockedBy[]  -> Issue  (same-type links only; cross-type links ignored)
  _parent, _children     -> Issue
  blocksWorkDepth        number    longest downstream chain, in days

TeamConfig (per team)
  velocity       number   points per sprint, default 21
  sprintLength   number   working days, default 10
  tracks         int      parallel lanes, default 1

Work (per epic per trial)
  usedEstimate      = estimate ?? team.velocity      (silent default)
  usedConfidence    = valid(confidence) ? confidence : 50   (silent default)
  isDefaultValue    = !(valid confidence && estimate present)
  pointsPerDay      = velocity / sprintLength / tracks
  estimatedDaysOfWork = max(1, round(usedEstimate / pointsPerDay))
  extraPoints       sampled (trial) or quantile (deterministic)
  daysOfWork        = max(1, round((usedEstimate + extraPoints) / pointsPerDay))
  deterministicDaysOfWork   same at the fixed quantile (orders the plan)
  startDay          int (working-day index from the plan start date)
  artificiallyDelayed  bool (started later than its blockers allowed)

WorkPlans (per team) -> tracks[tracks] -> ordered list of placed Work

ItemStats (per epic across trials)          PlanStats ("Due Date" row)
  startDays[], dueDays[], durations[] sorted  dueDays[] = per-trial max end day
  mean start, mean due
  start@(100-p), due@(100-p), due@p, duration@p
  start@10, due@10, due@90, due@95
  latestSafeStart = due@p - duration@p        (written to Jira as Start date)

Persisted configuration
  Jira issue titled "Jira Auto Scheduler Configuration": table Team | Velocity | Tracks | Sprint Length
  URL query / localStorage: threshold ("weight", default 55), start date, JQL, field choices
```

## 5. Algorithms (prose and pseudo-code; no code copied)

### 5.1 Duration model (estimate mode)

The median estimate is treated as the median of a lognormal: the duration multiplier is `exp(sigma * Z)` with `Z ~ N(0,1)` and location 0, so the multiplier's median is exactly 1 and its mean is `exp(sigma^2 / 2)`. Sigma is a straight line in confidence, anchored at sigma 0 for 100 % and sigma 1.3 for 10 %:

```
sigma(c) = (100 - c) * 1.3 / (100 - 10)        # c in 10..100; 0 for c = 100
```

| Confidence | sigma | Mean multiplier | 85th percentile | 95th percentile |
|---|---|---|---|---|
| 100 | 0 | 1.00 | 1.00 | 1.00 |
| 90 | 0.144 | 1.01 | 1.16 | 1.27 |
| 75 | 0.361 | 1.07 | 1.45 | 1.81 |
| 50 | 0.722 | 1.30 | 2.11 | 3.28 |
| 25 | 1.083 | 1.80 | 3.07 | 5.94 |
| 10 | 1.300 | 2.33 | 3.85 | 8.49 |

(Computed here from the formula with the standard normal quantile; not taken from the tool.) The constants are a hand-set heuristic, cited by the README to Erik Bernhardsson's 2019 post on log-normal blow-up. Nothing in the repository calibrates them.

Durations are converted to whole working days, minimum 1:

```
pointsPerDay(team) = velocity / sprintLength / tracks
days(item) = max(1, round(estimate * multiplier / pointsPerDay(team)))
```

Note the modelling choice: adding a track does **not** add capacity, it splits the team's velocity across more parallel lanes, so each lane is slower.

### 5.2 One trial: list scheduling over the blocker graph

```
prepare(items, trialRng):
  drop items in a DONE status category
  link parent/child; link same-type BLOCKS edges (optionally inherit parents' blocks)
  refuse if any cycle
  for each epic: sample days (5.1); also compute days at a fixed quantile (deterministic)

schedule(items):
  depth(i) = detDays(i) + max(depth(j) for j blocked by i, 0)   # memoised longest downstream chain
  for i in items ordered by depth descending:
     place(i)

place(i):
  if i already placed or some blocker of i is unplaced: return   # the last blocker to be placed recurses here
  earliest = max(end(b) for b in blockers(i), 0)
  for each lane of team(i): find the first gap (between placed items, or after the tail)
       that starts at >= earliest and is at least days(i) long
  put i in the lane whose gap starts first; start(i) = that gap's start
  for j in items blocked by i, ordered by depth descending: place(j)
```

Ordering uses the **deterministic** durations (at a fixed 80th percentile in Monte Carlo mode), so the priority order is the same in every trial and only the durations move. That keeps trials comparable and the layout stable.

### 5.3 The Monte Carlo shell

```
run(items, teams, N = 1000, batch = 25):
  first = one trial                        # fixes the rows shown on screen
  if first scheduled nothing: warn "no work to simulate"; stop
  repeat in batches of `batch` trials, yielding to the UI between batches:
     for each trial: for each epic record (start, start + days, days)
                     record plan end = max over epics of (start + days)
     after each batch: sort each epic's arrays; recompute statistics (5.4)
```

The README says 5,000 trials; the code's default is 1,000 (`monte-carlo.js` line 275) and nothing overrides it. Trials are not seeded: the random draw happens inside jStat's sampler, loaded unpinned from a CDN.

A feature flag (`deterministicallySelectIssueTiming`, lines 125-135) replaces the simulation with one pass where every epic takes its p-quantile duration. Its own description warns that this overstates chains and understates parallel work, which is the reason to simulate at all.

### 5.4 Read-out

For a threshold p in 50..90 (55 means "use the mean"):

```
k = min(round(n * p / 100), n - 1);  k' = max(n - 1 - k, 0)
due@p = dueDays[k];  start@(100-p) = startDays[k'];  duration@p = durations[k]
fixed markers: start@10, due@10, due@90, due@95 at index min(round(n * q / 100), n - 1)
latestSafeStart = due@p - duration@p
P(ends after day d) = 1 - (index of first dueDay > d) / n           # tooltip
histogram: count of trials per working-day index                      # bar per day
date(dayIndex) = start date + dayIndex working days (Mon-Fri, UTC)
```

The written-back "adjusted story points" are the analytic p-quantile of the lognormal times the median estimate, not a simulated value.

## 6. Mapping onto Islestone

### 6.1 Roadmap sub-phases

| Islestone piece | What to take from this study | What Islestone writes fresh |
|---|---|---|
| **3.6 throughput forecast** (the prompt's requirement) | The shell only: N trials, sorted outcomes, nearest-rank percentiles shown as dates at 50/85/95, a histogram with "chance it finishes after this date", working-day conversion, a refusal when there is nothing to forecast | The whole sampling model: resample past periods' completed-item counts until the scope's remaining count is consumed; seeded PRNG; the minimum-history refusal; a cap on trial length when sampled periods can all be zero |
| **3.6 estimate forecast** (optional second mode) | The lognormal-around-the-median model (5.1), the confidence line as a starting prior, the list scheduler idea (5.2), plan-level completion as the maximum end over items | Calibration of sigma from Islestone history (log of actual cycle time over estimate per team) instead of the hand-set 1.3 line; explicit flags for defaulted inputs |
| **3.1 scheduling engine** | Nothing directly. A Monte Carlo over 3.1's pure forward pass, with sampled durations, is the estimate mode above; keep one engine and call it N times | Forward and backward pass, float, critical path, calendars and holidays (the tool has none of these) |
| **3.5 workload and capacity** | "Tracks" as a crude parallel-capacity proxy | Real capacity from member hours and time off |
| **7.5 forecast explanation and rescheduling** | The long-pole report (`critical-path-report.js`), latest safe start, "artificially delayed" flags: good facts for a model to explain | The explanation surface; the rule that the model explains numbers and never produces them (principle 4) |
| **3.1 "a change the user confirms"** | `update-epics.js`: a table of current versus proposed dates with changes highlighted, then one save | Writes go through usecases and `logEvent`; an agent's write is a proposal (principle 2, ADR 0003) |

Pseudo-code for the 3.6 throughput mode (Islestone's own design; nothing here comes from the tool):

```
forecastByThroughput({history, remaining, start, periodDays, trials, seed, minItems, minPeriods, calendar}):
  if remaining <= 0: return done
  if history.length < minPeriods or sum(history) < minItems: refuse(INSUFFICIENT_HISTORY, counts)
  rng = seededPrng(seed)                       # recorded in the result
  for t in 1..trials:
     left = remaining; periods = 0
     while left > 0 and periods < cap: left -= history[rng.int(history.length)]; periods += 1
     outcome[t] = periods (or UNBOUNDED at cap)
  sort outcome; take nearest-rank 50, 85, 95
  dates = calendar.addWorkingDays(start, periods * periodDays) for each percentile
  return {dates, histogram, seed, trials, historyWindow, refusals: []}
```

### 6.2 ADRs

| ADR | Bearing |
|---|---|
| 0002 work-item model | `WorkItem.estimate Decimal?` is the median estimate. There is **no confidence column**: estimate mode needs a custom field (2.4) or a new column, which is an ADR 0002 amendment. `WorkItemRelation` type `BLOCKS` is the blocker graph, and ADR 0002 section 6 already refuses cycles at write time; the forecast engine must still refuse them, because it is pure and takes plain data. `stateCategory` `DONE`/`CANCELLED`, `startedAt`, `completedAt`, `cancelledAt` give throughput, cycle time and lead time, none of which the tool uses. ADR 0002 has **no state-transition history**, and a reopen clears `completedAt` (section 3): cumulative flow, and throughput that survives reopens, need an event source (the 2.2 activity log or a new table). Raise this before 3.6. |
| 0005 data sync | Server-authoritative. The tool runs trials in the browser with `setTimeout` batching; Islestone's pure module can run server-side or in a BullMQ job, and the client only renders. |
| 0006 vocabulary | The tool's "Epic" and "Sprint" are banned words (Epic maps to Work item, Milestone or Initiative; Sprint maps to Cycle). "Velocity", "throughput", "confidence" (of an estimate) and "track" (parallel lane) have **no entry** in ADR 0006: add them before the UI ships. |
| 0003 assignee and delegate | The tool writes dates straight to Jira. In Islestone an agent that proposes rescheduled dates writes a proposal; a person approves. |
| 0001 provenance | Record the pin and MIT in `PROVENANCE.md` before first use (H0). |

### 6.3 Hardening gate H3 against the tool's gaps

| H3 check | The tool today | Islestone must |
|---|---|---|
| Same seed gives the same forecast | No seed; RNG inside an unpinned CDN script | Own seeded PRNG; seed in the output |
| Tiny or empty history never reported as a confident date | Missing estimate silently becomes one sprint of velocity; missing confidence becomes 50 % (`createWork` 172-173), flagged only by `isDefaultValue`; only "no epics at all" is refused | Refuse below a stated minimum and say why; count and show defaulted inputs |
| Stable under input reordering | Team rows are sorted with a comparator that compares objects with `>` (`sortByTeamKey`, `monte-carlo.js` 576-578), so order falls back to insertion order; depth ties keep input order | Total order with an id tie-break everywhere |
| Cycles refused | Throws a bare string after enumerating every path without memoisation (`checkCycle` 320-332), exponential on dense graphs | Linear-time cycle check returning a typed refusal |
| Calibration backtest | None; sigma constants are hand-set | Replay history; publish hit rate of the 85 % date |
| Calendars, time zones, DST | Mon-Fri in UTC, no holidays | 3.1's calendar module |

## 7. Defects to avoid copying

1. `getConfidenceDefault` (`schedule-prepare-issues.js` 392-410) reads `val` before it is assigned. The array branch returns `undefined`, and the scalar branch's guard is always false, so the default reader never returns a confidence. The configured JSON-logic reader masks this in normal use.
2. `getParentBlocks` (213-221) uses an undeclared `issue` and an implicit global; it is dead code.
3. Done items are dropped and in-progress items start from their full estimate: no credit for partial progress.
4. Cross-type blocking links are ignored with a `console.log` (280-283), so a story blocking an epic silently does not constrain the plan.
5. `WorkPlans.sheduleWork` has unreachable code after `return` (170-184).
6. Each batch re-sorts every item's full arrays. That is acceptable at 1,000 trials, but integer day counts allow a counting histogram instead.
7. README (5,000 trials) and code (1,000) disagree.

## 8. What Islestone must NOT take

- **No copyleft code exists in this repository**, so there is no licence-driven exclusion. The exclusions are practical and provenance-driven:
- `public/can.js`, `public/dist/*`, `public/json-logic/*`: bundled or vendored third-party code, with licences not stated in the files (the `can.js` bundle carries Dojo Foundation notices). Islestone uses neither CanJS nor JSON Logic.
- jStat: do not add it as a dependency. The npm package declares no licence, which the licence gate would refuse, and the code loads it unpinned from a CDN. A lognormal draw is `exp(mu + sigma * Z)`, and a normal quantile is a short published approximation that Islestone writes itself.
- Bitovi's name, logo and social images: trademarks, not covered by MIT.
- The Jira field readers, the OAuth/OIDC client (`jira-oidc-helpers.js`, `server/server.js`) and the saved-configuration-in-an-issue scheme. The 5.5 importer is written against `jira.js`.
- The hand-set confidence-to-sigma constants as a final answer: they may seed a default prior, labelled uncalibrated, until H3's backtest replaces them.

**Recommendation:** adopt as **"pattern only, no code copied"**. The code is DOM-coupled, mutation-heavy CanJS, so a pure TypeScript module is cheaper to write than to adapt. The ideas listed in 5.1-5.4 are what Islestone reuses.

## 9. Attribution

### 9.1 PROVENANCE.md row (pattern only, the recommended path)

| Component | Source (repository and path) | Commit | Licence | What was taken | Changes |
|---|---|---|---|---|---|
| Forecasting module, estimate mode and forecast read-out (3.6) | `github.com/bitovi/jira-auto-scheduler`: `public/shared/confidence.js`, `public/schedule.js`, `public/schedule-prepare-issues.js`, `public/work-plans.js`, `public/monte-carlo.js`, `public/simulation-data.js` | `39323ed28d7d7e2223853f67a098dd9a23f2773f` | MIT (root `LICENSE`, Copyright (c) 2021 Bitovi; `package.json` says ISC, LICENSE governs) | Pattern only, no code copied. The lognormal-around-the-median duration model with sigma linear in confidence (0 at 100 %, 1.3 at 10 %); list scheduling by longest downstream chain onto per-team lanes; N-trial loop with plan completion as the maximum end; percentile, histogram and cumulative-probability read-out. | Written fresh as a pure, seeded TypeScript module. Throughput mode added (not in the source). Defaulted inputs refused or flagged. Total ordering with id tie-break. Linear-time cycle refusal. 3.1 calendars instead of Mon-Fri UTC. No jStat. |

### 9.2 NOTICE text (only if any code is ever copied or adapted)

MIT requires the copyright and permission notice in "all copies or substantial portions". If any of the files above is copied or translated line by line, `NOTICE` must carry:

```
This product includes software adapted from jira-auto-scheduler
(https://github.com/bitovi/jira-auto-scheduler), commit
39323ed28d7d7e2223853f67a098dd9a23f2773f.

MIT License

Copyright (c) 2021 Bitovi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Under the pattern-only path no NOTICE entry is legally required. The PROVENANCE row is still required by principle 6.

## 10. Open questions for the owner

1. Roadmap 3.6 names this repository as the source for throughput Monte Carlo, but it contains no throughput model. Should the roadmap's "Source" line be reworded (for example "Monte Carlo read-out and estimate mode"), and is estimate mode in scope for 3.6 or deferred to 7.5?
2. Estimate mode needs a per-item confidence. Should it be a custom field (2.4) or an ADR 0002 column?
3. Cumulative flow and reopen-proof throughput need state-transition history, which ADR 0002 does not define. Where should it live?
4. ADR 0006 needs terms for velocity, throughput, estimate confidence and parallel lane.

## Licence check

**CORRECTED** (independent check, 2026-11-18; section 1 edited, no other section touched).

The controlling licence is confirmed. The pinned commit `39323ed28d7d7e2223853f67a098dd9a23f2773f` is still the head of `main` (`git ls-remote`, 2026-11-18). Its root `LICENSE` is unmodified MIT, "Copyright (c) 2021 Bitovi". The copy fetched from `raw.githubusercontent.com` at that commit is byte-identical to the clone's (SHA-256 `c5e2b1d9…0102b`). The file has one commit (`93d5a21`, 2021-04-04) and is the only licence file in the tree. The `package.json` field reads `"ISC"` in all six revisions since `4be3013`. No restricted directory exists.

One fact was corrected:

- **jStat on npm does declare a licence.** The study said `jstat@1.9.6` "has no `license` field". That is literally true but misleading, because the version document carries the legacy `licenses` array `[{"type":"MIT"}]`. The jStat `LICENSE` at the version's `gitHead` (`7c4d63ff`) is MIT-form text, identical to `master`, so this is no longer unpinned evidence.

Two refinements:

- The two Dojo Foundation notices in `can.js` sit on a binary-search fragment the file credits to "lodash 4.6.1". They are not a CanJS notice, and the bundle states no licence of its own.
- `public/dist/production.css` carries a "tailwindcss v3.3.5 | MIT License" banner, which the study did not list.

**For the study's author (not edited here, outside the licence section):** section 8 says jStat's "npm package declares no licence, which the licence gate would refuse". Islestone's `scripts/licence-gate.mjs` reads a legacy `licenses` array as an OR of its entries (its header comment and `declarationFromList`), so it would read `jstat@1.9.6` as MIT. The gate would pass it and report it as relying on a legacy form. The recommendation not to add jStat still stands on the other grounds given there: the CDN load is unpinned, and a lognormal draw is cheap to write. Only that stated reason should be reworded.

Evidence files: `/tmp/claude-0/-home-user/0c23d429-765a-50a1-803a-34c6b03926ac/scratchpad/oss-pins/jira-auto-scheduler-licence-check/` (`LICENSE.raw`, `jstat-1.9.6.json`, `jstat-7c4d63f-LICENSE`, `jstat-master-LICENSE`). Nothing in the clone was installed, built or executed.
