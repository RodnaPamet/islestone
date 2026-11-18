# 0001 — Code provenance and licences

Status: Accepted (owner decisions, 2026-11-18)

## Context

Islestone plans to reuse a large part of inflect-compliance (roadmap section 2.1). Before any of that code could enter this repository, these things had to be settled:

- **D1.** Islestone's right to use inflect-compliance code.
- **D2.** Islestone's own licence.
- **D3.** The canvas library: tldraw, which is proprietary, or Excalidraw.
- **D4.** The Dub-derived files and Nucleo icons in inflect-compliance's UI layer. This arose after the first draft, from the measurement in `docs/porting/licence/dub-nucleo-finding.md`.

This ADR was drafted on 2026-11-18 with the options for D1 to D3 and a recommendation for each. The repository owner decided all four in the working session the same day. Each decision below records the option chosen and the owner's words where they were given. Where the owner chose against the draft's recommendation, the decision says so. The options that were not chosen are kept, briefly, because "What would change this decision" points back to them.

How to read this ADR: a line marked **Verified** was read in the named file on 2026-11-18. Everything else is a decision, an inference or an open question, and is labelled as one. This ADR is not legal advice.

### What was read

- **Verified.** The sibling checkout `/home/user/inflect-compliance` at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e` (2026-11-17, "chore(release): 3.404.0"). Its git remote is `https://github.com/RodnaPamet/inflect-compliance`.
- **Verified.** The clone is shallow (50 commits), so the history of its `LICENSE` file could not be read.

### The parent's licence: BUSL-1.1

**Verified**: the licence declarations.

- `package.json` line 5: `"license": "BUSL-1.1"`. Line 4: `"private": true`.
- `packages/ui/package.json` line 5: `"license": "BUSL-1.1"`. The shared UI package that roadmap 1.2 copies byte for byte is under the same licence.
- `LICENSE` line 1: "Business Source License 1.1".
- No source file carries its own BUSL header: under `src/`, `packages/ui/` and `prisma/`, the only file that mentions "BUSL" or "Business Source" is `packages/ui/package.json`, and no file carries an SPDX line.

**Verified**: the five parameters, quoted exactly from `LICENSE` lines 10–35.

```
Licensor:             Inflect Ltd., a company registered in Bulgaria.

Licensed Work:        Inflect Compliance, as made available in this
                      repository (github.com/inflect-compliance/
                      inflect-compliance) and in each version released by
                      the Licensor.
                      The Licensed Work is © 2026 Inflect Ltd.

Additional Use Grant: You may make production use of the Licensed Work,
                      provided that you may not use the Licensed Work to
                      provide, to third parties, a hosted, managed, embedded,
                      or software-as-a-service product or service —
                      including any compliance, governance, risk, or
                      audit-management product or service — that competes
                      with any product or service offered by the Licensor.
                      Using the Licensed Work to operate your own
                      organization's (and your affiliates') internal
                      compliance program, including through consultants or
                      service providers acting solely on your behalf, is
                      permitted.

Change Date:          2030-07-17 (four years after the initial version's
                      first public availability; per the Terms below, the
                      Change Date is determined separately for each version).

Change License:       Apache License, Version 2.0
```

`LICENSE` lines 37–38 name a contact for alternative licensing arrangements. The address is not repeated here.

**Verified**: the terms that matter for Islestone, from `LICENSE`.

- Lines 44–47: the Licensor grants the right to "copy, modify, create derivative works, redistribute, and make non-production use of the Licensed Work". Production use is allowed only through the Additional Use Grant.
- Lines 49–53: each version converts to the Change License on the Change Date, "or the fourth anniversary of the first publicly available distribution of a specific version … whichever comes first".
- Lines 55–58: use outside the licence requires a commercial licence from the Licensor, or no use at all.
- Lines 60–63: "All copies of the original and modified Licensed Work, and derivative works of the Licensed Work, are subject to this License."
- Lines 65–66: each original or modified copy must "conspicuously display this License".
- Lines 70–72: a violation ends the rights "for the current and all other versions".
- Lines 74–76: no right in the Licensor's trademarks or logos.
- Lines 115–117: BUSL "is not an Open Source license".

**Verified**: supporting files.

