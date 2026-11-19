# 0005 — Data sync strategy

Status: Accepted (owner decisions, 2026-11-19)

## Context

Roadmap 0.2 item 5 asks for one decision: "server-authoritative data with optimistic UI now, Yjs for documents and canvas, a sync engine such as Zero deferred with the conditions that would reopen it."

Other parts of the roadmap depend on it:

- 2.2 adds a version column on work items and a 409 on conflict. 2.3 makes mutations optimistic with rollback.
- 4.1 adds pages with Yjs and a Hocuspocus server that "authenticates the session and checks tenant and page permission on every connection".
- 4.2 ports the canvas. 4.3 adds live updates for lists, boards and detail views "over a tenant-scoped channel backed by Redis pub/sub". "Messages carry ids and versions only; clients refetch through the normal authorised API." It also adds presence on items, pages and canvases.
- H1 requires that session revocation actually signs a person out. H4 requires that a user who loses access is disconnected from open collaboration sessions, with size caps, rate limits and server-side sanitisation of collaborative content.
- Principle 5: tenant isolation at the database. 9.3: local-first sync and offline are decided after launch; "Zero is the leading candidate; it must fit row-level security". 8.5 makes the product an installable PWA.

This ADR uses ADR 0006's words: workspace (code: `Tenant`, `tenantId`), work item, page, canvas, sign-in session, agent session. It builds on ADR 0002 section 9 (optimistic concurrency) and ADR 0003 (agents write through proposals), and does not restate them.

This ADR was drafted on 2026-11-18 with a recommendation for each decision. The repository owner accepted every recommendation in the working session on 2026-11-19 (the owner chose "Accept all"): no sync engine now, with section 7's reopen thresholds (E0); canvas persistence C1 and transport T1; TanStack Query as the client cache; item presence R1; encrypted Yjs state and snapshots, with page text searched under ADR 0002's S1 for now; one audit entry per person per page per 10 minutes; the limits in open question 10; and the new vocabulary words. Each decision is recorded where it is made. Open questions 8 and 9 remain open but do not block: they belong to roadmap section 7's open decision 5 (hosting) and to sub-phase 8.5.

How to read this ADR: a line marked **Verified** was read in the named file or registry on 2026-11-18. A line marked **Inference** is reasoning from verified facts. A line marked **Decision** records an owner decision of 2026-11-19. Everything else is the design this ADR fixes, or an open question.

### What Islestone has today

- **Verified.** `package.json` has five runtime dependencies: `@t3-oss/env-nextjs`, `next`, `react`, `react-dom`, `zod`. There is no client data cache, no Redis client and no Yjs.
- **Verified.** `docker-compose.yml` runs Postgres 17 with pgvector (line 19), PgBouncer in transaction mode in front of it (lines 1–2 and 35–36; `POOL_MODE: transaction` is line 50) and Redis 7.4 (line 66).
- **Verified.** There is no database schema yet (`CLAUDE.md`, "Current state").

### What inflect-compliance has built, and what it has not

Read at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`, for their design; nothing was copied. ADR 0001 D1 (owner decision, 2026-11-18) now allows copying inflect-compliance code, with a `PROVENANCE.md` row for every copied file.

Built:

- **Verified.** Optimistic concurrency on the process-map save. `replaceGraph` takes an optional `expectedVersion`. It refuses a mismatch before the destructive write, and again with a conditional `updateMany` on `version`. Both raise `staleData`, which surfaces as HTTP 409 with the current version (`src/app-layer/repositories/ProcessMapRepository.ts` lines 287–298, 343–383, 575–632).
- **Verified.** The guard is optional. Omitting `expectedVersion` means last-write-wins. The repository's own comment names two in-repo callers that omit it: Duplicate and New from template (`ProcessMapRepository.ts` lines 353–374).
- **Verified.** The tldraw canvas client sends `expectedVersion` and updates its held version from each save's response, so its second save does not conflict with its first (`src/components/processes/TldrawProcessMap.tsx` lines 29–35, 357).
- **Verified, and a discrepancy.** The schema comment on `ProcessMap.version` says the version is "NOT yet enforced as a hard optimistic lock at the repo layer" (`prisma/schema/processes.prisma` lines 54–59). The repository code above does enforce it when the client sends it. The comment is stale. ADR 0002's Context quotes that comment.
- **Verified.** Presence, "Stage 1": a hook `useCanvasPresence` that returns an empty roster and no-op publish functions. `IS_PRESENCE_ENABLED` is a hard-coded `false`, the flag-on branch returns the same no-op state, and the hook reads no environment variable (`src/lib/processes/use-canvas-presence.ts` lines 56–64, 85–91). No component imports it: the only references outside its file are its unit test and a guard (`tests/unit/use-canvas-presence.test.ts`, `tests/guards/p6c-realtime-collab-foundation.test.ts`). The design doc says that with the flag on "the hook resolves a `wss://…` URL" (`docs/processes-realtime-collab.md` lines 58–63); the code does not.
- **Verified.** A live notification channel over Server-Sent Events. The route explains why SSE rather than a WebSocket: one-way, plain HTTPS, built-in browser reconnect (`src/app/api/notifications/stream/route.ts` lines 10–19). It runs on the Node runtime (line 42), sends a heartbeat every 25 seconds (`src/lib/notifications/notification-sse.ts` line 17) and turns proxy buffering off (line 132).
- **Verified.** The bus behind it is in-process and "single-process by design". Its comment names Redis pub/sub as the future seam (`src/lib/notifications/notification-bus.ts` lines 11–17). The bell covers the cross-instance gap by polling: every 60 seconds, or every 5 minutes while the stream is healthy (`src/components/layout/notifications-bell.tsx` lines 80, 90).
- **Verified.** The stream authenticates once, at connect (`route.ts` line 57). I found no later re-check of the session or membership in `notification-sse.ts`.
- **Verified.** Notification events carry a title and a message, not ids only (`notification-bus.ts` lines 34–35).
- **Verified.** The client cache is SWR: 37 files import it, with 18 uses of `optimisticData` or `rollbackOnError` (`package.json` line 203; search of `src/`).

