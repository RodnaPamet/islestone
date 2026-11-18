# Provenance

Where outside code, data and design came from, under which licence, and what Islestone changed. Roadmap principle 6 requires it: every port is recorded with its source repository, commit, licence and changes. Hardening gate H0 adds that a port candidate's LICENSE file is re-read, and its commit pinned here, before first use.

This file covers what was **taken from a source**: copied code, adapted code, data, and designs or patterns learned by reading. Ordinary npm dependencies are not listed. They stay in their own packages, and the licence gate (`npm run licence:check`, `scripts/licence-gate.mjs`) checks each production dependency's licence on every pull request.

## How to add an entry

- Add a row in the same pull request as the code it covers.
- **Source** names the repository and the path that was read.
- **Commit** is the full commit hash that was read. For a source that is not a git repository, give the exact version, for example an npm version.
- **Licence** is the licence in force at that commit, read from its LICENSE file, not from a README or a registry page.
- **What was taken** says whether code was copied, adapted, or only read for a pattern. Use the words "pattern only, no code copied" when nothing was copied.
- **Changes** says what Islestone did differently.
- When code is copied, also add the attribution that its licence requires to [`NOTICE`](NOTICE).

## inflect-compliance: BUSL-1.1, no grant recorded yet

inflect-compliance is licensed under the Business Source License 1.1, and Inflect Ltd. is the licensor. Islestone has no recorded written grant to use its code. [ADR 0001](docs/adr/0001-code-provenance-and-licences.md) sets out the decision (D1) and the interim rule that applies until it is signed:

- read inflect-compliance to learn its design;
- copy no code from it;
- record each pattern adopted here, as "pattern only, no code copied".

Every inflect-compliance row below is therefore pattern only. Once ADR 0001 records the grant, a port copies code and its row says so. The row then carries the licence the grant names, which may still be BUSL-1.1 for the ported files.