- `LICENSING.md` lines 15–19 summarise the restriction: no hosted, managed, embedded or SaaS offering to third parties "that **competes** with an Inflect offering". Lines 5–6 say "the `LICENSE` file always governs".
- `LICENSING.md` lines 26–30 say each release converts to Apache-2.0 on its own four-year clock. They also say "today's code is Apache-2.0 by 2030-07-17".
- `NOTICE` line 2 reads "Copyright (c) Inflect Compliance contributors." `LICENSE` line 16 reads "The Licensed Work is © 2026 Inflect Ltd."
- `CONTRIBUTING.md` and `.github/workflows/`: no contributor licence agreement and no DCO sign-off requirement were found. Searched for CLA, DCO, "signed-off", "assign" and "copyright".

**Verified**: third-party material inside inflect-compliance. A port carries its obligations with it.

- `NOTICE` lines 7–19: the AI guard's rule taxonomy in `src/app-layer/ai/guard/` is adapted from pipelock, under Apache-2.0. A port of the guard (roadmap 6.1) carries that attribution.
- `NOTICE` lines 52–77: six files under `.claude/skills/` are redistributed copies of NVIDIA/OpenShell files, under Apache-2.0.
- `LICENSING.md` lines 42–46: libvips (LGPL), elkjs (EPL-2.0) and FSL-licensed build tools.
- `package-lock.json`: `elkjs` 0.12.1 is recorded as `EPL-2.0 OR GPL-3.0-or-later`. `@dagrejs/dagre` 3.1.3 is `MIT`.
- `package.json` line 18: the parent's own gate, `license:check`, fails on AGPL, SSPL, BUSL-1.1 and Commons Clause. It excludes three packages: `inflect-compliance` itself, `@inflect/ui` and `@rodnapamet/scanent-contract` 0.16.0.
- The UI layer is largely derived from Dub and carries Nucleo icons. See "The Dub and Nucleo finding" below.

### What the BUSL text alone allowed Islestone

This is a plain reading of the text above, written before D1 and D2 were decided. It is not a legal opinion. It is kept because it explains why D1 needed a decision rather than a reading of the licence.

The licence allows anyone, without asking:

- reading the code and learning its design;
- copying, modifying, making derivative works and redistributing, for **non-production** use (lines 44–46);
- production use, but only inside the Additional Use Grant.

Without a decision by the owner, the licence did not allow, or did not clearly allow:

- **Islestone's production use.** Islestone is a SaaS offered to third parties, and the grant forbids that when the service "competes with any product or service offered by the Licensor". "Competes" is undefined.
- **Choosing Islestone's licence for ported code.** Copies and derivative works stay under BUSL-1.1 (lines 60–63).
- **Leaving out the notice.** Every copy must display the BUSL licence (lines 65–66).
- **Safety on breach.** A breach ends the rights to every version (lines 70–72).
- **Using Inflect Ltd.'s names or logos** (lines 74–76).

D1 and D2 settle this: the owner, who states that inflect-compliance is their software, allowed the copying, and made Inflect Ltd., the licensor of inflect-compliance, Islestone's licensor as well.

### The canvas library

**Verified**: what the parent uses.

- `package.json` line 205: `"tldraw": "^3.15.6"`.
- `package-lock.json` resolves `tldraw` 3.15.6 and `@tldraw/editor` 3.15.6, both with licence "SEE LICENSE IN LICENSE.md". `@tldraw/state`, `@tldraw/store` and `@tldraw/tlschema` 3.15.6 are recorded as MIT.
- 27 files under `src/` import from `tldraw` or `@tldraw/*`, mostly under `src/components/processes/`. `docs/dependency-risk-review.md` lines 394–398 say there are zero import sites. That was true when the review was written on 2026-09-29, before adoption. It is no longer current.
- No `licenseKey` prop or licence-key variable appears in `src/`. Two source comments say the watermark is left where tldraw puts it: `src/components/processes/agent-view/AgentCanvasView.tsx` line 23 and `src/components/processes/agent-flow/AgentFlowCanvas.tsx` line 8. No guard was found that asserts the watermark stays visible.

**Verified**: tldraw's licence text. The npm packages hold only a 104-byte `LICENSE.md` that points to the licence on tldraw's GitHub `main` branch. This pointer is identical in `tldraw` and `@tldraw/editor` at 3.15.6, 4.0.0 and 5.6.1. The text itself was read at each git tag from `raw.githubusercontent.com/tldraw/tldraw/<tag>/LICENSE.md`:

