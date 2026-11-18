# svar-gantt study

Studied 2026-11-18 for Islestone roadmap 3.1 (Timeline and critical path), with 2.3 ("Libraries to embed") and 2.5 ("Licence traps": SVAR PRO). Everything below was read from files; nothing was installed, built or run. **Verified** means read in the named file or registry record. **Inference** means reasoning from verified facts. **Unverified** means it could not be checked from here.

## 1. Pinned commits and licence facts

### As given by the workflow

- Repository `github.com/svar-widgets/react-gantt`, commit `24f381a37e1e7175ef690aa3f1079a4bf5ad4004`, licence MIT, restricted directories: none.

### Verified here

| What | Fact |
|---|---|
| `react-gantt` commit | `24f381a37e1e7175ef690aa3f1079a4bf5ad4004`, tag `v2.8.3`, 2026-11-17 09:08 UTC, subject "v2.8.3". Previous tags: `c595a2f` v2.8.2, `efa2181` v2.8.1. |
| `react-gantt` licence | `license.txt` (the only licence file in the repository's 330 tracked files; there is no `LICENSE`): MIT, "Copyright (c) 2025 XB Software Sp. z o.o", standard MIT wording with typographic quotes, no trailing newline, sha256 `fea7a9fb3122f697…`. `raw.githubusercontent.com/svar-widgets/react-gantt/24f381a…/license.txt` returned the byte-identical file (HTTP 200); `…/LICENSE` returns 404. `package.json`: `"name": "@svar-ui/react-gantt"`, `"version": "2.8.3"`, `"license": "MIT"`. No source file carries a licence header or SPDX tag. |
| Where the logic lives | The React repository is only the view layer. The data model, date arithmetic, scales, zoom and summary logic are in `@svar-ui/gantt-store`, whose npm record points to `github.com/svar-widgets/gantt`. |
| `gantt` (store) commit | Cloned separately into its own empty directory (`oss-pins/svar-gantt-store/repo`): HEAD `ba701283bc4f982f758a6b37fd2d63e6324c5424`, 2026-11-08, subject "v2.8.3". Annotated tag `v2.8.3` (object `29c6aa381a91271257d721d74d7482e5e5b26db4`) points at it. |
| `gantt` licences | MIT, same copyright line, in `license.txt`, `packages/store/license.txt`, `packages/provider/license.txt`, `packages/locales/license.txt`, `apps/widget/license.txt`. No other licence file in the tree. The root and the three `packages/*` files are one text (sha256 `7655d7a1a9bc0b78…`, no `====` underline); `apps/widget/license.txt` is byte-identical to react-gantt's. Raw fetch of `svar-widgets/gantt/ba70128…/license.txt` and `…/packages/store/license.txt` matched the clone; `…/LICENSE` is 404. Every `package.json` in the tree declares `MIT`. At v2.8.3 the per-package files were only moved (`store/` → `packages/store/` etc.), not newly added. |
| `.sync` | `react-gantt/.sync` holds `39f2cd635b46293e166f2d5f322091032f601bf3`. **Inference:** the public repositories are synced exports of a private upstream that also holds PRO. |
| npm tarballs (downloaded to `oss-pins/svar-gantt-npm/`, unpacked, read only; a second copy as `oss-pins/svar-gantt/npm-*/pkg.tgz`) | `@svar-ui/react-gantt@2.8.3` and `@svar-ui/gantt-store@2.8.3` each carry `license.txt` (MIT, same copyright), byte-identical to the repositories' files (sha256 `fea7a9fb…` and `7655d7a1…`); so does `@svar-ui/gantt-data-provider@2.8.3` (`7655d7a1…`). The tarballs' sha1 match the registry `dist.shasum` for 2.8.3. The compiled store contains `function isCommunity() { return true; }`. **Neither `dist` file carries a licence banner** (searched for "licen": 0 hits in `react-gantt/dist/index.es.js`). |
| npm release dates | `react-gantt` 2.8.3 published 2026-11-17T09:10Z (one day before this study); 2.8.2 on 2026-10-27; 2.8.0 on 2026-10-07. |
| Runtime dependency licences (npm registry `license` field) | All MIT: `gantt-store`, `gantt-data-provider`, `gantt-locales`, `grid-store`, `lib-dom`, `lib-react`, `lib-state`, `lib-data-provider`, `react-core`, `react-grid`, `react-menu`, `react-editor`, `react-filter`, `react-toolbar`, `react-comments`, `react-tasklist`, `core-locales`, `grid-locales`, `grid-data-provider`, `editor-locales`, `filter-locales`, `comments-locales`, `tasklist-locales`, `filter-store`. `date-fns` 3.6.0: MIT. Only the two SVAR packages' licence *files* were read; the rest are registry fields. |
| Islestone gate | MIT is on `ALLOWED_LICENCES` in `scripts/licence-gate.mjs` (line 93 onward). No SVAR package is in `DENIED_PACKAGES`. No `ee/` folder exists in either SVAR repository. So the core passes the gate with no exemption. |
| Copyleft | **None at the pinned commits**: every licence file in both working trees is MIT. **The histories are not**: see the next row. |
| Licence history (git, read at each change) | **react-gantt:** `license.txt` is **GPL-3.0** at v2.3.1–v2.3.4 (`80ca059` 2025-10-22 … `d442930`), **MIT** from v2.4.3 (`bb81e7a`, 2025-12-22); `whatsnew.md` 2.4.3: "Community license changed from GPL to MIT". The copyright year read 2026 from `3e95c39` (2026-08-24) until v2.7.2 (`08e5990`) set it back to 2025. **gantt:** root `license.txt` GPL-3.0 at v1.2.0 (`67da949`), MIT at v2.0.1 (`2fbc912`, "Copyright (c) 2023 … o.o."), GPL-3.0 again from v2.0.2 (`a54f33a`) to v2.4.2 (`ce094d6`), MIT from v2.4.3 (`d32dd0e`). The Svelte widget (`svelte/license.txt`) followed the root; `store/license.txt` was GPL-3.0 at v1.2.0 and MIT from v2.2.1 (`4532c81`, 2025-09-17). |
| npm licence by version (registry `license` field) | `@svar-ui/react-gantt` **2.3.1–2.3.4: `GPL-3.0`**; 2.4.3–2.8.3: `MIT`. `@svar-ui/gantt-store` 2.2.1–2.8.3: all `MIT` (consistent with `store/license.txt`, not with the repository root, for 2.2.1–2.4.2). **Consequence:** any react-gantt pin below 2.4.3 is GPL-3.0, which is not on Islestone's `ALLOWED_LICENCES`; the gate would refuse it. Pin ≥ 2.4.3 and never cherry-pick code from a pre-2.4.3 commit. |
| Vendor's Next.js demo | `github.com/svar-widgets/react-gantt-demo-nextjs` at `99fc7e1214095e3463bdf2195629dead59dec8cf` (2026-06-29): **no LICENSE file** and no `license` field in `package.json`. All rights reserved by default: read only, never copy. |

### Unverified

- **The PRO edition's licence terms, price and distribution channel.** PRO code is in neither public repository (section 2). The guessed npm names `@svar-ui/react-gantt-pro`, `@svar-ui/gantt-store-pro` and `@svar-ui/react-gantt-trial` all return 404. The vendor site was not read.
- `"productTrial": true` in `react-gantt/package.json`: its meaning is not documented in either repository.
- **The icon font at `https://cdn.svar.dev/fonts/wxi/wx-icons.css`**: the proxy refused the request (403), so its licence is unknown (section 3).
- The six other MIT licence files of the transitive `@svar-ui/*` packages (registry field only).

## 2. Core versus PRO: where the line is, verified

The core is not a smaller product with its own code. It is the same source with the PRO bodies removed and PRO options forced off. Three mechanisms, all in `svar-widgets/gantt` at `ba70128`:

1. **A switch.** `packages/store/src/package.ts` (9 lines): `isCommunity()` returns `true`. It is called in `DataStore.ts`, `tasks.ts`, `index.ts`, `columns.ts`, `layout/panels.ts` and `layout/displayMode.ts`.
2. **Options forced off at init.** `packages/store/src/DataStore.ts` lines 2103–2138: under `isCommunity()`, `init` sets `unscheduledTasks`, `inactiveTasks`, `placeholderRow`, `baselines`, `markers`, `undo`, `schedule` (to `{}`), `criticalPath` (to `null`), `splitTasks`, `summary` (to `{}`), `rollups`, `slack`, `resources`, `assignments`, `calendar`, `calendars`, `groupBy`, `wbs`, `progressLine`, `deadlines`, `sCurve` and `conflicts` to off or empty, whatever the caller passed.
3. **Stub bodies.** `schedule-types.ts` (8 lines) declares `TaskSlackInfo`, `ICalendar`, `CalendarConfig`, `Constraint`, `Conflict`, `InvalidLinkReason` as `any` and `Calendar = null`. `helpers/sCurve.ts`, `helpers/progressLine.ts`, `resourceLoad.ts`, `placeholder.ts` (`createPlaceholderRow`), `tasks.ts` (`setTaskResources`) and `helpers/progress.ts` (`getSegmentProgress`) return empty values. `getLinkValidator()` (DataStore line 2341) returns a validator that accepts every link. `createCalendar` (`index.ts` line 135) returns `null`.

So there is **no scheduling engine in the MIT code at all**: no forward or backward pass, no float, no critical path, no working calendar. This confirms roadmap 2.3 ("plus in-house critical path") and 2.6 ("No credible JavaScript critical-path library exists") for this candidate.

| Feature | Core (MIT, works) | PRO (forced off; code absent) | Source of the fact |
|---|---|---|---|
| Task tree (task, summary, milestone, custom types), expand/collapse, lazy branches | yes | | `GanttDataTree.ts`; readme |
| Dependencies: draw, render, select, delete; all four types and `lag` stored | yes | | `Bars.jsx` 636–672; `DataStore.ts` 819–859 |
| Dependencies moving the successor (auto-scheduling, all 4 types, lag) | no | yes | `schedule: {}` forced; changelog 2.8.0 |
| Link validation (cycles, summary endpoints) | no (accepts all) | yes | `getLinkValidator`; `link-types.spec.ts` |
| Drag move, drag resize (start/end edge), drag progress | yes | | `Bars.jsx` 369–560 |
| Drag a summary carries its children; parent bars follow while dragging | yes | | `tasks.ts` `dragSummaryKids`, `dragSummary` |
| Summary dates derived from children at load when missing | yes | | `normalizeDates.ts` `parseTreeDates` |
| Summary progress roll-up, auto-convert parent to summary, manual summaries | | yes | `summary: {}` forced |
| Zoom: levels, Ctrl/Cmd + wheel, toolbar zoom, scroll anchored to pointer | yes | | `scales.ts`, `helpers/zoom.js`, DataStore 1750–1812 |
| Scales: year…minute, custom units (`registerScaleUnit`, e.g. sprints) | yes | | `time.ts` 377–399 |
| Weekend/holiday **shading** via a `highlightTime(date, unit)` callback | yes (visual only) | | `Chart.jsx` 136; `types/index.d.ts` |
| Working-time calendars (non-linear scale), task and resource calendars | | yes | `calendar(s)` forced off |
| Critical path, slack (float) | | yes | `criticalPath: null`, `slack: false` forced |
| Constraints (6 types), deadlines, conflicts report | | yes | forced off; `constraintTypes.ts` lists the six |
| Baselines, progress line, S-curve | | yes | forced off |
| **Vertical markers (including a "today" line)** | | yes | `markers` forced to `[]` |
| Undo/redo | | yes | `undo: false` forced |
| Unscheduled tasks, inactive tasks, placeholder row, split tasks | | yes | forced off |
| Grouping, WBS codes, rollups, sub-grid panel | | yes | forced off; `columns.ts` 129 |
| Resources, assignments, resource load, histogram | | yes | forced off |
| Export PDF/PNG/Excel, MS Project import/export | | yes | readme; changelog |
| Grid: columns, sort, filter (incl. natural-language query), inline edit, reorder by drag | yes | | readme; `helpers/reorder.js` |
| Editor form, toolbar, context menu, tooltips, hotkeys | yes | | readme |
| Virtualisation of rows, columns and links | yes | | `helpers/area.ts`; DataStore 588–652 |
| Adding tasks by drag from an outside list; `locateTask` | yes | | changelog 2.8.0; `helpers/dnd.js` |
| `RestDataProvider`, real-time `RemoteEvents` | yes | | `packages/provider/src/` |

The React repository also contains MIT-licensed **UI for PRO features** that renders nothing in the core build: `components/resource/ResourceLoad.jsx` (569 lines), `components/conflicts/ConflictReport.jsx` (232), `chart/SCurve.jsx` (59), `chart/Rollups.jsx` (26), `chart/BarSegments.jsx` (47), `editor/Constraint.jsx` (60), `editor/Segments.jsx` (176), `editor/Resources.jsx` (276).

Consequences for Islestone that roadmap 2.3 does not yet say:

- **Critical-path styling cannot be switched on in the core.** `Bars.jsx` (line 800) and `Links.jsx` (line 51) add `wx-critical` only when the `criticalPath` option is set, and the core forces it to `null`. Islestone must show its own engine's critical path through `taskTemplate` (rendered inside each bar, `Bars.jsx` 929–943) for bars. Links have no template: they expose only `data-link-id` on each `<g>`, so critical links need attribute-selector CSS or an overlay. Open question for 3.1.
- **No "today" line and no baselines.** Both are PRO. A today line, and the "before / after" view that roadmap 7.5 (rescheduling proposals) needs, must be built.
- **Holidays are a picture, not a rule.** `highlightTime` only shades cells. Dragging a bar onto a holiday is allowed; the engine and the confirm step must apply the working calendar.

## 3. React 19 and Next.js 16

- **Verified.** Every `@svar-ui` React package declares `peerDependencies: { react: ">=18", react-dom: ">=18" }`. The readme claims "React 19 compatibility" and Next.js support.
- **Verified.** The repository itself develops against React 18: `devDependencies` pin `react ^18.0.0`, `@types/react 18.2.66`. The React repository has no test suite; the store has vitest suites.
- **Verified.** No API removed in React 19 is used: a search of `src/` for `defaultProps`, `propTypes`, `findDOMNode`, `contextTypes`, `ReactDOM.render`, `unmountComponentAtNode`, `UNSAFE_` found nothing. It uses `forwardRef` (two files; still supported in 19) and `flushSync` from `react-dom` (`Layout.jsx` line 18; still in 19).
- **Verified.** Neither the source nor `dist` carries a `'use client'` directive. It must be imported from a client component.
- **Verified.** The vendor's Next.js demo uses `"use client"`, renders nothing until a `mounted` flag is set in an effect, and pins `next 16.1.4`, `react 19.2.3`. Its lockfile resolves `@svar-ui/react-gantt` **2.4.5**, not 2.8.x. **Inference:** React 19 with 2.8.x is claimed, not demonstrated by the vendor's own lockfile. Islestone must prove it with its own rendered test and an E2E test on its React version.
- **Verified.** The theme components (`Willow`, `WillowDark`, `Material`) default to `fonts = true`, which renders `<link rel="preconnect" href="https://cdn.svar.dev">` and `<link rel="stylesheet" href="https://cdn.svar.dev/fonts/wxi/wx-icons.css">` (`react-core@2.6.2` `dist/index.es.js` lines 3010–3035). That is a third-party request from every timeline page: it fails a strict CSP and discloses visits to the vendor. Pass `fonts={false}` and self-host or replace the icons (the font's licence is unverified).
- **Verified.** `date-fns` is pinned exactly at 3.6.0. If Islestone uses date-fns 4, the bundle carries two copies.
- **Verified.** `react-gantt/dist/index.es.js` is 133,145 bytes before minification, plus the store and about fifteen other `@svar-ui` packages. Load it with `next/dynamic` on the timeline route only, so the H1 per-route bundle budget holds.
- Pin choice: 2.8.3 is one day old. It fixes "Store and data provider do not declare their runtime dependencies", which matters under a strict installer. 2.8.2 (2026-10-27) is the conservative pin if the owner wants a release with some field time.

## 4. Files worth studying

SVAR is a library to embed (roadmap 2.3), not a port candidate, so the main use is as a dependency. The files below are where to learn its behaviour, write the adapter, and take ideas for the in-house engine and for any timeline Islestone draws itself (the 3.2 roadmap view). Line counts are `wc -l` at the pinned commits.

### `svar-widgets/react-gantt` at `24f381a`

| Path | Lines | Why |
|---|---|---|
| `src/components/Gantt.jsx` | 386 | Props, the public `api` (`exec`, `intercept`, `on`, `setNext`, `getTask`, `serialize`), and how props feed `DataStore.init`. Every prop not in the list becomes an `on<Action>` handler. |
| `src/components/chart/Bars.jsx` | 1026 | The drag state machine (move, start edge, end edge, progress marker), the commit protocol (lines 369–437), link drawing (lines 636–720), bar class composition (850–890), `taskTemplate` (929–943). |
| `src/components/chart/Chart.jsx` | 377 | Virtualised row and column windows, holiday cells, wheel-zoom hook-up. |
| `src/components/chart/Links.jsx` | 87 | Renders precomputed polylines; `data-link-id`, `wx-critical` only under `criticalPath`. |
| `src/helpers/zoom.js` | 43 | Ctrl/Cmd + wheel zoom with a rate-limited exponential factor and one `requestAnimationFrame` per burst. |
| `src/helpers/reorder.js` | 289 | Grid row drag to `move-task` (before, after, child). |
| `src/components/grid/Grid.jsx` | 745 | Grid wiring, inline editors. |
| `src/helpers/dnd.js` | 33 | `locateTask` for drag-in from an outside list. |
| `types/index.d.ts` | 171 | Public types; re-exports the store's types. |
| `src/components/Layout.jsx` | 294 | Grid/chart split, resizer, `flushSync` use. |

### `svar-widgets/gantt` at `ba70128`, `packages/store/src/`

| Path | Lines | Why |
|---|---|---|
| `DataStore.ts` | 2851 | The reactive store. Regions: link geometry and sort ~520–586; link spatial index 588–611; link culling 613–652; `delete/update/add-link` 819–859; `move-task` 861–1072; `drag-task` 1074–1143; `update-task` 1145–1334; `zoom-scale` 1750–1812; community switch-off 2103–2138; `changeScale` / `shouldExpandScale` 2466–2496. |
| `types.ts` | 870 | The data model (section 5). |
| `time.ts` | 439 | Unit arithmetic: fractional differences between units, the `smallerCount` table, calendar-aware adders and differs, `registerScaleUnit`. |
| `scales.ts` | 453 | `calcScales` (auto range), `resetScales` (scale rows and cells), `normalizeZoom` (zoom levels), `zoomScale`, `expandScale`, `calcScaleCellDate` (pixel to date). |
| `tasks.ts` | 325 | Bar geometry, summary bar size, `setSummaryDates` roll-up, `dragSummary`. |
| `normalizeDates.ts` | 161 | Start/end/duration normalisation; post-order summary dating. |
| `links.ts` | 189 | Orthogonal link routing with arrowheads. |
| `inclusiveEnd.ts` | 115 | Exclusive stored end to inclusive displayed end, and back. |
| `GanttDataTree.ts` | 202 | Tree with a lazily rebuilt per-branch index map; `getSummaryId`. |
| `eventSource.ts` | 37 | Which actions are "records" (remote, undo, redo: write as is) and which are "children" of another action. |
| `helpers/area.ts` | 22 | Visible-window calculation. |
| `package.ts`, `schedule-types.ts` | 9, 8 | The PRO boundary (section 2). |

`packages/provider/src/`: `RestDataProvider.ts` (330), `RemoteEvents.ts` (350), `EventStream.ts` (132). Read for the action-to-request mapping and the echo-suppression idea; Islestone should not use them (section 7).

### PRO behaviour, described by MIT test files

The store's tests for PRO features are published under MIT in the public repository, although the code they test is not. They are a useful **behaviour reference** for Islestone's own engine: `packages/store/test/link-types.spec.ts` (422), `constraints.spec.ts` (1282), `calendars.spec.ts` (2269), `schedulingFlags.spec.ts` (470), `datastore.spec.ts` (5211; critical path and slack at 4082–~4880), `summaries.spec.ts` (1119), `inclusiveEnd.spec.ts` (706), `links.spec.ts` (310), `zoom.spec.ts` (257), `scales.spec.ts` (197), `time.spec.ts` (189), fixtures in `test/stubs/data.ts` (1243, including the `"critical"` set). They fail against the core build by construction (`schedule` is forced off). Recommendation: write Islestone's own vectors from the facts in section 6.M and record "pattern only, no code copied"; if a vector is translated, it is an adaptation of MIT code and needs a NOTICE entry.

## 5. Data model (client-side; there are no tables)

SVAR has no database schema. Its model is the props it takes and the derived state it keeps. Transcribed from `types.ts`:

```
Task            id: TID (string|number)   parent: TID (0 = root)   data?: Task[] (children)
                text, details: string     type: "task" | "summary" | "milestone" | custom
                start: Date               end: Date (EXCLUSIVE)    duration: number (in durationUnit)
                progress: 0..100          open, lazy: boolean      [key]: any (custom fields)
  PRO-only      base_start/base_end/base_duration, deadline, rollup, calendar, unscheduled,
                manual, inactive, segments[], constraint { type: snet|snlt|fnet|fnlt|mso|mfo, date }
  derived       $x $y $w $h (px), $level, $skip, $reorder, $wbs; PRO: critical, slack.totalSlack,
                $x_base.., $x_slack.., $x_deadline, $overdue

Link            id, type: "e2s" | "s2s" | "e2e" | "s2e", source: TID, target: TID, lag: number
                ("e2s" = end-to-start = finish-to-start; source end -> target start)
  derived       $p (polyline points), $pl (length), $x1 $x2 $y1 $y2 (bbox); PRO: critical

Resource (PRO)  id, name, avatar, color, role, calendar, parent, data[]
Assignment(PRO) id, task -> Task.id, resource -> Resource.id, units

Config          scales[{unit, step, format, css}], zoom {level, levels[{minCellWidth, maxCellWidth, scales}]},
                lengthUnit (minute..year; bar snapping), durationUnit ("day" | "hour"),
                cellWidth, cellHeight, scaleHeight, start, end, autoScale, readonly, inclusiveEnd,
                highlightTime(date, unit) -> css, columns, taskTypes, displayMode, gridWidth

Relations       Task.parent -> Task (single tree)   Link.source/target -> Task
                Assignment.task -> Task, Assignment.resource -> Resource (PRO)
```

`inclusiveEnd` (core since 2.8.0, day unit only) changes display and editing, not storage. The test names in `inclusiveEnd.spec.ts` say so: "end-like dates are shown a day earlier, duration is kept" and "the edited end-like date is stored a day later".

## 6. Algorithms (prose and pseudo-code; no code copied)

### A. The start / end / duration triangle (`normalizeDates.ts`, `calcDates`)

```
if type == milestone: duration = 0; end = none
elif start present:
    if duration missing:  if end present: duration = diff(end, start) else: end = start + 1 unit; duration = 1
    else:                 end = start + duration          (duration wins over a stale end)
on edit (prepareEditTask): editing duration or start clears end; editing end clears duration;
                           an end not after start becomes start + 1 unit
```

### B. Summary dates (`normalizeDates.ts` `parseTreeDates`; `tasks.ts` `setSummaryDates`)

Post-order walk. A summary keeps supplied dates; missing ones become min(child start) and max(child end, or child start for a milestone), recursing through non-summary parents. Summaries are not scheduled; they are rolled up from their leaves.

### C. Geometry (`tasks.ts` `calculateTaskDimensions`)

```
x = round(diff(start, scaleStart, lengthUnit) * cellWidth)       # fractional units allowed
w = round(diff(end, start, lengthUnit, unitSize=true) * cellWidth)
y = cellHeight * rowIndex + padding
milestone: a square of side h centred on start
a bar wholly outside the scale is clamped to the nearer edge with zero width and skipped
```

`diff` handles mixed units: a span across several months is whole units plus the fractional head and tail (`time.ts` `getLengthUnitDiff`), using a table of how many smaller units each unit holds (`smallerCount`; months and quarters ask the date).

### D. Drag and commit (`Bars.jsx` 369–560; `DataStore.ts` `drag-task`, `update-task`)

```
pointerdown on bar:  mode = start-edge | end-edge | move | progress-marker
pointermove:         ignore |dx| < 20px until the drag has started; refuse a width below one length unit
                     or leaving the chart; exec drag-task {id, left, width, inProgress: true}
                     -> store moves pixels only ($x/$w); summary kids shift by dx; ancestors' bars re-span
pointerup:           diff = round(dx / lengthUnitWidth)
                     if diff == 0: exec drag-task to restore the original left/width
                     else: exec update-task {id, diff, task: move ? {start, end} : {[edge]: date}}
update-task:         start += diff units; on move keep duration; on resize recompute duration
                     (minimum 1); a summary with children moves every child by the same shift;
                     then re-derive the parent summary's dates
```

Dates change only at drop, as an integer number of length units. That is the hook for roadmap 3.1's "dragging a bar creates a change the user confirms" (section 7).

### E. Drawing a dependency (`Bars.jsx` 636–720)

Click a circle at one end of bar A, then a circle at one end of bar B. The type is `["e2s","s2s","e2e","s2e"][(fromStart ? 1 : 0) + (toStart ? 0 : 2)]`. The UI refuses a link to the same task and an exact duplicate (same target and type). The core validator accepts everything else, cycles included.

### F. Link routing (`links.ts`)

```
sx = source anchor (start or end edge), ex = target anchor, y = bar middles
stub 20px out of each anchor (direction by which edge)
three segments: horizontal stub, vertical, horizontal, vertical, horizontal into the target,
choosing vertical-first or horizontal-first by whether the stubs overlap; an arrowhead of 5x3px
also returns the bounding box and the path length (used to draw long links under short ones)
```

### G. Link culling (`DataStore.ts` 588–652)

A uniform grid of 2048 px cells. Each link is put in every cell its bounding box touches, keyed `cy * 65536 + cx`. Each scroll collects the links in the cells the viewport touches (a set when there are several), then filters by exact bounding box. Rows and columns are windowed separately (`helpers/area.ts`: first and last visible index with one extra cell either side).

### H. Zoom (`scales.ts` `normalizeZoom`, `zoomScale`; `DataStore.ts` 1750–1812; `helpers/zoom.js`)

```
levels: one per unit present (year, quarter, month, week, day, hour); the configured scales are the
        level of their smallest unit; other levels get as many rows as configured, using the units above
wheel (Ctrl/Cmd only): factor = exp(clamp(-deltaY * s, -0.003*dt, +0.003*dt)), s = 0.004 touchpad / 0.01 mouse
width = cellWidth * (1 + dir * ratio)
if width outside this level's [minCellWidth (50), maxCellWidth (300)]: switch level;
    new cellWidth = old * (units per new cell), clamped to the new level's bounds
scroll so the date under the pointer stays under the pointer
```

### I. Auto range and snapping (`scales.ts`)

The chart spans the earliest start minus one smallest unit to the latest end plus one; with no tasks, 30 units around today. A pixel becomes a date by whole smallest units, then the nearest length unit inside the cell (`calcScaleCellDate`).

### J. Inclusive end (`inclusiveEnd.ts`)

Shown end = the last working day before the stored exclusive end, never before start. Edited end = stored a day later. Finish-side constraints convert the same way; start-side ones and milestones do not.

### K. Action pipeline (`Gantt.jsx`, `eventSource.ts`)

Every change is a named action passed along a chain: the store, then any `setNext` handlers (a data provider), then the React `on<Action>` props. `api.intercept(action, fn)` runs before the store, and returning `false` stops the action (the vendor's demo `GanttPreventActions.jsx` uses it on `drag-task`). An action whose `eventSource` is `remote`, `undo` or `redo` is a "record": written as it arrives, with no derived work, no history and no provider call.

### L. Real-time (`provider/src/RemoteEvents.ts`)

Each client has a random id sent as `X-Client-Id`, so the server can skip echoing a client's own change. Incoming messages (`{type, action, id, data}`) are applied as `remote` records.

### M. What Islestone must build: the scheduling engine (roadmap 3.1)

Not in SVAR core. Standard critical path method, written as a pure module (plain data in, plain data out), working in **working-day ordinals** rather than timestamps so daylight-saving changes cannot move a date (H3):

```
input   items[{id, durationDays >= 0, earliestStart?}], edges[{from, to, type, lagDays}],
        calendar{workingWeekdays, holidays[]}, projectStart, projectEnd?
0  convert each date to its working-day ordinal; ends are exclusive in ordinals
1  topological sort (Kahn) of the item-level graph; leftover nodes -> return {error: CYCLE, nodes}
2  forward, in topological order:
     ES[i] = max(ord(projectStart), earliestStart[i], max over predecessors p of bound(p, i))
       FS: EF[p] + lag    SS: ES[p] + lag    FF: EF[p] + lag - dur[i]    SF: ES[p] + lag - dur[i]
     EF[i] = ES[i] + dur[i]
3  finish = projectEnd ? ord(projectEnd) : max EF
4  backward, in reverse order:
     LF[i] = min(finish, min over successors s of:
       FS: LS[s] - lag    SS: LS[s] - lag + dur[i]    FF: LF[s] - lag    SF: LF[s] - lag + dur[i])
     LS[i] = LF[i] - dur[i]
5  totalFloat = LS - ES; freeFloat = min over successors of (that successor's bound slack)
6  critical item: totalFloat <= 0; critical edge: both ends critical and the edge's bound is tight
7  summaries are not nodes: roll them up from leaves afterwards (algorithm B)
8  convert ordinals back to dates; return results sorted by id, so output does not depend on input order
```

Facts from SVAR's PRO tests that are worth matching or deciding against (behaviour only):

- With exclusive ends, an e2s successor starts on the predecessor's end date (A: Apr 10 for 5 days ends Apr 15; B starts Apr 15). With Islestone's inclusive `dueDate` that means "next working day after the due date". (`link-types.spec.ts`, "e2s puts the successor after the predecessor's end".)
- A cycle is judged at **task level**, whatever the link types: `A s2s B` plus `B e2e A` is refused although the start/finish event graph has no cycle ("s2s and e2e between the same pair is a cycle"). ADR 0002 section 6 already refuses at item level, so this agrees.
- A link off a summary's start or into a summary's end is dropped with reason `summary-endpoint`; a link into a summary's start applies to its leaves; a summary's derived end can drive a successor.
- Float vector, checked by hand against step 2–5 above: A 2 days, B 3 days, C 15 days, all starting together, `A s2s B`, no project end: total float A = 12, B = 12, C = 0 (`link-types.spec.ts` lines 404–420, "the critical path runs through an s2s link").
- PRO offers `criticalPath: { type: "strict" | "flexible" }`. The difference is not documented in the code read. **Unverified**: do not copy the distinction without a definition.

## 7. How this maps onto Islestone

| Roadmap / ADR | What to do with SVAR core |
|---|---|
| **0.3 / H0** (licence gate, provenance) | Passes as is: all MIT, no `ee/`. Ordinary npm dependencies are not listed in `PROVENANCE.md` (its own rule), but the browser bundle is a distributed copy and `dist` has no licence banner, so the shipped third-party notices must carry SVAR's MIT text (section 9). If PRO is ever bought, it will need an exemption with an ADR, which the gate enforces automatically if PRO's package declares a non-MIT licence (unverified). |
| **ADR 0006** (vocabulary) | The layout is **Timeline** (`ViewLayout.Timeline`). "Gantt" is on the avoid list except as "the timeline layout's chart", so UI copy and Islestone's own module names say Timeline; only the import says Gantt. |
| **1.2** (shared UI, tokens) | Theme by mapping SVAR's `--wx-*` CSS variables to Islestone tokens for light and dark; use `WillowDark` or a token theme for dark. `fonts={false}` (section 3). |
| **H1** (bundle budget, CSP, axe) | `next/dynamic` on the timeline route only; no `cdn.svar.dev` request; run axe on the timeline. Keyboard support for moving bars is not established by this study (the readme lists "hotkeys for common actions"; the store's `hotkey` handler covers keys such as arrow-down and backspace) — check before H2's keyboard requirement. |
| **ADR 0002 §2** (parent chain) | `WorkItem.parentId` → `task.parent`. An item with children is shown as `type: "summary"`; its dates come from the engine's roll-up, passed in, so the widget never derives them itself. Milestone rows come from `Milestone` (`targetDate`) as `type: "milestone"`. For the 3.2 roadmap view, projects and initiatives are summary rows, read-only. |
| **ADR 0002 §5** (`sortKey`) | Pass rows ordered by `(sortKey, id)`. Intercept `move-task` from grid reordering and send the server "after X, before Y" by id; the server computes the key. |
| **ADR 0002 §6** (relations) | Only `BLOCKS` is a dependency; show it as `e2s` with `lag: 0`. `RELATES` and `DUPLICATES` are not links. Intercept `add-link`: refuse every type but `e2s` in the UI, then call the relation usecase, which runs the locked cycle check; show the link only after the server accepts. The core validator accepts cycles, so the server is the only check. Whether Islestone ever adds SS/FF/SF and lag is an owner question; the engine in 6.M supports them. |
| **ADR 0002 dates** (`startDate`, `dueDate` are `@db.Date`) | Adapter: `start = startDate`, `end = dueDate + 1 day` (exclusive), `inclusiveEnd: true` so people see the due date. Items with no `startDate` cannot be shown (unscheduled tasks are PRO): list them beside the chart and let people drag them in (core since 2.8.0). Build `Date` values at local midnight from the date string for display only; the engine works in ordinals. |
| **ADR 0002 §9 / ADR 0005** (version, 409, server-authoritative) | **3.1's "a change the user confirms"**: `api.intercept("update-task", ...)` returns `false` for a user drag, opens a confirm dialog showing old and new dates (and the engine's knock-on effects), and on confirm calls the usecase with the item's version. On cancel or on a 409, reset the widget by passing a fresh `tasks` array. **To verify in a rendered test:** whether a blocked `update-task` leaves the bar drawn at the dragged position until the reset (the drag mutates `$x` before the commit; `Bars.jsx` sends a restoring `drag-task` only when `diff == 0`). Undo is PRO, so there is no built-in revert. |
| **ADR 0003** (agents propose) | An agent's schedule change (roadmap 7.5) is a proposal, never an `exec` on the widget. Showing a proposal's effect needs a before/after view that core baselines cannot give (PRO): render proposed dates through `taskTemplate` or a second, read-only instance. |
| **4.3** (live updates, ids and versions only) | Do not use `RemoteEvents` or `RestDataProvider`: they carry full payloads and assume their own REST routes (`tasks/:id`, `links/:id`). On a message, refetch the item through the normal authorised API, then `exec("update-task", {id, task, eventSource: "remote"})` so it is written as a record with no provider call. Keep the client-id echo suppression idea. |
| **3.1** (engine) | In-house, pure (6.M). The widget is display and input only. Show critical items through `taskTemplate`; critical links need CSS on `data-link-id` or an overlay (section 2). Working calendars: shade with `highlightTime`, enforce in the engine. |
| **3.3** (calendar) | The same holiday data feeds `highlightTime` and the engine. |
| **3.5** (workload) | Resource load and histogram are PRO. Build the workload view on Islestone's own chart primitives. |
| **3.6** (analytics) | S-curve and progress line are PRO. Burn-up and cumulative flow are Islestone's own (visx). |
| **H3** | SVAR claims a 10,000-task demo; Islestone must measure its own 5,000-item project against its budget. The engine's property tests (cycles refused, order-independent output, DST) are Islestone's; SVAR's PRO tests are a source of ideas for cases. |

## 8. What Islestone must NOT take

- **No copyleft code exists in either repository**; nothing is excluded on that ground.
- **SVAR PRO** (commercial; not in the public repositories): do not install a trial build or a PRO package without an ADR and a licence exemption. Do not try to re-enable PRO options by patching `isCommunity()`: the code behind them is not there, and it would only produce empty stubs.
- **The vendor's Next.js demo** (`react-gantt-demo-nextjs`, no licence): read only.
- **The `cdn.svar.dev` icon font**: licence unknown; do not load it from the CDN and do not vendor it until its licence is read.
- **inflect-compliance's `src/components/ui/charts/gantt-chart.tsx`** (450 lines) and `calendar/_components/GanttTimeline.tsx` (286), named in roadmap 3.1's source line: BUSL-1.1 from Islestone's own licensor. ADR 0001 D1 (Accepted, 2026-11-18) allows copying them, with a `PROVENANCE.md` row per copied file.
- SVAR's "AI tools for coding agents" (MCP server, skills) mentioned in the readme were not examined and are not part of this pin.

## 9. Attribution Islestone would carry

As an npm dependency (the expected case), the MIT notice must travel with the bundled code. Neither `dist` file has a banner, so a minifier has nothing to keep. Add SVAR to the shipped third-party notices page, generated from `node_modules` at build:

```
@svar-ui/react-gantt, @svar-ui/gantt-store, @svar-ui/gantt-data-provider, @svar-ui/gantt-locales
and the other @svar-ui packages they depend on — MIT License

Copyright (c) 2025 XB Software Sp. z o.o

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

(The licence files use typographic quotation marks around "Software" and "AS IS"; reproduce them as in the file.)

If Islestone **adapts** any SVAR code into its own repository (for example the link router in `links.ts`, the unit arithmetic in `time.ts`, or a translated test vector), add:

- a `NOTICE` entry: component, source `github.com/svar-widgets/gantt` path at `ba701283bc4f982f758a6b37fd2d63e6324c5424` (or `github.com/svar-widgets/react-gantt` at `24f381a37e1e7175ef690aa3f1079a4bf5ad4004`), the copyright line above and the full MIT text;
- a `PROVENANCE.md` row under Adopted: source path, that commit, MIT (read from `license.txt`), what was adapted, what changed.

If Islestone only learns from it (the expected case for the engine), the `PROVENANCE.md` row says "pattern only, no code copied".

## Licence check

**CORRECTED** (independent check, 2026-11-18; files read only, nothing installed or run; evidence saved in `oss-pins/svar-gantt-licence-check/`).

- **Confirmed at the pinned commits.** `svar-widgets/react-gantt` @ `24f381a37e1e7175ef690aa3f1079a4bf5ad4004` (tag v2.8.3) and `svar-widgets/gantt` @ `ba701283bc4f982f758a6b37fd2d63e6324c5424` (tag v2.8.3) are MIT only, "Copyright (c) 2025 XB Software Sp. z o.o". Every licence file, every `package.json` `license` field, the raw.githubusercontent.com copies of `license.txt` at both commits, and the `license.txt` in the 2.8.3 npm tarballs agree byte for byte. No `ee/` folder, no SPDX or licence headers in source, no other licence file. `isCommunity()` returns `true` in the published store. MIT is on Islestone's `ALLOWED_LICENCES`; no SVAR package is deny-listed.
- **The licence file is `license.txt`, not `LICENSE`.** `https://raw.githubusercontent.com/svar-widgets/react-gantt/24f381a…/LICENSE` returns 404 (the same for `gantt`); `…/license.txt` returns 200 and matches the clone (sha256 `fea7a9fb3122f697…`). Any provenance record or automated re-check must name `license.txt`.
- **Corrected: "no copyleft" holds only at these commits.** Both repositories were GPL-3.0 before v2.4.3 (2025-12-22): react-gantt at v2.3.1–v2.3.4, gantt's root and Svelte widget at v1.2.0 and v2.0.2–v2.4.2 (briefly MIT at v2.0.1). npm `@svar-ui/react-gantt` 2.3.1–2.3.4 declare `GPL-3.0`. `@svar-ui/gantt-store` declared MIT throughout its npm history (2.2.1 on), matching its own `store/license.txt`. So: pin react-gantt ≥ 2.4.3 (2.8.3 or 2.8.2 are both MIT), and never copy code from a pre-2.4.3 commit of either repository. Section 1 now says this; section 8's first bullet ("No copyleft code exists in either repository") should be read as "at the pinned commits" (left unedited: this check edits section 1 only).
- **Not re-verified here:** the licence *files* of the other transitive `@svar-ui/*` packages (registry and lockfile fields all say MIT; `date-fns` 3.6.0 registry field MIT, re-read); PRO's terms; the `cdn.svar.dev` icon font's licence; the meaning of `"productTrial": true`.
