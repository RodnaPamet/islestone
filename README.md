# Islestone

Islestone is an AI-enabled project-management SaaS: one work-item table with many views, planning and forecasting computed in code, and agents that work as delegates of accountable people, writing through proposals a person approves unless a workspace owner raises a rung and the item's assignee started the session (ADR 0003).

**Status:** repository skeleton (roadmap sub-phase 1.1). There is no product yet: a placeholder home page, health endpoints, the env modules, the test and CI tooling, and a local service stack. What gets built, in which order, and the gate that closes each phase are in [docs/ROADMAP.md](docs/ROADMAP.md). Architecture decisions are in [docs/adr/](docs/adr/) ([index](docs/adr/README.md)). ADR 0001 (provenance and licences) and ADR 0007 (licence exceptions) are accepted. ADRs 0002 to 0006 are proposed and await the owner's sign-off, though 0003 and 0006 already record some owner decisions.

## Prerequisites

- **Node.js 24.** `.nvmrc` pins it (`nvm use`). `package.json` accepts `>=22.12 <25` so a contributor on Node 22 LTS can work, but CI and production run Node 24, and `.npmrc` sets `engine-strict` so npm refuses anything outside that range.
- **npm 10** or later (ships with Node).
- **Docker with Compose**, for the local Postgres, PgBouncer and Redis. Nothing in the skeleton connects to them yet.

## Getting started

```bash
npm ci
cp .env.example .env.local   # dev defaults only; never commit a real .env
docker compose up -d         # optional for now
npm run dev                  # http://localhost:3000
```

`next dev`, `next build` and `next start` validate the environment through `next.config.ts` and refuse to start with an invalid one. Set `SKIP_ENV_VALIDATION=1` to skip that (CI's build does). `npm run typecheck`, and so `npm run verify`, need no environment: a type check reads no runtime value, so `scripts/next-typegen.mjs` runs `next typegen` with validation off.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm run typecheck` | `next typegen` with env validation off (`scripts/next-typegen.mjs`), then `tsc --noEmit`, then `typecheck:ui`; needs no `.env.local` |
| `npm run typecheck:ui` | type-checks the shared UI mirror through `packages/ui/tsconfig.json` |
| `npm run ui:verify` | checks every file in `packages/ui` against `packages/ui/UPSTREAM.json` |
| `npm test` | Jest, both projects |
| `npm run test:unit` | Jest `node` project: `tests/unit`, `tests/guards` |
| `npm run test:rendered` | Jest `jsdom` project: `tests/rendered` |
| `npm run test:e2e` | Playwright against the built app (run `npm run build` first) |
| `npm run test:scripts` | `node --test` for the plain-ESM script tests (`tests/unit/**/*.test.mjs`), which Jest does not run |
| `npm run licence:check` | The third-party licence gate (below); `--json` for a machine-readable report |
| `npm run verify` | lint, typecheck, test, the script tests and the licence gate |

For Playwright with a Chromium already on the machine, set `PW_CHROMIUM_PATH` to its binary or to a directory containing it; otherwise run `npx playwright install chromium` once.

## Continuous integration

Every pull request, and every push to `main`, runs:

- `CI` (`.github/workflows/ci.yml`): Lint, Audit (`npm audit --omit=dev --audit-level=moderate`), Typecheck, Test, Licence, Shared UI (the `packages/ui` mirror against its manifest and upstream), Build and E2E.
- `CodeQL` (`.github/workflows/codeql.yml`): the `security-extended` queries over JavaScript/TypeScript and the workflow files. It also runs weekly.

Dependabot (`.github/dependabot.yml`) proposes npm and GitHub Actions updates weekly, keeping versions exact. Branch protection on `main` is a repository setting, not a file: require a pull request and these checks to pass before merging.

## Local services

`docker-compose.yml` runs PostgreSQL 17 with pgvector, PgBouncer in transaction mode in front of it, and Redis 7 with a password, all bound to `127.0.0.1`. The app's `DATABASE_URL` points at PgBouncer (port 6432). Every credential in the file is a development default; production values never live in the repository.

## Third-party code and licences

Roadmap sub-phase 0.3 sets the intake policy. Three files hold it:

- [`PROVENANCE.md`](PROVENANCE.md) records everything taken from another project: source, commit, licence and changes. It also lists the roadmap's port candidates, each unpinned until first use.
- [`NOTICE`](NOTICE) carries the attributions that copied code requires: Dub's and Nucleo's, for the shared UI in `packages/ui` (ADR 0001 decision D4).
- `scripts/licence-gate.mjs` (`npm run licence:check`, and the `Licence` job in CI) fails the build when:
  - a **production** dependency's licence is not on the allowlist. The allowlist is roadmap 0.3's: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, PostgreSQL, and MPL-2.0 for unmodified use only; plus 0BSD and the Unlicense, added by ADR 0007 (decisions E2 and E6). `L WITH X` passes only when `X` is an SPDX exception that adds permissions ("MIT WITH Commons-Clause" fails). Widening the list is an owner decision, recorded in [ADR 0007](docs/adr/0007-third-party-licence-exceptions.md).
  - any source file in the repository, except the gate's own test fixtures, imports from an `ee` folder (or n8n's `.ee.` files) or from a deny-listed package: n8n and its `n8n-*` and `@n8n/*` libraries, windmill-components, task-master-ai, @liveblocks/server, hyperformula, handsontable and `@handsontable/*`, planby, `@blocknote/xl-*`. The scan reads JavaScript, TypeScript, stylesheets and MDX, decodes escapes, and follows `#` imports and tsconfig aliases.
  - code that can ship imports test code, or the scanner cannot read a file to the end.