| | v3.15.6 | v4.0.0 and v5.6.1 (identical) |
|---|---|---|
| sha256 | `a051565874fd424cc9c19049d425ead719b9b7cf214546f31a368b4a3822755d` | `9578fcddc20e404b6a29f44b6fea81d8b331698c0e7e9be34132d6f4394fa533` |
| Grant | "Use the Software in your commercial or non-commercial projects." | "Use the Software in Development Environments." |
| Production | Allowed | "Not to use the Software in Production Environments", except under a trial or a commercial licence, each "for the specified period" |
| Watermark | "Not to disable, hide, remove, or alter the Watermark", or the key validation that governs it | No watermark clause; "License Key enforcement" instead |
| Data | No data clause | "The Software may collect and transmit usage data to tldraw for license compliance purposes." |
| Paid option | A "Business License" to use the SDK without the watermark | A commercial agreement; contact the vendor |

Both versions also require a verbatim copy of the licence in any distribution. They forbid distributing the software as a standalone product, and forbid putting it under a licence that "supersedes or negates" theirs.

**Verified**: release history, from the npm registry on 2026-11-18.

- The latest stable release is 5.6.1, published 2026-11-16.
- The last 3.x release is 3.15.6, published 2026-02-11.
- The first 4.x release is 4.0.0, published 2025-09-18.
- So 3.x received a maintenance release after 4.0.0. No statement about future 3.x releases was found.
- `tldraw` 3.15.6 declares `@tiptap/*` at `^2.9.1`. `tldraw` 5.6.1 declares `@tiptap/*` at `^3.12.1`.

**Verified**: how the parent holds the 3.x ceiling today. Three mechanisms:

1. `tests/guards/dependency-risk-review.test.ts` line 158 lists `tldraw: { major: 3 }` in its `REVIEWED` map. The tests at lines 191–203 assert that `tldraw` stays in `dependencies` and that the major of its declared range in `package.json` equals 3. This is exact equality, so it is a ceiling as well as a floor. It reads `package.json`, not the lockfile.
2. `.github/dependabot.yml` lines 165–166 ignore `tldraw` `>=4.0.0`. Lines 203–204 ignore `@tiptap/core` `>=3.0.0`, because a security update to tiptap would otherwise move tldraw two majors (lines 171–183).
3. `tests/guards/tiptap-proto-merge-is-fixed.test.ts` lines 131–153 expect tldraw's own tiptap copy to be among those it checks. `.github/dependabot.yml` lines 154–158 count this as the second guard that refuses a 4.x tree.

The ceiling costs one audit exemption.

- `security/audit-allowlist.json` lines 50–59 exempt GHSA-cp6q-959q-f8rh on `@tiptap/core`, with `reviewBy` 2026-12-31. The exemption exists because tldraw 3.x depends on tiptap 2.x.
- `docs/dependency-risk-review.md` lines 454–458 say the ceiling, the Dependabot hold and the exemption retire together on the day a commercial licence exists.
- Lines 460–464 say that forcing tiptap 3 under tldraw 3 through `overrides` was tested. It silently broke the second rich-text edit session.

**Verified**: Excalidraw.

- `@excalidraw/excalidraw` 0.18.1 is the latest release (npm, published 2026-04-20). Its `package.json` says `"license": "MIT"`.
- The npm tarball holds no LICENSE file. The `LICENSE` at the repository tag `v0.18.1` is the MIT licence, "Copyright (c) 2020 Excalidraw".
- It is still a 0.x release.
- **Not checked:** the licences of its dependencies.

**Not verified:** tldraw's prices, and what its commercial licence includes. This environment's network proxy refused `tldraw.dev`. Under D3 neither matters today.

### The Dub and Nucleo finding

**Verified**, from `docs/porting/licence/dub-nucleo-finding.md` (measured on 2026-11-18 at inflect-compliance commit `5528464`; the script is `docs/porting/licence/dub-overlap.py`), and from a read-only clone of `github.com/dubinc/dub` at commit `6b463b4bdd9ed2fd9aa416f67b5b77d317b1471e` (2026-10-26):

