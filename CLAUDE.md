# CLAUDE.md

Guidance for Claude Code sessions in this repository.

**Islestone** is an AI-enabled project-management SaaS: one work-item table with many views, deterministic planning, and agents that work as delegates of accountable people and write only through proposals a person approves.

Read [docs/ROADMAP.md](docs/ROADMAP.md) (phases, the global preamble in section 4, hardening gates) and [docs/adr/](docs/adr/) before starting. If a step would contradict an ADR, stop and ask.

## Current state

Sub-phase 1.1, the repository skeleton. What exists: a Next.js 16 App Router app with a placeholder home page and `/api/livez` and `/api/readyz`; the two env modules; Jest, Playwright, ESLint and CI; a local Postgres, PgBouncer and Redis stack. What does not exist yet: a database schema, auth, permissions, usecases, policies, repositories, the audit log, jobs, the shared UI. Do not write code or docs that assume they do.

## Commands

```bash
npm run dev             # Next.js dev server (needs .env.local; copy .env.example)
npm run build           # production build; SKIP_ENV_VALIDATION=1 builds without an env
npm run start           # serve the build
npm run lint            # eslint . --max-warnings=0
npm run typecheck       # next typegen && tsc --noEmit (needs a valid env or SKIP_ENV_VALIDATION=1)
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

- **Two env modules.** Server variables live in `src/env.ts`; `NEXT_PUBLIC_` variables live in `src/env-client.ts`. Code a `'use client'` file can reach, directly or through any chain of imports, imports `@/env-client` only. `tests/guards/client-env-boundary.test.ts` walks the import graph from every `'use client'` file and fails, naming the chain, if `src/env.ts` is reachable. It has no allowlist. Import them as `@/env` / `@/env-client`, never by a relative path (lint enforces it). No raw `process.env` reads in `src/` outside the env modules: add the variable to the right module and to `.env.example`.
- **Lint rules in `src/`:** no `console` (logging arrives with the observability layer in 1.6), no explicit `any`. Type-only imports say `import type`.
- **Exact versions.** `.npmrc` sets `save-exact`; every dependency in `package.json` is pinned.
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

> **Owner decisions of 2026-11-18 supersede the first and fourth bullets below.** Copying from inflect-compliance is allowed, with every copied file recorded in `PROVENANCE.md`. Islestone is BUSL-1.1 (`LICENSE`). tldraw stays on 3.x with its watermark. The Dub-derived UI is taken as it is, with the risk accepted. See [docs/HANDOFF.md](docs/HANDOFF.md) until ADR 0001 records these decisions.

- **inflect-compliance is BUSL-1.1** (licensor Inflect Ltd.). Until ADR 0001 records the written grant, do not copy its code: no file copies, no pasted functions, no verbatim blocks. You may read it to learn a design and write your own implementation; record the pattern as "pattern only, no code copied".
- **Never copy code from a project the roadmap marks "inspiration only"** (section 2.2: Plane, OpenProject, Twenty, and the rest of that list).
- **Every ported or adapted piece of code gets a `PROVENANCE.md` entry**: source repository and path, commit, licence, and what changed. See "Third-party code" below.
- Islestone's own licence is undecided (owner decision, roadmap 0.1); `package.json` says `UNLICENSED`.

## Third-party code

Sub-phase 0.3's intake policy. Read the files below before adding a dependency or taking anything from another project.

- **[`PROVENANCE.md`](PROVENANCE.md)** records everything taken from elsewhere, including patterns learned by reading (write "pattern only, no code copied"). Add the row in the same pull request as the code. A roadmap port candidate is listed there as UNPINNED: before first use, re-read its LICENSE at the commit you use, pin that commit, and move the row to Adopted (H0). Copied code that needs an attribution also goes in [`NOTICE`](NOTICE).
- **`scripts/licence-gate.mjs`** (`npm run licence:check`, CI job `Licence`) fails on:
  - a production dependency whose licence is not on its allowlist;
  - an import from an `ee` folder or a deny-listed package anywhere in `src/`, `packages/`, `scripts/` or a root-level source file.

  The policy and its reasons are at the top of the script. Never widen `ALLOWED_LICENCES`, `DATA_ONLY_LICENCES` or `DENIED_PACKAGES` to make a build pass: that is an owner decision.
- **`scripts/licence-exemptions.json`** is the only way past the allowlist. Each entry needs `licence` (SPDX; `LicenseRef-…` for a proprietary licence), `reason` (the evidence) and `adr` (an existing `docs/adr/` file). Pin `version` when the evidence was read at one version. An exemption stops applying when the package's declared licence changes, and the gate fails on a stale or unneeded entry. Delete an entry when its package leaves the tree. The README's "Third-party code and licences" section shows the planned tldraw entry; it is not live.
- **Tests:** `tests/unit/licence-gate.test.ts` uses fixtures in `tests/fixtures/licence-gate/`. Those fixtures break the policy on purpose, so the gate's scan, `tsconfig.json` and `eslint.config.mjs` all leave `tests/fixtures/` out.

## Test conventions

- **Jest projects:** `node` runs `tests/unit/**/*.test.ts` and `tests/guards/**/*.test.ts`; `jsdom` runs `tests/rendered/**/*.test.tsx` with Testing Library and `@testing-library/jest-dom`. The transformer is `@swc/jest`; `tsc` owns type errors. Plain ESM scripts (`scripts/*.mjs`) are compiled to CommonJS for Jest the same way, so a test can import them; each gets a `.d.mts` beside it for its types.
- **Env in Jest:** `@/env` and `@/env-client` map to `tests/mocks/env.ts` (t3-env is ESM-only), which reads `process.env` live; a test sets a variable for itself and restores it. `jest.setup.ts` sets `SKIP_ENV_VALIDATION=1`.
- **Guards** (`tests/guards/`) check source structure. A guard takes its file population from git (`gitFiles()` in `tests/helpers/git-files.ts`, i.e. `git ls-files --cached --others --exclude-standard`), never from a directory walk with a skip list, and proves itself against a planted fixture (a throwaway git repository in a temp directory) so it cannot pass by checking nothing.
- **Rendered tests** query by role or label.
- **E2E** (`tests/e2e/*.spec.ts`) runs Playwright against `next start` on port 3100, so build first. Set `PW_CHROMIUM_PATH` to use a preinstalled Chromium. Traces are off by default.
