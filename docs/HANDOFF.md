# Handoff — 2026-11-18 (paused for usage quota)

State of the roadmap work when it paused, the owner decisions taken so far, and the next
steps in order. Read this first, then `CLAUDE.md`, `docs/ROADMAP.md` and `docs/adr/`.
Delete this file when everything under "Next steps" is done.

## Owner decisions, 2026-11-18

Given in the working session by the repository owner. The ADRs, the roadmap and the
porting maps now record them (next step 2); the last column says where.

| # | Decision | Owner's words | Recorded in |
|---|---|---|---|
| 1 | Code may be copied from inflect-compliance. Record every copied file in `PROVENANCE.md`. | "inflect compliance is my software, it's in the same Organization- you can copy" | ADR 0001 D1 |
| 2 | The canvas stays on tldraw 3.x with the watermark visible, in commercial production. | "we can use the 3.x in commercial production with the watermark, it's open sourced" | ADR 0001 D3 |
| 3 | Islestone is licensed BUSL-1.1, like inflect-compliance. | "Make it BUSL as well" | ADR 0001 D2 |
| 4 | The Dub-derived UI (see below) is copied as it is, and the licence risk is accepted. | Chose "Copy as is, accept risk" when asked | ADR 0001 D4 |
| 5 | Islestone's Licensor is Inflect Ltd., as in `LICENSE`. | Chose "Inflect Ltd." | ADR 0001 D2 |
| 6 | The Additional Use Grant's competing products are project management, work management, compliance, governance, risk and audit management, as in `LICENSE`. | Chose "PM + compliance" | ADR 0001 D2 |
| 7 | Public sign-up at `/api/auth/register` sits behind a switch: off by default in production, on in development, and an operator opens it without a code change. | Chose "Behind a switch" | ADR 0006 |
| 8 | The standard role is called **Member**. Roles: Owner, Admin, Member, Viewer, Guest. | Chose "Member" | ADR 0006 |
| 9 | Roles rank Owner > Admin > Member > Viewer > Guest, by breadth of access. A user whose role cannot be resolved falls back to Viewer, never Guest. | Chose "Owner>Admin>Member>Viewer>Guest" | ADR 0006 |
| 10 | On resume, finish Phase 0 + 1.1 first, then the steps below in order. | Chose "Finish Phase 0 + 1.1" | This file |
| 11 | sharp stays in production for image optimisation; its 14 libvips/sharp packages are exempted, each pinned to the version read. The 1.8 image carries the LGPL notice and leaves the library replaceable. | "Keep, exempt them" | ADR 0007 E1a |
| 12 | The rest of ADR 0007 as recommended: 0BSD joins the allowlist and the `tslib` exemption goes (E2b); `caniuse-lite` is exempted by name, bound to CC-BY-4.0 (E3a); no other licence is added until a dependency needs one (E4). ADR 0007 is Accepted. | "ADR 0007 as proposed" | ADR 0007 |
| 13 | A session someone other than the assignee starts on an item runs at once, within the starter's permissions; every write is a proposal routed to the assignee, who is notified and can end the session. | "Run now, assignee notified" | ADR 0003, open question 8 |
| 14 | No rung cap at `PROPOSE`: from Phase 6 a workspace owner may raise an agent's autonomy rung, within that agent's grants, as roadmap principle 2 allows. This goes against the ADR's recommendation. | "Owners may raise rungs" | ADR 0003, open question 9 |
| 15 | A session started by someone other than the work item's assignee never writes directly, whatever the rung: even where a workspace owner raised a tool to `AUTOMATIC`, its writes go to the assignee as proposals. Decision 13 wins over decision 14 for such sessions; sessions the assignee started follow the rung. | "Proposals to assignee" | ADR 0003, open question 10 (sections 4 and 9) |
| 16 | Due-date reminders land in sub-phase 2.2 with the work-item engine, not in 2.7. | "In 2.2" | `docs/ROADMAP.md` 2.2; porting maps `1.6.md` and `2.1-2.2.md` |
| 17 | Islestone's agents have no risk tier: every agent is governed by its grants and its autonomy rung alone. inflect-compliance's tier and what it drives (autonomy cap, policy-card defaults, approval count, readiness checks, re-assessment) are not ported. | "Drop it" | ADR 0003 section 4; porting maps `6.1.md` (section G, which names each replacement) and `6.2.md` |
| 18 | Automation rules get an action that starts an agent run, added in Phase 6: 5.1 ships without it, and 6.3 adds it once the agent engine and its kill switch exist. | "Add it in Phase 6" | `docs/ROADMAP.md` 5.1 and 6.3; porting map `5.1.md`, open decision 7 |

