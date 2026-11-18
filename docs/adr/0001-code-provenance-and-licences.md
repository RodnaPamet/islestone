# 0001 — Code provenance and licences

Status: Proposed — awaiting owner sign-off (2026-11-18 drafted)

## Context

Islestone plans to reuse a large part of inflect-compliance (roadmap section 2.1). Before any of that code can enter this repository, three things must be settled:

- **D1.** Islestone's right to use inflect-compliance code.
- **D2.** Islestone's own licence.
- **D3.** The canvas library: tldraw, which is proprietary, or Excalidraw.

This ADR records what the files say, the options for each decision, and a recommendation for each. **None of the three decisions is made.** Each one waits for the owner's sign-off. Until D1 is signed, the interim rule below applies.

How to read this ADR: a line marked **Verified** was read in the named file on 2026-11-18. Everything else is a recommendation, an inference, or an open question, and is labelled as one. This ADR is not legal advice.

### What was read

- **Verified.** The sibling checkout `/home/user/inflect-compliance` at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e` (2026-11-17, "chore(release): 3.404.0"). Its git remote is `https://github.com/RodnaPamet/inflect-compliance`.
- **Verified.** The clone is shallow (50 commits), so the history of its `LICENSE` file could not be read.

### The parent's licence: BUSL-1.1

**Verified**: the licence declarations.

- `package.json` line 5: `"license": "BUSL-1.1"`. Line 4: `"private": true`.
- `packages/ui/package.json` line 5: `"license": "BUSL-1.1"`. The shared UI package that roadmap 1.2 plans to copy byte for byte is under the same licence.
- `LICENSE` line 1: "Business Source License 1.1".

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

**Verified**: third-party material inside inflect-compliance. A port would carry its obligations with it.

- `NOTICE` lines 7–19: the AI guard's rule taxonomy in `src/app-layer/ai/guard/` is adapted from pipelock, under Apache-2.0. A port of the guard (roadmap 6.1) carries that attribution.
- `NOTICE` lines 52–77: six files under `.claude/skills/` are redistributed copies of NVIDIA/OpenShell files, under Apache-2.0.
- `LICENSING.md` lines 42–46: libvips (LGPL), elkjs (EPL-2.0) and FSL-licensed build tools.
- `package-lock.json`: `elkjs` 0.12.1 is recorded as `EPL-2.0 OR GPL-3.0-or-later`. `@dagrejs/dagre` 3.1.3 is `MIT`.
- `package.json` line 18: the parent's own gate, `license:check`, fails on AGPL, SSPL, BUSL-1.1 and Commons Clause. It excludes three packages: `inflect-compliance` itself, `@inflect/ui` and `@rodnapamet/scanent-contract` 0.16.0.

### What the BUSL grant allows Islestone, and what it does not

This is a plain reading of the text above. It is not a legal opinion.

The licence allows, without asking anyone:

- Reading the code and learning its design.
- Copying, modifying, making derivative works and redistributing, for **non-production** use (lines 44–46).
- Production use, but only inside the Additional Use Grant.

The licence does not allow, or does not clearly allow:

- **Islestone's production use.** Islestone is a SaaS offered to third parties. The grant forbids that when the service "competes with any product or service offered by the Licensor". The licence does not define "competes". It covers "any" product of the Licensor, and that list can change. So the text alone cannot tell us whether Islestone is inside the grant.
- **Choosing Islestone's own licence for ported code.** Copies and derivative works stay under BUSL-1.1 with Inflect Ltd.'s parameters (lines 60–63). Only the copyright holder can let Islestone license them differently.
- **Leaving out the notice.** Every copy must display the BUSL licence (lines 65–66).
- **Safety on breach.** A breach ends the rights to every version, not just the one copied (lines 70–72).
- **Using Inflect Ltd.'s names or logos** (lines 74–76).
- **Help from the Change Date.** The stated date is 2030-07-17. Islestone needs the rights now.

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

**Not verified:** tldraw's prices, and what its commercial licence includes. Roadmap 2.1 says "price by quote" and says nothing about tldraw sync. The vendor's own pages reportedly say that tldraw sync is included in the commercial licence. This environment's network proxy refused `tldraw.dev`, so neither the price nor that claim was read.

## Decision