Not built:

- **Verified.** No `yjs`, `y-*` or `@hocuspocus/*` package and no Tiptap collaboration extension in `package.json`. The realtime design doc says only Stage 1 shipped and Stages 2–4 are not built (`docs/processes-realtime-collab.md` lines 38–43).
- **Verified.** No live updates for task lists or boards. `EventSource` is used only by the notification bell (search of `src/`).
- **Verified.** No Redis pub/sub in application code (search of `src/` for `.subscribe(`, `.psubscribe(`, `.publish(`).
- **Verified (ADR 0002).** `Task` has no version column.
- **Verified.** The doc leaves WebSocket authentication as an open question (lines 151–152). For its own product it recommends keeping rows as the source of truth and Yjs as a transient layer ("Option B"), to keep its existing analytics, reverse-lookup and snapshot code (lines 83–102). It starts Stage 2 only on a customer signal (lines 154–165).

### Collaboration libraries checked today

**Verified** on the npm registry (latest version, licence field, publish date of that version):

| Package | Version | Licence | Published |
|---|---|---|---|
| `yjs` | 13.6.33 | MIT | 2026-09-23 |
| `@hocuspocus/server`, `/provider`, `/extension-redis`, `/extension-database` | 4.8.0 | MIT | 2026-10-28 |
| `@tiptap/extension-collaboration`, `/extension-collaboration-caret` | 3.34.0 | MIT | 2026-11-13 |
| `y-prosemirror` | 1.3.7 | MIT | — |
| `y-excalidraw` | 2.0.12 | MIT | 2024-12-10 |
| `@tldraw/sync`, `@tldraw/sync-core` | 5.6.1 | "SEE LICENSE IN LICENSE.md" | 2026-11-16 (`sync-core`) |
| `@tanstack/react-query` | 5.108.0 | MIT | 2026-11-17 |
| `swr` | 2.5.1 | MIT | 2026-08-12 |

**Verified** LICENSE files: `yjs` main (HEAD `ee37f0a0`) is MIT. Hocuspocus at commit `265c11aa742cbb9bbe229211c15267261c91aec5`: `LICENSE.md` is MIT, and `packages/server/package.json` says 4.8.0, MIT.

**Verified** in the Hocuspocus source at that commit:

- Server hooks include `onAuthenticate`, `onTokenSync`, `onLoadDocument`, `beforeHandleMessage`, `beforeHandleAwareness`, `onChange`, `onStoreDocument` and `onDisconnect` (`packages/server/src/types.ts` lines 94–182).
- A connection can be read-only. The message receiver does not apply document updates from a read-only connection (`MessageReceiver.ts` lines 234, 276).
- The server can close all connections to a document (`Hocuspocus.ts` line 191) or one connection (`Connection.ts` line 208).
- A client can send a fresh token over an open connection, and the server's `onTokenSync` hook receives it (`MessageReceiver.ts` lines 174–180; `ClientConnection.ts` line 399).
- The server can open a direct, server-side connection to a document (`Hocuspocus.ts` line 663).
- Stores are debounced: 2 seconds by default, at most 10 (`Hocuspocus.ts` lines 29–30).
- The Redis extension "uses Redis pub/sub to broadcast document updates and awareness between servers" (`packages/extension-redis/README.md` line 7).

### Sync engines checked today

The vendors' documentation sites were not reachable from this environment. Their documentation repositories on GitHub were, and were read at the commits given.

