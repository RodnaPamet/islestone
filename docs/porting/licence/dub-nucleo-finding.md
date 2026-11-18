# Finding: inflect-compliance's UI layer is largely derived from Dub (AGPL-3.0) and carries Nucleo icons

Date: 2026-11-18. Inflect-compliance commit 5528464. Dub commit 6b463b4 (2026-10-26).

## Facts

- Dub's repository licence (`LICENSE.md`): everything outside two `(ee)` folders is **AGPL-3.0**.
  `@dub/ui` and `@dub/utils` declare no licence of their own (npm shows none for all
  versions), so the repository licence governs them.
- Nucleo icons, as shipped inside Dub (`icons/nucleo/README.md`, copied verbatim into
  inflect): "Redistribution of icons is prohibited. Icons are restricted for use only
  within the product they are bundled with."
- Inflect's own docs call this code "Dub-ported" / "Dub-originated" (`docs/codebase-hygiene.md`,
  `docs/adr/0001-ui-primitive-stack.md`, `docs/shared-ui-package-design.md`). No doc,
  NOTICE or attribution records Dub's licence or a licence assessment. Elsewhere inflect
  rejects AGPL sources because they "would infect IC" (BIA, AI registry notes).

## Measurement

Normalised-line overlap (lines of 12+ characters, imports, comments and braces ignored)
between inflect's UI files and Dub's `packages/ui` + `packages/utils`:

| inflect area | files | >=50% overlap | 20-50% | <20% |
|---|---|---|---|---|
| `packages/ui` (@inflect/ui), Nucleo icons | 270 | 270 | 0 | 0 |
| `packages/ui`, other icons (brand logos, continents, payment platforms) | 63 | 62 | 1 | 0 |
| `packages/ui`, non-icon (charts, hooks, cn) | 56 | 12 | 9 | 35 |
| `src/components/ui`, non-icon | 184 | 17 | 22 | 145 |
| `src/components/ui`, icons | 9 | 7 | 1 | 1 |
| `src/lib/hooks` | 15 | 0 | 1 | 14 |
| rest of `src/` (engines, app layer, pages) | ~2,600 | 1 (`src/lib/http/fetch-with-retry.ts`, 75%) | | |

High-overlap non-icon files include the chart core (`charts/use-tooltip`, `tooltip-sync`,
`chart-context`, axes, areas, time-series), the filter system (`filter-list`, `filter-select`,
`filter-range-panel`, `filter-scroll`, `types`), `date-picker/shared`, `table/use-table-pagination`,
`combobox`, `form`, `label`, `slider`, `number-stepper`, `animated-size-container`, and hooks
(`use-media-query`, `use-resize-observer`, `use-intersection-observer`, `use-column-visibility`).

Caveat: line overlap shows shared text, not who wrote it first. A few of these (`label`,
`form`, `slider`) also resemble shadcn/ui (MIT), which Dub may itself have adapted. The
icons, charts, filter system and date picker are Dub's own work.

The engines Islestone plans to take (tasks, automation, agentic, MCP, canvas) show no
Dub overlap. The issue is confined to the UI layer.

## What it means

- Copying these files into Islestone and licensing Islestone BUSL-1.1 has the same problem
  inflect has: AGPL-3.0 requires a work that includes AGPL code to be conveyed under AGPL.
- Committing the Nucleo files to another product's repository is redistribution outside
  "the product they are bundled with".
- This is also an exposure for inflect-compliance itself, independent of Islestone.

## Options

1. **Clean the shared package upstream, then copy it.** Replace the Dub-derived files in
   `@inflect/ui` (and the Dub-derived `src/components/ui` files) with Inflect-authored or
   MIT/ISC-sourced code: lucide-react for icons, shadcn/ui (MIT) where it fits, own charts on
   visx (MIT). Islestone copies the cleaned package byte for byte. Fixes both products; the
   largest job.
2. **Islestone takes only the clean part now.** Copy the files with no Dub overlap; rebuild the
   Dub-derived pieces in Islestone from MIT/ISC sources. Islestone is clean at once, but the
   shared package stops being byte-identical (two copies of the UI to maintain).
3. **Licence it.** A commercial licence from Dub Technologies for the code, and a Nucleo licence
   that covers Islestone (and inflect). Then copy as-is.
4. **Accept the risk** and copy as-is. Not recommended.