Each option below lists its consequences. The recommendations are proposals for the owner. They are not decisions.

### D1 — Islestone's right to use inflect-compliance code

Options:

- **1a. Islestone is a product of Inflect Ltd.** Inflect Ltd. records in writing that it owns and operates Islestone.
  - Inflect Ltd. then uses its own code and needs no licence for what it owns.
  - It must still confirm that it owns all of that code (open questions 2 and 3).
  - Islestone's licence (D2) becomes Inflect Ltd.'s choice.
- **1b. Inflect Ltd. gives a written licence grant or copyright assignment to Islestone's owner.** The document should state:
  - which repositories and versions it covers, including later versions Islestone pulls (roadmap 1.2 expects ongoing upstream sync);
  - the right to copy and modify the code, and to use it in production as a hosted service offered to third parties;
  - that the competition limit in the Additional Use Grant does not apply to Islestone's field (project management);
  - whether ported code may be licensed under Islestone's own licence (D2), or stays BUSL-1.1;
  - that it is perpetual and irrevocable, and survives a change of control of either party;
  - who carries the third-party notices (pipelock, elkjs and others).
- **1c. Rely on the Additional Use Grant alone.** Not recommended.
  - "Competes" is undefined, and the Licensor's products can change.
  - Ported code stays BUSL-1.1.
  - A breach would end the rights to every version.
- **1d. Port nothing.** The interim rule becomes permanent.
  - Every "port as is" and "port with renames" verdict in roadmap 2.1 becomes a rewrite.
  - Phase 1 grows by several weeks. This is an estimate, not a measurement.

**Recommendation:** 1a if Islestone is in fact Inflect Ltd.'s product, otherwise 1b. Copy nothing before one of them is signed (roadmap section 7, open decision 1).

Signed reference: ____

Owner sign-off: ____  Date: ____

### D2 — Islestone's own licence

Options:

- **2a. Proprietary.** `package.json` carries `"license": "UNLICENSED"` and `"private": true`.
  - This works with every D1 outcome.
  - BUSL notices stay on any ported files, unless the grant says otherwise.
  - The source is not public, and Islestone cannot be called open source.
- **2b. BUSL-1.1, like the parent,** with Islestone's own parameters.
  - Islestone would need its own Additional Use Grant, Change Date and Change License. The Change License must be GPL-compatible (`LICENSE` lines 96–101).
  - If Islestone's licensor is not Inflect Ltd., ported files keep Inflect Ltd.'s parameters, so the repository would hold two BUSL licensors.
  - The source is available but not open source.
- **2c. An OSI licence.** Apache-2.0 or MIT if permissive, AGPL-3.0 if copyleft.
  - Inflect Ltd. must relicense every ported file under it. That publishes those parts of inflect-compliance before 2030-07-17, which ends the parent's commercial window for them: a competitor could take the tenancy, auth or agent-engine code back into a compliance product.
  - tldraw, if chosen in D3, keeps its own licence. Its terms bind anyone who self-hosts Islestone.

**Recommendation:** 2a for now. Opening a licence later is easy. Publishing under an open licence cannot be undone. Revisit before general availability (roadmap 9.2), or earlier if the owner wants a community or self-hosted edition.

Owner sign-off: ____  Date: ____

### D3 — The canvas library

Needed before roadmap 4.2 starts, not before Phase 1. It also decides whether the licence allowlist in 0.3 carries a tldraw exception.

- **3a. Stay on tldraw 3.x (3.15.6) with the watermark and no upgrades.**
  - Cost: no licence fee.
  - The watermark shows in production and must not be hidden or altered.
  - No 4.x or 5.x fixes or features. Further 3.x patches are not promised.
  - Islestone would copy the parent's three mechanisms:
    - a guard that pins the canvas major at 3 (H4);
    - a Dependabot hold on `tldraw` and on transitive `@tiptap/core`;
    - an audit exemption for tiptap 2.x, re-justified on its own evidence.
  - The 0.3 allowlist needs a recorded tldraw exception.
  - Porting the parent's canvas code needs D1. The roadmap's own Tiptap editor (roadmap section 2.3, "Rich text" row; built in sub-phase 4.1) would be Tiptap 3, as in the parent, which declares `@tiptap/react` and `@tiptap/starter-kit` at `^3.33.1` (`package.json` lines 141–142). It would sit beside tldraw's tiptap 2.x in the same tree, as it does in the parent.
