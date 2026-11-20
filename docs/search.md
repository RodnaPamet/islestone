# Search

Sub-phase 2.7b, built by [`docs/porting/maps/2.7.md`](porting/maps/2.7.md) ("Part 2 — Search over titles and keys") under owner decisions 124 to 144 (`docs/HANDOFF.md`) and [ADR 0008](adr/0008-search-over-encrypted-fields.md) D1 item 1. This page records what 2.7b built: indexes over work-item titles and project names, the workspace search route, the command palette's entity search, and the list's `q` filter on the index. Descriptions and comments are encrypted and are not searched yet: 2.7f adds them through the plaintext full-text index ADR 0008 decided, with the Bulgarian and English configuration `islestone_bg_en`.

## What is searched

| Searched | How | Index |
|---|---|---|
| A work item's title | Substring (`ILIKE '%q%'`, case-insensitive) or every word of the query in any order (`simple` full text) | `WorkItem_search_title_trgm`, `WorkItem_search_title_fts` |
| A work item's key (`ISL-12`) | Exact, in any case: the current prefix, a retired one, or a key left by a move (`WorkItemKeyAlias`), as `GET /work-items/by-key/:key` resolves it | The unique `ProjectKeyPrefix (tenantId, prefix)`, `WorkItem (tenantId, projectId, number)` and `WorkItemKeyAlias (tenantId, projectId, number)` |
| A project's name | As a title | `Project_search_name_trgm`, `Project_search_name_fts` |
| A project's key prefix (`ISL`) | Exact, in any case | The unique `Project (tenantId, keyPrefix)` |

Never searched: descriptions and comments (until 2.7f), intake requests, template text and project-template content (decision 124), and any personal data.

Titles and project names are plaintext already (ADR 0002 §11), so indexing them adds no exposure.

## The migration

`20261203120000_search_titles`:

- `CREATE EXTENSION IF NOT EXISTS pg_trgm` and `btree_gin`. Both are contrib extensions, trusted since PostgreSQL 13 and shipped in the `pgvector/pgvector:0.8.7-pg17-trixie` image that production, CI's Integration and DAST services and the local `docker-compose.yml` run. Migrations run as the database's superuser (the one-shot `migrate` service in production, the `islestone` login in CI and locally), as `btree_gist` did in 2.5a; the runtime role (`islestone_app`, a member of `app_user`) never creates an extension. They are created in `public`, where the app's `search_path` finds `similarity()` and the operator classes.
- Four GIN indexes, each leading with `tenantId` (`btree_gin` lets a GIN index lead with a scalar) and covering live rows only (`WHERE "deletedAt" IS NULL`): a trigram index (`gin_trgm_ops`) and a full-text expression index (`to_tsvector('simple', …)`) on `WorkItem.title` and on `Project.name`.
- The `simple` configuration does not stem. 2.7f replaces the two full-text indexes with `islestone_bg_en` ones (decision 126, ADR 0008 D2), so titles, stored vectors and queries stem alike.

Prisma cannot declare these indexes; they live in the migration, and `npm run db:check-schema-drift` passes with them (Prisma's diff ignores partial and expression indexes, as it ignores 2.1's partial uniques), so the residue file is unchanged. `tests/integration/search.test.ts` checks the catalogue and that the planner uses them.

## The route

`GET /api/t/<slug>/search?q=<query>[&limit=<n>]` (`src/app/api/t/[tenantSlug]/search/route.ts`) answers a `SearchResponse` (`src/lib/search/types.ts`): hits ranked highest first, each with its type, title, subtitle (the item's key, the project's prefix), href and score, and `meta` with the query used, per-type counts, the cap and whether any type was cut.