- Dub's `LICENSE.md` opens "Copyright (c) 2024-present Dub Technologies, Inc." Files under two `(ee)` folders of `apps/web` are under a separate licence. "Content outside of the above mentioned directories … is available under the 'AGPLv3' license." `@dub/ui` and `@dub/utils` declare no licence of their own, so the repository licence governs them.
- Section 13 of that AGPL text ("Remote Network Interaction") requires a modified version to offer its Corresponding Source to "all users interacting with it remotely through a computer network".
- Dub ships Nucleo icons with a `README.md` that inflect-compliance copied verbatim into `packages/ui/src/components/ui/icons/nucleo/README.md`: "Copyright © Nucleo", "Redistribution of icons is prohibited." and "Icons are restricted for use only within the product they are bundled with."
- Normalised-line overlap between inflect-compliance's UI files and Dub's `packages/ui` and `packages/utils`: **368 of 597 inflect UI files share at least 50% of their normalised lines with Dub.** That count includes the 270 Nucleo icon files, 62 of the 63 other `packages/ui` icons, 12 of 56 non-icon `packages/ui` files (charts, hooks), 17 of 184 non-icon `src/components/ui` files and 7 of its 9 icons. None of the 15 `src/lib/hooks` files reaches 50%.
- The engines Islestone plans to take (tasks, automation, agentic, MCP, canvas) show no overlap. Of the roughly 2,600 other files under `src/`, one reaches 50% (`src/lib/http/fetch-with-retry.ts`, 75%).
- inflect-compliance's own documents call this code "Dub-ported" or "Dub-originated". No `NOTICE`, attribution or licence assessment in inflect-compliance records Dub's licence or Nucleo's notice.
- Caveat, from the finding: line overlap shows shared text, not who wrote it first. A few files (`label`, `form`, `slider`) also resemble shadcn/ui (MIT). The icons, charts, filter system and date picker are Dub's own work.

## Decision

### D1 — Islestone's right to use inflect-compliance code: copying is allowed

**Decision: code may be copied from inflect-compliance into Islestone.** Owner decision, 2026-11-18. The owner's words: "inflect compliance is my software, it's in the same Organization- you can copy".

- **Basis.** The owner states that inflect-compliance is their software. Both repositories sit in the same GitHub organisation: inflect-compliance's remote is `github.com/RodnaPamet/inflect-compliance` (**Verified**), and Islestone's `LICENSE` names `github.com/RodnaPamet/islestone`. Under D2, Islestone's licensor is Inflect Ltd., which is also inflect-compliance's licensor. Of the drafted options this is closest to 1a ("Islestone is a product of Inflect Ltd.").
- **Signed reference.** No separate grant document was produced. The owner's decision in the working session of 2026-11-18 is the authority, and this ADR records it.
- **How copying is done:** the copy rule below. It replaces the interim "pattern only, copy no code" rule that applied while D1 was open. That rule is retired.

Options considered and not chosen: **1b** (a written licence grant or copyright assignment from Inflect Ltd. to another owner), **1c** (relying on the Additional Use Grant alone; "competes" is undefined and a breach ends the rights to every version), **1d** (port nothing, which would turn every "port" verdict in roadmap 2.1 into a rewrite).

### D2 — Islestone's own licence: BUSL-1.1

**Decision: Islestone is licensed under the Business Source License 1.1.** Owner decision, 2026-11-18. The owner's words: "Make it BUSL as well". This is drafted option 2b; the draft had recommended 2a (proprietary) for now.

The parameters, as `LICENSE` states them (lines 10–34):

- **Licensor:** Inflect Ltd., a company registered in Bulgaria. The owner chose "Inflect Ltd." when asked.
- **Licensed Work:** Islestone, as made available in `github.com/RodnaPamet/islestone` and in each version released by the Licensor; © 2026 Inflect Ltd.
- **Additional Use Grant:** production use is allowed, except to provide to third parties a hosted, managed, embedded or software-as-a-service product or service that competes with any product or service of the Licensor. The grant names, as included, "any project-management, work-management, compliance, governance, risk, or audit-management product or service" (the owner chose "PM + compliance"). Using Islestone to manage your own organization's (and affiliates') internal projects and work, including through consultants or service providers acting solely on your behalf, is permitted.
- **Change Date:** 2030-11-18, four years after the initial version's first public availability, determined separately for each version.
- **Change License:** Apache License, Version 2.0.

`LICENSING.md` is the plain-language summary; `LICENSE` governs. Because one licensor, Inflect Ltd., licenses both repositories, the concern the draft raised under 2b (two BUSL licensors in one repository) does not arise.

Options considered and not chosen: **2a** (proprietary, `UNLICENSED`), **2c** (an OSI licence, which would have published the copied parts of inflect-compliance before their own Change Date).

