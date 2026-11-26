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

The first copied code is `@inflect/ui`, listed file by file under "Copied: `@inflect/ui`" below; the generic UI files copied into `src/` follow, under "Copied: generic UI". The rows under "Adopted" that name inflect-compliance are pattern only: those components were written fresh while the interim rule applied, and they stay as written.

All inflect-compliance rows were read in the sibling checkout at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e` (2026-11-17, "chore(release): 3.404.0"), remote `github.com/RodnaPamet/inflect-compliance`.

## Copied: `@inflect/ui` (sub-phase 1.2, part A)

The whole of inflect-compliance's `packages/ui`, copied byte for byte. These facts hold for every row below:

- **Source:** inflect-compliance, `packages/ui/` at commit `884dbdd32d7869bb47d2416ec93186144fbb7730` (2026-11-19, inflect PR #5773). First copied at `5528464fc54a8681956f3b9ce23ca9c075f0420e`; re-pinned for issue #7, which fixed the package upstream: it now declares its dependencies, passes `noUncheckedIndexedAccess` under its own `tsconfig.json`, describes itself correctly and drops product wording from its chart comments and examples. 24 files changed, none added or removed.
- **Licence:** BUSL-1.1, licensor Inflect Ltd. (the package's `"license"` field is kept). Copying is allowed by [ADR 0001](docs/adr/0001-code-provenance-and-licences.md) decision D1.
- **Third-party origin:** much of the package derives from Dub (`github.com/dubinc/dub`, AGPL-3.0 outside its `(ee)` folders; "Copyright (c) 2024-present Dub Technologies, Inc."), and the Nucleo icons carry Nucleo's terms. The owner decided to copy them as they are and accept the licence risk (ADR 0001 decision D4). A file is marked Dub-derived when `docs/porting/licence/dub-overlap.py` finds at least 50% of its normalised lines in Dub's `packages/ui` or `packages/utils` at `6b463b4bdd9ed2fd9aa416f67b5b77d317b1471e` (74 files); line overlap shows shared text, not who wrote it first. The 270 Nucleo icon files are marked as such. [`NOTICE`](NOTICE) carries both attributions.
- **Changes:** none. `packages/ui/UPSTREAM.json` records each file's sha256; `node scripts/ui-drift.mjs verify` fails on any edit, and `audit` fails when the manifest does not match the package at the commit above ([`docs/porting/shared-ui.md`](docs/porting/shared-ui.md)).

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

## Copied: generic UI (sub-phase 1.2, part B)

The generic files under inflect-compliance's `src/components/ui` and `src/lib/hooks`, with the files they need to compile, copied to the same paths under Islestone's `src/` ([`docs/porting/maps/1.2.md`](docs/porting/maps/1.2.md), sections 1, 2 and 8). These facts hold for every row below:

- **Source:** inflect-compliance at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`, the path named in each row (for the first two tables, the same path as in Islestone). Re-pinned on 2026-11-20 to `f916dfaea78d9ed979c1ccf162cffcf9bfcbd8a1` (owner decision 56; inflect-compliance #5778): only `src/components/ui/filter/filter-select.tsx` and `filter-context.tsx` changed, so an unchanged search no longer writes the URL. `ui-mirror.json` names that commit.
- **Licence:** BUSL-1.1, licensor Inflect Ltd. Copying is allowed by [ADR 0001](docs/adr/0001-code-provenance-and-licences.md) decision D1.
- **Third-party origin:** as for `@inflect/ui` above, a file is marked Dub-derived when `docs/porting/licence/dub-overlap.py` finds at least 50% of its normalised lines in Dub's `packages/ui` or `packages/utils` at `6b463b4bdd9ed2fd9aa416f67b5b77d317b1471e`; 14 of the copied files are (13 primitives and `icons/icon-type.ts`). They are taken as they are, with the licence risk accepted (ADR 0001 D4); [`NOTICE`](NOTICE) carries Dub's attribution. The `dub-*` icons, `plan-feature-icons.tsx`, `form.tsx`, `number-stepper.tsx`, `slider.tsx` and `charts/funnel-chart.tsx`, which the measurement also links to Dub, are not copied.
- **Mirror:** [`ui-mirror.json`](ui-mirror.json) records the sha256 of each "mirror" file. `node scripts/ui-mirror.mjs verify` fails on an edit, a missing file, or an unlisted file under `src/components/ui` or `src/lib/hooks`; `audit` fails unless every hash equals the upstream file at the commit. A "fork" is listed there as Islestone-owned. Two upstream files under the roots are excluded on purpose: `src/components/ui/filter/GUIDE.md` and `src/components/ui/table/GUIDE.md` (inflect's contributor guides).
- **Not taken:** `dashboard-widgets/index.ts` (CUT), `dashboard-widgets/TargetLine.tsx` and `dashboard-widgets/types.ts` (sub-phase 3.6), and every MIXED file the map marks optional or SKIP, and every COUPLED file.
- **Not in the map:** `src/types/tanstack-table.d.ts`, the `ColumnMeta` augmentation `table/table.tsx` needs to compile (`disableTruncate`, `headerTooltip`), is copied byte for byte and mirrored too.

<details>
<summary>The 130 copied code files: 127 mirrored, 3 forked</summary>

| File | Kind | Third-party origin | Changes |
|---|---|---|---|
| `src/components/ui/ActionCluster.tsx` | mirror | — | None |
| `src/components/ui/FileDropzone.tsx` | mirror | — | None |
| `src/components/ui/TabSection.tsx` | mirror | — | None |
| `src/components/ui/TrendCard.tsx` | mirror | — | None |
| `src/components/ui/accordion.tsx` | mirror | — | None |
| `src/components/ui/animated-number.tsx` | mirror | — | None |
| `src/components/ui/animated-size-container.tsx` | mirror | Dub-derived: 100% shared lines with Dub `packages/ui/src/animated-size-container.tsx` (AGPL-3.0) | None |
| `src/components/ui/breadcrumbs.tsx` | mirror | — | None |
| `src/components/ui/button-like-keys.ts` | mirror | — | None |
| `src/components/ui/button-variants.ts` | mirror | — | None |
| `src/components/ui/button.tsx` | mirror | — | None |
| `src/components/ui/card-list/card-list-card.tsx` | mirror | — | None |
| `src/components/ui/card-list/card-list.tsx` | mirror | — | None |
| `src/components/ui/card-list/index.ts` | mirror | — | None |
| `src/components/ui/card-variants.ts` | mirror | — | None |
| `src/components/ui/card.tsx` | mirror | — | None |
| `src/components/ui/checkbox.tsx` | mirror | — | None |
| `src/components/ui/checklist-gear-button.tsx` | mirror | — | None |
| `src/components/ui/checklist-order.ts` | mirror | — | None |
| `src/components/ui/combobox/index.tsx` | mirror | Dub-derived: 53% shared lines with Dub `packages/ui/src/combobox/index.tsx` (AGPL-3.0) | None |
| `src/components/ui/combobox/messages.ts` | mirror | — | None |
| `src/components/ui/combobox/virtualized-options.tsx` | mirror | — | None |
| `src/components/ui/confirm-dialog.tsx` | mirror | — | None |
| `src/components/ui/control-variants.ts` | mirror | — | None |
| `src/components/ui/copy-button.tsx` | mirror | — | None |
| `src/components/ui/dashboard-widgets/DashboardGrid.tsx` | mirror | — | None |
| `src/components/ui/dashboard-widgets/DashboardWidget.tsx` | mirror | — | None |
| `src/components/ui/date-picker/calendar.tsx` | mirror | — | None |
| `src/components/ui/date-picker/date-picker.tsx` | mirror | — | None |
| `src/components/ui/date-picker/date-range-picker.tsx` | mirror | — | None |
| `src/components/ui/date-picker/date-utils.ts` | mirror | — | None |
| `src/components/ui/date-picker/index.ts` | mirror | — | None |
| `src/components/ui/date-picker/presets-catalogue.ts` | mirror | — | None |
| `src/components/ui/date-picker/presets.tsx` | mirror | — | None |
| `src/components/ui/date-picker/shared.ts` | mirror | Dub-derived: 100% shared lines with Dub `packages/ui/src/date-picker/shared.ts` (AGPL-3.0) | None |
| `src/components/ui/date-picker/trigger.tsx` | mirror | — | None |
| `src/components/ui/date-picker/types.ts` | mirror | Dub-derived: 53% shared lines with Dub `packages/ui/src/date-picker/types.ts` (AGPL-3.0) | None |
| `src/components/ui/date-picker/week-start.ts` | mirror | — | None |
| `src/components/ui/empty-state.tsx` | mirror | — | None |
| `src/components/ui/error-state.tsx` | mirror | — | None |
| `src/components/ui/field-group.tsx` | mirror | — | None |
| `src/components/ui/file-icon-resolver.ts` | mirror | — | None |
| `src/components/ui/file-type-icon.tsx` | mirror | — | None |
| `src/components/ui/filter/edit-filters-button.tsx` | mirror | — | None |
| `src/components/ui/filter/filter-context.tsx` | mirror | — | None |
| `src/components/ui/filter/filter-definitions.ts` | mirror | — | None |
| `src/components/ui/filter/filter-list.tsx` | mirror | Dub-derived: 85% shared lines with Dub `packages/ui/src/filter/filter-list.tsx` (AGPL-3.0) | None |
| `src/components/ui/filter/filter-range-panel.tsx` | mirror | Dub-derived: 90% shared lines with Dub `packages/ui/src/filter/filter-range-panel.tsx` (AGPL-3.0) | None |
| `src/components/ui/filter/filter-range-utils.ts` | mirror | Dub-derived: 86% shared lines with Dub `packages/ui/src/filter/filter-range-panel.tsx` (AGPL-3.0) | None |
| `src/components/ui/filter/filter-scroll.tsx` | mirror | Dub-derived: 96% shared lines with Dub `packages/ui/src/filter/filter-scroll.tsx` (AGPL-3.0) | None |
| `src/components/ui/filter/filter-select-utils.ts` | mirror | — | None |
| `src/components/ui/filter/filter-select.tsx` | mirror | Dub-derived: 68% shared lines with Dub `packages/ui/src/filter/filter-select.tsx` (AGPL-3.0) | None |
| `src/components/ui/filter/filter-state.ts` | mirror | — | None |
| `src/components/ui/filter/index.ts` | mirror | — | None |
| `src/components/ui/filter/types.ts` | mirror | Dub-derived: 82% shared lines with Dub `packages/ui/src/filter/types.ts` (AGPL-3.0) | None |
| `src/components/ui/filter/use-filter-card-visibility.tsx` | mirror | — | None |
| `src/components/ui/filter/use-filter-presets.ts` | mirror | — | None |
| `src/components/ui/filter/use-retained-filter-options.ts` | mirror | — | None |
| `src/components/ui/form-description.tsx` | mirror | — | None |
| `src/components/ui/form-error.tsx` | mirror | — | None |
| `src/components/ui/form-field.tsx` | mirror | — | None |
| `src/components/ui/freshness.ts` | mirror | — | None |
| `src/components/ui/hit-area.ts` | mirror | — | None |
| `src/components/ui/hooks/__tests__/use-autosave-fields.test.tsx` | mirror | — | None |
| `src/components/ui/hooks/__tests__/use-toast-with-undo.test.ts` | mirror | — | None |
| `src/components/ui/hooks/index.ts` | mirror | — | None |
| `src/components/ui/hooks/use-keyboard-shortcut.tsx` | mirror | — | None |
| `src/components/ui/hooks/use-toast-with-undo.ts` | mirror | — | None |
| `src/components/ui/hooks/use-view-mode.ts` | mirror | — | None |
| `src/components/ui/icons/icon-type.ts` | mirror | Dub-derived: 100% shared lines with Dub `packages/ui/src/icons/index.tsx` (AGPL-3.0) | None |
| `src/components/ui/initials-avatar.tsx` | mirror | — | None |
| `src/components/ui/inline-notice.tsx` | mirror | — | None |
| `src/components/ui/input.tsx` | mirror | — | None |
| `src/components/ui/kpi-filter/index.ts` | mirror | — | None |
| `src/components/ui/kpi-filter/use-kpi-filter.ts` | mirror | — | None |
| `src/components/ui/label.tsx` | mirror | Dub-derived: 90% shared lines with Dub `packages/ui/src/label.tsx` (AGPL-3.0) | None |
| `src/components/ui/modal.tsx` | mirror | — | None |
| `src/components/ui/overlay-depth.tsx` | mirror | — | None |
| `src/components/ui/popover.tsx` | mirror | — | None |
| `src/components/ui/progressive-blur.tsx` | mirror | — | None |
| `src/components/ui/radio-group.tsx` | mirror | — | None |
| `src/components/ui/required-marker.tsx` | mirror | — | None |
| `src/components/ui/scroll-container.tsx` | mirror | — | None |
| `src/components/ui/sheet.tsx` | mirror | — | None |
| `src/components/ui/skeleton.tsx` | mirror | — | None |
| `src/components/ui/status-badge.tsx` | mirror | — | None |
| `src/components/ui/switch.tsx` | mirror | — | None |
| `src/components/ui/table/column-visibility-utils.ts` | mirror | — | None |
| `src/components/ui/table/columns-dropdown.tsx` | mirror | — | None |
| `src/components/ui/table/data-table-cards.tsx` | mirror | — | None |
| `src/components/ui/table/data-table.tsx` | mirror | — | None |
| `src/components/ui/table/edit-columns-button.tsx` | mirror | — | None |
| `src/components/ui/table/features.ts` | mirror | — | None |
| `src/components/ui/table/index.ts` | mirror | — | None |
| `src/components/ui/table/infinite-scroll-sentinel.tsx` | mirror | — | None |
| `src/components/ui/table/pagination-controls.tsx` | mirror | — | None |
| `src/components/ui/table/pagination-utils.ts` | mirror | — | None |
| `src/components/ui/table/selection-toolbar.tsx` | mirror | — | None |
| `src/components/ui/table/sort-rows.ts` | mirror | — | None |
| `src/components/ui/table/table-empty-state.tsx` | mirror | — | None |
| `src/components/ui/table/table-utils.ts` | mirror | — | None |
| `src/components/ui/table/table.tsx` | mirror | — | None |
| `src/components/ui/table/types.ts` | mirror | Dub-derived: 53% shared lines with Dub `packages/ui/src/table/types.ts` (AGPL-3.0) | None |
| `src/components/ui/table/use-columns-dropdown.tsx` | mirror | — | None |
| `src/components/ui/table/use-is-below-md.ts` | mirror | — | None |
| `src/components/ui/table/use-list-pagination.ts` | mirror | — | None |
| `src/components/ui/table/use-table-pagination.tsx` | mirror | Dub-derived: 100% shared lines with Dub `packages/ui/src/table/use-table-pagination.tsx` (AGPL-3.0) | None |
| `src/components/ui/table/virtual-table-body.tsx` | mirror | — | None |
| `src/components/ui/textarea.tsx` | mirror | — | None |
| `src/components/ui/timestamp-tooltip.tsx` | mirror | — | None |
| `src/components/ui/toggle-group.tsx` | mirror | — | None |
| `src/components/ui/tooltip.tsx` | mirror | — | None |
| `src/components/ui/typography.tsx` | mirror | — | None |
| `src/components/ui/undo-toast.tsx` | mirror | — | None |
| `src/components/ui/virtualized-list.tsx` | mirror | — | None |
| `src/lib/filters/filter-presets.ts` | mirror | — | None |
| `src/lib/format-bytes.ts` | mirror | — | None |
| `src/lib/hooks/__tests__/use-zod-form.test.tsx` | mirror | — | None |
| `src/lib/hooks/keyboard-shortcut-internals.ts` | mirror | — | None |
| `src/lib/hooks/use-dropped-link-click-guard.ts` | mirror | — | None |
| `src/lib/hooks/use-hydrated-now.ts` | mirror | — | None |
| `src/lib/hooks/use-keyboard-inset.ts` | mirror | — | None |
| `src/lib/hooks/use-keyboard-shortcut.tsx` | mirror | — | None |
| `src/lib/hooks/use-zod-form.ts` | mirror | — | None |
| `src/lib/hooks/useUrlFilters.ts` | mirror | — | None |
| `src/lib/text-utils.ts` | mirror | — | None |
| `src/types/tanstack-table.d.ts` | mirror | — | None |
| `src/components/ui/charts/index.ts` | fork | — | Islestone stub at the upstream path: only `export * from '@inflect/ui/components/ui/charts'`; upstream also declares five chart modules and two risk charts not taken |
| `src/components/ui/icons/index.tsx` | fork | — | Upstream barrel minus the seven `./dub-*` and `./plan-feature-icons` re-exports, plus a header comment; the 57 package re-exports and the `Icon` type are unchanged |
| `src/lib/ui-storage.ts` | fork | — | `UI_STORAGE_PREFIX` is `'islestone'` (upstream `'inflect'`); the docblock examples spell `islestone`, and the two paragraphs about inflect's own keys and server namespaces are generalised |

</details>

<details>
<summary>The 111 copied tests under tests/ (Islestone-owned, not mirrored)</summary>

Copied from the same path in inflect-compliance. Map section 5.2 lists the tests taken unchanged, section 5.3 those taken with an edit. The three tests inside the mirrored roots (`src/components/ui/hooks/__tests__/*`, `src/lib/hooks/__tests__/use-zod-form.test.tsx`) are in the table above.

| File | Changes |
|---|---|
| `tests/guards/action-cluster-discipline.test.ts` | None |
| `tests/guards/card-padding-cascade.test.ts` | None (it compiles Islestone's `src/app/globals.css` through `tests/helpers/compile-globals-css.mjs`) |
| `tests/guards/checklist-gear-primitive.test.ts` | None |
| `tests/guards/datatable-row-chevron-affordance.test.ts` | None |
| `tests/guards/datatable-row-double-click.test.ts` | None |
| `tests/guards/edit-columns-no-tooltip-wrap.test.ts` | None |
| `tests/guards/interaction-state-discipline.test.ts` | None |
| `tests/guards/legacy-data-table-parity.test.ts` | None (reads Islestone's `src/app/globals.css`, which carries the `.data-table` recipe) |
| `tests/guards/mobile-datatable-cards.test.ts` | None |
| `tests/guards/mobile-touch-targets.test.ts` | None (reads Islestone's `src/app/globals.css`, which carries the coarse-pointer block) |
| `tests/guards/modal-fly-in.test.ts` | Reads the keyframes and `--animate-*` keys from `src/app/globals.css` (`@theme`) instead of `tailwind.config.js` |
| `tests/guards/sort-affordance.test.ts` | None |
| `tests/guards/still-surface-button-material.test.ts` | Dropped the `notifications-bell.tsx` entries from two lists and the FilterToolbar rung case (app shell, 1.7); reads Islestone's `src/styles/tokens.css` |
| `tests/guards/ui-canonical-tooltips.test.ts` | None |
| `tests/guards/ui-hooks-barrel.test.ts` | None |
| `tests/rendered/animated-number.test.tsx` | None |
| `tests/rendered/breadcrumbs.test.tsx` | None |
| `tests/rendered/button-disabled-tooltip-props.test.tsx` | None |
| `tests/rendered/button-icon-child-row.test.tsx` | None |
| `tests/rendered/button-label-centering.test.tsx` | None |
| `tests/rendered/button-loading-disables.test.tsx` | None |
| `tests/rendered/button-loading-touch-target.test.tsx` | None |
| `tests/rendered/card-list.test.tsx` | None |
| `tests/rendered/card.test.tsx` | None |
| `tests/rendered/checkbox-control-edge.test.tsx` | None |
| `tests/rendered/checklist-gear-primitive.test.tsx` | None |
| `tests/rendered/confirm-dialog-drawer-pending.test.tsx` | None |
| `tests/rendered/confirm-dialog-pending.test.tsx` | None |
| `tests/rendered/confirm-dialog.test.tsx` | None |
| `tests/rendered/core-shortcuts.test.tsx` | One eslint-disable line naming the rules Islestone's config enforces and inflect's allows |
| `tests/rendered/dashboard-grid-mobile-stack.test.tsx` | None |
| `tests/rendered/data-table-append-reflow.test.tsx` | None |
| `tests/rendered/data-table-bulk-bar-and-load-on-every-renderer.test.tsx` | None |
| `tests/rendered/data-table-cards-list-semantics.test.tsx` | None |
| `tests/rendered/data-table-column-resize.test.tsx` | None |
| `tests/rendered/data-table-grouped-header.test.tsx` | None |
| `tests/rendered/data-table-id-selector-contract.test.tsx` | None |
| `tests/rendered/data-table-mobile-cards.test.tsx` | None |
| `tests/rendered/data-table-mobile-fallback.test.tsx` | None |
| `tests/rendered/data-table-prefetch.test.tsx` | None |
| `tests/rendered/data-table-row-expansion.test.tsx` | None |
| `tests/rendered/data-table-row-hover.test.tsx` | None |
| `tests/rendered/data-table-row-memoization.test.tsx` | None |
| `tests/rendered/data-table-row-selection.test.tsx` | None |
| `tests/rendered/data-table-scroll-smoothness.test.tsx` | None |
| `tests/rendered/data-table-virtualize.test.tsx` | None |
| `tests/rendered/date-picker-ui.test.tsx` | None |
| `tests/rendered/date-pickers.test.tsx` | None |
| `tests/rendered/edit-columns-button-click.test.tsx` | None |
| `tests/rendered/empty-state-cleared-filters.test.tsx` | None |
| `tests/rendered/empty-state.test.tsx` | None |
| `tests/rendered/error-state.test.tsx` | None |
| `tests/rendered/file-dropzone.test.tsx` | None |
| `tests/rendered/focus-accent-seam.test.tsx` | Theme blocks repointed to Islestone's: light `:root,\n[data-theme="light"]`, dark `[data-theme="dark"]` |
| `tests/rendered/form-field-validation.test.tsx` | None |
| `tests/rendered/form-field.test.tsx` | None |
| `tests/rendered/infinite-scroll-sentinel.test.tsx` | None |
| `tests/rendered/initials-avatar.test.tsx` | None |
| `tests/rendered/inline-notice.test.tsx` | None |
| `tests/rendered/input-autofill-hygiene.test.tsx` | None |
| `tests/rendered/input-mobile-inputmode.test.tsx` | None |
| `tests/rendered/input-submit-hooks.test.tsx` | None |
| `tests/rendered/keyboard-inset.test.tsx` | None |
| `tests/rendered/keyboard-shortcut-hook.test.tsx` | None |
| `tests/rendered/keyboard-shortcut-internals-edges.test.ts` | None |
| `tests/rendered/keyboard-shortcut-parse.test.ts` | None |
| `tests/rendered/keyboard-shortcut-registry-edges.test.tsx` | None |
| `tests/rendered/modal-focus-return.test.tsx` | None |
| `tests/rendered/modal.test.tsx` | None |
| `tests/rendered/observer-scroll-hooks.test.tsx` | None |
| `tests/rendered/overlay-depth.test.tsx` | None |
| `tests/rendered/persistence-optimistic-hooks.test.tsx` | None |
| `tests/rendered/popover-menu-keys.test.tsx` | None |
| `tests/rendered/popover-nested.test.tsx` | None |
| `tests/rendered/popover-trigger-tooltip.test.tsx` | None |
| `tests/rendered/progressive-blur.test.tsx` | None |
| `tests/rendered/sheet-left.test.tsx` | None |
| `tests/rendered/textarea-describedby.test.tsx` | None |
| `tests/rendered/timestamp-rollout.test.tsx` | None |
| `tests/rendered/timestamp-tooltip.test.tsx` | None |
| `tests/rendered/toggle-group-label-case.test.tsx` | None |
| `tests/rendered/tooltip.test.tsx` | None |
| `tests/rendered/trend-card.test.tsx` | None |
| `tests/rendered/typography.test.tsx` | None |
| `tests/rendered/undo-toast.test.tsx` | None |
| `tests/rendered/use-columns-dropdown.test.tsx` | None |
| `tests/rendered/use-filter-card-visibility.test.tsx` | None |
| `tests/rendered/use-kpi-filter-coexistence.test.tsx` | None |
| `tests/rendered/use-kpi-filter.test.tsx` | None |
| `tests/rendered/use-toast-with-undo.test.tsx` | One eslint-disable line naming the rules Islestone's config enforces and inflect's allows |
| `tests/rendered/useUrlFilters.test.tsx` | One eslint-disable line naming the rules Islestone's config enforces and inflect's allows |
| `tests/rendered/filter-toolbar-no-noop-url-write.test.tsx` (from inflect-compliance `f916dfaea78d9ed979c1ccf162cffcf9bfcbd8a1`, #5778) | None |
| `tests/rendered/virtual-table-body.test.tsx` | None |
| `tests/rendered/virtualized-list.test.tsx` | None |
| `tests/unit/checklist-order.test.ts` | None |
| `tests/unit/components/date-picker-tz-bridge.test.ts` | None |
| `tests/unit/data-table.test.ts` | Storage-key case expects `islestone:col-vis:` (the `ui-storage.ts` fork); dropped the suites that walk inflect list pages and the table `GUIDE.md` case; an eslint-disable line |
| `tests/unit/date-picker-foundation.test.ts` | None |
| `tests/unit/epic55-field-wrapper.test.ts` | None |
| `tests/unit/epic55-form-primitives.test.ts` | None |
| `tests/unit/filter-foundation.test.ts` | Dropped the `filter-examples.ts` and `GUIDE.md` layout cases and their markdown readers; an eslint-disable line |
| `tests/unit/filter-primitives.test.ts` | None |
| `tests/unit/filter-select.test.ts` | One eslint-disable line naming the rules Islestone's config enforces and inflect's allows |
| `tests/unit/filter-system.test.ts` | None |
| `tests/unit/freshness.test.ts` | None |
| `tests/unit/keyboard-shortcut-layout-independence.test.ts` | None |
| `tests/unit/list-pagination.test.ts` | Dropped the "Epic 52 adoption" suite (inflect list pages) |
| `tests/unit/modal-primitive.test.ts` | Dropped the raw-overlay ratchet over `src/app/t` |
| `tests/unit/responsive-modal-sheet.test.ts` | None |
| `tests/unit/retained-filter-options.test.ts` | None |
| `tests/unit/sheet-popover.test.ts` | None |
| `tests/unit/sort-rows-by-display.test.ts` | None |

</details>

<details>
<summary>Test infrastructure and styles, copied or adapted</summary>

| Islestone file | inflect-compliance source | Changes |
|---|---|---|
| `__mocks__/next-intl.js` | `__mocks__/next-intl.js` | One eslint-disable line |
| `tests/helpers/source-blocks.ts` | `tests/helpers/source-blocks.ts` | None |
| `tests/helpers/repo-files.ts` | `tests/helpers/repo-files.ts` | None |
| `tests/helpers/compile-globals-css.mjs` | `tests/helpers/compile-globals-css.mjs` | No autoprefixer (Islestone's postcss chain has none); shorter header |
| `tests/setup/jsdom-shims.ts` | `tests/setup/jsdom-shims.ts` | None |
| `tests/setup/rendered.ts` | `tests/rendered/setup.ts` | Moved to Islestone's setup path; imports `./jsdom-shims`; new header |
| `tests/rendered/vaul-mock.tsx` | `tests/rendered/vaul-mock.tsx` | None |
| `tests/rendered/number-flow-mock.tsx` | `tests/rendered/number-flow-mock.tsx` | None |
| `messages/en.json` | `messages/en.json` | Only the 127 leaves the shared UI reads (map section 6.6): whole `common.upload`, `calendar`, `fileKinds`, `error`, `skeleton`, `copy`, `table` and `ui.combobox`; 24 `common.ui` keys, 4 `common.chart` keys, `common.cancel` and `common.close` |
| `src/styles/tokens.css` | `packages/ui/tokens.contract.css` (light values) and `src/styles/tokens.css` (the extra property names, the shadow form of `--ctrl-edge-focus`, `--btn-still-lift`, `--btn-still-press`) | Written for Islestone: the contract's 47 names plus the map section 6.1 extras in a light theme (the contract's neutral fallback values, `--btn-still-danger-lift` darkened to clear 4.5:1) and an Islestone dark theme; `data-theme` selectors |
| `src/app/globals.css` | `src/app/globals.css` (the `.glass-card`, `.surface-popup-texture`, `.data-table`, `.animate-fadeIn` recipes and the coarse-pointer block) and `tailwind.config.js` (the `theme.extend` keys) | Recipes copied into the same layers; the Tailwind 4 theme keys rewritten as `@theme` CSS; only the keys the copied set uses |

</details>

## Copied: tenancy and data core (sub-phase 1.3)

Prisma, the tenancy models, row-level security and the tenant-context plumbing, ported by [`docs/porting/maps/1.3.md`](docs/porting/maps/1.3.md). These facts hold for every row below:

- **Source:** inflect-compliance at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`, at the path in the row's Source column.
- **Licence:** BUSL-1.1, licensor Inflect Ltd. Copying is allowed by [ADR 0001](docs/adr/0001-code-provenance-and-licences.md) decision D1. The source files carry no per-file notice, so none is added, and `NOTICE` takes no entry: no third-party material came with them.
- **What every port changed:** compliance-domain imports, models, columns and examples were cut (what belongs to a later sub-phase is named in the map); role names follow [ADR 0006](docs/adr/0006-vocabulary.md) (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`, `GUEST`, no `AUDITOR`/`canAudit`); guards take their population from `gitFiles()` and prove themselves on a planted fixture; allowlists, baselines and population floors were emptied or set to Islestone's real counts.
- **Action** is COPY (byte for byte), COPY+EDIT (the source text, edited as the Changes column says), REWRITE (written fresh to the source's design, reusing its structure), or PATTERN (pattern only, no code copied).

<details>
<summary>All 84 rows</summary>

| File | Source | Action | Changes |
|---|---|---|---|
| `prisma.config.ts` | `prisma.config.ts` | COPY+EDIT | Loads `.env` files with `@next/env`'s `loadEnvConfig` first (the CLI does not read `.env.local` itself). |
| `prisma/schema/base.prisma` | `prisma/schema/base.prisma` | COPY+EDIT | Header domain list rewritten to base, enums, tenancy. |
| `prisma/schema/enums.prisma` | `prisma/schema/enums.prisma` | COPY+EDIT | Three of 170 enums kept. `Role` takes ADR 0006's five values in seniority order; `ORG_OWNER` declared first (a fresh history needs no two-deploy append). Doc comments rewritten. |
| `prisma/schema/tenancy.prisma` | `prisma/schema/auth.prisma` | COPY+EDIT | Five models kept with the map's field lists; every compliance column and back-relation cut, `customRoleId` and `lineOfDefence` dropped. `User.email` plaintext `@unique` with no `@map`, no `emailHash` (1.5). `TenantMembership.role` defaults to `VIEWER`. `@@index([invitedByUserId])` added so no FK needs an index exemption. |
| `prisma/schema/README.md` | `prisma/schema/README.md` | REWRITE | Keeps the one-owner, base-only generator, enums-only and migration-discipline conventions; the compliance layout table and the stale preview-flag text are gone. |
| `prisma/migrations/migration_lock.toml` | `prisma/migrations/migration_lock.toml` | COPY | None. |
| `prisma/migrations/20261119120000_tenancy_core/migration.sql` | `20260323180000_apply_full_rls_setup` (L21–36, L331–338), `20260323182100_add_superuser_bypass_policies` (L112–113), `20260426060000_add_organization_layer_rls` (L60–103), `20261112160000_tenant_owner_guard_serialised` (L37–86), `20260424220000_epic1_last_owner_trigger` (L48–51), `20261112130500_org_owner_guard_serialised` (L32–67), `20261030160000_org_owner_backfill_and_guard` (L76–79); rationale from `docs/implementation-notes/2026-11-12-fix-5388-tenant-owner-race.md` and `2026-11-12-fix-5373-org-owner-race.md` | REWRITE | One fresh migration: tables generated by `prisma migrate diff`, then the role and grants (minus `GRANT app_user TO postgres`, plus an explicit grant of the five tables), Class-A RLS, the org-axis RLS and both last-owner triggers in their final serialised form, copied as SQL. No source migration is replayed; the org backfill is skipped. |
| `prisma/init-roles.sh` | `prisma/init-roles.sh` | COPY+EDIT | The placeholder `postgres` role is removed; the login role is quoted in the final grant. |
| `scripts/check-fresh-db-schema-drift.mjs` | `scripts/check-fresh-db-schema-drift.mjs` | COPY+EDIT | Logic verbatim. Header prose about inflect's measured residue, its two residue groups and its PR advice rewritten. |
| `prisma/fresh-db-schema-drift.expected.sql` | `prisma/fresh-db-schema-drift.expected.sql` | REWRITE | Header only; the residue is empty. |
| `src/env.ts` (Islestone's file, edited) | `src/env.ts` L41–52 | PATTERN | `DATABASE_URL` made required; `DIRECT_DATABASE_URL`, `DATABASE_READ_URL` and `LOG_LEVEL` added with Islestone's `z.url({ protocol })` shape. |
| `src/types/globals.d.ts` | `src/types/globals.d.ts` | COPY+EDIT | The CSS module declarations are removed; `EdgeRuntime` kept. |
| `src/lib/observability/context.ts` | `src/lib/observability/context.ts` | COPY+EDIT | One doc example route. |
| `src/lib/observability/logger.ts` | `src/lib/observability/logger.ts` | COPY+EDIT | `NODE_ENV` and `LOG_LEVEL` read through `@/env`; the directory-identifier redaction comment and the transport comment rewritten. |
| `src/lib/errors/types.ts` | `src/lib/errors/types.ts` | COPY+EDIT | The three compliance `DomainErrorCode` members and their JSDoc removed; `let payload` → `const` for lint. |
| `src/lib/db/concurrency-limits.ts` | `src/lib/db/concurrency-limits.ts` | COPY+EDIT | Code verbatim; compliance examples in comments rewritten as "a tenant-scoped write in a usecase" with the inflect run and issue numbers kept. |
| `src/lib/db/kek-bypass-sources.ts` | `src/lib/db/kek-bypass-sources.ts` | COPY+EDIT | One example job name. |
| `src/lib/audit-context.ts` | `src/lib/audit-context.ts` | COPY+EDIT | Two comment examples. |
| `src/lib/prisma.ts` | `src/lib/prisma.ts` | COPY+EDIT | The audit, soft-delete, field-encryption and PII extensions and their imports cut (1.5, 2.1); the chain is the RLS tripwire alone, with a comment marking where the others go; `recordSlowQuery` and the PII registration log removed. |
| `src/lib/db-context.ts` | `src/lib/db-context.ts` | COPY+EDIT | `runInGlobalContext` deleted; `import type` for `PrismaClient`; doc examples renamed. |
| `src/lib/db/rls-middleware.ts` | `src/lib/db/rls-middleware.ts` | COPY+EDIT | `OWNERSHIP_CHAINED_MODELS` empty; `library-import` reason removed; `runInGlobalContext` re-export, `installRlsTripwire` and `_resetTripwireInstallState` removed; an undefined-capture guard in `extractCallerFingerprint`. |
| `src/lib/tenant-context.ts` | `src/lib/tenant-context.ts` | COPY+EDIT | Custom roles and `canAudit` removed; `ROLE_ORDER` rewritten for the five roles (provisional until 1.4); the lookups go through `runWithoutRls({ reason: 'auth-tenant-discovery' })`. |
| `src/lib/org-roles.ts` | `src/lib/org-roles.ts` | COPY+EDIT | Code verbatim; the header's two-deploy rollout history replaced. |
| `src/lib/permissions.ts` | `src/lib/permissions.ts` (L895–988) | REWRITE | A 1.3 stub: `getPermissionsForRole` grants nothing; `getOrgPermissions` keeps the source switch with four flags (`canViewWorkspaces` replaces `canViewPortfolio`; the compliance flags are gone). |
| `src/lib/auth/session.ts` | `src/lib/auth.ts` (`getSessionOrThrow`) | REWRITE | A 1.3 stub that always throws 401. |
| `src/lib/server/tenant-context.server.ts` | `src/lib/server/tenant-context.server.ts` | COPY+EDIT | Gate-free: the SSO, Entra and "Enforce SSO" gates, `currencySymbol` and `modules` removed. |
| `src/lib/server/org-context.server.ts` | `src/lib/server/org-context.server.ts` | COPY+EDIT | The `ssoTenantId` parameter and refusal removed; header reference edited. |
| `src/app-layer/types.ts` | `src/app-layer/types.ts` | COPY+EDIT | `canAudit`, API-key and agent fields and `A2aInboundOrigin` cut; `ActorType` declared locally; the `OrgContext` doc rewritten. |
| `src/app-layer/context.ts` | `src/app-layer/context.ts` | COPY+EDIT | Session-only `getTenantCtx` and `getOrgCtx`: `getLegacyCtx`, `tryApiKeyAuth`, the MFA/SSO/Entra/API-key gates and the `context-system` re-export deleted; imports trimmed; default `prisma` import kept. |
| `src/app-layer/usecases/tenant-owner-lock.ts` | `src/app-layer/usecases/tenant-owner-lock.ts` | COPY | None. |
| `src/app-layer/usecases/org-owner-lock.ts` | `src/app-layer/usecases/org-members.ts` (L438–456) | REWRITE | The private `lockOrgAdministrators` lifted into exported `orgOwnerLockKey` and `lockOrgOwners`, shaped like `tenant-owner-lock.ts`. |
| `tests/helpers/db.ts` | `tests/helpers/db.ts` | COPY+EDIT | Per-worker cloning, run lock, run marker, drift alarm and checkout machinery cut; URL resolution `DATABASE_URL_TEST` → `DATABASE_URL`; `migrateTestDb` throws and resolves the CLI through Node; `prismaTestClient` typed and extension-free; `RESET_TABLES` set to the five tables. |
| `tests/helpers/make-context.ts` | `tests/helpers/make-context.ts` | COPY+EDIT | Islestone roles; `canAudit` dropped; per-role constants renamed. |
| `tests/helpers/prisma-schema.ts` | `tests/helpers/prisma-schema.ts` | COPY+EDIT | Header only. |
| `tests/helpers/prisma-schema-models.ts` | `tests/helpers/prisma-schema-models.ts` | COPY+EDIT | `parseSchemaModelsFrom(text)` exported for planted schemas. |
| `tests/helpers/prisma-enum-order.ts` | `tests/helpers/prisma-enum-order.ts` | COPY+EDIT | Migrations from `gitFiles()`; `reconstructEnumOrder`, `parseDeclaredEnums` and `computeEnumOrderReport` take their inputs, so the guard can run on planted SQL. |
| `tests/helpers/source-blocks.ts` | `tests/helpers/source-blocks.ts` | COPY | None. Its comments cite inflect-compliance tests by path. |
| `tests/helpers/rls-policies.ts` | `tests/guardrails/rls-coverage.test.ts` (static half, `ORG_SCOPED_MODELS`) | COPY+EDIT | The org-axis map and the CREATE POLICY detector lifted into a shared helper; migrations from `gitFiles()` with comments blanked; extended to the tenant axis. |
| `tests/integration/db-helper.ts` | `tests/integration/db-helper.ts` | COPY+EDIT | Resolution through `getTestDatabaseUrl()` only; the `.env` file fallbacks and the teardown note removed. |
| `tests/integration/db-availability.ts` | `tests/integration/db-availability.ts` | COPY+EDIT | `docker compose up -d` hint and the `Test` job reference. |
| `tests/setup/integration-global-setup.ts` | `tests/setup/globalSetup.ts` | REWRITE | Runs `migrateTestDb()` once when the database is reachable. |
| `tests/setup/integration-env.ts` | `tests/helpers/resolve-test-database-url.js` | PATTERN | Points `DATABASE_URL`/`DIRECT_DATABASE_URL` at the test database before any suite loads `@/lib/prisma`. |
| `tests/setup/disconnect-after-suite.ts` | `tests/setup/disconnect-after-suite.ts` | COPY+EDIT | Redis, queue, audit-stream and mailer drains removed; `prismaRead` disconnected too. |
| `tests/integration/rls-coverage.test.ts` | `tests/guardrails/rls-coverage.test.ts` (DB half) | COPY+EDIT | `SINGLE_POLICY_EXCEPTIONS` empty; typed `Prisma` import; the inventory floor is an exact list; an `app_user` grant check added. |
| `tests/guards/rls-migration-policies.test.ts` | `tests/guardrails/rls-coverage.test.ts` (static half) | COPY+EDIT | Extended to every tenant-scoped table; planted-repository proof. |
| `tests/guards/tenant-isolation-structural.test.ts` | `tests/unit/tenant-isolation-structural.test.ts` | COPY+EDIT | All allowlists reduced to Islestone's; legacy-route section deleted; each flat fetch judged on its own path; planted proof. |
| `tests/guards/no-direct-prisma.test.ts` | `tests/unit/no-direct-prisma.test.ts` | COPY+EDIT | All four allowlists empty; recursive population; planted proof. |
| `tests/unit/rls-middleware.test.ts` | `tests/unit/rls-middleware.test.ts` | COPY+EDIT | Model lists and tripwire model set to Islestone's; a `library-import` refusal case added. |
| `tests/integration/rls-middleware.test.ts` | `tests/integration/rls-middleware.test.ts` | REWRITE | Class A against `TenantMembership`; SET LOCAL and `runWithoutRls` cases kept; org-axis cases added. |
| `tests/integration/last-owner-guard.test.ts` | `tests/integration/last-owner-guard.test.ts` | COPY+EDIT | Fixtures fit the 1.3 columns; teardown by `resetDatabase`; a sixth case for the soft-deleted-workspace exemption. |
| `tests/integration/tenant-owner-race.test.ts` | `tests/integration/tenant-owner-race.test.ts` (trigger half and helpers) | COPY+EDIT | `twoOwners()` rewritten off `createTenantWithOwner`; usecase and transfer halves dropped (1.4, 8.3); cases for the shared lock key added; timers cleared. |
| `tests/integration/org-owner-race.test.ts` | `tests/integration/org-owner-race.test.ts` (trigger half) | COPY+EDIT | The module-load `jest.mock` and the role-change and removal halves dropped; teardown by `resetDatabase`; a shared-key case added; DB-gated. |
| `tests/integration/org-last-owner-guard.test.ts` | `tests/integration/org-owner-writers.test.ts` (L41–68, L147–187) | COPY+EDIT | The trigger describe and its helpers extracted; DB-gated; teardown by `resetDatabase`. |
| `tests/unit/tenant-context.test.ts` | `tests/unit/tenant-context.test.ts` | COPY+EDIT | Roles, fixture columns, getter mocks for both prisma exports; soft-delete, status and stub-permission cases added. |
| `tests/unit/tenant-context-resolution.test.ts` | `tests/integration/tenant-isolation.test.ts` | COPY+EDIT | Moved to unit (it mocks prisma); roles and the permission table for five roles. |
| `tests/unit/tenant-job-context.test.ts` | `tests/unit/tenant-job-context.test.ts` | COPY+EDIT | The automation-dispatcher case dropped (5.1); example job name. |
| `tests/unit/audit-context-concurrency.test.ts` | `tests/unit/audit-context-concurrency.test.ts` | COPY | None. |
| `tests/unit/db-context-binding.test.ts` | `tests/unit/audit-prior-state-reader-binding.test.ts` | COPY+EDIT | `tenantMembership` delegate; soft-delete-writer binding cases added. |
| `tests/unit/org-context.test.ts` | `tests/unit/org-context.test.ts` | COPY+EDIT | Mocks `@/lib/auth/session`; stub `OrgPermissionSet` assertions; an ORG_OWNER case added. |
| `tests/unit/observability-context.test.ts` | `tests/unit/observability-context.test.ts` | COPY | None. |
| `tests/unit/observability-logger.test.ts` | `tests/unit/observability-logger.test.ts` | COPY+EDIT | Static imports instead of `require`; cases for the level read through `@/env`. |
| `tests/unit/errors.test.ts` | `tests/unit/errors.test.ts` | COPY+EDIT | The eslint-disable comment's references to inflect files. |
| `tests/unit/typed-error-hierarchy.test.ts` | `tests/unit/typed-error-hierarchy.test.ts` | COPY | None. |
| `tests/unit/db/pool-and-tenant-tx-limits.test.ts` | `tests/unit/db/audit-concurrency-limits.test.ts` (L177–202, L270–459 minus L373–452) | COPY+EDIT | The pool-limit and tenant-transaction halves; audit mocks dropped; a hoisted recorder. |
| `tests/unit/tenant-server-context.test.ts` | `tests/unit/tenant-server-context.test.ts` | COPY+EDIT | Gate arguments, `currencySymbol` and the compliance `appPermissions` cases removed; MEMBER role; soft-delete case added. |
| `tests/integration/org-context-server.test.ts` | `tests/integration/org-context-server.test.ts` | COPY+EDIT | `prismaTestClient()`; plaintext email; stub `OrgPermissionSet`; teardown by `resetDatabase`. |
| `tests/integration/connection-pooling.test.ts` | `tests/integration/connection-pooling.test.ts` | COPY+EDIT | The silent private probe replaced by the fail-closed `DB_AVAILABLE` gate; no `console`. |
| `tests/integration/prisma-enum-values-exist-in-pg.test.ts` | `tests/integration/prisma-enum-values-exist-in-pg.test.ts` | COPY+EDIT | Exact denominators (3 enums, 12 values, 0 mapped); the #3903 pin deleted; synthetic names neutral; `prismaTestClient()`. |
| `tests/guards/database-routing-coverage.test.ts` | `tests/guardrails/database-routing-coverage.test.ts` | COPY+EDIT | `ROUTED_USECASES` empty; the no-write rule applied to every `src/` caller; planted proof. |
| `tests/guards/prisma-schema-folder-coverage.test.ts` | `tests/guardrails/prisma-schema-folder-coverage.test.ts` | COPY+EDIT | Islestone's domain files; Helm and entrypoint tests deleted; comment-line floor `> 0`; planted proof. |
| `tests/guards/tenant-isolation-forward-lock.test.ts` | `tests/guardrails/tenant-isolation-forward-lock.test.ts` | COPY+EDIT | `ISOLATION_TESTED` = `TenantMembership`; baseline empty; each test file must use the delegate, `DB_AVAILABLE` and `runInTenantContext`; planted proof. |
| `tests/guards/membership-identity.test.ts` | `tests/guardrails/membership-identity.test.ts` (L1–188) | COPY+EDIT | Schema half on the parsed models; code scan from `gitFiles()`; Islestone role literals; `fail()` replaced; planted proofs. |
| `tests/guards/schema-index-coverage.test.ts` | `tests/guardrails/schema-index-coverage.test.ts` | COPY+EDIT | All maps empty; layers as pure functions; planted proofs. |
| `tests/guards/prisma-major-pin.test.ts` | `tests/guardrails/prisma-major-pin.test.ts` | COPY+EDIT | The check as a pure function with a split-major planted case; not resolving the CLI is a failure. |
| `tests/guards/prisma-client-has-driver-adapter.test.ts` | `tests/guards/prisma-client-has-driver-adapter.test.ts` | COPY+EDIT | Population from `gitFiles()`; planted repository. |
| `tests/guards/migration-enum-isolation.test.ts` | `tests/guardrails/migration-enum-isolation.test.ts` | COPY+EDIT | Grandfathered list empty; population from git; planted repository. |
| `tests/guards/enum-member-order-matches-migrations.test.ts` | `tests/guardrails/enum-member-order-matches-migrations.test.ts` | COPY+EDIT | `SIGNED_OFF` empty; `ORDINAL_SENSITIVE` = `TenantMembership.role`; exact denominators; planted cases. |
| `tests/guards/connection-pooling.test.ts` | `tests/guardrails/connection-pooling.test.ts` | COPY+EDIT | Checks on the parsed compose document; `hostPorts()` expands `${VAR:-default}`; production-compose, `5433`, `pgbouncer=true` and side-by-side tests deleted; planted cases. |
| `tests/guards/integration-suites-execute.test.ts` | `tests/guards/integration-suites-execute.test.ts` | COPY+EDIT | Population from git; floor 10 and every integration suite must be gated; Islestone's `LOAD_BEARING`; planted repository. |
| `tests/integration/tenant-membership-isolation.test.ts` | `tests/integration/rls-isolation.test.ts` | PATTERN | Pattern only, no code copied: the two-tenant test for `TenantMembership`. |
| `tests/guards/schema-vocabulary.test.ts` | `tests/integration/task-enum-db-mapping.test.ts` and ADR 0006 | PATTERN | Pattern only, no code copied: no `@map`, and no banned word read from ADR 0006's table. |
| `docs/rls-tenant-isolation.md` | `docs/rls-tenant-isolation.md` | COPY+EDIT | Examples, reasons table and test paths are Islestone's; `runInGlobalContext` section deleted; org-axis, global-table and trigger-under-RLS notes added. |
| `docs/database-routing.md` | `docs/database-routing.md` | COPY+EDIT | The routed-endpoint, deferred and infrastructure sections deleted. |
| `.github/workflows/ci.yml` (`Integration` job) and `jest.config.mjs` (`integration` project) | `.github/workflows/ci.yml` (L733–743), `jest.config.js` | PATTERN | Pattern only, no code copied: grant `app_user` to the CI login role outside the migrations; a separate DB-backed Jest project. |

</details>

## Copied: auth, members and permissions (sub-phase 1.4)

NextAuth behind one seam, the edge gate, the permission set, roles and custom roles, invites, sessions, per-workspace MFA, the password flows and their pages, ported by [`docs/porting/maps/1.4.md`](docs/porting/maps/1.4.md). These facts hold for every row below:

- **Source:** inflect-compliance at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`, at the path in the row's Source column.
- **Licence:** BUSL-1.1, licensor Inflect Ltd. Copying is allowed by [ADR 0001](docs/adr/0001-code-provenance-and-licences.md) decision D1. The source files carry no per-file notice, so none is added, and `NOTICE` takes no entry: no third-party material came with them.
- **What every port changed:** role names follow [ADR 0006](docs/adr/0006-vocabulary.md) (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`, `GUEST`; an unresolvable role falls back to `VIEWER`; no `AUDITOR`, `EDITOR`, `READER`, `AI_ADMIN` or `canAudit`); SSO, "Enforce SSO", SCIM and the Entra group rules are not ported (sub-phase 8.3, ADR 0004); `TenantCustomRole.permissionsJson` is `grantsJson`; `User.email` stays plaintext, so `where: { emailHash: hashForLookup(x) }` became `where: { email: lookupEmail(x) }`; the invite cookies are `islestone_invite_token` and `islestone_org_invite_token`; `next-auth` is loaded only by the files in `NEXT_AUTH_SEAM` (ADR 0004 A3); the audit log, observability and mailer modules are stubs at their final paths until 1.5 and 1.6.
- **Action** is COPY (byte for byte), COPY+EDIT (the source text, edited as the Changes column says), REWRITE (written fresh to the source's design), PATTERN (pattern only, no code copied), STUB (the source module's signatures at its path, with a placeholder body a later sub-phase replaces), or Islestone-owned (written fresh, no source).
- **Not taken** from the map's test rows: `tests/integration/auth-ratelimit.test.ts` (the edge limiter, with 1.5), `tests/unit/rbac-guardrails.test.ts` (its pages are 1.7), `tests/integration/auth-gating.test.ts` (compliance), the access-review, SSO, SCIM, Entra and AI_ADMIN suites (8.3, Phase 6, cut).

<details>
<summary>All 278 rows</summary>

| File | Source | Action | Changes |
|---|---|---|---|
| `eslint-rules/README.md` | `eslint-rules/README.md` (L1–84) | COPY+EDIT | Sections up to "Adding a rule"; the parent's rule catalogue and its `agentic-path.js` and ts-jest notes cut; the seam allowlist named. |
| `eslint-rules/__tests__/next-auth-single-seam.test.ts` | `eslint-rules/__tests__/anthropic-client-single-seam.test.ts` | COPY+EDIT | Cases re-pointed at `next-auth`; type-only imports valid. |
| `eslint-rules/__tests__/no-request-derived-public-url.test.ts` | — | Islestone-owned | RuleTester suite for the copied rule (the parent has none). |
| `eslint-rules/index.js` | `eslint-rules/index.js` | REWRITE | The plugin shape, registering Islestone's two rules. |
| `eslint-rules/rules/next-auth-single-seam.js` | `eslint-rules/rules/anthropic-client-single-seam.js` | COPY+EDIT | The same load-policing rule pointed at `next-auth` and `@next-auth/*` (ADR 0004 A3); the allowlist is `NEXT_AUTH_SEAM` in `eslint.config.mjs`. |
| `eslint-rules/rules/no-request-derived-public-url.js` | `eslint-rules/rules/no-request-derived-public-url.js` | COPY | None. |
| `prisma/migrations/20261119130000_auth_and_roles/migration.sql` | `20260423150000_epic_d1_user_session_rls`, `20261018180000_built_in_scope_role_no_custom_role`, `20261019005000_custom_role_base_role_check` and the RLS setup migrations | REWRITE | One fresh migration: tables generated by `prisma migrate diff`; grants, Class-A RLS on every new tenant table, the asymmetric single `UserSession` policy, both custom-role CHECKs created VALID (no legacy rows to tolerate), and a partial unique index on active custom-role names. |
| `prisma/schema/auth.prisma` | `prisma/schema/auth.prisma` | COPY+EDIT | Eight models kept (Account, UserSession, VerificationToken, PasswordResetToken, UserMfaEnrollment, TenantSecuritySettings, TenantInvite, OrgInvite) plus TenantCustomRole; compliance, SSO, SCIM, billing and agent columns and back-relations cut. `TenantCustomRole.permissionsJson` is `grantsJson` (ADR 0006 bans "Permissions"); the NextAuth `Session` model is dropped (JWT strategy, and `@@map` is banned). `TenantSecuritySettings` keeps `mfaPolicy`, `sessionMaxAgeMinutes`, `maxConcurrentSessions`, `mfaFailClosed`. Role defaults are `VIEWER`. |
| `src/app-layer/events/audit.ts` | `src/app-layer/events/audit.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app-layer/policies/admin.policies.ts` | `src/app-layer/policies/admin.policies.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app-layer/policies/common.ts` | `src/app-layer/policies/common.ts` | COPY+EDIT | `assertCanAudit` → `assertCanExport`. |
| `src/app-layer/policies/person-only.policies.ts` | `src/app-layer/policies/person-only.policies.ts` | COPY+EDIT | API-key check only (no agent). |
| `src/app-layer/schemas/mfa.schemas.ts` | `src/app-layer/schemas/mfa.schemas.ts` | COPY | None. |
| `src/app-layer/schemas/tenant-security-settings.schemas.ts` | `src/app-layer/schemas/tenant-security-settings.schemas.ts` | COPY+EDIT | The same two fields. |
| `src/app-layer/usecases/custom-roles.ts` | `src/app-layer/usecases/custom-roles.ts` | COPY+EDIT | Base roles from `CUSTOM_ROLE_BASE_ROLES`; `grantsJson`; the legacy OWNER-base move on delete removed (the CHECK is VALID from the first row). |
| `src/app-layer/usecases/mfa-challenge.ts` | `src/app-layer/usecases/mfa-challenge.ts` | COPY+EDIT | VIEWER audit context. |
| `src/app-layer/usecases/mfa-enrollment.ts` | `src/app-layer/usecases/mfa-enrollment.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app-layer/usecases/mfa.ts` | `src/app-layer/usecases/mfa.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app-layer/usecases/org-invites.ts` | `src/app-layer/usecases/org-invites.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app-layer/usecases/org-provisioning.ts` | `src/app-layer/usecases/org-provisioning.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app-layer/usecases/session-security.ts` | `src/app-layer/usecases/session-security.ts` | COPY | None. |
| `src/app-layer/usecases/tenant-admin.ts` | `src/app-layer/usecases/tenant-admin.ts` | COPY+EDIT | `listAssignableUsers`, industry and identity-provider fields cut; GUEST refused by the writers' list. |
| `src/app-layer/usecases/tenant-invites.ts` | `src/app-layer/usecases/tenant-invites.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app-layer/usecases/tenant-security-settings.ts` | `src/app-layer/usecases/tenant-security-settings.ts` | COPY+EDIT | Rewritten to two fields (`maxConcurrentSessions`, `mfaFailClosed`); audit-stream, AI, recertification, rotation and turn-cap fields cut. |
| `src/app/account/AccountBackLink.tsx` | `src/app/account/AccountBackLink.tsx` | COPY | None. |
| `src/app/account/profile/NameEditField.tsx` | `src/app/account/profile/NameEditField.tsx` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/account/profile/page.tsx` | `src/app/account/profile/page.tsx` | COPY+EDIT | Avatar upload removed (4.4); `BackAffordance` replaced. |
| `src/app/account/security/ChangePasswordForm.tsx` | `src/app/account/security/ChangePasswordForm.tsx` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/account/security/page.tsx` | `src/app/account/security/page.tsx` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/account/profile/route.ts` | `src/app/api/account/profile/route.ts` | COPY+EDIT | Session read through `@/lib/auth/session`. |
| `src/app/api/auth/[...nextauth]/route.ts` | `src/app/api/auth/[...nextauth]/route.ts` | COPY | None. |
| `src/app/api/auth/change-password/route.ts` | `src/app/api/auth/change-password/route.ts` | COPY | None. |
| `src/app/api/auth/forgot-password/route.ts` | `src/app/api/auth/forgot-password/route.ts` | COPY | None. |
| `src/app/api/auth/logout/route.ts` | `src/app/api/auth/logout/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/auth/me/route.ts` | `src/app/api/auth/me/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/auth/register/route.ts` | `src/app/api/auth/register/route.ts` | COPY+EDIT | Behind `isPublicSignupOpen` (403 `PUBLIC_SIGNUP_CLOSED` for the workspace-creating path; the invite path stays open); no DEK (1.5); schemas from `@/lib/schemas/auth`; metrics stubs. |
| `src/app/api/auth/reset-password/route.ts` | `src/app/api/auth/reset-password/route.ts` | COPY | None. |
| `src/app/api/auth/ui-config/route.ts` | `src/app/api/auth/ui-config/route.ts` | COPY+EDIT | Reads `@/env`. |
| `src/app/api/auth/verify-email/resend/route.ts` | `src/app/api/auth/verify-email/resend/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/auth/verify-email/route.ts` | `src/app/api/auth/verify-email/route.ts` | COPY | None. |
| `src/app/api/invites/[token]/route.ts` | `src/app/api/invites/[token]/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/invites/[token]/start-signin/route.ts` | `src/app/api/invites/[token]/start-signin/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/org/[orgSlug]/invites/[inviteId]/route.ts` | `src/app/api/org/[orgSlug]/invites/[inviteId]/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/org/[orgSlug]/invites/route.ts` | `src/app/api/org/[orgSlug]/invites/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/org/invite/[token]/route.ts` | `src/app/api/org/invite/[token]/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/org/invite/[token]/start-signin/route.ts` | `src/app/api/org/invite/[token]/start-signin/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/t/[tenantSlug]/admin/_lib/create-invite-handler.ts` | `src/app/api/t/[tenantSlug]/admin/_lib/create-invite-handler.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/t/[tenantSlug]/admin/invites/[inviteId]/route.ts` | `src/app/api/t/[tenantSlug]/admin/invites/[inviteId]/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/t/[tenantSlug]/admin/invites/route.ts` | `src/app/api/t/[tenantSlug]/admin/invites/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/t/[tenantSlug]/admin/members/[membershipId]/deactivate/route.ts` | `src/app/api/t/[tenantSlug]/admin/members/[membershipId]/deactivate/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/t/[tenantSlug]/admin/members/[membershipId]/route.ts` | `src/app/api/t/[tenantSlug]/admin/members/[membershipId]/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/t/[tenantSlug]/admin/members/route.ts` | `src/app/api/t/[tenantSlug]/admin/members/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/t/[tenantSlug]/admin/roles/[roleId]/route.ts` | `src/app/api/t/[tenantSlug]/admin/roles/[roleId]/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/t/[tenantSlug]/admin/roles/route.ts` | `src/app/api/t/[tenantSlug]/admin/roles/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/t/[tenantSlug]/admin/security-settings/route.ts` | `src/app/api/t/[tenantSlug]/admin/security-settings/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/t/[tenantSlug]/admin/sessions/route.ts` | `src/app/api/t/[tenantSlug]/admin/sessions/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/t/[tenantSlug]/admin/settings/route.ts` | `src/app/api/t/[tenantSlug]/admin/settings/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/t/[tenantSlug]/security/mfa/challenge/verify/route.ts` | `src/app/api/t/[tenantSlug]/security/mfa/challenge/verify/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/t/[tenantSlug]/security/mfa/enroll/route.ts` | `src/app/api/t/[tenantSlug]/security/mfa/enroll/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/t/[tenantSlug]/security/mfa/enroll/start/route.ts` | `src/app/api/t/[tenantSlug]/security/mfa/enroll/start/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/t/[tenantSlug]/security/mfa/enroll/verify/route.ts` | `src/app/api/t/[tenantSlug]/security/mfa/enroll/verify/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/t/[tenantSlug]/security/mfa/policy/route.ts` | `src/app/api/t/[tenantSlug]/security/mfa/policy/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/t/[tenantSlug]/security/sessions/revoke-all/route.ts` | `src/app/api/t/[tenantSlug]/security/sessions/revoke-all/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/t/[tenantSlug]/security/sessions/revoke-current/route.ts` | `src/app/api/t/[tenantSlug]/security/sessions/revoke-current/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/api/t/[tenantSlug]/security/sessions/revoke-user/route.ts` | `src/app/api/t/[tenantSlug]/security/sessions/revoke-user/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/forgot-password/page.tsx` | `src/app/forgot-password/page.tsx` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/invite/[token]/InviteAcceptButton.tsx` | `src/app/invite/[token]/InviteAcceptButton.tsx` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/invite/[token]/page.tsx` | `src/app/invite/[token]/page.tsx` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/invite/_components/InviteSwitchAccountButton.tsx` | `src/app/invite/_components/InviteSwitchAccountButton.tsx` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/invite/org/[token]/OrgInviteAcceptButton.tsx` | `src/app/invite/org/[token]/OrgInviteAcceptButton.tsx` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/invite/org/[token]/page.tsx` | `src/app/invite/org/[token]/page.tsx` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/invite/result/page.tsx` | `src/app/invite/result/page.tsx` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/login/login-error.ts` | `src/app/login/login-error.ts` | COPY | None. |
| `src/app/login/page.tsx` | `src/app/login/page.tsx` | COPY+EDIT | AISVS badge and SSO form removed; OAuth buttons only for registered providers; landing via `tenantLandingPath`; register-refusal copy. |
| `src/app/no-tenant/RefreshAccessButton.tsx` | `src/app/no-tenant/RefreshAccessButton.tsx` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/no-tenant/page.tsx` | `src/app/no-tenant/page.tsx` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/reset-password/page.tsx` | `src/app/reset-password/page.tsx` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/app/t/[tenantSlug]/(mfa)/auth/mfa/page.tsx` | `src/app/t/[tenantSlug]/(app)/auth/mfa/page.tsx` | COPY+EDIT | Landing route as `next` default; icons from `lucide-react`. Moved to the `(mfa)` group in sub-phase 1.7. |
| `src/app/t/[tenantSlug]/(mfa)/security/mfa/TotpQrCode.tsx` | `src/app/t/[tenantSlug]/(app)/security/mfa/TotpQrCode.tsx` | COPY | None. Moved to the `(mfa)` group in sub-phase 1.7. |
| `src/app/t/[tenantSlug]/(mfa)/security/mfa/page.tsx` | `src/app/t/[tenantSlug]/(app)/security/mfa/page.tsx` | COPY+EDIT | `BackAffordance` removed; icons from `lucide-react`. Moved to the `(mfa)` group in sub-phase 1.7. |
| `src/app/t/[tenantSlug]/page.tsx` | — | Islestone-owned | Placeholder workspace landing page behind `getTenantServerContext`. Deleted in sub-phase 1.7: the workspace root redirects to My Work. |
| `src/app/tenants/page.tsx` | `src/app/tenants/page.tsx` | COPY+EDIT | Links to `tenantLandingPath`; shim imports → `@inflect/ui`. |
| `src/auth.ts` | `src/auth.ts` | COPY+EDIT | SSO hand-off, "Enforce SSO", Entra group sync and the agent paths cut; Google and Microsoft registered only when configured; VIEWER fallbacks; `lookupEmail`; invite cookies renamed `islestone_*`; `GroupMember.Read.All` dropped. |
| `src/lib/account/profile.ts` | `src/lib/account/profile.ts` | COPY | None. |
| `src/lib/api-error.ts` | `src/lib/api-error.ts` | COPY | None. |
| `src/lib/api-response.ts` | `src/lib/api-response.ts` | COPY | None. |
| `src/lib/api-version.ts` | `src/lib/api-version.ts` | COPY | None. |
| `src/lib/audit/index.ts` | `src/lib/audit/audit-writer.ts`, `src/lib/audit-log.ts` | STUB | Real signatures; each entry is one `audit.entry` log line until 1.5 adds the table. |
| `src/lib/audit/org-audit-writer.ts` | `src/lib/audit/org-audit-writer.ts` | STUB | Real signature; one `audit.org_entry` log line until 1.5. |
| `src/lib/auth/admin-api-affordances.ts` | `src/lib/auth/admin-api-affordances.ts` | COPY | None. |
| `src/lib/auth/change-password-refusals.ts` | `src/lib/auth/change-password-refusals.ts` | COPY | None. |
| `src/lib/auth/credential-rate-limit.ts` | `src/lib/auth/credential-rate-limit.ts` | COPY+EDIT | Upstash client built from `@/env` instead of `Redis.fromEnv()`. |
| `src/lib/auth/credentials.ts` | `src/lib/auth/credentials.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/lib/auth/edge-admin-roles.ts` | `src/lib/auth/edge-admin-roles.ts` | COPY | None. |
| `src/lib/auth/email-lookup.ts` | `src/lib/security/encryption.ts` (`hashForLookup` normal form) | PATTERN | Pattern only, no code copied: `lookupEmail` stores and matches the trimmed, lower-cased address while `User.email` is plaintext (until 1.5). |
| `src/lib/auth/email-verification.ts` | `src/lib/auth/email-verification.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/lib/auth/guard.ts` | `src/lib/auth/guard.ts` | COPY+EDIT | Trust-centre, vendor, audit-share, device and seed public paths cut; `PUBLIC_API_REGEXES` and `MACHINE_CALLER_PREFIXES` empty; the API-key matcher and the AI_ADMIN/AUDITOR carve-outs removed; `/` and `/gallery` public as before 1.4. |
| `src/lib/auth/landing.ts` | — | Islestone-owned | `tenantLandingPath`, the one place the post-sign-in workspace route is spelled. |
| `src/lib/auth/oauth-email-trust.ts` | `src/lib/auth/oauth-email-trust.ts` | COPY | None. |
| `src/lib/auth/password-limits.ts` | `src/lib/auth/password-limits.ts` | COPY | None. |
| `src/lib/auth/password-management.ts` | `src/lib/auth/password-management.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/lib/auth/passwords.ts` | `src/lib/auth/passwords.ts` | COPY | None. |
| `src/lib/auth/platform-admin.ts` | `src/lib/auth/platform-admin.ts` | COPY | None. |
| `src/lib/auth/public-signup.ts` | — | Islestone-owned | `isPublicSignupOpen`: the ADR 0006 switch (`AUTH_PUBLIC_SIGNUP`, default from `NODE_ENV`). |
| `src/lib/auth/redirect-path.ts` | `src/lib/auth/redirect-path.ts` | COPY | None. |
| `src/lib/auth/refresh-session-claims.ts` | `src/lib/auth/refresh-session-claims.ts` | COPY | None. |
| `src/lib/auth/refresh-session-cookie.ts` | `src/lib/auth/refresh-session-cookie.ts` | COPY | None. |
| `src/lib/auth/register-refusals.ts` | `src/lib/auth/register-refusals.ts` | COPY+EDIT | `PUBLIC_SIGNUP_CLOSED` added. |
| `src/lib/auth/reset-password-refusals.ts` | `src/lib/auth/reset-password-refusals.ts` | COPY | None. |
| `src/lib/auth/security-events.ts` | `src/lib/auth/security-events.ts` | COPY | None. |
| `src/lib/auth/session-expiry.ts` | `src/lib/auth/session-expiry.ts` | COPY | None. |
| `src/lib/auth/session-revoked.ts` | `src/lib/auth/session-revoked.ts` | COPY | None. |
| `src/lib/auth/sign-in-destinations.ts` | `src/lib/auth/sign-in-destinations.ts` | COPY+EDIT | SSO and Entra parameters removed (8.3). |
| `src/lib/auth/workspace-mfa-gate.ts` | `src/app-layer/context.ts` (`assertWorkspaceMfaSatisfied`) | COPY+EDIT | Lifted out of the context builder so `getTenantCtx` and `getTenantServerContext` ask the same question. |
| `src/lib/auth/workspace-mfa.ts` | `src/lib/auth/workspace-mfa.ts` | COPY | None. |
| `src/lib/custom-role-admin-base-rule.ts` | `src/lib/custom-role-admin-base-rule.ts` | COPY+EDIT | Lists re-derived for Islestone's admin keys. |
| `src/lib/custom-role-grant-refusal.ts` | `src/lib/custom-role-grant-refusal.ts` | COPY | None. |
| `src/lib/email/invite-email.ts` | `src/lib/email/invite-email.ts` | COPY | None. |
| `src/lib/errors/api.ts` | `src/lib/errors/api.ts` | COPY+EDIT | Tracing span, request metrics and Sentry capture removed (1.6). |
| `src/lib/http/graph-headers.ts` | `src/lib/http/graph-headers.ts` | COPY | None. |
| `src/lib/http/public-base-url.ts` | `src/lib/http/public-base-url.ts` | COPY | None. |
| `src/lib/http/request-origin.ts` | `src/lib/http/request-origin.ts` | COPY+EDIT | `AUTH_URL` fallback removed. |
| `src/lib/invite-refusals.ts` | `src/lib/invite-refusals.ts` | COPY | None. |
| `src/lib/mailer.ts` | same | COPY+EDIT | Replaces the 1.4 stub: the console, Nodemailer and stub providers, `sendEmail` with its lazy init, `initMailerFromEnv` reading `SMTP_*` through `@/env` (not raw); the sink logs `hashForLookup` of each recipient and the template, never the address, subject or body (`recipientLogFields`, new; owner decision 2026-11-19). |
| `src/lib/observability/business-metrics.ts` | `src/lib/observability/business-metrics.ts` | STUB | No-op counters with real signatures (1.6). |
| `src/lib/observability/edge-logger.ts` | `src/lib/observability/edge-logger.ts` | COPY+EDIT | Reads `@/env`; `EDGE_LOGGER_IN_TEST`. |
| `src/lib/observability/index.ts` | `src/lib/observability/index.ts` | STUB | Re-exports the logger and request context only (1.6). |
| `src/lib/observability/metrics.ts` | `src/lib/observability/metrics.ts` | STUB | No-op counters with real signatures (1.6). |
| `src/lib/roles.ts` | `src/lib/roles.ts` | COPY+EDIT | Five roles; assignable OWNER/ADMIN/MEMBER/VIEWER (GUEST not yet); `CUSTOM_ROLE_BASE_ROLES`; OWNER is the only built-in-scope role; admin-membership-only keys `sso`, `scim`. |
| `src/lib/schemas/auth.ts` | `src/lib/schemas/index.ts` (L1013–1033) | COPY+EDIT | `AuthRegisterSchema` and `AuthActionSchema` kept by name and shape, without `.openapi()`; cookie name in the comment. |
| `src/lib/schemas/common.ts` | `src/lib/schemas/index.ts` (`EmptyBodySchema`) | COPY+EDIT | One schema, without `.openapi()`. |
| `src/lib/security/admin-session-guard.ts` | `src/lib/security/admin-session-guard.ts` | COPY | None. |
| `src/lib/security/assert-permission.ts` | `src/lib/security/assert-permission.ts` | COPY | None. |
| `src/lib/security/org-permission-middleware.ts` | `src/lib/security/org-permission-middleware.ts` | COPY | None. |
| `src/lib/security/password-check.ts` | `src/lib/security/password-check.ts` | COPY | None. |
| `src/lib/security/permission-key.ts` | `src/lib/security/permission-key.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/lib/security/permission-middleware.ts` | `src/lib/security/permission-middleware.ts` | COPY+EDIT | Handler context is the resolved context; PM examples. |
| `src/lib/security/rate-limit-middleware.ts` | `src/lib/security/rate-limit-middleware.ts` | COPY+EDIT | Bypass flags read through `@/env`. |
| `src/lib/security/rate-limit.ts` | `src/lib/security/rate-limit.ts` | COPY | None. |
| `src/lib/security/route-permissions.ts` | `src/lib/security/route-permissions.ts` | COPY+EDIT | The mechanism kept; eight rules for Islestone's admin and security routes, no SSO or SCIM rules. |
| `src/lib/security/sanitize.ts` | `src/lib/security/sanitize.ts` | COPY+EDIT | `sanitizePlainText` and its entity decoder only (1.5 brings the rest). |
| `src/lib/security/session-tracker.ts` | `src/lib/security/session-tracker.ts` | COPY | None. |
| `src/lib/security/totp-crypto.ts` | `src/lib/security/totp-crypto.ts` | COPY | None. |
| `src/lib/tenant-context-provider.tsx` | `src/lib/tenant-context-provider.tsx` | STUB | The two URL-builder hooks from route params. Replaced in sub-phase 1.7 by the provider (see that section). |
| `src/lib/tenant-system-user.ts` | `src/lib/tenant-system-user.ts` | COPY+EDIT | `isTenantSystemUserId` only (1.6 brings the system user). |
| `src/lib/validation/route.ts` | `src/lib/validation/route.ts` | COPY+EDIT | Imports point at Islestone's modules; compliance, SSO, SCIM, Entra, API-key and agent branches cut; role names per ADR 0006. |
| `src/middleware.ts` | `src/middleware.ts` | COPY+EDIT | Rewritten around the parent's gates: public paths, JWT, admin gate, MFA gates, tenant and org gates and the request id; CSP, CORS, the rate tiers and the API-key path cut (1.5, 5.2). |
| `tests/e2e/README.md` | `tests/e2e/README.md` (section from L40) | COPY+EDIT | The server-mode invariant and the "Why not a sibling `playwright.real-auth.config.ts`?" record, naming Islestone's suites. |
| `tests/e2e/auth-routes.spec.ts` | `tests/integration/auth-routes.test.ts` | COPY+EDIT | Rewritten as a Playwright spec against the booted server, so it cannot skip when no dev server runs; providers case asserts credentials only. |
| `tests/e2e/auth.spec.ts` | `tests/e2e/auth.spec.ts` | COPY+EDIT | `isolatedTenant` fixture instead of the seeded user; lands on `/t/<slug>`; Islestone paths. |
| `tests/e2e/credentials-hardening.spec.ts` | `tests/e2e/credentials-hardening.spec.ts` | COPY+EDIT | Header note only. |
| `tests/e2e/e2e-utils.ts` | `tests/e2e/e2e-utils.ts` | COPY+EDIT | `installFramework`, `DEFAULT_USER`, the tenant tracker and unused helpers cut; landing route; plain http base URL. |
| `tests/e2e/fixtures.ts` | `tests/e2e/fixtures.ts` | COPY+EDIT | Comments only (no seed, no teardown, landing route). |
| `tests/e2e/invite-flow.spec.ts` | `tests/e2e/invite-flow.spec.ts` | COPY+EDIT | MEMBER instead of EDITOR; landing page instead of dashboard and sidebar. |
| `tests/guards/api-permission-coverage.test.ts` | `tests/guardrails/api-permission-coverage.test.ts` | COPY+EDIT | Roots and exclusions reduced to the admin, security and account directories; population from `gitFiles()`. |
| `tests/guards/auth-hardening-presence.test.ts` | `tests/guardrails/auth-hardening-presence.test.ts` | COPY+EDIT | R-3 half only; R-6 moves to 1.6 with `src/instrumentation.ts`. |
| `tests/guards/auth-server-gate-coverage.test.ts` | `tests/guards/auth-server-gate-coverage.test.ts` | COPY+EDIT | The relied-on suites are Islestone's (credentials-end-to-end, email-verification, credential-rate-limit, credentials-auth); auth-gating cut, auth-ratelimit with 1.5. |
| `tests/guards/auth-stack-pinning.test.ts` | `tests/guardrails/auth-stack-pinning.test.ts` | COPY+EDIT | Islestone cases added: `NEXT_AUTH_SEAM` equals the `src/` files that load `next-auth`, and the rule's wiring read through the ESLint CLI. |
| `tests/guards/hibp-coverage.test.ts` | `tests/guardrails/hibp-coverage.test.ts` | COPY+EDIT | Population from `gitFiles()`; the 400-route floor replaced by "every registered route is found". |
| `tests/guards/jwt-membership-bound.test.ts` | `tests/guardrails/jwt-membership-bound.test.ts` | COPY | None. |
| `tests/guards/jwt-revocation-precedes-claims-refresh.test.ts` | `tests/guards/jwt-revocation-precedes-claims-refresh.test.ts` | COPY | None. |
| `tests/guards/machine-caller-paths-self-authenticate.test.ts` | `tests/guards/machine-caller-paths-self-authenticate.test.ts` | COPY+EDIT | The list is empty in 1.4: per-prefix contracts and the `/api/admin` and `/api/a2a` sweeps cut; the contract rule and the near-miss checks kept. |
| `tests/guards/members-remove-deactivate.test.ts` | `tests/guards/members-remove-deactivate.test.ts` | COPY+EDIT | Backend half only (the members page is 1.7); `bg.json` parity cut. |
| `tests/guards/no-auto-join.test.ts` | `tests/guardrails/no-auto-join.test.ts` | COPY+EDIT | Allowlists reduced to tenant-invites, the register route, org-provisioning and org-invites; population from `gitFiles()`. |
| `tests/guards/no-use-session.test.ts` | `tests/guards/no-use-session.test.ts` | COPY | None. |
| `tests/guards/role-zod-enums.test.ts` | `tests/guardrails/role-zod-enums.test.ts` | COPY+EDIT | Custom-role routes validate against `CUSTOM_ROLE_BASE_ROLES`. |
| `tests/guards/route-permissions-uppercase.test.ts` | `tests/guardrails/route-permissions-uppercase.test.ts` | COPY | None. |
| `tests/helpers/markdown-regions.ts` | `tests/helpers/markdown-regions.ts` | COPY | None. |
| `tests/helpers/route-permission-gate.ts` | `tests/helpers/route-permission-gate.ts` | COPY | None. |
| `tests/helpers/strict-mock.ts` | `tests/helpers/strict-mock.ts` | COPY | None. |
| `tests/helpers/tenant-fixture.ts` | `src/app-layer/usecases/tenant-lifecycle.ts` (`createTenantWithOwner` shape) | PATTERN | Pattern only, no code copied: a test fixture with the usecase's name and result, which 8.3 brings. |
| `tests/integration/api-security-layers.test.ts` | `tests/integration/epic-a-security.test.ts` | COPY+EDIT | Renamed for its invariant; isolation proved on `TenantCustomRole` instead of automation rules; no `canAudit`. |
| `tests/integration/auth-signin-no-auto-join.test.ts` | `tests/integration/auth-signin-no-auto-join.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/integration/auth-tables-isolation.test.ts` | `tests/integration/rls-isolation.test.ts` | PATTERN | Pattern only, no code copied: two-tenant tests for UserMfaEnrollment, TenantSecuritySettings, TenantInvite and TenantCustomRole. |
| `tests/integration/credentials-end-to-end.test.ts` | `tests/integration/credentials-end-to-end.test.ts` | COPY+EDIT | Audit rows read from `AuditLog` (issue #18); the teardown clears them before deleting the user and workspace. |
| `tests/integration/custom-role-base-role-check.test.ts` | `tests/integration/custom-role-base-role-check.test.ts` | COPY+EDIT | OWNER only; NOT VALID replay and legacy-delete cases cut. |
| `tests/integration/custom-role-carriage.test.ts` | `tests/integration/custom-role-carriage.test.ts` | COPY+EDIT | Admin-membership-only keys are `sso` and `scim`. |
| `tests/integration/custom-role-name-reuse.test.ts` | `tests/integration/custom-role-name-reuse.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/integration/email-verification.test.ts` | `tests/integration/email-verification.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/integration/invite-redemption.test.ts` | `tests/integration/invite-redemption.test.ts` | COPY+EDIT | MEMBER/VIEWER roles; audit actions and the hash-chain check read `AuditLog` (issue #18). |
| `tests/integration/invite-routes.test.ts` | `tests/integration/invite-routes.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/integration/jwt-claims-refresh.test.ts` | `tests/integration/jwt-claims-refresh.test.ts` | COPY+EDIT | Entra group-gate case cut (8.3). |
| `tests/integration/last-owner-usecase-guard.test.ts` | `tests/integration/last-owner-usecase-guard.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/integration/multi-tenant-jwt.test.ts` | `tests/integration/multi-tenant-jwt.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/integration/org-invite-lifecycle.test.ts` | `tests/integration/org-invite-lifecycle.test.ts` | COPY+EDIT | `getOrgPermissions`; org audit read from `OrgAuditLog`, with the chain verified (issue #18). |
| `tests/integration/owner-custom-role.test.ts` | `tests/integration/owner-custom-role.test.ts` | COPY+EDIT | AI_ADMIN, ownership-transfer and NOT VALID replay cases cut; the CHECK restored with the migration's own statement; audit read from `AuditLog` (issue #18). |
| `tests/integration/per-tenant-role-resolution.test.ts` | `tests/integration/per-tenant-role-resolution.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/integration/user-session-rls.test.ts` | `tests/integration/user-session-rls.test.ts` | COPY+EDIT | `runInTenantContext` and `prismaTestClient()`; its own tenants and user. |
| `tests/unit/admin-api-affordances.test.ts` | `tests/unit/admin-api-affordances.test.ts` | COPY+EDIT | Agent-register and tenant-layout cases cut (Phase 6, 1.7). |
| `tests/unit/admin-permissions.test.ts` | `tests/unit/admin-permissions.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/auth-brute-force.test.ts` | `tests/unit/auth-brute-force.test.ts` | COPY | None. |
| `tests/unit/auth-flow/mfa-enrollment.test.ts` | `tests/integration/mfa-enrollment.test.ts` | COPY+EDIT | Moved to the unit project (it needs no database); roles and imports. |
| `tests/unit/auth-flow/middleware-admin-gate.test.ts` | `tests/integration/middleware-admin-gate.test.ts` | COPY+EDIT | Moved to the unit project (it needs no database); rate-limiter mocks removed (the edge limiter is 1.5); roles. |
| `tests/unit/auth-flow/middleware-mfa-gate.test.ts` | `tests/integration/middleware-mfa-gate.test.ts` | COPY+EDIT | Moved to the unit project (it needs no database); machine-caller and `/api/health` cases inverted or cut (no such paths), `/` and `/gallery` public. |
| `tests/unit/auth-flow/middleware-multi-tenant-gate.test.ts` | `tests/integration/middleware-multi-tenant-gate.test.ts` | COPY+EDIT | Moved to the unit project (it needs no database); roles and imports. |
| `tests/unit/auth-flow/middleware-org-gate.test.ts` | `tests/integration/middleware-org-gate.test.ts` | COPY+EDIT | Moved to the unit project (it needs no database); roles and imports. |
| `tests/unit/auth-flow/middleware-public-reachability.test.ts` | `tests/integration/middleware-public-reachability.test.ts` | COPY+EDIT | Moved to the unit project (it needs no database); rewritten: the parent's public token routes are refused here, and Islestone's public paths reach their handlers; the edge rate-limit case waits for 1.5. |
| `tests/unit/auth-flow/middleware-tenant-gate.test.ts` | `tests/integration/middleware-tenant-gate.test.ts` | COPY+EDIT | Moved to the unit project (it needs no database); roles and imports. |
| `tests/unit/auth-flow/tenant-admin.test.ts` | `tests/integration/tenant-admin.test.ts` | COPY+EDIT | Moved to the unit project (it needs no database); GUEST in place of AUDITOR. |
| `tests/unit/auth-flow/tenant-picker-page.test.ts` | `tests/integration/tenant-picker-page.test.ts` | COPY+EDIT | Moved to the unit project (it needs no database); roles and imports. |
| `tests/unit/auth-me-session-scope.test.ts` | `tests/unit/auth-me-session-scope.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/auth-mfa-dependency-failure.test.ts` | `tests/unit/auth-mfa-dependency-failure.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/auth-session-resolution.test.ts` | `tests/unit/auth-session-resolution.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/auth/public-path-matcher.test.ts` | `tests/unit/auth/public-path-matcher.test.ts` | COPY+EDIT | `PUBLIC_API_REGEXES` is empty; the parent's token routes asserted private. |
| `tests/unit/change-password-refusal-codes.test.ts` | `tests/unit/change-password-refusal-codes.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/credential-rate-limit.test.ts` | `tests/unit/credential-rate-limit.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/credentials-auth.test.ts` | `tests/unit/credentials-auth.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/custom-role-admin-base-rule.test.ts` | `tests/unit/custom-role-admin-base-rule.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/custom-role-carriage-writers.test.ts` | `tests/unit/custom-role-carriage-writers.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/custom-role-carriage.test.ts` | `tests/unit/custom-role-carriage.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/custom-role-permissions.test.ts` | `tests/unit/custom-role-permissions.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/custom-roles.test.ts` | `tests/unit/custom-roles.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/email-verification-row-kind.test.ts` | `tests/unit/email-verification-row-kind.test.ts` | COPY | None. |
| `tests/unit/entra-email-resolution.test.ts` | `tests/unit/entra-email-resolution.test.ts` | COPY | None. |
| `tests/unit/guard.test.ts` | `tests/unit/guard.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/http/public-base-url.test.ts` | `tests/unit/http/public-base-url.test.ts` | COPY | None. |
| `tests/unit/invite-email.test.ts` | `tests/unit/invite-email.test.ts` | COPY | None. |
| `tests/unit/invite-start-signin-route.test.ts` | `tests/unit/invite-start-signin-route.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/jwt-membership-truncation.test.ts` | `tests/unit/jwt-membership-truncation.test.ts` | COPY | None. |
| `tests/unit/jwt-update-trigger-refresh.test.ts` | `tests/unit/jwt-update-trigger-refresh.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/member-last-admin-removal.test.ts` | `tests/unit/member-last-admin-removal.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/member-role-and-custom-role-all-or-nothing.test.ts` | `tests/unit/member-role-and-custom-role-all-or-nothing.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/mfa-challenge-session-cookie.test.ts` | `tests/unit/mfa-challenge-session-cookie.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/mfa-challenge-verify-workspace.test.ts` | `tests/unit/mfa-challenge-verify-workspace.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/mfa-enforcement.test.ts` | `tests/unit/mfa-enforcement.test.ts` | COPY | None. |
| `tests/unit/mfa-per-workspace.test.ts` | `tests/unit/mfa-per-workspace.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/mfa-policy.test.ts` | `tests/unit/mfa-policy.test.ts` | COPY | None. |
| `tests/unit/middleware-org-route-structural.test.ts` | `tests/unit/middleware-org-route-structural.test.ts` | COPY | None. |
| `tests/unit/oauth-email-trust.test.ts` | `tests/unit/oauth-email-trust.test.ts` | COPY | None. |
| `tests/unit/oauth-sign-in-linking.test.ts` | `tests/unit/oauth-sign-in-linking.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/org-invite-route.test.ts` | `tests/unit/org-invite-route.test.ts` | COPY | None. |
| `tests/unit/org-permissions.test.ts` | `tests/unit/org-permissions.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/owner-custom-role.test.ts` | `tests/unit/owner-custom-role.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/owner-membership-removal-authority.test.ts` | `tests/unit/owner-membership-removal-authority.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/password-bcrypt-truncation.test.ts` | `tests/unit/password-bcrypt-truncation.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/password-check.test.ts` | `tests/unit/password-check.test.ts` | COPY | None. |
| `tests/unit/password-management.test.ts` | `tests/unit/password-management.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/password-verify-constant-work.test.ts` | `tests/unit/password-verify-constant-work.test.ts` | COPY | None. |
| `tests/unit/password-verify-refusal-timing.test.ts` | `tests/unit/password-verify-refusal-timing.test.ts` | COPY | None. |
| `tests/unit/passwords.test.ts` | `tests/unit/passwords.test.ts` | COPY | None. |
| `tests/unit/permission-middleware-async-params.test.ts` | `tests/unit/permission-middleware-async-params.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/permissions.test.ts` | `tests/unit/permissions.test.ts` | COPY+EDIT | Rewritten for the new matrix, every role × every key. |
| `tests/unit/rbac.test.ts` | `tests/unit/rbac.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/register-refusal-codes.test.ts` | `tests/unit/register-refusal-codes.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/request-origin.test.ts` | `tests/unit/request-origin.test.ts` | COPY | None. |
| `tests/unit/reset-password-refusal-codes.test.ts` | `tests/unit/reset-password-refusal-codes.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/route-permission-gate.test.ts` | `tests/unit/route-permission-gate.test.ts` | COPY | None. |
| `tests/unit/route-permissions.test.ts` | `tests/unit/route-permissions.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/security-events.test.ts` | `tests/unit/security-events.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/security/admin-route-enforcement.test.ts` | `tests/unit/security/admin-route-enforcement.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/security/admin-sessions-route.test.ts` | `tests/unit/security/admin-sessions-route.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/security/auth-security-events-lifecycle.test.ts` | `tests/unit/security/auth-security-events-lifecycle.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/security/auth-test-mode-prod-refusal.test.ts` | `tests/unit/security/auth-test-mode-prod-refusal.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/security/migrated-route-enforcement.test.ts` | `tests/unit/security/migrated-route-enforcement.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/security/no-legacy-session-cookie.test.ts` | `tests/unit/security/no-legacy-session-cookie.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/security/org-permission-denial-audit.test.ts` | `tests/unit/security/org-permission-denial-audit.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/security/password-verify-bcrypt-interop.test.ts` | `tests/unit/security/password-verify-bcrypt-interop.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/security/permission-middleware.test.ts` | `tests/unit/security/permission-middleware.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/security/platform-admin-key-rotation.test.ts` | `tests/unit/security/platform-admin-key-rotation.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/security/register-route-hardening.test.ts` | `tests/unit/security/register-route-hardening.test.ts` | COPY | None. |
| `tests/unit/security/revoke-sessions-current-session-route.test.ts` | `tests/unit/security/revoke-sessions-current-session-route.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/security/session-tracker-refusals.test.ts` | `tests/unit/security/session-tracker-refusals.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/security/session-tracker.test.ts` | `tests/unit/security/session-tracker.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/session-expiry-store.test.ts` | `tests/unit/session-expiry-store.test.ts` | COPY | None. |
| `tests/unit/session-revocation-api.test.ts` | `tests/unit/session-revocation-api.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/tenant-invite-create-routes.test.ts` | `tests/unit/tenant-invite-create-routes.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/tenant-invites-usecase.test.ts` | `tests/unit/tenant-invites-usecase.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/tenant-security-settings.test.ts` | `tests/unit/tenant-security-settings.test.ts` | COPY+EDIT | Authorization, patch semantics and `maxConcurrentSessions` validation kept; schema, audit and read cases for the two fields; the removed fields' suites cut. |
| `tests/unit/totp-crypto.test.ts` | `tests/unit/totp-crypto.test.ts` | COPY | None. |
| `tests/unit/usecases/mfa-challenge.test.ts` | `tests/unit/usecases/mfa-challenge.test.ts` | COPY | None. |
| `tests/unit/usecases/mfa-enrollment.test.ts` | `tests/unit/usecases/mfa-enrollment.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/usecases/mfa-policy.test.ts` | `tests/unit/usecases/mfa-policy.test.ts` | COPY+EDIT | `validateAuditDetailsJson` checks removed (1.5). |
| `tests/unit/usecases/org-invites.test.ts` | `tests/unit/usecases/org-invites.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/usecases/session-security.test.ts` | `tests/unit/usecases/session-security.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/usecases/tenant-invites.test.ts` | `tests/unit/usecases/tenant-invites.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |
| `tests/unit/verification-email-metric.test.ts` | `tests/unit/verification-email-metric.test.ts` | COPY | None. |
| `tests/unit/workspace-mfa-beyond-claim-gate.test.ts` | `tests/unit/workspace-mfa-beyond-claim-gate.test.ts` | COPY+EDIT | Islestone roles (EDITOR → MEMBER, READER → VIEWER, AUDITOR → VIEWER or GUEST), `grantsJson`, `lookupEmail`, `@/lib/auth/session`, `islestone_*` cookies; cases for cut features (SSO, SCIM, Entra, agents, AI_ADMIN, compliance) removed. |

</details>

Files from earlier sub-phases edited in 1.4 (their rows are in the sections above; Islestone's own configuration files — `package.json`, the Jest, Playwright and ESLint configs, `.env.example`, `messages/en.json`, `tests/mocks/env.ts` — are not ports and carry no row):

<details>
<summary>All 25 files</summary>

| File | Changed in 1.4 |
|---|---|
| `prisma/schema/enums.prisma` | `MfaPolicy`, `MfaType` (TOTP only) and `OrgAuditAction` (nine values) added. |
| `prisma/schema/tenancy.prisma` | The 1.4 relations on `User`, `Tenant` and `Organization`; `TenantMembership.customRoleId` with its relation and index. |
| `src/app-layer/context.ts` | The MFA gate restored through `workspace-mfa-gate.ts`; SSO, Entra and API-key gates still cut. |
| `src/app-layer/types.ts` | `apiKeyId?` restored for the person-only policy. |
| `src/env.ts` | The auth, sign-up switch, platform-key and rate-limit variables; `AUTH_TEST_MODE` refused in production unless `NEXT_TEST_MODE`. |
| `src/lib/auth/session.ts` | The 1.3 stub replaced by the port of `src/lib/auth.ts`: `getSession`/`getSessionOrThrow`, the five-role hierarchy with the VIEWER fallback, SSO fields and `canAudit` removed, `canExport` for OWNER and ADMIN. |
| `src/lib/permissions.ts` | The 1.3 stub replaced: Rewritten for Islestone: twelve PM domains (workspace … admin) and the ADR 0006 role matrix; ADMIN without `tenant_lifecycle`/`owner_management`; unknown role → VIEWER; the organization part from 1.3. |
| `src/lib/server/org-context.server.ts` | Comment only. |
| `src/lib/server/tenant-context.server.ts` | The MFA gate restored (same module as `getTenantCtx`); takes the session's MFA facts. |
| `src/lib/tenant-context.ts` | Custom-role resolution restored; `canExport` for OWNER and ADMIN. |
| `tests/guards/enum-member-order-matches-migrations.test.ts` | Enum denominator raised to six. |
| `tests/guards/no-direct-prisma.test.ts` | Usecase allowlist (the MFA, session-security, invite and org-provisioning usecases) and route-directory allowlist (`auth`) for the auth paths that use the global client, each with its reason. |
| `tests/guards/schema-index-coverage.test.ts` | Model list; `TenantMembership`, `TenantInvite` and `TenantCustomRole` in `LIST_MODELS_TENANT_INDEX_SUFFICIENT` with reasons. |
| `tests/guards/schema-vocabulary.test.ts` | Model list and enum count for the 1.4 schema. |
| `tests/guards/tenant-isolation-forward-lock.test.ts` | `ISOLATION_TESTED` gains `UserSession`, `UserMfaEnrollment`, `TenantSecuritySettings`, `TenantInvite`, `TenantCustomRole`. |
| `tests/guards/tenant-isolation-structural.test.ts` | The 1.4 root pages (login, password reset, invite, no-tenant, picker, account) and flat API directories (auth, invites, org, account) allowlisted with reasons. |
| `tests/helpers/db.ts` | `RESET_TABLES` gains the 1.4 tables. |
| `tests/helpers/make-context.ts` | `canExport` for OWNER and ADMIN, matching `computePermissions`. |
| `tests/helpers/rls-policies.ts` | `SINGLE_POLICY_EXCEPTIONS = ['UserSession']`. |
| `tests/integration/prisma-enum-values-exist-in-pg.test.ts` | Denominators raised to six enums and 25 values. |
| `tests/integration/rls-coverage.test.ts` | Inventory raised to the six tenant tables. |
| `tests/unit/tenant-context-resolution.test.ts` | `canExport` row values and the custom-role include. |
| `tests/unit/tenant-context.test.ts` | Custom-role resolution cases and the membership include. |
| `tests/unit/tenant-ctx.test.ts` | The restored MFA gate mocked; permissions shape. |
| `tests/unit/tenant-server-context.test.ts` | The `session` argument (MFA facts) the gate now takes. |

</details>

## Copied: security perimeter (sub-phase 1.5)

Field encryption with per-workspace data keys, the PII extension and `User.emailHash`, the hash-chained audit trail and `logEvent`, the audit stream, `safeFetch` and the webhook crypto at their source paths, the edge rate-limit tiers, the nonce Content-Security-Policy and CORS, sanitisation and secret detection, ported by [`docs/porting/maps/1.5.md`](docs/porting/maps/1.5.md) (part 1.5a; 1.5b, the rotation and outbox-drain jobs, waits for 1.6's queue). These facts hold for every row below:

- **Source:** inflect-compliance at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`, at the path in the row's Source column.
- **Licence:** BUSL-1.1, licensor Inflect Ltd. Copying is allowed by [ADR 0001](docs/adr/0001-code-provenance-and-licences.md) decision D1. The source files carry no per-file notice, so none is added, and `NOTICE` takes no entry: no third-party material came with them.
- **What every port changed:** one-way literals (HKDF info and salt, the HMAC domain, the dev fallback key, the startup sentinel, the TOTP salt and issuer, the audit-stream User-Agent and the `X-Islestone-*` webhook headers) are Islestone's, chosen before the first stored value; `User.email` and `User.name` hold ciphertext under their own names, because ADR 0006 rule 3 bans `@map` (the parent maps them to `emailEncrypted`/`nameEncrypted`); `OrgAuditLog.targetUserId` is `subjectUserId` (ADR 0006 bans "Target"); compliance models, entities and examples are replaced by Islestone's; the CSP names no report endpoint and no Google Fonts host; the API-key, MCP and agent parts are cut (5.2, 6.x).
- **Action** is COPY (byte for byte), COPY+EDIT (the source text, edited as the Changes column says), REWRITE (written fresh to the source's design), PATTERN (pattern only, no code copied), or Islestone-owned (written fresh, no source).
- **Not taken in 1.5a, taken in 1.5b** (section "Copied: rotation and outbox drain (sub-phase 1.5b)" below): `src/app-layer/jobs/key-rotation.ts`, `tenant-dek-rotation.ts`, `audit-outbox-flush.ts`, `scripts/rotate-global-pii.ts`, `rotateTenantDek`, the key-rotation admin routes and their tests: each needed 1.6's job queue. **Not taken (other):** the CSP violation sink (`src/lib/security/csp-violations.ts`, `/api/security/csp-report`; with 1.6 observability), `src/lib/security/headers.ts` (Islestone's `security-headers.ts` holds the baseline), the data-classification registry (`src/lib/security/classification.ts`), and the backfill scripts `encrypt-existing-data.ts` and `generate-tenant-deks.ts` (no pre-existing data).
- **Read, not copied** (historical implementation notes the map cites): `docs/implementation-notes/2026-08-09-decrypt-failure-three-outcomes.md`, `2026-07-10-encryption-manifest-coverage-guard.md`, `2026-04-27-implement-rotate-tenant-dek.md`, `2026-04-29-gap-22-rotate-tenant-dek-finalisation.md`, `2026-04-29-gap-21-pii-encrypted-only.md`, `2026-10-26-pii-relation-decrypt-from-schema.md`, `2026-04-30-epic-b-org-audit-trail.md`, `2026-05-21-audit-stream-observability.md`, `2026-07-03-ssrf-egress-coverage.md`, `2026-08-18-undici-dispatcher-version-coupling.md`, `2026-05-22-structural-sanitizer-coverage.md`, `2026-11-13-write-once-triggers-admit-the-dek-rewrap.md`, `2026-11-13-scanent-contract-dependency.md`.

<details>
<summary>All 133 rows</summary>

| File | Source | Action | Changes |
|---|---|---|---|
| `.husky/pre-commit` | `.husky/pre-commit` | COPY+EDIT | The secret scan only: the lint-staged step, which re-ran the same scan on the staged subset, cut (no `lint-staged` dependency). |
| `.secret-patterns` | `.secret-patterns` | COPY | None. |
| `docs/audit-trail.md` | `docs/immutable-audit-trail.md`; `docs/epic-c-security.md` §C.4; `docs/epic-e-observability.md` §E.2 | COPY+EDIT | Rewritten for Islestone: `logEvent` usage, the trigger's pseudonymisation exception, outbox and erasure sections from the module docblocks, the teardown rule; "Historical row strategy" and the admin verify route cut. |
| `docs/encryption.md` | `docs/epic-b-encryption.md`; `docs/encryption-data-protection.md` (L30–82); `docs/epic-f-finishing-touches.md` §F.2 | COPY+EDIT | One-entry manifest, the PII table, the `emailHash` schema/DB split, the register-time DEK; backfills cut; rotation marked 1.5b. |
| `docs/rate-limiting.md` | `docs/rate-limiting.md`; `docs/epic-a-security.md` ("Rate limit presets") | COPY+EDIT | Anonymous edge surfaces and the MCP endpoint cut; API-key callers reduced to a note for 5.2; the `RATE_LIMIT_MODE` section and issue #17 added; bypass gates corrected to Islestone's code. |
| `docs/security-perimeter.md` | `docs/epic-c-security.md` §C.2 and §C.5; `docs/epic-d-completeness.md` §D.2 | COPY+EDIT | Written for Islestone around the mined sections: headers, the nonce CSP and its two bridges, CORS, sanitisation, `safeFetch` and the egress allowlist, secret detection. |
| `prisma/migrations/20261119140000_security_perimeter/migration.sql` | `20260422200000_add_tenant_encrypted_dek`, `20260424010000_add_tenant_previous_encrypted_dek`, `20260917130000_audit_log_immutable_permit_pseudonymization`, `20260430052807_epic_b_org_audit_log` and the audit-trail and audit-stream migrations | REWRITE | One fresh migration: tables from `prisma migrate diff`; a refusal for a database whose `User` rows predate the hash; `emailHash` NOT NULL; the DEK CHECK and partial index; grants (SELECT/INSERT only on both logs); Class-A RLS on `AuditLog` and `AuditOutbox`; both immutability triggers (the final pseudonymisation-permitting `AuditLog` guard); extra FK indexes. |
| `prisma/schema/audit-trail.prisma` | `prisma/schema/audit-trail.prisma` | COPY+EDIT | Three models (`AuditLog`, `OrgAuditLog`, `AuditOutbox`); compliance back-relations cut; `OrgAuditLog.targetUserId` is `subjectUserId` (relation `subject`; ADR 0006 bans "Target"); FK indexes on `AuditLog.userId` and both `OrgAuditLog` user columns. |
| `scripts/detect-secrets.sh` | `scripts/detect-secrets.sh` | COPY+EDIT | Temp-file prefix `islestone-secret-scan-`; a comment reworded so the array parser is not split by an apostrophe. |
| `scripts/print-env-ok.ts` | `scripts/print-env-ok.ts` | COPY+EDIT | Rewritten: prints `OK` and the resolved `RATE_LIMIT_MODE`, for the env tests. |
| `scripts/verify-audit-chain.ts` | `scripts/verify-audit-chain.ts` | COPY+EDIT | Run with `tsx` (shebang and usage lines); imports. |
| `src/app-layer/automation/webhook-safety.ts` | `src/app-layer/automation/webhook-safety.ts` | COPY+EDIT | Kept at the source path; `import type`; the egress allowlist and billing-mode imports point at Islestone's copies. |
| `src/app-layer/events/audit-stream.ts` | `src/app-layer/events/audit-stream.ts` | COPY+EDIT | User-Agent `Islestone-Audit-Stream/1`; header and payload comments re-pointed (`X-Islestone-*`, Islestone entities). |
| `src/app-layer/events/webhook-headers.ts` | `src/app-layer/events/webhook-headers.ts` | COPY+EDIT | Header names `X-Islestone-*`. |
| `src/app-layer/integrations/webhook-crypto.ts` | `src/app-layer/integrations/webhook-crypto.ts` | COPY+EDIT | HMAC sign and verify only; the provider-payload extraction helpers cut (5.x). |
| `src/app-layer/schemas/json-columns.schemas.ts` | `src/app-layer/schemas/json-columns.schemas.ts` | COPY+EDIT | The audit `detailsJson` and diff schemas only; compliance JSON columns cut. |
| `src/instrumentation-node.ts` | `src/instrumentation.ts` | COPY+EDIT | Cut to the startup refusals: `AUTH_TEST_MODE` in production, the rate-limit store (issue #17, new), the encryption key and sentinel. Telemetry, Sentry, mailer and shutdown are 1.6. Moved out of `src/instrumentation.ts`, which now only branches on `process.env.NEXT_RUNTIME` (written fresh, owner decision 2026-11-19), so the Edge bundle drops them. |
| `src/lib/audit-redact.ts` | `src/lib/audit-redact.ts` (a re-export of `@rodnapamet/scanent-contract` at this commit) | PATTERN | Pattern only, no code copied: written fresh against the copied `tests/unit/audit-trail-redact.test.ts` (map, option "rewrite"). |
| `src/lib/audit/audit-outbox.ts` | `src/lib/audit/audit-outbox.ts` | COPY | None. |
| `src/lib/audit/audit-writer.ts` | `src/lib/audit/audit-writer.ts` | COPY+EDIT | `import type { PrismaClient }`; `noUncheckedIndexedAccess` guards (`lastRows[0]?.entryHash ?? null`, the verify loop); comment examples re-pointed. The `hashtext(tenantId)` key and the lazy stream import kept. |
| `src/lib/audit/canonical-hash.ts` | `src/lib/audit/canonical-hash.ts` | COPY | None. |
| `src/lib/audit/erasure-record.ts` | `src/lib/audit/erasure-record.ts` | COPY+EDIT | A comment re-pointed at the 8.3 erasure writer. |
| `src/lib/audit/event-builder.ts` | `src/lib/audit/event-builder.ts` | COPY+EDIT | Comment examples re-pointed. |
| `src/lib/audit/event-schema.ts` | `src/lib/audit/event-schema.ts` | COPY | None. |
| `src/lib/audit/org-canonical-hash.ts` | `src/lib/audit/org-canonical-hash.ts` | COPY | None. |
| `src/lib/audit/types.ts` | `src/lib/audit/types.ts` | COPY+EDIT | Comment examples re-pointed. |
| `src/lib/audit/verify.ts` | `src/lib/audit/verify.ts` | COPY+EDIT | `import type { PrismaClient }`. |
| `src/lib/billing/billing-mode.ts` | `src/lib/billing/billing-mode.ts` | COPY+EDIT | The mode only; entitlements are 8.1. |
| `src/lib/db/encryption-middleware.ts` | `src/lib/db/encryption-middleware.ts` | COPY+EDIT | The deprecated `$use` stubs deleted; imports; comments. |
| `src/lib/observability/observable-registry.ts` | `src/lib/observability/observable-registry.ts` | COPY+EDIT | The docblock's measured example replaced by Islestone's first gauge. |
| `src/lib/observability/tracing.ts` | `src/lib/observability/tracing.ts` | COPY+EDIT | Tracer name `islestone`; the docblock example re-pointed at work items. |
| `src/lib/rate-limit/apiReadRateLimit.ts` | `src/lib/rate-limit/apiReadRateLimit.ts` | COPY+EDIT | Upstash client built from the env module (`new Redis({ url, token })`); the API-key bucket cut (5.2); a `noUncheckedIndexedAccess` guard. |
| `src/lib/rate-limit/authRateLimit.ts` | `src/lib/rate-limit/authRateLimit.ts` | COPY+EDIT | Upstash client built from the env module; a `noUncheckedIndexedAccess` guard. |
| `src/lib/security/cidr.ts` | `src/lib/security/cidr.ts` (a re-export of `@rodnapamet/scanent-contract` at this commit) | PATTERN | Pattern only, no code copied: written fresh against `tests/guards/egress-allowlist.test.ts`. |
| `src/lib/security/cors.ts` | `src/lib/security/cors.ts` | COPY+EDIT | Provenance header only. |
| `src/lib/security/csp.ts` | `src/lib/security/csp.ts` | COPY+EDIT | No `report-uri`/`report-to` (the violation sink is not ported) and no Google Fonts hosts. |
| `src/lib/security/egress-allowlist.ts` | `src/lib/security/egress-allowlist.ts` | COPY+EDIT | `cidr` and `billing-mode` imports; comments. |
| `src/lib/security/encrypted-fields.ts` | `src/lib/security/encrypted-fields.ts` | COPY+EDIT | Rewritten manifest: one entry, `TenantSecuritySettings.auditStreamSecretEncrypted`; the helpers kept; the compliance list moved to a test fixture. |
| `src/lib/security/encryption-constants.ts` | `src/lib/security/encryption-constants.ts` | COPY+EDIT | The dev fallback string reads `islestone-…`. |
| `src/lib/security/encryption.ts` | `src/lib/security/encryption.ts` | COPY+EDIT | HKDF info, salt and HMAC domain literals renamed `islestone-*` (a one-way choice before the first stored value); `import type`. |
| `src/lib/security/pii-middleware.ts` | `src/lib/security/pii-middleware.ts` | COPY+EDIT | The field map is `User` (`email`/`emailHash`, `name`, columns keep their names: no `@map`, ADR 0006) and `Account` (dual-write tokens); the 8.3 and 1.6 models noted; `PII_ENCRYPTED_COLUMNS` derived. |
| `src/lib/security/safe-url.ts` | `src/lib/security/safe-url.ts` | COPY+EDIT | Comment examples. |
| `src/lib/security/startup-encryption-check.ts` | `src/lib/security/startup-encryption-check.ts` | COPY+EDIT | Takes a read-only record; sentinel `islestone-startup-sentinel`; worker and scheduler callers are 1.6. |
| `src/lib/security/startup-rate-limit-check.ts` | — | Islestone-owned | Issue #17: refuses a production start with `RATE_LIMIT_MODE=upstash` and no Upstash credentials (pattern of `startup-encryption-check.ts`). |
| `src/lib/security/tenant-key-manager.ts` | `src/lib/security/tenant-key-manager.ts` | COPY+EDIT | 1.5a cut: the `enqueue` import and the rotation block (`rotateTenantDek` and its types) removed for 1.5b. 1.5b restored both: the file is now a byte-for-byte COPY (its 1.5b row). |
| `src/lib/security/tenant-keys.ts` | `src/lib/security/tenant-keys.ts` | COPY | None. |
| `tests/guards/api-read-rate-limit.test.ts` | `tests/guardrails/api-read-rate-limit.test.ts` | COPY+EDIT | Paths re-pointed; the API-key and anonymous-surface cases cut; the Upstash double built as a constructor; doc comments. |
| `tests/guards/audit-chain-order-is-total.test.ts` | `tests/guards/audit-chain-order-is-total.test.ts` | COPY | None. |
| `tests/guards/audit-immutability-guardrails.test.ts` | `tests/guards/audit-immutability-guardrails.test.ts` | COPY+EDIT | Population from `gitFiles()`; floors are known files; the DSAR and tenant-purge carve-outs removed (8.3); the migration selected by function; the GRANT check bound to the two logs. |
| `tests/guards/audit-stream-observability.test.ts` | `tests/guards/audit-stream-observability.test.ts` | COPY | None. |
| `tests/guards/audit-structured-events.test.ts` | `tests/guards/audit-structured-events.test.ts` | COPY+EDIT | Population from `gitFiles()`, with a planted repository. |
| `tests/guards/audit-system-principal-never-reaches-the-fk.test.ts` | `tests/guards/audit-system-principal-never-reaches-the-fk.test.ts` | COPY+EDIT | The `system` literal asserted directly (1.6 brings `SYSTEM_PRINCIPAL`). |
| `tests/guards/csp-request-header-bridge.test.ts` | `tests/guards/csp-request-header-bridge.test.ts` | COPY | None. |
| `tests/guards/csp-webpack-nonce-bridge.test.ts` | `tests/guards/csp-webpack-nonce-bridge.test.ts` | COPY | None. |
| `tests/guards/egress-allowlist.test.ts` | `tests/guards/egress-allowlist.test.ts` | COPY+EDIT | Re-import through `jest.requireActual`; imports. |
| `tests/guards/encryption-key-enforcement.test.ts` | `tests/guardrails/encryption-key-enforcement.test.ts` | COPY+EDIT | Trimmed to the env schema and the instrumentation hook (no worker, scheduler or Compose files yet); a block for issue #17's two checks. |
| `tests/guards/encryption-manifest-coverage.test.ts` | `tests/guardrails/encryption-manifest-coverage.test.ts` | COPY+EDIT | `NOT_SENSITIVE` for Islestone's free-text columns, with reasons; the floor is the known keys. |
| `tests/guards/integration-suite-audit-teardown.test.ts` | `tests/guards/integration-suite-audit-teardown.test.ts` | COPY+EDIT | Population from `gitFiles()`, `GRANDFATHERED` empty, a planted repository; floors name Islestone suites. |
| `tests/guards/no-secrets.test.ts` | `tests/guardrails/no-secrets.test.ts` | COPY+EDIT | Root parametrised and proved on a planted repository; `REPO_BASELINE` for Islestone's placeholders. |
| `tests/guards/pii-hash-not-null.test.ts` | `tests/guardrails/pii-hash-not-null.test.ts` | COPY+EDIT | Rewritten for `User.emailHash` and Islestone's residue file. |
| `tests/guards/pii-rotation-coverage.test.ts` | `tests/guardrails/pii-rotation-coverage.test.ts` | COPY+EDIT | Floor: `User` and `Account` classified global. |
| `tests/guards/sanitize-rich-text-coverage.test.ts` | `tests/guardrails/sanitize-rich-text-coverage.test.ts` | COPY+EDIT | Empty coverage maps; `TenantSecuritySettings` in `NON_RICH_TEXT_MODELS`. |
| `tests/guards/ssrf-egress-coverage.test.ts` | `tests/guards/ssrf-egress-coverage.test.ts` | COPY+EDIT | Rewritten for Islestone's one sink (the audit stream). |
| `tests/helpers/audit-cleanup.ts` | `tests/helpers/audit-cleanup.ts` | COPY | None. |
| `tests/helpers/binary-extensions.ts` | `tests/helpers/binary-extensions.ts` | COPY | None. |
| `tests/helpers/encrypted-fields-fixture.ts` | `src/lib/security/encrypted-fields.ts` (its manifest, as test data) | COPY+EDIT | The parent's manifest kept as a fixture for the traversal suites; `fixtureManifestModule()`. |
| `tests/helpers/run-env-script.ts` | — | Islestone-owned | Runs `scripts/print-env-ok.ts` under `tsx` with a clean env, for the env tests. |
| `tests/integration/audit-chain-stored-form-and-order.test.ts` | `tests/integration/audit-chain-stored-form-and-order.test.ts` | COPY | None. |
| `tests/integration/audit-hash-chain.test.ts` | `tests/integration/audit-hash-chain.test.ts` | COPY+EDIT | Mechanical: imports point at Islestone modules, `import type`, `noUncheckedIndexedAccess` guards. |
| `tests/integration/audit-immutability.test.ts` | `tests/integration/audit-immutability.test.ts` | COPY+EDIT | Mechanical: imports point at Islestone modules, `import type`, `noUncheckedIndexedAccess` guards. |
| `tests/integration/audit-middleware.test.ts` | `tests/integration/audit-middleware.test.ts` | COPY+EDIT | The written model is `TenantCustomRole` where the source wrote `Risk`; regex fixtures. |
| `tests/integration/audit-tables-isolation.test.ts` | — | Islestone-owned | Two-tenant isolation for `AuditLog` and `AuditOutbox` as `app_user`; the privilege refusals through the cleanup helper's probes. |
| `tests/integration/audit-writer.test.ts` | `tests/unit/audit-trail/audit-writer.test.ts` | COPY+EDIT | Moved to the integration project (it needs a database); imports; a select alias. |
| `tests/integration/epic-b-encryption.test.ts` | `tests/integration/epic-b-encryption.test.ts` | COPY+EDIT | Rewritten on `TenantSecuritySettings.auditStreamSecretEncrypted`; rotation cases left for 1.5b; audit cleanup. |
| `tests/integration/log-event-chain.test.ts` | — | Islestone-owned | `logEvent` inside `runInTenantContext` writes a chained row; a malformed payload writes nothing. |
| `tests/integration/org-audit-immutability.test.ts` | `tests/integration/org-audit-immutability.test.ts` | COPY+EDIT | `"subjectUserId"` in the raw insert. |
| `tests/integration/org-audit-writer.test.ts` | `tests/unit/audit-trail/org-audit-writer.test.ts` | COPY+EDIT | Moved to the integration project; imports; `subjectUserId`. |
| `tests/integration/pii-encryption.test.ts` | `tests/integration/pii-encryption.test.ts` | COPY+EDIT | Raw reads alias `email`/`name` (no `*Encrypted` columns). |
| `tests/integration/pii-relation-decrypt.test.ts` | `tests/integration/pii-relation-decrypt.test.ts` | REWRITE | Written fresh to the map: a membership's and an audit row's `user` decrypt; the raw-read precondition. |
| `tests/integration/tenant-dek-schema.test.ts` | `tests/integration/tenant-dek-schema.test.ts`; the CHECK case of `tests/integration/tenant-dek-rotation.test.ts` (L165–185) | COPY+EDIT | The CHECK case added, and a new `pg_indexes` case for `Tenant_rotation_in_flight_idx`. |
| `tests/unit/api-read-rate-limit-upstash.test.ts` | `tests/unit/api-read-rate-limit-upstash.test.ts` | COPY+EDIT | Paths; the Redis constructor mock; `import type`. |
| `tests/unit/api-read-rate-limit.test.ts` | `tests/unit/api-read-rate-limit.test.ts` | COPY+EDIT | Paths `/api/t/<slug>/work-items`; API-key cases cut. |
| `tests/unit/api-version-header.test.ts` | `tests/unit/api-version-header.test.ts` | COPY+EDIT | Version `2026-11-19`. |
| `tests/unit/audit-diff-never-carries-encrypted-plaintext.test.ts` | `tests/unit/audit-diff-never-carries-encrypted-plaintext.test.ts` | COPY+EDIT | Mechanical: imports point at Islestone modules, `import type`, `noUncheckedIndexedAccess` guards. |
| `tests/unit/audit-diff-reads-prior-state.test.ts` | `tests/unit/audit-diff-reads-prior-state.test.ts` | COPY+EDIT | Mechanical: imports point at Islestone modules, `import type`, `noUncheckedIndexedAccess` guards. |
| `tests/unit/audit-trail-canonical-hash.test.ts` | `tests/unit/audit-trail-canonical-hash.test.ts` | COPY+EDIT | Mechanical: imports point at Islestone modules, `import type`, `noUncheckedIndexedAccess` guards. |
| `tests/unit/audit-trail-chain-verify.test.ts` | `tests/unit/audit-trail-chain-verify.test.ts` | COPY+EDIT | Mechanical: imports point at Islestone modules, `import type`, `noUncheckedIndexedAccess` guards. |
| `tests/unit/audit-trail-event-schema.test.ts` | `tests/unit/audit-trail-event-schema.test.ts` | COPY+EDIT | Mechanical: imports point at Islestone modules, `import type`, `noUncheckedIndexedAccess` guards. |
| `tests/unit/audit-trail-guardrails.test.ts` | `tests/unit/audit-trail-guardrails.test.ts` | COPY+EDIT | Mechanical: imports point at Islestone modules, `import type`, `noUncheckedIndexedAccess` guards. |
| `tests/unit/audit-trail-middleware.test.ts` | `tests/unit/audit-trail-middleware.test.ts` | COPY+EDIT | Mechanical: imports point at Islestone modules, `import type`, `noUncheckedIndexedAccess` guards. |
| `tests/unit/audit-trail-org-canonical-hash.test.ts` | `tests/unit/audit-trail-org-canonical-hash.test.ts` | COPY | None. |
| `tests/unit/audit-trail-redact.test.ts` | `tests/unit/audit-trail-redact.test.ts` | COPY+EDIT | Header names the fresh module; typing of the nested result. |
| `tests/unit/audit-trail-stream.test.ts` | `tests/unit/audit-trail-stream.test.ts` | COPY+EDIT | `X-Islestone-*` headers. |
| `tests/unit/audit-trail-verify.test.ts` | `tests/unit/audit-trail-verify.test.ts` | COPY+EDIT | Mechanical: imports point at Islestone modules, `import type`, `noUncheckedIndexedAccess` guards. |
| `tests/unit/auth-flow/auth-ratelimit.test.ts` | `tests/integration/auth-ratelimit.test.ts` | COPY+EDIT | Placed under `tests/unit/auth-flow/` (it needs no database, and every integration suite must be DB-gated); imports. |
| `tests/unit/auth-flow/middleware-csp.test.ts` | — (pattern of `tests/guards/csp-request-header-bridge.test.ts`) | Islestone-owned | Runs the real middleware: a nonce policy on the response and the request, fresh per request, on self-answered responses, report-only. |
| `tests/unit/authRateLimit.test.ts` | `tests/unit/authRateLimit.test.ts` | COPY | None. |
| `tests/unit/cors.test.ts` | `tests/unit/cors.test.ts` | COPY | None. |
| `tests/unit/csp-refinement.test.ts` | `tests/unit/csp-refinement.test.ts` | COPY+EDIT | Asserts no third-party style host and no report endpoint. |
| `tests/unit/csp.test.ts` | `tests/unit/csp.test.ts` | COPY+EDIT | Asserts no Google Fonts host and no report endpoint. |
| `tests/unit/db/audit-concurrency-limits.test.ts` | `tests/unit/db/audit-concurrency-limits.test.ts` | COPY+EDIT | The 1.5 half (the audit writer's budgets); the cleanup case moved into `pool-and-tenant-tx-limits.test.ts`. |
| `tests/unit/db/encryption-extension-branches.test.ts` | `tests/unit/db/encryption-extension-branches.test.ts` | COPY+EDIT | Fixture manifest. |
| `tests/unit/db/org-audit-concurrency-limits.test.ts` | `tests/unit/db/org-audit-concurrency-limits.test.ts` | COPY | None. |
| `tests/unit/db/prisma-audit-extension.test.ts` | `tests/unit/db/prisma-audit-extension.test.ts` | COPY+EDIT | A `Widget` model; a hoisted config store (TDZ under @swc/jest); slow-query parts cut (1.6). |
| `tests/unit/encryption-dual-key.test.ts` | `tests/unit/encryption-dual-key.test.ts` | COPY+EDIT | `islestone-*` subkey purposes. |
| `tests/unit/encryption-dual-tenant-dek.test.ts` | `tests/unit/encryption-dual-tenant-dek.test.ts` | COPY | None. |
| `tests/unit/encryption-middleware.perf.test.ts` | `tests/unit/encryption-middleware.perf.test.ts` | COPY+EDIT | Fixture manifest; module mocked as an `__esModule` spread so `jest.spyOn` works under @swc/jest. |
| `tests/unit/encryption-middleware.tenant-dek.test.ts` | `tests/unit/encryption-middleware.tenant-dek.test.ts` | COPY+EDIT | Fixture manifest; `jest.requireActual` for the re-import; doc references. |
| `tests/unit/encryption-middleware.test.ts` | `tests/unit/encryption-middleware.test.ts` | COPY+EDIT | Runs over the fixture manifest. |
| `tests/unit/encryption.test.ts` | `tests/unit/encryption.test.ts` | COPY+EDIT | The data-classification registry cases cut (not ported); `islestone-*` literals. |
| `tests/unit/env-encryption-key.test.ts` | `tests/unit/env.test.ts` (the `DATA_ENCRYPTION_KEY` cases) | COPY+EDIT | The encryption-key cases only, through `run-env-script`. |
| `tests/unit/env-rate-limit-mode.test.ts` | — | Islestone-owned | Issue #17: both states of the production refusal, each missing value, `memory`, non-production and `NEXT_TEST_MODE`. |
| `tests/unit/progressive-rate-limit.test.ts` | `tests/unit/progressive-rate-limit.test.ts` | COPY | None. |
| `tests/unit/rate-limit-holds-no-timer.test.ts` | `tests/unit/rate-limit-holds-no-timer.test.ts` | COPY | None. |
| `tests/unit/rate-limit-middleware.test.ts` | `tests/unit/rate-limit-middleware.test.ts` | COPY+EDIT | Presets Islestone has; doc references. |
| `tests/unit/rate-limit-rollout.test.ts` | `tests/unit/rate-limit-rollout.test.ts` | COPY | None. |
| `tests/unit/safe-url.test.ts` | `tests/unit/safe-url.test.ts` | COPY | None. |
| `tests/unit/security-cors.test.ts` | `tests/unit/security-cors.test.ts` | COPY | None. |
| `tests/unit/security/detect-secrets.test.ts` | `tests/unit/security/detect-secrets.test.ts` | COPY+EDIT | Temp prefix `islestone-secret-scan-`. |
| `tests/unit/security/encryption-write-tenant-context.test.ts` | `tests/unit/security/encryption-write-tenant-context.test.ts` | COPY+EDIT | Fixture manifest. |
| `tests/unit/security/pii-middleware-bulk-and-nested.test.ts` | `tests/unit/security/pii-middleware-bulk-and-nested.test.ts` | COPY+EDIT | `User` and `Account` shapes; the Account dual-write cases kept. |
| `tests/unit/security/pii-middleware-every-relation.test.ts` | `tests/unit/security/pii-middleware-every-relation.test.ts` | COPY+EDIT | Controls: `TenantMembership.user`, `AuditLog.user`, `OrgAuditLog.actor`/`subject`, `OrgMembership.user`. |
| `tests/unit/security/pii-middleware-hash-rewriter.test.ts` | `tests/unit/security/pii-middleware-hash-rewriter.test.ts` | COPY+EDIT | Mapped `User` columns. |
| `tests/unit/security/sanitize.test.ts` | `tests/unit/security/sanitize.test.ts` | COPY+EDIT | `sanitizePolicyContent` cases cut (no policy content). |
| `tests/unit/security/startup-encryption-check.test.ts` | `tests/unit/security/startup-encryption-check.test.ts` | COPY | None. |
| `tests/unit/security/startup-rate-limit-check.test.ts` | — | Islestone-owned | Issue #17: the startup twin of the schema refusal. |
| `tests/unit/system-actor-context.test.ts` | `tests/unit/system-actor-context.test.ts` | COPY+EDIT | The `logEvent` half; the literal `system` principal. |
| `tests/unit/tenant-key-manager.test.ts` | `tests/unit/tenant-key-manager.test.ts` | COPY+EDIT | The prisma mock through getters (TDZ under @swc/jest); rotation cases left for 1.5b. |
| `tests/unit/tenant-keys.test.ts` | `tests/unit/tenant-keys.test.ts` | COPY | None. |
| `tests/unit/webhook-crypto.test.ts` | `tests/integration/webhook.test.ts` | COPY+EDIT | The HMAC cases only, moved to the unit project (no database); the payload-extraction cases cut. |
| `tests/unit/webhook-headers.test.ts` | `tests/unit/webhook-headers.test.ts` | COPY+EDIT | `X-Islestone-*` headers and User-Agent. |
| `tests/unit/webhook-safety-dispatcher-egress.test.ts` | `tests/unit/webhook-safety-dispatcher-egress.test.ts` | COPY | None. |
| `tests/unit/webhook-safety.test.ts` | `tests/unit/webhook-safety.test.ts` | COPY | None. |

</details>

Files from earlier sub-phases edited in 1.5 (their rows are in the sections above; Islestone's own configuration files — `package.json`, `package-lock.json`, `README.md`, the Jest, Playwright and ESLint configs, `next.config.ts`, `jest.setup.ts`, `.env.example` — are not ports and carry no row):

<details>
<summary>All 56 files</summary>

| File | Changed in 1.5 |
|---|---|
| `prisma/fresh-db-schema-drift.expected.sql` | One deliberate line: `User.emailHash` NOT NULL in the database, nullable in the schema (GAP-21), with its reason. |
| `prisma/schema/README.md` | Layout table gains `auth.prisma` and `audit-trail.prisma`; the residue line noted. |
| `prisma/schema/auth.prisma` | `TenantSecuritySettings.auditStreamUrl` and `auditStreamSecretEncrypted` (source `auth.prisma`). |
| `prisma/schema/enums.prisma` | `AuditOutboxStatus` (source `enums.prisma`); an `OrgAuditAction` comment. |
| `prisma/schema/tenancy.prisma` | `Tenant.encryptedDek`/`previousEncryptedDek` and the audit back-relations; `User.email` holds ciphertext, `emailHash String? @unique`, `name` encrypted; the audit back-relations on `User` and `Organization` (source `auth.prisma`). |
| `src/app-layer/events/audit.ts` | `logEvent` now appends a real chained row through `appendAuditEntry`, validating `detailsJson` first (source `src/app-layer/events/audit.ts`). |
| `src/app-layer/types.ts` | `ActorType` imported from `@/lib/audit/types` and re-exported. |
| `src/app-layer/usecases/custom-roles.ts` | Name and description sanitised with `sanitizePlainText` before storage. |
| `src/app-layer/usecases/org-invites.ts` | Lookups by `emailHash: hashForLookup(x)`. |
| `src/app-layer/usecases/tenant-invites.ts` | Lookups by `emailHash`. |
| `src/app/api/auth/register/route.ts` | The workspace is created with its wrapped DEK inside the transaction (as the source); name and workspace name sanitised; the unique-violation target is `User_emailHash_key`; lookup by `emailHash`. |
| `src/app/api/auth/verify-email/resend/route.ts` | Lookup by `emailHash`. |
| `src/app/layout.tsx` | Async; reads the `x-csp-nonce` request header and sets `__webpack_nonce__` through a nonced inline script (source `src/app/layout.tsx`). |
| `src/auth.ts` | Lookups by `emailHash`. |
| `src/env.ts` | The 1.5 variables (encryption keys, lookup and subkey keys, fail-closed lever, audit-stream retry, egress allowlist, CSP report-only, CORS origins, Stripe key, Upstash); `DATA_ENCRYPTION_KEY` refused in production when missing, short or the fallback; `RATE_LIMIT_MODE` refused in production as `upstash` without both Upstash values (issue #17, new). |
| `src/lib/api-version.ts` | Version `2026-11-19`; the docblock's route list re-pointed. |
| `src/lib/audit/index.ts` | The 1.4 stub replaced by the source barrel (COPY). |
| `src/lib/audit/org-audit-writer.ts` | The 1.4 stub replaced by the source writer (COPY+EDIT: `import type`, `noUncheckedIndexedAccess` guards, the `subjectUserId` column under the `targetUserId` input and hash key). |
| `src/lib/auth/credentials.ts` | Lookup by `emailHash`. |
| `src/lib/auth/email-lookup.ts` | Docblock: the normal form is now the input to `hashForLookup`. |
| `src/lib/auth/email-verification.ts` | Lookup by `emailHash`. |
| `src/lib/auth/password-management.ts` | Lookup by `emailHash`. |
| `src/lib/errors/api.ts` | The tracing span and request metrics restored (source); Sentry stays 1.6. |
| `src/lib/observability/metrics.ts` | The 1.4 stub replaced by the source's encryption, audit-stream, rate-limit and request metrics (COPY+EDIT: compliance, agent and job metrics cut). |
| `src/lib/prisma.ts` | The audit extension (source L26–406) restored, then field encryption and PII, then the RLS tripwire; `import * as auditWriterModule`. |
| `src/lib/security-headers.ts` | The static `Content-Security-Policy` removed (the middleware sends the nonce policy); `applySecurityHeaders` for responses the middleware answers itself. `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy` `same-origin` added in H1 (owner decision 246), as the source's `next.config.js` and `src/lib/security/headers.ts` send them; COEP left unset as there. |
| `src/lib/security/rate-limit-middleware.ts` | The MCP and agent-question presets cut from the re-exports (6.x); a comment. |
| `src/lib/security/rate-limit.ts` | `MCP_PER_KEY_LIMIT`, `MCP_IP_CEILING_LIMIT` and `AGENT_QUESTION_LIMIT` cut (6.x). |
| `src/lib/security/sanitize.ts` | The rest of the source module: `sanitizeRichTextHtml` and `sanitizeUrlText` (COPY+EDIT: `sanitizePolicyContent` cut, no policy content). |
| `src/lib/security/totp-crypto.ts` | Salt and issuer renamed `Islestone`. |
| `src/middleware.ts` | The per-request nonce CSP on request and response, CORS preflight and headers, the auth tier on `/api/auth/**`, the read tier after the org gate, the baseline headers on self-answered responses (source `src/middleware.ts`). |
| `tests/e2e/smoke.spec.ts` | A nonce-policy case: scripts carry the nonce, no CSP violation, a fresh nonce per request. |
| `tests/guards/enum-member-order-matches-migrations.test.ts` | Enum denominator raised to seven. |
| `tests/guards/schema-index-coverage.test.ts` | Model list gains the three audit models. |
| `tests/guards/schema-vocabulary.test.ts` | Model list and enum count for the 1.5 schema. |
| `tests/guards/tenant-isolation-forward-lock.test.ts` | `ISOLATION_TESTED` gains `AuditLog` and `AuditOutbox` (`audit-tables-isolation.test.ts`). |
| `tests/helpers/db.ts` | `prismaTestClient()` wrapped in the PII extension (lazy require, as the source); `RESET_TABLES` gains the audit tables; the direct-URL helper fixed. |
| `tests/helpers/tenant-fixture.ts` | Lookup by `emailHash`. |
| `tests/integration/api-security-layers.test.ts` | Audit rows cleared before teardown deletes. |
| `tests/integration/auth-signin-no-auto-join.test.ts` | Audit rows cleared before teardown deletes; lookups by `emailHash`. |
| `tests/integration/invite-redemption.test.ts` | Audit rows cleared before teardown deletes; lookups by `emailHash`. |
| `tests/integration/invite-routes.test.ts` | Audit rows cleared before teardown deletes; lookups by `emailHash`. |
| `tests/integration/jwt-claims-refresh.test.ts` | Lookups by `emailHash`. |
| `tests/integration/last-owner-usecase-guard.test.ts` | Audit rows cleared before teardown deletes. |
| `tests/integration/multi-tenant-jwt.test.ts` | Lookups by `emailHash`. |
| `tests/integration/per-tenant-role-resolution.test.ts` | Lookups by `emailHash`. |
| `tests/integration/prisma-enum-values-exist-in-pg.test.ts` | Denominators raised to seven enums and 28 values. |
| `tests/integration/rls-coverage.test.ts` | Inventory gains `AuditLog` and `AuditOutbox`; `APPEND_ONLY_TABLES`; a test of the append-only privileges. |
| `tests/integration/user-session-rls.test.ts` | Audit rows cleared before teardown deletes. |
| `tests/setup/disconnect-after-suite.ts` | Drops the audit-stream buffers before disconnecting, so no flush timer outlives the file. |
| `tests/unit/credentials-auth.test.ts` | A TDZ-safe env mock; the lookup asserted on `emailHash`. |
| `tests/unit/db/pool-and-tenant-tx-limits.test.ts` | The audit-cleanup case from `audit-concurrency-limits.test.ts`; identity mocks for the encryption and PII extensions. |
| `tests/unit/jwt-update-trigger-refresh.test.ts` | `emailHash` in the lookup. |
| `tests/unit/register-refusal-codes.test.ts` | A production encryption key for the production cases; the `emailHash` unique violation; a case for the DEK written with the workspace. |
| `tests/unit/security-headers.test.ts` | No static CSP; `applySecurityHeaders`; COOP and CORP `same-origin` and no COEP (H1, decision 246). |
| `tests/unit/totp-crypto.test.ts` | `issuer=Islestone`. |

</details>

## Copied: jobs, notifications and observability (sub-phase 1.6)

The BullMQ queue, worker and scheduler with two jobs, the notification outbox, digest dispatcher and in-app bell, the observability layer (OpenTelemetry, metrics, business KPIs, job tracing, web vitals, shutdown), the per-workspace system user, and the CSP violation sink, ported by [`docs/porting/maps/1.6.md`](docs/porting/maps/1.6.md). These facts hold for every row below:

- **Source:** inflect-compliance at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`, at the path in the row's Source column (`same` means the same path).
- **Licence:** BUSL-1.1, licensor Inflect Ltd. Copying is allowed by [ADR 0001](docs/adr/0001-code-provenance-and-licences.md) decision D1. The source files carry no per-file notice, so none is added, and `NOTICE` takes no entry: no third-party material came with them.
- **What every port changed:** `inflect` names (queue, meters, tracers, Redis keys and connection names, the sender domain) are Islestone's; compliance jobs, templates, kinds and entities are cut or replaced by work items; `Notification.message` is `body` and `complianceMailbox` is `bccMailbox` (ADR 0006); env reads go through `@/env` / `@/env-client`; `import type` where an import is type-only.
- **Action** is COPY (byte for byte), COPY+EDIT (the source text, edited as the Changes column says), REWRITE (written fresh to the source's design), PATTERN (pattern only, no code copied), or Islestone-owned (written fresh, no source).
- **Licences:** `nodemailer` is MIT-0 (ADR 0007 E8) and the Sentry SDK brings `sentry`, FSL-1.1-Apache-2.0 (E9), both allowed by owner decision of 2026-11-19. No `NOTICE` entry: neither is copied code.
- **Not taken, by sub-phase:** the due reminders (2.2), the agent-run automation action (6.3), the key-rotation, DEK-sweep, global-PII and audit-outbox jobs (1.5b, now taken: see the next section), `UserNotificationPreference` (2.7), the flat `/api/notifications*` routes (they used a context 1.3 deleted), the bell UI and the admin notifications page (1.7, 2.7).

<details>
<summary>All 164 rows</summary>

| File | Source | Action | Changes |
|---|---|---|---|
| `docs/jobs.md` | `docs/worker-autoscaling.md`; the job-layer docblocks | COPY+EDIT | Written for Islestone around the two jobs: the pieces, adding a job, running it, Redis. |
| `docs/notifications.md` | `docs/scheduled-notification-system.md`; the notification-module docblocks | COPY+EDIT | Islestone's two bell kinds and two email types, the outbox lease, the sender fallback, the missing SMTP transport. |
| `docs/observability.md` | `docs/observability/` (job tracing, business KPIs); the module docblocks | COPY+EDIT | Logs, traces, metrics, KPIs, web vitals, the Sentry stub, shutdown and startup, as Islestone wires them. |
| `eslint-rules/rules/observable-gauge-rebinds.js` | `eslint-rules/rules/observable-gauge-rebinds.js` | COPY | None. |
| `eslint-rules/__tests__/observable-gauge-rebinds.test.ts` | `eslint-rules/__tests__/observable-gauge-rebinds.test.ts` | COPY+EDIT | One `no-require-imports` disable line. |
| `prisma/schema/notifications.prisma` | `prisma/schema/automation.prisma` (Notification, NotificationOutbox, TenantNotificationSettings) | COPY+EDIT | `Notification.message` is `body` (ADR 0006 bans "Message"); `complianceMailbox` is `bccMailbox`; `toEmail` encrypted in place (no `toEmailEncrypted`, ADR 0006 bans `@map`); `defaultFromName` "Islestone"; cascades from `Tenant` and `User`; `UserNotificationPreference` (2.7) and `ReminderHistory` (compliance) not taken. |
| `prisma/migrations/20261119150000_notifications_and_system_user/migration.sql` | the notification migrations; `20261029200000_tenant_system_user` | REWRITE | One fresh migration: the three tables and three enums from `prisma migrate diff`; grants (no DELETE or TRUNCATE on the outbox and settings); canonical RLS; the system user's row-shape CHECK and the six `*_not_system_user` CHECKs on Islestone's tables. |
| `scripts/worker.ts` | `scripts/worker.ts` | COPY+EDIT | The agent-run pause, automation bus, integration bootstrap and freshness reporting, DAU/MAU gauges and tripwire call cut; `islestone-worker`; the mailer is initialised in an IIFE; audit-stream buffers flushed at shutdown within `SHUTDOWN_AUDIT_FLUSH_MS`; `import type { Job }`. |
| `scripts/scheduler.ts` | `scripts/scheduler.ts` | COPY+EDIT | Comments only. |
| `scripts/worker-healthcheck.ts` | `scripts/worker-healthcheck.ts` | COPY+EDIT | Key and connection names. |
| `scripts/build-worker.mjs` | `scripts/build-worker.mjs` | COPY+EDIT | Three entry points (worker, scheduler, healthcheck); the ten seeders cut; the CJS-shim banner code kept, its comment reworded; the `@dub/*` alias dropped. |
| `src/app-layer/jobs/types.ts` | `src/app-layer/jobs/types.ts` | REWRITE | Two payload keys (`health-check`, `notification-outbox-flush`) and their defaults; `MonitoredEntityType` is `WORK_ITEM`; `NamesEveryField` and `JobRunResult` kept; `QUEUE_NAME` `islestone-jobs`. |
| `src/app-layer/jobs/queue.ts` | `src/app-layer/jobs/queue.ts` | COPY+EDIT | Tracer `islestone.jobs`; comments; `closeQueue` also quits the queue's Redis connection (Islestone fix: BullMQ leaves a passed connection open). |
| `src/app-layer/jobs/executor-registry.ts` | `src/app-layer/jobs/executor-registry.ts` | COPY+EDIT | Two registrations; `NonRetryableJobError` replaces the integration errors; `recordQueueRetryBypass` from `metrics.ts`; header redrawn; the outbox flush names its payload fields (`NamesEveryField`). |
| `src/app-layer/jobs/non-retryable.ts` | — | Islestone-owned | `NonRetryableJobError` and its guard (map: new), so the registry imports no integration code. |
| `src/app-layer/jobs/schedules.ts` | `src/app-layer/jobs/schedules.ts` | COPY+EDIT | Two schedules; `RETIRED_SCHEDULER_NAMES` empty. |
| `src/app-layer/jobs/register-schedules.ts` | `src/app-layer/jobs/register-schedules.ts` | COPY+EDIT | Comments: compliance job names and history. |
| `src/app-layer/jobs/fan-out.ts` | `src/app-layer/jobs/fan-out.ts` | COPY+EDIT | `recordDispatchEnqueueFailed` from `metrics.ts`. |
| `src/app-layer/jobs/drain-pages.ts` | `src/app-layer/jobs/drain-pages.ts` | COPY | None. |
| `src/app-layer/jobs/tenant-job-lookup.ts` | `src/app-layer/jobs/tenant-job-lookup.ts` | COPY | None. |
| `src/app-layer/jobs/worker-heartbeat.ts` | `src/app-layer/jobs/worker-heartbeat.ts` | COPY+EDIT | Key `islestone:worker:heartbeat`. |
| `src/app-layer/jobs/notification-outbox-flush.ts` | `src/app-layer/jobs/notification-outbox-flush.ts` | COPY+EDIT | Comments. |
| `src/app-layer/context-system.ts` | `src/app-layer/context-system.ts` | COPY+EDIT | `buildDelegatedJobContext`, the borrowed-actor picker and `resolveKeyInitiatorContext` cut; no `canAudit`; `grantsJson`; the system user's INSERT names Islestone's `User` columns. |
| `src/lib/tenant-system-user.ts` | `src/lib/tenant-system-user.ts` | COPY+EDIT | Replaces the 1.4 stub: `@islestone.invalid`, "Islestone automation", `tenantSystemUserEmailHash` kept. |
| `src/app-layer/notifications/app-link.ts` | `src/app-layer/notifications/app-link.ts` | COPY+EDIT | Reads `NEXT_PUBLIC_APP_URL` from `@/env-client`, not the server `APP_URL`. |
| `src/app-layer/notifications/tenant-link.ts` | `src/app-layer/notifications/tenant-link.ts` | COPY | None. |
| `src/app-layer/notifications/settings.ts` | `src/app-layer/notifications/settings.ts` | COPY+EDIT | `bccMailbox`; "Islestone"; `sanitizePlainText` on the sender name; `logEvent` from 1.5; comments name Islestone's callers. |
| `src/app-layer/notifications/templates.ts` | `src/app-layer/notifications/templates.ts` | REWRITE | Two react-email templates (`WORK_ITEM_ASSIGNED`, `DUE_DIGEST`), async, every link through `appLink`; the compliance templates not taken. |
| `src/app-layer/notifications/email/layout.tsx` | — | Islestone-owned | The shared react-email layout. |
| `src/app-layer/notifications/email/work-item-assigned.tsx` | — | Islestone-owned | The assignment template. |
| `src/app-layer/notifications/email/due-digest.tsx` | `src/app-layer/notifications/digest-templates.ts` (`buildDeadlineDigestEmail`) | REWRITE | The digest as a react-email component; the two audiences' copy (#3651) kept, singular and plural. **Removed in 2.7c** (owner decision 133): the due digest had no caller, and the daily `notification-digest` replaced it. |
| `src/app-layer/notifications/enqueue.ts` | `src/app-layer/notifications/enqueue.ts` | COPY+EDIT | A discriminated payload per `EmailNotificationType`, exhaustive; async build. |
| `src/app-layer/notifications/processOutbox.ts` | `src/app-layer/notifications/processOutbox.ts` | COPY+EDIT | Comments; the row's type passed to the mailer as the template name for its log line. |
| `src/app-layer/notifications/digest-dispatcher.ts` | `src/app-layer/notifications/digest-dispatcher.ts` | COPY+EDIT | `DUE_DIGEST` only; the dedupe key hashes the address (`hashForLookup`); `createMany({ skipDuplicates })`; async build; docblocks re-pointed at work items. **Removed in 2.7c** (owner decision 133): the due digest had no caller, and the daily `notification-digest` replaced it. |
| `src/app-layer/notifications/assignment.ts` | `src/app-layer/notifications/assignment.ts` | COPY+EDIT | One kind, `WORK_ITEM_ASSIGNED`; the link is the caller's; the in-app mute is asked before the write (new, map); `body`. |
| `src/app-layer/notifications/watcher.ts` | `src/app-layer/notifications/watcher.ts` | COPY+EDIT | Work-item fields; the link is the caller's; the mute check (new); `body`. |
| `src/app-layer/notifications/in-app-types.ts` | `src/app-layer/notifications/agentic.ts` (`listInAppNotificationTypes`) | REWRITE | Built from the two writers' copy tables. |
| `src/app-layer/notifications/inserted-ids.ts` | `src/app-layer/notifications/inserted-ids.ts` | COPY | None. |
| `src/app-layer/notifications/index.ts` | `src/app-layer/notifications/index.ts` | REWRITE | The barrel over the modules ported. |
| `src/lib/notifications/notification-bus.ts` | `src/lib/notifications/notification-bus.ts` | COPY+EDIT | The event's `body`. |
| `src/lib/notifications/notification-sse.ts` | `src/lib/notifications/notification-sse.ts` | COPY+EDIT | Docblock: one stream route. |
| `src/lib/notifications/mark-read.ts` | `src/lib/notifications/mark-read.ts` | COPY | None. |
| `src/lib/email/sender-identity.ts` | `src/lib/email/sender-identity.ts` | COPY+EDIT | Islestone's `.invalid` placeholder (`UNCONFIGURED_SENDER`); `SMTP_FROM` through `@/env`. |
| `src/lib/mailer.ts` | `src/lib/mailer.ts` | COPY+EDIT | Replaces the 1.4 stub, WITHOUT the SMTP transport (`nodemailer` is MIT-0, not on the allowlist): the console sink, `delivered: false`, and an `initMailerFromEnv` that says so; the sink logs `hashForLookup` of each recipient and the template, never the address, subject or body (`recipientLogFields`, new; owner decision 2026-11-19). |
| `src/app-layer/repositories/NotificationRepository.ts` | `src/app-layer/repositories/NotificationRepository.ts` | COPY+EDIT | `import type`; `body`. |
| `src/app-layer/schemas/notification-settings.schemas.ts` | `src/app-layer/schemas/notification-settings.schemas.ts` | COPY+EDIT | `bccMailbox`; `z.enum` over the mutable types. |
| `src/app-layer/usecases/notification.ts` | `src/app-layer/usecases/notification.ts` | COPY+EDIT | Imports. |
| `src/app-layer/usecases/notification-settings.ts` | `src/app/api/t/[tenantSlug]/notification-settings/route.ts`; `src/app/api/t/[tenantSlug]/notification-settings/run-job/route.ts` (their handler bodies) | REWRITE | The two routes' logic moved into usecases (Islestone's layer rule); the manual drain is scoped to the workspace and audited (`NOTIFICATION_OUTBOX_PROCESSED`). |
| `src/app/api/t/[tenantSlug]/notifications/route.ts` | `src/app/api/t/[tenantSlug]/notifications/route.ts` | COPY | None. |
| `src/app/api/t/[tenantSlug]/notifications/[id]/route.ts` | `src/app/api/t/[tenantSlug]/notifications/[id]/route.ts` | COPY+EDIT | The empty-body schema inline. |
| `src/app/api/t/[tenantSlug]/notifications/stream/route.ts` | `src/app/api/t/[tenantSlug]/notifications/stream/route.ts` | COPY+EDIT | Docblock carries the flat route's SSE rationale. |
| `src/app/api/t/[tenantSlug]/notification-settings/route.ts` | `src/app/api/t/[tenantSlug]/notification-settings/route.ts` | COPY+EDIT | Calls the usecases; `in-app-types`. |
| `src/app/api/t/[tenantSlug]/notification-settings/run-job/route.ts` | `src/app/api/t/[tenantSlug]/notification-settings/run-job/route.ts` | COPY+EDIT | Calls `drainWorkspaceOutbox`; `z.enum(['processOutbox'])`. |
| `src/lib/observability/instrumentation.ts` | `src/lib/observability/instrumentation.ts` | COPY+EDIT | Env through `@/env`; service name `islestone`; the logger imported lazily. |
| `src/lib/observability/job-runner.ts` | `src/lib/observability/job-runner.ts` | COPY | None. |
| `src/lib/observability/job-trace.ts` | `src/lib/observability/job-trace.ts` | COPY+EDIT | Tracer `islestone.worker`. |
| `src/lib/observability/job-payload-log.ts` | `src/lib/observability/job-payload-log.ts` | COPY | None. |
| `src/lib/observability/process-logger.ts` | `src/lib/observability/process-logger.ts` | COPY+EDIT | Env through `@/env`. |
| `src/lib/observability/repository-tracing.ts` | `src/lib/observability/repository-tracing.ts` | COPY+EDIT | `import type`; examples. |
| `src/lib/observability/shutdown.ts` | `src/lib/observability/shutdown.ts` | COPY+EDIT | Three stages (audit streams, OTel, Sentry); the agent-run and stream stages (Phase 6) cut. |
| `src/lib/observability/shutdown-budget.ts` | `src/lib/observability/shutdown-budget.ts` | COPY+EDIT | No run-pause budget; total seven seconds. |
| `src/lib/observability/sentry.ts` | same | COPY+EDIT | `SENTRY_*` and `NODE_ENV` through `@/env`; the sample rate parsed with `Number`; one comment's product reference. The `dataCollection` pin and `beforeSend` unchanged. |
| `src/lib/observability/client-telemetry.ts` | `src/lib/observability/client-telemetry.ts` | COPY+EDIT | `@/env-client`; the retry-header name. |
| `src/lib/observability/web-vitals.ts` | `src/lib/observability/web-vitals.ts` | COPY+EDIT | Meter `islestone-web-vitals`. |
| `src/lib/observability/vital-route.ts` | `src/lib/observability/vital-route.ts` | COPY+EDIT | Compliance routes out of the capability table; docblocks. |
| `src/lib/observability/metrics.ts` | `src/lib/observability/metrics.ts` | COPY+EDIT | Replaces the 1.5 partial: meter `islestone`; the request, cache, repository, job, decrypt, context, session, verification-email, SCIM, queue-depth, slow-query and SSR metrics; the Entra and Phase 6 metrics cut; `recordQueueRetryBypass` and `recordDispatchEnqueueFailed` moved in from `integration-metrics.ts` and renamed `job.queue.retry_bypassed` / `job.fanout.enqueue_failed`. |
| `src/lib/observability/business-metrics.ts` | `src/lib/observability/business-metrics.ts` | COPY+EDIT | Fifteen metrics; meter `islestone`; compliance KPIs cut. |
| `src/lib/observability/index.ts` | `src/lib/observability/index.ts` | COPY | The full barrel (replaces the 1.4 stub). |
| `src/lib/redis.ts` | `src/lib/redis.ts` | COPY+EDIT | Env through `@/env`; connection names. |
| `src/components/observability/WebVitalsReporter.tsx` | `src/components/observability/WebVitalsReporter.tsx` | COPY | None. |
| `src/app/api/telemetry/vitals/route.ts` | `src/app/api/telemetry/vitals/route.ts` | COPY+EDIT | An index guard on the forwarded IP. |
| `src/lib/security/csp-violations.ts` | `src/lib/security/csp-violations.ts` | COPY | None. |
| `src/app/api/security/csp-report/route.ts` | `src/app/api/security/csp-report/route.ts` | COPY+EDIT | Docblock. |
| `src/app/api/csp-report/route.ts` | `src/app/api/csp-report/route.ts` | REWRITE | Delegates to the sink's handler in-process instead of re-fetching the request's own origin (a request built from the Host header). |
| `tests/guards/bullmq-job-id-rule.test.ts` | `tests/guards/bullmq-job-id-rule.test.ts` | COPY+EDIT | Population from git. |
| `tests/guards/business-metrics-coverage.test.ts` | `tests/guardrails/business-metrics-coverage.test.ts` | COPY+EDIT | Fifteen metrics; Islestone's wiring points. |
| `tests/guards/cross-tenant-recipient-liveness.test.ts` | `tests/guards/cross-tenant-recipient-liveness.test.ts` | COPY+EDIT | Islestone's one-member census, no exemption; population from git; a planted repository. |
| `tests/guards/eslint-skips-build-output.test.ts` | `tests/guards/eslint-skips-build-output.test.ts` | COPY | None. |
| `tests/guards/executor-payload-forwarding.test.ts` | — | Islestone-owned | Map "new tests": no executor takes `_payload` or no parameter; planted registrations. |
| `tests/guards/job-trace-propagation.test.ts` | `tests/guardrails/job-trace-propagation.test.ts` | COPY+EDIT | The docs pointer. |
| `tests/guards/logging-import-hygiene.test.ts` | `tests/guardrails/logging-import-hygiene.test.ts` | COPY+EDIT | Population from git; Islestone's allowlist. |
| `tests/guards/mailer-init-wiring.test.ts` | `tests/guards/mailer-init-wiring.test.ts` | COPY+EDIT | `src/instrumentation-node.ts`. |
| `tests/guards/notif-sse-streaming-wiring.test.ts` | `tests/guards/notif-sse-streaming-wiring.test.ts` | COPY+EDIT | One stream route; the two bell writers in place of `task-due.ts`; the bell client (1.7) cut. |
| `tests/guards/redis-eviction-policy.test.ts` | `tests/guards/redis-eviction-policy.test.ts` | COPY+EDIT | Islestone's compose file; a planted positive control; `instrumentation-node.ts`. |
| `tests/guards/redis-prod-required.test.ts` | `tests/guardrails/redis-prod-required.test.ts` | REWRITE | Behavioural: the schema and the startup refusal, each failing without the other. |
| `tests/guards/redis-production-auth.test.ts` | `tests/guards/redis-production-auth.test.ts` | REWRITE | Behavioural over `src/env.ts` and the startup check. |
| `tests/guards/runtime-wiring-coverage.test.ts` | `tests/guardrails/runtime-wiring-coverage.test.ts` | COPY+EDIT | Part (2) only; empty on-demand list; planted miswiring. |
| `tests/guards/scheduler-orphan-reconciliation.test.ts` | `tests/guards/scheduler-orphan-reconciliation.test.ts` | COPY+EDIT | A planted retired name; Islestone's empty list. |
| `tests/guards/shutdown-budget-sanity.test.ts` | `tests/guardrails/shutdown-budget-sanity.test.ts` | COPY+EDIT | Three stages. |
| `tests/guards/system-principal-is-what-the-builder-writes.test.ts` | `tests/guards/system-principal-is-what-the-builder-writes.test.ts` | COPY | None. |
| `tests/guards/worker-bundle-defines-its-cjs-shims.test.ts` | `tests/guards/worker-bundle-defines-its-cjs-shims.test.ts` | COPY+EDIT | Population from git; a planted bundle source. |
| `tests/guards/worker-heartbeat-wiring.test.ts` | `tests/guards/worker-heartbeat-wiring.test.ts` | COPY+EDIT | Parts 4a/4b (compliance jobs) cut. |
| `tests/guards/worker-import-graph.test.ts` | `tests/guards/worker-import-graph.test.ts`; `tests/guards/worker-safe-imports.test.ts` | REWRITE | One walk from the three worker scripts on `tests/helpers/import-graph.ts`, every edge for the NextAuth seam, static edges for `next/headers`; a planted repository. |
| `tests/helpers/outbox-double.ts` | `tests/helpers/outbox-double.ts` | COPY | None. |
| `tests/integration/digest-recipient-membership.test.ts` | `tests/integration/digest-recipient-membership.test.ts` | COPY+EDIT | `DUE_DIGEST`, `WORK_ITEM`, MEMBER; the PII test client; `resetDatabase`. **Removed in 2.7c** (owner decision 133): the due digest had no caller, and the daily `notification-digest` replaced it. |
| `tests/integration/initiator-context-deleted-tenant.test.ts` | `tests/integration/initiator-context-deleted-tenant.test.ts` | COPY+EDIT | DB-gated; MEMBER; `resetDatabase`. |
| `tests/integration/jobs-queue-roundtrip.test.ts` | — | Islestone-owned | Enqueue to a real Redis, a Worker on the registry, both jobs, and `closeQueue` quitting its connection. |
| `tests/integration/notification-enqueue-duplicate-in-transaction.test.ts` | `tests/integration/notification-enqueue-duplicate-in-transaction.test.ts` | COPY+EDIT | The `WORK_ITEM_ASSIGNED` payload; `resetDatabase`. |
| `tests/integration/notification-per-user-scope.test.ts` | `tests/integration/notification-per-user-scope.test.ts` | COPY+EDIT | Islestone roles; `body`; the PII test client; `resetDatabase`. |
| `tests/integration/notification-push-carries-row-id.test.ts` | `tests/integration/notification-push-carries-row-id.test.ts` | COPY+EDIT | DB-gated; the two bell writers (the due reminder is 2.2); the caller's link. |
| `tests/integration/notification-settings-column-default.test.ts` | `tests/integration/notification-settings-column-default.test.ts` | COPY+EDIT | "Islestone"; the `mutedInAppTypes` default. |
| `tests/integration/notification-tables-isolation.test.ts` | — | Islestone-owned | The two-workspace test for the three tables, on the pattern of Islestone's `audit-tables-isolation.test.ts`. |
| `tests/integration/processOutbox-usecase.test.ts` | `tests/integration/processOutbox-usecase.test.ts` | COPY+EDIT | The PII test client; `WORK_ITEM_ASSIGNED`; `resetDatabase`; new: the at-rest check, a two-workspace drain, the drain usecase's `AuditLog` row and chain. |
| `tests/integration/tenant-system-user.test.ts` | `tests/integration/tenant-system-user.test.ts` | COPY+EDIT | Islestone's six guarded tables; part 3 audits through `logEvent` (the policy reminder is compliance). |
| `tests/unit/observability-sentry.test.ts` | same | COPY+EDIT | An Islestone fixture route; the SDK mock forwards to its mocks when called (TDZ under @swc/jest). |
| `tests/unit/observability/sentry-redaction.test.ts` | same | COPY+EDIT | Islestone fixture paths; one comment. |
| `tests/guards/sentry-privacy-posture-pinned.test.ts` | same | COPY+EDIT | One comment's product reference. |
| `tests/guards/next-auth-email-provider-unused.test.ts` | — | Islestone-owned | ADR 0004 question 7: the `next-auth` → `nodemailer` override holds only while nothing imports next-auth's email provider; population from git, a planted repository. |
| `tests/rendered/web-vitals-reporter-subscribes-once.test.tsx` | `tests/rendered/web-vitals-reporter-subscribes-once.test.tsx` | COPY | None. |
| `tests/unit/csp-reporting.test.ts` | `tests/unit/csp-reporting.test.ts` | COPY+EDIT | A `no-require-imports` disable line. |
| `tests/unit/digest-enum-schema-alignment.test.ts` | `tests/unit/digest-enum-schema-alignment.test.ts` | REWRITE | A type-level check over `DUE_DIGEST`; migrations from git. **Removed in 2.7c** (owner decision 133): the due digest had no caller, and the daily `notification-digest` replaced it. |
| `tests/unit/digest-tenant-eligibility.test.ts` | `tests/unit/digest-tenant-eligibility.test.ts` | COPY+EDIT | `DUE_DIGEST`, `WORK_ITEM`; the `createMany` mock; Islestone copy. **Removed in 2.7c** (owner decision 133): the due digest had no caller, and the daily `notification-digest` replaced it. |
| `tests/unit/drain-pages.test.ts` | `tests/unit/drain-pages.test.ts` | COPY | None. |
| `tests/unit/executor-registry.test.ts` | `tests/unit/executor-registry.test.ts` | COPY+EDIT | Two registrations; `NonRetryableJobError` cases; the integration mocks cut. |
| `tests/unit/initiator-context.test.ts` | `tests/unit/initiator-context.test.ts` | COPY+EDIT | Five roles and `grantsJson`; the pre-#4362 projections and `buildDelegatedJobContext` blocks cut. |
| `tests/unit/jobs-enqueue-job-id.test.ts` | `tests/unit/jobs-enqueue-job-id.test.ts` | COPY+EDIT | Islestone job names. |
| `tests/unit/jobs-fan-out.test.ts` | `tests/unit/jobs-fan-out.test.ts` | COPY+EDIT | The metric's module. |
| `tests/unit/jobs/bullmq-queue.test.ts` | `tests/integration/bullmq-queue.test.ts` | COPY+EDIT | Moved to the unit project (no Redis); two jobs; getters in the mock factories. |
| `tests/unit/jobs/bullmq-scheduler.test.ts` | `tests/integration/bullmq-scheduler.test.ts` | COPY+EDIT | Moved to the unit project; two schedules. |
| `tests/unit/jobs/job-contract-completeness.test.ts` | `tests/regression/infrastructure-guards.test.ts` | COPY+EDIT | The extract the map names. |
| `tests/unit/jobs/notification-outbox-flush-wiring.test.ts` | `tests/unit/jobs/notification-outbox-flush-wiring.test.ts` | COPY+EDIT | Paths. |
| `tests/unit/jobs/register-schedules.test.ts` | `tests/unit/jobs/register-schedules.test.ts` | COPY+EDIT | Planted retired names through a mock. |
| `tests/unit/mailer.test.ts` | same | COPY+EDIT | Islestone's domain; the env through the `@/env` mock; new: the lazy init, the password never logged, and no log line carrying an address or the body. |
| `tests/unit/notification-eligibility-guardrail.test.ts` | `tests/unit/notification-eligibility-guardrail.test.ts` | COPY | None. 2.7c: the digest dispatcher's cases replaced by the daily digest's. |
| `tests/unit/notification-enqueue.test.ts` | `tests/unit/notification-enqueue.test.ts` | COPY | None. |
| `tests/unit/notification-outbox.test.ts` | `tests/unit/notification-outbox.test.ts` | COPY | None. |
| `tests/unit/notification-sender-fallback.test.ts` | `tests/unit/notification-sender-fallback.test.ts` | COPY+EDIT | The Islestone placeholder; `bccMailbox`; the single-owner scan over Islestone's files. |
| `tests/unit/notification-settings-audit.test.ts` | `tests/unit/notification-settings-audit.test.ts` | COPY+EDIT | `bccMailbox`; the audit mock; the work-item types. |
| `tests/unit/notification-settings-route-authz.test.ts` | `tests/unit/notification-settings-route-authz.test.ts` | COPY+EDIT | The usecase layer. |
| `tests/unit/notification-settings.test.ts` | `tests/unit/notification-settings.test.ts` | COPY+EDIT | `bccMailbox`; the work-item types in the mute cases. |
| `tests/unit/notification-templates.test.ts` | `tests/unit/notification-templates.test.ts`; `tests/unit/notification-email-links-absolute.test.ts` | REWRITE | The two templates' copy, absolute links and escaping. 2.7c: the digest dispatcher's cases replaced by the daily digest's. |
| `tests/unit/notifications-mark-read-route.test.ts` | `tests/unit/notifications-mark-read-route.test.ts` | COPY | None. |
| `tests/unit/notifications/assignment.test.ts` | `tests/unit/notifications/assignment.test.ts` | COPY+EDIT | One kind; the caller's link; the muted case (new). |
| `tests/unit/notifications/in-app-types.test.ts` | — | Islestone-owned | Map "new tests": the catalogue is the writers' copy, and each writer mutes before it writes. |
| `tests/unit/notifications/notification-bus.test.ts` | `tests/unit/notifications/notification-bus.test.ts` | COPY+EDIT | The event's `body` and type. |
| `tests/unit/notifications/notification-sse-teardown.test.ts` | `tests/unit/notifications/notification-sse-teardown.test.ts` | COPY+EDIT | The event's `body` and type. |
| `tests/unit/notifications/watcher.test.ts` | `tests/unit/notifications/watcher.test.ts` | COPY+EDIT | Field renames; the muted case (new). |
| `tests/unit/observability-foundation.test.ts` | `tests/unit/observability-foundation.test.ts` | COPY+EDIT | Islestone names. |
| `tests/unit/observability-guards.test.ts` | `tests/unit/observability-guards.test.ts` | COPY+EDIT | Population from git; the exempt list. |
| `tests/unit/observability-instrumentation.test.ts` | `tests/unit/observability-instrumentation.test.ts` | COPY+EDIT | Env mock; service name. |
| `tests/unit/observability-metrics.test.ts` | `tests/unit/observability-metrics.test.ts` | COPY+EDIT | The metrics kept. |
| `tests/unit/observability-tracing.test.ts` | `tests/unit/observability-tracing.test.ts` | COPY+EDIT | No `canAudit`; work-item span names. |
| `tests/unit/observability/client-telemetry.test.ts` | `tests/unit/observability/client-telemetry.test.ts` | COPY | None. |
| `tests/unit/observability/document-load-denominator.test.ts` | `tests/unit/observability/document-load-denominator.test.ts` | COPY+EDIT | Islestone's middleware. |
| `tests/unit/observability/instrumentation-enabled.test.ts` | `tests/unit/observability/instrumentation-enabled.test.ts` | COPY+EDIT | Service name. |
| `tests/unit/observability/instrumentation-rebinds-gauges.test.ts` | `tests/unit/observability/instrumentation-rebinds-gauges.test.ts` | COPY | None. |
| `tests/unit/observability/job-execution-with-trace.test.ts` | `tests/integration/job-execution-with-trace.test.ts` | COPY+EDIT | Moved to the unit project; Islestone jobs. |
| `tests/unit/observability/job-payload-log.test.ts` | `tests/unit/observability/job-payload-log.test.ts` | COPY | None. |
| `tests/unit/observability/metrics-emission.test.ts` | `tests/unit/observability/metrics-emission.test.ts` | COPY+EDIT | The metrics kept. |
| `tests/unit/observability/observable-registry.test.ts` | `tests/unit/observability/observable-registry.test.ts` | COPY+EDIT | The gauges kept. |
| `tests/unit/observability/process-logger.test.ts` | `tests/unit/observability/process-logger.test.ts` | COPY+EDIT | Env. |
| `tests/unit/observability/shutdown-helpers.test.ts` | `tests/unit/observability/shutdown-helpers.test.ts` | COPY | None. |
| `tests/unit/observability/shutdown.test.ts` | `tests/unit/observability/shutdown.test.ts` | REWRITE | Three stages, their order and budgets. |
| `tests/unit/observability/vital-route-never-logs-a-capability.test.ts` | `tests/unit/observability/vital-route-never-logs-a-capability.test.ts` | COPY+EDIT | Islestone routes. |
| `tests/unit/observability/web-vitals.test.ts` | `tests/unit/observability/web-vitals.test.ts` | COPY+EDIT | Meter name. |
| `tests/unit/outbox-claim-before-send.test.ts` | `tests/unit/outbox-claim-before-send.test.ts` | COPY+EDIT | Islestone types; a typed call shape in place of `any`. |
| `tests/unit/redis-connection.test.ts` | `tests/integration/redis-connection.test.ts` | COPY+EDIT | Moved to the unit project (ioredis-mock); a `no-require-imports` disable line. |
| `tests/unit/redis-eviction-policy.test.ts` | `tests/unit/redis-eviction-policy.test.ts` | COPY | None. |
| `tests/unit/repository-tracing.test.ts` | `tests/unit/repository-tracing.test.ts` | COPY+EDIT | The mock without `@jest/globals` (hoisting); examples. |
| `tests/unit/scheduled-job-retry-policy.test.ts` | `tests/unit/scheduled-job-retry-policy.test.ts` | COPY | None. |
| `tests/unit/security/csp-report-get-rate-limit.test.ts` | `tests/unit/security/csp-report-get-rate-limit.test.ts` | COPY+EDIT | Lint: an `import type` in place of an `import()` type, a `no-require-imports` disable line. |
| `tests/unit/tenant-job-lookup.test.ts` | `tests/unit/tenant-job-lookup.test.ts` | COPY+EDIT | Islestone job names. |
| `tests/unit/worker-queue-depth-reporting.test.ts` | `tests/unit/worker-queue-depth-reporting.test.ts` | COPY+EDIT | The worker script. |
| `tests/unit/workspace-email-envelope.test.ts` | `tests/unit/workspace-email-envelope.test.ts` | COPY+EDIT | The envelope half; `bccMailbox`. |

</details>

Files from earlier sub-phases edited in 1.6 (their rows are in the sections above):

<details>
<summary>All 36 files</summary>

| File | Changed in 1.6 |
|---|---|
| `.env.example` | `REDIS_URL` (required and authenticated in production), the `OTEL_*`, `SMTP_*` and `SENTRY_*` variables, `NEXT_PUBLIC_TEST_MODE`. |
| `.github/workflows/ci.yml` | A Redis service (noeviction and a password set at run time) in Integration and E2E; `npm run build:worker` in Build. |
| `.gitignore` | `/dist/`. |
| `next.config.ts` | `@sentry/nextjs`, `@sentry/node` and `nodemailer` in `serverExternalPackages`. |
| `tests/unit/licence-gate.test.ts` | The allowlist pin follows ADR 0007 E8 and E9. |
| `docker-compose.yml` | Redis runs `--maxmemory-policy noeviction`. |
| `docs/rate-limiting.md` | The CSP sink's read-tier GET. |
| `docs/security-perimeter.md` | The CSP report endpoint and its section. |
| `eslint-rules/index.js` | Registers `observable-gauge-rebinds`. |
| `eslint.config.mjs` | The rule for `src/` and tests; `dist/**` ignored. |
| `jest.config.mjs` | `@react-email/render` compiled for Jest. |
| `playwright.config.ts` | `REDIS_URL` for the production server. |
| `prisma/schema/enums.prisma` | `NotificationType`, `EmailNotificationType`, `EmailOutboxStatus`. |
| `prisma/schema/tenancy.prisma` | Back-relations from `Tenant` and `User`. |
| `src/app/api/auth/register/route.ts` | `recordTenantCreated`. |
| `src/env-client.ts` | `NEXT_PUBLIC_TEST_MODE`. |
| `src/env.ts` | `REDIS_URL` required and authenticated in production; the `OTEL_*`, `SMTP_*`, `SENTRY_*` and `npm_package_version` variables. |
| `src/instrumentation-node.ts` | The `REDIS_URL` refusal; telemetry, Sentry, mailer, shutdown handlers and the eviction check (1.6's half of the source's `src/instrumentation.ts`). |
| `src/lib/auth/guard.ts` | `MACHINE_CALLER_PREFIXES`: the two CSP report paths and the vitals beacon. |
| `src/lib/security/csp.ts` | `report-uri` and `report-to`, and the report path and group constants. |
| `src/lib/security/pii-middleware.ts` | `NotificationOutbox.toEmail`. |
| `src/lib/security/route-permissions.ts` | The two notification-settings rules. |
| `src/middleware.ts` | The CSP sink's read-tier limit, `Report-To` and `Reporting-Endpoints`, the web-vitals denominator lines. |
| `tests/guards/encryption-manifest-coverage.test.ts` | The new free-text columns classified. |
| `tests/guards/enum-member-order-matches-migrations.test.ts` | Ten enums. |
| `tests/guards/machine-caller-paths-self-authenticate.test.ts` | Contracts for the three beacons; a planted ungated GET. |
| `tests/guards/schema-index-coverage.test.ts` | The three models. |
| `tests/guards/schema-vocabulary.test.ts` | The new models and enums. |
| `tests/guards/tenant-isolation-forward-lock.test.ts` | The three tables and their test. |
| `tests/guards/tenant-isolation-structural.test.ts` | `security`, `csp-report` and `telemetry` in `ALLOWED_API_DIRS`, with reasons. |
| `tests/helpers/run-env-script.ts` | An authenticated `REDIS_URL` in the valid production env. |
| `tests/integration/prisma-enum-values-exist-in-pg.test.ts` | Ten enums, 36 values. |
| `tests/integration/rls-coverage.test.ts` | The three tables; the no-DELETE privileges. |
| `tests/unit/auth-flow/middleware-mfa-gate.test.ts` | The beacons pass untouched. |
| `tests/unit/csp-refinement.test.ts` | The report directives. |
| `tests/unit/csp.test.ts` | The report directives. |

</details>

## Copied: rotation and outbox drain (sub-phase 1.5b)

The master-key rotation job and its admin route, `rotateTenantDek` with the per-workspace DEK sweep and its OWNER-only route, the global PII sweep script, and the audit-outbox drain, ported by [`docs/porting/maps/1.5.md`](docs/porting/maps/1.5.md) ("1.5b — Rotation and outbox drain") onto 1.6's job layer. These facts hold for every row below:

- **Source:** inflect-compliance at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`, at the path in the row's Source column (`same` means the same path).
- **Licence:** BUSL-1.1, licensor Inflect Ltd. Copying is allowed by [ADR 0001](docs/adr/0001-code-provenance-and-licences.md) decision D1. The source files carry no per-file notice, so none is added, and `NOTICE` takes no entry: no third-party material came with them.
- **What every port changed:** compliance models in comments and tests (`Risk`, `Finding`, `EvidenceReview`, `AuditorAccount`) are replaced by Islestone's (`TenantSecuritySettings`, `NotificationOutbox`); the API-key parts (`resolveApiKeyForJob`, the `apiKeyId` payload field and its tests) are cut until API keys exist (5.2); route handlers parse, call a usecase and respond (CLAUDE.md, "Layer rules"), so the source routes' enqueue, audit and lookup moved into `src/app-layer/usecases/key-rotation.ts`.
- **Action** is COPY (byte for byte), COPY+EDIT (the source text, edited as the Changes column says), REWRITE (written fresh to the source's design), or Islestone-owned (written fresh, no source).
- **Not taken:** `src/app/api/t/[tenantSlug]/admin/rotate-dek/route.ts` (an alias of `tenant-dek-rotation`) and, with it, the shared `admin/_lib/rotate-dek-handlers.ts`, whose logic is in the usecase; `scripts/generate-tenant-deks.ts` (every Islestone workspace gets its DEK at creation); `tests/unit/jobs/tenant-dek-rotation.test.ts` as a file (its cases are in `tests/integration/tenant-dek-rotation.test.ts`).

<details>
<summary>All 24 rows</summary>

| File | Source | Action | Changes |
|---|---|---|---|
| `scripts/rotate-global-pii.ts` | same | COPY+EDIT | Relative imports (as `scripts/verify-audit-chain.ts`); the `#!` line; comments name Islestone's columns and both pinned keys. |
| `src/app-layer/jobs/audit-outbox-flush.ts` | same | COPY+EDIT | Code unchanged; an ORDER section and the provenance note in the header. |
| `src/app-layer/jobs/key-rotation.ts` | same | COPY+EDIT | The run's actor re-resolved (`resolveRotationActor`, owner decision 2026-11-19): its entries carry the actor record in `detailsJson` and the result an `actor`, where the source wrote the initiator with `actorType: 'SYSTEM'`; `resolveApiKeyForJob`, its liveness block and `apiKeyId` cut (5.2); one index read made explicit; comments for Islestone's manifest and PII columns, the stale `rotateTenantDek` "stub" paragraph rewritten, the misplaced `@internal` moved. |
| `src/app-layer/jobs/rotation-actor.ts` | — | Islestone-owned | `resolveRotationActor`: the initiator re-resolved at run time, the workspace system user and the named refusal when they no longer resolve (owner decision, 2026-11-19). |
| `src/app-layer/jobs/tenant-dek-rotation.ts` | same | COPY+EDIT | The run's actor re-resolved, as in `key-rotation.ts` (owner decision 2026-11-19); otherwise code unchanged but for two index reads made explicit; the `/admin/rotate-dek` alias and GAP-22 references cut from comments; a "What it sweeps in Islestone" section. |
| `src/app-layer/schemas/key-rotation.schemas.ts` | — | Islestone-owned | `RotationJobStatusQuery` (the status routes' `jobId`). |
| `src/app-layer/usecases/key-rotation.ts` | `src/app/api/t/[tenantSlug]/admin/key-rotation/route.ts`, `admin/_lib/rotate-dek-handlers.ts` | REWRITE | The source routes' bodies as four usecases behind the two policies; `logEvent` inside `runInTenantContext` with a `detailsJson`; a refused in-flight rotation is a 409 (`conflict`) rather than the source's 500. |
| `src/app/api/t/[tenantSlug]/admin/key-rotation/route.ts` | same | COPY+EDIT | `admin.tenant_lifecycle` in place of `admin.manage` (OWNER-only, owner decision 2026-11-19); the handlers call the usecase; `jobId` parsed with Zod; `import type { NextRequest }`, `jsonResponse`; the `apiKeyId` payload spread deleted. |
| `src/app/api/t/[tenantSlug]/admin/tenant-dek-rotation/route.ts` | same; `admin/_lib/rotate-dek-handlers.ts` | COPY+EDIT | The handlers inline (no alias route to share them with), calling the usecase; `jobId` parsed with Zod. |
| `src/lib/security/tenant-key-manager.ts` | same | COPY | None: 1.5a's cut (the `enqueue` import and `rotateTenantDek`) restored, so the file is byte-identical to the source. |
| `tests/guards/tenant-dek-rotation-fallback.test.ts` | `tests/guardrails/tenant-dek-rotation-fallback.test.ts` | COPY | None (moved from `tests/guardrails/` to `tests/guards/`). |
| `tests/integration/audit-outbox-drain-order.test.ts` | — | Islestone-owned | The drain appends a backlog in event order after the existing chain, each entry linked to the one before it, and `verifyAuditChain` reads the chain as valid; run through the registered executor. |
| `tests/integration/audit-outbox-no-silent-drop.test.ts` | same | COPY | None. |
| `tests/integration/key-rotation-routes.test.ts` | — | Islestone-owned | Both routes against a real database: an ADMIN gets 403 and an `AUTHZ_DENIED` row, an OWNER 202 and the start entry, a second DEK rotation in flight 409. |
| `tests/integration/key-rotation.test.ts` | — | Islestone-owned | A master-key rotation played out against a real database, started by a member OWNER: every value it owns reads mid-flight, is rewritten, and reads under the new key alone; the teardown rotates the global PII rows back. |
| `tests/integration/rotation-initiator.test.ts` | — | Islestone-owned | Both rotations with the initiator still an OWNER (acts as them) and removed before the run (finishes as the system user, records who asked); a demoted and a deactivated initiator. |
| `tests/integration/tenant-dek-rotation.test.ts` | same; `tests/unit/jobs/tenant-dek-rotation.test.ts` | COPY+EDIT | On `TenantSecuritySettings` (one row per workspace, so one ciphertext per lifecycle); the unit file's DB-backed branch cases merged in, the "rewritten and skipped in one run" case split in two; a mid-flight read through the app's client and a second rotation after the sweep added; the CHECK case left to `tenant-dek-schema.test.ts`. |
| `tests/unit/key-rotation-admin-api.test.ts` | same | COPY+EDIT | Success cases as an OWNER and an ADMIN refused with an `AUTHZ_DENIED` entry (owner decision 2026-11-19); `makeRequestContext` (VIEWER for READER); a strict `@/lib/audit` mock and a `runInTenantContext` stub; `any` removed; the two `apiKeyId` cases replaced by one pinning the payload's three fields. |
| `tests/unit/key-rotation-job.test.ts` | same | COPY+EDIT | `resolveRotationActor` stubbed, with a system-branch case; `TenantSecuritySettings` for `Risk`; a planted manifest model without `tenantId` for the ownership-chained case; the tenant-scoped PII case on `NotificationOutbox.toEmail` (the map moved it to 1.4 while that list was empty; 1.6 filled it); the API-key cases cut (5.2); `any` removed. |
| `tests/unit/tenant-dek-rotation-admin-api.test.ts` | — | Islestone-owned | The DEK route: ADMIN refused on both verbs, an OWNER's swap through the real `rotateTenantDek`, both in-flight refusals as 409 with no audit entry, the status GET's 400 and 404s. |
| `tests/unit/tenant-key-manager.rotate.test.ts` | same | COPY+EDIT | The prisma mock through getters (TDZ under @swc/jest); one call read checked. |
| `docs/encryption.md` | `docs/epic-b-encryption.md` (rotation runbook); `docs/epic-f-finishing-touches.md` §F.2 | COPY+EDIT | "Rotating the master key" rewritten for the job, the route and the script; "Rotating a workspace's data key" added; the rotation signals. |
| `docs/audit-trail.md` | `src/app-layer/jobs/audit-outbox-flush.ts` docblock | COPY+EDIT | "The drain" section. |
| `docs/jobs.md` | the job-layer docblocks | COPY+EDIT | The three jobs and the on-demand rotations. |

</details>

Files from earlier sub-phases edited in 1.5b (their rows are in the sections above):

<details>
<summary>All 22 files</summary>

| File | Changed in 1.5b |
|---|---|
| `CLAUDE.md` | Current state, the commands, and the "Security perimeter" bullets for key rotation and the drain. |
| `docs/HANDOFF.md` | The 1.5b entry and its open questions. |
| `scripts/worker.ts` | A comment. |
| `src/app-layer/context-system.ts` | `ensureTenantSystemUser` writes `SYSTEM_USER_CREATED` in the insert's transaction when it creates the row (owner decision 2026-11-19). |
| `src/app-layer/events/audit.ts` | `logEvent`'s `{ withinTransaction: true }` option (`appendAuditEntryWithin`). |
| `src/app-layer/jobs/executor-registry.ts` | `keyRotationOutcome` (source L374–385) and the three registrations (source L771–804, L916–950, L952–992), each naming its payload fields with `NamesEveryField`; `apiKeyId` not forwarded; `audit-outbox-flush` also forwards `maxAttempts`, which the source dropped; the comments that said BullMQ retries a failed rotation corrected (one attempt). |
| `src/app-layer/jobs/fan-out.ts` | A comment. |
| `src/app-layer/jobs/register-schedules.ts` | The deletable set's comment names the two rotations. |
| `src/app-layer/jobs/schedules.ts` | `audit-outbox-flush` every five minutes (source L419–445). |
| `src/app-layer/jobs/types.ts` | `AuditOutboxFlushPayload`, `KeyRotationPayload` (without `apiKeyId`) and `TenantDekRotationPayload` (source L350–355, L459–519), their `JobPayloadMap` keys and `JOB_DEFAULTS` (source L1794–1810, L1839–1860). |
| `src/app-layer/policies/admin.policies.ts` | `assertCanRotateMasterKey` and `assertCanRotateTenantDek`, both `admin.tenant_lifecycle`, the usecase-layer twins of the route gates (Islestone-owned). |
| `src/lib/audit/index.ts` | Exports `appendAuditEntryWithin` and `AuditAppendClient`. |
| `src/lib/security/route-permissions.ts` | The two rules (source L898–906, L1229–1238), both `admin.tenant_lifecycle` (the source's master-key rule was `admin.manage`). |
| `tests/guards/executor-payload-forwarding.test.ts` | Five registrations. |
| `tests/guards/runtime-wiring-coverage.test.ts` | `ON_DEMAND_JOBS`: the two rotations, with their enqueue sites. |
| `tests/guards/schema-index-coverage.test.ts` | `AuditOutbox` triaged. |
| `tests/integration/epic-b-encryption.test.ts` | The two rotation cases restored (re-wrap; read after rotation). |
| `tests/integration/tenant-system-user.test.ts` | `SYSTEM_USER_CREATED`: one entry on the first call, none on a second or a concurrent one, none for a missing workspace. |
| `tests/unit/audit-trail-guardrails.test.ts` | The raw-SQL scan reads whole statements and refuses an interpolated table outside a named exception (the two sweeps); `ensureTenantSystemUser`'s raw insert listed with its reason; planted fixtures for both. |
| `tests/unit/executor-registry.test.ts` | Five registrations. |
| `tests/unit/jobs/job-contract-completeness.test.ts` | Three scheduled jobs. |
| `PROVENANCE.md` | This section; the 1.5 and 1.6 "Not taken" lines and the 1.5a `tenant-key-manager.ts` row. |

## Copied: application shell (sub-phase 1.7)

The authenticated application shell (sidebar, top chrome, mobile drawer), the three page shells, the command palette and shortcut help, the theme, the workspace and org context providers, the back-affordance navigation libraries, and the root providers, layout and error pages, ported by [`docs/porting/maps/1.7.md`](docs/porting/maps/1.7.md). These facts hold for every row below:

- **Source:** inflect-compliance at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`, at the path in the row's Source column (`same` means the same path).
- **Licence:** BUSL-1.1, licensor Inflect Ltd. Copying is allowed by [ADR 0001](docs/adr/0001-code-provenance-and-licences.md) decision D1. The source files carry no per-file notice, so none is added, and `NOTICE` takes no entry: no third-party material came with them.
- **What every port changed:** imports of the ten `@/components/ui/<name>` re-export shims point at `@inflect/ui/components/ui/<name>`; `import type` where an import is type-only; routes are Islestone's (My Work, Inbox, Projects, Views, Settings; ADR 0006), and the brand is `IS` / Islestone; compliance navigation, entities and fixtures are cut or replaced; English only.
- **Action** is COPY (byte for byte), COPY+EDIT (the source text, edited as the Changes column says), REWRITE (written fresh to the source's design), PATTERN (pattern only, no code copied), or Islestone-owned (written fresh, no source).
- **Not taken:** the org sidebar and switcher (8.3), the calendar badge (3.3), the onboarding tour (8.2), the assistant launcher (6.4), SWR devtools, the billing plan read (8.1), the risk money formatter and the process-canvas module flag, the legacy notification-link rewriter, the `/dashboard` shim, `WorkspaceShell` (4.2), `IdentityPill`, `use-guarded-push` (2.3), Inflect's `icon.svg` and `favicon.ico`, and `messages/bg.json`.
- **CISO-Assistant:** `EntityListPage.tsx` credited CISO-Assistant's `ModelTable.svelte` as the inspiration for one shell across every list. No CISO-Assistant code reaches Islestone: pattern only, no code copied (inherited through inflect-compliance). Its licence was re-read at `github.com/intuitem/ciso-assistant-community` commit `cbd830894001dd0e90eec8d287207c86b3f5cd41` (`LICENSE.md`, 2026-11-19): AGPL-3.0 outside the `enterprise` directory, which is under the intuitem Commercial License. The roadmap lists it as inspiration only; the credit line was removed from the copied comment.

<details>
<summary>All 128 rows</summary>

| File | Source | Action | Changes |
|---|---|---|---|
| `src/components/layout/AppShell.tsx` | same | COPY+EDIT | No org sidebar (8.3): both variants mount `SidebarContent`; no route full-bleed regex (`fullBleed={false}`; 4.2 adds the canvas); sign-out through `@/lib/auth/client-sign-out`; comments. |
| `src/components/layout/AppShellFrame.tsx` | same | COPY | None. |
| `src/components/layout/ClientProviders.tsx` | same | COPY+EDIT | No onboarding tour (8.2) or SWR devtools; mounts 1.6's `WebVitalsReporter`; a passthrough seam with the `userId` prop. |
| `src/components/layout/sidebar-collapse-context.tsx` | same | COPY | None. |
| `src/components/layout/breadcrumbs-store.tsx` | same | COPY+EDIT | No render-time ref write (Islestone's `react-hooks/refs` is an error): the effect reads the render's `items`; `items` derived inside `useMemo`. |
| `src/components/layout/MobileNavDrawer.tsx` | same | COPY+EDIT | The ten `@/components/ui/*` re-export shims imported from `@inflect/ui` (every file below likewise). |
| `src/components/layout/TopChrome.tsx` | same | COPY+EDIT | Initials `IS`; the brand mark goes to My Work; the bell in the workspace chrome only; `showLanguage` off with one locale; comments. |
| `src/components/layout/nav-bar.tsx` | same | COPY+EDIT | Comments (`IS`, My Work). |
| `src/components/layout/environment-badge.tsx` | same | COPY+EDIT | A set-state-in-effect line carries its disable directive and reason. |
| `src/components/layout/tenant-switcher.tsx` | same | COPY+EDIT | Rows go to `/t/<slug>/my-work`. |
| `src/components/layout/org-workspace-switcher.tsx` | same | COPY+EDIT | Rows go to `/t/<slug>/my-work`. |
| `src/components/layout/user-menu.tsx` | same | COPY+EDIT | Comment (`LOCALE_COOKIE`). |
| `src/components/layout/LocaleSwitcher.tsx` | same | COPY+EDIT | Comments (`LOCALE_COOKIE`). |
| `src/components/layout/notifications-bell.tsx` | same | COPY+EDIT | The open workspace's routes only: no flat `/api/notifications` fallback, nothing rendered outside a workspace; `body` for `message` (ADR 0006); "View all" opens the Inbox; relative time through next-intl's `relativeTime`; links used as stored (no legacy-link rewriter); comments. |
| `src/components/layout/session-expired-notice.tsx` | same | COPY+EDIT | Comment (the bell's poll, not the calendar badge). |
| `src/components/layout/SidebarNav.tsx` | same | REWRITE | `SidebarContent` kept (brand and collapse control, the navigation landmark, the palette opener, the footer); initials `IS`; the gear opens Settings behind `mayOpenSettings`; the navigation register moved, rewritten, to `nav-config.ts`; no calendar badge, agent-inventory gate, module flag or tour button. |
| `src/components/layout/nav-item.tsx` | same | COPY+EDIT | Comments (Islestone's rows and the Inbox badge). |
| `src/components/layout/nav-section.tsx` | same | COPY+EDIT | Comment (My Work, not Board). |
| `src/components/layout/PageActions.tsx` | same | COPY | None. |
| `src/components/layout/PageBreadcrumbs.tsx` | same | COPY | None. |
| `src/components/layout/PageHeader.tsx` | same | COPY+EDIT | A JSDoc example. |
| `src/components/layout/ListPageShell.tsx` | same | COPY+EDIT | `import type`; a comment. |
| `src/components/layout/EntityListPage.tsx` | same | COPY+EDIT | Comments and examples, including the CISO-Assistant inspiration line (see the pattern row below). |
| `src/components/layout/EntityDetailLayout.tsx` | same | COPY+EDIT | Imports the stepper from `./entity-prev-next-nav`; prose examples. |
| `src/components/layout/DashboardLayout.tsx` | same | COPY+EDIT | A comment. |
| `src/components/layout/entity-prev-next-nav.tsx` | `src/components/ui/entity-prev-next-nav.tsx` | COPY+EDIT | Moved out of the mirrored root to `src/components/layout`; `STEPPER_ENTITIES` empty (2.3 adds `workItem`); neighbour ids narrowed; comments. |
| `src/components/filters/FilterToolbar.tsx` | same | COPY+EDIT | A comment. |
| `src/components/command-palette/command-palette-provider.tsx` | same | COPY | None. |
| `src/components/command-palette/index.ts` | same | COPY | None. |
| `src/components/command-palette/command-palette.tsx` | same | COPY+EDIT | Entity groups for work items and projects; the chips and entity groups hidden while search is unavailable, without the signed-out text; a guarded shortcut lookup; comments. |
| `src/components/command-palette/use-entity-search.ts` | same | COPY+EDIT | `ENTITY_SEARCH_AVAILABLE` and an `unavailable` flag (false until 2.7b, true since); `match?.[1]`; the doc comment. |
| `src/components/command-palette/use-palette-commands.ts` | same | REWRITE | Types, `tenantPath` and `filterPaletteCommands` kept; the command list rewritten (My Work, Inbox, Projects, Views, Settings from `NAV_PATHS`; ask the assistant, toggle theme, sign out); sign-out through the auth seam. |
| `src/components/app-shell/shortcut-help-overlay.tsx` | same | COPY+EDIT | The shim imports only. |
| `src/components/assistant/assistant-open-context.tsx` | same | COPY | None. |
| `src/lib/palette/recents.ts` | same | COPY+EDIT | Comments. |
| `src/lib/palette/filter.ts` | same | COPY+EDIT | `countHitsByKind` derived from `SEARCH_TYPE_DEFAULTS`; comments. |
| `src/lib/search/types.ts` | same | REWRITE | `SearchHitType` is `workItem` and `project`, with their icon keys and defaults; the shapes and tunables kept; the header. |
| `src/lib/tenant-context-provider.tsx` | same | COPY+EDIT | Replaces the 1.4 stub, keeping its hooks: no currency or module bag; Islestone's coarse `Permissions`; the URL builders fall back to the route's slug outside the provider (the MFA pages). |
| `src/lib/org-context-provider.tsx` | same | COPY | None. |
| `src/components/theme/ThemeProvider.tsx` | same | COPY+EDIT | Follows the OS until a choice, as the source does, with a light server baseline (`DEFAULT_THEME`) and the dark query (`SYSTEM_DARK_QUERY`); the header. |
| `src/components/theme/ThemeToggle.tsx` | same | COPY+EDIT | The shim import. |
| `src/lib/theme-constants.ts` | same | COPY+EDIT | `DEFAULT_THEME` and `SYSTEM_DARK_QUERY`; the pre-paint script asks the OS for dark (light otherwise); `?? x` in the escaper; comments. |
| `src/lib/telemetry/form-telemetry.ts` | same | COPY+EDIT | The debug global is `__ISLESTONE_FORM_TELEMETRY__`; an example name. |
| `src/lib/zod-jitless.ts` | same | COPY | None. |
| `src/lib/locale-constants.ts` | same | COPY+EDIT | English only; `LOCALE_COOKIE = uiCookieName('locale')`; comments. |
| `src/i18n/request.ts` | `src/i18n.ts` | COPY+EDIT | At the plugin's default path, replacing 1.2's static config; the catalogue path. |
| `src/lib/nav/page-segregation.ts` | same | COPY+EDIT | Islestone's lists (five main pages, no subpages yet); a segment guard; the header. |
| `src/lib/nav/canonical-parents.ts` | same | COPY+EDIT | An empty `PARENT_MAP`; a segment guard; examples. |
| `src/lib/nav/back-destination.ts` | same | COPY+EDIT | A comment's example. |
| `src/lib/nav/usePreviousPath.ts` | same | COPY+EDIT | `match?.[1] ?? null`; a set-state-in-effect directive with its reason. |
| `src/components/nav/BackAffordance.tsx` | same | COPY+EDIT | `SECTION_LABELS` is the five shell routes; a type-only import. |
| `src/components/nav/NavigationTracker.tsx` | same | COPY | None. |
| `src/app/layout.tsx` | same, merged into Islestone's | COPY+EDIT | Islestone's nonce bridge kept; locale and messages; `data-theme` from the cookie, light by default; the pre-paint script with the nonce; `Providers`; `viewport`; Islestone's metadata. |
| `src/app/providers.tsx` | same | COPY+EDIT | A themed `<Toaster>` (it was pinned dark); comments. |
| `src/app/error.tsx` | same | COPY+EDIT | No browser Sentry call or `console.error` (Islestone reports on the server); `goToWorkspaces`; a full-load `location.assign`. |
| `src/app/not-found.tsx` | same | COPY+EDIT | `returnToWorkspaces`. |
| `src/app/global-error.tsx` | same | COPY+EDIT | No browser Sentry call or `console.error`; "Our team has been notified" dropped; `type="button"`. |
| `src/app/global-error.module.css` | same | COPY | None. |
| `src/app/page.tsx` | same | COPY+EDIT | Replaces the 1.1 placeholder; the session through `getSession`. |
| `src/app/t/[tenantSlug]/(app)/layout.tsx` | `src/app/t/[tenantSlug]/layout.tsx` and `src/app/t/[tenantSlug]/(app)/layout.tsx` | COPY+EDIT | The two merged into one, so the MFA pages can sit outside it in `(mfa)`; Islestone's `getTenantServerContext` (with the MFA gate) and its 404; no plan, currency, modules or assistant. |
| `src/app/t/[tenantSlug]/(app)/error.tsx` | same | COPY+EDIT | No `console.error`; goes to My Work; comments. |
| `src/components/layout/nav-config.ts` | — | Islestone-owned | The shell's routes (`NAV_PATHS`), the sidebar sections and `mayOpenSettings`. |
| `src/components/layout/PlaceholderPage.tsx` | — | Islestone-owned | The placeholder destination: a page header and an empty state. |
| `src/app/t/[tenantSlug]/(app)/page.tsx` | — | Islestone-owned | Redirects to My Work. |
| `src/app/t/[tenantSlug]/(app)/{my-work,inbox,views,projects,settings}/page.tsx` | — | Islestone-owned | Placeholder pages; Settings asserts `mayOpenSettings` on the server. |
| `src/lib/auth/client-sign-out.ts` | — | Islestone-owned | The shell's sign-out, in the auth seam. |
| `src/components/command-palette/workspace-access.tsx` | — | Islestone-owned | The shell registers the member's `mayOpenSettings` for the palette, which sits above the workspace provider (owner decision row 40). |
| `src/app/icon.svg`; `tests/unit/app-icon.test.ts` | — | Islestone-owned | A generated `IS` letter favicon on the brand colours, a placeholder until a logo exists (owner decision row 39), and the test holding its colours to `tokens.css`. |
| `src/styles/tokens.css`, `src/app/globals.css (the 1.7 additions)` | `src/styles/tokens.css`, `tailwind.config.js`, `src/app/globals.css` | COPY+EDIT | The nav band and brand-mark tokens, built from the brand tokens; the nav and dashboard keyframes as `@theme` animations; `.icon-btn`; the reduced-motion rule. |
| `tests/rendered/app-shell-frame-landmarks.test.tsx` | same | COPY+EDIT | Fixture routes. |
| `tests/rendered/app-shell-shortcuts.test.tsx` | same | COPY+EDIT | A fixture description. |
| `tests/rendered/command-palette.test.tsx` | same | COPY | None. |
| `tests/rendered/command-palette-shortcut-badges.test.tsx` | same | COPY+EDIT | Fixture routes. |
| `tests/rendered/palette-commands.test.tsx` | same | COPY+EDIT | Rewritten for Islestone's command table; the vocabulary and agentic cases replaced by keyword cases; the filter-trigger source checks dropped. |
| `tests/rendered/shortcut-conflict-scenarios.test.tsx` | same | COPY+EDIT | Fixture routes. |
| `tests/rendered/shortcut-help-overlay.test.tsx` | same | COPY | None. |
| `tests/unit/keyboard-shortcut-provider-integration.test.ts` | same | COPY+EDIT | The themed toaster. |
| `tests/rendered/list-page-shell.test.tsx` | same | COPY+EDIT | Comments. |
| `tests/rendered/entity-list-page.test.tsx` | same | COPY+EDIT | Fixtures; the eyebrow and default `fillBody` cases added (from `list-header-row-hover`, `list-pagination`). |
| `tests/rendered/entity-detail-layout.test.tsx` | same | COPY+EDIT | Fixtures. |
| `tests/rendered/entity-detail-prev-next-prop.test.tsx` | same | COPY+EDIT | English only; fixtures. |
| `tests/rendered/entity-prev-next-nav.test.tsx` | same | COPY+EDIT | English only; the generic `item` phrase; plain id arrays. |
| `tests/rendered/filter-toolbar-live-search.test.tsx` | same | COPY+EDIT | A fixture route. |
| `tests/rendered/filter-select-enter-no-match.test.tsx` | same | COPY+EDIT | Fixtures. |
| `tests/rendered/filter-single-select-switch.test.tsx` | same | COPY+EDIT | A project status filter. |
| `tests/rendered/tooltip-migration.test.tsx` | same | COPY | None. |
| `tests/rendered/mobile-nav-drawer-a11y.test.tsx` | same | COPY+EDIT | My Work fixtures. |
| `tests/rendered/mobile-nav-drawer-autofocus.test.tsx` | same | COPY+EDIT | My Work fixtures. |
| `tests/rendered/nav-bar-states.test.tsx` | same | COPY+EDIT | Islestone's brand and route. |
| `tests/rendered/nav-item-states.test.tsx` | same | COPY+EDIT | Fixtures. |
| `tests/rendered/nav-item-active-band-tone.test.tsx` | same | COPY+EDIT | Islestone's theme blocks; the page tone read from tokens.css. |
| `tests/rendered/nav-item-active-contrast.test.tsx` | same | COPY | None. |
| `tests/rendered/nav-item-dropped-click-guard.test.tsx` | same | COPY+EDIT | Fixtures. |
| `tests/rendered/nav-item-prefetch.test.tsx` | same | COPY+EDIT | The Inbox fixture. |
| `tests/rendered/nav-seams-for-hosts.test.tsx` | same | COPY+EDIT | A mocked second locale; fixtures. |
| `tests/rendered/top-bar-touch-and-slots.test.tsx` | same | COPY+EDIT | A fixture route. |
| `tests/rendered/user-menu-a11y.test.tsx` | same | COPY+EDIT | The provider value (no modules; Islestone's roles and coarse shape). |
| `tests/rendered/user-menu-profile-link.test.tsx` | same | COPY+EDIT | The provider value; a case for the session's photo (from `avatar-renderer-convergence`). |
| `tests/rendered/user-menu-mfa-link.test.tsx` | same | COPY+EDIT | The provider value; roles. |
| `tests/rendered/workspace-switcher-role-words.test.tsx` | same | COPY+EDIT | A fixture route. |
| `tests/rendered/sidebar-role-label.test.tsx` | same | COPY+EDIT | Islestone's roles; no org sidebar half. |
| `tests/rendered/sidebar-admin-link-membership-role.test.tsx` | same | COPY+EDIT | The Settings gear; Islestone's roles. |
| `tests/rendered/notifications-bell-behaviour.test.tsx` | same | COPY+EDIT | Inside a workspace; `body`; next-intl relative time. |
| `tests/rendered/notifications-open-workspace.test.tsx` | same | COPY+EDIT | The bell cases only; Inbox; nothing outside a workspace. |
| `tests/rendered/session-expired-notice.test.tsx` | same | COPY+EDIT | Comments; JSON imports. |
| `tests/rendered/session-expiry-swr-seam.test.tsx` | same | COPY+EDIT | Fixture keys. |
| `tests/rendered/theme-storage-on-choice.test.tsx` | same | COPY+EDIT | A dark and a light system, live following and a choice overriding the system, for the provider and the script; the matchMedia double answers per query. |
| `tests/rendered/locale-switcher.test.tsx` | same | COPY+EDIT | A mocked second locale. |
| `tests/rendered/i18n-kept-primitives.test.tsx` | same | COPY+EDIT | The shell's primitives only, English only. |
| `tests/rendered/root-error-pages-go-to-the-picker.test.tsx` | same | COPY+EDIT | The 404 case; a root error-page case; no `/dashboard` shim. |
| `tests/unit/theme-provider.test.ts` | same | COPY+EDIT | Islestone's names and default; the globals.css checks are the shell's. |
| `tests/unit/ui-storage.test.ts` | same | COPY+EDIT | The `islestone` prefix. |
| `tests/unit/palette-filter.test.ts` | same | COPY+EDIT | Work items and projects. |
| `tests/unit/palette-recents.test.ts` | same | COPY+EDIT | Work items and projects. |
| `tests/unit/zod-jitless.test.ts` | same | COPY | None. |
| `tests/unit/form-telemetry.test.ts` | same | COPY | None. |
| `tests/guards/dropdowns-no-option-truncation.test.ts` | same | COPY+EDIT | No org-switcher or canvas-palette block. |
| `tests/guards/app-shell-structure.test.ts` | `tests/guards/single-app-shell.test.ts`, `one-banner-landmark-in-src.test.ts`, `rq4-3-navigation-tracker.test.ts` | REWRITE | The three as one guard; population from git; a planted repository. |
| `tests/guards/page-segregation-coverage.test.ts` | `tests/guards/rq4-1-page-segregation.test.ts` | REWRITE | Population from git; the shell routes equal `NAV_PATHS`; a planted repository. |
| `tests/guards/keyboard-shortcut-conventions.test.ts` | `tests/guardrails/keyboard-shortcut-conventions.test.ts` | REWRITE | Population from git, mirrors out of scope; a planted repository; the docs-heading checks not ported. |
| `tests/guards/i18n-keys-resolve.test.ts` | same | REWRITE | English only; both quote styles; population from git; a planted repository. |
| `tests/guards/i18n-adoption.test.ts` | `tests/guardrails/i18n-adoption-ratchet.test.ts` | REWRITE | The rule, with a new TypeScript-AST detector, an empty baseline and a planted repository. |
| `tests/guards/i18n-locale-infrastructure.test.ts` | `tests/guardrails/i18n-locale-infrastructure.test.ts` | REWRITE | One locale; the plugin's default config path. |
| `tests/guards/theme-flash-init.test.ts` | same | REWRITE | Islestone's names, light default, no OS read. |
| `tests/guards/mobile-readiness.test.ts` | same | COPY+EDIT | The read bound to the `viewport` declaration. |
| `tests/e2e/app-shell.spec.ts` | `tests/e2e/tenant-switcher.spec.ts`, `theme-toggle.spec.ts`, `responsive.spec.ts`, `a11y.spec.ts` | PATTERN | Pattern only, no code copied: a fresh spec over the shell, the palette and the switcher. |
| `tests/rendered/app-shell.test.tsx`, `page-shells-a11y.test.tsx`, `tenant-context-provider.test.tsx`, `shell-placeholder-pages.test.tsx`; `tests/unit/home-page-redirect.test.ts`; `tests/integration/workspace-app-layout-gate.test.ts` | — | Islestone-owned | The shell end to end with jest-axe; the page shells under axe; the provider; the placeholder pages and the Settings gate; the root redirect; the layout's two-workspace gate. |
| `__mocks__/next-intl.js` | same | COPY+EDIT | `relativeTime` formats through `Intl.RelativeTimeFormat` rather than stringifying the date; ICU `plural` arguments are formatted (an exact `=n` branch, `one`, `other`, `#` through `Intl.NumberFormat`) rather than rendered as their source (3.1b). |

</details>

## Copied: environments and delivery (sub-phase 1.8)

The container build, the production Compose stack, the deploy scripts, the release and publish workflow, the report-only security scans and the change-management policy (roadmap 1.8; owner decisions 42 to 47 in `docs/HANDOFF.md`). These facts hold for every row below:

- **Source:** inflect-compliance at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`, at the path in the row's Source column. Each of those files is identical at that commit and at inflect's `origin/main` of 2026-11-19 (`884dbdd32d7869bb47d2416ec93186144fbb7730`), checked file by file.
- **Licence:** BUSL-1.1, licensor Inflect Ltd. Copying is allowed by [ADR 0001](docs/adr/0001-code-provenance-and-licences.md) decision D1. The source files carry no per-file notice. `NOTICE` gains an entry for the two third-party components the images carry (libvips, LGPL-3.0-or-later; elkjs, EPL-2.0; ADR 0007 E1a and E7); neither came with the copied text.
- **What every port changed:** inflect's single VM of its own became a shared one (Agrent's Caddy, its network, its scoped Watchtower); one image became two (app, standalone; worker, with the Prisma CLI); migrations moved from the app's entrypoint to a one-shot `migrate` service, with a start gate in both images; staging, previews, the IAP `VM check`/`VM apply` workflows, ClamAV, the embedder and the capacity recorder are not taken (owner decision 43; not needed).
- **Action** is COPY (byte for byte), COPY+EDIT, ADAPT (the source's structure and rules, rewritten for Islestone), PATTERN (pattern only, no code copied), or Islestone-owned (written fresh).

| File | Source | Action | Changes |
|---|---|---|---|
| `Dockerfile` | `Dockerfile` | ADAPT | Two runnable targets from one builder (`app`: the standalone server; `worker`: bundles, pruned tree, Prisma CLI); Node 24.22.3 on Alpine 3.23; npm removed and `HUSKY=0`; the `node` user; `.migration-head` and `scripts/wait-for-migrations.mjs` in both; `HEALTHCHECK` on `/api/livez` and the worker heartbeat; no entrypoint script, no seeds, no data directories; `BUILD_SHA` last, as inflect's. |
| `.dockerignore` | `.dockerignore` | ADAPT | Islestone's paths; `deploy/`, `eslint-rules/` and `__mocks__/` out; no re-included fixtures. |
| `deploy/docker-compose.prod.yml` | `deploy/docker-compose.prod.yml` | ADAPT | Header contract (canonical file, `:?` secrets, `--env-file`), the `x-logging` anchor, per-service `mem_limit`/`cpus` and heap ceilings, PgBouncer's quiet logging, Redis `noeviction`, the Watchtower labels and settings. New: the `migrate` one-shot, the runtime role, explicit per-service `environment:` with no `env_file:`, `islestone-` container names, `islestone_internal` and the external `agrent_internal`, the Watchtower scope and revive settings, Redis's password on stdin; no Caddy, ClamAV, embedder or uploads volume. |
| `deploy/caddy/islestone.caddy` | `deploy/caddy/Caddyfile` | ADAPT | Site blocks only (imported into Agrent's Caddyfile): the `app_site` body inlined for `islestone.cloud`, `www` redirected to it, Islestone's HSTS value, a 10 MB body limit, `islestone-app:3000` upstream with the forwarded headers; no global options or snippets. |
| `deploy/apply.sh` | `deploy/apply.sh` | ADAPT | The contract (repo-canonical, preflight by default, `CONFIRM=1`, backups, never reads `.env.prod` values, exit 0/1/2) rewritten for the shared VM: runs on the VM (shipped over IAP when started elsewhere); refuses without the Caddyfile import line, the read-only sites mount, a private complete `.env.prod`, or with an unscoped Watchtower; validates the site in `agrent-caddy`, installs, `compose up`, waits for health, then validates the whole Caddy configuration and reloads it, rolling the site back on failure. |
| `deploy/check-drift.sh` | `deploy/check-drift.sh` | ADAPT | Compares the four installed files with the repository and checks the host pieces Islestone depends on (import line, mount, network, Watchtower scopes, `.env.prod` names and mode, running containers and health). |
| `deploy/lib/common.sh` | `deploy/apply.sh` | ADAPT | The shared configuration, the IAP transport and the "names, never values" reading of the env file, as one library for the three scripts. |
| `deploy/backup.sh`, `deploy/gcs/backup-lifecycle.json` | — | Islestone-owned | `pg_dump` (custom format) with a listing check and retention; the upload to the GCS bucket as the VM's service account (owner decision 48) and the bucket's 30-day lifecycle; the restore drill, from a local file or the bucket, into a scratch database with a structure, row-count and audit-chain comparison. |
| `.github/workflows/pr-title.yml`, `scripts/check-pr-title.mjs`, `tests/unit/pr-title.test.mjs` | — | Islestone-owned | The Conventional Commit pull-request title check (owner decision 51). |
| `tests/guards/workflow-action-pinning.test.ts` | — | Islestone-owned | Every third-party action pinned to a commit SHA with its tag in a comment; population from git, a planted repository. |
| `deploy/postgres/init-runtime-role.sh` | `deploy/init-roles.sh` | PATTERN | Pattern only, no code copied: the runtime login role (not superuser, not BYPASSRLS, member of `app_user`) that docs/rls-tenant-isolation.md requires of production; password through `\getenv`, idempotent. |
| `deploy/.env.prod.example` | `deploy/.env.prod.example` | PATTERN | Pattern only, no code copied: Islestone's names, placeholders only. |
| `.github/workflows/release.yml` | `.github/workflows/release.yml`, `.github/workflows/ghcr-publish.yml` | ADAPT | One workflow: semantic-release (pinned through `npx`, no commit back to main, no comments) then build → scan → push of both images, immutable tags before `:latest`, `GITHUB_TOKEN` with `packages: write`; the Trivy step report-only under a dated deferral; no merge-queue gate or release app. |
| `.releaserc.json` | `.releaserc.json` | ADAPT | Branch `main`, `v${version}`, the Conventional Commits preset; commit analyser, release notes and the GitHub plugin only; no changelog, npm or git plugins and no minor odometer. |
| `.github/workflows/dast.yml` | `.github/workflows/dast.yml` | ADAPT | One role (an owner the run registers) instead of four seeded ones; Islestone's services and the standalone server; report-only under `DAST-NON-BLOCKING-UNTIL` until H1 made it blocking (2026-11-26); `ZAP_AUTH_HEADER_SITE` is the host name without the port (inflect's `localhost:<port>` matches no request, so the scan ran signed out); a random sign-up address. |
| `.github/workflows/ci.yml` (`Image` job) | `.github/workflows/ci.yml` (Docker Build, Trivy) | ADAPT | Builds both targets without pushing, reads the images (user, files, `BUILD_SHA`, no npm), Trivy SARIF report-only. |
| `.zap/assert-no-high-risk.mjs` | same | COPY+EDIT | Provenance note and the doc pointer. |
| `.zap/zap-json-to-sarif.mjs` | same | COPY+EDIT | Provenance note. |
| `.zap/rules.tsv` | same | ADAPT | Five of inflect's entries (90004 added in H1, decision 246), with Islestone's reasons; Islestone's own `OUTOFSCOPE` lines for 10044 (H1). |
| `.zap/dast-findings.md` | `.zap/dast-findings.md` | PATTERN | Pattern only, no code copied: the SARIF anchor file. |
| `src/lib/health/readiness.ts`, `src/app/api/readyz/route.ts` | `src/app/api/readyz/route.ts` | ADAPT | The checks (parallel, per-check timeout, closed error set, production refuses an unset Redis) moved into a module the handler calls; the app's own Prisma client; no storage check; `version` from `BUILD_SHA`. |
| `docs/change-management-policy.md` | `docs/change-management-policy.md` | ADAPT | Islestone's pipeline (PR checks, release.yml, Watchtower), the three classes, the approval matrix for a sole owner, the emergency procedure, forward-fix migrations; no merge queue, sub-processor or SOC 2 sections. |
| `docs/deployment.md` | `docs/deployment.md` | PATTERN | Pattern only, no code copied: a runbook written for the shared VM. |
| `tests/guards/security-scan-deferral.test.ts` | `tests/guardrails/dast-workflow-pinning.test.ts` | ADAPT | The dated-deferral clock for ZAP and Trivy alike, population from git, a planted repository; since H1 also the Trivy SARIF severity limit, `OUTOFSCOPE` entries and dated `.trivyignore` entries, written fresh. |
| `scripts/wait-for-migrations.mjs`, `scripts/start-standalone.mjs`, `tests/helpers/compose-file.ts`, `tests/guards/deploy-compose-files.test.ts`, `tests/unit/deploy/*.test.ts` (including `backup-script.test.ts`), `tests/integration/runtime-role.test.ts`, `tests/integration/wait-for-migrations.test.ts` | — | Islestone-owned | The migration start gate, the standalone start, the compose reader and the tests of the stack, the image, the Caddy site, `apply.sh` (against a stand-in `docker`), the runtime role and the gate. |

## Copied: work-item model and API (sub-phases 2.1–2.2)

The work-item model (teams, workflow states, projects, keys, types, work items, relations, labels, comments, watchers, links) and its usecases, repositories, routes, notifications and jobs, ported by [`docs/porting/maps/2.1-2.2.md`](docs/porting/maps/2.1-2.2.md) under [ADR 0002](docs/adr/0002-work-item-model.md). These facts hold for every row below:

- **Source:** inflect-compliance at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`, at the path in the row's Source column.
- **Licence:** BUSL-1.1, licensor Inflect Ltd. Copying is allowed by [ADR 0001](docs/adr/0001-code-provenance-and-licences.md) decision D1. The source files carry no per-file notice, so none is added, and `NOTICE` takes no entry: no third-party material came with them.
- **What every port changed:** the ADR 0006 vocabulary (`Task` → `WorkItem`, `TaskComment` → `Comment`, `TaskWatcher` → `WorkItemWatcher`, the fixed `TaskStatus` enum → a team's `WorkflowState` rows by category, `CANCELLED` with two Ls, `status` → state); everything compliance-shaped cut (the type, severity, source and phase enums, control and finding links, evidence, the four-eyes reviewer, the resolution text, the JSON checklist, metadata, SLA, source reconciliation, the `Issue*` aliases); every read and write carries `deletedAt` and project visibility explicitly (no soft-delete extension is ported); `import type` where an import is type-only.
- **Action** is COPY, COPY+EDIT, REWRITE (behaviour kept, code written fresh to the source's design), PATTERN (pattern only, no code copied), or Islestone-owned (written fresh, no source).
- **Read, not copied** (cited in the code and in this map): the implementation notes `2026-05-20-task-due-notifications.md`, `2026-05-20-task-due-notifications-event-driven.md`, `2026-07-17-task-lifecycle-watchers-reviewer.md`, `2026-07-17-task-surface-defects.md`, `2026-07-19-task-residuals.md`, `2026-08-12-task-vocabulary-and-executing-tests.md`, `2026-08-13-task-naming-seam-completed.md`, `2026-07-14-issue-vs-task.md`, `2026-08-21-job-rls-tenant-context.md` and `2026-08-24-destructive-routes-audit-denials.md` (all under `docs/implementation-notes/`); the reference migrations the map lists.

| File | Source | Action | Changes |
|---|---|---|---|
| `prisma/schema/work.prisma` | `prisma/schema/tasks.prisma` | REWRITE | ADR 0002 §12's models; the composite parent keys (`@@unique([id, tenantId])`, children by `(xId, tenantId)`) and the key-sequence docblock kept; every compliance column and relation dropped; the ADR §13 list indexes; the relation indexes ordered `[tenantId, fromId, type, toId]` / `[tenantId, toId, type]` so both foreign keys are indexed; `WorkItemLink.kind`/`target` named `type`/`location` (ADR 0006 bans "Kind" and "Target" in the schema); `sortKey` on every ordered list (ADR 0002 §5, where the map said `position`). |
| `prisma/schema/enums.prisma` (three enums, `WORK_ITEM_DUE`) | `prisma/schema/enums.prisma` lines 409–524, 637 | REWRITE | The eight task enums replaced by `WorkflowStateCategory`, `WorkItemPriority`, `WorkItemRelationType`; no `@@map`. |
| `prisma/migrations/20261119160000_notification_type_work_item_due/`, `20261119160100_work_core/` | `20260520190000_task_key_sequence` (lines 28–42, the Class A RLS template), `20260911150000_tenant_fks_composite_batch1_asset_task_component` (composite FKs) | REWRITE | One fresh migration (plus the enum value alone in its own); `COLLATE "C"`, the deferrable parent link, the relation CHECKs, the partial uniques and the category trigger are Islestone's (each with a catalogue test). |
| `src/app-layer/domain/workflow-state.ts` | `src/app-layer/domain/task-status.ts` | REWRITE | The shape of `checkTaskTransition` (pure, discriminated errors, display-name messages) over configurable states; the errors are `no_op`, `other_team`, `archived`; `stateTransitionEffects` new; the transition table and the eight statuses dropped. |
| `src/app-layer/domain/list-filter.ts` | same | COPY+EDIT | Code verbatim; the docblock's compliance examples rewritten for work items. |
| `src/app-layer/domain/fractional-index.ts`, `work-item-key.ts`, `work-item-graph.ts`, `work-item-type-icons.ts` | — | Islestone-owned | ADR 0002 F1 (owner decision 2026-11-19), keys, the cycle and depth rules, the type icon keys. |
| `src/lib/pagination.ts` | `src/lib/pagination.ts` | REWRITE | A keyset helper over `{ column, direction }` with an `id` tie-break, where the source was `(createdAt, id)` only; `clampLimit`, `DEFAULT_LIMIT` and `MAX_LIMIT` kept. |
| `src/lib/dto/pagination.ts`, `src/lib/filters/query-helpers.ts` | same | COPY | None. |
| `src/lib/list-backfill-cap.ts` | same | COPY+EDIT | `TASK_DELETED_LIST_CAP` → `WORK_ITEM_DELETED_LIST_CAP`; comments rewritten without the compliance pages. |
| `src/app-layer/policies/work-item.policies.ts` | `src/app-layer/policies/task.policies.ts` | COPY+EDIT | The five asserts renamed over 1.4's `work_items` keys; `assertCanDeleteWorkItems` added; the comment gate reads `work_items.comment`; the read-scope docblock rewritten for project visibility. |
| `src/app-layer/policies/project-visibility.ts`, `work-config.policies.ts`, `comment.policies.ts` | — | Islestone-owned | The guest seam (roadmap H2), failing closed until 8.4; the configuration gates and the comment rule (owner decisions, 2026-11-19). |
| `src/app-layer/repositories/WorkItemRepository.ts` | `src/app-layer/repositories/TaskRepository.ts` | COPY+EDIT | `parseListFilter`, `_buildWhere`, `list`, `listDeleted`, `getById`, `create`, `listByIds`, the bulk writes, `metrics` and the comment, watcher and link repositories kept and rewritten (per the map's edit list); the version check as one `updateMany`; the subtree, ancestry, purge, due-scan and rebalance reads added; every compliance read cut. |
| `src/app-layer/repositories/TeamRepository.ts`, `ProjectRepository.ts`, `WorkItemTypeRepository.ts`, `LabelRepository.ts`, `WorkItemRelationRepository.ts`, `ActivityRepository.ts`, `MembershipRepository.ts` | — (the last two move reads out of `usecases/task.ts` lines 155, 1250–1275 and 1867) | Islestone-owned | Written fresh; `ProjectRepository.claimNumber` is the `TaskKeySequence` upsert (`TaskRepository.ts` lines 626–638) scoped to a project. |
| `src/app-layer/usecases/work-item.ts`, `work-item-collab.ts`, `work-item-shared.ts` | `src/app-layer/usecases/task.ts` | COPY+EDIT | Per the map's "work-item.ts edits": create, list, get, update (with `If-Match`), state, assign, the bulk verbs, delete as a subtree soft delete under one `deletionId`, restore, comments (edit and delete added), watchers (audited, split self/other), links, metrics and Activity (merged with comments, cursor-paginated); each path's side-effect order kept; the compliance sections cut; the cache bump dropped (no cache is ported). |
| `src/app-layer/usecases/work-item-graph-lock.ts` | `src/app-layer/usecases/tenant-owner-lock.ts` | COPY+EDIT | `work-item-graph:<tenantId>`; the docblock rewritten for the graph. |
| `src/app-layer/usecases/team.ts`, `workflow-state.ts`, `project.ts`, `work-item-type.ts`, `label.ts`, `work-item-relations.ts`, `work-item-moves.ts`, `work-item-purge.ts` | — | Islestone-owned | Written fresh to the map's "New files"; Kaneo patterns noted in the Adopted row. |
| `src/app-layer/usecases/tenant-admin.ts` (`removeTenantMember`) | — | Islestone-owned edit | ADR 0003 §1 step 2: unassign the member's items, audited, before the membership is deleted. |
| `src/app-layer/automation/index.ts` | `src/app-layer/automation/event-contracts.ts` (`TASK_CREATED`, `TASK_STATUS_CHANGED`) | REWRITE | A no-op `emitAutomationEvent` stub until 5.1, carrying the typed contracts 5.1's action arms read. |
| `src/app-layer/notifications/work-item-due.ts` | `src/app-layer/notifications/task-due.ts` | COPY+EDIT | Renamed; date-only due days; the in-app mute check; the batch form (one write and one read-back per page); the link through `workItemPath`. |
| `src/app-layer/jobs/work-item-due-notification.ts` | `src/app-layer/jobs/task-due-notification.ts` | COPY+EDIT | The scan rewritten per workspace, inside its context, paged on `(dueDate, id)`; closed, unassigned, archived and deleted are skipped. |
| `src/app-layer/jobs/work-item-purge.ts`, `work-item-sortkey-rebalance.ts` | — | Islestone-owned | ADR 0002 §8 and §5. |
| `src/app-layer/jobs/types.ts`, `executor-registry.ts`, `schedules.ts` (three entries) | `src/app-layer/jobs/types.ts` lines 198–203, 890, 1649–1654; `executor-registry.ts` 637–660; `schedules.ts` 505–520 | COPY+EDIT | The due job's entry (08:00 in `NOTIFICATIONS_TZ`, two attempts) and two new jobs. |
| `src/app-layer/notifications/watcher.ts`, `assignment.ts` (1.6's files) | same | COPY+EDIT | `status_changed` → `state_changed`; comments on their callers. |
| `src/app-layer/notifications/templates.ts`, `email/work-item-assigned.tsx` (1.6's files) | `src/app-layer/notifications/templates.ts` lines 17–109 | REWRITE | The digest form for a bulk assign and the type row's name in the copy; no parent sign-off. |
| `src/lib/security/encrypted-fields.ts` (two entries) | same, lines 292–296 | COPY+EDIT | `WorkItem: ['description']`, `Comment: ['body']`. |
| `src/lib/db/encryption-middleware.ts` (1.5's file) | same | COPY+EDIT | A top-level write no longer fans out by field name for a model outside the manifest (it sealed `Notification.body` and `TenantCustomRole.description` once `Comment.body` was in the manifest). |
| `src/lib/schemas/work-item.ts` | `src/lib/schemas/index.ts` lines 653–674, 726–782, 789–793, 824–846, 970 | COPY+EDIT | Renamed; compliance fields dropped; project, type, state, priority, parent, labels and position added; date-only dates; plain `zod`. |
| `src/lib/schemas/work-config.ts`, `src/lib/http/if-match.ts`, `src/lib/work-item-paths.ts` | — | Islestone-owned | |
| `src/app/api/t/[tenantSlug]/work-items/**/route.ts` (25 files) | `src/app/api/t/[tenantSlug]/tasks/**/route.ts` (the 16 kept of the source's 19) | COPY+EDIT | Renamed; every method a literal `requirePermission` with its rule; `If-Match`; the watchers route split by target; `move`, `by-key`, `sub-items`, `deleted`, `relations` and `labels` new. |
| `src/app/api/t/[tenantSlug]/{teams,projects,work-item-types,labels}/**/route.ts` (12 files) | — | Islestone-owned | |
| `src/lib/security/route-permissions.ts` (the work rules) | same, lines 1716–1735 (pattern) | REWRITE | One rule per work route and method. |
| `tests/unit/list-filter.test.ts`, `filters-query-helpers.test.ts`, `list-backfill-cap.test.ts` | same | COPY+EDIT | Islestone's enums (literal sets); the import alias; comments. |
| `tests/unit/pagination.test.ts` | same | REWRITE | The keyset cases. |
| `tests/unit/domain/*.test.ts` (four), `tests/unit/http/if-match.test.ts`, `tests/unit/notification-work-item-assigned-digest.test.ts`, `tests/unit/notifications/work-item-due.test.ts`, `tests/unit/policies/work-item-policies.test.ts`, `tests/unit/repositories/work-item-repository-predicates.test.ts`, `tests/unit/usecases/work-item-sequence-order.test.ts` | `tests/unit/usecases/task-state-machine.test.ts`, `task-status.test.ts`, `task-status-sequence-order.test.ts`, `task-policies-assign-comment.test.ts`, `task-due-notification.test.ts`, `notification-task-assigned-digest.test.ts` (shape) | REWRITE | The property tests (fractional index, cycle refusal) are new. |
| `tests/integration/work-tables-isolation.test.ts`, `work-item-usecases.test.ts`, `work-item-graph.test.ts`, `work-items-api.test.ts`, `work-item-jobs.test.ts`, `tests/helpers/work-fixture.ts` | `tests/integration/task-isolation.test.ts`, `task-key-sequence.test.ts`, `task-usecase-branches.test.ts`, `task-status-change-sequence.test.ts`, `task-kpi-consistency.test.ts`, `task-due-notification.test.ts`, `tests/unit/tasks-routes-authz.test.ts` (shape) | REWRITE | Every work table, and the H2 matrix seed (VIEWER refusals audited, GUEST sees nothing). |
| `tests/guards/query-shape-guardrails.test.ts`, `tenant-crud-authz-coverage.test.ts`, `list-filter-enum-cast.test.ts`, `work-item-state-wiring.test.ts`, `work-item-due-emit-coverage.test.ts`, `work-item-assignment-alerts-wiring.test.ts`, `tests/helpers/emit-order.ts` | `tests/guardrails/query-shape-guardrails.test.ts`, `tests/guards/tenant-crud-authz-coverage.test.ts`, `list-filter-enum-cast.test.ts`, `tests/guardrails/task-status-machine-wiring.test.ts`, `tests/guards/notif-task-due-emit-coverage.test.ts`, `notif-assignment-alerts-wiring.test.ts` | REWRITE | Populations from git, planted fixtures; the source's compliance rows replaced. |
| `tests/e2e/work-items-api.spec.ts` | — | Islestone-owned | |
| `docs/pagination.md` | `docs/pagination.md` | COPY+EDIT | The keyset cursor over `(sortKey, id)` / `(updatedAt, id)`. |
| `docs/work-items.md` | — | Islestone-owned | The 2.1 and 2.2 design notes the map asks for. |

## Copied: work-item views (sub-phase 2.3)

The work-item list, board and detail (page and sheet), the create dialog, the client data layer they share and the pages that host them, built by [`docs/porting/maps/2.3.md`](docs/porting/maps/2.3.md). These facts hold for every row below:

- **Source:** inflect-compliance at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`, at the path in the row's Source column.
- **Licence:** BUSL-1.1, licensor Inflect Ltd., copying allowed by [ADR 0001](docs/adr/0001-code-provenance-and-licences.md) decision D1. The source files carry no per-file notice, and no third-party material came with them, so `NOTICE` takes no entry.
- **What every port changed:** the ADR 0006 vocabulary (`Task` → `WorkItem`, status → workflow state, checklist → sub-items); everything compliance-shaped cut (severity, the task type enum, source, the reviewer and "Awaiting my review", the resolution prompt, evidence, control and finding links, linked vendors, KPI sparklines, the SSR cache); server order and cursor pages instead of the source's 5,000-row in-memory sort; every write optimistic, versioned (`If-Match`) and rolled back; every removal through the undo toast; rendered tests query by role or label.
- **Action** is COPY+EDIT, REWRITE (behaviour kept, code written fresh to the source's design), PATTERN (pattern only, no code copied), or Islestone-owned (written fresh, no source). inflect-compliance has no board: the board is Islestone-owned.
- **Dependencies taken (not copied):** `@atlaskit/pragmatic-drag-and-drop` 4.0.0, `@atlaskit/pragmatic-drag-and-drop-hitbox` 3.0.0 and `@atlaskit/pragmatic-drag-and-drop-auto-scroll` 3.2.1, pinned; each one's `LICENSE.md` read at that version (Apache-2.0, "Copyright 2022 Atlassian Pty Ltd"). None ships a `NOTICE` file, so `NOTICE` takes no entry. Their dependencies `raf-schd` 4.0.3, `bind-event-listener` 3.0.0 and `@babel/runtime` are MIT. All are on the licence gate's allowlist (`npm run licence:check`). `@atlaskit/pragmatic-drag-and-drop-live-region` was not taken: the board's live region is written here.
- **Not used:** ln-dev7/circle (the roadmap's "layout ideas" for 2.3) was not read; its port-candidate row stays UNPINNED.

| File | Source | Action | Changes |
|---|---|---|---|
| `src/lib/data/api-client.ts` | `src/lib/api-client.ts` | COPY+EDIT | `ApiClientError`, the envelope reader and `apiGet` kept; the per-verb helpers became one `apiSend` carrying `If-Match`; the dev-only response validation (which logged through `console`) cut; `refusalReason` added. Outside the mirrored `src/lib/hooks`. |
| `src/lib/data/use-tenant-swr.ts` | `src/lib/hooks/use-tenant-swr.ts` | COPY+EDIT | The Zod `schema` option cut with `validateIfDev`; docblocks rewritten for work items; moved to `src/lib/data/`. |
| `src/components/work-items/data/use-work-item-list.ts`, `work-item-cache.ts`, `list-filters.ts`, `list-order.ts`, `use-work-config.tsx`, `use-work-item-mutations.ts`, `use-work-item-collab.ts` | `src/app/t/[tenantSlug]/(app)/tasks/TasksClient.tsx` lines 621–856 (`invalidateAllTasks`, the bulk mutations and their rollback, the partial-success toast), `tasks/[taskId]/page.tsx` lines 376–440 and 745–818 (the per-section reads, `invalidateTaskLists`, watchers, delete after navigating away), `src/lib/hooks/use-entity-list-ids.ts` (the prev/next order) | REWRITE | One list query (`useSWRInfinite`, cursor pages) for the list, every board column and the sub-items; one cache that places a changed row in every loaded list; one versioned write path (per-item queue, 409 retried when the fields did not move); the list order published to `sessionStorage` instead of re-fetching the list. |
| `src/components/work-items/WorkItemsView.tsx` | `src/app/t/[tenantSlug]/(app)/tasks/TasksClient.tsx`, `tasks/page.tsx` | REWRITE | On `EntityListPage`; the filter system with options from the server's configuration and the roster; the bulk bar (state by the scope's states or by category, assign, delete with undo); the Deleted view with restore; the layout toggle and the board; the detail sheet. Its columns and filter context later moved, unchanged, into `use-work-item-columns.tsx` and `use-work-item-filter-context.ts` (shared with My Work, owner decision 54), and its assignee scope went with My Work to `MyWorkView.tsx` (written fresh). |
| `src/components/work-items/filter-defs.ts` | `src/app/t/[tenantSlug]/(app)/tasks/filter-defs.ts` | COPY+EDIT | The factory, the `due` def and its labels and the key export kept (`TASK_FILTER_KEYS` → `WORK_ITEM_FILTER_KEYS`); the status, type, severity, source, reviewer and control defs cut; state, category, type, priority, label, assignee (from the roster) and project added. |
| `src/components/work-items/NewWorkItemModal.tsx` | `tasks/NewTaskModal.tsx`, `tasks/_form/useNewTaskForm.ts`, `tasks/_form/NewTaskFields.tsx` | REWRITE | 2.2's create fields; staged links, severity, reviewer, finding source and gap type cut; the discard guard and the refusal kept in the dialog with the text. |
| `src/components/work-items/WorkItemDetail.tsx`, `WorkItemSheet.tsx` | `src/app/t/[tenantSlug]/(app)/tasks/[taskId]/page.tsx`, `src/components/controls-shared/TaskEditPanel.tsx` | REWRITE | The body extracted so the page (`EntityDetailLayout`, prev/next) and the sheet render the same component over the same reads; state, assignee, priority, type, labels and due date; evidence, reviewer, checklist, resolution, source banner and compliance links cut. |
| `src/components/work-items/detail/collab-panels.tsx` | `tasks/[taskId]/page.tsx` lines 1278–1347, 1524–1678; `src/components/controls-shared/PanelActivityFeed.tsx` | REWRITE | Comments (decision 53, asked through `comment.policies.ts`), Activity, relations (with `WorkItemPicker`), URL links and watchers, each removal through the undo toast. |
| `src/components/work-items/detail/activity-phrases.ts` | `src/components/controls-shared/PanelActivityFeed.tsx` (`ACTION_PHRASE`) | PATTERN | Pattern only, no code copied: a phrase per `WORK_ITEM_*` action, with a test that every action the app layer writes has one. |
| `src/components/work-items/detail/SubItemsPanel.tsx` | `src/components/LinkedTasksPanel.tsx`, `src/components/controls-shared/TaskChecklistPanel.tsx` | REWRITE | Sub-items are work items with a parent (ADR 0006: no checklist); progress over DONE; a tick moves to the team's default DONE or UNSTARTED state; the separate create and edit keys kept. |
| `src/components/work-items/skeletons.tsx` | `tasks/loading.tsx`, `tasks/[taskId]/loading.tsx` | COPY+EDIT | Six columns; the shared skeletons. |
| `src/lib/work-items/presentation.ts` | `src/lib/task-status-badge.ts` | REWRITE | `Record<WorkflowStateCategory, …>` and `Record<WorkItemPriority, …>` (tsc holds both complete); severity cut. |
| `src/app-layer/usecases/tenant-admin.ts` (`listAssignableUsers`) | `src/app-layer/usecases/tenant-admin.ts` lines 117–184 | COPY+EDIT | The reviewer audience option, its eligibility select and filter cut; the shape `{ id, name, email, image }` kept. |
| `src/app/api/t/[tenantSlug]/users/assignable/route.ts` | same | COPY+EDIT | The `audience` query cut; a literal `requirePermission('work_items.view')` with its rule. |
| `tests/guards/undo-toast-coverage.test.ts` | `tests/guards/epic-67-rollout-coverage.test.ts` | REWRITE | Renamed for the invariant; population from git with a planted repository; Islestone's sites. |
| `tests/e2e/work-items.spec.ts` | `tests/e2e/issues.spec.ts` | REWRITE | Create, list, comment and detail kept in intent; the helpers rewritten (team, project and items through 2.2's API); the board cases are new. |
| `tests/rendered/work-item-mutations.test.tsx`, `work-items-list.test.tsx`, `work-item-detail.test.tsx` | `tests/rendered/tasks-bulk-mutation.test.tsx`, `tasks-list-role-surface.test.tsx`, `tasks-list-refusals.test.tsx`, `task-detail-mutation-failures.test.tsx`, `new-task-modal-links-and-refusals.test.tsx` | REWRITE | The behaviours kept (rollback, refusals shown, per-key gates, comment text kept, discard guard); queries by role and label; compliance cases dropped. |
| `src/components/work-items/board/*`, `badges.tsx`, `pickers.tsx`, `WorkItemPicker.tsx`, `LayoutToggle.tsx`, `ProjectsList.tsx`; `src/app-layer/usecases/work-item-views.ts`, `moveWorkItemOnBoard` in `work-item-moves.ts`; `src/lib/work-items/types.ts`; `src/lib/server/work-item-pages.server.ts`; the pages under `work-items/`, `projects/[projectKey]/`, `projects/` and `my-work/`; `tests/guards/work-item-views-shared-query.test.ts`, `tests/rendered/work-item-board.test.tsx`, `tests/unit/work-items/*`, `tests/integration/work-item-board-move.test.ts`, `tests/helpers/work-items-harness.tsx` | — | Islestone-owned | Written fresh. The board's pure model follows the shape (pure move functions, thin drag wiring) of inflect-compliance's `src/lib/framework-tree/builder-state.ts`: pattern only, no code copied. |

## Custom fields and saved views (sub-phase 2.4)

Built by [`docs/porting/maps/2.4.md`](docs/porting/maps/2.4.md). **Nothing was copied.** inflect-compliance has no custom fields and no server-side saved views: its filter presets (`src/lib/filters/filter-presets.ts`, `src/components/ui/filter/use-filter-presets.ts` at `5528464fc54a8681956f3b9ce23ca9c075f0420e`, BUSL-1.1) are already mirrored by 1.2 part B and unchanged; their caps (name length, count) informed the view schema, pattern only. Teable `packages/` and Kaneo were read for rules and semantics only; their rows are under "Adopted" below.

| File | Source | Action | Changes |
|---|---|---|---|
| `prisma/schema/work.prisma` (`CustomField`, `CustomFieldOption`, `CustomFieldValue`, `SavedView`), `prisma/schema/enums.prisma` (`CustomFieldType`, `ViewLayout`, `SavedViewVisibility`), migration `20261120120000_saved_views_and_custom_fields` | ADR 0002 §7 sketch | Islestone-owned | Written fresh from the ADR; `projectId` on the value under both composite FKs, `CustomFieldOption.archivedAt`, checkbox stores only `true`, the priority-rank trigger and the sort indexes. |
| `src/lib/work-items/custom-fields.ts`, `src/app-layer/domain/custom-field.ts` | Teable `packages/core/src/models/field/**`, `packages/core/src/models/view/filter/operator.ts` (see "Adopted") | PATTERN | Pattern only, no code copied: one exhaustive type table; strict write parsing; Teable's value rules with its number stripping and first-match person resolution refused; a reduced operator matrix over a typed value table. |
| `src/app-layer/repositories/CustomFieldRepository.ts`, `SavedViewRepository.ts`; `src/app-layer/usecases/custom-field.ts`, `saved-view.ts`; `src/app-layer/policies/saved-view.policies.ts`; `src/lib/schemas/custom-field.ts`, `saved-view.ts`; `src/lib/work-items/list-sorts.ts`; the multi-column keyset in `src/lib/pagination.ts`; the custom-field filters, sorts and `listByCustomField` in `WorkItemRepository.ts`; the routes under `projects/[projectId]/custom-fields/`, `work-items/[workItemId]/custom-fields/[fieldId]/` and `views/` | — | Islestone-owned | Written fresh. |
| `src/components/work-items/SavedViewsMenu.tsx`, `fields/*`, `data/use-saved-views.ts`, `data/use-custom-fields.ts`; `src/components/views/ViewsList.tsx`; the 2.4 changes to `WorkItemsView.tsx`, `WorkItemDetail.tsx`, `board/*`, `filter-defs.ts`, `use-work-item-columns.tsx`, `use-work-item-filter-context.ts`, `data/list-filters.ts`, `data/work-item-cache.ts`, `data/use-work-item-mutations.ts`, `src/components/settings/ProjectsSettings.tsx`; the Views page | — | Islestone-owned | Written fresh on the mirrored primitives (`Combobox`, `Modal`, `useColumnsDropdown`, `useToastWithUndo`, `DatePicker`, `Checkbox`). |
| `tests/integration/custom-fields-and-views.test.ts`, `tests/unit/domain/custom-field.test.ts`, `tests/unit/pagination-sorts.test.ts`, `tests/unit/policies/saved-view-policies.test.ts`, `tests/rendered/custom-fields-and-views.test.tsx`, `tests/e2e/custom-fields-views.spec.ts` | Teable's `filter.spec.ts`, `number.spec.ts`, `date.field.spec.ts` (behaviour only) | Islestone-owned | Written fresh from the behaviour the study describes; no Teable test was copied, so `NOTICE` takes no entry. |

## Cycles, cycle schedules and the burn-up (sub-phase 2.5a)

Built by [`docs/porting/maps/2.5.md`](docs/porting/maps/2.5.md) under owner decisions 62 to 75. **Nothing was copied.** inflect-compliance has no cycles of this kind, no state history and no burn-up (its "audit cycles" are an audit-readiness period). Its scheduler's discipline was read for the rollover, pattern only: the conditional claim before any work, and the deleted-workspace skip (`src/app-layer/jobs/control-test-scheduler.ts` at `5528464fc54a8681956f3b9ce23ca9c075f0420e`, BUSL-1.1). circle (MIT, UNPINNED) was not read; its study's §4.10 is why the burn-up is computed from recorded changes, not a curve. Kaneo's recurrence is for 2.5d and was not used here.

| File | Source | Action | Changes |
|---|---|---|---|
| `prisma/schema/work.prisma` (`CycleSchedule`, `Cycle`, `WorkItemTransition`, `WorkItem.cycleId`), `prisma/schema/enums.prisma` (`CycleRollover`), migration `20261121120000_cycles_and_transitions` | ADR 0002 §2, §10, §12 (the `Cycle` sketch) | Islestone-owned | Written fresh: the no-overlap exclusion constraint (btree_gist), the CHECKs, the SECURITY DEFINER transition trigger as the table's only writer (`app_user` holds SELECT alone). |
| `src/app-layer/domain/cycle.ts`, `src/app-layer/domain/burn-up.ts` | — | Islestone-owned | Written fresh; property-tested. |
| `src/app-layer/repositories/CycleRepository.ts`; `src/app-layer/usecases/cycle.ts`; `src/app-layer/policies/cycle.policies.ts`; `src/lib/schemas/cycle.ts`; the cycle routes under `src/app/api/t/[tenantSlug]/cycles/`, `teams/[teamId]/cycle-schedule/`, `work-items/[workItemId]/cycle/`; the 2.5a changes to `WorkItemRepository.ts`, `work-item.ts`, `work-item-moves.ts`, `work-item-views.ts` | — | Islestone-owned | Written fresh. |
| `src/app-layer/usecases/cycle-rollover.ts`, `src/app-layer/jobs/cycle-rollover.ts` | inflect-compliance `src/app-layer/jobs/control-test-scheduler.ts` (claim, deleted-workspace skip) | PATTERN | Pattern only, no code copied: a conditional `updateMany` closes each cycle once, in the transaction that moves its items; workspaces are swept per context as the system user. |
| `src/components/cycles/*`; `src/app/t/[tenantSlug]/(app)/cycles/**`; `src/lib/server/cycle-pages.server.ts`; the 2.5a changes to `WorkItemsView.tsx`, `WorkItemDetail.tsx`, `NewWorkItemModal.tsx`, `pickers.tsx`, `board/*`, `filter-defs.ts`, `use-work-item-columns.tsx`, `data/*`, the navigation | — | Islestone-owned | Written fresh; the chart composes the shared `@inflect/ui` chart primitives (already mirrored, 1.2). |
| `tests/integration/cycles.test.ts`, `cycles-sql-constructs.test.ts`, `tests/unit/domain/cycle.test.ts`, `burn-up.test.ts`, `tests/rendered/cycles.test.tsx`, `tests/e2e/cycles.spec.ts` | — | Islestone-owned | Written fresh. |

## Milestones (sub-phase 2.5b)

Built by [`docs/porting/maps/2.5.md`](docs/porting/maps/2.5.md) under owner decisions 62 and 72. **Nothing was copied.** inflect-compliance has no milestones; no other project's code was read for this part.

| File | Source | Action | Changes |
|---|---|---|---|
| `prisma/schema/work.prisma` (`Milestone`, `WorkItem.milestoneId`, `WorkItemTransition.milestoneId`), migration `20261122120000_milestones` | ADR 0002 §2, §10 (the item's `milestoneId`) | Islestone-owned | Written fresh: the composite NO ACTION foreign key, `COLLATE "C"` on `sortKey`, the transition trigger extended to the milestone. |
| `src/app-layer/repositories/MilestoneRepository.ts`; `src/app-layer/usecases/milestone.ts`; `src/app-layer/policies/milestone.policies.ts`; `src/lib/schemas/milestone.ts`; the milestone routes under `src/app/api/t/[tenantSlug]/projects/[projectId]/milestones/` and `work-items/[workItemId]/milestone/`; the 2.5b changes to `WorkItemRepository.ts`, `work-item.ts`, `work-item-moves.ts`, `work-item-views.ts` | — | Islestone-owned | Written fresh. |
| `src/components/milestones/*`; `src/app/t/[tenantSlug]/(app)/projects/[projectKey]/milestones/**`; `src/lib/server/milestone-pages.server.ts`; the 2.5b changes to `WorkItemsView.tsx`, `WorkItemDetail.tsx`, `NewWorkItemModal.tsx`, `pickers.tsx`, `board/*`, `filter-defs.ts`, `use-work-item-columns.tsx`, `data/*`, `list-sorts.ts`, `saved-view.ts`, the navigation | — | Islestone-owned | Written fresh. |
| `tests/integration/milestones.test.ts`, `tests/rendered/milestones.test.tsx`, `tests/unit/work-items/saved-view-config-keys.test.ts`, `tests/e2e/milestones.spec.ts` | — | Islestone-owned | Written fresh. |

## Waiting on (sub-phase 2.4b-a)

Built by [`docs/porting/maps/2.4b.md`](docs/porting/maps/2.4b.md) under owner decisions 100 and 103 to 107, from the Procore audit's top idea #1 (ideas only; see "Product ideas adopted into the roadmap"). **Nothing was copied.** inflect-compliance's `Task.reviewerUserId` (`prisma/schema/tasks.prisma` line 31 at 5528464fc54a8681956f3b9ce23ca9c075f0420e) was read as the nearest second-person column; its pattern was not taken.

| File | Source | Action | Changes |
|---|---|---|---|
| `prisma/schema/work.prisma` (`WorkItem.waitingOnUserId`, `WorkItemTransition.waitingOnUserId`), `enums.prisma` (`NotificationType.WORK_ITEM_WAITING_ON`), migrations `20261128120000_notification_type_waiting_on` and `20261128120100_waiting_on` | ADR 0002 §14 | Islestone-owned | Written fresh: the member FK, the closed-item CHECK, the transition trigger extended to the column. |
| `src/app-layer/domain/workflow-state.ts` (`stateTransitionEffects`), `src/app-layer/usecases/work-item.ts` (`setWorkItemWaitingOn`, the create), `work-item-shared.ts` (`emitWaitingOnBell`), `notifications/assignment.ts`, `tenant-admin.ts`, `recurrence-run.ts`, `WorkItemRepository.ts`, `TeamRepository.ts`, `src/lib/schemas/work-item.ts`, `saved-view.ts`, `route-permissions.ts`, the route `work-items/[workItemId]/waiting-on/` | — | Islestone-owned | Written fresh. |
| `src/components/work-items/` (`WorkItemDetail.tsx`, `NewWorkItemModal.tsx`, `pickers.tsx`, `board/*`, `filter-defs.ts`, `use-work-item-columns.tsx`, `data/*`, `detail/activity-phrases.ts`), `src/lib/work-items/list-sorts.ts`, `types.ts` | — | Islestone-owned | Written fresh. |
| `tests/integration/waiting-on.test.ts` and the 2.4b-a cases in the unit, guard and integration suites they extend | — | Islestone-owned | Written fresh. |

## Field sets (sub-phase 2.4b-b)

Built by [`docs/porting/maps/2.4b.md`](docs/porting/maps/2.4b.md) under owner decisions 101 and 108 to 112, from the Procore audit's idea of required, optional and hidden fields per record type (ideas only; see "Product ideas adopted into the roadmap"). **Nothing was copied.** inflect-compliance has no per-type field requirements for its tasks (searched at 5528464fc54a8681956f3b9ce23ca9c075f0420e, nothing relevant). The one-module design follows Islestone's own `compileIntakeRequestSchema` (2.6a): one client-safe module that every caller evaluates.

| File | Source | Action | Changes |
|---|---|---|---|
| `prisma/schema/work.prisma` (`WorkItemTypeField`, `CustomField @@unique([id, projectId, tenantId])`), `enums.prisma` (`FieldRequirement`, `RecurrenceHold.FIELD_SET_UNMET`), `tenancy.prisma`, migrations `20261130120000_recurrence_hold_field_set` and `20261130120100_field_sets` | ADR 0002 §1 and §7 | Islestone-owned | Written fresh: the CHECKs, partial uniques and composite cascades. |
| `src/lib/work-items/field-sets.ts`; `src/app-layer/repositories/FieldSetRepository.ts`; `src/app-layer/usecases/field-set.ts`; `src/lib/schemas/work-config.ts`, `intake.ts`, `template.ts`; the routes `work-item-types/[typeId]/fields/` and `projects/[projectId]/type-fields/`; `route-permissions.ts`; the 2.4b-b changes to `work-item.ts`, `work-item-collab.ts`, `cycle.ts`, `milestone.ts`, `custom-field.ts`, `recurrence-run.ts`, `intake-request.ts`, `project-template.ts`, `work-item-views.ts` | — | Islestone-owned | Written fresh. |
| `src/components/settings/WorkItemTypeFieldsSettings.tsx`, `src/app/t/[tenantSlug]/(app)/settings/work-item-types/[typeId]/page.tsx`, `src/components/work-items/data/use-field-sets.ts`; the 2.4b-b changes to `WorkItemTypesSettings.tsx`, `settings-data.ts`, `NewWorkItemModal.tsx`, `WorkItemDetail.tsx`, `IntakeDialogs.tsx`, `CustomFieldsManager.tsx`, `ItemTemplatesManager.tsx`, `use-work-config.tsx`, `activity-phrases.ts`, `src/lib/work-items/types.ts`, the navigation | — | Islestone-owned | Written fresh. |
| `tests/unit/work-items/field-sets.test.ts`, `tests/integration/field-sets.test.ts`, `tests/rendered/field-sets.test.tsx` and the 2.4b-b cases in the unit, guard, rendered and integration suites they extend | — | Islestone-owned | Written fresh. |

## Questions (sub-phase 2.4b-c)

Built by [`docs/porting/maps/2.4b.md`](docs/porting/maps/2.4b.md) under owner decisions 102 and 113 to 118, from the Procore audit's idea of a question with one marked answer (ideas only; see "Product ideas adopted into the roadmap"). **Nothing was copied.** inflect-compliance's `Task.resolution` (`prisma/schema/tasks.prisma` line 26 at 5528464fc54a8681956f3b9ce23ca9c075f0420e), a free-text column, was read and not taken: the answer here is a pointer to a comment.

| File | Source | Action | Changes |
|---|---|---|---|
| `prisma/schema/work.prisma` (`WorkItem.answerCommentId`, `Comment @@unique([id, workItemId, tenantId])`), migration `20261202120000_answers` | ADR 0002 §15 | Islestone-owned | Written fresh: the composite FK and the soft-delete trigger. |
| `src/app-layer/domain/work-item-answer.ts`, `src/app-layer/usecases/work-item-answer.ts`, `src/lib/work-items/question-preset.ts`; the 2.4b-c changes to `work-item.ts`, `work-item-collab.ts`, `work-item-type.ts`, `comment.policies.ts`, `notifications/watcher.ts`, `WorkItemRepository.ts`, `src/lib/schemas/work-item.ts`, `work-config.ts`, `route-permissions.ts`; the routes `work-items/[workItemId]/answer/` and `work-item-types/question-preset/` | — | Islestone-owned | Written fresh. |
| `src/components/work-items/detail/AnswerControls.tsx`; the 2.4b-c changes to `WorkItemDetail.tsx`, `collab-panels.tsx`, `activity-phrases.ts`, `use-work-item-mutations.ts`, `ItemTemplatesManager.tsx`, `WorkItemTypesSettings.tsx`, `src/lib/work-items/types.ts` | — | Islestone-owned | Written fresh. |
| `tests/integration/questions.test.ts`, `tests/unit/domain/work-item-answer.test.ts`, `tests/rendered/questions.test.tsx`, `tests/e2e/questions.spec.ts` and the 2.4b-c cases in the unit, guard, rendered and integration suites they extend | — | Islestone-owned | Written fresh. |

## Templates (sub-phase 2.5c)

Built by [`docs/porting/maps/2.5.md`](docs/porting/maps/2.5.md) under owner decisions 71 to 73. **Nothing was copied.** inflect-compliance has no work-item or project templates (its templates are compliance catalogues). Its "one projection from template to task" was read for the pattern, pattern only: `src/app-layer/usecases/control/task-from-template.ts` at `5528464fc54a8681956f3b9ce23ca9c075f0420e` (BUSL-1.1), whose lesson (one function, after four call sites drifted, and the item records where it came from) is `templateToCreateInput` and the `templateId` on `WORK_ITEM_CREATED`. Its `src/lib/processes/create-map-from-template.ts` (two round trips, no transaction) was read as the anti-pattern: a project template is applied in one transaction.

| File | Source | Action | Changes |
|---|---|---|---|
| `src/app-layer/domain/work-item-template.ts` (`templateToCreateInput`) | inflect-compliance `src/app-layer/usecases/control/task-from-template.ts` | PATTERN | Pattern only, no code copied: one pure projection from a template to a create input, used by every caller. |
| `prisma/schema/work.prisma` (`WorkItemTemplate`, `WorkItemTemplateLabel`, `ProjectTemplate`), `prisma/schema/tenancy.prisma`, migration `20261123120000_templates`; `src/lib/security/encrypted-fields.ts` (two entries) | ADR 0006 ("Template"), the 2.5 map | Islestone-owned | Written fresh. |
| `src/app-layer/repositories/TemplateRepository.ts`; `src/app-layer/usecases/work-item-template.ts`, `project-template.ts`; `src/app-layer/policies/template.policies.ts`; `src/lib/schemas/template.ts`; the routes under `src/app/api/t/[tenantSlug]/projects/[projectId]/work-item-templates/` and `project-templates/`; the 2.5c changes to `work-item.ts`, `project.ts`, `custom-field.ts`, `tenant-admin.ts`, `WorkItemRepository.ts` | — | Islestone-owned | Written fresh. |
| `src/components/work-items/templates/*`; `src/components/work-items/data/use-item-templates.ts`; `src/components/settings/ProjectTemplatesSettings.tsx`; `src/app/t/[tenantSlug]/(app)/settings/project-templates/page.tsx`; the 2.5c changes to `NewWorkItemModal.tsx`, `ProjectCreateDialog.tsx`, `ProjectsSettings.tsx`, `SettingsOverview.tsx`, `settings-data.ts`, the project page and the navigation | — | Islestone-owned | Written fresh. |
| `tests/integration/templates.test.ts`, `tests/unit/domain/work-item-template.test.ts`, `tests/rendered/templates.test.tsx`, `tests/e2e/templates.spec.ts` | — | Islestone-owned | Written fresh. |

## Repeats (sub-phase 2.5d)

Built by [`docs/porting/maps/2.5.md`](docs/porting/maps/2.5.md) under owner decisions 67 to 70. **Nothing was copied.** inflect-compliance has no recurring tasks (its recurrence is a cron schedule on a control test plan); its `src/app-layer/utils/cadence.ts` (months by calendar with the month-end clamp) and `src/app-layer/jobs/control-test-scheduler.ts` (the claim on a stamped next date, the deleted-workspace skip) at `5528464fc54a8681956f3b9ce23ca9c075f0420e` (BUSL-1.1) were read for the patterns. Kaneo's recurrence is in the Adopted table below.

| File | Source | Action | Changes |
|---|---|---|---|
| `src/app-layer/domain/recurrence.ts` | inflect-compliance `src/app-layer/utils/cadence.ts`; Kaneo `apps/api/src/task/recurrence/next-occurrence-date.ts` | PATTERN | Pattern only, no code copied: the month-end clamp computed from the first date, the rule's shape; written fresh on date-only values with no time zone, and property-tested. |
| `src/app-layer/usecases/recurrence-run.ts`, `src/app-layer/jobs/work-item-recurrence.ts` | inflect-compliance `src/app-layer/jobs/control-test-scheduler.ts` | PATTERN | Pattern only, no code copied: a conditional claim on the stamped next date in the transaction that makes the item; workspaces swept per context, deleted ones skipped. The copy is made as the re-resolved owner, never the system user. |
| `prisma/schema/work.prisma` (`WorkItemRecurrence`, `WorkItem.recurrenceId`, `occurrenceOn`), `prisma/schema/enums.prisma` (`RecurrenceFrequency`, `RecurrenceHold`), migration `20261126120000_repeats`; `src/app-layer/repositories/RecurrenceRepository.ts`; `src/app-layer/usecases/recurrence.ts`; `src/app-layer/policies/recurrence.policies.ts`; `src/lib/schemas/recurrence.ts`; the route `src/app/api/t/[tenantSlug]/work-items/[workItemId]/recurrence/`; the 2.5d options on `work-item.ts`'s `createWorkItemInTx` (`CreateInTxOptions`: `recurrenceId`, `occurrenceOn`, `subItems`), `WorkItemRepository.ts`, the job registry | ADR 0006 ("Repeat"), the 2.5 map | Islestone-owned | Written fresh. |
| `src/components/work-items/detail/RepeatControl.tsx`, `src/components/work-items/data/use-recurrence.ts`; the 2.5d changes to `WorkItemDetail.tsx`, `use-work-item-columns.tsx` | — | Islestone-owned | Written fresh. |
| `tests/unit/domain/recurrence.test.ts`, `tests/integration/repeats.test.ts`, `tests/rendered/repeats.test.tsx`, `tests/e2e/repeats.spec.ts` | — | Islestone-owned | Written fresh. |

## Intake (sub-phase 2.6a)

Built by [`docs/porting/maps/2.6.md`](docs/porting/maps/2.6.md) under owner decisions 85 to 99. **Nothing was copied.** inflect-compliance has no intake, form builder or triage; its two anonymous surfaces and its react-hook-form modals were read for their discipline, pattern only, at `5528464fc54a8681956f3b9ce23ca9c075f0420e` (BUSL-1.1). circle (MIT, UNPINNED) was not opened: its study's §4.8 describes the split view the Intake page follows, pattern only. Dependencies added: `react-hook-form` 7.92.0 and `@hookform/resolvers` 7.0.6 (both MIT, the versions inflect-compliance locks).

| File | Source | Action | Changes |
|---|---|---|---|
| `prisma/schema/intake.prisma`, the intake enums in `enums.prisma`, migrations `20261125120000_notification_type_intake` and `20261125120100_intake_core` | — | Islestone-owned | Written fresh: the status CHECKs, archive-only grants on forms and project intake, RLS on the four tables. |
| `src/lib/intake/form-definition.ts`, `src/lib/intake/types.ts`, `src/lib/intake/paths.ts`, `src/lib/schemas/intake.ts`, `src/app-layer/domain/intake.ts` | inflect-compliance `src/app-layer/usecases/vendor-assessment-response.ts` (`validateAnswerShape`, `sanitizeAnswerJson`) | PATTERN | Pattern only, no code copied: answers validated per field kind and text sanitised per answer; here one compiled Zod schema serves the browser and the server. |
| `src/app-layer/usecases/intake-request.ts`, `intake-form.ts`, `intake-settings.ts`, `intake-jobs.ts`; `src/app-layer/repositories/IntakeRepository.ts`; `src/app-layer/policies/intake.policies.ts`; `src/app-layer/notifications/intake.ts`; `src/app-layer/jobs/intake.ts`; the routes under `src/app/api/t/[tenantSlug]/intake/` and `projects/[projectId]/intake/`; `createWorkItemInTx` in `work-item.ts` | inflect-compliance `src/lib/trust-center/gated.ts` (an unavailable target answers like an unknown one; a rule the page shows is the server's) | PATTERN | Pattern only, no code copied: a form that is not open is a 404 whatever the reason (`formIsOpen`), and the form's schema is enforced on the server. The triage claim, the jobs and the bells follow Islestone's own 2.2 and 2.5a patterns. |
| `src/components/intake/*`, `src/components/settings/IntakeSettings.tsx`, `IntakeFormBuilder.tsx`, the intake pages under `src/app/t/[tenantSlug]/(app)/`, `src/lib/server/intake-pages.server.ts`, the navigation | inflect-compliance `src/app/t/[tenantSlug]/(app)/incidents/NewIncidentModal.tsx` (`useForm` + `zodResolver`); circle's study §4.8 (the split view) | PATTERN | Pattern only, no code copied. |
| `tests/integration/intake.test.ts`, `intake-api.test.ts`, `intake-tables-isolation.test.ts`, `intake-sql-constructs.test.ts`, `tests/unit/intake/form-definition.test.ts`, `tests/unit/domain/intake.test.ts`, `tests/unit/usecases/intake-accept-sequence-order.test.ts`, `tests/rendered/intake.test.tsx`, `tests/e2e/intake.spec.ts` | — | Islestone-owned | Written fresh. |

## Intake: public forms (sub-phase 2.6b)

Built by [`docs/porting/maps/2.6.md`](docs/porting/maps/2.6.md) under owner decisions 86, 88, 89 and 98. **Nothing was copied.** inflect-compliance has no public form, proof-of-work or trap field; two of its anonymous surfaces were read for their discipline, pattern only, at `5528464fc54a8681956f3b9ce23ca9c075f0420e` (BUSL-1.1).

| File | Source | Action | Changes |
|---|---|---|---|
| `src/app-layer/usecases/intake-public.ts` (`resolvePublicIntakeForm`: one narrow pre-tenant read, one answer for every closed case) | inflect-compliance `src/lib/trust-center/gated.ts`, `src/app/api/trust/[slug]/access-request/route.ts` | PATTERN | Pattern only, no code copied: a slug or link resolved under a named bypass to a narrow row, then everything in the resolved tenant's context; here a random public id, the system user as the actor, and the caps counted in the database. |
| `src/lib/intake/public/http.ts` (the `Sec-Fetch-Site: cross-site` refusal) | inflect-compliance `src/lib/security/admin-session-guard.ts` | PATTERN | Pattern only, no code copied: the header check, applied to two anonymous POSTs. |
| `src/lib/intake/public/form-token.ts`, `src/lib/intake/pow.ts`, `src/lib/intake/public/capped-body.ts`, `src/lib/intake/public-switch.ts`, `src/lib/intake/reference.ts`; the public routes under `src/app/api/intake/`; the `/f/` pages; `src/components/intake/public/*`; `src/app-layer/notifications/email/intake-requester.tsx`; migrations `20261127120000_email_type_intake` and `20261127120100_intake_public`; the 2.6b changes to `guard.ts`, `middleware.ts`, `rls-middleware.ts`, `pii-middleware.ts`, `rate-limit.ts`, `IntakeRepository.ts`, `intake-request.ts`, `intake-form.ts`, `IntakeFormRenderer.tsx`, `IntakeFormBuilder.tsx`, `IntakeSettings.tsx`, `IntakeView.tsx` | — | Islestone-owned | Written fresh. |
| `tests/integration/intake-public.test.ts`, `tests/unit/intake/public-bot-defence.test.ts`, `public-request-schema.test.ts`, `public-edge.test.ts`, `tests/guards/public-intake-boundary.test.ts`, `tests/rendered/intake-public.test.tsx` | — | Islestone-owned | Written fresh. |

## Intake: inbound email (sub-phase 2.6c)

Built by [`docs/porting/maps/2.6.md`](docs/porting/maps/2.6.md) under owner decisions 87, 98, 99 and 120 to 123. **Nothing was copied, and no dependency was added.** inflect-compliance has no inbound email (`git grep -i "inbound.*email\|mailparser\|imap"` over its `src/` at `5528464fc54a8681956f3b9ce23ca9c075f0420e` found none). The Svix signature scheme was taken from Svix's public description of it, and its published test vector is the unit test's fixture; no Svix or Resend library is used. The MIME parser, RFC 2047 decoder, HTML-to-text, quoted-history stripping and `Authentication-Results` reader are written fresh against the RFCs (5322, 2045 to 2047, 3676, 8601).

| File | Source | Action | Changes |
|---|---|---|---|
| `src/lib/intake/email/*` (`svix.ts`, `address.ts`, `rfc2047.ts`, `mime.ts`, `text.ts`, `auth-results.ts`, `content.ts`, `resend-api.ts`, `resend-download.ts`, `http.ts`, `switch.ts`), `src/lib/security/startup-intake-email-check.ts`, `src/app/api/intake/email/resend/route.ts` | Svix's public webhook-verification description (signed content, `whsec_` secret, `v1,` signatures, five-minute tolerance) | PATTERN | Pattern only, no code copied: the scheme reimplemented with `node:crypto`; the test vector asserted. |
| `src/app-layer/usecases/intake-email.ts`, `intake-blocked-senders.ts`; `src/app-layer/repositories/IntakeEmailRepository.ts`; `src/components/settings/IntakeBlockedSenders.tsx`; migrations `20261201120000_email_type_intake_ack` and `20261201120100_intake_email`; the routes under `src/app/api/t/[tenantSlug]/intake/blocked-senders/` and `projects/[projectId]/intake/email-address/`; the 2.6c changes to `guard.ts`, `env.ts`, `instrumentation-node.ts`, `capped-body.ts`, `mailer.ts`, `processOutbox.ts`, `enqueue.ts`, `templates.ts`, `intake-requester.tsx`, `encrypted-fields.ts`, `rate-limit.ts`, `IntakeRepository.ts`, `intake-request.ts`, `intake-public.ts`, `intake-settings.ts`, `intake-jobs.ts`, the jobs, `IntakeSettings.tsx`, `IntakeView.tsx`, `IntakeDialogs.tsx`; `docs/sub-processors.md` | — | Islestone-owned | Written fresh. |
| `tests/integration/intake-email.test.ts`, `tests/unit/intake/email-parsing.test.ts`, and the 2.6c cases in `intake-api.test.ts`, `intake-public.test.ts`, `intake-tables-isolation.test.ts`, `intake-sql-constructs.test.ts`, `tests/rendered/intake.test.tsx` | — | Islestone-owned | Written fresh. |

## Search over titles and keys (sub-phase 2.7b)

Built by [`docs/porting/maps/2.7.md`](docs/porting/maps/2.7.md) ("Part 2") under owner decisions 124 to 144 and [ADR 0008](docs/adr/0008-search-over-encrypted-fields.md); see [`docs/search.md`](docs/search.md). These facts hold for every COPY+EDIT row below:

- **Source:** inflect-compliance at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`, at the path in the row's Source column.
- **Licence:** BUSL-1.1, licensor Inflect Ltd. Copying is allowed by [ADR 0001](docs/adr/0001-code-provenance-and-licences.md) decision D1. The source files carry no per-file notice, so none is added, and `NOTICE` takes no entry: no third-party material came with them.

| File | Source | Action | Changes |
|---|---|---|---|
| `src/app-layer/usecases/search.ts` | `src/app-layer/usecases/search.ts` | COPY+EDIT | Cut from eight compliance queries and the global framework read to two, work items and projects, each a ranked raw read in its repository; `runInTenantReadContext`; `visibleProjects(ctx)` to both reads; the gate is `assertCanReadWorkConfig` (the route's `projects.view`) with work items skipped without `work_items.view` (`mayReadWorkItems`), where the source asserted "any domain viewable"; a typed key (current prefix, retired prefix, alias) resolved first and ranked first; the per-type limit clamped to `MAX_PER_TYPE_LIMIT`; the hit builders for the two types. Kept: the one transaction, per-domain skipping, the `perTypeLimit * 3` headroom, rank then cap, the response shape. |
| `src/lib/search/rank.ts` | `src/lib/search/rank.ts` | COPY+EDIT | The type baselines and zero-filled counts cut to `workItem` and `project`; an empty code no longer makes every query a prefix match; the id tie-break compares by code unit, not `localeCompare`. The bands, `sortHits` and `capPerType` unchanged. |
| `src/app/api/t/[tenantSlug]/search/route.ts` | `src/app/api/t/[tenantSlug]/search/route.ts` | COPY+EDIT | `getTenantCtx` became a literal `requirePermission('projects.view', …)` with its `route-permissions.ts` rule; the parameters are parsed by `SearchQuerySchema`, and a `limit` past 25 is a 400 where the source clamped it. |
| `tests/unit/search/search-rank.test.ts` | `tests/unit/search-rank.test.ts` | COPY+EDIT | Islestone's two types, the key and key-prefix cases, the empty-code and any-order word cases. |
| `tests/rendered/command-palette-entity-search.test.tsx` | `tests/rendered/command-palette-entity-search.test.tsx` | COPY+EDIT | Work-item and project hits; the framework case and the fan-out comments gone; the switch, a failed search and the minimum length asserted. |
| `src/components/command-palette/use-entity-search.ts`, `command-palette.tsx`, `src/lib/search/types.ts` (1.7's copies) | same | COPY+EDIT | `ENTITY_SEARCH_AVAILABLE = true`; `MAX_PER_TYPE_LIMIT`; the headers say the route exists. |
| `prisma/migrations/20261203120000_search_titles/`, `src/lib/search/query.ts`, `src/lib/schemas/search.ts`, `projectVisibilitySql` (`project-visibility.ts`), `WorkItemRepository.searchTitles`, `ProjectRepository.searchNames`, the escaped `q` in `_buildWhere`, `mayReadWorkItems`; `tests/integration/search.test.ts`, `tests/unit/repositories/search-repository-predicates.test.ts`, `tests/unit/search/search-query.test.ts` | — | Islestone-owned | Written fresh. inflect's search has no index and no full-text query (`grep` for `pg_trgm` / `to_tsvector` at the commit finds none). |

## Inbox, preferences and the digest (sub-phase 2.7c)

Built by [`docs/porting/maps/2.7.md`](docs/porting/maps/2.7.md) ("Part 4") under owner decisions 132 to 136; see [`docs/notifications.md`](docs/notifications.md). Nothing is copied.

| File | Source | Action | Changes |
|---|---|---|---|
| `NotificationPreference`, `EmailDelivery` (`prisma/schema/notifications.prisma`, `enums.prisma`), `src/lib/notifications/preferences.ts` | inflect-compliance at `5528464fc54a8681956f3b9ce23ca9c075f0420e`: `prisma/schema/automation.prisma` lines 116–128 (`UserNotificationPreference`) and `enums.prisma` line 848 (`NotificationDelivery`), BUSL-1.1 | Pattern only, no code copied | inflect's model is read and written by nothing; its shape (one row per user and type, a delivery enum) was the starting point. Islestone's row is per workspace member (`TenantMembership` FK, cascade), separates the bell (`inApp`) from email (`OFF`, `IMMEDIATE`, `DAILY`; inflect's `DISABLED` would have governed both), allows IMMEDIATE only for the direct types (a CHECK), and is capped by the workspace's settings in one pure resolution. |
| `src/components/inbox/`, `src/app-layer/jobs/notification-digest.ts`, `notification-purge.ts`, `src/app-layer/usecases/notification-preferences.ts`, `notification-retention.ts`, the Inbox's additions to `NotificationRepository.ts` and `usecases/notification.ts`, the notification routes' 2.7c methods, `src/components/settings/NotificationSettings.tsx`, the waiting-on and digest email templates, migrations `20261204120000`–`20261204120200`, and their tests | — | Islestone-owned | Written fresh. inflect has no inbox page, no member preferences in use and only compliance digests (`src/app-layer/notifications/digest-templates.ts`, not taken). 1.6's copied digest dispatcher (`digest-dispatcher.ts`, the due-digest template) had no caller and was removed. |

## The document lock (sub-phase 2.7e, a fix)

The md+ `html, body` height lock that `src/components/layout/AppShellFrame.tsx` (copied in 1.7) relies on for its `md:h-full`, and the print release, were not taken with the 1.2 and 1.7 stylesheet copies; without them the shell grew to its content and the window scrolled. Found when 2.7e's project-page link wrapped the header in CI and a board drag lost its drop.

| File | Source | Action | Changes |
|---|---|---|---|
| `src/app/globals.css` (the document lock and its print release) | inflect-compliance at `5528464fc54a8681956f3b9ce23ca9c075f0420e`: `src/app/globals.css` ("List-page-shell document lock" and the `@media print` release), BUSL-1.1 | COPY+EDIT | The two rules unchanged; the comment rewritten. Held by `tests/unit/document-lock.test.ts` (written fresh). |

## Search over descriptions and comments (sub-phase 2.7f)

Built by [`docs/porting/maps/2.7.md`](docs/porting/maps/2.7.md) ("Part 3") under owner decisions 124, 126 and 145 to 147 and [ADR 0008](docs/adr/0008-search-over-encrypted-fields.md); see [`docs/search.md`](docs/search.md). The code is written fresh; the dictionary is third-party data.

| File | Source | Commit or version | Licence | Action | Changes |
|---|---|---|---|---|---|
| `deploy/postgres/tsearch_data/bulgarian.dict`, `bulgarian.affix` | bgOffice OOo-spell-bg (<http://bgoffice.sourceforge.net/>): `OOo-full-pack-bg-4.3/bg_BG.dic` (sha256 `c1d403ecf6588c3e23f9b57db2f905fda035e17c115d05736e1ce02ea17dacee`) and `bg_BG.aff` (sha256 `8c068e82c939f1bd138195de393c9dcc5e5401f8003fc1faf80f5e82da28ef3f`) in `https://downloads.sourceforge.net/bgoffice/OOo-full-pack-bg-4.3.zip` | 4.3 (files dated 2010-06-17); archive SHA512 `1c4acf0c8377c6ec3f0dd26c84a5232be88b1fecabcb08dfae4f45bf819c770427731cbf1b01d65d3a182cccc3d0bcaabf3ab85735221e2ff09fc47bd66341d7`, equal to Gentoo's `app-dicts/myspell-bg/Manifest` at `1d677101c0776fa2bf680550e2864f4f0a2e6ccd` | `GPL-2.0-or-later OR LGPL-2.1-or-later OR MPL-1.1` (`Copyright_spell`, read in the archive), taken under MPL-1.1 and used under MPL-2.0 by MPL-1.1 §6.2 (ADR 0007 E10, owner decision 145); "Copyright (C) 2001-2010 Radostin Radnev" | Copied data, re-encoded | Windows-1251 to UTF-8, CRLF to LF, the affix's `SET` line to `UTF-8`, renamed for PostgreSQL's `ispell` template; no word or rule changed (`deploy/postgres/convert-bgoffice.sh` reproduces it and checks every hash). Results: `bulgarian.dict` sha256 `44408b1ee50301e8f9a133b0ec92565bb8be49818c444d91821876d447f58906`, `bulgarian.affix` sha256 `cb6bfc56d6b1e70c812061086d7ec5ad6aaf6d35acd927a035f1cee0188ea477`. `NOTICE` carries it; `Copyright_spell.txt`, `LICENSE-MPL-2.0.txt` and `README.md` (the statement of change) travel with it, in the repository and the image. Not taken: the archive's hyphenation patterns and thesaurus, and the LibreOffice dictionaries' copy of `bg_BG` (GPL-2.0 on its face, a word list five entries off 4.3). |
| `deploy/postgres/tsearch_data/LICENSE-MPL-2.0.txt` | The Mozilla Public License 2.0 text, as `node_modules/lightningcss/LICENSE` carries it | lightningcss as installed | MPL-2.0 (the licence's own text) | Copied verbatim | None. |
| `/usr/local/bin/gosu` in the Postgres image (built by the `gosu` stage of `deploy/postgres/Dockerfile`; Hardening H1, owner decision 248) | tianon/gosu (<https://github.com/tianon/gosu>), `main.go`, `setup-user.go`, `version.go` with `go.mod`/`go.sum`; its modules `github.com/moby/sys/user` v0.4.1 and `golang.org/x/sys` v0.1.0, checked against that `go.sum` | tag `1.20`, commit `29b939aa5bd4dc588af765b8248f6e39150d2565` (the build refuses any other); compiled with `golang:1.27.4-trixie@sha256:430985542100b871e108ccc00e8dcc5eef08ca14ee5825e98ebf563d8ffec4ee` | Apache-2.0 (its `LICENSE`, read at that commit); the modules Apache-2.0 and BSD-3-Clause, the Go standard library BSD-3-Clause | Built from source in the image build; no source enters the repository | None to the source. Upstream's build flags (its `Dockerfile` at the tag: `CGO_ENABLED=0`, `-trimpath -ldflags '-d -w' -buildvcs=true`), on a real checkout rather than upstream's fake-git, so the module version is a pseudo-version (`gosu --version` still says `1.20`). Replaces the base image's `gosu` 1.19 (Go 1.24.6). The binary's own licence and those of the Go standard library, `golang.org/x/sys` and `github.com/moby/sys/user` are installed in `/usr/share/doc/islestone-postgres/gosu/`; `NOTICE` names it. |
| `src/app-layer/usecases/search.ts`, `src/lib/search/rank.ts`, `src/lib/search/types.ts`, `src/components/command-palette/use-entity-search.ts`, `command-palette.tsx`, `tests/rendered/command-palette-entity-search.test.tsx` (2.7b's and 1.7's copies of inflect-compliance at `5528464fc54a8681956f3b9ce23ca9c075f0420e`) | the same paths | — | BUSL-1.1 (ADR 0001 D1) | COPY+EDIT, edited further | Description and comment hits (`matchedIn`, `snippet`, `computeContentScore`, the snippet read), the palette's "In the description" / "In a comment" line, and their test. inflect has none of it. |
| `deploy/postgres/Dockerfile`, `deploy/postgres/dictionary.json`, `deploy/postgres/convert-bgoffice.sh`, migrations `20261207120000_search_configuration` and `20261207120100_search_vectors`, `src/lib/search/configuration.ts`, `configuration-check.ts`, `snippet.ts`, `src/app-layer/repositories/SearchVectorRepository.ts`, `src/app-layer/usecases/search-index.ts`, `src/app-layer/jobs/search-index-rebuild.ts`, the rebuild route, the search usecase's 2.7f additions, and their tests and guards | — | — | — | Islestone-owned | Written fresh. inflect-compliance has no full-text index and no Bulgarian stemming (`grep` for `to_tsvector` at `5528464fc54a8681956f3b9ce23ca9c075f0420e` finds none). |

## Reviews: rounds, steps and responses (sub-phase 2.8a)

Built by [`docs/porting/maps/2.8.md`](docs/porting/maps/2.8.md) under owner decisions 148 to 165 and [ADR 0009](docs/adr/0009-review-steps.md), from the Procore audit's top idea #5 (ideas only; see "Product ideas adopted into the roadmap"). **Nothing was copied.** inflect-compliance has no multi-step review; four of its patterns were read and re-written, pattern only, at `5528464fc54a8681956f3b9ce23ca9c075f0420e` (BUSL-1.1):

| File | Source | Commit | Licence | Action | Changes |
|---|---|---|---|---|---|
| `src/app-layer/repositories/ReviewRepository.ts` (`recordResponse`) | inflect-compliance `PolicyApprovalRepository.decide` (the claim on a still-pending row: one conditional `updateMany` naming `status: 'PENDING'`) | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied | The claim names the reviewer's row, the caller, "not withdrawn" and the outcome read (a first response or the one being changed, decision 162); a lost claim is 409 `REVIEW_RESPONSE_TAKEN`. |
| `src/app-layer/usecases/review.ts` (`respondToReviewStep`, `stepOf`) | inflect-compliance `src/app-layer/usecases/policy.ts` `decidePolicyApproval` (lines 776–880: a decision on a request that is no longer the open question is a 409, not an overwrite; the requester may not approve their own request) | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied | A response to a step that is no longer open is 409 `REVIEW_STEP_NOT_OPEN`; separation of duties became decision 158 (the item's assignee never reviews it), held at the edit, at the response and on an assignee change. |
| Migration `20261208120600_reviews` (the triggers `work_item_review_round_frozen`, `work_item_review_step_frozen`, `work_item_review_step_list_frozen`, `work_item_reviewer_frozen`) | inflect-compliance migration `20261018130100_agent_recertification_campaigns`, lines 232–277 (`access_review_connected_decision_one_way`: a recorded verdict and the frozen subject cannot change) | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied | Frozen by the round's and the step's status rather than per stamp (decision 162: a response changes while its step is open); the key rotations' re-wrap of `responseText` admitted; cascades pass by `pg_trigger_depth()`. |
| `src/app-layer/domain/review-steps.ts` (`evaluateStep`), `src/app-layer/usecases/review-engine.ts` | inflect-compliance `CLAUDE.md`, legacy access recertification invariant 5 ("zero is never complete": `subjectCount > 0 && decided === subjectCount`) | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied | An "all" step completes only with every reviewer still asked signed off and at least one; a step with nobody still asked stays open and flagged; a send refuses a step that resolves to nobody (`NO_REVIEWERS`). |
| `prisma/schema/reviews.prisma`, `enums.prisma` (`ReviewRoundStatus`, `ReviewStepMode`, `ReviewStepStatus`, `ReviewOutcome`, four `NotificationType` and two `EmailNotificationType` values), migrations `20261208120000` to `20261208120600`; `src/app-layer/domain/working-days.ts`; `src/app-layer/policies/review.policies.ts`; `src/app-layer/notifications/review.ts`, `email/work-item-review.tsx`; `src/lib/schemas/review.ts`; the routes under `work-items/[workItemId]/review/`; the 2.8a changes to `work-item.ts`, `work-item-moves.ts`, `work-item-relations.ts`, `work-item-answer.ts`, `workflow-state.ts`, `tenant-admin.ts`, `work-item-shared.ts`, `WorkItemRepository.ts`, `work-item-due-notification.ts`, `notification-digest.ts`, `preferences.ts`, `in-app-types.ts`, `templates.ts`, `enqueue.ts`, `watcher.ts`, `encrypted-fields.ts`, `route-permissions.ts`, `activity-phrases.ts` | — | — | — | Islestone-owned | Written fresh. |
| `tests/integration/reviews.test.ts`, `tests/integration/review-api.test.ts`, `tests/unit/domain/working-days.test.ts`, `tests/unit/domain/review-steps.test.ts`, `tests/unit/notifications/review.test.ts`, `tests/unit/usecases/review-sequence-order.test.ts`, `tests/guards/review-response-seam.test.ts`, `tests/guards/review-close-paths.test.ts`, and the 2.8a cases in the guard, unit and integration suites they extend | — | — | — | Islestone-owned | Written fresh. |

## Scheduling engine and working calendars (sub-phase 3.1a)

Built by [`docs/porting/maps/3.1.md`](docs/porting/maps/3.1.md) (its 3.1a part) under owner decisions 182 to 203 and [ADR 0010](docs/adr/0010-scheduling-and-working-calendars.md). **Nothing was copied.** inflect-compliance has no scheduling, working-day or holiday code; its deterministic topological sort was read for the pattern. SVAR React Gantt was not installed in 3.1a (its row moved to "Adopted" with 3.1b), and no vector or algorithm was taken from its PRO edition.

| File | Source | Commit | Licence | Action | Changes |
|---|---|---|---|---|---|
| `src/app-layer/domain/schedule/engine.ts` (Kahn's sort with the ready set ordered by id; a remaining node named as a cycle) | inflect-compliance `src/app-layer/libraries/dependency-graph.ts` | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | PATTERN | Pattern only, no code copied: written fresh over node indices in id order with a heap; the cycle found by walking blockers back from the smallest remaining id. |
| `src/app-layer/domain/schedule/` (`calendar.ts`, `engine.ts`, `types.ts`), `src/app-layer/domain/working-days.ts` (now over the calendar module); `prisma/schema/scheduling.prisma`, migrations `20261212120000_working_calendars` and `20261212120100_project_due_date`; `WorkingCalendarRepository.ts`, `usecases/working-calendar.ts`, the working-calendar routes, `src/lib/scheduling/working-calendar.ts`, `src/lib/schemas/working-calendar.ts`; the 3.1a changes to `project.ts`, `project-template.ts`, `work-item.ts`, `review-engine.ts`, `recurrence-run.ts`, `work-item-due-notification.ts`; `src/components/settings/WorkingCalendarSettings.tsx`, `src/components/projects/ProjectDueDate.tsx` and the project forms | ADR 0010, the 3.1 map | — | — | Islestone-owned | Written fresh. |
| `tests/unit/domain/schedule-*.test.ts`, `tests/helpers/schedule-under-tz.ts`, `tests/integration/working-calendars.test.ts`, `tests/integration/project-due-date.test.ts`, `tests/rendered/working-calendars.test.tsx`, `tests/rendered/project-due-date.test.tsx`, `tests/e2e/working-calendars.spec.ts` | — | — | — | Islestone-owned | Written fresh. |

## The timeline (sub-phase 3.1b)

Built by [`docs/porting/maps/3.1.md`](docs/porting/maps/3.1.md) (its 3.1b part) under owner decisions 182 to 203 and [ADR 0010](docs/adr/0010-scheduling-and-working-calendars.md). **Nothing was copied.** SVAR React Gantt is embedded as an npm dependency (its row moved to **Adopted** below); its store and React sources at the pinned tags were read for the action names, the DOM attributes and the theme variables the adapter uses (pattern only, no code copied). inflect-compliance's `gantt-chart.tsx` and `GanttTimeline.tsx` were read for the map and not taken (they cannot hold 5,000 rows or take input); no vector or algorithm was taken from SVAR's PRO tests.

| File | Source | Commit | Licence | Action | Changes |
|---|---|---|---|---|---|
| `src/components/work-items/timeline/svar-adapter.tsx`, `timeline.css` (the action names refused in `init`, `taskTemplate`, `highlightTime`, `data-link-id=":<id>"`, the `--wx-*` variables, the tree toggle's classes) | `github.com/svar-widgets/react-gantt` (`src/components/Gantt.jsx`, `chart/Bars.jsx`, `chart/Links.jsx`, `chart/Chart.jsx`) and `github.com/svar-widgets/gantt` (`packages/store/src/DataStore.ts`, `types.ts`), read in the installed 2.8.3 `dist` and types | `24f381a37e1e7175ef690aa3f1079a4bf5ad4004` and `ba701283bc4f982f758a6b37fd2d63e6324c5424` (v2.8.3) | MIT | PATTERN | Pattern only, no code copied: the adapter calls the package's public API; the theme maps its variables to Islestone's tokens. |
| inflect-compliance `src/components/ui/charts/gantt-chart.tsx`, `src/app/t/[tenantSlug]/(app)/calendar/_components/GanttTimeline.tsx` | inflect-compliance | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | READ, NOT TAKEN | Read for the map; neither holds 5,000 rows or takes input, and the roadmap names SVAR. |
| `src/lib/work-items/timeline.ts`, `src/app-layer/usecases/work-item-timeline.ts`, the timeline route, the 3.1b changes to `work-item.ts` (`resolveListFiltersInTx`), `WorkItemRepository.ts`, `WorkItemRelationRepository.ts`, `route-permissions.ts`, `saved-view.ts`; `src/components/work-items/timeline/` (`TimelineView.tsx`, `TimelineChart.tsx`, `TimelineScheduleTable.tsx`, `timeline-model.ts`), `data/use-work-item-timeline.ts`, the 3.1b changes to `work-item-cache.ts`, `WorkItemsView.tsx`, `LayoutToggle.tsx` | ADR 0010, the 3.1 map | — | — | Islestone-owned | Written fresh. |
| `tests/guards/svar-core-only.test.ts`, `tests/unit/work-items/timeline-model.test.ts`, `tests/integration/work-item-timeline.test.ts`, `tests/rendered/timeline.test.tsx`, `tests/e2e/timeline.spec.ts` | — | — | — | Islestone-owned | Written fresh. |

## Changing dates from the timeline (sub-phase 3.1c)

Built by [`docs/porting/maps/3.1.md`](docs/porting/maps/3.1.md) (its 3.1c part) under owner decisions 182 to 203 (194 and 195 above all) and [ADR 0010](docs/adr/0010-scheduling-and-working-calendars.md). **Nothing was copied.** SVAR's 2.8.3 `dist` was read again for the shape of the actions the adapter now reads before refusing them (pattern only, no code copied).

| File | Source | Commit | Licence | Action | Changes |
|---|---|---|---|---|---|
| `src/components/work-items/timeline/svar-adapter.tsx` (the `update-task` drop's `diff` in day cells and the dates it names, `drag-task`, `add-link`'s `type` from the handles drawn, `delete-link`; re-initialisation on a new tasks array), `timeline-model.ts` (`dropFromWidget`) | `github.com/svar-widgets/react-gantt` (`chart/Bars.jsx`, `Gantt.jsx`) and `github.com/svar-widgets/gantt` (`packages/store/src/DataStore.ts`), read in the installed 2.8.3 `dist` | `24f381a37e1e7175ef690aa3f1079a4bf5ad4004` and `ba701283bc4f982f758a6b37fd2d63e6324c5424` (v2.8.3) | MIT | PATTERN | Pattern only, no code copied. |
| `src/lib/work-items/reschedule.ts`, the 3.1c changes to `src/lib/work-items/timeline.ts`, `work-item.ts` (`rescheduleWorkItems`), `WorkItemRepository.ts` (`setDatesOfLocked`), `WorkItemRelationRepository.ts` (`liveBlocksReach`), `src/lib/schemas/work-item.ts`, `route-permissions.ts`, the `work-items/bulk/dates` route; `src/components/work-items/timeline/` (`ChangeDatesDialog.tsx`, `TimelineDependencies.tsx`, and the 3.1c changes to `TimelineView.tsx`, `TimelineScheduleTable.tsx`, `timeline-model.ts`, `timeline.css`), `data/use-timeline-writes.ts`, the 3.1c changes to `work-item-cache.ts` and `WorkItemsView.tsx` | ADR 0010, the 3.1 map | — | — | Islestone-owned | Written fresh. |
| `tests/unit/work-items/reschedule.test.ts`, `tests/rendered/timeline-changes.test.tsx`, `tests/rendered/timeline-chart-changes.test.tsx`, `tests/integration/work-item-reschedule.test.ts`, `tests/e2e/timeline-changes.spec.ts` | — | — | — | Islestone-owned | Written fresh. |

## Hardening H2a: the scale seed and the plan checks

Built by [`docs/porting/maps/H2.md`](docs/porting/maps/H2.md) (parts 1.1 to 1.3 and 1.7) under owner decisions 166, 168 and 170 to 172; see [`docs/performance.md`](docs/performance.md). **Nothing was copied.** inflect-compliance's plan test was read for its method, and its staging seed for what a seeder that nobody runs becomes.

| File | Source | Commit | Licence | Action | Changes |
|---|---|---|---|---|---|
| `tests/perf/plans.test.ts`, `tests/perf/plan-capture.ts` (seed a realistic skew, `ANALYZE`, ask the planner, assert the plan) | inflect-compliance `tests/integration/task-tenant-index-plan.test.ts` | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | PATTERN | Pattern only, no code copied: written fresh over a seeded database with `auto_explain` capturing the real repository calls under row-level security, a registry of named queries and a forcing guard. |
| `scripts/seed-scale/` (a seeder run on every pull request so it cannot rot) | inflect-compliance `scripts/seed-staging.ts` (its header) | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | PATTERN | Pattern only, no code copied: the lesson only. |
| `scripts/seed-scale/random.ts` (cyrb128 to seed sfc32) | the public-domain cyrb128 hash and sfc32 generator (PractRand's Chris Doty-Humphrey for sfc32) | — | public domain | PATTERN | Written fresh from the algorithms. |
| `scripts/seed-scale/` (the rest), `scripts/ci-postgres.sh` (`--pg-stat-statements`, `CI_PG_PREFIX`), `SearchVectorRepository.insertBulkForSeed`, `WorkItemRepository.lockItemsOfPerson` (the `UNION`), migration `20261213120000_list_scale_indexes`, the `perf` Jest project and its setup files, the `Performance (10k)` job in `.github/workflows/ci.yml` | — | — | — | Islestone-owned | Written fresh. |
| `tests/perf/` (the rest), `tests/guards/plan-checked-queries-coverage.test.ts`, the H2a additions to `tests/guards/search-vector-write-seam.test.ts` and `schema-index-coverage.test.ts`, `tests/unit/perf/plan-capture.test.ts`, `tests/unit/seed-scale/seed-scale.test.ts`, `tests/integration/seed-scale.test.ts` | — | — | — | Islestone-owned | Written fresh. |

## Findings F1 and F2: the search functions and the rebuild's pages (owner decision 245)

Built under owner decision 245 (`docs/porting/maps/H2.md`, "Finding F1, decided"; issues #78 and #79); see [`docs/search.md`](docs/search.md), "The search functions", and [`docs/performance.md`](docs/performance.md), "Findings". **Nothing was copied.**

| File | Source | Commit | Licence | Action | Changes |
|---|---|---|---|---|---|
| Migration `20261214120000_search_definer_functions` (the `app_search_definer` role, the five search functions, the two live-id indexes), `projectVisibilityArgs` in `project-visibility.ts`, the search methods of `WorkItemRepository`, `ProjectRepository` and `SearchVectorRepository` (`searchTitleIds`, `titleFullTextIds`, `titleSubstringIds`, `searchNameIds`, `findSearchRows`, `matchItems`, `staleDescriptionPage`, `staleCommentPage`), the changes to `search.ts`, `search-index.ts` and `work-item.ts`, `scripts/seed-scale/cache.sh` (the role before a restore) | — | — | — | Islestone-owned | Written fresh. |
| `tests/helpers/search-definer.ts`, `tests/helpers/search-plans.ts`, `tests/guards/search-definer-functions.test.ts`, `tests/integration/search-definer.test.ts`, `tests/unit/usecases/search-index-rebuild-walk.test.ts`, and the changes to `tests/perf/`, `tests/unit/perf/plan-capture.test.ts`, `tests/unit/repositories/search-repository-predicates.test.ts`, `tests/guards/search-vector-write-seam.test.ts`, `tests/guards/plan-checked-queries-coverage.test.ts`, `tests/integration/search.test.ts` and `tests/integration/search-vectors.test.ts` | — | — | — | Islestone-owned | Written fresh. |

## Adopted

| Component | Source (repository and path) | Commit | Licence | What was taken | Changes |
|---|---|---|---|---|---|
| `src/env.ts`, `src/env-client.ts`, `src/env-skip.ts` (sub-phase 1.1) | inflect-compliance: `src/env.ts`, `src/env-client.ts` | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. The two-module split: the server module has no client block, and the client module declares only `NEXT_PUBLIC_` keys. Both use `createEnv` with `skipValidation` and `emptyStringAsUndefined`. | Written fresh. `skipValidation` is true only for `1` or `true` (`src/env-skip.ts`). The parent reads it as `!!value`, so `"0"` also skips validation there. |
| `tests/guards/client-env-boundary.test.ts`, `tests/helpers/import-graph.ts` (1.1) | inflect-compliance: `tests/guards/client-reachable-modules-import-no-server-env.test.ts`, `tests/helpers/client-import-graph.ts` | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. A breadth-first walk from every `'use client'` root with the TypeScript compiler API, skipping type-only edges and reporting the chain through a parent map. The guard must not pass vacuously. A check of the client env module's keys. | Written fresh. Reports per entry. Parses the directive prologue from the AST. Reports unresolved and computed imports. Proves itself on a throwaway git repository. Asserts that the tsconfig alias matches the guard. |
| `tests/helpers/git-files.ts` (1.1) | inflect-compliance: `tests/helpers/repo-files.ts` | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. A source scan takes its file population from `git ls-files --cached --others --exclude-standard` and throws rather than falling back to a directory walk. | Written fresh. Clears inherited `GIT_*` variables and sets `GIT_CEILING_DIRECTORIES`, so it cannot list a parent repository. The licence gate's source scan uses the same approach. |
| `tests/mocks/env.ts` and the env mapping in `jest.config.mjs` (1.1) | inflect-compliance: `tests/mocks/env.ts`; `jest.config.js` (grep only) | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. One Proxy mock that reads `process.env` live, mapped for both env specifiers in every Jest project. | Written fresh. |
| `.github/workflows/ci.yml` (1.1) | inflect-compliance: `.github/workflows/ci.yml` (grep only) | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. Only the fact that it uses `actions/checkout@v7` and `actions/setup-node@v7`. | The workflow was written fresh. |
| `CLAUDE.md` (1.1) | inflect-compliance: `CLAUDE.md` | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. The general shape of an assistant guide: commands, layer rules, test conventions. | Written fresh. The layer rules come from the roadmap's global preamble (section 4). |
| Teable `packages/`, for sub-phase 2.4 (`src/lib/work-items/custom-fields.ts`, `src/app-layer/domain/custom-field.ts`, the custom-field conditions and sorts in `src/app-layer/repositories/WorkItemRepository.ts`, `src/lib/schemas/saved-view.ts`). Study: [`teable.md`](docs/porting/oss/teable.md), sections 5.1–5.8 | `github.com/teableio/teable`: `packages/core/src/models/field/**`, `packages/core/src/models/view/filter/operator.ts`, `filter.ts`, `packages/core/src/models/view/group/group.ts`, `packages/v2/core/src/domain/table/fields/filter-sync.ts`, `packages/v2/core/src/domain/shared/TableDataSafetyLimits.ts`; `packages/v2/adapter-table-repository-postgres/src/record/visitors/TableRecordConditionWhereVisitor.ts` (semantics only) | `bd8cfc054f521f6f9019f62dec2f9fcb1273ecec` (pinned for use; the licence was re-read at it on 2026-11-20: `packages/core/LICENSE` MIT, root `LICENSE` item 2, `packages/core` and `packages/v2/core` `package.json` `"license": "MIT"`, and the relicence commit `9c77957af` an ancestor) | MIT, "Copyright (c) 2023-2025 Teable, Inc." (`packages/core/LICENSE`; root `LICENSE` item 2 for `packages/v2`, which has no LICENSE file) | Pattern only, no code copied. The type registry; strict versus lenient parsing; text, select, number, date, checkbox, person and URL value rules; the operator matrix by type; negative operators including empty values; empty values sorting last; the safety caps; `Me` in a person filter. Only `packages/` was read, only at the pin; `apps/` and `plugins/` were not opened. | Typed value table with FKs instead of a physical column per field; option ids instead of names; option archiving instead of filter rewriting; Teable's number stripping and first-match person resolution refused; date-only arithmetic; Islestone's caps. Relative date modes not taken (open question). No Teable name or mark used. |
| Kaneo, for sub-phase 2.5d (`src/app-layer/domain/recurrence.ts`). Study: [`kaneo.md`](docs/porting/oss/kaneo.md) | `github.com/usekaneo/kaneo`: `apps/api/src/task/recurrence/schema.ts`, `next-occurrence-date.ts`, `create-next-occurrence.ts` | `fb890b4974e6dd6c232f1de6a6b70a591dfca0a3` | MIT (LICENSE read at the pin, "Copyright (c) 2024 Andrej Acevski") | Pattern only, no code copied: the rule's shape (frequency, interval 1 to 99, unique weekdays for a weekly rule) and stepping the next date from the rule. | Written fresh: typed columns, no time zone (due dates are date-only), occurrences numbered from the item's own due date, an end date or number of times, made on a schedule by a nightly job rather than on completion (decision 68). |
| Kaneo, for sub-phase 2.4 (`src/app-layer/usecases/custom-field.ts`). Study: [`kaneo.md`](docs/porting/oss/kaneo.md), section 4.7 | `github.com/usekaneo/kaneo`: `apps/api/src/custom-field/assert-valid-definition.ts`, `choice-options.ts`, `plan-choice-value-changes.ts` | `fb890b4974e6dd6c232f1de6a6b70a591dfca0a3` (the pin adopted for 2.1–2.2) | MIT, "Copyright (c) 2024 Andrej Acevski" | Pattern only, no code copied. A select needs an option; option names trimmed, blank refused, de-duplicated; a hidden (archived) option stays valid where held and is not newly picked; removing an option in use is refused. | Typed values instead of one `value text`; no type change, no required fields or defaults. |
| Kaneo, for sub-phases 2.1–2.2 (`src/app-layer/domain/work-item-key.ts`, `src/app-layer/repositories/ProjectRepository.ts`, `WorkItemRepository.ts`, `LabelRepository.ts`, `src/app-layer/usecases/work-item-relations.ts`, `work-item-moves.ts`, `workflow-state.ts`, `label.ts`, `src/app-layer/domain/workflow-state.ts`, `src/app-layer/policies/project-visibility.ts`). Study: [`kaneo.md`](docs/porting/oss/kaneo.md), sections 2, 4.1, 4.4–4.6 and 6 | `github.com/usekaneo/kaneo`: `apps/api/src/task/controllers/get-task-by-ticket-id.ts`, `claim-task-numbers.ts`, `move-task.ts`, `apps/api/src/task-relation/controllers/create-task-relation.ts`, `apps/api/src/task/get-subtask-counts.ts`, `apps/api/src/column/`, `apps/api/src/project/controllers/insert-project.ts`, `apps/api/src/label/deletion-lock.ts`, `apps/api/src/database/schema.ts` (lines 540–599, 1275–1319) | `fb890b4974e6dd6c232f1de6a6b70a591dfca0a3` (pinned for use; the licence was read at it) | MIT, "Copyright (c) 2024 Andrej Acevski" | Pattern only, no code copied. Key lookup (NFKC, case-insensitive prefix, int32 bound); the batch number claim; relation create (self 400, repeat 409 in either direction for BLOCKS, both ends in the workspace); grouped sub-item progress; the cross-project move (sorted lock order, conditional update on the source project); "lock the state row, then count"; default board state names; the label "being deleted" mark; link kinds; restricted project access as the 8.4 shape. | Written fresh in TypeScript over Prisma with `tenantId` and RLS on every table. Not taken: sub-items as relation rows (Islestone uses `parentId`), labels copied per item, integer positions, renumbering without an alias, and the missing cycle check. No use of the Kaneo name or marks. |
| SVAR React Gantt 2.8.3, embedded as an npm dependency for sub-phase 3.1b (`@svar-ui/react-gantt` and the 26 `@svar-ui` packages it depends on, every one MIT in the lockfile; imported only by `src/components/work-items/timeline/svar-adapter.tsx`). Study: [`svar-gantt.md`](docs/porting/oss/svar-gantt.md) | `github.com/svar-widgets/react-gantt` and `github.com/svar-widgets/gantt` | `24f381a37e1e7175ef690aa3f1079a4bf5ad4004` and `ba701283bc4f982f758a6b37fd2d63e6324c5424` (both tag v2.8.3; pinned for use: `package.json` names 2.8.3 exactly, and `tests/guards/svar-core-only.test.ts` pins every `@svar-ui` package version and its MIT declaration; the installed `license.txt` of `@svar-ui/react-gantt` 2.8.3 re-read on 2026-11-21, MIT) | MIT, "Copyright (c) 2025 XB Software Sp. z o.o" (the file is `license.txt`, not `LICENSE`) | The package, used through its public API; no source copied into the repository. Licence-boundary rule carried over: MIT core only, never a version or commit before 2.4.3 (both repositories were GPL-3.0 earlier), never the PRO edition or a PRO option, never `wx-react-gantt` (GPL-3.0), never the vendor's Next.js demo (no licence), never the `cdn.svar.dev` icon font or fonts (licence unknown; `fonts={false}`, and neither `all.css` nor `@svar-ui/react-core`'s stylesheet is loaded). | The notice travels only in the installed licence files (decision 199): the worker image's pruned production tree holds every `@svar-ui` package with its `license.txt`; the app image's standalone trace holds none (a client package the server never reads), and the browser bundle carries no notice. Recorded as decision 199's known risk, not changed. |

### Patterns adopted in ADR designs (no code written yet)

These ADRs adopt designs read in inflect-compliance at `5528464fc54a8681956f3b9ce23ca9c075f0420e` (BUSL-1.1), or in an npm package. Nothing was copied, and no Islestone code implements them yet. The roadmap step that builds each one adds its own row, saying whether it was written fresh or copied.

| Component (ADR) | Source (repository and path) | Commit or version | Licence | What was taken | Changes |
|---|---|---|---|---|---|
| Work item model ([ADR 0002](docs/adr/0002-work-item-model.md)) | inflect-compliance: `prisma/schema/tasks.prisma`, `prisma/schema/enums.prisma`, `prisma/schema/processes.prisma`, `prisma/schema/agentic.prisma`, `src/app-layer/domain/task-status.ts`, `src/app-layer/repositories/TaskRepository.ts`, `src/app-layer/usecases/tenant-owner-lock.ts`, `src/lib/soft-delete.ts`, `src/lib/security/encrypted-fields.ts` (line ranges in the ADR's References) | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. The atomic per-scope key counter; the pure transition check with discriminated errors; composite parent keys with `tenantId`; the namespaced advisory transaction lock; the field-encryption manifest; `deletedAt`/`deletedByUserId` soft delete; the non-tenant-leading index for a cross-tenant sweep. | The counter is per project (`ProjectKeySequence`), not per workspace. Transition rules differ (ADR 0002 section 4). Names follow ADR 0006. |
| Assignee and delegate ([ADR 0003](docs/adr/0003-assignee-and-delegate.md)) | inflect-compliance: `prisma/schema/agentic.prisma`, `prisma/schema/enums.prisma`, `src/app-layer/usecases/agent-proposals.ts`, `src/lib/agentic/kill-switch.ts`, `src/lib/agentic/run-caps.ts`, `src/lib/agentic/monthly-budget.ts`, `src/app-layer/jobs/agent-run-reaper.ts`, `src/app-layer/context-system.ts`, `docs/implementation-notes/2026-08-12-automation-actor-authority.md`, `CLAUDE.md` (line ranges in the ADR's References) | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. An agent separate from a user, with a required owner; the two-step ownership transfer; the proposal queue's controls; the three-scope kill switch checked before every model and tool call; versioned policy cards; all-or-nothing run caps; the pre-run budget check and reserve-before-use; the reaper that leaves human waits alone; re-reading a named person's authority when work runs; write-once triggers that admit the encryption re-wrap; the conditional claim used for checkout. | Islestone adds the agent session, append-only activity and checkout (ADR 0003 sections 5 to 7), requires a finite budget for every agent, and ends live sessions when a kill is engaged. No rung cap (owner decision, 2026-11-18). |
| Agent session states, activity types and signals ([ADR 0003](docs/adr/0003-assignee-and-delegate.md)) | `@linear/sdk`: `dist/index-BNMxzn7u.d.mts` (lines 320–325, 335–342, 570–578, 6971, 7018–7019) | npm `@linear/sdk` 103.0.0 | MIT, "Copyright (c) 2019 Linear" (the package's `LICENSE`) | Read for design facts only, no code copied: the session statuses, the six activity types and the activity signals, and that Linear types the delegate as a `User`. | Islestone keeps six states (no `stopping`) and the six activity types, and makes the agent its own model rather than a user. |
| Data sync strategy ([ADR 0005](docs/adr/0005-data-sync-strategy.md)) | inflect-compliance: `docs/processes-realtime-collab.md`, `src/app-layer/repositories/ProcessMapRepository.ts`, `src/components/processes/TldrawProcessMap.tsx`, `src/app/api/notifications/stream/route.ts`, `src/lib/notifications/notification-sse.ts`, `src/lib/notifications/notification-bus.ts`, `src/components/layout/notifications-bell.tsx` (line ranges in the ADR's References) | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. An optional-to-required `expectedVersion` with a conditional update; updating the held version from each save's response; SSE for one-way updates with a heartbeat, the Node runtime and buffering off; an in-process fan-out bus; polling as the fallback for missed pushes. | The fan-out bus gets the Redis channel per workspace that the parent's comment proposes but never built. Notices carry ids and versions only. |
| Vocabulary ([ADR 0006](docs/adr/0006-vocabulary.md)) | inflect-compliance: `docs/implementation-notes/2026-08-12-task-vocabulary-and-executing-tests.md`, `prisma/schema/enums.prisma`, `tests/integration/task-enum-db-mapping.test.ts` | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. The lesson of the `@@map` pin and its rename note. | Islestone fixes names before the first migration and allows a pin only with a recorded end date. |

### Product ideas adopted into the roadmap

Ideas read in a proprietary product and adopted by the owner into `docs/ROADMAP.md`. Nothing was copied. The sub-phase that builds each one adds its own row, saying it was written fresh: waiting on, field sets and the marked answer are built ("Waiting on (sub-phase 2.4b-a)", "Field sets (sub-phase 2.4b-b)" and "Questions (sub-phase 2.4b-c)" above); the others are not yet.

| Component | Source | Commit or version | Licence | What was taken | Changes |
|---|---|---|---|---|---|
| Roadmap additions of 2026-11-20, owner decisions 76 to 84 (`docs/ROADMAP.md` section 2.6: 2.4b, 2.7, 2.8, 3.6, 4.5, 5.1, 6.2, 7.4, 7.6, 7.8, 8.4); the audit, [`docs/research/procore-audit.md`](docs/research/procore-audit.md) | Procore, construction management: procore.com, support.procore.com, v2.support.procore.com, developers.procore.com. Not reached directly: those hosts did not resolve from the session, so they were read through public web-search summaries, Procore press releases and the third-party pages listed in the audit's "Sources" | Not a repository; read 2026-11-20 | Proprietary; no licence was needed, because nothing was copied | Ideas only, no code copied: whose move it is, apart from who is accountable; required, optional and hidden fields per record type; a question with one marked answer, and an agent that drafts cited answers; named sets of people to notify; sequential or parallel reviewers, with rounds instead of rewinds; pass/fail checks whose failures open follow-up work; periodic reports drafted from computed facts and filed by a person; meeting series that carry open points forward; project-level roles for outside people, and the firm they belong to. No names, text, screenshots, assets, API shapes or code were taken. | Each idea is recast on Islestone's own model: one work-item table (principle 3), the assignee as the one accountable person and agents that only propose (ADR 0003), and Islestone's own words under ADR 0006, chosen when each sub-phase starts. Procore's product names and branding are not used. The audit notes two US patents on coordinating punch-list items (11,188,858 and 12,443,904); nothing adopted follows that flow, and counsel looks before anything close to it is built. |

### Other sources used by sub-phase 1.1

| Component | Source | Commit or version | Licence | What was taken | Changes |
|---|---|---|---|---|---|
| Next.js 16 project conventions: `next-env.d.ts` gitignored, the `tsconfig.json` `include` entries, the flat ESLint config shape, the three-line `postcss.config.mjs` | `create-next-app` template, Vercel | npm `create-next-app@16.4.6` (no git commit read) | MIT | The conventions above. `postcss.config.mjs` is the template's three-line config, short enough that any correct version matches it. | Everything else was written fresh. |
| PgBouncer configuration in `docker-compose.yml` (local development only) | `edoburu/docker-pgbouncer`: its entrypoint script and LICENSE | Image `edoburu/pgbouncer:v1.26.1-p0`; the commit read was not recorded by 1.1 | MIT | Read to learn which environment variables the image accepts. Nothing copied. | Not applicable. The image runs only in the local development stack, and no code from it is in this repository. |

### Read and not used

- **inflect-compliance `license:check`** (`package.json` line 18) and **`LICENSING.md`** lines 42–46, at `5528464fc54a8681956f3b9ce23ca9c075f0420e`, BUSL-1.1. Read while writing Islestone's licence gate (sub-phase 0.3). Nothing was taken. The parent runs `license-checker` through `npx` against a deny-list. Islestone's `scripts/licence-gate.mjs` is an allowlist written from scratch with no dependencies. Its git-based file population is the pattern already recorded for `tests/helpers/git-files.ts`.

## Port candidates (licence read, not yet used)

These are the projects the roadmap names as sources to translate from or embed: the port candidates of section 2.2 and jira-auto-scheduler (3.6). **Nothing has been taken from those listed here yet.** SVAR React Gantt moved to **Adopted** with 3.1b (embedded at 2.8.3). Kaneo moved to **Adopted** with sub-phases 2.1–2.2 (pattern only) and added its 2.4 row; Teable `packages/` moved to **Adopted** with 2.4 (pattern only, pinned at `bd8cfc0`). Later uses (5.3 the GitHub integration; a Teable formula engine, if ever) add their own rows. Each was studied on 2026-11-18, and its licence was re-read from its LICENSE file at the commit below and checked a second time, independently. The evidence is in `docs/porting/oss/<project>.md`, section "Licence check".

The commit below is the one the licence was read at. A candidate stays **UNPINNED** for use until its first port. Before that port starts, H0 requires the porter to:

- use the commit below, or re-read the LICENSE file at a later commit and record that one;
- replace UNPINNED with the commit used;
- move the row to **Adopted** with what was taken and what changed;
- follow the candidate's licence-boundary rule.

| Component (planned use) | Source repository | Licence read at | Pinned for use | Licence (from its LICENSE file) | Licence-boundary rule |
|---|---|---|---|---|---|
| Paperclip: agent, goal, budget, heartbeat and run schema with atomic checkout locks (3.2, 6.3). Study: [`paperclip.md`](docs/porting/oss/paperclip.md) | `github.com/paperclipai/paperclip` | `8285a81280db17898f38827a9f3c90221a82f23c` | UNPINNED | MIT, "Copyright (c) 2025 Paperclip AI" (the README names Paperclip Labs, Inc.) | Take nothing from a revision that does not have `63afce369` (the merge that added `LICENSE`) as an ancestor. Third-party subtrees (for example `docker/`, `ui/public/fonts/`, `ui/public/brands/`, `packages/adapters/hermes/`, `packages/shared/src/cliplab/`) keep their own notices. |
| Cal.diy: availability and booking (3.3, also 3.1 and 3.5). Study: [`cal-diy.md`](docs/porting/oss/cal-diy.md) | `github.com/calcom/cal.diy` | `ae027bb70e694e2d2c44569f398d6cbcee0389b1` | UNPINNED | MIT, "Copyright (c) 2020-present Cal.com, Inc.", since `ab21c7f805a089fa3a11ffd61c4a9aecc349c16c` (2026-04-15); AGPLv3 with Commercial-licensed `ee` folders before | Only the 63 paths the study recommends (section 2), none of them formerly under `ee/`. Nothing from before `ab21c7f805`. Not `apps/api/v2`, not `packages/types/ical.d.ts` (GPL-3.0-only), not the Stack Overflow helper in `packages/types/Calendar.d.ts`. |
| Paca web: automation graph builder (5.1). Study: [`paca.md`](docs/porting/oss/paca.md) | `github.com/Paca-AI/paca` | `5913718b6aaa81815085f1805dd764dbc5f55cce` | UNPINNED | Apache-2.0 (root `LICENSE`, unchanged since it was added; its appendix names no copyright holder). No `NOTICE` file at this commit | Not `apps/web/public/provider-logos/` or `services/api/internal/platform/bundledskills/content/` (third-party, licence unverified), nor `apps/web/src/components/ui/` (generated shadcn components). Code derived from Paca ships the Apache-2.0 text and marks modified files. Re-check for a `NOTICE` file at every re-pin: Apache-2.0 requires carrying it into [`NOTICE`](NOTICE). |
| ln-dev7/circle: Linear-style UI shell (2.3, 1.7). Study: [`circle.md`](docs/porting/oss/circle.md) | `github.com/ln-dev7/circle` | `b0ba7ddcc3d0f4c16092236ca6a01b56c0614810` | UNPINNED | MIT, "Copyright (c) 2025 lndev-ui \| Circle Template" (`LICENSE.md`) | None on licence grounds. Vendored code under other holders (bazza/ui in `components/data-table-filter/`, shadcn in `components/ui/`, usehooks-ts hooks) needs its own notice if taken. Not `components/common/settings/integration-logos.tsx` (third-party brand marks), nor the paid BaseUI variant. |
| jira-auto-scheduler: Monte Carlo forecasting (3.6). Study: [`jira-auto-scheduler.md`](docs/porting/oss/jira-auto-scheduler.md) | `github.com/bitovi/jira-auto-scheduler` | `39323ed28d7d7e2223853f67a098dd9a23f2773f` | UNPINNED | MIT, "Copyright (c) 2021 Bitovi" (`package.json` says ISC; the LICENSE file governs) | None on licence grounds. Not the vendored `public/can.js`, `public/json-logic/` or `public/dist/` files, nor Bitovi's name and images. The study recommends pattern only. |

The projects that roadmap 2.2 marks **inspiration only** (Plane, OpenProject, Twenty and the rest of that list, plus the source-available ones) never get a row here. Islestone copies no code from them, whatever their licence allows.