- **Key.** A literal `requirePermission('projects.view', …)` with its rule in `route-permissions.ts`; the usecase asserts the same predicate (`assertCanReadWorkConfig`). Every built-in role holds it. Work items are a second domain: a caller without `work_items.view` (a custom role) gets project hits only and a work-item count of zero, never a refusal (inflect's per-domain skipping, `mayReadWorkItems`).
- **Visibility.** `visibleProjects(ctx)` goes to both reads, as SQL (`projectVisibilitySql`): a deleted item, a deleted or archived project, and a project outside a GUEST's grant (every project until 8.4) never match. The reads run in `runInTenantReadContext`, as `app_user` with the workspace set, so row-level security is a second layer under the reads' own `tenantId` filter.
- **Bounded.** `q` is trimmed and cut to 200 characters (a parameter longer than 1,000 is a 400); `limit` is the hits per type, 5 by default, at most 25 (`MAX_PER_TYPE_LIMIT`; more is a 400). Each read fetches at most three times the cap, and never more than 100 rows (`SEARCH_ROW_CAP`).
- **Private.** The query is a bind parameter, never part of the SQL text, and is never logged. `%`, `_` and `\` in a query match themselves (`escapeLike`, `src/lib/search/query.ts`).
- The read tier's rate limit applies at the edge, as for every workspace GET.

### Ranking

Each read is one raw query (`WorkItemRepository.searchTitles`, `ProjectRepository.searchNames`), because Prisma cannot order by a rank. The database orders candidates so the best make the cut: a typed key first, then an exact title, a title prefix, the full-text rank (`ts_rank`) and the trigram similarity, then the id. The usecase then scores each row with `computeRankScore` (`src/lib/search/rank.ts`, pure): an exact title or code (a key, a project's prefix) 100, a prefix 60, a substring 30, plus a baseline of 1 for a work item, so a typed key ranks first and a word match found in another order ranks below every substring hit. `sortHits` orders by score, then type, then id (by code unit), and `capPerType` keeps the best of each type.

## The command palette

`ENTITY_SEARCH_AVAILABLE` is true (`src/components/command-palette/use-entity-search.ts`): from two characters, and 180 ms after the last keystroke, the palette sends one request to the search route of the workspace in the URL and lists work items and projects under their headings, each with its key, and opens the hit's page on select. A failed request says so rather than "No results found". Outside a workspace the palette says search is available after sign-in.

## The list's `q` filter

The Work items page, a project's page and My Work send the filter popover's search box as `q` to `GET /work-items`. It matches a title substring (`title ILIKE '%q%'`, which the trigram index now serves under the filter's own `deletedAt IS NULL`) or an exact key, as before; the list keeps its own sort. `tests/integration/search.test.ts` captures the SQL Prisma renders for the filter and checks that the planner uses `WorkItem_search_title_trgm`. A query of fewer than three characters has no trigram, so the index then reads the workspace's whole entry; that is still bounded by the list's page.

## Tests

- `tests/integration/search.test.ts`: the catalogue, the planner, the usecase (two workspaces, a deleted item, an archived project, a GUEST, a custom role, a key, a move's alias, wildcards, the cap, RLS alone) and the route (200, the bound, 403 with `AUTHZ_DENIED`).
- `tests/unit/repositories/search-repository-predicates.test.ts`: both raw reads carry the workspace, `deletedAt`, visibility and the archived filter in their own `WHERE`, are bounded, and never put the query in the SQL text.
- `tests/unit/search/`: the ranking bands, the LIKE escaping, the limit and the query schema.
- `tests/rendered/command-palette-entity-search.test.tsx`: the palette's requests, rows, selection and failure.
- `tests/guards/tenant-crud-authz-coverage.test.ts` and `api-permission-coverage.test.ts`: the route's key.

## Provenance

The usecase, the ranking module, the route, and the palette and ranking tests are copied from inflect-compliance at `5528464fc54a8681956f3b9ce23ca9c075f0420e` (BUSL-1.1, the same licensor) and cut to Islestone's two hit types; `PROVENANCE.md`, "Search", lists each file and what changed.
