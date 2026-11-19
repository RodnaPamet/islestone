# Handoff — 2026-11-18 (paused for usage quota)

State of the roadmap work when it paused, the owner decisions taken so far, and the next
steps in order. Read this first, then `CLAUDE.md`, `docs/ROADMAP.md` and `docs/adr/`.
Delete this file when everything under "Next steps" is done.

## Owner decisions, 2026-11-18 and 2026-11-19

Given in the working session by the repository owner. The ADRs, the roadmap and the
porting maps now record them (next step 2); the last column says where.

| # | Decision | Owner's words | Recorded in |
|---|---|---|---|
| 1 | Code may be copied from inflect-compliance. Record every copied file in `PROVENANCE.md`. | "inflect compliance is my software, it's in the same Organization- you can copy" | ADR 0001 D1 |
| 2 | The canvas stays on tldraw 3.x with the watermark visible, in commercial production. | "we can use the 3.x in commercial production with the watermark, it's open sourced" | ADR 0001 D3 |
| 3 | Islestone is licensed BUSL-1.1, like inflect-compliance. | "Make it BUSL as well" | ADR 0001 D2 |
| 4 | The Dub-derived UI (see below) is copied as it is, and the licence risk is accepted. | Chose "Copy as is, accept risk" when asked | ADR 0001 D4 |
| 5 | Islestone's Licensor is Inflect Ltd., as in `LICENSE`. | Chose "Inflect Ltd." | ADR 0001 D2 |
| 6 | The Additional Use Grant's competing products are project management, work management, compliance, governance, risk and audit management, as in `LICENSE`. | Chose "PM + compliance" | ADR 0001 D2 |
| 7 | Public sign-up at `/api/auth/register` sits behind a switch: off by default in production, on in development, and an operator opens it without a code change. | Chose "Behind a switch" | ADR 0006 |
| 8 | The standard role is called **Member**. Roles: Owner, Admin, Member, Viewer, Guest. | Chose "Member" | ADR 0006 |
| 9 | Roles rank Owner > Admin > Member > Viewer > Guest, by breadth of access. A user whose role cannot be resolved falls back to Viewer, never Guest. | Chose "Owner>Admin>Member>Viewer>Guest" | ADR 0006 |
| 10 | On resume, finish Phase 0 + 1.1 first, then the steps below in order. | Chose "Finish Phase 0 + 1.1" | This file |
| 11 | sharp stays in production for image optimisation; its 14 libvips/sharp packages are exempted, each pinned to the version read. The 1.8 image carries the LGPL notice and leaves the library replaceable. | "Keep, exempt them" | ADR 0007 E1a |
| 12 | The rest of ADR 0007 as recommended: 0BSD joins the allowlist and the `tslib` exemption goes (E2b); `caniuse-lite` is exempted by name, bound to CC-BY-4.0 (E3a); no other licence is added until a dependency needs one (E4). ADR 0007 is Accepted. | "ADR 0007 as proposed" | ADR 0007 |
| 13 | A session someone other than the assignee starts on an item runs at once, within the starter's permissions; every write is a proposal routed to the assignee, who is notified and can end the session. | "Run now, assignee notified" | ADR 0003, open question 8 |
| 14 | No rung cap at `PROPOSE`: from Phase 6 a workspace owner may raise an agent's autonomy rung, within that agent's grants, as roadmap principle 2 allows. This goes against the ADR's recommendation. | "Owners may raise rungs" | ADR 0003, open question 9 |
| 15 | A session started by someone other than the work item's assignee never writes directly, whatever the rung: even where a workspace owner raised a tool to `AUTOMATIC`, its writes go to the assignee as proposals. Decision 13 wins over decision 14 for such sessions; sessions the assignee started follow the rung. | "Proposals to assignee" | ADR 0003, open question 10 (sections 4 and 9) |
| 16 | Due-date reminders land in sub-phase 2.2 with the work-item engine, not in 2.7. | "In 2.2" | `docs/ROADMAP.md` 2.2; porting maps `1.6.md` and `2.1-2.2.md` |
| 17 | Islestone's agents have no risk tier: every agent is governed by its grants and its autonomy rung alone. inflect-compliance's tier and what it drives (autonomy cap, policy-card defaults, approval count, readiness checks, re-assessment) are not ported. | "Drop it" | ADR 0003 section 4; porting maps `6.1.md` (section G, which names each replacement) and `6.2.md` |
| 18 | Automation rules get an action that starts an agent run, added in Phase 6: 5.1 ships without it, and 6.3 adds it once the agent engine and its kill switch exist. | "Add it in Phase 6" | `docs/ROADMAP.md` 5.1 and 6.3; porting map `5.1.md`, open decision 7 |
| 19 | The Unlicense joins the licence allowlist (first needed by visx's `robust-predicates`, sub-phase 1.2). Decided 2026-11-19. | "Allow the Unlicense" | ADR 0007 E6; `scripts/licence-gate.mjs` |
| 20 | Authentication: port the parent's auth layer on NextAuth v4 (option A), with the ADR's scope, pin, seam, exit criteria and contract. Decided 2026-11-19. | "Port NextAuth v4" | ADR 0004 A1 |
| 21 | SSO and SCIM wait for sub-phase 8.3. Roadmap 1.4 ports credentials, Google, Microsoft, sign-in sessions, MFA and invites. Decided 2026-11-19. | "Wait for 8.3" | ADR 0004 A2, open question 3 |
| 22 | ADR 0004's exit thresholds T1 to T3 as written (open question 2), and the parent's fail-open on a database error during the session check is kept (contract item 6, open question 4). ADR 0004 is Accepted; open questions 5 (passkeys), 6 (the maintenance claim) and 7 (the `next-auth` overrides entry) stay open, not blocking. Decided 2026-11-19. | "Accept all" | ADR 0004 A4, A5 |
| 23 | Search versus encryption: S1 now (titles, keys and unencrypted fields), until a search ADR, due before roadmap 2.7, chooses between S2 and S3. Decided 2026-11-19. | "S1 now, decide later" | ADR 0002 section 11 |
| 24 | The rest of ADR 0002 as recommended: an in-house fractional-index module with property tests (F1); a 30-day soft-delete window; depth caps of 5 levels of sub-items and 3 of goals; moving a sub-item on its own to another project is refused. ADR 0002 is Accepted. Decided 2026-11-19. | "Accept all" | ADR 0002 sections 2, 5 and 8 |
| 25 | ADR 0005 as recommended: no sync engine now (E0) with section 7's reopen thresholds; canvas persistence C1 and transport T1; TanStack Query as the client cache; item presence R1; stored Yjs state and snapshots encrypted, page text searched under ADR 0002's S1 for now; one audit entry per person per page per 10 minutes; a 60-second token lifetime, a 60-second stream re-check and the caps as written. ADR 0005 is Accepted; open questions 8 (long-lived connections on the hosting target) and 9 (offline PWA quick capture) stay open, not blocking. Decided 2026-11-19. | "Accept all" | ADR 0005 |
| 26 | The words ADR 0005 added are confirmed: change notice, collaboration server, collaboration token, page content and projection. Decided 2026-11-19. | "Accept all" | ADR 0006 (decided rows); ADR 0005 open question 11 |
| 27 | The Prisma CLI's tree: BlueOak-1.0.0 joins the licence allowlist, and `elkjs` (EPL-2.0) and the second `@visx/vendor` are exempted, pinned. Decided 2026-11-19. | "BlueOak + 2 exemptions" | ADR 0007 E7; `scripts/licence-exemptions.json` |
| 28 | `src/instrumentation.ts` may read `process.env.NEXT_RUNTIME` and nothing else raw: the Node-only startup checks move to `src/instrumentation-node.ts`, imported behind that literal, so the Edge bundle drops them. Decided 2026-11-19. | "One named exception" | `tests/guards/no-raw-process-env.test.ts`; CLAUDE.md "Rules that apply now" |
| 29 | `RATE_LIMIT_MODE` defaults to `upstash`, and production refuses to start without both Upstash values (issue #17); per-process limits are an explicit `RATE_LIMIT_MODE=memory`. The 1.5 map's "default to memory" is not taken. Decided 2026-11-19. | "Upstash + refuse" | `src/env.ts`; `docs/rate-limiting.md` |
| 30 | The CSP violation-report sink comes back with observability in 1.6; until then the policy names no report endpoint. Decided 2026-11-19. | "With 1.6" | `docs/porting/maps/1.6.md`; `docs/security-perimeter.md` |
| 31 | MIT-0 joins the licence allowlist, so `nodemailer` (10.3.1) and the mailer's SMTP transport are ported; the `next-auth` → `nodemailer` override is kept, with a guard against next-auth's email provider (ADR 0004 open question 7). Decided 2026-11-19; the owner gave the approval to the coordinator directly. Applied. | "Allow MIT-0"; "Add the override" | ADR 0007 E8; ADR 0004 question 7; `scripts/licence-gate.mjs`; `src/lib/mailer.ts` |
| 32 | FSL-1.1-Apache-2.0 joins the licence allowlist (source-available, Apache-2.0 after two years), accepted for the Sentry SDK; `@sentry/nextjs` 11.11.0 is installed and the real `sentry.ts` ported, off unless `SENTRY_DSN` is set. Decided 2026-11-19, approved as row 31. Applied. | "Allow FSL for Sentry" | ADR 0007 E9; `scripts/licence-gate.mjs`; `src/lib/observability/sentry.ts` |
| 33 | ADR 0006 gains decided rows for `Notification.body` (a notification's text, replacing the banned "Message") and `TenantNotificationSettings.bccMailbox` (a workspace's copy-to address). Decided 2026-11-19, relayed. | relayed | ADR 0006 "Notification column names — decided" |
| 34 | The mailer's log lines never carry a recipient's address: they log `hashForLookup` of each address and the template name. Decided 2026-11-19, relayed. | relayed | `src/lib/mailer.ts` (`recipientLogFields`); `tests/unit/mailer.test.ts` |
| 35 | A key rotation (master key or workspace DEK) re-resolves the person who started it when the job runs. Still an ACTIVE member holding the route's key: it acts as them. Otherwise it still finishes, as the workspace system user, and its audit entries and result record who asked (`requestedByUserId`), `authority: 'SYSTEM'` and the refusal; a departed person is never named as the actor. The owner-decided exception to the job-identity rule. Decided 2026-11-19, relayed. | relayed | `src/app-layer/jobs/rotation-actor.ts`; CLAUDE.md ("Job identity"); `docs/encryption.md` ("Who a rotation acts as") |
| 36 | The master-key rotation is OWNER-only: its route, rule and policy use `admin.tenant_lifecycle`, as the DEK rotation does (inflect-compliance admitted ADMIN). Decided 2026-11-19, relayed. | relayed | `src/lib/security/route-permissions.ts`; `src/app-layer/policies/admin.policies.ts`; `docs/encryption.md` |
| 37 | Creating the workspace system user is audited: one `SYSTEM_USER_CREATED` entry, as the system actor, in the same transaction as the insert; a later call that finds the row writes nothing. Decided 2026-11-19, relayed. | relayed | `src/app-layer/context-system.ts` (`ensureTenantSystemUser`); `docs/audit-trail.md` |

`LICENSE`'s Change Date, 2030-11-18, follows the BUSL four-year rule from today; it was
not asked separately.

Decisions 7 to 9 are in ADR 0006 (vocabulary), and reach `src/lib/permissions.ts` and
the register route when 1.4 is ported. The 1.3 and 1.4 maps (`docs/porting/maps/`) now
say `MEMBER`, the decided role order, the Viewer fallback and the sign-up switch.

Decisions 13 and 14 left one question between them, recorded as ADR 0003 open question
10: when a tool has been raised to `AUTOMATIC`, does a session a non-assignee started
still send that tool's writes to the assignee as proposals? Decision 15 answers it: yes,
such a session's writes go to the assignee as proposals at any rung.

Map housekeeping: `1.5.md` has a "Handoff to 1.6" section, listing what 1.5 already
places in `metrics.ts`, `tracing.ts`, `edge-logger.ts` and `instrumentation.ts`. Copy it
into `1.6.md` before porting 1.6.

## Finding: Dub (AGPL-3.0) and Nucleo in inflect's UI

`docs/porting/licence/dub-nucleo-finding.md` has the measurement (script:
`docs/porting/licence/dub-overlap.py`). In short, 368 of inflect's 597 UI files share at
least half their text with Dub's `packages/ui`/`packages/utils`, which are AGPL-3.0. That
count includes 270 Nucleo icons whose notice forbids use outside the product they shipped
with. The engines (tasks, automation, agentic, MCP, canvas) show no overlap. The owner
accepted the risk (decision 4), and ADR 0001 D4 records it. `NOTICE` names Dub and Nucleo
in the change that lands `packages/ui` (next step 3); it says so already.

## Branches

- `main` was created at `449fb38` (the roadmap only), on the owner's go-ahead, and exists on the remote.
- Draft PR #1 (https://github.com/RodnaPamet/islestone/pull/1) merges
  `claude/great-planck-57ljb4` into `main`, so CI runs. `ci.yml` runs only on pull
  requests and on pushes to `main`. PR #1's first completed CI run was green, on
  `3ffb78a` (an earlier run, on `6f57a59`, was cancelled by the next push).
- The owner sets `main` as the default branch and protects it, requiring a pull request
  and the CI checks.
- Merge PR #1 only when its CI is green.

## What is on the branch

`claude/great-planck-57ljb4`:

- `449fb38` — the roadmap.
- `0bf9582` — Phase 0 + 1.1 skeleton, checkpointed during its review loop: app skeleton,
  env modules, licence gate, CI, ADRs 0001–0006 as drafts.
- `c7d1123` adds:
  - `LICENSE` and `LICENSING.md` (BUSL-1.1);
  - the shared-UI drift tooling (`scripts/ui-drift.mjs` with `verify`, `audit`, `compare`
    and `pin`, plus `tests/unit/ui-drift.test.mjs`, run with `npm run test:scripts`)
    and `docs/porting/shared-ui.md`;
  - the porting maps (`docs/porting/maps/`), the open-source studies (`docs/porting/oss/`)
    and the Dub finding (`docs/porting/licence/`).
- Later commits carry the rest of the Phase 0 + 1.1 work (`3ffb78a` had the first
  completed CI run, green), refresh the porting maps, and record the owner decisions
  (next step 2).

## What is not on the branch

- **`packages/ui` (the 397-file `@inflect/ui` copy).** Recreate it exactly with:

      node scripts/ui-drift.mjs pin /path/to/inflect-compliance --ref 5528464fc54a8681956f3b9ce23ca9c075f0420e

  This was checked: it reproduces the held copy, `UPSTREAM.json` included. Until then the
  last test in `ui-drift.test.mjs`, which checks the real `packages/ui`, is skipped; the
  skip asserts that nothing in the repository expects the package yet (no git-listed file
  under `packages/ui`, no lockfile entry for it).
- **Porting-map verification still in progress at pause time.** The maps on the branch are
  the latest saved versions, and some were still being re-verified.

## Rules learned from the licence re-reads (H0)

Full evidence is in `docs/porting/oss/<project>.md`, section "Licence check". `PROVENANCE.md` carries each commit and licence-boundary rule in its port-candidates table, and its wording governs; the rules below are short forms. Every candidate is still UNPINNED for use: the commit is the one its licence was read at.

| Project | Licence read at | Licence | Rule |
|---|---|---|---|
| Kaneo | `fb890b4` | MIT | None on licence grounds. `packages/importers/src/plane/*` is for structure only until audited; no use of the Kaneo name or marks |
| Paperclip | `8285a81` | MIT | Take nothing from a revision that lacks `63afce369` (the LICENSE merge) as an ancestor. |
| Teable | `bd8cfc0` | `packages/` MIT since `9c77957af`; apps and plugins AGPL-3.0 | `packages/` only |
| Cal.diy | `ae027bb7` | MIT since `ab21c7f805` (AGPL before) | Only the 63 paths the study names, none of them formerly `ee/` |
| Paca | `5913718` | Apache-2.0 | Not `apps/web/public/provider-logos/`, the bundled skills content or `apps/web/src/components/ui/`; ship the Apache-2.0 text, mark modified files, re-check for a `NOTICE` at every re-pin |
| circle | `b0ba7dd` | MIT | None on licence grounds. Vendored code under other holders needs its own notice; not `components/common/settings/integration-logos.tsx` or the paid BaseUI variant |
| SVAR Gantt | `24f381a` / `ba70128` (v2.8.3) | MIT from v2.4.3; GPL-3.0 before | Pin 2.4.3 or later; never copy from earlier commits |
| jira-auto-scheduler | `39323ed` | MIT | None on licence grounds. Not the vendored `public/can.js`, `public/json-logic/` or `public/dist/` files, nor Bitovi's name and images; the study recommends pattern only |

## Next steps, in order

1. **Finish Phase 0 + 1.1.** Done on the branch: the skeleton is there, and PR #1's first
   completed CI run, on `3ffb78a`, was green. Roadmap 0.2's "Done when: five ADRs merged"
   PR #1 merged on 2026-11-19. Roadmap 0.2's five ADRs: 0001, 0002, 0004, 0005 and 0007
   are Accepted; 0003 and 0006 record the owner's decisions in place and stay Proposed for
   their remaining open questions.
2. **Record the owner decisions.** Done. What landed:
   - ADR 0001 is Accepted. It records D1 (copying allowed), D2 (BUSL-1.1, licensor
     Inflect Ltd.), D3 (tldraw 3.x with the watermark) and a new D4 (Dub/Nucleo taken as
     is, risk accepted, with the finding's numbers). Its interim "pattern only" rule is
     replaced by the copy rule: copy, record each file in `PROVENANCE.md`, keep the BUSL
     and other licence notices.
   - ADR 0007 is Accepted (decisions 11 and 12). ADR 0003 records decisions 13 and 14 in
     place; ADR 0006 records decisions 7 to 9. Both stay Proposed, because their other
     open questions are unanswered. ADRs 0002, 0004 and 0005 were
     Accepted on 2026-11-19 (decisions 20 to 26).
   - `package.json` says `"license": "BUSL-1.1"`.
   - The licence gate allows 0BSD, the `tslib` exemption is gone, an exemption must cite
     an Accepted ADR that names the package, and a workspace holding `UPSTREAM.json` is
     checked like any dependency.
   - `CLAUDE.md`, `PROVENANCE.md` (the copy rule; the port candidates with the commit each
     licence was read at and its licence-boundary rule; rows for the patterns the ADRs
     adopt), `NOTICE`, `LICENSING.md`, `README.md`, and `docs/ROADMAP.md` 0.1 and section 7.
   - Since then: the porting maps and OSS studies no longer call copying forbidden or
     ADR 0001 unsigned (1.3, 1.4, 1.5, 1.6, 1.7, 2.1–2.2, 2.3, 5.1, and the Cal.diy, Paca
     and SVAR studies; 6.1 and 6.2 arrived already corrected), and the 1.3 and 1.4 maps
     carry the ADR 0006 role decisions.
   - Decisions 15 to 18: ADR 0003 records 15 (open question 10) and 17 (no agent risk
     tier) in place and stays Proposed; `docs/ROADMAP.md` records 16 (under 2.2) and 18
     (5.1's prompt drops the agent-run action, 6.3's prompt and a bullet under it add it); the
     1.4, 1.6, 2.1–2.2, 5.1, 6.1 and 6.2 maps follow them; `README.md` and `CLAUDE.md`
     qualify the rung summary for decision 15, and `CLAUDE.md` says where decisions are recorded.
3. **Land the shared UI (1.2 part A).** Done, in PR #2. `packages/ui` is pinned and verified;
   `.gitattributes`, the root dependencies, `typecheck:ui`, the Jest mapper and jsdom
   `testMatch`, the env guard's workspace resolution and CI's `Shared UI` job are in;
   `NOTICE` carries the Dub and Nucleo notices; `PROVENANCE.md` lists all 397 files and
   marks the 74 Dub-derived and 270 Nucleo ones; `@inflect/ui` and `@visx/vendor` are
   exempted. Two consequences: the root `tsconfig.json` no longer sets
   `noUncheckedIndexedAccess` (the package fails it, and inflect does not use it), so the
   maps' "noUncheckedIndexedAccess fix" edits are no longer needed; and the owner added the
   Unlicense to the allowlist (ADR 0007 E6, 2026-11-19) for visx's `robust-predicates`.
   Add the new `Shared UI` check to the `main` ruleset.
4. **1.2 part B (the GENERIC `src/components/ui` files).** Done, on branch `wt/partb`
   (not pushed). Following `docs/porting/maps/1.2.md` B0 to B12:
   - 130 code files copied to inflect's paths under `src/`: 127 byte-identical
     mirrors (the 106 GENERIC files the map copies, the 14 required MIXED files,
     `radio-group.tsx`, `format-bytes.ts`, `text-utils.ts`, `filters/filter-presets.ts`,
     the two MIXED `hooks/__tests__` tests, and `src/types/tanstack-table.d.ts`, which
     the map missed) and 3 forks (the `charts/index.ts` and `icons/index.tsx` stubs,
     and `ui-storage.ts` with `UI_STORAGE_PREFIX = 'islestone'`). The map's optional
     MIXED files, `dashboard-widgets/{index,types,TargetLine}` and everything SKIP or
     COUPLED are not taken.
   - The second manifest is `ui-mirror.json`, checked by `scripts/ui-mirror.mjs`
     (`verify`, `audit`, `compare`, `pin`) in CI's `Shared UI` job
     (`docs/porting/shared-ui.md`, "Part B").
   - `src/styles/tokens.css` (the 47 contract tokens and the section 6.1 extras, light
     and dark), the Tailwind theme keys as `@theme` in `src/app/globals.css` with the
     section 6.4 recipes, next-intl with the section 6.6 keys in `messages/en.json`,
     the jsdom Jest settings of section 5.1, the two Radix overrides, and the section 4
     dependencies at the map's versions (all on the licence allowlist).
   - 111 tests copied under `tests/`: 102 from section 5.2 (one, `modal-fly-in`,
     repointed from `tailwind.config.js` to `globals.css`) and 9 from 5.3 with their edits.
   - `/gallery` renders the main primitives in both themes, with a rendered test and a
     Playwright smoke test.
   - `PROVENANCE.md` ("Copied: generic UI") lists every copied file and names the Dub
     origin of the 14 the measurement links to Dub (13 primitives and `icons/icon-type.ts`;
     the other files step 4 named, `charts/funnel-chart.tsx`, `form.tsx`,
     `number-stepper.tsx`, `slider.tsx` and the `dub-*` and `plan-feature-icons` icons,
     are not copied). `NOTICE`'s Dub entry now covers `src/components/ui`.
   Open for the owner: Islestone's brand palette (the tokens are an unbranded
   placeholder), and whether the theme should follow the OS colour scheme before the
   1.7 theme provider. Add the `Shared UI` check to the `main` ruleset if not yet done.
5. **Ports 1.3–1.7, then 2.1–2.3, 5.1, 6.1 and 6.2.** Follow their maps in
   `docs/porting/maps/`. Each map gives the files, what to cut, the npm packages and the
   tests that come along, and the copy order. Every copied file gets a `PROVENANCE.md` row
   pinned to `5528464fc54a8681956f3b9ce23ca9c075f0420e`.
   **1.3 (tenancy and data core) has landed**: the Prisma 7 schema and the tenancy
   migration with RLS and both last-owner triggers, `runInTenantContext`,
   `RequestContext`, `getTenantCtx`, the stubs for 1.4, the `integration` Jest project and
   the CI `Integration` job (`PROVENANCE.md`, "Copied: tenancy and data core"). Two owner
   items came out of it: ADR 0006 W1 (`Tenant`/`tenantId` in code) is applied but not
   signed, and the `prisma` CLI's dependency tree fails `npm run licence:check`
   (`elkjs` EPL-2.0 and `@visx/vendor` 4.0.0-alpha.0 through Prisma Studio, `graceful-fs`
   4.2.12 BlueOak-1.0.0), which needs an ADR 0007 decision; no exemption was added (decision 27 since
   settled it).
   **1.4 (auth, members, invites, permission set) has landed** on branch `wt/p14` (not
   pushed), by `docs/porting/maps/1.4.md` (`PROVENANCE.md`, "Copied: auth, members and
   permissions"):
   - NextAuth v4.24.15 behind one seam (ADR 0004 A3): only the files in
     `NEXT_AUTH_SEAM` (`eslint.config.mjs`) load `next-auth`, enforced by
     `local/next-auth-single-seam` and held equal to the real importers by
     `tests/guards/auth-stack-pinning.test.ts`. Credentials, Google and Microsoft (each
     OAuth provider only when configured), `UserSession` rows with revocation, the
     fail-open session check (contract item 6), per-workspace MFA, the password policy
     and breach check, invites (tenant and organization), custom roles, and the edge
     tenant-access gate. SSO, "Enforce SSO", SCIM and the Entra rules wait for 8.3.
   - The new `PermissionSet` (twelve PM domains) and the five roles; GUEST is not
     assignable yet. `TenantCustomRole` stores `grantsJson` (ADR 0006 bans
     "Permissions" in identifiers).
   - `requirePermission` with audited denials; `getTenantCtx` and
     `getTenantServerContext` restore the MFA gate through one module. The audit log,
     observability and mailer are stubs at their final paths until 1.5 and 1.6 (an
     audit entry is a log line).
   - Public sign-up behind `AUTH_PUBLIC_SIGNUP` (ADR 0006): closed in production by
     default, open in development; the invite path of the register route stays open.
   - The auth migration adds six tenant tables with RLS, tenant-leading indexes and
     two-tenant tests; the login, invite, password, MFA, account and picker pages, and a
     placeholder workspace page at `/t/<slug>` that 1.7 replaces.
   Open for the owner: whether `/` and `/gallery` stay public (they are, as before 1.4);
   a seed tenant for E2E (roadmap 1.8 or H1); ADR 0004 open question 7 (the `next-auth`
   overrides entry for nodemailer) is still open, and no override was added.
   **1.5a (the security perimeter) has landed** on branch `wt/p15` (PR #16, not pushed
   from this session), by `docs/porting/maps/1.5.md` (`PROVENANCE.md`, "Copied: security
   perimeter"):
   - Field encryption with per-workspace DEKs (`Tenant.encryptedDek`, wrapped in the
     register transaction), fail-closed decryption, and a one-entry manifest
     (`TenantSecuritySettings.auditStreamSecretEncrypted`). Production refuses to start
     without a real `DATA_ENCRYPTION_KEY` (schema and startup check).
   - The PII extension: `User.email` and `name` hold ciphertext under their own names
     (ADR 0006 forbids `@map`), every lookup is by `emailHash`, nullable in the schema and
     NOT NULL in the database (one residue line); `Account` tokens dual-written. The
     migration refuses a database with existing `User` rows.
   - The hash-chained `AuditLog` and `OrgAuditLog` (`subjectUserId`, ADR 0006 bans
     "Target") with immutability triggers and SELECT/INSERT-only grants, `AuditOutbox`,
     the erasure record, `logEvent` writing real rows from every 1.4 mutation, the audit
     stream through `safeFetch`, and `scripts/verify-audit-chain.ts`.
   - The edge read and auth rate-limit tiers, and issue #17: production refuses
     `RATE_LIMIT_MODE=upstash` (the default) without both Upstash values.
   - A per-request nonce CSP (request-header and `__webpack_nonce__` bridges), CORS,
     sanitisation profiles, the egress allowlist, and secret detection (Husky hook plus
     `tests/guards/no-secrets.test.ts`).
   - Docs: `docs/encryption.md`, `docs/audit-trail.md`, `docs/rate-limiting.md`,
     `docs/security-perimeter.md`.
   Left for **1.5b**, after 1.6 brings the job queue: the master-key and per-tenant DEK
   rotation jobs and routes, `scripts/rotate-global-pii.ts` and the audit-outbox drain.
   Decided on review (rows 28 to 30): the startup checks are in
   `src/instrumentation-node.ts`, behind a literal `process.env.NEXT_RUNTIME` branch, so
   `next build` no longer warns; `upstash` stays the default with the production refusal;
   the CSP violation-report sink is ported in 1.6. The 1.4 integration suites now read
   real audit rows and the recorder is gone (issue #18). 1.5b is issue #19. 1.6 is next.
   **1.6 (jobs, notifications and observability) has landed** on branch `wt/p16`, by
   `docs/porting/maps/1.6.md` (`PROVENANCE.md`, "Copied: jobs, notifications and
   observability"):
   - The BullMQ queue (`islestone-jobs`), the executor registry with two jobs
     (`health-check` every 2 minutes, `notification-outbox-flush` every 10), the worker,
     scheduler and healthcheck scripts and their esbuild bundle (`npm run build:worker`),
     `NonRetryableJobError`, the heartbeat, and the per-workspace system user
     (`sys_<tenantId>`, refused by CHECKs as a sign-in, membership or session). Production
     refuses to start without an authenticated `REDIS_URL`; Redis runs `noeviction`.
     `docs/jobs.md`.
   - Notifications: `Notification`, `NotificationOutbox` and `TenantNotificationSettings`
     (RLS, two-workspace test; no DELETE for `app_user` on the last two), the outbox with
     its claim-before-send lease, the due-digest dispatcher, the two bell writers with
     in-app mutes, the bell routes and SSE stream, the settings routes and a workspace
     drain. Mail goes through SMTP when `SMTP_HOST` is set, else to the console sink.
     `docs/notifications.md`.
   - Observability: the OpenTelemetry SDK (off unless `OTEL_ENABLED=true`), the metrics
     and fifteen business KPIs, job trace propagation, web vitals, shutdown handlers with
     the audit-stream flush, the `observable-gauge-rebinds` lint rule, and Sentry
     (server-side, off unless `SENTRY_DSN` is set). `docs/observability.md`.
   - The CSP violation sink (`/api/security/csp-report`, the legacy `/api/csp-report`
     delegating in-process), `report-uri` and `report-to` in the policy, and the three
     beacons as `MACHINE_CALLER_PREFIXES` (row 30).
   - CI: a Redis service in Integration and E2E, and the worker bundle in Build.
   Owner decisions 31 to 34 (2026-11-19) are applied: MIT-0 and FSL-1.1-Apache-2.0 on the
   licence allowlist (ADR 0007 E8, E9), the SMTP transport and the Sentry SDK, the
   `next-auth` override (ADR 0004 question 7), the column names in ADR 0006, and a
   mailer that logs only address hashes. Open: whether to initialise Sentry in the
   browser (the source never did; it would be a new data flow for the sub-processor
   register). 1.5b (issue #19) can now use the queue; 1.7 is next.
   **1.5b (key rotation and the audit-outbox drain) has landed** on branch `wt/p15b`
   (issue #19, not pushed from this session), by `docs/porting/maps/1.5.md`
   (`PROVENANCE.md`, "Copied: rotation and outbox drain"):
   - `rotateTenantDek` restored in `tenant-key-manager.ts` (byte-identical to the source
     again), and three jobs: `key-rotation` (master key: re-wrap the workspace DEK,
     re-encrypt its `v1:` values and the outbox recipient), `tenant-dek-rotation` (the
     per-workspace DEK sweep, with progress) and `audit-outbox-flush` (every five minutes,
     oldest event first). The two rotations are on-demand jobs; `scripts/rotate-global-pii.ts`
     sweeps `User` and `Account`.
   - `POST`/`GET /api/t/<slug>/admin/key-rotation` and `/admin/tenant-dek-rotation`,
     both `admin.tenant_lifecycle` (OWNER-only, row 36), with their
     route-permission rules; the logic is in `usecases/key-rotation.ts`. A second DEK
     rotation while a sweep is in flight is a 409. No admin page yet (1.7).
   - The raw-SQL audit guard now reads whole statements and refuses an interpolated table
     outside a named exception. It found `ensureTenantSystemUser`'s raw `INSERT INTO
     "User"` (1.6), now listed with its reason and audited (row 37).
   - Docs: `docs/encryption.md` (both runbooks), `docs/audit-trail.md` ("The drain"),
     `docs/jobs.md`.
   The three questions this left open were decided on 2026-11-19 (rows 35 to 37) and
   are applied: a rotation re-resolves its initiator and, if they no longer resolve,
   finishes as the workspace system user with who asked recorded; the master-key
   rotation is OWNER-only; creating the system user writes `SYSTEM_USER_CREATED` in the
   same transaction. The API-key liveness check in `key-rotation` returns with 5.2.

   **1.7 (application shell) has landed** on branch `wt/p17`, by
   `docs/porting/maps/1.7.md` (`PROVENANCE.md`, "Copied: application shell"):
   - The shell: `AppShell` on `AppShellFrame` with the sidebar (`SidebarNav`, navigation
     from the fresh `nav-config.ts`: My Work, Inbox, Projects, Views, with Settings as the
     footer gear behind `mayOpenSettings`), the top chrome (brand `IS`, environment badge,
     breadcrumbs, workspace switcher, the bell on the workspace routes, the account menu
     with the theme toggle) and the mobile drawer. The page shells `EntityListPage`,
     `EntityDetailLayout` and `DashboardLayout`, with `ListPageShell`, `PageHeader` and
     `FilterToolbar`.
   - The command palette (`mod+k`, navigation and actions; entity search off until 2.7
     ships `/api/t/:slug/search`), the shortcut help (`mod+/`), the theme provider and
     pre-paint script, the back-affordance libraries, root providers, layout, error and
     not-found pages. `docs/app-shell.md`.
   - The real `TenantProvider` at `@/lib/tenant-context-provider` (its URL builders fall
     back to the route's slug outside it), and `OrgProvider`.
   - Routes: `src/app/t/[tenantSlug]/(app)/layout.tsx` merges the source's two tenant
     layouts (session, `getTenantServerContext` with its MFA gate and 404, provider,
     shell). The MFA challenge and enrolment pages moved to `(mfa)`, outside it, because a
     session owing a code must reach them. Placeholder pages for every nav target; the
     workspace root and `tenantLandingPath` go to My Work; `/` goes to `/tenants` or
     `/login`.
   - `swr` 2.5.1 (MIT) for the session seam's `SWRConfig`. The nav tokens, keyframes,
     `.icon-btn` and a reduced-motion rule joined `tokens.css` / `globals.css`.
   Owner decisions this step did not take, listed for the owner:
   - **Following the OS colour scheme.** inflect-compliance follows `prefers-color-scheme`
     until a member chooses, with a dark default. Islestone keeps light as the default and
     does not read the OS (`ThemeProvider`, `THEME_INIT_SCRIPT`); turning it on is the
     `matchMedia` read and its listener, both noted in the provider's header.
   - **Islestone's brand mark.** No `src/app/icon.svg` or favicon ships (the source's are
     Inflect's); the top chrome and sidebar use the initials `IS` on the placeholder
     brand gradient.
   - **The palette's Settings row** shows for every member (the palette sits above the
     workspace provider); the page answers a 404 to a member who may not open it. Whether
     to hide the row is open.
   - **The MFA enrolment page outside the shell.** `/t/<slug>/security/mfa` renders
     without the sidebar, as in 1.4, because it must also serve a session that owes a
     code. Whether an enrolled member should reach it inside the shell is open.
   Not ported now: `back-affordance-no-cycles` (no subpages yet, so it would check
   nothing; 2.3 brings it with the first detail page), `docs/keyboard-shortcuts.md`,
   `docs/i18n.md` and `docs/epic-52-list-page-shell.md` (distilled into
   `docs/app-shell.md`), `@axe-core/playwright` (the a11y checks are jest-axe).