### D3 — The canvas library: tldraw 3.x with the watermark

**Decision: option 3a. The canvas stays on tldraw 3.x (3.15.6), in commercial production, with the watermark visible.** Owner decision, 2026-11-18. The owner's words: "we can use the 3.x in commercial production with the watermark, it's open sourced". The draft had recommended against 3a (it preferred 3c, Excalidraw, unless a tldraw quote was acceptable).

What the decision relies on is the v3.15.6 licence text (Context, **Verified**): it grants use "in your commercial or non-commercial projects" and forbids disabling, hiding, removing or altering the watermark. That licence is tldraw's own, not an OSI open-source licence; roadmap 2.1 calls tldraw proprietary. Its terms are what bind.

Rules that follow:

- tldraw and `@tldraw/*` stay at 3.15.6, or a later 3.x release whose licence text is re-read and found unchanged. No 4.x or 5.x: their licence forbids production use without a paid key.
- The watermark stays visible. Nobody disables, hides, removes or alters it, or the key validation that governs it.
- Any distribution carries a verbatim copy of tldraw's licence.
- These follow when roadmap 4.2 ports the canvas, not before (nothing from tldraw is in the tree today):
  - a guard that pins the canvas library's major at 3 (H4), on the parent's pattern;
  - a Dependabot hold on `tldraw` `>=4.0.0` and on transitive `@tiptap/core` `>=3.0.0`;
  - an audit exemption for tiptap 2.x under tldraw, re-justified on its own evidence;
  - a licence-gate exemption for `tldraw` and `@tldraw/editor`, which declare `SEE LICENSE IN LICENSE.md`. Each entry pins `version` and cites this ADR.
- The roadmap's own Tiptap editor (sub-phase 4.1) is Tiptap 3, as in the parent (`package.json` lines 141–142 declare `@tiptap/react` and `@tiptap/starter-kit` at `^3.33.1`). It sits beside tldraw's tiptap 2.x in the same tree, as it does in the parent.

Options considered and not chosen: **3b** (a commercial tldraw key: time-limited, with a usage-data clause and renewals), **3c** (Excalidraw, MIT, at the cost of rewriting the parent's editor layer).

### D4 — Dub-derived UI and Nucleo icons: copied as they are, risk accepted

**Decision: Islestone copies inflect-compliance's UI layer as it is, including the Dub-derived files and the Nucleo icons, and accepts the licence risk.** Owner decision, 2026-11-18. The owner chose "Copy as is, accept risk" when asked.

The options put to the owner, from the finding:

1. Clean the shared package upstream, replacing the Dub-derived files with Inflect-authored or MIT/ISC-sourced code, then copy it.
2. Copy only the files with no Dub overlap into Islestone, and rebuild the rest from MIT/ISC sources.
3. Obtain licences: a commercial licence from Dub Technologies, and a Nucleo licence covering Islestone.
4. Copy as is and accept the risk. The finding did not recommend it. **This is the option chosen.**

The risk accepted, stated plainly:

- **AGPL-3.0.** It requires a work that includes AGPL code to be conveyed under the AGPL. Islestone is BUSL-1.1 (D2). Section 13 of the AGPL also reaches users who interact with a modified version over a network, which is how a SaaS is used.
- **Nucleo.** Its notice prohibits redistribution and restricts the icons to "the product they are bundled with". Committing them to Islestone's repository is redistribution outside that product.
- The same exposure exists for inflect-compliance itself, independent of Islestone.

What the decision requires:

- **`NOTICE`** carries Dub's copyright and AGPL-3.0 statement ("Copyright (c) 2024-present Dub Technologies, Inc.", AGPL-3.0 outside Dub's `(ee)` folders, source `github.com/dubinc/dub`) and the Nucleo notice ("Copyright © Nucleo"; redistribution prohibited; use restricted to the product the icons are bundled with; `nucleoapp.com/license`). Both are added in the same change that lands `packages/ui` (sub-phase 1.2). Neither is in the tree today, because no Dub-derived file or Nucleo icon is in the tree today.
- **`PROVENANCE.md`** rows for the shared UI name the Dub origin of the files the measurement links to Dub, and the Nucleo terms for the Nucleo folder, as `docs/porting/provenance-shared-ui.md` drafts.
- The Nucleo `README.md` is copied with the icons and kept.

