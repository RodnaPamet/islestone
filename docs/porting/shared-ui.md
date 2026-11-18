# Shared UI: the `@inflect/ui` copy

Roadmap sub-phase 1.2, part A. `packages/ui` holds `@inflect/ui` from
inflect-compliance, copied byte for byte and pinned to one upstream commit. Islestone
consumes it the way playerz.bg consumes inflect's UI (inflect's
`docs/shared-ui-policy.md`): a hash manifest, a check that refuses local edits, and a
sync that is planned, taken and reviewed as one change.

## The rule

**Islestone never edits a file inside `packages/ui`.** Every file there is an upstream
copy. Two checks hold the rule, and neither is enough alone:

- `node scripts/ui-drift.mjs verify` fails on any file that is edited, missing, extra,
  or whose executable bit changed, **measured against `UPSTREAM.json`**. It proves only
  that the files match the manifest. If somebody edits a file and its manifest entry
  together, adds or deletes a file together with its key, or writes in a commit that
  does not exist, `verify` still passes.
- `node scripts/ui-drift.mjs audit <inflect-compliance checkout>` fails unless
  `UPSTREAM.json` is exactly the upstream package at the commit it names: the commit
  must exist in the checkout, and the file set, every hash and every mode must be
  equal. Binding the manifest to upstream is `audit`'s job.

Together they prove that `packages/ui` is the upstream package at that commit.

