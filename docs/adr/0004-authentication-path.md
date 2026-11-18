# 0004 — Authentication path

Status: Proposed — awaiting owner sign-off (2026-11-18 drafted)

## Context

Roadmap 2.3 (Auth row) and 0.2 item 4 propose: port NextAuth v4 with SSO, MFA and SCIM now, and plan a move to Better Auth later. Roadmap 1.4 lists what the port covers. Roadmap 9.3 lists "the move from NextAuth v4 to Better Auth, per ADR 0004". Section 7, open decision 4, leaves the choice to the owner.

This ADR records what the files and the registry say, the options, a recommendation, the criteria that would start a move to Better Auth, and what such a move must preserve. **Nothing here is decided.** Each decision waits for the owner's sign-off.

How to read this ADR: a line marked **Verified** was read on 2026-11-18 in the named file, or in the output of the named command. Everything else is a recommendation, an inference or an open question, and says so.

### What was read

- **Verified.** The sibling checkout `/home/user/inflect-compliance` at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e` (the commit ADR 0001 read).
- **Verified.** The npm registry (`npm view`, and the bulk advisory endpoint `registry.npmjs.org/-/npm/v1/security/advisories/bulk`), on 2026-11-18.
- **Verified.** Files on GitHub, read at pinned commits through `raw.githubusercontent.com`. Commits were resolved with `git ls-remote`:
  - `nextauthjs/next-auth` `main` at `a1a16a5a7780488c7449feece410033f445d0b31`;
  - `nextauthjs/next-auth` branch `v4` at `d857eec560fb99c8b18d3b22a2693b849a62d1c3`, which is also the tag `next-auth@4.24.15`;
  - `better-auth/better-auth` `main` at `36ae40b23970ab9dbbf6ce7d7c6962af57ec0007`.
- **Not read.** The Better Auth blog post linked from the Auth.js README. This environment's proxy refused `better-auth.com` (HTTP 403 on CONNECT).

### What the parent runs

**Verified**, from `package.json`:

- Line 185: `"next-auth": "4.24.15"`, exact.
- Line 108: `"@next-auth/prisma-adapter": "1.0.7"`, exact.
- Line 184: `"next": "16.4.6"`. Lines 122 and 192: Prisma `^7.10.1`.
- Line 175: `"jose": "^6.2.17"`. Line 109: `"@node-saml/node-saml": "^5.2.0"`.
- Lines 344–347: an `overrides` entry forces next-auth's `next` and `nodemailer` to the root versions. Its reason was not found. next-auth's own peer range already admits Next 16 (below).

**Verified**, from `package-lock.json`: the tree holds two `jose` majors. `jose` 6.2.17 is the parent's own. `jose` 4.15.9 sits under `next-auth` and under `openid-client` 5.7.1.

**Verified**, from `src/auth.ts`:

- Lines 1–8: the parent moved from `next-auth@5.0.0-beta.30` to v4 stable (its "GAP-04").
- `docs/implementation-notes/2026-04-25-gap-04-nextauth-v4-migration.md` gives the reason: an audit flagged a beta release on a security-critical path. The note estimated the move at about five days. It planned a later move to v5 once v5 ships stable.
- Line 686: `session: { strategy: 'jwt' }`. Line 680: the Prisma adapter.
- Providers: Google; Microsoft through v4's `azure-ad` provider, renamed to `microsoft-entra-id` (lines 395–404); Credentials (line 456); and an `sso-handoff` Credentials provider (line 51, from `src/lib/auth/sso-session.ts`).
- `src/middleware.ts` line 2 reads the session at the edge with `getToken` from `next-auth/jwt`.

### What NextAuth does, and what is the parent's own code

**Verified** by reading the named files. Most of the hardened behaviour is the parent's own code, written around NextAuth.

| Capability | Implemented by | Where |
|---|---|---|
| Google and Microsoft sign-in, with state, nonce and PKCE checks | NextAuth v4, through `openid-client` 5 | providers in `src/auth.ts` |
| Session cookie and its encryption; CSRF token on sign-in and sign-out | NextAuth v4 | `authOptions` in `src/auth.ts` |
| Account rows | `@next-auth/prisma-adapter`, plus the parent's `signIn` callback (line 722) | `src/auth.ts`, `src/lib/auth/oauth-email-trust.ts` |
| Password sign-in, lockout, timing equalisation | Parent, behind the Credentials provider | `src/lib/auth/credentials.ts` |
| Sign-in session rows and revocation | Parent | `UserSession` (`prisma/schema/auth.prisma` line 1319); `src/lib/security/session-tracker.ts`; `src/lib/auth/session-revoked.ts`; `src/auth.ts` lines 1134 and 1265 |
| MFA (TOTP), asked per workspace | Parent | `src/lib/auth/workspace-mfa.ts`, `src/lib/security/totp-crypto.ts` |
| Enterprise SSO (SAML and OIDC) | Parent, on `@node-saml/node-saml` and `jose`, handing off to NextAuth | `src/lib/security/saml-client.ts`, `oidc-client.ts`; `src/lib/auth/sso-flow.ts`, `sso-handoff.ts`, `sso-session.ts` |
| "Enforce SSO" with break-glass | Parent | `src/lib/auth/sso-enforcement.ts` |
| SCIM 2.0 | Parent | `src/lib/scim/`, `src/app/api/scim/v2/` |
| API keys | Parent | `src/lib/auth/api-key-auth.ts` |
| Edge tenant-access gate | Parent, reading NextAuth's token | `src/middleware.ts`, `src/lib/auth/guard.ts` |

**Verified**: several of these modules open with a comment describing a defect the code now fixes.

- `session-revoked.ts` lines 5–13: revocation used to sign nobody out.
- `sso-handoff.ts` lines 4–7: every SSO sign-in used to end with no session.
- `sso-flow.ts` lines 3–12: the SSO round trip allowed login CSRF.
- `workspace-mfa.ts` lines 4–8: MFA was asked only of the oldest workspace.

**Verified**: the parent's `docs/auth.md` is stale in two places.

- Line 286 says the session is "JWT-only — no server-side session table". The code has that table (`UserSession`) and checks it.
- Lines 275–278 name the cookie `__Secure-authjs.session-token`. That is the v5 name. `authOptions` in `src/auth.ts` sets no `cookies` option, so v4's defaults apply. At the `v4` tag, `packages/next-auth/src/core/lib/cookie.ts` lines 57–66 name it `__Secure-next-auth.session-token` (prefix only on secure cookies), `httpOnly: true`, `sameSite: "lax"`, `secure` on secure cookies. `sso-handoff.ts` lines 4–7 confirm v4 never reads the `authjs.` name.

Inferences from this section:

- "Port NextAuth v4" in practice means "port the parent's auth layer, which sits on NextAuth v4". The value is in the parent's code and its tests, not in NextAuth.
- The hardening is recent and was paid for in bugs. A fresh rewrite is likely to repeat some of them.
- A later move to Better Auth would replace a smaller core than the roadmap's wording suggests. The work sits at the joins: the callbacks, the token claims and the edge read.
- A port must read the code, not `docs/auth.md`.

### NextAuth and Auth.js status

**Verified** (`npm view next-auth dist-tags` and `time`):

- `latest` is `4.24.15`, published 2026-07-20. Earlier: `4.24.14` on 2026-04-14, `4.24.12` on 2025-10-27.
- `beta` is `5.0.0-beta.32`, published 2026-07-20. There are 33 v5 betas, the first on 2023-10-24. No stable v5 has been published. The roadmap's "Auth.js v5 never left beta" holds.
- `npm view next-auth@4.24.15 deprecated` returns nothing: 4.24.15 is not deprecated.
- Peer dependencies of 4.24.15: `next` `^12.2.5 || ^13 || ^14 || ^15 || ^16`; `react` `^17.0.2 || ^18 || ^19`. Islestone's `next` 16.4.6 and `react` 19.3.1 (`package.json`) are inside both ranges.
- Dependencies of 4.24.15 include `jose` `^4.15.5`, `openid-client` `^5.4.0` and `oauth` `^0.9.15`.
  - The last `jose` 4.x release is 4.15.9, from 2024-07-03. The current `jose` is 6.2.17.
  - The last `openid-client` 5.x release is 5.7.1, from 2024-11-22. The current one is 6.9.0.
  - So v4's OAuth and token code rests on superseded majors with no release in one to two years.
- `@next-auth/prisma-adapter` 1.0.7 was published 2023-06-01. Its peer range, `@prisma/client` `>=2.26.0 || >=3`, admits Prisma 7. The parent runs it on Prisma 7.
- Licence: `ISC` in the registry. `LICENSE` at the `v4` tag reads "ISC License", "Copyright (c) 2018-2021, Iain Collins" and "Copyright (c) 2021-2025, Better Auth Inc." (sha256 `2b1f629505864a12008be8f161d20542ad5eca5be9464277fb8850820b584fd8`).
- `README.md` on `main`, line 21: "Auth js is now part of Better Auth … We recommend new projects to start with Better Auth unless there are some very specific feature gaps (most notably stateless session management without a database)."
- The registry lists three maintainers for `next-auth`. One uses a `better-auth.com` address.

**Verified**: advisories on `next-auth`, from the npm advisory endpoint. Twelve affect 4.x ranges: two critical, four high, five moderate, one low. Four were fixed in the last thirteen months:

| Advisory | Severity | Affected | Fixed in | Subject |
|---|---|---|---|---|
| GHSA-7rqj-j65f-68wh | critical | `>=4.10.3 <4.24.15` | 4.24.15 | Email normaliser checks the address before Unicode normalisation |
| GHSA-xmf8-cvqr-rfgj | high | `>=4.0.6 <=4.24.14` | 4.24.15 | `getToken()` throws on a malformed Bearer header |
| GHSA-x445-f3h2-j279 | moderate | `<=4.24.14` | 4.24.15 | OAuth state, nonce and PKCE cookies not bound to their provider |
| GHSA-5jpx-9hw9-2fx4 | moderate | `<4.24.12` | 4.24.12 | Email misdelivery |

- GHSA-xmf8 touches a path the parent uses: the edge calls `getToken()`, and API keys arrive as Bearer headers.
- No advisory is returned for `next-auth` 4.24.15, `5.0.0-beta.32`, `jose` 4.15.9, `openid-client` 5.7.1 or `oauth` 0.9.15.
- Advisory publication dates were not read, so time-to-patch is not known.

**Not verified:**

- That Auth.js is "in security-only maintenance" (roadmap 2.3, marked *unverified*). The README says Auth.js is part of Better Auth and steers new projects to it. That is consistent with the claim but does not state a maintenance policy. The linked blog post could not be read.
- Any announced end-of-life date for v4. None appears in the npm metadata or in the README at the `v4` tag. Nothing further was searched.

### Better Auth status

**Verified** (`npm view better-auth`):

- `latest` is `1.7.26`, published 2026-11-18. `beta` is `1.8.0-beta.10`. `1.0.0` was published 2024-11-23.
- Licence: `MIT` in the registry. `LICENSE.md` on `main` is the MIT licence, "Copyright (c) 2024 - present, Bereket Engida" (sha256 `7a07f7d9085cb3157e4377d944988c9712933141b0f7201955ceccfac92abde4`).
- Peer dependencies include `next` `^14.0.0 || ^15.0.0 || ^16.0.0`, `react` `^18.0.0 || ^19.0.0`, and `prisma` / `@prisma/client` `^5.0.0 || ^6.0.0 || ^7.0.0`.
- The package exports plugins named `two-factor`, `organization`, `admin`, `haveibeenpwned`, `jwt`, `bearer` and `multi-session`, plus `adapters/prisma` and `next-js`.
- Separate packages exist at 1.7.26, each `MIT`: `@better-auth/sso`, `@better-auth/scim`, `@better-auth/passkey`, `@better-auth/api-key`, `@better-auth/prisma-adapter`.
- It depends on `@better-auth/telemetry` ("Telemetry package for Better Auth").

**Verified**: advisories on `better-auth`. Eighteen, all fixed in releases up to 1.6.13: two critical, eleven high, three moderate, two low. None is returned for 1.7.26. Four sit in features Islestone would use:

| Advisory | Severity | Fixed below | Subject |
|---|---|---|---|
| GHSA-xg6x-h9c9-2m83 | critical | 1.4.9 | Two-factor bypass through the session cookie cache |
| GHSA-g38m-r43w-p2q7 | high | 1.6.11 | Account takeover by OAuth auto-link to an unverified pre-registered email |
| GHSA-fmh4-wcc4-5jm3 | high | 1.6.11 | Invitation accepted on an unverified email match (organization plugin) |
| GHSA-2vg6-77g8-24mp | low | 1.6.11 | Sessions persist after user deletion, including SCIM flows |

Inferences:

- Advisory counts are not a quality score. Better Auth has a larger surface; it also ships an OIDC provider and MCP plugins.
- GHSA-g38m is the same class of defect the parent fixed in its own code (`oauth-email-trust.ts`). Changing library does not remove the need for the parent's rules and tests.

**Not verified:**

- Whether Better Auth's SSO, SCIM and two-factor plugins can express the parent's rules: an SSO session scoped to one workspace, MFA per workspace, an MFA pass bound to one sign-in session. The exports exist. Their behaviour was not tested.
- Whether `@better-auth/telemetry` sends data by default.

### The licence dependency on ADR 0001

- **Verified.** ADR 0001 decision D1 (Islestone's right to use inflect-compliance code) is unsigned. Its interim rule forbids copying, and item 6 lists roadmap 1.4 among the steps that wait for D1 or run as fresh writes.
- **Verified.** The libraries are not the problem. `next-auth` and `@next-auth/prisma-adapter` are ISC; `better-auth`, `@node-saml/node-saml` and `jose` are MIT. Roadmap 0.3 lists ISC and MIT on the allowlist.
- So the case for porting rests entirely on D1. Without the grant, option A below is not available, and every remaining option is a fresh write.

## Decision

The options and their consequences follow. The recommendation is a proposal for the owner, not a decision.

### A1 — Which path

- **A. Port the parent's auth layer, on NextAuth v4, pinned exactly.** Needs D1 (1a or 1b).
  - Fastest route to credentials, Google, Microsoft, sign-in session rows with revocation, MFA per workspace, invites, the edge gate, SSO and SCIM. These exist and have been hardened against real defects.
  - Islestone takes v4's age with it: no v5 path that upstream recommends, and two superseded majors (`jose` 4, `openid-client` 5) in the tree.
  - Needs the exit criteria and the contract below, so that the later move is planned rather than forced.
- **B. Write auth fresh on Better Auth.**
  - No later migration. Uses the library upstream recommends for new projects.
  - No reuse of the parent's code. Every rule in the contract below is rebuilt and re-tested, and each plugin must be checked against it first. Size: larger than A, by an amount not estimated here.
  - The telemetry package must be checked and either proved off or registered as a data recipient.
- **C. Auth.js v5 beta.** Not recommended. It is still a beta after three years, and upstream steers new projects away from it. The parent left it because an audit flagged a beta on the auth path (GAP-04).
- **D. Write auth fresh on NextAuth v4.** Not recommended. It combines the cost of a rewrite with a library upstream steers new projects away from, and still faces the later migration.
- **E. No auth library** (own OAuth client on `openid-client` 6 and `jose` 6). Not recommended. Largest security surface, with no upstream review.

**Recommendation:**

- If D1 is signed (1a or 1b): **A**, with the scope, the pin, the seam, the exit criteria and the contract below.
- If D1 ends at 1d (port nothing): **B**. The case for A is reuse. Without reuse, B is the better trade.
- If roadmap 1.4 is due to start while D1 is still open: the owner chooses between waiting for D1 and starting B. Do not start D.

Owner sign-off: ____  Date: ____

### A2 — Scope of the port (applies under A)

Ported in 1.4, as the roadmap lists:

- credentials, with the lockout ladder and the breach check on every route that sets a password;
- Google and Microsoft sign-in, with the OAuth email-trust rule;
- sign-in session rows with revocation, "sign out other sessions", and revocation on password change or reset;
- MFA per workspace;
- password change and reset;
- invites, with the token burnt on an email mismatch;
- the edge tenant-access gate, with the bounded membership claim and its database fallback;
- SSO (SAML and OIDC, through the hand-off) and SCIM, behind a feature flag. They leave the flag in roadmap 8.3.

Ported later: API keys, in roadmap 5.2.

Left out:

- the legacy `JWT_SECRET` cookie (**Verified**: `src/env.ts` line 134; `docs/auth.md` line 145 marks it deprecated);
- the parent's compliance and agent roles and gates. Roadmap 1.4 writes a new permission set; role names are ADR 0006's question;
- the Entra group-to-role mapping (`src/lib/auth/entra-group-*.ts`). It is not in 1.4's list. Decide when 8.3 starts.

Every ported file gets its `PROVENANCE.md` entry and takes Islestone's names (ADR 0006).

### A3 — Pin and seam (applies under A; the seam also under B)

- Pin `next-auth` at `4.24.15` and `@next-auth/prisma-adapter` at `1.0.7`, exact. Islestone's `.npmrc` already saves exact versions.
- Add a guard that fails if either package leaves v4 or takes a pre-release. The parent has such a guard (`tests/guardrails/auth-stack-pinning.test.ts`); write Islestone's fresh, pattern only.
- Treat a `next-auth` version bump as a significant change (the change-management document arrives in roadmap 1.8). Review it against the contract below.
- **Recommendation: one seam.** Only the modules under one folder (for example `src/lib/auth/provider/`) import `next-auth` or `better-auth`. Everything else, the edge gate included, calls Islestone's own functions. Enforce it with a lint rule. The parent did not do this: about fifteen server components import its `auth()` shim (`src/auth.ts` lines 14–19). The seam is what makes a later move a bounded change.

### A4 — Exit criteria: when to start a move to Better Auth (applies under A)

Each trigger is checked by a command or a test. When one fires, open a new ADR that supersedes this one and plans the move. A trigger starts the planning; it does not switch libraries by itself. The numbers are proposals for the owner.

- **T1. Unpatched advisory.** A high or critical advisory affects `next-auth` 4.24.x, or a package it holds at a major that no longer gets releases (`jose` 4, `openid-client` 5, `oauth`). No fixed 4.x release exists 30 days after the advisory is published. Islestone cannot neutralise it in its own code, or with an override that passes the contract suite. Check: the dependency audit that H1 makes blocking, plus a weekly scheduled run.
- **T2. Framework major.** A Next.js or React major that Islestone needs is missing from `next-auth`'s peer dependencies 90 days after that major's stable release. Or the contract suite fails on it and no 4.x fix lands in those 90 days. Check: `npm view next-auth@latest peerDependencies`, and the suite run on the candidate.
- **T3. Maintenance status.** Any of these:
  - npm marks `next-auth` 4.x deprecated (`npm view next-auth@<pinned> deprecated`);
  - the `v4` branch disappears (`git ls-remote https://github.com/nextauthjs/next-auth refs/heads/v4`);
  - the maintainers publish an end-of-life date for v4. The trigger then fires six months before that date;
  - no 4.x release for twelve months while an open advisory affects 4.x.