`LICENSE`'s Change Date, 2030-11-18, follows the BUSL four-year rule from today; it was
not asked separately.

Decisions 7 to 9 are in ADR 0006 (vocabulary), and reach `src/lib/permissions.ts` and
the register route when 1.4 is ported. The 1.3 and 1.4 maps (`docs/porting/maps/`) now
say `MEMBER`, the decided role order, the Viewer fallback and the sign-up switch.

Decisions 13 and 14 left one question between them, recorded as ADR 0003 open question
10: when a tool has been raised to `AUTOMATIC`, does a session a non-assignee started
still send that tool's writes to the assignee as proposals? Decision 15 answers it: yes,
such a session's writes go to the assignee as proposals at any rung.

Map housekeeping: `1.5.md` has a "Handoff to 1.6" section, listing what 1.5 already
places in `metrics.ts`, `tracing.ts`, `edge-logger.ts` and `instrumentation.ts`. Copy it
into `1.6.md` before porting 1.6.

## Finding: Dub (AGPL-3.0) and Nucleo in inflect's UI

`docs/porting/licence/dub-nucleo-finding.md` has the measurement (script:
`docs/porting/licence/dub-overlap.py`). In short, 368 of inflect's 597 UI files share at
least half their text with Dub's `packages/ui`/`packages/utils`, which are AGPL-3.0. That
count includes 270 Nucleo icons whose notice forbids use outside the product they shipped
with. The engines (tasks, automation, agentic, MCP, canvas) show no overlap. The owner
accepted the risk (decision 4), and ADR 0001 D4 records it. `NOTICE` names Dub and Nucleo
in the change that lands `packages/ui` (next step 3); it says so already.

## Branches

- `main` was created at `449fb38` (the roadmap only), on the owner's go-ahead, and exists on the remote.
- Draft PR #1 (https://github.com/RodnaPamet/islestone/pull/1) merges
  `claude/great-planck-57ljb4` into `main`, so CI runs. `ci.yml` runs only on pull
  requests and on pushes to `main`. PR #1's first completed CI run was green, on
  `3ffb78a` (an earlier run, on `6f57a59`, was cancelled by the next push).
- The owner sets `main` as the default branch and protects it, requiring a pull request
  and the CI checks.
- Merge PR #1 only when its CI is green.

## What is on the branch

`claude/great-planck-57ljb4`:

- `449fb38` — the roadmap.
- `0bf9582` — Phase 0 + 1.1 skeleton, checkpointed during its review loop: app skeleton,
  env modules, licence gate, CI, ADRs 0001–0006 as drafts.
- `c7d1123` adds:
  - `LICENSE` and `LICENSING.md` (BUSL-1.1);
  - the shared-UI drift tooling (`scripts/ui-drift.mjs` with `verify`, `audit`, `compare`
    and `pin`, plus `tests/unit/ui-drift.test.mjs`, run with `npm run test:scripts`)
    and `docs/porting/shared-ui.md`;
  - the porting maps (`docs/porting/maps/`), the open-source studies (`docs/porting/oss/`)
    and the Dub finding (`docs/porting/licence/`).
- Later commits carry the rest of the Phase 0 + 1.1 work (`3ffb78a` had the first
  completed CI run, green), refresh the porting maps, and record the owner decisions
  (next step 2).

## What is not on the branch

