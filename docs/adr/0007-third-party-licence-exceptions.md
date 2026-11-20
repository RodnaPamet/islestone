# 0007 — Third-party licence exceptions

Status: Accepted (owner decisions, 2026-11-18 and 2026-11-19; E10, owner decision 145, 2026-11-20)

## Context

Roadmap sub-phase 0.3 sets the licence allowlist for production dependencies: "MIT, Apache-2.0, BSD, ISC, MPL-2.0 (unmodified use), PostgreSQL and the recorded tldraw exception". `scripts/licence-gate.mjs` enforces that list, plus `0BSD` since decision E2 below. It reads "BSD" as the 2- and 3-clause forms (`BSD-2-Clause`, `BSD-3-Clause`); the 4-clause form's advertising clause is not on it. `CLAUDE.md` says that widening the list is an owner decision.

How to read this ADR: a line marked **Verified** was read in the named file or registry on 2026-11-18. The owner decided E1 to E4 on 2026-11-18, in the working session; each section records the option chosen. E5 needed no decision.

### Why this ADR exists

- **Verified.** The gate's first draft widened the allowlist with no recorded decision. It allowed MIT-0, 0BSD, BlueOak-1.0.0, CC0-1.0, Unlicense and Python-2.0, plus CC-BY-4.0 for named data packages. The review of 2026-11-18 found this, and the list was narrowed back to roadmap 0.3's.
- **Verified.** The 14 LGPL exemptions for sharp's libvips binaries cited ADR 0001, which records no decision about them. The gate now requires the ADR an exemption cites to name the package, so each entry cites this ADR instead.
- **Verified.** With the narrowed list, the production tree had 16 packages outside the allowlist when this ADR was drafted. All of them come in through `next` 16.4.6. The gate read `package-lock.json` and listed:
  - `tslib` 2.9.1, declared `0BSD`, reached through `next` > `@swc/helpers` > `tslib`;
  - `caniuse-lite` 1.0.30001826, declared `CC-BY-4.0`, reached through `next` > `caniuse-lite`;
  - 14 packages of prebuilt libvips for `sharp`, declared `LGPL-3.0-or-later` alone or in an `AND` with Apache-2.0 and MIT, reached through `next` > `sharp` (E1 below lists them).

Each one passed only through an entry in `scripts/licence-exemptions.json` that cited this ADR. The decisions below say which entries stay, and in what form. Since E2, `tslib` passes on the allowlist and has no entry; the other 15 keep theirs.

## Decision

Each section records the owner's decision, then the options as drafted, with their consequences.

### E1 — sharp's libvips binaries (LGPL-3.0-or-later)

`next` declares `sharp` as an optional dependency. `next start` uses it to optimise images served through `next/image`. `sharp` loads a prebuilt libvips for the platform it runs on, as a separate shared library.

**Verified**, as recorded in each exemption's `reason`: the lockfile and the npm registry agree on each licence field, each tarball's sha512 equals the lockfile's integrity value, and the libvips packages' README was read. It lists the libraries bundled with libvips: MPL-1.1 (cairo), MIT, BSD, zlib, IJG, libpng, FreeType, and the AOM patent licence.

| Package | Version | Declared licence |
|---|---|---|
| `@img/sharp-libvips-darwin-arm64` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-darwin-x64` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-arm` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-arm64` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-ppc64` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-riscv64` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-s390x` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-x64` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linuxmusl-arm64` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linuxmusl-x64` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-wasm32` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT |
| `@img/sharp-win32-arm64` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later |
| `@img/sharp-win32-ia32` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later |
| `@img/sharp-win32-x64` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later |

Options:

- **E1a. Exempt them, each pinned to the version that was read.**
  - The library is used unmodified and loaded at run time as a separate shared library. LGPL-3.0-or-later permits that.
  - Any image that contains it (sub-phase 1.8) must carry the LGPL notice and leave the library replaceable: no static linking, no stripping of the shared object. `NOTICE` gains an entry when the image is built.
  - Each `sharp` upgrade needs its entries re-read and their versions updated, or the gate fails.
