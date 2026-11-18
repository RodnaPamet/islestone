# Handoff — 2026-11-18 (paused for usage quota)

State of the roadmap work when it paused, the owner decisions taken so far, and the next
steps in order. Read this first, then `CLAUDE.md`, `docs/ROADMAP.md` and `docs/adr/`.
Delete this file when everything under "Next steps" is done.

## Owner decisions, 2026-11-18

Given in the working session by the repository owner. ADR 0001 does not record them yet
(next step 2), so this list is the record until it does.

| # | Decision | Owner's words |
|---|---|---|
| 1 | Code may be copied from inflect-compliance. Record every copied file in `PROVENANCE.md`. | "inflect compliance is my software, it's in the same Organization- you can copy" |
| 2 | The canvas stays on tldraw 3.x with the watermark visible, in commercial production. | "we can use the 3.x in commercial production with the watermark, it's open sourced" |
| 3 | Islestone is licensed BUSL-1.1, like inflect-compliance. | "Make it BUSL as well" |
| 4 | The Dub-derived UI (see below) is copied as it is, and the licence risk is accepted. | Chose "Copy as is, accept risk" when asked |

Not yet confirmed by the owner, and assumed in `LICENSE`:

- Licensor: Inflect Ltd. (mirrors inflect-compliance).
- Additional Use Grant: inflect's, with "project-management, work-management" added to the
  competing products, and internal use reworded to "manage your own organization's
  projects and work".
- Change Date: 2030-11-18.

## Open questions for the owner (from the porting maps)

Raised by `docs/porting/maps/1.4.md`. None of them blocks 1.2 or 1.3.

1. **Role order and the fallback role.** The map recommends declaring the roles as OWNER,
   ADMIN, MEMBER, VIEWER, GUEST, which ranks them by breadth of access rather than in the
   roadmap's list order. VIEWER, never GUEST, is the role a user falls back to.
2. **Public self-signup** at `/api/auth/register`: open, invite-only, or behind a flag.
3. **MEMBER or EDITOR** as the name of the standard role (ADR 0006).

Map housekeeping: `1.5.md` has a "Handoff to 1.6" section, listing what 1.5 already
places in `metrics.ts`, `tracing.ts`, `edge-logger.ts` and `instrumentation.ts`. Copy it
into `1.6.md` before porting 1.6.

## Finding: Dub (AGPL-3.0) and Nucleo in inflect's UI

`docs/porting/licence/dub-nucleo-finding.md` has the measurement (script:
`docs/porting/licence/dub-overlap.py`). In short, 368 of inflect's 597 UI files share at
least half their text with Dub's `packages/ui`/`packages/utils`, which are AGPL-3.0. That
count includes 270 Nucleo icons whose notice forbids use outside the product they shipped
with. The engines (tasks, automation, agentic, MCP, canvas) show no overlap. The owner
accepted the risk (decision 4). `NOTICE` and ADR 0001 must still say so: next step 2.

## What is on the branch

`claude/great-planck-57ljb4`:

- `449fb38` — the roadmap.
- `0bf9582` — Phase 0 + 1.1 skeleton, checkpointed during its review loop: app skeleton,
  env modules, licence gate, CI, ADRs 0001–0006 as drafts.
- This commit adds:
  - `LICENSE` and `LICENSING.md` (BUSL-1.1);
  - the shared-UI drift tooling (`scripts/ui-drift.mjs` with `verify`, `audit`, `compare`
    and `pin`, plus `tests/unit/ui-drift.test.mjs`, run with
    `node --test tests/unit/ui-drift.test.mjs`) and `docs/porting/shared-ui.md`;
  - the porting maps (`docs/porting/maps/`), the open-source studies (`docs/porting/oss/`)
    and the Dub finding (`docs/porting/licence/`).

## What is not on the branch

- **`packages/ui` (the 397-file `@inflect/ui` copy).** Recreate it exactly with:

      node scripts/ui-drift.mjs pin /path/to/inflect-compliance --ref 5528464fc54a8681956f3b9ce23ca9c075f0420e

  This was checked: it reproduces the held copy, `UPSTREAM.json` included. Until then the
  last test in `ui-drift.test.mjs` fails, because it checks the real `packages/ui`.
  `package.json` still says `UNLICENSED`, and ADR 0001 still lists every decision as open.
