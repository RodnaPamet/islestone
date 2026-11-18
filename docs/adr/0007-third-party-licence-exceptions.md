# 0007 — Third-party licence exceptions

Status: Proposed — awaiting owner sign-off (2026-11-18 drafted)

## Context

Roadmap sub-phase 0.3 sets the licence allowlist for production dependencies: "MIT, Apache-2.0, BSD, ISC, MPL-2.0 (unmodified use), PostgreSQL and the recorded tldraw exception". `scripts/licence-gate.mjs` enforces exactly that list. It reads "BSD" as the 2- and 3-clause forms (`BSD-2-Clause`, `BSD-3-Clause`); the 4-clause form's advertising clause is not on it. `CLAUDE.md` says that widening the list is an owner decision.

How to read this ADR: a line marked **Verified** was read in the named file or registry on 2026-11-18. Everything else is a recommendation or an open question. No decision here is made until the owner signs it.

### Why this ADR exists

- **Verified.** The gate's first draft widened the allowlist with no recorded decision. It allowed MIT-0, 0BSD, BlueOak-1.0.0, CC0-1.0, Unlicense and Python-2.0, plus CC-BY-4.0 for named data packages. The review of 2026-11-18 found this, and the list was narrowed back to roadmap 0.3's.
- **Verified.** The 14 LGPL exemptions for sharp's libvips binaries cited ADR 0001, which records no decision about them. The gate now requires the ADR an exemption cites to name the package, so each entry cites this ADR instead.
- **Verified.** With the narrowed list, today's production tree has 16 packages outside the allowlist. All of them come in through `next` 16.4.6. The gate reads `package-lock.json` and lists:
  - `tslib` 2.9.1, declared `0BSD`, reached through `next` > `@swc/helpers` > `tslib`;
  - `caniuse-lite` 1.0.30001826, declared `CC-BY-4.0`, reached through `next` > `caniuse-lite`;
  - 14 packages of prebuilt libvips for `sharp`, declared `LGPL-3.0-or-later` alone or in an `AND` with Apache-2.0 and MIT, reached through `next` > `sharp` (E1 below lists them).

Each one passes today only through an entry in `scripts/licence-exemptions.json` that cites this ADR. The decisions below say whether those entries stay, and in what form.

## Decision

Each option lists its consequences. The recommendations are proposals for the owner, not decisions.

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

**Recommendation:** E1a. The obligations are small and well understood, and E1b costs a feature and a new gate rule.

Owner sign-off: ____  Date: ____

### E2 — tslib (0BSD)

**Verified.** `node_modules/tslib/LICENSE.txt` at 2.9.1 is the Zero-Clause BSD licence: "Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted." It asks for nothing, not even attribution. Its `package.json` declares `0BSD`. `next` reaches it through `@swc/helpers`.

Options:

- **E2a. Exempt `tslib` by name.** The entry is bound to the declared licence, `0BSD`, so it stops applying if that changes. It is not pinned to a version, so routine upgrades pass.
- **E2b. Add `0BSD` to `ALLOWED_LICENCES`.** 0BSD imposes strictly fewer conditions than MIT, which is already allowed. The exemption is then deleted, and the gate reports it as "not needed" until it is.

**Recommendation:** E2b. Until the owner signs, E2a applies.

Owner sign-off: ____  Date: ____

### E3 — caniuse-lite (CC-BY-4.0)

**Verified.** `caniuse-lite` 1.0.30001826 declares `CC-BY-4.0`, and its `LICENSE` is "Attribution 4.0 International". The package is the caniuse.com browser-support database (`data/`) with a small decoder (`dist/`). `next` uses it, through browserslist, to choose build targets. CC-BY-4.0 is a licence for works such as databases and documents. It asks for attribution and has no copyleft.

Options:

- **E3a. Exempt `caniuse-lite` by name.** The entry is bound to the declared licence and not pinned to a version: the database is republished about once a week (five releases between 2026-10-22 and 2026-11-11, per the npm registry).
- **E3b. Add a data-only rule to the gate:** CC-BY-4.0 passes only for packages named on a list. The first draft of the gate had this as `DATA_ONLY_LICENCES`.

**Recommendation:** E3a. One package does not need a rule. If the image built in 1.8 is ever distributed outside Islestone's own hosting, for example as a self-hosted edition, add a CC-BY attribution for the database to `NOTICE`.

Owner sign-off: ____  Date: ____

### E4 — Other permissive licences, none in the tree today

MIT-0, BlueOak-1.0.0, CC0-1.0, the Unlicense and Python-2.0 are permissive or public-domain dedications. No production dependency declares one today, so none is added.

- When a dependency needs one, add it through an amendment to this ADR, or through an exemption that cites one.
- CC0-1.0 will come up first: option F2 of ADR 0002 uses `fractional-indexing`, which is CC0-1.0. Decide CC0-1.0 together with that choice.

**Recommendation:** add nothing until a dependency needs it.

Owner sign-off: ____  Date: ____

### E5 — Licence exceptions after `WITH` (recorded, no owner decision needed)

The gate accepts `L WITH X` only when `L` is allowed and `X` is on `ALLOWED_EXCEPTIONS`. That list holds SPDX exceptions that only add permissions, such as `LLVM-exception` and `Classpath-exception-2.0`. Any other text after `WITH` fails with `UNKNOWN_EXCEPTION`. "MIT WITH Commons-Clause" is refused by name: it is how `task-master-ai` declares itself, and roadmap 2.5 lists task-master as a licence trap. `task-master-ai` is also on the deny list. This only narrows the policy, so it needs no sign-off. It is recorded here so the policy has one written source.

## Consequences

- Today's tree passes the gate only through the exemptions above. If the owner declines E1, E2 or E3, the gate fails until the dependency is replaced or the matching alternative is built.
- The LGPL entries are pinned to versions, so a `next` or `sharp` upgrade that moves them fails the gate until a person re-reads the new versions.
- The `tslib` and `caniuse-lite` entries are bound to their declared licences. A licence change fails the gate; a version change does not.
- Sub-phase 1.8 inherits two obligations from E1a: the LGPL notice in the image, and a replaceable library.
- Widening `ALLOWED_LICENCES` stays an amendment to this ADR, never a change made to get a build through.

## What would change this decision

- `next` stops depending on `sharp`, `tslib` or `caniuse-lite`, or one of them changes its licence.
- Islestone distributes its image to third parties, for example as a self-hosted edition. The attribution and LGPL obligations then reach further.
- The owner widens the allowlist (E2b, E4).

## References

- Roadmap (`docs/ROADMAP.md`): 0.3 and H0; 2.5 (licence traps); 1.8 (container build).
- `scripts/licence-gate.mjs` (the policy constants at the top) and `scripts/licence-exemptions.json`.
- ADR 0001 (provenance and the tldraw exception), ADR 0002 (option F2, `fractional-indexing`).
- npm packages as installed from `package-lock.json`: `tslib` 2.9.1, `caniuse-lite` 1.0.30001826, `sharp` 0.35.5 and the `@img/*` packages listed in E1.