**Zero (Rocicorp).** **Verified:** `@rocicorp/zero` 1.12.0, Apache-2.0, published 2026-11-12; its repository `rocicorp/mono` has an Apache-2.0 `LICENSE` on `main` (HEAD `cf5515dd`). From `rocicorp/zero-docs` at `b8e0d5c15b4f5a9e571a36633af672cb2b313346`, `contents/docs/`:

- Needs Postgres 15 or later with logical replication, `wal_level = logical` (`connecting-to-postgres.mdx` lines 5, 35). The upstream connection must be direct, not pooled (lines 98, 201).
- `zero-cache` keeps a replica of the synced data in SQLite (`when-to-use.mdx` line 50).
- Reads: the client names a query; `zero-cache` asks the application's query endpoint for the query's ZQL, then runs it against its replica. "The server can add extra filters to enforce permissions" (`queries.mdx` lines 25–48).
- Writes run as mutators on the application's server, which can run any authorisation (`when-to-use.mdx` line 16).
- No offline writes (`connection.mdx` line 130; `when-to-use.mdx` line 42).
- An older permissions API, named "RLS permissions", is deprecated (`deprecated/rls-permissions.mdx`). It is Zero's own ZQL rule system, not Postgres row-level security.
- It warns that a cookie-authenticated WebSocket with `SameSite=None` is open to cross-site WebSocket hijacking (`auth.mdx` lines 273–276).
- On some hosts, a failover loses the replication slot and forces a full re-sync (`connecting-to-postgres.mdx` lines 102, 228, 240).

**ElectricSQL.** **Verified:** `@electric-sql/client` 1.5.28, Apache-2.0, published 2026-09-09; `LICENSE` Apache-2.0 at `electric-sql/electric` `3f9809fb0bd894cb74470d434749673492ad7acf`. From `website/docs/sync/guides/` at that commit:

- Read path only: "Electric does not do write-path sync" (`writes.md` lines 31–33).
- Needs a role with `REPLICATION` and logical replication (`postgres-permissions.md` lines 10, 55).
- Authorisation is done by the application's API or a proxy, which sets the shape (table, columns, `WHERE`) on the server (`auth.md` lines 81–90, 330–360). "You don't have to codify your auth logic into a database rule system" (lines 63–67).

**PowerSync.** **Verified:** `@powersync/web` 2.7.0, Apache-2.0, published 2026-11-09. In `powersync-ja/powersync-service` at `b12e7776fd842c58cc774f3af97eb05ffbdb47c5`, all 24 `LICENSE` files are Apache-2.0. From `powersync-ja/powersync-docs` at `d4406522128162ac792f45d94874d57b2477295e`:

- Needs logical replication and a publication (`configuration/source-db/setup.mdx` lines 22–24).
- Client writes go to a local SQLite database and an upload queue. The application's backend applies them and authorises them (`configuration/app-backend/setup.mdx` line 11).
- What syncs is defined by Sync Streams, filtered by parameters such as `auth.user_id()` (`sync/streams/overview.mdx` lines 13–30). Sync Rules are deprecated (`sync/rules/migrate-to-sync-streams.mdx` line 20).

What these facts mean for Islestone:

1. **Inference.** All three read Postgres's change stream through one replication role that sees every workspace, and authorise in a layer of their own: a query endpoint, a proxy, or stream parameters. None documents using Islestone's per-transaction tenant context. So on the sync read path, row-level security would not be the boundary. A second permission model would have to match RLS and the policies exactly. That is a direct tension with principle 5.
2. **Inference.** Field encryption is applied by the application before a row is written (roadmap 1.5 ports it; inflect-compliance does it in a Prisma extension, `src/lib/db/encryption-middleware.ts`). The change stream therefore carries ciphertext. Encrypted fields, such as work-item descriptions and comments (ADR 0002 section 11), would reach the browser as ciphertext it cannot read, unless a decrypting service sits in the path.
3. **Inference.** Each engine adds a stateful service, a replication slot that holds write-ahead log while it lags, a direct connection beside PgBouncer, a second copy of the data, and failover behaviour to design.
4. **Inference.** Zero does not do offline writes. It is the leading candidate for speed. If offline is the trigger, PowerSync is the closer fit.

## Decision

Everything in this section is decided: owner decisions, 2026-11-19. The owner chose "Accept all", accepting each recommendation of the draft. Where a section names options, the option chosen is marked **Decision**.

### 1. Four kinds of data, four rules

| Data | Source of truth | Who writes | How other clients learn | Conflict rule |
|---|---|---|---|---|
| Records: work items, projects, cycles, views, labels, custom fields, comments, proposals and every other row | Postgres rows under RLS | Usecases only: people, approved proposals, automation, importers | Change notice, then refetch through the API (section 4) | `version` and 409, per ADR 0002 section 9 |
| Page content | The page's stored Yjs state, in Postgres under RLS | The collaboration server only (section 6) | Yjs sync over Hocuspocus | Yjs merge |
| Canvas content | The canvas's stored Yjs state (option C1, section 6.5) | The collaboration server only | Yjs sync over Hocuspocus | Yjs merge |
| Presence | Memory only; never stored | The collaboration server | Yjs awareness | Latest state wins; it expires |

