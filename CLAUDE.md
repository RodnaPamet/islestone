# CLAUDE.md

Guidance for Claude Code sessions in this repository.

**Islestone** is an AI-enabled project-management SaaS: one work-item table with many views, deterministic planning, and agents that work as delegates of accountable people and write only through proposals a person approves.

Read [docs/ROADMAP.md](docs/ROADMAP.md) (phases, the global preamble in section 4, hardening gates) and [docs/adr/](docs/adr/) before starting. If a step would contradict an ADR, stop and ask.

## Current state

Sub-phase 1.1, the repository skeleton, is done: PR #1's first CI run, at `3ffb78a`, was green. The owner decisions of Phase 0 are recorded in the ADRs. ADRs 0001 (provenance and licences) and 0007 (licence exceptions) are Accepted. ADRs 0002 to 0006 are Proposed; 0003 and 0006 record some owner decisions in place (see the index in `docs/adr/README.md`). The next step is sub-phase 1.2, the shared UI; it has not landed. What exists: a Next.js 16 App Router app with a placeholder home page and `/api/livez` and `/api/readyz`; the two env modules; baseline security headers on every response (`src/lib/security-headers.ts`, wired in `next.config.ts`; a Content-Security-Policy with `script-src` needs per-request nonces and belongs to the security perimeter, sub-phase 1.5); Jest, Playwright, ESLint and CI; a local Postgres, PgBouncer and Redis stack. What does not exist yet: a database schema, auth, permissions, usecases, policies, repositories, the audit log, jobs, the shared UI. Do not write code or docs that assume they do.

## Commands

```bash
npm run dev             # Next.js dev server (needs .env.local; copy .env.example)
npm run build           # production build; SKIP_ENV_VALIDATION=1 builds without an env
npm run start           # serve the build
npm run lint            # eslint . --max-warnings=0
npm run typecheck       # next typegen (env validation off, scripts/next-typegen.mjs) && tsc --noEmit; needs no env
npm test                # Jest, both projects
npm run test:unit       # Jest node project (tests/unit, tests/guards)
npm run test:rendered   # Jest jsdom project (tests/rendered)
npm run test:e2e        # Playwright against the built app; build first
npm run licence:check   # third-party licence gate (scripts/licence-gate.mjs); --json for JSON
npm run verify          # lint + typecheck + test + licence:check
npx jest tests/unit/health-routes.test.ts   # one file
docker compose up -d    # local Postgres (pgvector), PgBouncer, Redis
```

## Rules that apply now

- **Two env modules.** Server variables live in `src/env.ts`; `NEXT_PUBLIC_` variables live in `src/env-client.ts`. Code a `'use client'` file can reach, directly or through any chain of imports, imports `@/env-client` only. `tests/guards/client-env-boundary.test.ts` walks the import graph from every file Next.js ships to the browser (`'use client'` files, `instrumentation-client.*`, Pages Router files) and fails, naming the chain, if `src/env.ts` is reachable. A `'use server'` module (Server Functions) is a boundary: Next.js sends the client a reference stub, so the walk records the edge and does not descend into it. It has no allowlist. It cannot follow an import of this repository's own workspace packages yet, so it fails on one from client code; sub-phase 1.2 teaches it to resolve them. Import them as `@/env` / `@/env-client`, never by a relative path (lint enforces it). No raw `process.env` reads in `src/` outside the env modules: add the variable to the right module and to `.env.example`.
- **Lint rules in `src/`:** no `console` (logging arrives with the observability layer in 1.6), no explicit `any`. Type-only imports say `import type`.
- **Exact versions.** `.npmrc` sets `save-exact`; every dependency in `package.json` is pinned.
- **No AGENTS.md.** `next.config.ts` sets `agentRules: false`, so `next dev` in an agent session does not write one. Agents read this file.
- **Tests ship with behaviour** and must fail when that behaviour regresses. A failing test is fixed, not bypassed.

## Rules for layers that do not exist yet

These come from the roadmap's global preamble. They bind from the moment the layer is created (mostly sub-phases 1.3 to 1.5); when you create one, follow its rule and update this file to say the layer exists.

- Route handlers (`src/app/api/**/route.ts`) parse input, call a usecase and return a response. No business logic and no data access in the handler.
- Usecases hold the logic and take a `RequestContext` as their first argument.
- Policies authorise before any data access; privileged routes are wrapped in `requirePermission`, whose denials are audited.
- Repositories filter every query by `tenantId`.
- Every tenant table gets `tenantId`, a tenant-leading index, row-level-security policies in the same migration that creates it, and a two-tenant test.
- Every mutation input is validated with Zod.
- Free text is sanitised on the server before it is stored.
- Every mutation is audited with `logEvent`.

## Provenance and licences

These rules are the owner decisions of 2026-11-18, recorded in [ADR 0001](docs/adr/0001-code-provenance-and-licences.md).

