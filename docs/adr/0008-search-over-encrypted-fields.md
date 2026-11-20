# 0008 — Search over encrypted fields

Status: Accepted (owner decisions 124 to 126, 2026-11-20): a plaintext full-text index over work-item descriptions and comment bodies (D1, option C), Bulgarian and English stemming through one custom text-search configuration (D2, revised by the owner), the token key moot (D3)

## Context

ADR 0002 §11 puts `WorkItem.description` and `Comment.body` in the field-encryption manifest and decided S1 (search titles, keys and plaintext fields only) "until a search ADR chooses between S2 and S3", due before roadmap 2.7. Roadmap 2.7 asks for Postgres full-text search over items and comments, inside the filter popover and the command palette. ADR 0005 §6.4 deferred searching pages' plain-text projection to the same decision. Roadmap 6.5 adds embeddings.

What field encryption protects. A field in the manifest is encrypted by the Prisma extension (`src/lib/db/encryption-middleware.ts`) under the workspace's data key before it reaches Postgres, so anyone who reads the database without the application's keys sees ciphertext: a stolen dump, an off-host backup (`deploy/backup.sh` copies to a GCS bucket), a read replica, a database operator. Row-level security protects only against the application's own queries. Any search structure stored in the database is read by those same people.

- **Verified** (2026-11-20). Islestone's list filter `q` searches `title` with `ILIKE` and an exact key (`src/app-layer/repositories/WorkItemRepository.ts`, `_buildWhere`); there is no full-text index and no `/search` route (`src/components/command-palette/use-entity-search.ts`, `ENTITY_SEARCH_AVAILABLE = false`).
- **Verified** (2026-11-20). Postgres never sees the plaintext of an encrypted field: the extension encrypts before the query is built, so neither a trigger nor a generated column can derive a search vector from it.
- **Verified** (2026-11-20). The database image is `pgvector/pgvector:0.8.7-pg17-trixie` (PostgreSQL 17) in `docker-compose.yml`, `deploy/docker-compose.prod.yml` and CI. Postgres ships Snowball stemmers for English and other languages but none for Bulgarian; it reads Hunspell dictionaries through its `ispell` template from files in `$SHAREDIR/tsearch_data`, which the stock image does not carry for Bulgarian.
- **Verified** (inflect-compliance at `5528464fc54a8681956f3b9ce23ca9c075f0420e`). inflect searches plaintext titles by substring (`src/app-layer/usecases/search.ts`); its knowledge store keeps chunk text encrypted and its owner chose a keyed blind-token index for lexical search, recommending against a plaintext `tsvector` (`docs/ai-architecture/weaviate.md`, decisions D-L4-2 and D-L4-7).
- The porting map (`docs/porting/maps/2.7.md`, open question 1) recommended keyed word tokens (S3). The owner chose the plaintext index with the trade-off put explicitly (below).

## Decision

### D1. How encrypted descriptions and comments are searched

Options as put to the owner:

- **A. S3, keyed word tokens.** Whole words, no readable words in the database; no prefixes, no stemming, coarse ranking.
- **B. S3 plus prefix tokens.** As A, with partial words; about four times the rows and more frequency signal.
- **C. S2, a plaintext `tsvector`.** Postgres full-text search with stemming, ranking and phrase queries. The searchable words (stemmed lexemes, with positions) of every description and comment are stored readable in Postgres, and so in every dump and every off-host backup.
- **D. S1 only.** Comments stay unsearchable.

**Decision: C.** Owner decision 124, 2026-11-20 (relayed by the coordinator, who put the trade-off to the owner explicitly: the searchable words of descriptions and comments will be readable in Postgres, every dump and the off-host backups; the owner confirmed). This differs from the recommendation (A).

What this means, stated plainly so nobody reads the manifest and thinks otherwise:

- `WorkItem.description` and `Comment.body` stay encrypted at rest. Their **search vectors are not**: a `tsvector` holds the normalised words of the text and their positions, enough to reconstruct most of it. For these two fields, field encryption no longer protects the words against a reader of the database, a dump or a backup; it still keeps the exact text, punctuation and stop words out of them, and it still protects every field this ADR excludes.
- Row-level security, the tenant-leading index and the explicit `tenantId` filter apply to the vectors as to every tenant table.

#### What is indexed, and why

1. **`WorkItem.title`** (plaintext already, ADR 0002 §11) and the item key: titles are what people search for first, and they are already readable, so indexing them adds no exposure. An expression index `to_tsvector('islestone_bg_en', "title")` (D2), plus a trigram index for substring matches, on `WorkItem`. No new stored column.
2. **`WorkItem.description`**: one search vector per item. Roadmap 2.7 asks for full-text search over items; the description is where an item's words are.
3. **`Comment.body`**: one search vector per live comment. Roadmap 2.7 names comments; under S1 they could not be searched at all.
4. **`Project.name`** (plaintext): an expression index, for the palette.

Nothing else.

#### What is excluded, entirely

No search vector, index or other derivative is stored for:

- **Intake requests**: `IntakeRequest.body`, `answersJson`, `declineExplanation`, `internalRemark`, and 2.6c's follow-ups. A request is not a work item (ADR 0002 "Consequences"), and its text is an outsider's until a person accepts it; it reaches the index only after acceptance, as the new item's description, through the ordinary create path.
- **Encrypted template text**: `WorkItemTemplate.description`.
- **Project-template content**: `ProjectTemplate.contentJson`.
- **Personal data**: every field in `PII_FIELD_MAP` (`src/lib/security/pii-middleware.ts`): a user's email and name, OAuth tokens, the outbox address, the intake requester's name and address, and any field added to it later.
- Every other field in the encryption manifest not listed under "What is indexed", notification text, audit details and the transition record.
- Pages' plain-text projection (ADR 0005 §6.4, roadmap 4.1) and embeddings (roadmap 6.5): each needs its own amendment to this ADR before it is built.

A new searchable source is an amendment to this ADR, never a code change alone.

#### The stored form

- A table `SearchVector` (workspace table: `tenantId`, `workItemId`, nullable `commentId`, `lexemes` of type `tsvector`, the text-search configuration name, a revision number, `updatedAt`), one row per indexed source: a description row (`commentId` NULL) and one row per live comment, each unique by a partial unique index. `lexemes` is `Unsupported("tsvector")` in Prisma; a GIN index leads with `tenantId` (`btree_gin`). RLS (`tenant_isolation`, `tenant_isolation_insert`, `superuser_bypass`, FORCE), its own grants and a two-tenant test, like every tenant table.
- The column is **classified honestly**. `tests/guards/encryption-manifest-coverage.test.ts` scans `String` columns only, so 2.7f extends it: every `Unsupported("tsvector")` column must be listed in a new class of deliberate plaintext derivatives of encrypted fields, each entry citing this ADR and naming its sources, kept apart from `NOT_SENSITIVE` (columns that hold nothing sensitive). `docs/encryption.md` says the same.
- Workspace exports leave it out (it is rebuilt from the encrypted text, never exported).

#### Keeping it in sync

- **Writes.** Only the usecase holds the plaintext, so the vector is written by the usecase, in the same transaction as the encrypted text, through one repository method (`SearchVectorRepository`), the only module that issues SQL against the table: `to_tsvector('islestone_bg_en', $1)` with the sanitised plaintext as a bind parameter. The paths: `createWorkItemInTx` (so intake accept, repeat copies, template starter items and sub-items inherit it), `insertTemplateItemInTx`, the description update, comment add and comment edit. A guard lists every write of `WorkItem.description` or `Comment.body` and fails when one does not call the seam.
- **Edits.** An edit replaces the row in the edit's transaction; a description cleared to empty deletes the description row. A rolled-back write rolls its vector back with it.
- **Soft deletes.** Deleting a comment deletes its row in the same transaction (a deleted comment is never found). Soft-deleting an item keeps its rows, so a restore needs no rebuild; every search read joins `WorkItem` and filters `deletedAt` and project visibility (`projectVisibilityWhere`), as every work-item read does.
- **Purge.** The rows reference their item and comment with `ON DELETE CASCADE`, so the 30-day work-item purge and a comment's hard delete remove them.
- **Workspace purge.** The rows also reference the workspace (`tenantId` → `Tenant`) with `ON DELETE CASCADE`, so deleting a workspace removes every vector it holds with its items, and none outlives it. The purge's test asserts the table holds no row for the purged workspace.
- **Moves** change nothing: the row follows the item id.
- **Rebuild.** A job, `search-index-rebuild`, reads each source through the normal (decrypting) client in pages and rewrites its row: scheduled nightly for rows missing or at an older revision (the backfill on first deploy, and after any change to the configuration, its dictionary or the normaliser, which bumps the revision), and on demand for one workspace by an admin, audited. A configuration change is a revision and a rebuild, never a data migration.
- **Key rotations** need nothing: the vectors are not encrypted.

#### Handling the plaintext on the way in

The plaintext crosses to Postgres as a bind parameter of the write and of the query (`websearch_to_tsquery('islestone_bg_en', $1)`). It is never logged by the application (no query text in logs, audit entries or metrics), and the database keeps its defaults that keep parameters out of its own logs (`log_statement = none`, `log_parameter_max_length_on_error = 0`); `docs/deployment.md` records both. Descriptions are capped before vectorising so the vector stays under Postgres's size limit.

### D2. Language

Options as put to the owner:

- **A.** Language-neutral (`simple`, no stemming).
- **B.** English stemming (`english` configuration) for documents and queries alike.
- **C.** A language per workspace.

**Decision: Bulgarian and English stemming, in one configuration for every workspace.** Owner decision 126, 2026-11-20, revised by the owner after first choosing B, so that text in either language, in any workspace, is stemmed:

- **One custom text-search configuration, `islestone_bg_en`**, copied from Postgres's default parser. Latin-letter words (the parser's `asciiword`, `asciihword`, `hword_asciipart`) map to Postgres's built-in `english_stem` (Snowball), with Postgres's English stop list. Other-letter words (`word`, `hword`, `hword_part`: Cyrillic, and accented Latin) map to a Bulgarian Hunspell dictionary, then `simple`, so a word the dictionary does not know is still indexed as typed. Numbers and the other token types keep the default mapping.
- **The Bulgarian dictionary** is the open-source Hunspell `bg_BG` dictionary, installed as Postgres `ispell`-template files (`.dict`, `.affix`, in UTF-8) in Islestone's own Postgres image, built `FROM` the pinned pgvector image. Postgres ships no Bulgarian stemmer.
- **Everything uses it**: the title and project-name expression indexes, the stored vectors and every query. The configuration name is stored on each row, so a later change (another language, a per-workspace configuration) is a revision and a rebuild.
- **Fail closed, never silently degraded.** The migration that creates the dictionary and the configuration fails if the dictionary files are missing, and then asserts by query that a fixed list of Bulgarian inflections stems to their lemmas; a failed migration holds both images at `wait-for-migrations`. The app and the worker check the configuration and the same fixtures at startup (`src/instrumentation-node.ts`, `scripts/worker.ts`) and refuse to start in production when either is missing; `/api/readyz` reports the failure by a closed error string. No code path names another configuration or falls back to `simple` or `english` when the dictionary cannot be read.

What it costs, recorded for 2.7f to measure:

- **A custom Postgres image**, used everywhere the database runs: production (`deploy/docker-compose.prod.yml`), CI's `Integration` and `DAST` services, the local `docker-compose.yml`. A backup restores only into that image, because the title indexes depend on the configuration; the restore drill uses it.
- **Licence.** The dictionary is third-party data shipped in an image. 2.7f verifies its licence at the commit it takes, pins it, and records it in `PROVENANCE.md` and `NOTICE`. If the licence is not one ADR 0007 admits, 2.7f stops and asks the owner.
- **Memory.** Postgres loads an `ispell` dictionary into each backend on first use; 2.7f measures the per-backend cost against the database's `mem_limit` and PgBouncer's pool size.
- **Fit.** Postgres's `ispell` template reads Hunspell affix files with limits; 2.7f proves the stems on the fixture list before pinning, and stops and reports if the chosen dictionary cannot be read.

### D3. The token key

**Moot.** Owner decision 125, 2026-11-20: with D1 option C there are no keyed tokens, so there is no key to derive.

### Open questions for the owner

None.

## Consequences

- Search in the palette and the filter popover finds words in titles, descriptions and comments, in Bulgarian and English, with stemming, ranking and phrase queries.
- **The searchable words of every description and comment are readable in the database, in every dump and in the off-host backups.** Anyone who obtains a backup obtains them. A workspace that needs those texts unreadable outside the application cannot have them searched under this decision.
- Every write path of a description or comment must call the search seam; a guard holds the list.
- The encryption-manifest guard carries a class of its own for deliberate plaintext derivatives, so the derivative is visible to every reader of the guard.
- Islestone runs its own Postgres image, and the database refuses to migrate, and the app to start, without the Bulgarian dictionary.
- ADR 0002 §11's S1 is superseded for descriptions and comments.

## What would change this decision

- A customer, contract or regulator that forbids any readable derivative of encrypted text: move to keyed tokens (option A) for that deployment or for all, a rebuild of `SearchVector`.
- A backup or database exposure: the vectors are part of what leaked.
- A need to search another encrypted or personal field: an amendment, weighed field by field.
- A third language, or a workspace whose language is neither: a configuration per workspace (option C), a revision and a rebuild.
- The Bulgarian dictionary's licence or upkeep fails 2.7f's check: the owner chooses another dictionary or drops Bulgarian stemming (Cyrillic words then indexed as typed through `simple`, by decision, never by fallback).

## References

- Roadmap (`docs/ROADMAP.md`): 2.2 (descriptions and comments encrypted), 2.7, 4.1, 6.5.
- ADR 0002 §11 (encryption and the search options S1 to S4); ADR 0005 §6.4 (page projections); ADR 0007 (third-party licence exceptions).
- `docs/porting/maps/2.7.md` (parts 2 and 3, open questions 1 to 3); `docs/HANDOFF.md` decisions 124 to 126.
- inflect-compliance at `5528464fc54a8681956f3b9ce23ca9c075f0420e`: `src/app-layer/usecases/search.ts`, `src/lib/search/rank.ts`, `docs/ai-architecture/weaviate.md` (D-L4-2, D-L4-7). Pattern reuse: the search usecase and ranking are copied in 2.7b (`PROVENANCE.md`); nothing else.
- PostgreSQL 17 documentation: text search (`to_tsvector`, `websearch_to_tsquery`, configurations and parsers, the `ispell` template and Hunspell dictionaries, GIN), `btree_gin`, `pg_trgm`, `log_parameter_max_length_on_error`.