- Islestone-specific UI goes **outside** `packages/ui`.
- To fix a shared file, change it in inflect-compliance first, then sync it here.
- To couple a shared file to Islestone, do not edit it in place. Use a slot the host
  fills (inflect's `docs/shared-ui-policy.md`, "If you need to couple a shared file"),
  or write an Islestone component that wraps it.

The rule applies to every file in `packages/ui`, including its `README.md`,
`package.json` and `tsconfig.json`. The one exception is `UPSTREAM.json`, which only
`pin` writes. `verify` refuses a manifest whose bytes differ from the canonical form
`pin` writes, so a duplicate key (JSON keeps the last one, which a reader of the file
may not notice), a reordered key or CRLF line endings are refused rather than read.
`audit` refuses one that does not match upstream.

## What was copied

| | |
|---|---|
| Source | inflect-compliance, `packages/ui` |
| Commit | `5528464fc54a8681956f3b9ce23ca9c075f0420e` |
| Package | `@inflect/ui` `0.0.0`, `private: true`, `license: BUSL-1.1` (unchanged) |
| Files | 397: every file `git ls-files packages/ui` lists at that commit, and nothing untracked |
| Manifest | `packages/ui/UPSTREAM.json`, holding the sha256 of each of the 397 files and the list of files at git mode `100755` (empty) |

| Group | Files |
|---|---|
| Package root: `README.md`, `package.json`, `tsconfig.json`, `tokens.contract.css`, `src/index.ts` | 5 |
| Flat primitives: button, card, empty-state, error-state, skeleton, tooltip, typography, hit-area, the two variant recipes | 10 |
| Charts (`src/components/ui/charts/`) | 22 |
| Hooks (`src/components/ui/hooks/`, including one co-located test and a README) | 23 |
| Icons, Nucleo (`src/components/ui/icons/nucleo/`, including its README) | 271 |
| Icons, other | 63 |
| `src/lib/`: `cn.ts`, `format-date.ts`, `number-format.ts` | 3 |

The copy was made by `node scripts/ui-drift.mjs pin /path/to/inflect-compliance --ref
5528464fc54a8681956f3b9ce23ca9c075f0420e`. That command reads the blobs of the commit
itself, not a working tree. Three independent checks confirmed it:

- The file list equals `git ls-files packages/ui`.
- `diff -r` against the source working tree, which was clean at that commit, found no
  difference.
- `sha256sum -c` over the manifest passed for all 397 files.

On 2026-11-18, `audit` also passed against a fresh `git fetch --depth 1` of the public
repository at that commit (the CI recipe below).

All 397 files are git mode `100644`, and the package has no symlinks. The manifest
records this as `"executable": []`, `verify` checks each file's executable bit against
it, and `audit` checks it against the commit.

## Verify and audit

```bash
node scripts/ui-drift.mjs verify                       # exit 0 clean, 1 drift, 2 could not run
node scripts/ui-drift.mjs verify --json                # the same, machine-readable
node scripts/ui-drift.mjs audit /path/to/inflect-compliance   # exit 0 bound, 1 not bound, 2 could not run
node --test tests/unit/ui-drift.test.mjs               # the script's own tests
```

`verify` recomputes the sha256 and the executable bit of every file in `UPSTREAM.json`.
It reports each file that is **modified**, **missing**, **not a regular file** (a listed
path replaced by a symlink fails even when the target's bytes match), or whose **mode**
changed. In git population it also checks the mode git would commit, from the index,
so `git update-index --chmod=+x` is caught without any change on disk. It also reports
each **unlisted** file, a file inside `packages/ui` that the manifest does not name;
each **bad name**, a name that is not valid UTF-8 (a manifest cannot hold one, so it is
reported with `\xHH` escapes rather than dropped); and each entry git lists that could
not be inspected.

How it finds unlisted files depends on `--population`:

| Mode | Files it sees |
|---|---|
| `git` | What git would commit: tracked files, plus untracked files that are not ignored |
| `fs` | Every file on disk, with no skip list |
| `auto` (default) | `git` inside a work tree, `fs` otherwise |

The strict `fs` mode is the fallback, so a check that cannot ask git reports more
files, not fewer. A manifest that lists no files is refused (exit 2) rather than
reported clean, as is a manifest whose keys escape the package, and one that is not in
canonical form.

Git population trusts `.gitignore`, and that is deliberate for local runs: build
output such as `tsconfig.tsbuildinfo` must not fail `verify`. The price is that a file
generated into `packages/ui` that matches an ignore rule anywhere in the repository
(`*.generated.ts`, say) is invisible to it. That is why CI uses `fs` population before
anything is built (below).

`audit` reads only `UPSTREAM.json` and the upstream checkout, never the files in
`packages/ui`. It takes no `--ref`: it always reads the commit the manifest names, and
reports `COMMIT_NOT_FOUND` when the checkout does not have it, which is what an
invented commit looks like (and also a shallow clone that lacks it; fetch it).

The last test in `tests/unit/ui-drift.test.mjs` runs `verify` against this
repository's real `packages/ui`, read-only. It is the test that fails when somebody
edits a shared file.

### CI (sub-phase 1.1)

Three steps, in this order:

1. **Straight after checkout, before `npm ci` or any build:**
   `node scripts/ui-drift.mjs verify --population fs`. A fresh checkout's filesystem is
   exactly the committed tree, so `fs` population needs no ignore rules, sees a file
   that an ignore rule would hide from git, and has nothing generated to trip over.
2. **Audit against upstream.** inflect-compliance is public, so CI needs no secret:

   ```bash
   commit="$(node -p "require('./packages/ui/UPSTREAM.json').commit")"
   git init -q "$RUNNER_TEMP/upstream"
   git -C "$RUNNER_TEMP/upstream" fetch -q --depth 1 --no-tags \
     https://github.com/RodnaPamet/inflect-compliance "$commit"
   node scripts/ui-drift.mjs audit "$RUNNER_TEMP/upstream"
   ```

   This was run as written (with a scratch directory for `$RUNNER_TEMP`) on 2026-11-18:
   the fetch and the audit took about five seconds together, and `audit` passed.
3. **The script's tests:** `node --test tests/unit/ui-drift.test.mjs`.

Locally, plain `verify` (git population) is the right check.

## Sync from upstream

One sync is one reviewed change that contains the new files and the new
`UPSTREAM.json`, and nothing else.

1. **Check that the copy is clean.** Run `node scripts/ui-drift.mjs verify`. If it
   fails, the local edit is the problem: move it out of `packages/ui`, or upstream it
   first.
2. **Plan.** In an up-to-date inflect-compliance checkout, run
   `node scripts/ui-drift.mjs compare /path/to/inflect-compliance [--ref <rev>]`. It
   compares a **commit** (`--ref`, default `HEAD`), never the working tree, and says
   so when the tree has uncommitted changes. It lists the files changed, added and
   removed under `packages/ui` since the pinned commit. It also lists the upstream
   commits that touched the package, so the reviewer can read them. A checkout whose
   root `package.json` is not `inflect-compliance` is refused. Exit 0 means up to date
   and 1 means there is something to sync, or that `compare` cannot vouch for the
   manifest: it reports up to date only when the pinned commit is in the checkout and
   `UPSTREAM.json` matches the package at that commit, and it says which of the two
   failed. Later upstream commits that leave `packages/ui` alone do not make the copy
   out of date.
3. **Take.** Run `node scripts/ui-drift.mjs pin /path/to/inflect-compliance --ref
   <commit>`. It refuses while `verify` fails, so the only files it deletes are files
   it can prove are unchanged upstream copies. It then deletes the previously pinned
   files and writes the package at `<commit>` together with a fresh `UPSTREAM.json`,
   restoring each file's upstream mode. It refuses an upstream file it cannot pin (a
   symlink, a submodule, or a name that is not valid UTF-8) rather than renaming or
   skipping it. It finishes by running `verify` again; run `audit` against the same
   checkout too.
4. **Review and prove.** Read `git diff -- packages/ui`. Run the package typecheck
   (below), the tests and the gallery (part B of 1.2). Pay attention to new imports: a
   new dependency must be added to the root `package.json` in the same change.
5. **Record.** Update the shared-UI rows of `PROVENANCE.md` with the new commit. Then
   commit `packages/ui` and the provenance change together.

## What the rest of Islestone must provide

The other sub-phases need these facts, which the copy itself cannot provide.

- **Licence records, in the same change as the copy** (ADR 0001):
  - **The `@inflect/ui` licence-gate exemption.** The gate checks a workspace that
    holds `UPSTREAM.json` like any dependency, not as Islestone's own code (ADR 0001,
    Consequences), so without an entry in `scripts/licence-exemptions.json` for
    `@inflect/ui` (`licence` `BUSL-1.1`, `adr`
    `docs/adr/0001-code-provenance-and-licences.md`, which names the package) the
    build fails.
  - **`NOTICE`.** Dub's copyright and AGPL-3.0 statement and the Nucleo notice
    (ADR 0001 D4, "What the decision requires").
  - **`PROVENANCE.md`.** The rows drafted in `docs/porting/provenance-shared-ui.md`,
    naming the Dub origin of the files the measurement links to Dub and the Nucleo
    terms; one row per copied file unless the owner approves the grouping.