D4 is about the Dub-derived files and Nucleo icons as they exist in inflect-compliance's UI. Taking anything from Dub's own repository, or from another Nucleo source, is not part of it and would need its own decision.

### The copy rule

This replaces the interim rule that applied while D1 was open.

1. **Copying from inflect-compliance is allowed** (D1): whole files, functions, and packages byte for byte.
2. **Every copied file gets a `PROVENANCE.md` row**: source repository and path, the commit read (`5528464fc54a8681956f3b9ce23ca9c075f0420e` for the porting maps in `docs/porting/maps/`; a later read pins its own commit), licence BUSL-1.1 with licensor Inflect Ltd., and what changed ("None" for a byte-for-byte copy). Add the row in the same pull request as the file.
3. **Keep BUSL and other licence notices on copied files.** inflect-compliance's source files carry no per-file BUSL header (Context, **Verified**). What exists is kept: a copied package's `"license": "BUSL-1.1"` field, and any notice bundled with copied material, such as the Nucleo `README.md`. Islestone's own `LICENSE` displays BUSL-1.1 for the repository.
4. **Third-party material inside inflect-compliance keeps its own terms.** Its attribution goes into Islestone's `NOTICE` in the same change as the copy: pipelock (Apache-2.0) with the AI guard (6.1), Dub and Nucleo with the shared UI (D4).
5. **Never copy code from a project the roadmap marks "inspiration only"** (roadmap 2.2), whatever D1 says.
6. **A roadmap port candidate other than inflect-compliance** follows H0: its LICENSE is re-read at the commit used and that commit is pinned in `PROVENANCE.md` before first use.
7. **A pattern learned by reading, with no code copied,** still gets a `PROVENANCE.md` row that says "pattern only, no code copied". The rows written under the interim rule stay as they are: those components were written fresh.

### Third-party licence facts (H0)

The third-party licence facts in the roadmap were checked on 2026-11-18. Re-read each one at the pinned commit at first use, and pin that commit in `PROVENANCE.md`, as hardening gate H0 requires. The tldraw and Excalidraw readings in this ADR are pinned to the tags and hashes given in the Context. The port candidates' licence checks are in `docs/porting/oss/<project>.md`, section "Licence check", and `PROVENANCE.md` lists each with the commit it was read at.

### Open questions for the owner

These remain after the decisions above.

1. The owner states that inflect-compliance is their software. Its `NOTICE` line 2 credits "contributors", and no CLA or DCO was found. Does any file Islestone will copy contain code by an outside contributor? The checkout is shallow, so authorship could not be read. Third-party-derived code is D4's subject.
2. Which Change Date does a file copied into Islestone carry: inflect-compliance's (its `LICENSE` states 2030-07-17, and each version has its own date) or Islestone's (2030-11-18)? Both are Inflect Ltd.'s to set.
3. Does tldraw 3.15.6's watermark or key check contact tldraw's servers? Not tested. Under D3 this matters for privacy.
4. `elkjs` (`EPL-2.0 OR GPL-3.0-or-later`) is not on the 0.3 allowlist. The parent's canvas uses elk for auto-layout (roadmap 4.2). Add an EPL-2.0 entry, or use dagre (MIT) only?
5. Should 4.2 add a test that the tldraw watermark stays visible? The parent has none (Context).

## Consequences

- inflect-compliance code can be copied now. The roadmap steps the interim rule held back (1.2 to 1.7, 2.1 to 2.3, 3.1, 3.3, 3.6, 4.1, 4.2, 4.4, 5.1, 5.2, 6.1, 6.2, 6.5, 6.6, 8.1 and 8.6) no longer wait for D1. The porting maps in `docs/porting/maps/` give the files and the copy order.
- Every copied file leaves a `PROVENANCE.md` row, so what was copied, from which commit and with which changes stays auditable.
- Islestone is source-available, not open source. Each version converts to Apache-2.0 on its own Change Date. Copied code stays BUSL-1.1 from the same licensor.
- `@inflect/ui`, copied as a workspace package (1.2), keeps `"license": "BUSL-1.1"`. The licence gate checks a workspace that holds an `UPSTREAM.json` (a byte-for-byte mirror) like any dependency, not as Islestone's own code, so the change that lands `@inflect/ui` also adds its exemption (`BUSL-1.1`), citing this ADR.
- A port of the AI guard carries the pipelock attribution in Islestone's `NOTICE`.
- Under D3, production shows tldraw's watermark, and the canvas gets no upgrades past 3.x. If a security fix is published only for 4.x or later, D3 has to be reopened to take it. Sub-phase 4.2 adds the H4 guard on major 3, the Dependabot hold, the tiptap 2.x audit exemption and the tldraw licence-gate exemption.
- Under D4, Islestone carries AGPL-3.0-derived code and Nucleo icons under an accepted, unresolved licence risk, from the day `packages/ui` lands. `NOTICE` names both from that day. The finding's options 1 to 3 remain open as later ways to remove the risk.
- The licence gate accepts an exemption only when the ADR it cites names the package and has an Accepted status line. This ADR names `tldraw` and `@tldraw/editor`, so their 4.2 exemptions can cite it.