### 2. Records are server-authoritative

- The database decides. A client never writes a row except through the API.
- Every write runs a usecase, which validates, authorises, sanitises and audits (roadmap section 4).
- Order is computed by the server (ADR 0002 section 5). The client may show its own placement until the response arrives.
- Ids are generated by the server, as ADR 0002's sketch does. An optimistic create shows a temporary local id and swaps it for the server's id on response.

### 3. Optimistic UI for records

- **One client cache for server data: TanStack Query**, for its mutation lifecycle (cancel in-flight reads, snapshot, roll back). SWR, which inflect-compliance uses, was the alternative and was not chosen. Both are MIT. **Decision:** Owner decision, 2026-11-19 (open question 4); the owner chose "Accept all".
- **Each mutation:** apply locally, send, then replace the local copy with the server's row and version. On failure, roll back and say why.
- **On 409:** follow ADR 0002 section 9. If none of the fields this client changed moved underneath it, retry with the new version. Otherwise show the conflict.
- **Writes to one item from one tab are sent in order**, through a per-item queue. Each write carries the version the previous one returned. This is the lesson of inflect-compliance's canvas client, which updates its version from each save's response. Pattern only, no code copied.
- **Echoes are ignored.** A change notice whose version is not greater than the cached version changes nothing.
- **Agents do not use optimistic UI.** They write proposals (ADR 0003). An approved proposal is a server write and reaches clients as a change notice.

### 4. Change notices (roadmap 4.3)

"Change notice" is a new term. ADR 0006 lists it with this ADR's other new words. **Decision:** the words are confirmed, Owner decision, 2026-11-19 (open question 11); the owner chose "Accept all".

**Shape.** A notice names what changed and nothing else. Illustrative, not final:

```ts
type ChangeNotice =
  | { kind: 'workItem'; op: 'upsert' | 'delete'; id: string; projectId: string; version: number }
  | { kind: 'workItemOrder'; id: string; projectId: string }        // sortKey is outside the version (ADR 0002 §5)
  | { kind: 'project' | 'cycle' | 'milestone' | 'savedView'; op: 'upsert' | 'delete'; id: string; version: number }
  | { kind: 'resync'; projectId: string }                            // after a bulk write or an import
  | { kind: 'access'; userId: string };                              // this person's access changed
```

- A strict Zod schema guards the one publish function. A test proves that a notice carrying a title, a name or any field value is refused. Notices skip the API's per-field authorisation and encryption, so they must carry nothing either would protect. (inflect-compliance's notification events carry a title and a message. Islestone's change notices do not.)

**Scope and fan-out.**

- Each workspace has one Redis channel. Each app instance subscribes once and fans notices out in-process to its open streams. This is inflect-compliance's in-process bus with Redis behind it, as its comment proposes but never built. Pattern only.
- **The server filters before it writes to a stream.** A subscriber receives a notice only if they may read its project. Guests (roadmap 1.4) and private projects (8.4) make this necessary: even a bare id tells someone an item exists and is changing. Each stream loads its subscriber's readable projects at connect and reloads them on an `access` notice.

**Publishing.**

- A notice is published after the transaction commits, never inside it. A rolled-back write never notifies.
- The publish sits in the usecase layer's after-commit step, not in route handlers. So every writer publishes: people, approved proposals, automation, importers and integrations.
- **Bulk writes coalesce.** A bulk update or an import publishes one `resync` per project instead of one notice per item. A per-workspace limit caps the notice rate.

**Delivery and correctness.**

