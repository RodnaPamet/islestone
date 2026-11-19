# Provenance

Where outside code, data and design came from, under which licence, and what Islestone changed. Roadmap principle 6 requires it: every port is recorded with its source repository, commit, licence and changes. Hardening gate H0 adds that a port candidate's LICENSE file is re-read, and its commit pinned here, before first use.

This file covers what was **taken from a source**: copied code, adapted code, data, and designs or patterns learned by reading. Ordinary npm dependencies are not listed. They stay in their own packages, and the licence gate (`npm run licence:check`, `scripts/licence-gate.mjs`) checks each production dependency's licence on every pull request.

## How to add an entry

- Add a row in the same pull request as the code it covers.
- **Source** names the repository and the path that was read.
- **Commit** is the full commit hash that was read. For a source that is not a git repository, give the exact version, for example an npm version.
- **Licence** is the licence in force at that commit, read from its LICENSE file, not from a README or a registry page.
- **What was taken** says whether code was copied, adapted, or only read for a pattern. Use the words "pattern only, no code copied" when nothing was copied.
- **Changes** says what Islestone did differently.
- When code is copied, also add the attribution that its licence requires to [`NOTICE`](NOTICE).

## inflect-compliance: BUSL-1.1, copying allowed

inflect-compliance is licensed under the Business Source License 1.1, and Inflect Ltd. is the licensor. Inflect Ltd. is also Islestone's licensor (`LICENSE`). On 2026-11-18 the owner allowed code to be copied from it ([ADR 0001](docs/adr/0001-code-provenance-and-licences.md), decision D1), which retired the interim rule "read for patterns, copy no code". The copy rule is in ADR 0001:

- every copied file gets a row here: source path, commit, licence BUSL-1.1, and what changed ("None" for a byte-for-byte copy);
- licence notices the copied material carries are kept, such as a package's `"license": "BUSL-1.1"` field or a bundled notice;
- third-party material inside the copied code brings its notice into [`NOTICE`](NOTICE) in the same change.

The first copied code is `@inflect/ui`, listed file by file under "Copied: `@inflect/ui`" below. The rows under "Adopted" that name inflect-compliance are pattern only: those components were written fresh while the interim rule applied, and they stay as written.