- **3b. Buy a tldraw commercial licence key.**
  - Cost: by quote. Not verified here.
  - Allows 5.x (5.6.1 today) and later upgrades while the licence lasts.
  - The 4.x+ licence is time-limited ("for the specified period"). If it lapses, production use is banned, and the software contains technical enforcement. Canvas availability then depends on renewals.
  - The licence says the software may send usage data to tldraw. tldraw would need assessing as a data recipient in the sub-processor register (H6) and the privacy notice (8.6).
  - The parent's three mechanisms change as follows:
    - the ceiling guard becomes a guard on the licensed major (H4);
    - the Dependabot hold goes;
    - the tiptap exemption can retire, because 5.6.1 declares tiptap `^3.12.1`. A floor check still makes sense, since that range admits tiptap 3 releases older than the 3.30.4 fix.
  - The parent's canvas code targets 3.x, so a port needs a migration to 5.x. Its size is not assessed.
  - The 0.3 allowlist records the licence, the key's term and the renewal date.
- **3c. Move the canvas to Excalidraw (MIT).**
  - Cost: no licence fee, but an engineering cost.
  - The parent's canvas binds to tldraw in 27 files, so roadmap 4.2 becomes a rewrite of the editor layer rather than a port. The parent has a test named `auto-layout-is-engine-free`, which suggests its layout code is engine-neutral. This was not verified.
  - No watermark, no key, no vendor data flow.
  - No allowlist exception, if its dependency tree passes the 0.3 gate. That tree is not yet checked.
  - Excalidraw is pre-1.0, so its API may change.
  - It reduces how much canvas code depends on D1.

**Recommendation:** ask tldraw for a quote now, because asking costs nothing. Choose 3c unless the quote's price, term and data terms are acceptable to the owner; in that case choose 3b. Do not choose 3a: it is a version dead end and it carries the tiptap exemption.

Owner sign-off: ____  Date: ____

### Interim rule (applies while D1 is unsigned)

This rule only restricts Islestone, so it needs no owner decision to start.

1. Read inflect-compliance to learn its design and patterns.
2. Copy no code from it: no file copies, no pasted functions, no verbatim blocks, no byte-for-byte package copies.
3. Write everything fresh.
4. Record each pattern adopted from inflect-compliance in `PROVENANCE.md`. Each entry gives the source path, the commit read and the words "pattern only, no code copied". If `PROVENANCE.md` does not exist yet (roadmap 0.3), the pull request lists the items, and the file picks them up when it lands.
5. Never copy code from a project the roadmap marks "inspiration only" (roadmap 2.2), whatever D1 says.
6. Every roadmap step whose Source line or prompt names inflect-compliance, or says "port" or "copy" from it, waits for D1, or runs as a fresh write under this rule. As of 2026-11-18 these are 1.2 to 1.7, 2.1 to 2.3, 3.1, 3.3, 3.6, 4.1, 4.2, 4.4, 5.1, 5.2, 6.1, 6.2, 6.5, 6.6, 8.1 and 8.6; a later roadmap edit can add more, and the rule covers them without this list changing. Roadmap 1.1's "port the env pattern" runs as pattern only.

This rule is stricter than BUSL itself, whose Terms allow non-production copying (lines 44–46). It refuses that copying anyway, for three reasons:

- Islestone code is written for production.
- Copied code stays BUSL-1.1 (lines 60–63), so it would decide D2 before the owner does.
- Removing copied code later is expensive and hard to prove complete.

### Third-party licence facts (H0)

The third-party licence facts in the roadmap were checked on 2026-11-18. Re-read each one at the pinned commit at first use, and pin that commit in `PROVENANCE.md`, as hardening gate H0 requires. The tldraw and Excalidraw readings in this ADR are pinned to the tags and hashes given in the Context.

### Open questions for the owner