- Redis pub/sub, not Redis Streams. Delivery is at most once, which is enough, because a notice is only a hint.
- **Correctness never depends on a notice.** The client refetches on reconnect and on window focus, and polls slowly while its stream is down. inflect-compliance's bell does the same (60 seconds, or 5 minutes while the stream is healthy). Pattern only. ADR 0002 section 13 already lists the index for "changed since" catch-up: `[tenantId, projectId, updatedAt, id]`.
- Not Postgres `LISTEN`/`NOTIFY`: it needs a session-level connection, which PgBouncer in transaction mode does not keep (*unverified*: from PgBouncer's documentation, not re-read today). The roadmap also names Redis.

**Transport.**

- Server-Sent Events from the app: one stream per tab per workspace, on the Node runtime, with a heartbeat and proxy buffering off. These are inflect-compliance's choices and its stated reasons. Pattern only. The channel is one-way, which fits, because writes go through the API.

**Authorisation over time.**

- The stream authenticates at connect: sign-in session, workspace from the URL, membership.
- **It re-checks every 60 seconds** that the sign-in session is live and the membership active, and closes on failure. **Decision:** 60 seconds, Owner decision, 2026-11-19 (open question 10).
- **It closes at once on a revocation**: the sign-in session revoked, the member removed, or their role or project access changed. Those usecases publish an `access` notice, which also reaches the collaboration server (section 6.2).
- inflect-compliance's stream authenticates only at connect. Islestone adds the re-check because H1 requires that revocation signs a person out, and H4 that a person who loses access is disconnected.
- Open streams are capped per person and per workspace. Values are set at H4. Over the cap is a 429. **Decision:** the caps as written, Owner decision, 2026-11-19 (open question 10).

### 5. Presence

- **Pages and canvases:** Yjs awareness, over the same connection as the content.
- **Work items and lists**, two options:
  - **R1. A presence-only room on the collaboration server.** A document name with no content, never stored. One presence mechanism and one authorisation hook for everything. **Decision: R1.** Owner decision, 2026-11-19 (open question 5); the owner chose "Accept all".
  - **R2. A heartbeat POST plus the change-notice stream.** No WebSocket for item pages, but a second presence implementation. Not chosen.
- **A person cannot appear as someone else.** Awareness state is written by the client. `beforeHandleAwareness` refuses state whose user id is not the connection's, and clients show names fetched through the API from that id, never a name a client sent.
- Presence state is size-bounded and throttled. inflect-compliance's doc proposes a 60 Hz cursor throttle and a 250 ms selection debounce (lines 147–150); untested, but a reasonable start.
- Presence is never stored or audited.

### 6. Pages and canvases: Yjs and Hocuspocus

**6.1 The collaboration server.** Hocuspocus 4.x runs as its own Node process, as the BullMQ worker does (roadmap 1.6). This ADR does not rely on Next.js accepting WebSocket upgrades. Several instances share documents through the Redis extension.

**6.2 Every connection is authorised, and stays authorised.**

- The app mints a **collaboration token** through an authorised route. It is signed, lives at most 60 seconds (Owner decision, 2026-11-19, open question 10), and binds the user, the sign-in session, the workspace, the document name and the access level (read or write). Minting runs `requirePermission` for that page or canvas.
- `onAuthenticate` verifies the token. Then it re-reads the database: the sign-in session is live, the membership is active, the page or canvas exists in that workspace (read under RLS), and the person may read it or write it. Read-only access makes the connection read-only, so its updates are not applied.
- Document names include the workspace: `<tenantId>/page/<pageId>`, `<tenantId>/canvas/<canvasId>`. A name alone grants nothing: the token must name it.
- The server checks the `Origin` header on upgrade. A token fetched by same-origin script also avoids a WebSocket authenticated by cookie alone, which Zero's documentation warns can be hijacked cross-site. That warning applies to any cookie-authenticated WebSocket.
- **Tokens are refreshed over the open connection** through `onTokenSync`. Each refresh re-runs every check. A connection whose token expires without a refresh is closed. So a revocation takes effect within one token lifetime even if its notice is lost.
- On an `access` notice, the server closes that person's connections in that workspace at once (H4).
- Connections and update rates are capped per person and per workspace. Values are set at H4. **Decision:** the caps as written, Owner decision, 2026-11-19 (open question 10).

**6.3 References, not copies.** A work-item mention or embed in a page, and a canvas shape linked to a work item, store the item's id and nothing else. Title, state and assignee render through the normal API. So:

- a Yjs document never holds a copy of a work item's fields;
- a reader who cannot see an item sees "no access", not a stale title;
- a work item has one source of truth (principle 3).

**6.4 Page content: the stored Yjs state is the source of truth.**

- The encoded state is stored in a workspace table (working name `PageContent`), written by `onStoreDocument`.
- On each store, the collaboration server also writes derived projections: plain text (for search, under ADR 0002 section 11's search decision: S1 for now, so the stored page text is not searched until the search ADR chooses between S2 and S3), sanitised HTML (for export and email), and the list of mentioned work items (for backlinks).
- Projections are derived only from the Yjs state, through the editor's schema. Nothing else writes them.

**6.5 Canvas content: C1.**

- **C1. The stored Yjs state is the source of truth**, as for pages. `CanvasNode` and `CanvasEdge` rows are a projection written on store, used for queries such as "which canvases link this item". One write path and one persistence model for all collaborative content, and no lossy rebuild from rows at each session start. **Decision: C1.** Owner decision, 2026-11-19 (open question 2); the owner chose "Accept all".
- **C2. Rows are the source of truth; Yjs is a transient layer.** Not chosen. The session rebuilds the Yjs document from rows and writes rows back on store. This keeps the ported serializer and row model unchanged, which is why inflect-compliance's doc recommends it for its product. Islestone has no such code yet, which weakens that reason. Costs: a full rewrite of the canvas's rows on every store, and every row write outside the session must still go through the live document.
- Under either option, inflect-compliance's whole-graph save endpoint is not ported as a client save path. Saving is the collaboration server's job.

**6.6 One write path for content.** Any server-side change to page or canvas content goes through the collaboration server's direct connection: an approved agent proposal (ADR 0003), an automation, an import, a template, a version restore. It runs as the approving or acting person. Live editors see it at once, and the next store cannot overwrite it. No other code writes the stored Yjs state or its projections. A guard enforces this single write seam.

**6.7 Content from a client is untrusted.** Any client can send any Yjs update. So the server:

- caps the size and rate of updates (`beforeHandleMessage`);
- caps the stored document size (`onStoreDocument`);
- validates the document against the editor's schema when building projections, dropping unknown nodes and marks and recording that it did;
- sanitises HTML before any export or email (H4);
- never renders stored Yjs content as HTML by any other path.

**6.8 Encryption.**

- Stored Yjs state and version snapshots are encrypted with the workspace key through the field-encryption manifest (roadmap 1.5), to match ADR 0002's treatment of descriptions and comments. **Decision:** Owner decision, 2026-11-19 (open question 6); the owner chose "Accept all". Whether the manifest handles binary columns is a question for 1.5.
- The text projection follows the search decision in ADR 0002 section 11: S1 for now (owner decision, 2026-11-19), so page text is not searched until the search ADR, due before roadmap 2.7, chooses between S2 and S3.
- Redis carries document updates between instances in flight. In production it is private, authenticated and on TLS, and the collaboration path uses pub/sub only, so it stores no updates.

**6.9 Version history (roadmap 4.1).** Full encoded snapshots at intervals and on an explicit save, kept for the period the retention table sets (8.3). A restore is a server-side write through section 6.6.

**6.10 Comments on pages are `Comment` rows** (ADR 0006), anchored by an encoded Yjs relative position stored on the comment row. Their text never enters the Yjs document, so comments keep their sanitisation, permissions and audit.

**6.11 Audit.** Keystrokes are not audited. A store writes one audit entry per contributing person per page in a 10-minute window, saying "edited the page" without the text. This follows ADR 0002 section 11 for encrypted fields. **Decision:** 10 minutes, Owner decision, 2026-11-19 (open question 7); the owner chose "Accept all".

**6.12 Agents and the assistant never connect to the collaboration server.** Their read tools read the projections. Their writes are proposals, applied through section 6.6 when approved.

**6.13 Work-item descriptions stay row fields** with `If-Match` and 409 (ADR 0002 section 9), not Yjs. ADR 0002 names Yjs descriptions as the way out if conflicts become common. That is a measured decision, not a default.

**6.14 The canvas library (ADR 0001, D3).**

ADR 0001 D3 is decided: tldraw 3.x with the watermark, not a licensed tldraw (owner decision, 2026-11-18). **Inference:** T2 as drafted assumes a licensed tldraw, so it does not arise, and T1 is the remaining option. Whether tldraw sync runs under 3.x was not checked.

- **T1. Yjs for the canvas, whichever library is chosen.** One collaboration server and one permission model for pages and canvases. **Decision: T1.** Owner decision, 2026-11-19 (open question 3); the owner chose "Accept all". With Excalidraw, I found no maintained official binding: `y-excalidraw` was last published 2024-12-10. So the binding (shapes in a `Y.Map` keyed by shape id) is written in-house.
- **T2. tldraw sync**, only if D3 chooses a licensed tldraw. Not chosen. It is under tldraw's own licence, adds a second realtime server, and ties canvas collaboration to the licence's renewals. Whether tldraw sync runs under 3.x was not checked.

### 7. A sync engine is deferred

**Options:**

- **E0. No sync engine now.** Records follow sections 2 to 4; content follows section 6. **Decision: E0**, with the reopen conditions below and condition 2's thresholds as written. Owner decision, 2026-11-19 (open question 1); the owner chose "Accept all".
- **E1. Zero.** The fastest-feeling reads and a server write path that runs Islestone's own logic. But: a second permission model beside RLS (inference 1), encrypted fields cannot sync as plaintext (inference 2), no offline writes, a direct Postgres connection beside PgBouncer, and a SQLite replica of every workspace's synced data.
- **E2. ElectricSQL.** Reads only; writes stay on the API, which matches section 2. Authorisation in a proxy that Islestone writes. Same tensions with RLS and encryption.
- **E3. PowerSync.** Built for offline, with a local database and an upload queue to the API. Same tensions with RLS and encryption, plus offline conflicts the product must design for.

**Why defer:** E1 to E3 each move isolation out of the database (principle 5) and do not carry field encryption. No roadmap phase before 9.3 needs offline. In a web app, optimistic UI plus change notices give most of the speed a person notices.

**Conditions that reopen the decision.** Any one of them starts a new ADR. None of them is a reason to adopt an engine quietly.

1. **An offline requirement.** Paying customers, or a roadmap commitment such as offline quick capture in 8.5, require writes or reads while offline beyond a short reconnect. Then PowerSync, not Zero, is the closer fit.
2. **A measured problem after the H2 budgets are met.** Thresholds (Owner decision, 2026-11-19, open question 1):
   - p75 time to show a list or board on navigation without a cached copy, above 400 ms on the 100,000-item H2 tenant;
   - p75 time from a write to its appearance in another open client, above 2 seconds;
   - refetches caused by change notices, above half of API read traffic.
3. **A credible permission model that fits RLS.** The engine enforces Islestone's isolation on its read path, and Islestone proves it with the same two-tenant and guest tests as the API (H1, H2), run against the engine. And either encrypted fields sync safely, or the owner accepts that they are fetched through the API only.
4. **Maturity, licence and hosting.** A stable release line; self-hostable; a licence on the 0.3 allowlist (all three are Apache-2.0 today), re-read at the pinned commit as H0 requires; and logical replication with failover-safe slots on the chosen Postgres host (roadmap section 7, open decision 5).

**What Islestone does now so the door stays cheap:**

- Every record table has a version and `updatedAt`, with the catch-up index (ADR 0002).
- Every write is a usecase. Usecases map later onto Zero mutators or PowerSync upload handlers.
- Client reads go through one layer of data hooks. Components do not call `fetch`. Changing where the cache gets its data touches that layer only.
- Change notices already carry kind, id and version.
- No workspace data is stored in the browser (IndexedDB, local storage) until this is reopened. A PWA (8.5) caches the shell, not data.

### 8. Tests that hold these rules

- A two-tenant test: a stream in workspace A never receives a notice from workspace B. A guest never receives a notice for a project outside their access.
- The notice schema refuses any field beyond kind, op, ids and version.
- A revoked sign-in session, a removed member and a narrowed role each close the open stream and the collaboration connections within the stated time (H1, H4).
- A token for another workspace's page, an expired token and a token for another document are refused. A read-only connection's updates are not applied.
- A forged awareness state naming another user is refused.
- Two clients editing one page or canvas converge. A server-side write during a live session survives the next store (H4's concurrent-save test).
- Oversized updates and documents are refused. Content with unknown nodes is dropped from projections, and exported HTML is sanitised.
- A guard: only the collaboration server's store path writes Yjs state and projections.

### Open questions for the owner

Questions 1 to 7, 10 and 11 were answered on 2026-11-19 in the working session; the owner chose "Accept all". Questions 8 and 9 remain open.

1. Answered: E0 is approved, with section 7's reopen thresholds as written.
2. Answered: canvas persistence is C1 (section 6.5).
3. Answered: canvas transport is T1 (section 6.14). Whether tldraw sync runs under 3.x was not checked; under T1 it is not needed.
4. Answered: the client cache is TanStack Query (section 3).
5. Answered: item presence is R1 (section 5).
6. Answered: stored Yjs state and snapshots are encrypted (section 6.8). Page text is searched under ADR 0002's S1 for now, so not until the search ADR chooses between S2 and S3.
7. Answered: one audit entry per person per page per 10 minutes (section 6.11).
8. Open, not blocking. Does the hosting target (roadmap open decision 5) keep long-lived SSE and WebSocket connections? A serverless-only host would change sections 4 and 6. It belongs to roadmap open decision 5.
9. Open, not blocking. Does 8.5's PWA quick capture need to work offline? If yes, condition 1 fires. It belongs to sub-phase 8.5.
10. Answered: a 60-second token lifetime, a 60-second stream re-check, and the connection and update caps as written (sections 4 and 6.2); H4 sets the cap values.
11. Answered: the new words "change notice", "collaboration server", "collaboration token", "page content" (`PageContent`, a working name) and "projection" are confirmed. ADR 0006 lists them as decided rows.

## Consequences

- Records keep one model: the database decides, RLS isolates, the API authorises, and a version settles conflicts. Phase 2 needs no realtime infrastructure.
- Live updates cost an extra read per change for every open client that shows it. Refetch load must be measured at H2 and H4. It is also one of the reopen thresholds.
- Notices carry no content, so a leaked or misrouted notice reveals ids only. Filtering per project before writing keeps even ids from guests and from people outside private projects.
- Phase 4 adds two runtime components: the collaboration server and Redis on the content path. Redis then holds page and canvas updates in flight and must be secured as a data store.
- Authorisation of a long-lived connection is re-checked, not assumed. This adds a database read per stream per minute and per token refresh, in exchange for H1 and H4.
- Collaborative content is a CRDT. It cannot be queried in place: search, export, backlinks and agents read projections, which lag the live document by the store debounce (2 to 10 seconds by Hocuspocus's defaults).
- A schema change in the editor or canvas means transforming stored Yjs documents, which is harder than migrating rows. Each change needs a tested transform.
- No offline mode. A person who loses the connection keeps typing in a page, and Yjs merges on reconnect, but records cannot be changed offline.
- ADR 0001 D3 chose tldraw 3.x and this ADR chose T1, so 4.2 binds tldraw 3.x's shapes to Yjs. Whether a maintained binding exists for tldraw 3.x was not checked.
- Patterns learned from inflect-compliance, all pattern only, no code copied: an optional-to-required `expectedVersion` with a conditional update; updating the held version from each save's response; SSE for one-way updates with heartbeat, Node runtime and buffering off; an in-process fan-out bus; polling as the fallback for missed pushes. Each goes in `PROVENANCE.md` as pattern only.

## What would change this decision

- Any reopen condition in section 7.
- Hosting that cannot keep long-lived connections.
- A canvas library choice that makes T2 compelling, or a tldraw licence that includes sync on acceptable terms.
- Hocuspocus or Yjs going unmaintained, or changing licence.
- Description conflicts measured as common, which would move descriptions to Yjs (ADR 0002).
- A customer or regulator refusing content in transit through Redis, which would push toward a single-instance collaboration server or end-to-end encryption of updates.
- A sync engine documenting enforcement of Postgres row-level security on its read path, which would remove inference 1.

## References

- Roadmap (`docs/ROADMAP.md`):
  - 0.2 item 5; section 3, principles 2, 3 and 5; section 4 (global preamble);
  - 1.4 (roles, guests), 1.5 (field encryption), 1.6 (worker), 2.2, 2.3, H1, H2;
  - 4.1, 4.2, 4.3, H4; 8.3 (retention), 8.4 (private projects, guests), 8.5 (PWA); 9.3; section 7, open decision 5.
- Islestone ADRs: `docs/adr/0001-code-provenance-and-licences.md` (D1, D3), `docs/adr/0002-work-item-model.md` (sections 5, 9, 11, 13), `docs/adr/0003-assignee-and-delegate.md` (proposals), `docs/adr/0006-vocabulary.md`.
- Islestone files: `package.json`, `docker-compose.yml`, `CLAUDE.md`.
- inflect-compliance, read-only, at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`:
  - `docs/processes-realtime-collab.md` (lines 10–15, 38–43, 58–63, 83–102, 147–152, 154–165);
  - `src/lib/processes/use-canvas-presence.ts` (lines 56–64, 85–91), `tests/unit/use-canvas-presence.test.ts`, `tests/guards/p6c-realtime-collab-foundation.test.ts`;
  - `src/app-layer/repositories/ProcessMapRepository.ts` (lines 287–298, 343–383 including the caller comment at 353–374, 575–632);
  - `src/components/processes/TldrawProcessMap.tsx` (lines 29–35, 357);
  - `prisma/schema/processes.prisma` (lines 54–59);
  - `src/app/api/notifications/stream/route.ts` (lines 10–19, 26–31, 42, 57);
  - `src/lib/notifications/notification-sse.ts` (lines 17, 94, 132), `src/lib/notifications/notification-bus.ts` (lines 11–17, 34–35);
  - `src/components/layout/notifications-bell.tsx` (lines 80, 90);
  - `src/lib/db/encryption-middleware.ts` (existence); `package.json` (lines 138–142, 158, 160, 174, 203, 205).
- External sources, read 2026-11-18:
  - npm registry: the packages in the "Collaboration libraries checked today" table, `@rocicorp/zero`, `@electric-sql/client`, `@powersync/web`;
  - `yjs/yjs` `LICENSE` on `main` (HEAD `ee37f0a0e23a7c3e14531bae335d439e54c743e6`);
  - `ueberdosis/hocuspocus` at `265c11aa742cbb9bbe229211c15267261c91aec5`: `LICENSE.md`, `packages/server/package.json`, `packages/server/src/{types,Hocuspocus,Connection,ClientConnection,MessageReceiver}.ts`, `packages/extension-redis/README.md`;
  - `rocicorp/mono` `LICENSE` on `main` (HEAD `cf5515dda6c38b1dfec2c9db560ce7d0f448f80c`); `rocicorp/zero-docs` at `b8e0d5c15b4f5a9e571a36633af672cb2b313346`;
  - `electric-sql/electric` at `3f9809fb0bd894cb74470d434749673492ad7acf`: `LICENSE`, `website/docs/sync/guides/`;
  - `powersync-ja/powersync-service` at `b12e7776fd842c58cc774f3af97eb05ffbdb47c5` (24 `LICENSE` files); `powersync-ja/powersync-docs` at `d4406522128162ac792f45d94874d57b2477295e`.