- **Root `tsconfig.json`.** `packages/ui/tsconfig.json` extends `../../tsconfig.json`
  and resets only `baseUrl`, `paths`, `rootDir`, `include` and `exclude`. Everything
  else is inherited from Islestone's root config. inflect's values are `strict`,
  `jsx: react-jsx`, `module: esnext`, `moduleResolution: bundler`, `isolatedModules`,
  `lib: [dom, dom.iterable, esnext]`, `target: ES2017`, `skipLibCheck`,
  `esModuleInterop`, `resolveJsonModule`, `allowJs` and `noEmit`. The package
  typechecks clean under them (see "Typecheck" below). A root config that differs
  changes the package's typecheck.
- **`.gitignore`.** It must include `node_modules/` and an unanchored
  `tsconfig.tsbuildinfo`. The root config sets `incremental: true`, so
  `tsc -p packages/ui` writes `packages/ui/tsconfig.tsbuildinfo` (observed). If git
  does not ignore that file, `verify` reports it as unlisted.
- **`.gitattributes` (sub-phase 1.1).** A root `.gitattributes` holding
  `packages/ui/** -text`. Without it, a checkout with `core.autocrlf=true` (the Git for
  Windows default) rewrites every file to CRLF, `UPSTREAM.json` included, and `verify`
  fails (it refuses the rewritten manifest as not canonical; with the manifest spared,
  all 397 files would read as modified). A future root `* text=auto` rule would also
  rewrite any upstream file that contains CRLF.
  No upstream file contains a CR byte today, so `text=auto` is harmless now only by
  coincidence. The rule sits outside `packages/ui`, so it does not touch byte identity.
  `tests/unit/ui-drift.test.mjs` shows both halves: an `autocrlf` clone fails `verify`,
  and the same clone with this rule passes.