The policy is written out at the top of the script. The production tree is walked from the `package.json` files on disk, which must agree with the lockfile (`npm-shrinkwrap.json` when present, as npm prefers it). Dev-only dependencies are not checked, unless code that can ship imports them: Next.js bundles those just the same. `SEE LICENSE IN …`, `UNLICENSED` and missing licences fail until a person reads the licence and records an exemption.

### Exemptions

`scripts/licence-exemptions.json` maps a package name to an exemption. Each exemption has four fields:

- `licence`: the licence a person verified, as an SPDX expression. A proprietary licence uses a `LicenseRef-` identifier.
- `reason`: the evidence and the justification.
- `adr`: the decision record, which must exist, must name the package, and must be accepted: the line right after its `# ` title reads `Status: Accepted`, optionally followed by ` (…)`, ` — …` or `.`, and does not qualify the acceptance ("superseded", "in part", "partly", "pending" and the like make it not accepted).
- `version`: when given, the exemption covers only that version. It is required when the package's declaration is not an SPDX expression (`SEE LICENSE IN …`, `UNLICENSED`, missing), because there is then nothing else to bind the entry to.

An exemption applies only while the package still declares the licence it was granted for. The gate reports an exemption that is stale (the package has left the tree) or not needed (the licence is already allowed). An exemption cannot lift a deny-listed package. A workspace that holds an `UPSTREAM.json`, such as the `packages/ui` mirror, is checked like any dependency rather than as Islestone's own code, so it needs an exemption too.

Today the file holds 17 exemptions:

- the 14 `@img/sharp-*` packages ([ADR 0007](docs/adr/0007-third-party-licence-exceptions.md) E1): prebuilt libvips binaries under LGPL-3.0-or-later, which `next` installs through its optional `sharp` dependency for image optimisation. Each names the version whose README and integrity hash were checked.
- `caniuse-lite` (ADR 0007 E3; CC-BY-4.0, a browser-support database), bound to its declared licence rather than to a version.
- `@visx/vendor` (ADR 0007 E6), whose declaration `"MIT and ISC"` is not valid SPDX; the entry reads it as `MIT AND ISC`, pinned to 4.0.0.
- `@inflect/ui` ([ADR 0001](docs/adr/0001-code-provenance-and-licences.md) D1; BUSL-1.1), the shared UI mirror in `packages/ui`.

`tslib` (0BSD) and `robust-predicates` (Unlicense) need no exemption, because both licences are on the allowlist.

**Planned, not live: a tldraw exception.** [ADR 0001](docs/adr/0001-code-provenance-and-licences.md) decision D3 records the owner's choice of 2026-11-18: tldraw 3.x with the watermark visible (option 3a; the draft had recommended against it). Both `tldraw` and `@tldraw/editor` declare `SEE LICENSE IN LICENSE.md`, so each needs an entry like the one below once it is installed, with `version` pinned. This example is not in the exemptions file, because tldraw is not installed, and the gate would report the entry as stale:

```json
"tldraw": {
  "licence": "LicenseRef-tldraw-3",
  "version": "3.15.6",
  "reason": "tldraw licence at tag v3.15.6 (sha256 a051565874fd424cc9c19049d425ead719b9b7cf214546f31a368b4a3822755d): production use allowed with the watermark visible and unaltered. Owner decision of 2026-11-18: option 3a of ADR 0001 decision D3.",
  "adr": "docs/adr/0001-code-provenance-and-licences.md"
}
```

## Licence

BUSL-1.1, licensor Inflect Ltd.: see [`LICENSE`](LICENSE) and [`LICENSING.md`](LICENSING.md). `package.json` says `"license": "BUSL-1.1"`. Islestone is source-available, not open source; each version converts to Apache-2.0 on its Change Date. The owner decided this on 2026-11-18, and the same day allowed code to be copied from inflect-compliance, with every copied file recorded in `PROVENANCE.md`. [ADR 0001](docs/adr/0001-code-provenance-and-licences.md) records both decisions.