- **`packages/ui` (the 397-file `@inflect/ui` copy).** Recreate it exactly with:

      node scripts/ui-drift.mjs pin /path/to/inflect-compliance --ref 5528464fc54a8681956f3b9ce23ca9c075f0420e

  This was checked: it reproduces the held copy, `UPSTREAM.json` included. Until then the
  last test in `ui-drift.test.mjs`, which checks the real `packages/ui`, is skipped; the
  skip asserts that nothing in the repository expects the package yet (no git-listed file
  under `packages/ui`, no lockfile entry for it).
- **Porting-map verification still in progress at pause time.** The maps on the branch are
  the latest saved versions, and some were still being re-verified.

## Rules learned from the licence re-reads (H0)

Full evidence is in `docs/porting/oss/<project>.md`, section "Licence check". `PROVENANCE.md` carries each commit and licence-boundary rule in its port-candidates table, and its wording governs; the rules below are short forms. Every candidate is still UNPINNED for use: the commit is the one its licence was read at.

| Project | Licence read at | Licence | Rule |
|---|---|---|---|
| Kaneo | `fb890b4` | MIT | None on licence grounds. `packages/importers/src/plane/*` is for structure only until audited; no use of the Kaneo name or marks |
| Paperclip | `8285a81` | MIT | Take nothing from a revision that lacks `63afce369` (the LICENSE merge) as an ancestor. |
| Teable | `bd8cfc0` | `packages/` MIT since `9c77957af`; apps and plugins AGPL-3.0 | `packages/` only |
| Cal.diy | `ae027bb7` | MIT since `ab21c7f805` (AGPL before) | Only the 63 paths the study names, none of them formerly `ee/` |
| Paca | `5913718` | Apache-2.0 | Not `apps/web/public/provider-logos/`, the bundled skills content or `apps/web/src/components/ui/`; ship the Apache-2.0 text, mark modified files, re-check for a `NOTICE` at every re-pin |
| circle | `b0ba7dd` | MIT | None on licence grounds. Vendored code under other holders needs its own notice; not `components/common/settings/integration-logos.tsx` or the paid BaseUI variant |
| SVAR Gantt | `24f381a` / `ba70128` (v2.8.3) | MIT from v2.4.3; GPL-3.0 before | Pin 2.4.3 or later; never copy from earlier commits |
| jira-auto-scheduler | `39323ed` | MIT | None on licence grounds. Not the vendored `public/can.js`, `public/json-logic/` or `public/dist/` files, nor Bitovi's name and images; the study recommends pattern only |

## Next steps, in order

1. **Finish Phase 0 + 1.1.** Done on the branch: the skeleton is there, and PR #1's first
   completed CI run, on `3ffb78a`, was green. Roadmap 0.2's "Done when: five ADRs merged"
   still waits: PR #1 is a draft, and ADRs 0002 to 0006 await the owner's sign-off.
