# Pages

Sub-phase 4.1 (`docs/porting/maps/4.1.md`; ADR 0015; ADR 0006 "Page words of sub-phase 4.1"; owner decisions 338 to 374). This page describes what is built. **4.1a is built**: pages and the tree, their routes, the purge and the rebalance, the `pages` permission domain, title search, Workspace pages, a project's Pages and a page's own view. The collaboration server and the editor (4.1b), mentions, embeds and links (4.1c), comments (4.1d), versions and export (4.1e), search over bodies and comments (4.1f) and rich text in work items (4.1g) are not built: a page holds no content yet, and its body area says so.

"Page" is the word (ADR 0006): never Doc, Document, Wiki, Note or Article. A workspace's own pages are "Workspace pages"; a project's are its "Pages". There is no "space".

## Two kinds of tree, one table (decision 341)

A page is in a project's tree (`Page.projectId` set) or the workspace's (`projectId` NULL), under a parent in the **same** tree (`parentId`; NULL at the top level), ordered among its siblings by hand. Pages nest at most ten levels: a top-level page is level 1.

`prisma/schema/pages.prisma`; migration `20261230120000_pages`:

| Column | What it holds |
|---|---|
| `title` | Plaintext, sanitised (`sanitizePlainText`), 1..200 characters (CHECK `Page_title_length`, decision 343): the tree, the breadcrumb, notifications and search read it without opening the content. |
| `sortKey` | A fractional index among its siblings (ADR 0002 §5), `COLLATE "C"`, computed by the server from "after X, before Y" under the page-tree lock. A sort key change does not bump the version. |
| `version` | The row's title and placement, never the body: a rename names it (`If-Match`). |
| `parentId` | `(parentId, tenantId)` → `Page(id, tenantId)`, NO ACTION **DEFERRABLE INITIALLY DEFERRED**, like the work-item parent link, so a subtree move or a purge is one transaction. Never its own parent (CHECK). |
| `projectId` | `(projectId, tenantId)` → `Project`, cascading with the project's purge. |
| `deletedAt`, `deletedByUserId`, `deletionId` | Soft delete in groups (both or neither, CHECK `Page_deletion_group`). |
| `contentUpdatedAt` | Set by the collaboration server's store path (4.1b); NULL until then. |
| `createdByUserId` | An actor stamp, no key (a page outlives its creator's membership). |

**Same tree, always.** A composite key cannot carry a nullable scope column, so the deferred constraint trigger `page_same_scope` checks every inserted or re-parented row at commit: its parent's `projectId` equals its own, and so does every child's. The usecases check the same first; the trigger is the backstop for any writer.

**The live tree reads** spell their predicates as two partial indexes do (Prisma cannot declare either; the drift check ignores them): `Page_live_project_tree` on `(tenantId, projectId, parentId, sortKey) WHERE deletedAt IS NULL AND projectId IS NOT NULL`, and `Page_live_workspace_tree` on `(tenantId, parentId, sortKey) WHERE deletedAt IS NULL AND projectId IS NULL`.

`PageContent` is a page's content row: the encoded Yjs state as base64 text (`state`, decision 346), its ProseMirror JSON projection (`contentJson`) and its text projection (`plainText`), each in the encryption manifest, with `schemaRevision` (0: nothing projected yet) and `stateBytes`. A create writes it empty in the same transaction; only the collaboration server's store path writes it (4.1b). It has its own `id` because the key-rotation sweeps page every manifest table by `id`. `app_user` holds no DELETE on it: a content row goes with its page's cascade.

Both tables are tenant tables with the standard policies; `app_user` holds DELETE on `Page` for the purge alone.

## The tree lock and the write queue

Every write that changes a tree (a create, a move, a reorder, a delete, a restore, a purge pass, a rebalance) first waits its workspace's turn in the process (`inPageTreeQueue`, the one queue implementation of decision 254, one at a time per workspace), then takes `lockPageTree(tenantId)` (`pg_advisory_xact_lock(hashtext('page-tree:' || tenantId))`) as its transaction's first statement, then locks the page rows it changes in id order (`PageRepository.lockForWrite`, decision 173). `lockPageTree` throws outside the queue. One lock serves both kinds of tree: a move between trees changes both. A rename takes no tree lock: it is a versioned write of one row.

The rules (`src/app-layer/domain/page-tree.ts`, pure): a move under the page itself or a page below it is 409 `PAGE_WOULD_CYCLE`; past ten levels 409 `PAGE_TOO_DEEP`. Deleted pages count, so a restore can never break either rule. The walks (`PageRepository.chainUp`, `subtree`) are depth-capped, path-guarded recursive statements.

## Visibility (decision 342)

A page is never narrower than its tree. A project page is readable exactly when its project is visible (`visibleProjects`: every role but Guest) and live; a workspace page by every holder of `pages.view`. A page in an invisible or deleted project, and a deleted page, is a 404 (`PAGE_NOT_FOUND`), never a 403. An archived project's pages are readable and take no write: 409 `PROJECT_ARCHIVED` for a create, rename, move into or out of it, delete or restore. Per-page restriction waits for 8.4's grants.

## Create, rename, move

- **Create** (`POST /pages`, `pages.create`): a tree (`projectId`, or `null` for the workspace's), an optional live parent in that tree (else 404 `PARENT_NOT_FOUND`) that a subpage still fits under, a place (`afterId` or `beforeId` a live sibling, else 400 `PLACEMENT_NOT_SIBLING`; last by default) and a title ("Untitled" when empty). Audited `PAGE_CREATED`.
- **Rename** (`PATCH /pages/:id { title }`, `pages.edit`): `If-Match` required (428 without it); a stale version is 409 `VERSION_CONFLICT` with the current row. Audited `PAGE_RENAMED` with the old and new title (titles are plaintext, named as work-item titles are).
- **Move** (`POST /pages/:id/move { projectId, parentId, afterId?, beforeId? }`, `pages.edit`, `If-Match` optional): to a new parent and a place, in the page's own tree or another (a project to the workspace, the workspace to a project, one project to another). The page's whole subtree, **deleted rows included**, takes the new tree in one transaction, so every row stays in its parent's tree and a later restore lands in the right one. Moving up or down among siblings is the same call naming the neighbour. Audited `PAGE_MOVED` with both parents and trees.

## Delete, restore and the purge (decision 344)

- **Delete** (`DELETE /pages/:id`, `pages.delete`, through the undo toast in the browser): the page and its live subtree, under one new `deletionId`; audited `PAGE_DELETED`. From 4.1b it also closes every open connection to them. There is no page archive: an archived project makes its pages read-only.
- **Restore** (`POST /pages/:id/restore`, `pages.delete`): only through the group's root (409 `DELETED_WITH_PARENT`, naming the root), only under a live parent (409 `PARENT_DELETED`) in a live, unarchived project. A root whose kept sort key a live sibling now holds comes back right after that sibling. Audited `PAGE_RESTORED`.
- **The Deleted list** (`GET /pages/deleted?scope=workspace|projectId=`, `pages.delete`): each deleted group's root in one tree, newest first, with the group's size.
- **The purge** is the nightly `page-purge` (02:50 UTC): groups deleted more than `PAGE_PURGE_DAYS` (30) ago, under the tree lock, whole groups only, rows locked in id order, content cascading; one counts-only `PAGES_PURGED` per workspace, never a title. A page's descendants that are not in its group were all deleted before it (a delete takes the live subtree), so an older group always goes first.
- **The rebalance** is the nightly `page-sortkey-rebalance` (03:55 UTC): a sibling group with a sort key past 64 characters is rewritten in order, deleted rows keeping their place, in one statement, under the tree lock.

## Title search (decision 347's titles)

`GET /pages/search?q=` (`pages.view`; optionally one tree) answers live pages whose title holds the query or all its words, best first: the SECURITY DEFINER function `search_page_titles` (decision 245's pattern: owned by `app_search_definer`, the workspace from `app.tenant_id`, the page's `deletedAt` and its tree in its own `WHERE` — a workspace page, or a page of a live, unarchived, visible project — bounded to 100, ids and ranks only) on the GIN indexes `Page_search_title_trgm` and `Page_search_title_fts`, then the rows by id under row-level security. An archived project's pages are left out, as the item search leaves its items out. The move dialog's parent search reads it. The command palette's Pages group, with page bodies and comments, is 4.1f's (`PageSearchVector`, an ADR 0008 amendment).

## Keys (decision 339)

The `pages` domain replaced the unused `docs` domain ("Doc" is banned for a page, and a key is customer-facing): `pages.view`, `pages.create`, `pages.edit` (rename, move, reorder; from 4.1b the body and versions), `pages.comment` (4.1d), `pages.delete` (delete, restore, the Deleted list). Owners, Admins and Members hold all; Viewers `view`; a Guest nothing until 8.4 (decision 204). Stored custom roles' `docs` grants were rewritten to `pages` by migration `20261230120100_pages_permission_domain` (`view`, `create` and `edit` kept; `comment` and `delete` taken from `edit`); it queues one counts-only `CUSTOM_ROLES_DOMAIN_RENAMED` per workspace on the audit outbox, which the `audit-outbox-flush` drain appends to the hash chain within five minutes (a migration cannot compute the chain's hash).

Pages read what they offer from the server (`pageAffordances` in `src/app-layer/policies/page.policies.ts`: view, create, edit, delete, nothing but view in an archived project's tree); a component never checks a role or a key.

## Routes

| Route | Key | What |
|---|---|---|
| `GET /pages?scope=workspace\|projectId=&parentId=&after=` | `pages.view` | One parent's live children in order, 200 at a time (`nextAfter`), each with its live subpages counted |
| `POST /pages` | `pages.create` | Create a page |
| `GET /pages/search?q=` | `pages.view` | Pages by title |
| `GET /pages/deleted?scope=workspace\|projectId=` | `pages.delete` | A tree's Deleted list |
| `GET /pages/:id` | `pages.view` | The page, its tree, its ancestors (one statement), its level, its first subpages, `affordances` |
| `PATCH /pages/:id` | `pages.edit` | Rename (`If-Match` required) |
| `DELETE /pages/:id` | `pages.delete` | Delete with its subtree |
| `POST /pages/:id/move` | `pages.edit` | Move with its subtree |
| `POST /pages/:id/restore` | `pages.delete` | Restore a group through its root |

Every route is a literal `requirePermission` with a rule in `route-permissions.ts` and a row in the permission matrix (`tests/integration/permission-matrix/`, root `pages`). The usecases are `src/app-layer/usecases/page.ts`, the repository `PageRepository`.

## The pages (4.1a)

- **Workspace pages** (`/t/<slug>/pages`, a main page) and **a project's Pages** (`/t/<slug>/projects/<KEY>/pages`, reached from the project page's "Pages" link for a reader of pages): the tree's top level; each row links to its page, expands to its subpages (read when opened, a page at a time with "Load more"), and offers "New subpage", "Rename", "Move…", "Up", "Down" and "Delete" where the server offered them; "New page"; and, for a holder of `pages.delete`, the Deleted list with "Restore".
- **A page** (`/t/<slug>/pages/<id>`, whichever its tree, so a move keeps its address): the breadcrumb from its tree through its ancestors, the header's actions, the body area (empty until 4.1b) and its subpages.
- **The Pages sidebar entry** is built and held back (`PAGES_IN_SIDEBAR` in `nav-config.ts`) until 4.1b merges the editor.

Components are `src/components/pages/` (the data hook `use-pages.ts`, whose delete goes through the undo toast and is in `SITE_CONTRACTS`); the server reads `src/lib/server/page-pages.server.ts`; client-safe shapes `src/lib/pages/types.ts`. Copy is `pages.*`.

## Performance

Page joined the plan checks' guarded tables (no sequential scan) once the scale seed held pages: about 1,100 at 10k and 10,200 at 100k, nested up to five deep, with a few deleted leaves and every page's empty content row (`scripts/seed-scale/pages.ts`). Plan checks: a tree's top level (a project's and the workspace's), a page's subpages, the breadcrumb, a subtree, the Deleted list and the title search; statements per request: a page (budget 7) and a tree's top level (5). Every page budget was set by estimate, not measured, when 4.1a landed (`docs/performance.md`).