- **E1b. Keep sharp out of production.**
  - Set `images: { unoptimized: true }` in `next.config.ts`, and have the 1.8 image build delete `node_modules/sharp` and `node_modules/@img`.
  - The exemptions go. Images are then served without server-side resizing, so pages ship larger images unless a CDN resizes them.
  - The lockfile still lists the packages, so the gate needs a rule for "installed but removed from the image". That rule does not exist and would have to be written.

**Decision: E1a.** Owner decision, 2026-11-18; the owner chose "Keep, exempt them". sharp stays in production for image optimisation. The 14 packages above are exempted, each pinned to the version that was read. The image built in sub-phase 1.8 carries the LGPL notice and leaves the library replaceable, and `NOTICE` gains an entry for the libvips binaries in the same change. This was the draft's recommendation: the obligations are small and well understood, and E1b costs a feature and a new gate rule.

### E2 — tslib (0BSD)

**Verified.** `node_modules/tslib/LICENSE.txt` at 2.9.1 is the Zero-Clause BSD licence: "Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted." It asks for nothing, not even attribution. Its `package.json` declares `0BSD`. `next` reaches it through `@swc/helpers`.

Options:

- **E2a. Exempt `tslib` by name.** The entry is bound to the declared licence, `0BSD`, so it stops applying if that changes. It is not pinned to a version, so routine upgrades pass.
- **E2b. Add `0BSD` to `ALLOWED_LICENCES`.** 0BSD imposes strictly fewer conditions than MIT, which is already allowed. The exemption is then deleted, and the gate reports it as "not needed" until it is.

**Decision: E2b.** Owner decision, 2026-11-18; the owner chose "ADR 0007 as proposed". `0BSD` is on `ALLOWED_LICENCES`, and the `tslib` exemption is deleted. E2a, the interim form before the decision, no longer applies.

### E3 — caniuse-lite (CC-BY-4.0)

**Verified.** `caniuse-lite` 1.0.30001826 declares `CC-BY-4.0`, and its `LICENSE` is "Attribution 4.0 International". The package is the caniuse.com browser-support database (`data/`) with a small decoder (`dist/`). `next` uses it, through browserslist, to choose build targets. CC-BY-4.0 is a licence for works such as databases and documents. It asks for attribution and has no copyleft.

Options:

- **E3a. Exempt `caniuse-lite` by name.** The entry is bound to the declared licence and not pinned to a version: the database is republished about once a week (five releases between 2026-10-22 and 2026-11-11, per the npm registry).
- **E3b. Add a data-only rule to the gate:** CC-BY-4.0 passes only for packages named on a list. The first draft of the gate had this as `DATA_ONLY_LICENCES`.

**Decision: E3a.** Owner decision, 2026-11-18; the owner chose "ADR 0007 as proposed". `caniuse-lite` is exempted by name, bound to `CC-BY-4.0`, and not pinned to a version. One package does not need a rule. If the image built in 1.8 is ever distributed outside Islestone's own hosting, for example as a self-hosted edition, add a CC-BY attribution for the database to `NOTICE`.

### E4 — Other permissive licences, none in the tree today

MIT-0, BlueOak-1.0.0, CC0-1.0, the Unlicense and Python-2.0 are permissive or public-domain dedications. No production dependency declares one today, so none is added.

- When a dependency needs one, add it through an amendment to this ADR, or through an exemption that cites one.
- CC0-1.0 will come up first: option F2 of ADR 0002 uses `fractional-indexing`, which is CC0-1.0. Decide CC0-1.0 together with that choice.

**Decision: add no other licence until a dependency needs one.** Owner decision, 2026-11-18; the owner chose "ADR 0007 as proposed".