2. **Record the owner decisions.** Done. What landed:
   - ADR 0001 is Accepted. It records D1 (copying allowed), D2 (BUSL-1.1, licensor
     Inflect Ltd.), D3 (tldraw 3.x with the watermark) and a new D4 (Dub/Nucleo taken as
     is, risk accepted, with the finding's numbers). Its interim "pattern only" rule is
     replaced by the copy rule: copy, record each file in `PROVENANCE.md`, keep the BUSL
     and other licence notices.
   - ADR 0007 is Accepted (decisions 11 and 12). ADR 0003 records decisions 13 and 14 in
     place; ADR 0006 records decisions 7 to 9. Both stay Proposed, because their other
     open questions are unanswered. ADRs 0002, 0004 and 0005 stay Proposed; their
     references to the retired interim rule were corrected.
   - `package.json` says `"license": "BUSL-1.1"`.
   - The licence gate allows 0BSD, the `tslib` exemption is gone, an exemption must cite
     an Accepted ADR that names the package, and a workspace holding `UPSTREAM.json` is
     checked like any dependency.
   - `CLAUDE.md`, `PROVENANCE.md` (the copy rule; the port candidates with the commit each
     licence was read at and its licence-boundary rule; rows for the patterns the ADRs
     adopt), `NOTICE`, `LICENSING.md`, `README.md`, and `docs/ROADMAP.md` 0.1 and section 7.
   - Since then: the porting maps and OSS studies no longer call copying forbidden or
     ADR 0001 unsigned (1.3, 1.4, 1.5, 1.6, 1.7, 2.1–2.2, 2.3, 5.1, and the Cal.diy, Paca
     and SVAR studies; 6.1 and 6.2 arrived already corrected), and the 1.3 and 1.4 maps
     carry the ADR 0006 role decisions.
   - Decisions 15 to 18: ADR 0003 records 15 (open question 10) and 17 (no agent risk
     tier) in place and stays Proposed; `docs/ROADMAP.md` records 16 (under 2.2) and 18
     (5.1's prompt drops the agent-run action, 6.3's prompt and a bullet under it add it); the
     1.4, 1.6, 2.1–2.2, 5.1, 6.1 and 6.2 maps follow them; `README.md` and `CLAUDE.md`
     qualify the rung summary for decision 15, and `CLAUDE.md` says where decisions are recorded.
3. **Land the shared UI (1.2 part A).** Run `pin` (above), then wire it in as listed in
   `docs/porting/shared-ui.md`, "What the rest of Islestone must provide":
   - a root `.gitattributes` with `packages/ui/** -text`;
   - the root `tsconfig` options it extends;
   - the runtime dependencies it imports;
   - the Jest mapper and jsdom `testMatch`;
   - CI running `verify --population fs` right after checkout, then `audit` against a
     fetch of inflect-compliance. CI's `Test` job already runs `npm run test:scripts`;
     once the package lands, its last case verifies `packages/ui` instead of skipping.

   In the same change, per ADR 0001:
   - add Dub's copyright and AGPL-3.0 statement and the Nucleo notice to `NOTICE`;
   - move the rows from `docs/porting/provenance-shared-ui.md` into `PROVENANCE.md`. The
     copy rule asks for a row per copied file, and the draft groups the package into
     seven rows by folder, so either list each file or put the grouping to the owner;
   - add the `@inflect/ui` exemption (`BUSL-1.1`, citing ADR 0001). The gate checks a
     mirrored workspace like any dependency, so without it the build fails.
4. **1.2 part B (the GENERIC `src/components/ui` files).** Follow `docs/porting/maps/1.2.md`:
   109 files, 14 MIXED files that come along, a second manifest for Islestone-owned
   files, and a 10-batch copy order. Per ADR 0001 D4, the `PROVENANCE.md` row of each
   copied file the Dub measurement links to Dub (at least 50% shared lines,
   `docs/porting/licence/dub-overlap.py`) names that Dub origin, and `NOTICE`'s Dub entry
   covers it. Those files are 17 non-icon files (`animated-size-container.tsx`,
   `charts/funnel-chart.tsx`, `combobox/index.tsx`, `date-picker/shared.ts`,
   `date-picker/types.ts`, `filter/filter-list.tsx`, `filter/filter-range-panel.tsx`,
   `filter/filter-range-utils.ts`, `filter/filter-scroll.tsx`, `filter/filter-select.tsx`,
   `filter/types.ts`, `form.tsx`, `label.tsx`, `number-stepper.tsx`, `slider.tsx`,
   `table/types.ts`, `table/use-table-pagination.tsx`) and 7 icons
   (`icons/dub-analytics.tsx`, `dub-api.tsx`, `dub-crafted-shield.tsx`, `dub-links.tsx`,
   `dub-product-icon.tsx`, `icon-type.ts`, `plan-feature-icons.tsx`), all under
   `src/components/ui/`. The 1.2 map skips some of them (`form.tsx` and the `dub-*`
   icons, for example); only those it copies need the row.
5. **Ports 1.3–1.7, then 2.1–2.3, 5.1, 6.1 and 6.2.** Follow their maps in
   `docs/porting/maps/`. Each map gives the files, what to cut, the npm packages and the
   tests that come along, and the copy order. Every copied file gets a `PROVENANCE.md` row
   pinned to `5528464fc54a8681956f3b9ce23ca9c075f0420e`.