1. Is Islestone a product of Inflect Ltd., or of another person or entity? This decides between 1a and 1b.
2. Does Inflect Ltd. hold the copyright in all of inflect-compliance? `NOTICE` line 2 credits "contributors". No CLA or DCO was found. A grant covers only what Inflect Ltd. owns.
3. The Licensed Work names `github.com/inflect-compliance/inflect-compliance`. The checkout's remote is `github.com/RodnaPamet/inflect-compliance`. Should the grant name both?
4. Does Inflect Ltd. consider a project-management SaaS to compete with any product it offers or plans? This matters only under 1c.
5. Which Change Date applies to the commit Islestone would read? `LICENSE` states 2030-07-17. `LICENSE` and `LICENSING.md` also say each version has its own date.
6. Should the grant cover later versions? The hash-synced copy model in roadmap 1.2 assumes continuing updates from upstream.
7. Will counsel confirm that "read for patterns, write fresh" does not create a derivative work under BUSL? This ADR assumes it does not. That is not a legal opinion.
8. What does a tldraw commercial licence cost, for how long, and what does it cover: sync, self-hosting, the number of apps or domains, the data its enforcement sends? Not readable here, because the proxy refused `tldraw.dev`.
9. Does tldraw 3.15.6's watermark or key check contact tldraw's servers? Not tested. This matters for privacy whichever tldraw option is chosen.
10. `elkjs` (`EPL-2.0 OR GPL-3.0-or-later`) is not on the 0.3 allowlist. The parent's canvas uses elk for auto-layout (roadmap 4.2). Add an EPL-2.0 entry, or use dagre (MIT) only?
11. Does tldraw still sell a 3.x "Business License" to remove the watermark?

## Consequences

- No inflect-compliance code enters Islestone until D1 is signed. Phase 1 sub-phases that plan to port must either wait or write fresh under the interim rule.
- Each pattern-only reuse leaves a `PROVENANCE.md` line, so the boundary between reading and copying is auditable.
- Under 1b, ported files keep their BUSL notice unless the grant says otherwise. `PROVENANCE.md` records the licence of each entry.
- If `@inflect/ui` becomes a workspace package (roadmap 1.2), it carries `"license": "BUSL-1.1"`. The 0.3 allowlist gate must then treat it as a recorded exception, or the gate fails on Islestone's own workspace.
- A port of the AI guard carries the pipelock attribution in Islestone's `NOTICE`.
- The D3 choice decides whether 0.3 records a tldraw exception, and what the H4 guard pins.
- Under 3b, tldraw joins the sub-processor and data-recipient review (H6, 8.6), and the licence renewal becomes an operational date.
- Under 2a, Islestone cannot be described as open source until D2 is reopened.

## What would change this decision

- Inflect Ltd. relicenses inflect-compliance, or changes its Additional Use Grant to cover Islestone. D1 might then need no separate document.
- The Change Date passes for the versions Islestone needs. Those versions would then be Apache-2.0.
- Islestone or Inflect Ltd. changes ownership.
- Counsel advises differently on "competes", or on where a pattern ends and a copy begins.
- tldraw changes its licence or its prices, or Excalidraw changes its licence or stops being maintained.
- The owner chooses a community or self-hosted edition, which reopens D2.

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
  - 4.2 and H4;
  - 6.1;
  - 7, open decisions 1 to 3, and the limits of the research.
- inflect-compliance, read-only, at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`:
  - `LICENSE`, `LICENSING.md`, `NOTICE`, `CONTRIBUTING.md`;
  - `package.json` (lines 4, 5, 18, 205) and `package-lock.json`;
  - `packages/ui/package.json`;
  - `docs/dependency-risk-review.md` (lines 14–29, 387–470);
  - `tests/guards/dependency-risk-review.test.ts`;
  - `tests/guards/tiptap-proto-merge-is-fixed.test.ts`;
  - `.github/dependabot.yml`;
  - `security/audit-allowlist.json`;
  - `src/components/processes/agent-view/AgentCanvasView.tsx`;
  - `src/components/processes/agent-flow/AgentFlowCanvas.tsx`.
- tldraw licence text at tags `v3.15.6`, `v4.0.0` and `v5.6.1`: `https://github.com/tldraw/tldraw/blob/<tag>/LICENSE.md`.
- Excalidraw licence at tag `v0.18.1`: `https://github.com/excalidraw/excalidraw/blob/v0.18.1/LICENSE`.
- npm registry, read 2026-11-18: `tldraw` and `@tldraw/editor` at 3.15.6, 4.0.0 and 5.6.1; `@excalidraw/excalidraw` at 0.18.1.