- **T4. Runtime.** A Node.js LTS line Islestone moves to breaks v4 or one of its pinned dependencies. CI runs Node 24 today.
- **T5. Feature.** A roadmap feature needs a sign-in method v4 cannot provide without a fork. Example: passkeys; v4's support for them was not checked. The owner records this judgement in an ADR.
- **T6. Audit finding.** A customer security review, or the SOC 2 readiness pass (H8), refuses v4 in writing. The parent left the v5 beta for this kind of reason.

Before a move, the target must also pass:

- **P1.** A stable release line, not a pre-release, for Better Auth and for each plugin in use.
- **P2.** No unpatched high or critical advisory.
- **P3.** Peer ranges that include Islestone's Next.js, React and Prisma majors.
- **P4.** Its licence re-read at the pinned commit and recorded in `PROVENANCE.md` (H0).
- **P5.** Telemetry proved off by a test or a network check, or registered as a data recipient (H6, 8.6).
- **P6.** The contract suite below passes against it, unchanged.

Owner sign-off: ____  Date: ____

### A5 — The contract a move must preserve (applies under A and B)

Each item is a behavioural test, written in 1.4 and H1 against Islestone's own seam (A3), not against a library API. Under A, the suite must pass unchanged before and after any move. Under B, it is the acceptance test for 1.4. The parent's sources are cited for each rule; read for the pattern, write fresh.