## What would change this decision

- Islestone, inflect-compliance or Inflect Ltd. changes ownership, or Inflect Ltd. relicenses inflect-compliance.
- The Change Date passes for the versions Islestone holds. Those versions are then Apache-2.0.
- The owner chooses a community or self-hosted edition. Distribution widens the reach of the AGPL, Nucleo, LGPL (ADR 0007) and tldraw obligations.
- A claim from Dub Technologies or Nucleo, or advice from counsel, about D4. Or inflect-compliance cleans its UI upstream (the finding's option 1): Islestone then syncs the cleaned package, and `NOTICE` drops the entries that no longer apply.
- tldraw changes its 3.x licence, a security fix arrives only for 4.x or later, or the canvas needs a feature only a later major has. Options 3b and 3c are the alternatives.
- Excalidraw changes its licence or stops being maintained.

## References

- Roadmap (`docs/ROADMAP.md`):
  - 1 (research checked 2026-11-18);
  - 2.1 (port inventory and the two blockers);
  - 2.2 (inspiration-only projects);
  - 2.3 (Canvas row);
  - 2.5 (licence traps);
  - 3, principle 6 (every port is recorded);
  - 4 (global preamble);
  - 5, Phase 0: 0.1, 0.3 and H0;
  - 1.1 and 1.2;
  - 4.1, 4.2 and H4;
  - 6.1;
  - 7, open decisions 1 to 3, and the limits of the research.
- Islestone: `LICENSE`, `LICENSING.md`, `NOTICE`, `PROVENANCE.md`; `docs/porting/licence/dub-nucleo-finding.md` and `docs/porting/licence/dub-overlap.py`; `docs/porting/provenance-shared-ui.md`; `docs/porting/shared-ui.md`; `docs/porting/oss/`; ADR 0007 (licence exceptions).
- inflect-compliance, read-only, at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`:
  - `LICENSE`, `LICENSING.md`, `NOTICE`, `CONTRIBUTING.md`;
  - `package.json` (lines 4, 5, 18, 141–142, 205) and `package-lock.json`;
  - `packages/ui/package.json`; `packages/ui/src/components/ui/icons/nucleo/README.md`;
  - `docs/dependency-risk-review.md` (lines 14–29, 387–470);
  - `tests/guards/dependency-risk-review.test.ts`;
  - `tests/guards/tiptap-proto-merge-is-fixed.test.ts`;
  - `.github/dependabot.yml`;
  - `security/audit-allowlist.json`;
  - `src/components/processes/agent-view/AgentCanvasView.tsx`;
  - `src/components/processes/agent-flow/AgentFlowCanvas.tsx`.
- Dub, `github.com/dubinc/dub` at commit `6b463b4bdd9ed2fd9aa416f67b5b77d317b1471e`: `LICENSE.md` (sha256 `0ba48e458023946432010b4fb1adade52e89843371b42f43cca7f7cc7af6ecd2`), `packages/ui/src/icons/nucleo/README.md`.
- tldraw licence text at tags `v3.15.6`, `v4.0.0` and `v5.6.1`: `https://github.com/tldraw/tldraw/blob/<tag>/LICENSE.md`.
- Excalidraw licence at tag `v0.18.1`: `https://github.com/excalidraw/excalidraw/blob/v0.18.1/LICENSE`.
- npm registry, read 2026-11-18: `tldraw` and `@tldraw/editor` at 3.15.6, 4.0.0 and 5.6.1; `@excalidraw/excalidraw` at 0.18.1.
- Owner decisions of 2026-11-18, as given in the working session; `docs/HANDOFF.md` lists them.