- **Work by the Phase 0 + 1.1 workflow after `0bf9582`.** At pause time it was applying
  review fixes, then running its final check. Anything it wrote that is not on the
  branch is lost if the container is reclaimed. Rerun its review (next step 1) rather than
  trust the checkpoint as final.
- **Porting-map verification still in progress at pause time.** The maps on the branch are
  the latest saved versions, and some were still being re-verified.

## Rules learned from the licence re-reads (H0)

Full evidence is in `docs/porting/oss/<project>.md`, section "Licence check".

| Project | Pin | Licence | Rule |
|---|---|---|---|
| Kaneo | `fb890b4` | MIT | none |
| Paperclip | `8285a81` | MIT | Take nothing from a revision that lacks `63afce369` (the LICENSE merge) as an ancestor. |
| Teable | `bd8cfc0` | `packages/` MIT since `9c77957af`; apps and plugins AGPL-3.0 | `packages/` only |
| Cal.diy | `ae027bb7` | MIT since `ab21c7f805` (AGPL before) | Only the 63 paths the study names, none of them formerly `ee/` |
| Paca | `5913718` | Apache-2.0 | none |
| circle | `b0ba7dd` | MIT | none |
| SVAR Gantt | `24f381a` / `ba70128` (v2.8.3) | MIT from v2.4.3; GPL-3.0 before | Pin 2.4.3 or later; never copy from earlier commits |
| jira-auto-scheduler | `39323ed` | MIT | none |

## Next steps, in order

1. **Finish Phase 0 + 1.1.** Pull the branch and run `npm ci && npm run verify`, the
   Playwright smoke test (`npm run build && npm run test:e2e`) and the CI workflow. Fix
   anything red. A fresh review pass against roadmap Phase 0 and 1.1, and against H0, is
   worth running, because the workflow's last fix round may not have landed.
2. **Record the owner decisions.**
   - ADR 0001: D1 (copy allowed), D2 (BUSL-1.1), D3 (tldraw 3.x with the watermark), and a
     new D4 (Dub/Nucleo taken as is, risk accepted, with the finding's numbers). Replace
     its interim "pattern only" rule with "copy, and record each file".
   - Set `"license": "BUSL-1.1"` in `package.json`.
   - `CLAUDE.md` and `PROVENANCE.md`: change the "do not copy inflect-compliance" rule to
     "copy, record each file".
   - `NOTICE`: add the Dub copyright and AGPL-3.0 statement, and the Nucleo notice.
   - `docs/ROADMAP.md` 0.1 and section 7: move the three decisions from open to decided.
3. **Land the shared UI (1.2 part A).** Run `pin` (above), then wire it in as listed in
   `docs/porting/shared-ui.md`, "What the rest of Islestone must provide":
   - a root `.gitattributes` with `packages/ui/** -text`;
   - the root `tsconfig` options it extends;
   - the runtime dependencies it imports;
   - the Jest mapper and jsdom `testMatch`;
   - CI running `verify --population fs` right after checkout, then `audit` against a
     fetch of inflect-compliance, and the node test.

   The licence gate treats a workspace that declares the root's licence as Islestone's own.
   Once the root is BUSL-1.1, `@inflect/ui` passes silently, so decide whether a mirrored
   workspace (one carrying `UPSTREAM.json`) should need an explicit exemption instead.
4. **1.2 part B (the GENERIC `src/components/ui` files).** Follow `docs/porting/maps/1.2.md`:
   109 files, 14 MIXED files that come along, a second manifest for Islestone-owned
   files, and a 10-batch copy order.
5. **Ports 1.3–1.7, then 2.1–2.3, 5.1, 6.1 and 6.2.** Follow their maps in
   `docs/porting/maps/`. Each map gives the files, what to cut, the npm packages and the
   tests that come along, and the copy order. Every copied file gets a `PROVENANCE.md` row
   pinned to `5528464fc54a8681956f3b9ce23ca9c075f0420e`.