All inflect-compliance rows were read in the sibling checkout at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e` (2026-11-17, "chore(release): 3.404.0"), remote `github.com/RodnaPamet/inflect-compliance`.

## Copied: `@inflect/ui` (sub-phase 1.2, part A)

The whole of inflect-compliance's `packages/ui`, copied byte for byte. These facts hold for every row below:

- **Source:** inflect-compliance, `packages/ui/` at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`.
- **Licence:** BUSL-1.1, licensor Inflect Ltd. (the package's `"license"` field is kept). Copying is allowed by [ADR 0001](docs/adr/0001-code-provenance-and-licences.md) decision D1.
- **Third-party origin:** much of the package derives from Dub (`github.com/dubinc/dub`, AGPL-3.0 outside its `(ee)` folders; "Copyright (c) 2024-present Dub Technologies, Inc."), and the Nucleo icons carry Nucleo's terms. The owner decided to copy them as they are and accept the licence risk (ADR 0001 decision D4). A file is marked Dub-derived when `docs/porting/licence/dub-overlap.py` finds at least 50% of its normalised lines in Dub's `packages/ui` or `packages/utils` at `6b463b4bdd9ed2fd9aa416f67b5b77d317b1471e` (74 files); line overlap shows shared text, not who wrote it first. The 270 Nucleo icon files are marked as such. [`NOTICE`](NOTICE) carries both attributions.
- **Changes:** none. `packages/ui/UPSTREAM.json` records each file's sha256; `node scripts/ui-drift.mjs verify` fails on any edit, and `audit` fails when the manifest does not match the package at the commit above ([`docs/porting/shared-ui.md`](docs/porting/shared-ui.md)).
- **Stale upstream text:** the package `README.md`, `src/index.ts` and the hooks README are stale upstream (see `docs/porting/shared-ui.md`, "Known upstream issues"); they are copied unchanged.

<details>
<summary>All 397 copied files</summary>

| File | Third-party origin |
|---|---|
| `packages/ui/README.md` | — |
| `packages/ui/package.json` | — |
| `packages/ui/src/components/ui/button-variants.ts` | — |
| `packages/ui/src/components/ui/button.tsx` | — |
| `packages/ui/src/components/ui/card-variants.ts` | — |
| `packages/ui/src/components/ui/card.tsx` | — |
| `packages/ui/src/components/ui/charts/areas.tsx` | Dub-derived: 73% shared lines with Dub `packages/ui/src/charts/areas.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/charts/bar-field-3d.tsx` | — |
| `packages/ui/src/components/ui/charts/bars.tsx` | — |
| `packages/ui/src/components/ui/charts/chart-3d-dynamic.ts` | — |
| `packages/ui/src/components/ui/charts/chart-3d.tsx` | — |
| `packages/ui/src/components/ui/charts/chart-context.ts` | Dub-derived: 100% shared lines with Dub `packages/ui/src/charts/chart-context.ts` (AGPL-3.0) |
| `packages/ui/src/components/ui/charts/chart-gloss.tsx` | — |
| `packages/ui/src/components/ui/charts/chart-gradient.tsx` | — |
| `packages/ui/src/components/ui/charts/chart-legend.tsx` | — |
| `packages/ui/src/components/ui/charts/chart-motion.tsx` | — |
| `packages/ui/src/components/ui/charts/examples.ts` | — |
| `packages/ui/src/components/ui/charts/index.ts` | — |
| `packages/ui/src/components/ui/charts/interaction.tsx` | — |
| `packages/ui/src/components/ui/charts/layout.ts` | — |
| `packages/ui/src/components/ui/charts/time-series-chart.tsx` | Dub-derived: 54% shared lines with Dub `packages/ui/src/charts/time-series-chart.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/charts/tooltip-sync.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/charts/tooltip-sync.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/charts/types.ts` | — |
| `packages/ui/src/components/ui/charts/use-heat-scale.ts` | — |
| `packages/ui/src/components/ui/charts/use-tooltip.ts` | Dub-derived: 100% shared lines with Dub `packages/ui/src/charts/use-tooltip.ts` (AGPL-3.0) |
| `packages/ui/src/components/ui/charts/utils.ts` | — |
| `packages/ui/src/components/ui/charts/x-axis.tsx` | Dub-derived: 67% shared lines with Dub `packages/ui/src/charts/x-axis.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/charts/y-axis.tsx` | Dub-derived: 76% shared lines with Dub `packages/ui/src/charts/y-axis.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/empty-state.tsx` | — |
| `packages/ui/src/components/ui/error-state.tsx` | — |
| `packages/ui/src/components/ui/hit-area.ts` | — |
| `packages/ui/src/components/ui/hooks/README.md` | — |
| `packages/ui/src/components/ui/hooks/__tests__/use-threshold-load-more.test.tsx` | — |
| `packages/ui/src/components/ui/hooks/use-autosave-fields.ts` | — |
| `packages/ui/src/components/ui/hooks/use-celebration.ts` | — |
| `packages/ui/src/components/ui/hooks/use-column-visibility.ts` | Dub-derived: 64% shared lines with Dub `packages/ui/src/hooks/use-column-visibility.ts` (AGPL-3.0) |
| `packages/ui/src/components/ui/hooks/use-copy-to-clipboard.tsx` | — |
| `packages/ui/src/components/ui/hooks/use-create-query-param.ts` | — |
| `packages/ui/src/components/ui/hooks/use-cursor-pagination.ts` | — |
| `packages/ui/src/components/ui/hooks/use-enter-submit.ts` | — |
| `packages/ui/src/components/ui/hooks/use-in-viewport.tsx` | — |
| `packages/ui/src/components/ui/hooks/use-input-focused.ts` | — |
| `packages/ui/src/components/ui/hooks/use-intersection-observer.ts` | Dub-derived: 70% shared lines with Dub `packages/ui/src/hooks/use-intersection-observer.ts` (AGPL-3.0) |
| `packages/ui/src/components/ui/hooks/use-is-below-md.ts` | — |
| `packages/ui/src/components/ui/hooks/use-local-storage.ts` | — |
| `packages/ui/src/components/ui/hooks/use-media-query.ts` | Dub-derived: 100% shared lines with Dub `packages/ui/src/hooks/use-media-query.ts` (AGPL-3.0) |
| `packages/ui/src/components/ui/hooks/use-optimistic-update.ts` | — |
| `packages/ui/src/components/ui/hooks/use-resize-observer.ts` | Dub-derived: 82% shared lines with Dub `packages/ui/src/hooks/use-resize-observer.ts` (AGPL-3.0) |
| `packages/ui/src/components/ui/hooks/use-responsive-presentation.ts` | — |
| `packages/ui/src/components/ui/hooks/use-scroll-progress.ts` | — |
| `packages/ui/src/components/ui/hooks/use-scroll.ts` | — |
| `packages/ui/src/components/ui/hooks/use-ssr-fallback.ts` | — |
| `packages/ui/src/components/ui/hooks/use-threshold-load-more.ts` | — |
| `packages/ui/src/components/ui/hooks/use-toast.ts` | — |
| `packages/ui/src/components/ui/icons/anthropic.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/anthropic.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/arrow-up-right-2.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/arrow-up-right-2.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/bing.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/bing.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/continents/af.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/continents/af.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/continents/as.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/continents/as.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/continents/eu.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/continents/eu.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/continents/index.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/continents/index.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/continents/na.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/continents/na.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/continents/oc.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/continents/oc.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/continents/sa.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/continents/sa.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/copy.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/copy.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/crown-small.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/crown-small.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/default-domains/amazon.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/default-domains/amazon.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/default-domains/chatgpt.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/default-domains/chatgpt.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/default-domains/figma.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/default-domains/figma.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/default-domains/github-enhanced.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/default-domains/github-enhanced.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/default-domains/google-enhanced.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/default-domains/google-enhanced.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/default-domains/spotify.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/default-domains/spotify.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/expanding-arrow.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/expanding-arrow.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/facebook.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/facebook.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/file-pen.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/file-pen.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/file-send.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/file-send.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/github.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/github.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/go.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/go.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/google.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/google.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/instagram.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/instagram.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/ios-app-store.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/ios-app-store.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/linkedin.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/linkedin.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/loading-circle.tsx` | Dub-derived: 90% shared lines with Dub `packages/ui/src/icons/loading-circle.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/loading-dots.tsx` | Dub-derived: 67% shared lines with Dub `packages/ui/src/icons/loading-dots.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/loading-spinner.tsx` | Dub-derived: 62% shared lines with Dub `packages/ui/src/icons/loading-spinner.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/lock-small.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/lock-small.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/magic.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/magic.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/markdown-icon.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/markdown-icon.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/matrix-lines.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/matrix-lines.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/nucleo/README.md` | Nucleo notice (kept) |
| `packages/ui/src/components/ui/icons/nucleo/android-logo.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/apple-logo.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/apple.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/arrow-bold-up.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/arrow-left.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/arrow-right.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/arrow-trend-up.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/arrow-turn-left.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/arrow-turn-right2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/arrow-up-right.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/arrows-opposite-direction-x.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/arrows-opposite-direction-y.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/at-sign.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/badge-check.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/badge-check2-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/bell.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/blog.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/bolt-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/bolt.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/book-open.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/book2-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/book2-small.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/book2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/books2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/box-archive.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/brackets-curly.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/briefcase-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/brush.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/bullet-list-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/bullet-list.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/calculator.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/calendar-days.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/calendar-refresh.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/calendar.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/calendar6.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/cards.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/caret-up-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/chart-activity2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/chart-area2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/chart-line.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/check.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/check2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/checkbox-checked-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/checkbox-unchecked.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/chevron-left.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/chevron-right.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/chevron-up.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/circle-arrow-right.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/circle-check-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/circle-check.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/circle-dollar-out.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/circle-dollar.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/circle-dollar3.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/circle-dotted.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/circle-half-dotted-check.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/circle-half-dotted-clock.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/circle-info.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/circle-percentage.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/circle-play-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/circle-play.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/circle-question.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/circle-user.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/circle-warning.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/circle-xmark.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/circles.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/circles3.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/cloud-upload.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/cloud.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/code.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/color-palette2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/connected-dots-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/connected-dots.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/connected-dots4.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/connections3.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/credit-card.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/crosshairs3.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/crown.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/cube-settings-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/cube-settings.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/cube.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/currency-dollar.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/cursor-rays.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/database-key.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/desktop.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/diamond-turn-right-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/diamond-turn-right.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/directions.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/discount.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/dots.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/download.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/duplicate.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/earth-position.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/earth.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/envelope-alert.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/envelope-arrow-right.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/envelope-ban.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/envelope-check.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/envelope-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/envelope-open.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/envelope.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/eye-slash.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/eye.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/face-smile.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/feather-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/file-content.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/file-zip2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/filter-bars.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/filter2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/flag-wavy.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/flag.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/flag2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/flag6.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/flask-small.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/flask.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/folder-bookmark.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/folder-lock.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/folder-plus.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/folder-shield.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/folder.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/folder5.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/gaming-console.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/gauge6.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/gear.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/gear2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/gear3.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/gem.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/gift-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/gift.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/globe-pointer.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/globe-search.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/globe.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/globe2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/greek-temple.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/grid-layout-rows.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/grid-plus.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/grid.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/grip-dots-vertical.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/heading-1.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/heading-2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/headset.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/heart-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/heart.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/hexadecagon-star.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/history.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/hyperlink.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/icosahedron.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/image-icon.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/incognito.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/index.ts` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/infinity-icon.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/input-field.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/input-password-pointer.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/input-password.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/input-search.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/invoice-dollar.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/key.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/layout-sidebar.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/license.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/life-ring-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/life-ring.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/lines-y.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/link-broken.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/link4.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/location-pin.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/lock-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/lock.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/magnifier.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/map-position.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/marketing-target.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/media-pause.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/media-play.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/megaphone.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/menu3.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/message-smile.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/microphone-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/minus.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/mobile-phone.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/money-bill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/money-bill2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/money-bills2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/msg.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/msgs-dotted.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/msgs-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/msgs.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/note.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/office-building.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/page2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/paintbrush.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/palette-2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/paper-plane.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/pen-writing.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/pen2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/percentage-arrow-down.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/photo.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/plug2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/plus.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/plus2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/post.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/pyramid.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/qrcode.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/receipt2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/referred-via.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/refresh2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/robot.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/satellite-dish.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/scan-text.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/scribble.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/shield-alert.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/shield-check.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/shield-keyhole.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/shield-slash.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/shield-user.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/shop.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/shuffle.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/sitemap.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/sliders.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/sort-alpha-ascending.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/sort-alpha-descending.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/sparkle3.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/square-chart.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/square-check.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/square-layout-grid5.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/square-layout-grid6.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/square-user-sparkle2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/square-xmark.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/stack-y-3.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/star-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/star.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/stars2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/suitcase.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/table-icon.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/table-rows2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/tablet.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/tag.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/tags.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/text-bold.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/text-italic.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/text-strike.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/timer2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/toggle2-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/toggles.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/trash.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/triangle-warning.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/trophy.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/tv.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/ui-card.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/user-arrow-right.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/user-check.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/user-crown.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/user-delete.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/user-focus.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/user-minus.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/user-plus.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/user-search.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/user-xmark.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/user.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/users-fill.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/users-settings.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/users.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/users2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/users6.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/versions2.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/views.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/watch.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/webhook.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/window-search.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/window-settings.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/window.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/workflow.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/nucleo/xmark.tsx` | Nucleo icon (Nucleo terms; shipped inside Dub) |
| `packages/ui/src/components/ui/icons/openai.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/openai.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/payment-platforms/card-amex.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/payment-platforms/card-amex.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/payment-platforms/card-discover.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/payment-platforms/card-discover.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/payment-platforms/card-mastercard.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/payment-platforms/card-mastercard.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/payment-platforms/card-visa.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/payment-platforms/card-visa.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/payment-platforms/paypal.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/payment-platforms/paypal.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/payment-platforms/stablecoin.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/payment-platforms/stablecoin.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/payment-platforms/stripe-icon.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/payment-platforms/stripe-icon.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/payment-platforms/stripe-link.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/payment-platforms/stripe-link.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/photo.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/photo.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/php.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/php.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/product-hunt.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/product-hunt.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/python.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/python.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/raycast.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/raycast.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/reddit.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/reddit.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/ruby.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/ruby.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/slack.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/slack.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/sort-order.tsx` | — |
| `packages/ui/src/components/ui/icons/success.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/success.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/tick.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/tick.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/tiktok.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/tiktok.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/twitter.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/twitter.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/typescript.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/typescript.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/unsplash.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/unsplash.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/user-clock.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/user-clock.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/veriff.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/veriff.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/verified-badge.tsx` | Dub-derived: 52% shared lines with Dub `packages/ui/src/icons/verified-badge.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/icons/youtube.tsx` | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/youtube.tsx` (AGPL-3.0) |
| `packages/ui/src/components/ui/skeleton.tsx` | — |
| `packages/ui/src/components/ui/tooltip.tsx` | — |
| `packages/ui/src/components/ui/typography.tsx` | — |
| `packages/ui/src/index.ts` | — |
| `packages/ui/src/lib/cn.ts` | Dub-derived: 50% shared lines with Dub `packages/utils/src/functions/cn.ts` (AGPL-3.0) |
| `packages/ui/src/lib/format-date.ts` | — |
| `packages/ui/src/lib/number-format.ts` | — |
| `packages/ui/tokens.contract.css` | — |
| `packages/ui/tsconfig.json` | — |

</details>

## Adopted

| Component | Source (repository and path) | Commit | Licence | What was taken | Changes |
|---|---|---|---|---|---|
| `src/env.ts`, `src/env-client.ts`, `src/env-skip.ts` (sub-phase 1.1) | inflect-compliance: `src/env.ts`, `src/env-client.ts` | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. The two-module split: the server module has no client block, and the client module declares only `NEXT_PUBLIC_` keys. Both use `createEnv` with `skipValidation` and `emptyStringAsUndefined`. | Written fresh. `skipValidation` is true only for `1` or `true` (`src/env-skip.ts`). The parent reads it as `!!value`, so `"0"` also skips validation there. |
| `tests/guards/client-env-boundary.test.ts`, `tests/helpers/import-graph.ts` (1.1) | inflect-compliance: `tests/guards/client-reachable-modules-import-no-server-env.test.ts`, `tests/helpers/client-import-graph.ts` | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. A breadth-first walk from every `'use client'` root with the TypeScript compiler API, skipping type-only edges and reporting the chain through a parent map. The guard must not pass vacuously. A check of the client env module's keys. | Written fresh. Reports per entry. Parses the directive prologue from the AST. Reports unresolved and computed imports. Proves itself on a throwaway git repository. Asserts that the tsconfig alias matches the guard. |
| `tests/helpers/git-files.ts` (1.1) | inflect-compliance: `tests/helpers/repo-files.ts` | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. A source scan takes its file population from `git ls-files --cached --others --exclude-standard` and throws rather than falling back to a directory walk. | Written fresh. Clears inherited `GIT_*` variables and sets `GIT_CEILING_DIRECTORIES`, so it cannot list a parent repository. The licence gate's source scan uses the same approach. |
| `tests/mocks/env.ts` and the env mapping in `jest.config.mjs` (1.1) | inflect-compliance: `tests/mocks/env.ts`; `jest.config.js` (grep only) | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. One Proxy mock that reads `process.env` live, mapped for both env specifiers in every Jest project. | Written fresh. |
| `.github/workflows/ci.yml` (1.1) | inflect-compliance: `.github/workflows/ci.yml` (grep only) | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. Only the fact that it uses `actions/checkout@v7` and `actions/setup-node@v7`. | The workflow was written fresh. |
| `CLAUDE.md` (1.1) | inflect-compliance: `CLAUDE.md` | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. The general shape of an assistant guide: commands, layer rules, test conventions. | Written fresh. The layer rules come from the roadmap's global preamble (section 4). |

### Patterns adopted in ADR designs (no code written yet)

These ADRs adopt designs read in inflect-compliance at `5528464fc54a8681956f3b9ce23ca9c075f0420e` (BUSL-1.1), or in an npm package. Nothing was copied, and no Islestone code implements them yet. The roadmap step that builds each one adds its own row, saying whether it was written fresh or copied.

| Component (ADR) | Source (repository and path) | Commit or version | Licence | What was taken | Changes |
|---|---|---|---|---|---|
| Work item model ([ADR 0002](docs/adr/0002-work-item-model.md)) | inflect-compliance: `prisma/schema/tasks.prisma`, `prisma/schema/enums.prisma`, `prisma/schema/processes.prisma`, `prisma/schema/agentic.prisma`, `src/app-layer/domain/task-status.ts`, `src/app-layer/repositories/TaskRepository.ts`, `src/app-layer/usecases/tenant-owner-lock.ts`, `src/lib/soft-delete.ts`, `src/lib/security/encrypted-fields.ts` (line ranges in the ADR's References) | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. The atomic per-scope key counter; the pure transition check with discriminated errors; composite parent keys with `tenantId`; the namespaced advisory transaction lock; the field-encryption manifest; `deletedAt`/`deletedByUserId` soft delete; the non-tenant-leading index for a cross-tenant sweep. | The counter is per project (`ProjectKeySequence`), not per workspace. Transition rules differ (ADR 0002 section 4). Names follow ADR 0006. |
| Assignee and delegate ([ADR 0003](docs/adr/0003-assignee-and-delegate.md)) | inflect-compliance: `prisma/schema/agentic.prisma`, `prisma/schema/enums.prisma`, `src/app-layer/usecases/agent-proposals.ts`, `src/lib/agentic/kill-switch.ts`, `src/lib/agentic/run-caps.ts`, `src/lib/agentic/monthly-budget.ts`, `src/app-layer/jobs/agent-run-reaper.ts`, `src/app-layer/context-system.ts`, `docs/implementation-notes/2026-08-12-automation-actor-authority.md`, `CLAUDE.md` (line ranges in the ADR's References) | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. An agent separate from a user, with a required owner; the two-step ownership transfer; the proposal queue's controls; the three-scope kill switch checked before every model and tool call; versioned policy cards; all-or-nothing run caps; the pre-run budget check and reserve-before-use; the reaper that leaves human waits alone; re-reading a named person's authority when work runs; write-once triggers that admit the encryption re-wrap; the conditional claim used for checkout. | Islestone adds the agent session, append-only activity and checkout (ADR 0003 sections 5 to 7), requires a finite budget for every agent, and ends live sessions when a kill is engaged. No rung cap (owner decision, 2026-11-18). |
| Agent session states, activity types and signals ([ADR 0003](docs/adr/0003-assignee-and-delegate.md)) | `@linear/sdk`: `dist/index-BNMxzn7u.d.mts` (lines 320–325, 335–342, 570–578, 6971, 7018–7019) | npm `@linear/sdk` 103.0.0 | MIT, "Copyright (c) 2019 Linear" (the package's `LICENSE`) | Read for design facts only, no code copied: the session statuses, the six activity types and the activity signals, and that Linear types the delegate as a `User`. | Islestone keeps six states (no `stopping`) and the six activity types, and makes the agent its own model rather than a user. |
| Data sync strategy ([ADR 0005](docs/adr/0005-data-sync-strategy.md)) | inflect-compliance: `docs/processes-realtime-collab.md`, `src/app-layer/repositories/ProcessMapRepository.ts`, `src/components/processes/TldrawProcessMap.tsx`, `src/app/api/notifications/stream/route.ts`, `src/lib/notifications/notification-sse.ts`, `src/lib/notifications/notification-bus.ts`, `src/components/layout/notifications-bell.tsx` (line ranges in the ADR's References) | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. An optional-to-required `expectedVersion` with a conditional update; updating the held version from each save's response; SSE for one-way updates with a heartbeat, the Node runtime and buffering off; an in-process fan-out bus; polling as the fallback for missed pushes. | The fan-out bus gets the Redis channel per workspace that the parent's comment proposes but never built. Notices carry ids and versions only. |
| Vocabulary ([ADR 0006](docs/adr/0006-vocabulary.md)) | inflect-compliance: `docs/implementation-notes/2026-08-12-task-vocabulary-and-executing-tests.md`, `prisma/schema/enums.prisma`, `tests/integration/task-enum-db-mapping.test.ts` | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. The lesson of the `@@map` pin and its rename note. | Islestone fixes names before the first migration and allows a pin only with a recorded end date. |

### Other sources used by sub-phase 1.1

| Component | Source | Commit or version | Licence | What was taken | Changes |
|---|---|---|---|---|---|
| Next.js 16 project conventions: `next-env.d.ts` gitignored, the `tsconfig.json` `include` entries, the flat ESLint config shape, the three-line `postcss.config.mjs` | `create-next-app` template, Vercel | npm `create-next-app@16.4.6` (no git commit read) | MIT | The conventions above. `postcss.config.mjs` is the template's three-line config, short enough that any correct version matches it. | Everything else was written fresh. |
| PgBouncer configuration in `docker-compose.yml` (local development only) | `edoburu/docker-pgbouncer`: its entrypoint script and LICENSE | Image `edoburu/pgbouncer:v1.26.1-p0`; the commit read was not recorded by 1.1 | MIT | Read to learn which environment variables the image accepts. Nothing copied. | Not applicable. The image runs only in the local development stack, and no code from it is in this repository. |

### Read and not used

- **inflect-compliance `license:check`** (`package.json` line 18) and **`LICENSING.md`** lines 42–46, at `5528464fc54a8681956f3b9ce23ca9c075f0420e`, BUSL-1.1. Read while writing Islestone's licence gate (sub-phase 0.3). Nothing was taken. The parent runs `license-checker` through `npx` against a deny-list. Islestone's `scripts/licence-gate.mjs` is an allowlist written from scratch with no dependencies. Its git-based file population is the pattern already recorded for `tests/helpers/git-files.ts`.

## Port candidates (licence read, not yet used)

These are the projects the roadmap names as sources to translate from or embed: the port candidates of section 2.2, SVAR React Gantt (2.3, 3.1) and jira-auto-scheduler (3.6). **Nothing has been taken from any of them yet.** Each was studied on 2026-11-18, and its licence was re-read from its LICENSE file at the commit below and checked a second time, independently. The evidence is in `docs/porting/oss/<project>.md`, section "Licence check".

The commit below is the one the licence was read at. A candidate stays **UNPINNED** for use until its first port. Before that port starts, H0 requires the porter to:

- use the commit below, or re-read the LICENSE file at a later commit and record that one;
- replace UNPINNED with the commit used;
- move the row to **Adopted** with what was taken and what changed;
- follow the candidate's licence-boundary rule.

| Component (planned use) | Source repository | Licence read at | Pinned for use | Licence (from its LICENSE file) | Licence-boundary rule |
|---|---|---|---|---|---|
| Kaneo: projects, tasks, subtasks, dependencies, custom fields, time entries, workflow rules, GitHub integration (2.1, 2.4, 5.3). Study: [`kaneo.md`](docs/porting/oss/kaneo.md) | `github.com/usekaneo/kaneo` | `fb890b4974e6dd6c232f1de6a6b70a591dfca0a3` | UNPINNED | MIT, "Copyright (c) 2024 Andrej Acevski" (root `LICENSE`, unchanged since it was added). Some sub-packages carry MIT or ISC notices of other holders | None on licence grounds. `packages/importers/src/plane/*` is for structure only until audited (Plane is inspiration only). No use of the name "Kaneo" or its marks. |
| Paperclip: agent, goal, budget, heartbeat and run schema with atomic checkout locks (3.2, 6.3). Study: [`paperclip.md`](docs/porting/oss/paperclip.md) | `github.com/paperclipai/paperclip` | `8285a81280db17898f38827a9f3c90221a82f23c` | UNPINNED | MIT, "Copyright (c) 2025 Paperclip AI" (the README names Paperclip Labs, Inc.) | Take nothing from a revision that does not have `63afce369` (the merge that added `LICENSE`) as an ancestor. Third-party subtrees (for example `docker/`, `ui/public/fonts/`, `ui/public/brands/`, `packages/adapters/hermes/`, `packages/shared/src/cliplab/`) keep their own notices. |
| Teable `packages/`: field types and formulas (2.4). Study: [`teable.md`](docs/porting/oss/teable.md) | `github.com/teableio/teable` | `bd8cfc054f521f6f9019f62dec2f9fcb1273ecec` | UNPINNED | `packages/` MIT, "Copyright (c) 2023-2025 Teable, Inc.", since `9c77957afe43034a9e71f8c2ddd4de48b77b5266` (2024-08-19). The apps, `plugins/` and the root are AGPL-3.0 with a brand term | `packages/` only, and only from revisions at or after `9c77957af`. Never read the apps or `plugins/` for code. A port of the formula grammar carries its Baserow and Tal Shprecher MIT notices. Strip Teable brand strings. |
| Cal.diy: availability and booking (3.3, also 3.1 and 3.5). Study: [`cal-diy.md`](docs/porting/oss/cal-diy.md) | `github.com/calcom/cal.diy` | `ae027bb70e694e2d2c44569f398d6cbcee0389b1` | UNPINNED | MIT, "Copyright (c) 2020-present Cal.com, Inc.", since `ab21c7f805a089fa3a11ffd61c4a9aecc349c16c` (2026-04-15); AGPLv3 with Commercial-licensed `ee` folders before | Only the 63 paths the study recommends (section 2), none of them formerly under `ee/`. Nothing from before `ab21c7f805`. Not `apps/api/v2`, not `packages/types/ical.d.ts` (GPL-3.0-only), not the Stack Overflow helper in `packages/types/Calendar.d.ts`. |
| Paca web: automation graph builder (5.1). Study: [`paca.md`](docs/porting/oss/paca.md) | `github.com/Paca-AI/paca` | `5913718b6aaa81815085f1805dd764dbc5f55cce` | UNPINNED | Apache-2.0 (root `LICENSE`, unchanged since it was added; its appendix names no copyright holder). No `NOTICE` file at this commit | Not `apps/web/public/provider-logos/` or `services/api/internal/platform/bundledskills/content/` (third-party, licence unverified), nor `apps/web/src/components/ui/` (generated shadcn components). Code derived from Paca ships the Apache-2.0 text and marks modified files. Re-check for a `NOTICE` file at every re-pin: Apache-2.0 requires carrying it into [`NOTICE`](NOTICE). |
| ln-dev7/circle: Linear-style UI shell (2.3, 1.7). Study: [`circle.md`](docs/porting/oss/circle.md) | `github.com/ln-dev7/circle` | `b0ba7ddcc3d0f4c16092236ca6a01b56c0614810` | UNPINNED | MIT, "Copyright (c) 2025 lndev-ui \| Circle Template" (`LICENSE.md`) | None on licence grounds. Vendored code under other holders (bazza/ui in `components/data-table-filter/`, shadcn in `components/ui/`, usehooks-ts hooks) needs its own notice if taken. Not `components/common/settings/integration-logos.tsx` (third-party brand marks), nor the paid BaseUI variant. |
| SVAR React Gantt and its store: timeline and Gantt (3.1). Study: [`svar-gantt.md`](docs/porting/oss/svar-gantt.md) | `github.com/svar-widgets/react-gantt` and `github.com/svar-widgets/gantt` | `24f381a37e1e7175ef690aa3f1079a4bf5ad4004` and `ba701283bc4f982f758a6b37fd2d63e6324c5424` (both tag v2.8.3) | UNPINNED | MIT, "Copyright (c) 2025 XB Software Sp. z o.o" (the file is `license.txt`, not `LICENSE`) | Only v2.4.3 or later. Both repositories carried GPL-3.0 at earlier versions, so never copy from a pre-2.4.3 commit of either. Not the PRO edition. The vendor's Next.js demo has no licence: read only. |
| jira-auto-scheduler: Monte Carlo forecasting (3.6). Study: [`jira-auto-scheduler.md`](docs/porting/oss/jira-auto-scheduler.md) | `github.com/bitovi/jira-auto-scheduler` | `39323ed28d7d7e2223853f67a098dd9a23f2773f` | UNPINNED | MIT, "Copyright (c) 2021 Bitovi" (`package.json` says ISC; the LICENSE file governs) | None on licence grounds. Not the vendored `public/can.js`, `public/json-logic/` or `public/dist/` files, nor Bitovi's name and images. The study recommends pattern only. |

The projects that roadmap 2.2 marks **inspiration only** (Plane, OpenProject, Twenty and the rest of that list, plus the source-available ones) never get a row here. Islestone copies no code from them, whatever their licence allows.
