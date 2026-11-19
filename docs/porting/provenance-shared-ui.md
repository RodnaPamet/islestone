# Provenance fragment: shared UI (roadmap 1.2, part A)

These rows move into `PROVENANCE.md` in the change that lands `packages/ui` (sub-phase
1.2, part A). `PROVENANCE.md` exists; the rows wait here only because the package is not
in the tree yet.

- **Source:** inflect-compliance at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`.
- **Path:** every row below is under `packages/ui/` at that commit.
- **Licence:** BUSL-1.1, licensor Inflect Ltd., Islestone's own licensor. Copying is
  allowed by ADR 0001 decision D1 (owner decision, 2026-11-18).
- **Third-party origin:** much of the package derives from Dub, and its Nucleo folder is
  Nucleo's. The owner decided to copy it as it is and accept the licence risk (ADR 0001
  decision D4, owner decision, 2026-11-18). The rows below name that origin where the
  measurement found it.
- **Hashes:** `packages/ui/UPSTREAM.json` records the sha256 of every file, and which
  files are executable (none).
- **Changes:** none, in every row. The copy is byte for byte.
  `node scripts/ui-drift.mjs verify` fails on any change to a file, and
  `node scripts/ui-drift.mjs audit` fails on any manifest that does not match the
  package at the commit above (see `docs/porting/shared-ui.md`, "Verify and audit").

## Where the Dub origin comes from

`docs/porting/licence/dub-nucleo-finding.md` measured normalised-line overlap between
inflect-compliance's UI files and Dub's `packages/ui` and `packages/utils`
(`github.com/dubinc/dub` at `6b463b4bdd9ed2fd9aa416f67b5b77d317b1471e`), with
`docs/porting/licence/dub-overlap.py`. Dub's `LICENSE.md` at that commit was read
(ADR 0001, Context, **Verified**): "Copyright (c) 2024-present Dub Technologies, Inc.",
AGPL-3.0 outside the two `(ee)` folders of `apps/web`. A file "links to Dub" below when the
script's per-file output gives it at least 50% shared normalised lines. Line overlap shows
shared text, not who wrote it first (the finding's caveat).

For `packages/ui` the per-file output gives:

- **Charts (7 of 22):** `areas.tsx`, `chart-context.ts`, `time-series-chart.tsx`,
  `tooltip-sync.tsx`, `use-tooltip.ts`, `x-axis.tsx`, `y-axis.tsx`.
- **Hooks (4 of 23):** `use-column-visibility.ts`, `use-intersection-observer.ts`,
  `use-media-query.ts`, `use-resize-observer.ts`.
- **Utilities (1 of 3):** `lib/cn.ts` (it matches Dub's `packages/utils/src/functions/cn.ts`).
- **Icons outside `nucleo/` (62 of 63):** every file except `icons/sort-order.tsx` (48%).
- **Nucleo icons (270 of 270).**
- **Package shell and flat primitives:** none at 50% or more (the highest is `button.tsx`,
  44%).

## Rows

| Component | Source path | Commit | Licence | What was taken | Changes |
|---|---|---|---|---|---|
| `@inflect/ui` package shell | `packages/ui/{README.md, package.json, tsconfig.json, tokens.contract.css, src/index.ts}` | `5528464fc54a` | BUSL-1.1, licensor Inflect Ltd. (ADR 0001 D1) | 5 files: manifest, boundary tsconfig, the 47-name token contract, the empty index | None. The README, index and description are stale upstream; see `docs/porting/shared-ui.md` |
| Flat primitives | `packages/ui/src/components/ui/*.{ts,tsx}` | `5528464fc54a` | BUSL-1.1 | 10 files: button, button-variants, card, card-variants, empty-state, error-state, hit-area, skeleton, tooltip, typography | None |
| Charts | `packages/ui/src/components/ui/charts/` | `5528464fc54a` | BUSL-1.1 as inflect ships them. **Dub-derived in part:** the 7 chart files listed above link to Dub's `packages/ui/src/charts/` (AGPL-3.0; ADR 0001 D4) | 22 files: visx series, axes, legend, tooltip, gradients, 3D stub, layout utilities | None. 11 are classified `MIXED` upstream (compliance or product wording in comments and examples) |
| UI hooks | `packages/ui/src/components/ui/hooks/` | `5528464fc54a` | BUSL-1.1 as inflect ships them. **Dub-derived in part:** the 4 hooks listed above link to Dub's `packages/ui/src/hooks/` (AGPL-3.0; ADR 0001 D4) | 23 files: 21 hooks, 1 co-located test, 1 README | None. The README is stale upstream |
| Utilities | `packages/ui/src/lib/{cn,format-date,number-format}.ts` | `5528464fc54a` | BUSL-1.1 as inflect ships them. **Dub-derived in part:** `cn.ts` links to Dub's `packages/utils` (AGPL-3.0; ADR 0001 D4) | 3 files | None. `number-format.ts` says it replaced a function "pulled from the `Dub utils` shim" |
| Icons (non-Nucleo) | `packages/ui/src/components/ui/icons/` (except `nucleo/`) | `5528464fc54a` | BUSL-1.1 as inflect ships them. **Dub-derived:** 62 of the 63 files link to Dub's `packages/ui/src/icons/` (AGPL-3.0; ADR 0001 D4); `sort-order.tsx` does not reach 50% | 63 files: brand marks, continents, default-domain logos, loaders, small glyphs | None |
| **Nucleo icons** | `packages/ui/src/components/ui/icons/nucleo/` | `5528464fc54a` | **Nucleo's terms, not BUSL-1.1.** The bundled README reads: "Redistribution of icons is prohibited. Icons are restricted for use only within the product they are bundled with" (nucleoapp.com/license). Shipped inside Dub's `packages/ui/src/icons/nucleo/`. Copied with the risk accepted (ADR 0001 D4) | 271 files: 270 icon components plus the Nucleo README, which is kept | None |

## Islestone's own code (not a port)

| Component | Path | Origin |
|---|---|---|
| Drift check | `scripts/ui-drift.mjs`, `tests/unit/ui-drift.test.mjs` | Written for Islestone. It follows the hash-synced copy model that inflect describes in `docs/shared-ui-policy.md` ("For a consumer"). No code was copied: inflect has no consumer-side sync script, and playerz.bg's `scripts/ui-sync` was not read. |

## Settled, and what is still open

Settled on 2026-11-18 by owner decisions recorded in ADR 0001:

1. **The BUSL-1.1 grant** (D1). Copying from inflect-compliance is allowed, with a
   `PROVENANCE.md` row for every copied file. No separate grant document exists; the
   owner's decision, recorded in the ADR, is the authority.
2. **Nucleo** (D4). The icons are copied as they are, and the risk is accepted:
   their notice limits them to "the product they are bundled with", and Islestone is
   a different product. `NOTICE` carries the Nucleo notice from the change that lands
   the package, and the Nucleo `README.md` is kept.
3. **Dub origin** (D4). Dub's licence was verified as AGPL-3.0 outside its `(ee)`
   folders at `6b463b4` (ADR 0001, Context), and the measurement above names the files.
   They are copied as they are, with the risk accepted. `NOTICE` carries Dub's copyright
   and AGPL-3.0 statement from the change that lands the package.

Still open:

- **One row per file, or one row per folder.** ADR 0001's copy rule gives every copied
  file a `PROVENANCE.md` row. The table above groups the package into seven rows by
  folder. When the rows move into `PROVENANCE.md`, either list each file (naming the Dub
  origin on each file the measurement links to Dub), or put the grouping to the owner as
  a decision first.