- **Root dependencies.** `packages/ui/package.json` declares only `clsx` and
  `tailwind-merge`, plus four peers (`react`, `react-dom`, `next`, `next-intl`). The
  sources also import the packages below, which the root `package.json` must declare.
  The versions are inflect's locked versions at the pinned commit:

  | Package | Version |
  |---|---|
  | `class-variance-authority` | 0.7.1 |
  | `sonner` | 2.0.8 |
  | `lucide-react` | 1.72.0 |
  | `motion` | 13.5.1 |
  | `canvas-confetti` | 1.9.4 |
  | `@types/canvas-confetti` | 1.9.0 |
  | `@visx/axis`, `clip-path`, `event`, `gradient`, `group`, `responsive`, `scale`, `shape`, `text`, `tooltip` | 4.0.0 |
  | `date-fns` | 4.4.0 |
  | `d3-array` | 3.2.5 |
  | `@types/d3-array` | 3.2.2 |
  | `@tanstack/react-table` | 9.3.1 |
  | `@radix-ui/react-tooltip` | 1.4.1 |
  | `react`, `react-dom` | 19.3.1 |
  | `next` | 16.4.6 |
  | `next-intl` | 4.15.1 |
  | `typescript` | 5.9.3 |

  The co-located test `src/components/ui/hooks/__tests__/use-threshold-load-more.test.tsx`
  also needs `@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2 and
  `@types/jest` 30.0.0.
- **Typecheck script.** Add `tsc --noEmit -p packages/ui/tsconfig.json`, which is
  inflect's `typecheck:ui-boundary`. It makes the package boundary a compiler error:
  `@/…` does not resolve inside the package. The package's own `@inflect/ui/...`
  imports resolve through the `exports` map (TypeScript self-reference), with or
  without the workspace symlink.
- **Jest (1.1).** Two things are needed:
  - A jsdom project whose `testMatch` includes
    `<rootDir>/packages/*/src/**/__tests__/**/*.test.{ts,tsx}`. inflect's jsdom project
    already carries exactly this entry, beside `tests/rendered/**` and
    `src/**/__tests__/**`. It was added in #3046 step 3a, which measured that before
    it the moved test matched no project and stopped running without any report.
    Islestone copies that entry. A node project must not also match it: inflect's lists
    `<rootDir>/packages/[^/]+/src/.*/__tests__/` in its `testPathIgnorePatterns`.
  - The mapper `'^@inflect/ui/(.*)$': '<rootDir>/packages/ui/src/$1'`. jest-resolve
    does not honour an `exports` array fallback, which inflect measured in step 2b of
    its `docs/shared-ui-package-design.md`.

  Rendered tests that reach the package's charts also need inflect's transform
  allowlist for the ESM-only `@visx/*`, `d3-*` and `internmap`; part B's notes list it
  with the other jsdom settings.
- **Tokens (part B).** The package requires the 47 tokens named in
  `packages/ui/tokens.contract.css` and does not ship them. Islestone's own
  `tokens.css` must define all 47, in a light and a dark theme. Tailwind must scan
  `packages/ui/src` (inflect adds `@source "../../packages/ui/src"`).

  **The contract is necessary but not sufficient.** The package alone also needs the
  following, none of which is in `tokens.contract.css`. Without them the build stays
  green and renders no radius, no glass and no chart colour.

  | Needed | Used by | Through |
  |---|---|---|
  | `--radius`, `--radius-sm`, `--radius-lg` | `button`, `tooltip`, `hit-area`, `skeleton`, `typography`, `empty-state`, `card-variants`, `charts/interaction` | `rounded`, `rounded-sm`, `rounded-lg` |
  | `--shadow-lg` | `tooltip`, `charts/interaction` | `shadow-lg` |
  | `--ring-offset-background` | `tooltip` | `ring-offset-background` |
  | `--glass-bg`, `--glass-border`, `--glass-blur` | `card-variants`, `card`, `skeleton` | the `.glass-card` recipe |
  | the 12 `--chart-series-{1..6}-{start,end}` stops | `charts/chart-legend`, `chart-gradient`, `bar-field-3d`, `use-heat-scale`, `chart-3d` | `var(--chart-series-${n}-start)` built in a template |
  | `globals.css` recipes `.glass-card`, `.data-table` and `.animate-fadeIn` with `@keyframes fadeIn`, each inside `@layer components` | `card-variants`, `skeleton` | class names |
  | Tailwind `theme.extend`: the semantic colour keys (`bg`, `content`, `border`, `brand`, `ring`, `background`), `borderRadius`, `boxShadow.lg`, the spacing scale, and the `slide-up-fade`, `slide-down-fade` and `shimmer-sweep` animations | throughout; the animations in `tooltip` and `skeleton` | utility classes |

  The full list for the package plus the rest of the copied UI belongs to part B of
  1.2, which also writes the light and dark values.
- **Catalogue (next-intl).** The package reads four namespaces from the host's
  messages and ships none of them:

  | Namespace | Keys the package reads | File |
  |---|---|---|
  | `common.chart` | `noDataForRange`, `scaleAria`, `scaleAriaUnlabelled` | `charts/time-series-chart`, `charts/chart-legend` |
  | `common.error` | `title`, `tryAgain` | `error-state` |
  | `common.skeleton` | `dashboard`, `details`, `settings` | `skeleton` |
  | `common.ui` | `learnMore`, `moreInformation` | `empty-state`, `tooltip` |

  Every key is a literal, so a key list is enough. In inflect's `messages/en.json`,
  `common.error` (5 keys) and `common.skeleton` (3) are neutral and can be taken
  whole. `common.chart` (51) and `common.ui` (114) also carry risk-matrix, compliance
  and tenancy strings, so take those by key. inflect's rendered-test mock of next-intl
  resolves every key against the real catalogue, so a missing key fails a test (for
  example `error-state`'s "Something went wrong" and "Try again") rather than
  rendering silently wrong.

## Typecheck

This was run in a throwaway directory outside this repository, so no `node_modules`
or lockfile was added here. The setup was a root holding inflect's root
`compilerOptions`, npm workspaces, and the exact versions above. The command was
`tsc --noEmit -p packages/ui/tsconfig.json` with TypeScript 5.9.3.

- **Package dependencies only:** exit 2 with 40 errors, all of them in the one
  co-located test file. 39 errors are for the jest globals (`describe`, `it`,
  `expect`) and for implicit `any` on the parameters that follow from them. One is
  `Cannot find module '@testing-library/react'`. Every non-test source typechecks.
- **With the three test-only packages added:** exit 0 over all 391 `.ts`/`.tsx`
  sources.
- **Control:** a planted `import … from '@/lib/anything'` fails with TS2307. This
  proves the boundary check is live and not vacuous.

## Known upstream issues (fix in inflect-compliance, not here)

Fixing any of these here would break byte identity. Each one is a change in
inflect-compliance, which then arrives through a sync.

1. **Stale "empty package" text.** Three files describe the package as it was at
   inflect's step 1:
   - `src/index.ts` is `export {}`, and its comment says the package is empty.
   - `README.md` says "It is empty", says no dependency "is declared yet", and says
     "Nothing runs `tsc -p packages/ui` yet". inflect's `typecheck:ui-boundary` does
     run it.
   - The `package.json` `description` says "Empty at step 1".

   The package now holds 391 sources, and the public surface is deep imports through
   `exports` (`./*`), not the index.
2. **Undeclared dependencies.** `package.json` does not declare most of what the
   sources import (the list above). inflect gets away with it because its root
   installs everything.
3. **Stale hooks README.** `src/components/ui/hooks/README.md` still describes
   `src/components/ui/hooks/` and `useKeyboardShortcut`, which is not in the package.
   It also uses compliance examples (`useControls`, `useRisks`).
4. **MIXED files inside the package.** 11 chart files are classified `MIXED` in
   inflect's `docs/_status/ui-core-classification.json`, mostly for compliance or
   product wording in comments and examples:
   - `areas.tsx` and `bars.tsx` paint brand tokens as text.
   - `chart-legend.tsx` and `time-series-chart.tsx` contain hardcoded English.
   - `examples.ts` holds compliance sample data.
   - The others are `bar-field-3d.tsx`, `chart-gloss.tsx`, `chart-gradient.tsx`,
     `index.ts`, `interaction.tsx` and `use-heat-scale.ts`.
5. **Nucleo icons and Dub-derived files: accepted risk, ADR 0001 D4** (owner decision,
   2026-11-18: "Copy as is, accept risk"). The package is copied as it is. Its
   `PROVENANCE.md` rows name the Dub origin and the Nucleo terms
   (`docs/porting/provenance-shared-ui.md`), and `NOTICE` names both from the change
   that lands it. Removing the risk later is a change upstream (the finding's option
   1), which then arrives through a sync.