All rows were read in the sibling checkout at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e` (2026-11-17, "chore(release): 3.404.0"), remote `github.com/RodnaPamet/inflect-compliance`.

## Adopted

| Component | Source (repository and path) | Commit | Licence | What was taken | Changes |
|---|---|---|---|---|---|
| `src/env.ts`, `src/env-client.ts`, `src/env-skip.ts` (sub-phase 1.1) | inflect-compliance: `src/env.ts`, `src/env-client.ts` | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. The two-module split: the server module has no client block, and the client module declares only `NEXT_PUBLIC_` keys. Both use `createEnv` with `skipValidation` and `emptyStringAsUndefined`. | Written fresh. `skipValidation` is true only for `1` or `true` (`src/env-skip.ts`). The parent reads it as `!!value`, so `"0"` also skips validation there. |
| `tests/guards/client-env-boundary.test.ts`, `tests/helpers/import-graph.ts` (1.1) | inflect-compliance: `tests/guards/client-reachable-modules-import-no-server-env.test.ts`, `tests/helpers/client-import-graph.ts` | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. A breadth-first walk from every `'use client'` root with the TypeScript compiler API, skipping type-only edges and reporting the chain through a parent map. The guard must not pass vacuously. A check of the client env module's keys. | Written fresh. Reports per entry. Parses the directive prologue from the AST. Reports unresolved and computed imports. Proves itself on a throwaway git repository. Asserts that the tsconfig alias matches the guard. |
| `tests/helpers/git-files.ts` (1.1) | inflect-compliance: `tests/helpers/repo-files.ts` | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. A source scan takes its file population from `git ls-files --cached --others --exclude-standard` and throws rather than falling back to a directory walk. | Written fresh. Clears inherited `GIT_*` variables and sets `GIT_CEILING_DIRECTORIES`, so it cannot list a parent repository. The licence gate's source scan uses the same approach. |
| `tests/mocks/env.ts` and the env mapping in `jest.config.mjs` (1.1) | inflect-compliance: `tests/mocks/env.ts`; `jest.config.js` (grep only) | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. One Proxy mock that reads `process.env` live, mapped for both env specifiers in every Jest project. | Written fresh. |
| `.github/workflows/ci.yml` (1.1) | inflect-compliance: `.github/workflows/ci.yml` (grep only) | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. Only the fact that it uses `actions/checkout@v7` and `actions/setup-node@v7`. | The workflow was written fresh. |
| `CLAUDE.md` (1.1) | inflect-compliance: `CLAUDE.md` | `5528464fc54a8681956f3b9ce23ca9c075f0420e` | BUSL-1.1 | Pattern only, no code copied. The general shape of an assistant guide: commands, layer rules, test conventions. | Written fresh. The layer rules come from the roadmap's global preamble (section 4). |

### Other sources used by sub-phase 1.1

| Component | Source | Commit or version | Licence | What was taken | Changes |
|---|---|---|---|---|---|
| Next.js 16 project conventions: `next-env.d.ts` gitignored, the `tsconfig.json` `include` entries, the flat ESLint config shape, the three-line `postcss.config.mjs` | `create-next-app` template, Vercel | npm `create-next-app@16.4.6` (no git commit read) | MIT | The conventions above. `postcss.config.mjs` is the template's three-line config, short enough that any correct version matches it. | Everything else was written fresh. |
| PgBouncer configuration in `docker-compose.yml` (local development only) | `edoburu/docker-pgbouncer`: its entrypoint script and LICENSE | Image `edoburu/pgbouncer:v1.26.1-p0`; the commit read was not recorded by 1.1 | MIT | Read to learn which environment variables the image accepts. Nothing copied. | Not applicable. The image runs only in the local development stack, and no code from it is in this repository. |

### Read and not used

- **inflect-compliance `license:check`** (`package.json` line 18) and **`LICENSING.md`** lines 42–46, at `5528464fc54a8681956f3b9ce23ca9c075f0420e`, BUSL-1.1. Read while writing Islestone's licence gate (sub-phase 0.3). Nothing was taken. The parent runs `license-checker` through `npx` against a deny-list. Islestone's `scripts/licence-gate.mjs` is an allowlist written from scratch with no dependencies. Its git-based file population is the pattern already recorded for `tests/helpers/git-files.ts`.

## Port candidates (not yet used — re-read LICENSE and pin a commit at first use)

These are the projects that roadmap section 2.2 lists as safe to translate from. **Nothing has been taken from any of them yet.** Each licence below is the one the roadmap states (checked 2026-11-18 by the roadmap's author), not one read for this file. Before a port starts, H0 requires the porter to:

- re-read the LICENSE file at the commit to be used;
- replace UNPINNED with that commit;
- move the row to **Adopted** with what was taken and what changed.

A repository listed as "located" was found with `git ls-remote` on 2026-11-18. No file in it was read.

| Component (planned use) | Source repository | Commit | Licence (as the roadmap states) | Notes |
|---|---|---|---|---|
| Kaneo: projects, tasks, subtasks, dependencies, custom fields, time entries, workflow rules, GitHub integration (2.1, 2.4, 5.3) | `github.com/usekaneo/kaneo` (located) | UNPINNED | MIT | React 19, Hono, Drizzle, Postgres. Translate its schema and logic into Prisma and usecases. |
| Paperclip: agent, goal, budget, heartbeat and run schema with atomic checkout locks (3.2, 6.3) | `github.com/paperclipai/paperclip` (located) | UNPINNED | MIT | Drizzle, Postgres. |
| Teable `packages/*`: field types and formulas (2.4) | `github.com/teableio/teable` (located) | UNPINNED | MIT for `packages/*` only. **The apps are AGPL** and must not be read for code. | Read the licence of each package separately (roadmap 2.4). |
| Cal.diy: availability and booking | `github.com/calcom/cal.diy` (located) | UNPINNED | MIT | Cal.com itself has been closed source since April 2026 (roadmap 2.2). Take only from Cal.diy, at a pinned commit. |
| Paca web: automation graph builder (5.1) | Not identified. The roadmap gives only the name. | UNPINNED | Apache-2.0 | Identify the repository and confirm its licence before use. Apache-2.0 requires its NOTICE file to be carried into [`NOTICE`](NOTICE). |
| ln-dev7/circle: Linear-style UI shell (2.3, layout ideas) | `github.com/ln-dev7/circle` (located) | UNPINNED | MIT | |

The projects that roadmap 2.2 marks **inspiration only** (Plane, OpenProject, Twenty and the rest of that list, plus the source-available ones) never get a row here. Islestone copies no code from them, whatever their licence allows.
