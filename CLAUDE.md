# CLAUDE.md

Guidance for Claude Code sessions in this repository.

**Islestone** is an AI-enabled project-management SaaS: one work-item table with many views, deterministic planning, and agents that work as delegates of accountable people and write through proposals a person approves, unless a workspace owner raises a rung and the item's assignee started the session (ADR 0003).

Read [docs/ROADMAP.md](docs/ROADMAP.md) (phases, the global preamble in section 4, hardening gates) and [docs/adr/](docs/adr/) before starting. If a step would contradict an ADR, stop and ask.

## Current state

Sub-phase 1.1, the repository skeleton, is done and merged (PR #1). The owner decisions taken so far are recorded in the ADRs, the roadmap and the porting maps. ADRs 0001, 0002, 0004, 0005 and 0007 are Accepted; 0003 and 0006 record the owner's decisions in place and stay Proposed for their remaining open questions (see the index in `docs/adr/README.md`). Sub-phase 1.2 has landed in two parts: part A, `packages/ui`, the byte-for-byte `@inflect/ui` mirror, and part B, the generic UI files copied from inflect-compliance into `src/components/ui` and `src/lib/hooks` with their tokens, Tailwind theme, catalogue and tests, and a gallery at `/gallery` (see "Shared UI" below). Sub-phase 1.3, the tenancy and data core, has landed (see "Data layer" below). What exists: a Next.js 16 App Router app with a placeholder home page, the `/gallery` page and `/api/livez` and `/api/readyz`; the two env modules; baseline security headers on every response (`src/lib/security-headers.ts`, wired in `next.config.ts`; a Content-Security-Policy with `script-src` needs per-request nonces and belongs to the security perimeter, sub-phase 1.5); the shared UI (`packages/ui`, `src/components/ui`, `src/lib/hooks`), design tokens (`src/styles/tokens.css`) and an English-only next-intl setup (`src/i18n/request.ts`, `messages/en.json`); Jest, Playwright, ESLint, CI and CodeQL; a local Postgres, PgBouncer and Redis stack; the Prisma 7 schema with the five tenancy models, one migration with row-level security and both last-owner triggers, `runInTenantContext`, `RequestContext`, `getTenantCtx`/`getOrgCtx` and their page-side twins, the logger, and an `integration` Jest project against a real Postgres. `src/lib/permissions.ts` and `src/lib/auth/session.ts` are 1.3 stubs that fail closed (no permission is granted, and every session read is a 401), so `getTenantCtx` cannot succeed outside tests until 1.4.  The theme is `data-theme` on an element, light by default; nothing follows the operating system's colour scheme yet. What does not exist yet: auth, permissions, usecases beyond the two owner locks, policies, repositories, the audit log, jobs, the app shell (layout, navigation, theme provider: 1.7). Do not write code or docs that assume they do.

## Commands

```bash
npm run dev             # Next.js dev server (needs .env.local; copy .env.example)
npm run build           # production build; SKIP_ENV_VALIDATION=1 builds without an env
npm run start           # serve the build
npm run lint            # eslint . --max-warnings=0
npm run typecheck       # next typegen (env validation off, scripts/next-typegen.mjs) && tsc --noEmit && typecheck:ui; needs no env
npm run typecheck:ui    # tsc -p packages/ui/tsconfig.json (the shared UI mirror)
npm run ui:verify       # every file in packages/ui matches packages/ui/UPSTREAM.json
npm run ui:mirror       # every mirrored file in src/ matches ui-mirror.json (scripts/ui-mirror.mjs)
npm test                # Jest node + jsdom projects (no database)
npm run test:unit       # Jest node project (tests/unit, tests/guards)
npm run test:rendered   # Jest jsdom project (tests/rendered)
npm run test:integration  # Jest integration project against Postgres (DATABASE_URL_TEST, else DATABASE_URL), in band
npm run test:e2e        # Playwright against the built app; build first
npm run test:scripts    # node --test for the plain-ESM script tests (tests/unit/**/*.test.mjs: ui-drift, ui-mirror)
npm run licence:check   # third-party licence gate (scripts/licence-gate.mjs); --json for JSON
npm run verify          # lint + typecheck + test + test:scripts + licence:check (no database)
npm run db:generate     # prisma generate (also runs as postinstall)
npm run db:migrate      # prisma migrate dev (reads .env.local through prisma.config.ts)
npm run migrate:deploy  # prisma migrate deploy
npm run db:check-schema-drift  # a database built from prisma/migrations reproduces prisma/schema
npx jest tests/unit/health-routes.test.ts   # one file
docker compose up -d    # local Postgres (pgvector, app_user created by prisma/init-roles.sh), PgBouncer, Redis
```

## Rules that apply now

- **Two env modules.** Server variables live in `src/env.ts`; `NEXT_PUBLIC_` variables live in `src/env-client.ts`. Code a `'use client'` file can reach, directly or through any chain of imports, imports `@/env-client` only. `tests/guards/client-env-boundary.test.ts` walks the import graph from every file Next.js ships to the browser (`'use client'` files, `instrumentation-client.*`, Pages Router files) and fails, naming the chain, if `src/env.ts` is reachable. A `'use server'` module (Server Functions) is a boundary: Next.js sends the client a reference stub, so the walk records the edge and does not descend into it. It has no allowlist. It follows an import of this repository's own workspace packages (`@inflect/ui`) through the package's `exports` map, and fails on one the map cannot resolve. Import them as `@/env` / `@/env-client`, never by a relative path (lint enforces it). No raw `process.env` reads in `src/` outside the env modules: add the variable to the right module and to `.env.example`.
- **Lint rules in `src/`:** no `console` (log through `@/lib/observability/logger`, pulled forward from 1.6), no explicit `any`. Type-only imports say `import type`.
- **Exact versions.** `.npmrc` sets `save-exact`; every dependency in `package.json` is pinned.
- **No AGENTS.md.** `next.config.ts` sets `agentRules: false`, so `next dev` in an agent session does not write one. Agents read this file.
- **Tests ship with behaviour** and must fail when that behaviour regresses. A failing test is fixed, not bypassed.
- **Every tenant table** gets `tenantId`, a tenant-leading index, row-level-security policies (`tenant_isolation`, `tenant_isolation_insert`, `superuser_bypass`, FORCE) and its own `GRANT … TO app_user` in the migration that creates it, and a two-tenant test listed in `ISOLATION_TESTED`. CI holds each part: `tests/guards/rls-migration-policies.test.ts`, `schema-index-coverage.test.ts`, `tenant-isolation-forward-lock.test.ts` and `tests/integration/rls-coverage.test.ts`.

## Shared UI (`packages/ui`)

- **`packages/ui` is a byte-for-byte mirror** of inflect-compliance's `@inflect/ui` at the commit in `packages/ui/UPSTREAM.json`. Never edit a file in it: fix the file upstream in inflect-compliance and re-pin (`docs/porting/shared-ui.md`, "Sync from upstream"). `node scripts/ui-drift.mjs verify` (`npm run ui:verify`) fails on any edited, added or missing file; CI's `Shared UI` job runs `verify --population fs` and `audit` against the pinned upstream commit.
- **ESLint skips it** (linted upstream); `npm run typecheck:ui` type-checks it through its own `tsconfig.json`, which extends the root. That is why the root config does not set `noUncheckedIndexedAccess`: the package does not pass it, and inflect does not use it.
- **Jest** maps `@inflect/ui` and `@inflect/ui/*` to `packages/ui/src`, and the jsdom project runs the package's co-located `__tests__`.
- Its runtime dependencies (visx, motion, sonner, date-fns, TanStack Table and the rest) are declared in the root `package.json` at inflect's locked versions; `.gitattributes` keeps git from rewriting its line endings.
- **`src/components/ui` and `src/lib/hooks` mirror inflect-compliance too** (part B), at inflect's own paths, so their `@/components/ui/...` and `@inflect/ui/...` imports resolve unchanged. `ui-mirror.json` lists each byte-identical copy with its sha256 (also four files outside those roots: `src/lib/format-bytes.ts`, `src/lib/text-utils.ts`, `src/lib/filters/filter-presets.ts`, `src/types/tanstack-table.d.ts`), the Islestone-owned files inside them (`owned`: the `charts/index.ts` and `icons/index.tsx` stubs, the `src/lib/ui-storage.ts` fork) and the upstream files not taken (`excluded`). Never edit a mirrored file; `node scripts/ui-mirror.mjs verify` fails on an edit or on any unlisted file under the roots, `audit` binds the hashes to upstream, and `compare`/`pin` sync (`docs/porting/shared-ui.md`, "Part B"). A new Islestone file under `src/components/ui` or `src/lib/hooks` goes in `owned`, with a reason; prefer putting Islestone UI elsewhere. ESLint skips exactly the mirrored paths.
- **New Islestone code imports `@inflect/ui/components/ui/<name>` directly**, never the ten `src/components/ui/<name>` re-export shims, which upstream will delete.
- **Tokens and theme.** `src/styles/tokens.css` defines the package's 47 contract tokens and the extras the copied UI reads, in a light theme (`:root`, `[data-theme="light"]`) and a dark one (`[data-theme="dark"]`). There is no `tailwind.config.js`: the theme keys the UI's class names need are `@theme` blocks in `src/app/globals.css`, beside the `.glass-card`, `.surface-popup-texture`, `.data-table` and `.animate-fadeIn` recipes, which must stay inside `@layer components`/`utilities` or they beat every utility. Tailwind scans `packages/ui/src` and skips `tests/` and `docs/`.
- **Copy** is in `messages/en.json` (only the keys the shared UI reads), served by `src/i18n/request.ts`. English only; add a key rather than a literal.
- **`/gallery`** shows the main primitives in both themes; extend it when you add a primitive.

## Data layer

Sub-phase 1.3 (`docs/porting/maps/1.3.md`). Read [docs/rls-tenant-isolation.md](docs/rls-tenant-isolation.md) and [docs/database-routing.md](docs/database-routing.md) before touching it.

- **Schema.** `prisma/schema/` is a folder (`base`, `enums`, `tenancy`; one owner per declaration, see its README). The workspace is `Tenant` / `tenantId` in code (ADR 0006 W1). `Role` is `OWNER ADMIN MEMBER VIEWER GUEST` in that seniority order; never reorder it, and add a value in a migration of its own (`tests/guards/migration-enum-isolation.test.ts`, `enum-member-order-matches-migrations.test.ts`). No `@map`/`@@map`, and no identifier uses a word ADR 0006 bans (`tests/guards/schema-vocabulary.test.ts`).
- **Migrations are the only apply path**, and a database built from them must reproduce the schema exactly (`npm run db:check-schema-drift`, residue file empty). A migration never names a login role; `prisma/init-roles.sh` and the CI `Integration` job grant `app_user` to the login role.
- **Tenant access goes through `runInTenantContext`** (or `runInTenantReadContext`, `runInTenantJobContext`) from `@/lib/db/rls-middleware`, which runs as `app_user` with `app.tenant_id` set. A bypass is `runWithoutRls({ reason })` with a reason from `RlsBypassReason`, and is logged. Repositories and usecases never import `@/lib/prisma`; usecases never call `withTenantDb(` (`tests/guards/no-direct-prisma.test.ts`, allowlists empty).
- **The organization axis** (`Organization`, `OrgMembership`) is keyed on `app.user_id`, which nothing sets: under `app_user` both read as empty, and organization paths use the global client. Do not set `app.user_id` before making `check_not_last_org_owner` correct under RLS (docs/rls-tenant-isolation.md).
- **Last-owner triggers** hold both tables; their advisory-lock keys (`tenant-owner:<id>`, `org-owner:<id>`) equal `lockTenantOwners` / `lockOrgOwners`. Take the lock first in any transaction that changes owners, and keep the trigger functions VOLATILE.
- **`getTenantCtx` / `getOrgCtx` and `getTenantServerContext` / `getOrgServerContext` change together.** 1.3 removed the same gates from both pairs; 1.4 restores them in both.
- `src/lib/db-context.ts`, `src/lib/prisma.ts` and `src/lib/db/rls-middleware.ts` import each other; every dereference happens inside a function. Keep `rls-middleware`'s `import * as prismaModule` and never destructure `prisma` at module top level in them.

## Rules for layers that do not exist yet

These come from the roadmap's global preamble. They bind from the moment the layer is created (mostly sub-phases 1.3 to 1.5); when you create one, follow its rule and update this file to say the layer exists.

- Route handlers (`src/app/api/**/route.ts`) parse input, call a usecase and return a response. No business logic and no data access in the handler.
- Usecases hold the logic and take a `RequestContext` as their first argument.
- Policies authorise before any data access; privileged routes are wrapped in `requirePermission`, whose denials are audited.
- Repositories filter every query by `tenantId`. (Repositories take the transaction client from `runInTenantContext` and never import `@/lib/prisma`; `tests/guards/no-direct-prisma.test.ts` already enforces that half.)
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
- **The Dub-derived UI and the Nucleo icons are taken as they are**, with the licence risk accepted (ADR 0001 D4). `NOTICE` carries Dub's copyright and AGPL-3.0 statement and the Nucleo notice (D4); `PROVENANCE.md` lists every copied file and marks the Dub-derived and Nucleo ones; `scripts/licence-exemptions.json` exempts `@inflect/ui` (BUSL-1.1, citing ADR 0001), because the gate checks a mirrored workspace like any dependency.

## Third-party code

Sub-phase 0.3's intake policy. Read the files below before adding a dependency or taking anything from another project.

- **[`PROVENANCE.md`](PROVENANCE.md)** records everything taken from elsewhere, including patterns learned by reading (write "pattern only, no code copied"). Add the row in the same pull request as the code. A roadmap port candidate is listed there with the commit its licence was read at, UNPINNED for use: before first use, use that commit or re-read the LICENSE at the one you use, pin it, follow the row's licence-boundary rule, and move the row to Adopted (H0). Copied code that needs an attribution also goes in [`NOTICE`](NOTICE).
- **`scripts/licence-gate.mjs`** (`npm run licence:check`, CI job `Licence`) fails on:
  - a production dependency whose licence is not on its allowlist (roadmap 0.3's list plus `0BSD`, `Unlicense` and `BlueOak-1.0.0`, ADR 0007 E2b, E6 and E7). Production is walked from the `package.json` files on disk, which must agree with the lockfile, and includes any devDependency that code which can ship imports;
  - an import from an `ee` folder or a deny-listed package in any git-listed source file (JavaScript, TypeScript, CSS, MDX), except the gate's own fixtures;
  - code that can ship importing a `DEV_ONLY_PATHS` path (tests, dev-tool configuration), and a file the scanner cannot read to the end.

  The policy and its reasons are at the top of the script. Never widen `ALLOWED_LICENCES` or `ALLOWED_EXCEPTIONS`, shrink `DENIED_PACKAGES`, or add to `DEV_ONLY_PATHS` to make a build pass: that is an owner decision, recorded in ADR 0007.
- **`scripts/licence-exemptions.json`** is the only way past the allowlist. Each entry needs `licence` (SPDX; `LicenseRef-…` for a proprietary licence), `reason` (the evidence) and `adr` (an existing `docs/adr/` file that names the package and is Accepted: the line right after its `# ` title reads `Status: Accepted`, optionally followed by ` (…)`, ` — …` or `.`, with no qualifier such as "superseded" or "in part"). Pin `version` (a string, or a list of exact versions when the same package is installed at several) when the evidence was read at one version; it is required when the package's declaration is not SPDX (`SEE LICENSE IN`, `UNLICENSED`, missing). An exemption stops applying when the package's declared licence changes, and the gate fails on a stale or unneeded entry. Delete an entry when its package leaves the tree. The README's "Third-party code and licences" section shows the planned tldraw entry (ADR 0001 D3); it is not live. A workspace that holds an `UPSTREAM.json` (a byte-for-byte mirror, such as `packages/ui`) is checked like any dependency, not as Islestone's own code.
- **Tests:** `tests/unit/licence-gate.test.ts` uses fixtures in `tests/fixtures/licence-gate/`. Those fixtures break the policy on purpose, so the gate's scan leaves `tests/fixtures/licence-gate/` out, and `tsconfig.json` and `eslint.config.mjs` leave `tests/fixtures/` out.

## Test conventions

- **Jest projects:** `node` runs `tests/unit/**/*.test.ts` and `tests/guards/**/*.test.ts`; `jsdom` runs `tests/rendered/**/*.test.{ts,tsx}`, co-located `src/**/__tests__/**/*.test.{ts,tsx}` and `packages/*/src/**/__tests__/**/*.test.{ts,tsx}`, with Testing Library, `@testing-library/jest-dom` and jest-axe's `toHaveNoViolations` (setup and DOM shims in `tests/setup/`); `integration` runs `tests/integration/**/*.test.ts` against a real Postgres, in band (`npm run test:integration`, CI job `Integration`). `npm test` runs `node` and `jsdom` only. The jsdom project maps `vaul`, `@number-flow/react` and `react-grid-layout/legacy` to mocks or their resolved files, and compiles the ESM-only packages the UI reaches (`ESM_PACKAGES` in `jest.config.mjs`); a new ESM-only dependency a rendered test reaches goes on that list. `__mocks__/next-intl.js` is applied automatically and resolves every key against `messages/en.json`, so a missing key shows as the key itself in a failing assertion. The transformer is `@swc/jest`; `tsc` owns type errors. Plain ESM scripts (`scripts/*.mjs`) are compiled to CommonJS for Jest the same way, so a test can import them; each gets a `.d.mts` beside it for its types.
- **Script tests:** `tests/unit/**/*.test.mjs` run under `node --test` (`npm run test:scripts`, in `verify` and in CI's `Test` job), not Jest, whose projects match `.ts`/`.tsx` only. `tests/unit/ui-drift.test.mjs` checks `scripts/ui-drift.mjs` and `tests/unit/ui-mirror.test.mjs` checks `scripts/ui-mirror.mjs`; the last case of each verifies the real mirror.
- **Copied tests.** Most tests under `tests/` that exercise the shared UI were copied from inflect-compliance (`PROVENANCE.md`); they are Islestone-owned and may be edited, recorded in their row. `tests/helpers/source-blocks.ts` (`codeOf`, `cssCodeOf`, `declarationOf`, …) is how those tests bound a source read; `tests/helpers/compile-globals-css.mjs` compiles `globals.css` for the tests that check the emitted layers.
- **Env in Jest:** `@/env` and `@/env-client` map to `tests/mocks/env.ts` (t3-env is ESM-only), which reads `process.env` live; a test sets a variable for itself and restores it. `jest.setup.ts` sets `SKIP_ENV_VALIDATION=1`.
- **Integration suites** gate on `DB_AVAILABLE` from `tests/integration/db-helper.ts` (`const describeFn = DB_AVAILABLE ? describe : describe.skip`), which fails closed: an unreachable database throws unless `ALLOW_DB_SKIP=1`, which CI never sets. The project's global setup runs `prisma migrate deploy` on the test database, and `tests/setup/integration-env.ts` points `DATABASE_URL` at it before `@/lib/prisma` loads. Use `prismaTestClient()` and `resetDatabase()` from `tests/helpers/db.ts` (TRUNCATE fires no row triggers, so the last-owner guards do not block it); never mock Prisma there. Prove isolation through `runInTenantContext`, which runs as `app_user`: the test client connects as the login role and sees every row.
- **Guards** (`tests/guards/`) check source structure. A guard takes its file population from git (`gitFiles()` in `tests/helpers/git-files.ts`, i.e. `git ls-files --cached --others --exclude-standard`), never from a directory walk with a skip list, and proves itself against a planted fixture (a throwaway git repository in a temp directory) so it cannot pass by checking nothing.
- **Rendered tests** query by role or label.
- **E2E** (`tests/e2e/*.spec.ts`) runs Playwright against `next start` on port 3100, so build first. Set `PW_CHROMIUM_PATH` to use a preinstalled Chromium. Traces are off by default.