- **Islestone is BUSL-1.1**, licensor Inflect Ltd. (`LICENSE`, summarised in `LICENSING.md`; `package.json` says `BUSL-1.1`). It is source-available, not open source.
- **Code may be copied from inflect-compliance** (BUSL-1.1, the same licensor; ADR 0001 D1). Every copied file gets a `PROVENANCE.md` row: source path, commit (`5528464fc54a8681956f3b9ce23ca9c075f0420e` for the porting maps in `docs/porting/maps/`), licence BUSL-1.1, and what changed. Keep the BUSL and other licence notices the copied material carries, such as a package's `"license": "BUSL-1.1"` field or a bundled notice file. Third-party material inside the copied code brings its attribution into `NOTICE` in the same change (for example pipelock with the AI guard).
- **Never copy code from a project the roadmap marks "inspiration only"** (section 2.2: Plane, OpenProject, Twenty, and the rest of that list).
- **Every other ported or adapted piece of code gets a `PROVENANCE.md` entry** too: source repository and path, commit, licence, and what changed. A design learned by reading gets a row that says "pattern only, no code copied". See "Third-party code" below.
- **tldraw stays on 3.x (3.15.6) with its watermark visible** (ADR 0001 D3). Never disable, hide, remove or alter the watermark, and do not upgrade to 4.x or later. The canvas port (4.2) brings the 3.x ceiling guard, the Dependabot hold, the tiptap 2.x audit exemption and the tldraw licence-gate exemption. tldraw is not installed yet.
- **The Dub-derived UI and the Nucleo icons are taken as they are**, with the licence risk accepted (ADR 0001 D4). The change that lands `packages/ui` (1.2) also adds Dub's copyright and AGPL-3.0 statement and the Nucleo notice to `NOTICE`, and the `@inflect/ui` licence-gate exemption.

## Third-party code

Sub-phase 0.3's intake policy. Read the files below before adding a dependency or taking anything from another project.

- **[`PROVENANCE.md`](PROVENANCE.md)** records everything taken from elsewhere, including patterns learned by reading (write "pattern only, no code copied"). Add the row in the same pull request as the code. A roadmap port candidate is listed there with the commit its licence was read at, UNPINNED for use: before first use, use that commit or re-read the LICENSE at the one you use, pin it, follow the row's licence-boundary rule, and move the row to Adopted (H0). Copied code that needs an attribution also goes in [`NOTICE`](NOTICE).
- **`scripts/licence-gate.mjs`** (`npm run licence:check`, CI job `Licence`) fails on:
  - a production dependency whose licence is not on its allowlist (roadmap 0.3's list plus `0BSD`, ADR 0007). Production is walked from the `package.json` files on disk, which must agree with the lockfile, and includes any devDependency that code which can ship imports;
  - an import from an `ee` folder or a deny-listed package in any git-listed source file (JavaScript, TypeScript, CSS, MDX), except the gate's own fixtures;
  - code that can ship importing a `DEV_ONLY_PATHS` path (tests, dev-tool configuration), and a file the scanner cannot read to the end.

  The policy and its reasons are at the top of the script. Never widen `ALLOWED_LICENCES` or `ALLOWED_EXCEPTIONS`, shrink `DENIED_PACKAGES`, or add to `DEV_ONLY_PATHS` to make a build pass: that is an owner decision, recorded in ADR 0007.
- **`scripts/licence-exemptions.json`** is the only way past the allowlist. Each entry needs `licence` (SPDX; `LicenseRef-…` for a proprietary licence), `reason` (the evidence) and `adr` (an existing `docs/adr/` file that names the package and whose status line starts `Status: Accepted`). Pin `version` when the evidence was read at one version; it is required when the package's declaration is not SPDX (`SEE LICENSE IN`, `UNLICENSED`, missing). An exemption stops applying when the package's declared licence changes, and the gate fails on a stale or unneeded entry. Delete an entry when its package leaves the tree. The README's "Third-party code and licences" section shows the planned tldraw entry (ADR 0001 D3); it is not live. A workspace that holds an `UPSTREAM.json` (a byte-for-byte mirror, such as `packages/ui`) is checked like any dependency, not as Islestone's own code.
- **Tests:** `tests/unit/licence-gate.test.ts` uses fixtures in `tests/fixtures/licence-gate/`. Those fixtures break the policy on purpose, so the gate's scan leaves `tests/fixtures/licence-gate/` out, and `tsconfig.json` and `eslint.config.mjs` leave `tests/fixtures/` out.

## Test conventions

- **Jest projects:** `node` runs `tests/unit/**/*.test.ts` and `tests/guards/**/*.test.ts`; `jsdom` runs `tests/rendered/**/*.test.tsx` with Testing Library and `@testing-library/jest-dom`. The transformer is `@swc/jest`; `tsc` owns type errors. Plain ESM scripts (`scripts/*.mjs`) are compiled to CommonJS for Jest the same way, so a test can import them; each gets a `.d.mts` beside it for its types.
- **Env in Jest:** `@/env` and `@/env-client` map to `tests/mocks/env.ts` (t3-env is ESM-only), which reads `process.env` live; a test sets a variable for itself and restores it. `jest.setup.ts` sets `SKIP_ENV_VALIDATION=1`.
- **Guards** (`tests/guards/`) check source structure. A guard takes its file population from git (`gitFiles()` in `tests/helpers/git-files.ts`, i.e. `git ls-files --cached --others --exclude-standard`), never from a directory walk with a skip list, and proves itself against a planted fixture (a throwaway git repository in a temp directory) so it cannot pass by checking nothing.
- **Rendered tests** query by role or label.
- **E2E** (`tests/e2e/*.spec.ts`) runs Playwright against `next start` on port 3100, so build first. Set `PW_CHROMIUM_PATH` to use a preinstalled Chromium. Traces are off by default.
