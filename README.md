# Islestone

Islestone is an AI-enabled project-management SaaS: one work-item table with many views, planning and forecasting computed in code, and agents that work as delegates of accountable people, writing only through proposals a person approves.

**Status:** repository skeleton (roadmap sub-phase 1.1). There is no product yet: a placeholder home page, health endpoints, the env modules, the test and CI tooling, and a local service stack. What gets built, in which order, and the gate that closes each phase are in [docs/ROADMAP.md](docs/ROADMAP.md). Decisions are recorded in [docs/adr/](docs/adr/).

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

`next dev`, `next build` and `next start` validate the environment through `next.config.ts` and refuse to start with an invalid one. Set `SKIP_ENV_VALIDATION=1` to skip that (CI's build does).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm run typecheck` | `next typegen`, then `tsc --noEmit` |
| `npm test` | Jest, both projects |
| `npm run test:unit` | Jest `node` project: `tests/unit`, `tests/guards` |
| `npm run test:rendered` | Jest `jsdom` project: `tests/rendered` |
| `npm run test:e2e` | Playwright against the built app (run `npm run build` first) |
| `npm run licence:check` | The third-party licence gate (below); `--json` for a machine-readable report |
| `npm run verify` | lint, typecheck, test and the licence gate |

For Playwright with a Chromium already on the machine, set `PW_CHROMIUM_PATH` to its binary or to a directory containing it; otherwise run `npx playwright install chromium` once.

## Local services

`docker-compose.yml` runs PostgreSQL 17 with pgvector, PgBouncer in transaction mode in front of it, and Redis 7 with a password, all bound to `127.0.0.1`. The app's `DATABASE_URL` points at PgBouncer (port 6432). Every credential in the file is a development default; production values never live in the repository.

## Third-party code and licences

Roadmap sub-phase 0.3 sets the intake policy. Three files hold it:

- [`PROVENANCE.md`](PROVENANCE.md) records everything taken from another project: source, commit, licence and changes. It also lists the roadmap's port candidates, each unpinned until first use.
- [`NOTICE`](NOTICE) carries the attributions that copied code requires. There are none yet.
- `scripts/licence-gate.mjs` (`npm run licence:check`, and the `Licence` job in CI) fails the build when:
  - a **production** dependency's licence is not on the allowlist. The allowlist is MIT, MIT-0, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, BlueOak-1.0.0, CC0-1.0, Unlicense, Python-2.0, PostgreSQL, and MPL-2.0 for unmodified use only. CC-BY-4.0 is allowed only for named data-only packages, such as caniuse-lite.
  - a source file under `src/`, `packages/` or `scripts/`, or at the root, imports from an `ee` folder or from a deny-listed package (n8n, windmill, @liveblocks/server, hyperformula, handsontable, planby, @blocknote/xl-*).

The policy is written out at the top of the script. Dev-only dependencies are not checked. `SEE LICENSE IN …`, `UNLICENSED` and missing licences fail until a person reads the licence and records an exemption.

### Exemptions

`scripts/licence-exemptions.json` maps a package name to an exemption. Each exemption has four fields:

- `licence`: the licence a person verified, as an SPDX expression. A proprietary licence uses a `LicenseRef-` identifier.
- `reason`: the evidence and the justification.
- `adr`: the decision record, which must exist.
- `version`: optional. When given, the exemption covers only that version.

An exemption applies only while the package still declares the licence it was granted for. The gate reports an exemption that is stale (the package has left the tree) or not needed (the licence is already allowed). An exemption cannot lift a deny-listed package.

Today the file exempts the 14 `@img/sharp-*` packages: prebuilt libvips binaries under LGPL-3.0-or-later, which `next` installs through its optional `sharp` dependency for image optimisation. Each one names the version whose README and integrity hash were checked.

**Planned, not live: a tldraw exception.** ADR 0001 decision D3 picks the canvas library. If it chooses tldraw, both `tldraw` and `@tldraw/editor` declare `SEE LICENSE IN LICENSE.md`, so each needs an entry like the one below. This example is not in the exemptions file, because tldraw is not installed, and the gate would report the entry as stale:

```json
"tldraw": {
  "licence": "LicenseRef-tldraw-3",
  "version": "3.15.6",
  "reason": "tldraw licence at tag v3.15.6 (sha256 a051565874fd424cc9c19049d425ead719b9b7cf214546f31a368b4a3822755d): production use allowed with the watermark visible and unaltered. Chosen as option 3a of ADR 0001 decision D3.",
  "adr": "docs/adr/0001-code-provenance-and-licences.md"
}
```

Under a paid key (option 3b), the `licence` becomes the commercial licence's reference, and the `reason` records the key's term and renewal date. Under Excalidraw (option 3c), no exemption is needed if its dependency tree passes.

## Licence

Not chosen yet. Islestone's own licence is an open owner decision (roadmap 0.1), so `package.json` says `"license": "UNLICENSED"`: no licence is granted. Code from inflect-compliance (BUSL-1.1) is not copied into this repository until ADR 0001 records the written grant.