### E5 — Licence exceptions after `WITH` (recorded, no owner decision needed)

The gate accepts `L WITH X` only when `L` is allowed and `X` is on `ALLOWED_EXCEPTIONS`. That list holds SPDX exceptions that only add permissions, such as `LLVM-exception` and `Classpath-exception-2.0`. Any other text after `WITH` fails with `UNKNOWN_EXCEPTION`. "MIT WITH Commons-Clause" is refused by name: it is how `task-master-ai` declares itself, and roadmap 2.5 lists task-master as a licence trap. `task-master-ai` is also on the deny list. This only narrows the policy, so it needed no decision. It is recorded here so the policy has one written source.

### E6 — The Unlicense, and `@visx/vendor`'s declaration (sub-phase 1.2)

The shared UI (`@inflect/ui`, roadmap 1.2) draws its charts with visx 4.0.0, which brings two packages the allowlist did not admit.

**Verified** on 2026-11-19 in the installed tree:

- `robust-predicates` 3.0.3 (reached through `@visx/scale` > `@visx/vendor` > `d3-delaunay` > `delaunator`) declares `Unlicense`. Its `LICENSE` begins "This is free and unencumbered software released into the public domain": a public-domain dedication with no conditions.
- `@visx/vendor` 4.0.0 declares `"MIT and ISC"`, which is not a valid SPDX expression (the operator must be upper-case `AND`), so the gate reads it as `INVALID`. The package bundles d3 modules (ISC) beside visx's own code, and its `LICENSE` is the MIT licence, "Copyright (c) 2017-2018 Harrison Shoff". Both licences are already on the allowlist.

Options for the Unlicense were: exempt `robust-predicates` alone; add the Unlicense to `ALLOWED_LICENCES`; or refuse visx, which would stop the shared UI's charts compiling and so stop the byte-for-byte copy landing.

**Decision: add `Unlicense` to `ALLOWED_LICENCES`.** Owner decision, 2026-11-19; the owner chose "Allow the Unlicense". This is the E4 path, taken for the first dependency that needs it.

**`@visx/vendor`** needs no new licence: its exemption in `scripts/licence-exemptions.json` reads the declaration as `MIT AND ISC`, pinned to version 4.0.0 because the declaration is not SPDX. A visx upgrade fails the gate until a person re-reads the new version.

### E7 — The Prisma CLI's tree: BlueOak-1.0.0, `elkjs` and a second `@visx/vendor` (sub-phase 1.3)

Sub-phase 1.3 adds Prisma 7. `@prisma/client` declares the `prisma` CLI as an optional peer, so with `prisma` in devDependencies npm marks the CLI and its whole tree `devOptional`, and `npm ci --omit=dev` installs it: the gate rightly treats it as production. The CLI also runs migrations in the image sub-phase 1.8 builds.

**Verified** on 2026-11-19 in the installed tree:

- `graceful-fs` 4.2.12 (reached through many packages, the CLI among them) declares `BlueOak-1.0.0`, and its `LICENSE.md` is the Blue Oak Model License 1.0.0: a permissive licence that grants every right on condition the notice is kept, like MIT. 4.2.11 was ISC.
- `elkjs` 0.11.1 (`prisma` > `@prisma/studio-core` > `elkjs`, used by Prisma Studio's graph layout) declares `EPL-2.0`, and its `LICENSE.md` is the Eclipse Public License 2.0. EPL-2.0 is a weak, file-level copyleft: a modified EPL file must be published under EPL-2.0, while using it unmodified alongside other code imposes nothing on that code. Islestone uses it unmodified and never imports it.
- `@visx/vendor` 4.0.0-alpha.0 (through `@prisma/studio-core` and its `@visx/grid`) declares `"MIT and ISC"` like 4.0.0 (E6), which is not valid SPDX.

Options were: add BlueOak-1.0.0 to the allowlist and exempt the other two; exempt all three; or install the CLI outside the root lockfile as a separate tools manifest.

**Decision: add `BlueOak-1.0.0` to `ALLOWED_LICENCES`, and exempt `elkjs` and the second `@visx/vendor`.** Owner decision, 2026-11-19; the owner chose "BlueOak + 2 exemptions".

- `elkjs` is exempted as `EPL-2.0`, pinned to 0.11.1. Any image that contains it (sub-phase 1.8) carries its EPL-2.0 notice, and `NOTICE` gains an entry in that change; it is never modified in place.
- The `@visx/vendor` exemption (E6) now lists both versions, `4.0.0` and `4.0.0-alpha.0`. The gate accepts a list of exact versions for one package, and reports a listed version the tree no longer holds as stale.

### E8 — MIT-0, for the mailer's SMTP transport (sub-phase 1.6)

Sub-phase 1.6 ports inflect-compliance's mailer, which sends through `nodemailer`.

**Verified** on 2026-11-19 in the installed tree: `nodemailer` 10.3.1 (published 2026-10-29) declares `MIT-0`, and its `LICENSE` is the MIT No Attribution licence: the MIT grant without the condition that the notice be kept. It imposes strictly fewer conditions than MIT, which is already allowed. Nothing else in the tree declares MIT-0.

Options were: add `MIT-0` to `ALLOWED_LICENCES` (the E4 path); exempt `nodemailer` alone; or ship no SMTP transport, leaving mail on the console sink.

**Decision: add `MIT-0` to `ALLOWED_LICENCES`.** Owner decision, 2026-11-19 (HANDOFF row 31). `nodemailer` is pinned to 10.3.1, the newest release at least 14 days old on the day it was installed. Installing it needs a `package.json` override of next-auth's optional `nodemailer@^7.0.7` peer, decided in ADR 0004 (open question 7).

### E9 — FSL-1.1-Apache-2.0, for the Sentry SDK (sub-phase 1.6)

Sub-phase 1.6 ports inflect-compliance's Sentry integration (`src/lib/observability/sentry.ts`), which needs `@sentry/nextjs`.

**Verified** on 2026-11-19 in the installed tree: `@sentry/nextjs` 11.11.0 (published 2026-11-05), `@sentry/node` 11.11.0 and `@sentry/bundler-plugins` 11.11.0 declare `MIT`. `@sentry/bundler-plugins` depends on `sentry` 0.45.0, which declares `FSL-1.1-Apache-2.0`: the Functional Source License 1.1 with the Apache-2.0 future licence. It is source-available, not open source. It grants every use except a competing product or service that substitutes for the licensed software, and each release converts to Apache-2.0 two years after it is made available. Islestone uses it only as the Sentry SDK's build-time dependency and offers no competing error-tracking product.

Options were: add `FSL-1.1-Apache-2.0` to `ALLOWED_LICENCES`; exempt `sentry` alone, pinned; or leave Sentry as a no-op stub and choose another error tracker.

**Decision: add `FSL-1.1-Apache-2.0` to `ALLOWED_LICENCES`.** Owner decision, 2026-11-19 (HANDOFF row 32); the owner accepts it for the Sentry SDK. `@sentry/nextjs` is pinned to 11.11.0: inflect-compliance's 11.12.0 was under 14 days old on the day of install. The SDK is initialised only when `SENTRY_DSN` is set, server-side only, with its data collection pinned off (`tests/guards/sentry-privacy-posture-pinned.test.ts`).

### E10 — The bgOffice Bulgarian dictionary, MPL-1.1 used as MPL-2.0 (sub-phase 2.7f)

ADR 0008 D2 (owner decision 126) stems Bulgarian with a Hunspell dictionary installed in Islestone's own Postgres image. It is data, not an npm package: the licence gate (`scripts/licence-gate.mjs`) never sees it, so this entry, a guard and the image build hold it instead.

**Verified** on 2026-11-20:

- The source is bgOffice's OOo-spell-bg 4.3, in `https://downloads.sourceforge.net/bgoffice/OOo-full-pack-bg-4.3.zip` (files dated 2010-06-17). The archive's SHA512 is `1c4acf0c8377c6ec3f0dd26c84a5232be88b1fecabcb08dfae4f45bf819c770427731cbf1b01d65d3a182cccc3d0bcaabf3ab85735221e2ff09fc47bd66341d7`, equal to the value Gentoo's `app-dicts/myspell-bg/Manifest` records (gentoo/gentoo at `1d677101c0776fa2bf680550e2864f4f0a2e6ccd`).
- The files taken are `OOo-full-pack-bg-4.3/bg_BG.dic` (sha256 `c1d403ecf6588c3e23f9b57db2f905fda035e17c115d05736e1ce02ea17dacee`) and `OOo-full-pack-bg-4.3/bg_BG.aff` (sha256 `8c068e82c939f1bd138195de393c9dcc5e5401f8003fc1faf80f5e82da28ef3f`).
- Their licence is `OOo-full-pack-bg-4.3/Copyright_spell`, verbatim (its line breaks reflowed; the file itself is `deploy/postgres/tsearch_data/Copyright_spell.txt`):

  > OOo-spell-bg part of bgOffice
  > Copyright (C) 2001-2010 Radostin Radnev <radnev@gmail.com>
  >
  > This program comes with ABSOLUTELY NO WARRANTY. This is free software, and you are welcome to redistribute it under certain conditions. This package is distributed under the terms of either GNU General Public License Version 2 or later, or GNU Lesser General Public License Version 2.1 or later, or the Mozilla Public License Version 1.1. For details read file GPL-2.0.txt, LGPL-2.1.txt and MPL-1.1.txt.

  In SPDX, `GPL-2.0-or-later OR LGPL-2.1-or-later OR MPL-1.1`. None of the three is on `ALLOWED_LICENCES`.
- MPL-1.1 section 6.2 (the `MPL-1.1.txt` the archive ships): "You may also choose to use such Covered Code under the terms of any subsequent version of the License published by Netscape." MPL-2.0, which is on `ALLOWED_LICENCES`, is that subsequent version, published by the Mozilla Foundation as the licence's steward.
- The LibreOffice dictionaries repository's copy (`bg_BG/`, at `c0865a85eb67dc377f2cf8e8fe2c4fa9e53f0dcb`) ships only the GPL-2.0 text and a word list five entries off 4.3's; it is not used.
- PostgreSQL's `ispell` template reads the files once they are UTF-8, and the 17 fixtures of migration `20261207120000_search_configuration` stem as expected (`книгите` → `книга`, `срокът` → `срок`, `работихме` → `работя`). The loaded dictionary costs about 9.3 MB per database backend that uses it, first use about 100 ms.

Options were: A, take it under MPL-1.1 and use it under MPL-2.0 through section 6.2; B, take it under LGPL-2.1-or-later and exempt it as E1 exempts libvips; C, admit MPL-1.1 itself; D, the LibreOffice copy (GPL-2.0 on its face); E, Russian stemming as a stand-in (it does not strip Bulgarian articles: `задачата` → `задачат`); F, Cyrillic words indexed as typed.

**Decision: A.** Owner decision 145, 2026-11-20 (relayed). It admits this one file set and nothing else:

- The two files are used under MPL-2.0. They are modified only by re-encoding: Windows-1251 to UTF-8, CRLF to LF, the affix file's `SET microsoft-cp1251` to `SET UTF-8`, and renamed to `bulgarian.dict` and `bulgarian.affix`. No word, flag or rule is changed. `deploy/postgres/convert-bgoffice.sh` reproduces the conversion from the archive and checks every hash.
- The converted files are MPL-2.0 files, published with their source (they are their own source form) and a statement of the change: `deploy/postgres/tsearch_data/` in the repository (`README.md`, `Copyright_spell.txt`, `LICENSE-MPL-2.0.txt`), and the same three files in the image under `/usr/share/doc/islestone-postgres/bgoffice-bulgarian/`.
- The results' hashes are pinned: `bulgarian.dict` sha256 `44408b1ee50301e8f9a133b0ec92565bb8be49818c444d91821876d447f58906`, `bulgarian.affix` sha256 `cb6bfc56d6b1e70c812061086d7ec5ad6aaf6d35acd927a035f1cee0188ea477`.
- `ALLOWED_LICENCES` is not widened. Three things hold the file set to this entry instead: `deploy/postgres/dictionary.json` records the source, the licence and every hash; `tests/guards/postgres-dictionary-pinned.test.ts` fails when a file in `deploy/postgres/tsearch_data/` differs from that record, when a file is added or removed, or when the record's hashes, archive digest or licence differ from this entry; and `deploy/postgres/Dockerfile` checks the two hashes with `sha256sum -c` before it installs them. Any other dictionary, version or conversion is an amendment to this entry.
- `PROVENANCE.md` lists it and `NOTICE` carries its copyright line and licence.

## Consequences

- The state of the gate: `ALLOWED_LICENCES` holds roadmap 0.3's list plus `0BSD` (E2b), `Unlicense` (E6), `BlueOak-1.0.0` (E7), `MIT-0` (E8) and `FSL-1.1-Apache-2.0` (E9). `scripts/licence-exemptions.json` holds 18 entries: 17 cite this ADR (the 14 sharp packages, E1a; `caniuse-lite`, E3a; `@visx/vendor` at two versions, E6 and E7; `elkjs`, E7) and one cites ADR 0001 (`@inflect/ui`, the BUSL-1.1 mirror). There is no `tslib` entry (E2b).
- The gate accepts an exemption only when the ADR it cites exists, names the package, and has an Accepted status line. An exemption that cites a Proposed ADR fails the gate.
- The LGPL entries are pinned to versions, so a `next` or `sharp` upgrade that moves them fails the gate until a person re-reads the new versions.
- The `caniuse-lite` entry is bound to its declared licence. A licence change fails the gate; a version change does not.
- Sub-phase 1.8 inherits the EPL-2.0 notice for `elkjs` (E7) and two obligations from E1a: the LGPL notice in the image, with a `NOTICE` entry in the same change, and a replaceable library.
- E10 admits one data file set, bgOffice's Bulgarian dictionary used under MPL-2.0, outside the npm gate; a guard and the Postgres image's build hold its hashes and this record together.
- Widening `ALLOWED_LICENCES` stays an amendment to this ADR, never a change made to get a build through.

## What would change this decision

- `next` stops depending on `sharp`, `tslib` or `caniuse-lite`, or one of them changes its licence.
- Islestone distributes its image to third parties, for example as a self-hosted edition. The attribution and LGPL obligations then reach further.
- A dependency needs a licence that is not on the allowlist (E4). It is added by an amendment to this ADR, or exempted by an entry that cites one.

## References

- Roadmap (`docs/ROADMAP.md`): 0.3 and H0; 2.5 (licence traps); 1.8 (container build).
- `scripts/licence-gate.mjs` (the policy constants at the top) and `scripts/licence-exemptions.json`.
- ADR 0001 (provenance and the tldraw exception), ADR 0002 (option F2, `fractional-indexing`).
- npm packages as installed from `package-lock.json`: `robust-predicates` 3.0.3 and `@visx/vendor` 4.0.0 (E6), `graceful-fs` 4.2.12, `elkjs` 0.11.1 and `@visx/vendor` 4.0.0-alpha.0 (E7), `tslib` 2.9.1, `caniuse-lite` 1.0.30001826, `sharp` 0.35.5 and the `@img/*` packages listed in E1.