Sign-in sessions and revocation:

1. A revoked session row, or a bumped session version, makes every server gate return no session. In the parent the refusal is thrown outside the fail-open block (`src/auth.ts` lines 1134 and 1265; `session-revoked.ts`).
2. Revocation takes effect no slower than in the parent: the row is checked on every token pass, the version every 300 seconds (`src/auth.ts` line 1248).
3. "Sign out other sessions" keeps the caller's own session.
4. A password change or reset revokes every session.
5. The per-workspace session age limit and concurrent-session cap hold.
6. The parent fails open when the session check cannot read the database (`src/auth.ts` lines 1130 and 1262). A move keeps that, or changes it by a recorded decision, never by accident.

Workspace scoping:

7. The edge admits a workspace path only when the session's membership claim names it. The claim is capped (50 in the parent, `src/auth.ts` line 86). Over the cap, the edge defers to the database-backed gate.
8. An SSO session reaches only the workspace whose identity provider opened it, and no organization (`sso-session.ts`).
9. The SSO hand-off is single-use, lives 60 seconds and is bound to a cookie (`sso-handoff.ts`). The round trip is bound to the browser that started it, and a cross-site start is refused (`sso-flow.ts`). The OIDC ID token is verified, not decoded. A SAML response must answer this flow's request.
10. A workspace that enforces SSO admits only its own SSO, or a break-glass OWNER or ADMIN signed in with a password (`sso-enforcement.ts`).

MFA:

11. MFA is asked of every workspace the session can reach. A pass counts only for the sign-in session that answered it. A code is accepted once (`workspace-mfa.ts`).

Identity linking and credentials:

12. An OAuth email counts only when the provider vouches for it. A vouched sign-in that claims an unverified account removes the competing credentials (`oauth-email-trust.ts`).
13. An invite is bound to its token and its email, and is burnt on a mismatch.
14. Password sign-in does not reveal whether an account exists, and takes the same time either way. The lockout ladder holds. Every route that sets a password runs the breach check. Reset tokens are hashed, single-use and short-lived.

Machine credentials:

15. API keys are stored as hashes and carry scopes. A request with a Bearer key never falls back to the cookie. SCIM tokens are bound to their workspace. In the parent neither touches NextAuth (`api-key-auth.ts`, `src/lib/scim/auth.ts`); a move must not route them through the new library's session.

Data and cookies:

16. User and account ids survive the move, and nobody has to re-link a provider. Ending every sign-in session once at cutover is allowed if it is announced.
17. The session cookie stays HttpOnly, Secure and SameSite=Lax, with the `__Secure-` prefix in production (v4's defaults, cited in the Context). Its name may change with the library; that ends every session at cutover, which item 16 allows.
18. Audit events for sign-in, denial and revocation keep their names.

### Open questions for the owner

1. Will D1 be signed before roadmap 1.4 starts? If not, wait, or start on B?
2. Are the numbers in T1 to T3 (30 days, 90 days, twelve months, six months) acceptable?
3. Do SSO and SCIM need to be ported in 1.4 behind a flag, or can they wait for 8.3? This changes how much 1.4 ports.
4. Should Islestone keep the parent's fail-open on a database error during the session check (contract item 6)?
5. Are passkeys on the product plan (T5)?
6. Should the "security-only maintenance" claim be confirmed with the Auth.js maintainers or the blog post before anyone relies on it? This environment could not read the post.
7. Should Islestone keep the parent's `overrides` entry for `next-auth` (`package.json` lines 344–347)? Its reason was not found.

## Consequences

- Under A, roadmap 1.4 waits for D1 (ADR 0001). Once D1 is signed, 1.4 is mostly a port with renames. Islestone receives the parent's later auth fixes only if the grant covers later versions (ADR 0001, open question 6).
- Under A, the tree carries `jose` 4 and `openid-client` 5 until the move. T1 watches them.
- Under B, 1.4 is a fresh write and grows. Roadmap 9.3's "move to Better Auth" item disappears.
- Under either path:
  - the contract suite becomes part of H1's auth abuse tests (lockout, revocation that signs out, invite burn, cross-tenant slug refusal);
  - the single seam is a lint rule from the first auth commit;
  - the libraries pass the 0.3 licence allowlist as they stand.
- Roadmap 9.3's move happens when a trigger fires, not on a date.
- The permission set and role names in 1.4 are separate decisions (roadmap 1.4; ADR 0006).

## What would change this decision

- The D1 outcome in ADR 0001. This is the main input.
- A trigger in A4 firing.
- Auth.js v5 shipping as stable. The parent's GAP-04 note planned that move. Given upstream's current recommendation, re-evaluate before taking it.
- Better Auth showing, by test, that its plugins express per-workspace MFA and single-workspace SSO sessions natively. That would shrink B.
- An announced end-of-life date for NextAuth v4.
- A customer or certification requirement that one library cannot meet.

## References

- Roadmap (`docs/ROADMAP.md`):
  - 1 (research date and the *unverified* marker);
  - 2.1, Platform row (auth is "port as is or with renames");
  - 2.3, Auth row;
  - 4 (global preamble);
  - 5: 0.2 item 4, 0.3, H0, 1.4, 1.8, H1, 5.2, 8.3, 8.6, H6, H8, 9.3;
  - 7, open decisions 1 and 4.
- Islestone: `docs/adr/0001-code-provenance-and-licences.md` (D1, interim rule); `docs/adr/0006-vocabulary.md` ("sign-in session", role names); `package.json`; `CLAUDE.md`.
- inflect-compliance, read-only, at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`:
  - `package.json` (lines 108, 109, 122, 175, 184, 185, 192, 344–347) and `package-lock.json`;
  - `src/auth.ts` (lines 1–30, 86, 395–484, 679–722, 1110–1135, 1240–1266);
  - `src/middleware.ts` (line 2);
  - `src/lib/auth/`: `session-revoked.ts`, `workspace-mfa.ts`, `sso-handoff.ts`, `sso-session.ts`, `sso-flow.ts`, `sso-enforcement.ts`, `oauth-email-trust.ts`, `api-key-auth.ts`, `guard.ts`;
  - `src/lib/security/`: `session-tracker.ts`, `totp-crypto.ts`, `saml-client.ts`, `oidc-client.ts`;
  - `src/lib/scim/auth.ts`;
  - `prisma/schema/auth.prisma` (line 1319, `UserSession`);
  - `src/env.ts` (line 134);
  - `docs/auth.md` (lines 145, 271–289; stale in places, see Context);
  - `docs/implementation-notes/2026-04-25-gap-04-nextauth-v4-migration.md`;
  - `tests/guardrails/auth-stack-pinning.test.ts`;
  - `CLAUDE.md`, "Auth" section.
- npm registry, read 2026-11-18: `next-auth` (dist-tags, `time`, 4.24.15 peer dependencies, dependencies, `deprecated`, maintainers, licence); `@next-auth/prisma-adapter` 1.0.7; `jose`; `openid-client`; `better-auth` 1.7.26 (dist-tags, `time`, licence, peer dependencies, dependencies, exports); `@better-auth/sso`, `@better-auth/scim`, `@better-auth/passkey`, `@better-auth/api-key`, `@better-auth/prisma-adapter` 1.7.26; the bulk advisory endpoint.
- GitHub, at pinned commits:
  - `https://github.com/nextauthjs/next-auth/blob/a1a16a5a7780488c7449feece410033f445d0b31/README.md` (line 21);
  - `https://github.com/nextauthjs/next-auth/blob/d857eec560fb99c8b18d3b22a2693b849a62d1c3/LICENSE` and `packages/next-auth/src/core/lib/cookie.ts` (lines 57–66), both at tag `next-auth@4.24.15`;
  - `https://github.com/better-auth/better-auth/blob/36ae40b23970ab9dbbf6ce7d7c6962af57ec0007/LICENSE.md`.
