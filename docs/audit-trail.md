# The audit trail

Sub-phase 1.5. Every mutation is recorded in an append-only, hash-chained
log: one chain per workspace (`AuditLog`) and one per organization
(`OrgAuditLog`). A row cannot be edited or removed by the application, and
an edit made by anybody with database access breaks the chain where it
happened.

Copied and edited from inflect-compliance's `docs/immutable-audit-trail.md`,
with §C.4 of `docs/epic-c-security.md` and §E.2 of
`docs/epic-e-observability.md`, and the outbox and erasure sections written
from the docblocks of `src/lib/audit/audit-outbox.ts` and
`erasure-record.ts` (`PROVENANCE.md`). The source's "Historical row
strategy" is left out: Islestone has no rows from before the chain.

## Writing an entry

A usecase calls `logEvent` from `src/app-layer/events/audit.ts` after it
mutates state, with the transaction client it is running in:

```ts
await runInTenantContext(ctx, async (db) => {
    // … the mutation …
    await logEvent(db, ctx, {
        action: 'MEMBER_ROLE_CHANGED',
        entityType: 'TenantMembership',
        entityId: membership.id,
        detailsJson: { category: 'access', operation: 'role_changed', detail: `${before} → ${after}` },
    });
});
```

`logEvent` takes the actor, actor type and request id from the
`RequestContext`, validates `detailsJson` against the event schema (a payload
that does not parse is refused before anything is written) and appends the
entry through `appendAuditEntry` (`src/lib/audit/audit-writer.ts`), the only
writer of `AuditLog`. Organization events go through `appendOrgAuditEntry`
(`src/lib/audit/org-audit-writer.ts`), the only writer of `OrgAuditLog`.
Never write to either table directly; the guards below refuse it.

Separately, the Prisma audit extension in `src/lib/prisma.ts` records an
`entity_lifecycle` entry with a field-level `diffJson` for every write to a
model other than `AuditLog` itself, so a write a usecase forgot to narrate
still leaves a row.

## Schema

`prisma/schema/audit-trail.prisma`:

| Column | Description |
|--------|-------------|
| `id` | CUID primary key |
| `tenantId` | The workspace whose chain the row is in (FK, `ON DELETE RESTRICT`) |
| `userId` | The actor; null for `SYSTEM` and `JOB` actors and after pseudonymisation |
| `actorType` | `USER`, `SYSTEM` or `JOB` |
| `entity`, `entityId` | What the event is about |
| `action` | The event type (`MEMBER_ROLE_CHANGED`, `UPDATE`, …) |
| `details` | Short human-readable text, redacted (`src/lib/audit-redact.ts`) |
| `detailsJson` | **The structured payload, and the source of truth** |
| `previousHash` | The previous row's `entryHash` in this workspace's chain |
| `entryHash` | SHA-256 of this row's canonical form |
| `version` | Hash schema version (`1`) |
| `requestId` | Correlation id |
| `diffJson`, `metadataJson`, `recordIds` | The audit extension's diff and metadata |
| `createdAt` | Insertion time |

`OrgAuditLog` has the same chain columns keyed on `organizationId`, with
`actorUserId`, `subjectUserId` (the person an access change is about; the
writer's input and the hashed field keep inflect-compliance's name
`targetUserId`, because ADR 0006 bans the word in identifiers) and an
`OrgAuditAction` enum.

## Append-only enforcement

Three layers:

1. **Triggers.** `audit_log_immutable` and `org_audit_log_immutable`
   (`BEFORE UPDATE OR DELETE … FOR EACH ROW`) raise `restrict_violation`. The
   `AuditLog` trigger admits exactly one UPDATE: `userId` from a value to
   NULL with every other column unchanged, for the erasure writer (below).
2. **Privileges.** `app_user` holds `SELECT` and `INSERT` only on both logs;
   `UPDATE`, `DELETE` and `TRUNCATE` are revoked
   (`tests/integration/rls-coverage.test.ts` checks the grants).
3. **Guards.** `tests/guards/audit-immutability-guardrails.test.ts` refuses a
   Prisma `update`/`delete` on either model and raw `UPDATE`/`DELETE` SQL
   against them, in `src` and `tests`, except in the one test helper below.

`AuditLog` and `AuditOutbox` are tenant tables with the full row-level
security set (`tenant_isolation`, `tenant_isolation_insert`,
`superuser_bypass`, FORCE), proved by
`tests/integration/audit-tables-isolation.test.ts`. `OrgAuditLog` has no RLS,
like the organization tables it sits beside: organization paths use the
global client (`docs/rls-tenant-isolation.md`).

## The hash chain

Each workspace has an **independent** chain. The first row has
`previousHash = null`; each later row's `previousHash` is the previous
row's `entryHash`. `appendAuditEntry` takes
`pg_advisory_xact_lock(hashtext(tenantId))` inside its transaction, so
appends to one workspace serialise and appends to different workspaces do
not contend. The key is the bare tenant id, which the last-owner locks
(`tenant-owner:<id>`) deliberately do not share. The order of a chain is
total: `(createdAt, id)`, with the lock making `createdAt` monotonic within
a workspace (`tests/guards/audit-chain-order-is-total.test.ts`).

```
entryHash = SHA-256(canonicalJSON(hashPayload))
```

`hashPayload` holds exactly `HASH_FIELDS` (`src/lib/audit/canonical-hash.ts`):
`actorType`, `actorUserId`, `detailsJson`, `entityId`, `entityType`,
`eventType`, `occurredAt`, `previousHash`, `tenantId`, `version`. The `id`,
`requestId`, `recordIds`, `metadataJson`, `diffJson`, `details` and
`createdAt` columns are outside the hash.

### Canonical serialisation

1. Object keys sorted lexicographically at every depth.
2. Array order preserved.
3. `null` serialised as `null`; `undefined` omitted.
4. Compact JSON, no whitespace.
5. Timestamps as ISO-8601 UTC with milliseconds.

**Changing any rule invalidates every stored chain.** A breaking change
bumps `version`, and the verifier keeps the old rules for old rows.

## Structured events

`detailsJson` is a discriminated union on `category`
(`src/lib/audit/event-schema.ts`):

| Category | For | Key fields |
|----------|-----|------------|
| `entity_lifecycle` | Create, update, delete | `entityName`, `operation`, `changedFields`, `before`, `after` |
| `status_change` | Workflow transitions | `entityName`, `fromStatus`, `toStatus`, `reason` |
| `relationship` | Link and unlink | `operation`, `sourceEntity`, `sourceId`, `targetEntity`, `targetId`, `relation` |
| `access` | Authentication and permissions | `operation`, `targetUserId`, `detail` |
| `data_lifecycle` | Retention, purge, archive | `operation`, `model`, `reason`, `recordCount` |
| `custom` | Anything else | `category: 'custom'` and free keys |

`tests/guards/audit-structured-events.test.ts` requires a `detailsJson` on
every `logEvent` call. Free text in a payload is redacted before it is
stored: secret-shaped keys become `[REDACTED]`, long blobs become a length
and a hash prefix, and deep or large structures are cut
(`src/lib/audit-redact.ts`).

## Appending inside a transaction

`logEvent(db, ctx, payload, { withinTransaction: true })` appends inside the
transaction `db` belongs to (`appendAuditEntryWithin`), so the entry commits or
rolls back with the work it records. The default appends in a transaction of
its own. An in-transaction entry is not streamed to the SIEM (the writer
cannot know whether the caller's transaction commits) and holds the
workspace's chain lock until that transaction ends, so keep the transaction
short. The first caller is `ensureTenantSystemUser`, whose
`SYSTEM_USER_CREATED` entry (`entity_lifecycle`, written as the system user)
must not exist without the row it describes, nor the row without it (owner
decision, 2026-11-19).

## The outbox: an entry is recorded, queued, or the request fails

`appendAuditEntryOrQueue` (`src/lib/audit/audit-outbox.ts`) is for the entries
whose absence would be worse than a failed request, starting with the
`AUTHZ_DENIED` entry `requirePermission` writes. Exactly one of three things
happens, and the caller can tell which:

1. **`chain`**: the entry reached the hash chain.
2. **`queued`**: the chain write failed and a durable `AuditOutbox` row holds
   the entry instead.
3. **it throws** (`AuditNotRecordedError`): both failed, and the caller fails
   closed.

There is no outcome where the entry is gone and nobody knows. The fallback is
more available than the chain, not the same write retried: the chain append
waits on a per-workspace advisory lock and can fail to start under
contention, while the outbox insert takes no lock. When both fail, the
database is down. The outbox is a queue, not a second store: a row leaves it
by becoming a chain entry. The write that queued it logged `audit: entry
queued to outbox after chain write failed` at `warn`.

### The drain

`audit-outbox-flush` (`src/app-layer/jobs/audit-outbox-flush.ts`, sub-phase
1.5b) runs every five minutes, over every workspace (`docs/jobs.md`). A pass:

1. **Parks stranded rows.** A row claimed for its last attempt whose outcome
   was never recorded (the process died mid-append, or the status update
   failed too) is moved to `FAILED` once its claim lease
   (`AUDIT_OUTBOX_CLAIM_LEASE_MS`, ten minutes) has expired.
2. **Reads the oldest event first.** Up to 200 `PENDING` rows whose
   `nextAttemptAt` has come, ordered by `occurredAt`, so a backlog reaches the
   chain in the order its events happened, after whatever the chain already
   holds.
3. **Claims each row, then appends it.** The claim is a conditional
   `updateMany` on the `attempts` it read (one pass wins, another sees zero
   rows), and pushes `nextAttemptAt` out by the lease. The append is an
   ordinary `appendAuditEntry` under the per-workspace chain lock, so the
   entry is linked to the one before it like any other. Its `detailsJson`
   gains `occurredAt` (when the event happened; the chain's own `createdAt` is
   the drain time) and `replayedFromOutbox: true`. The row becomes `APPLIED`
   and names the `AuditLog` id it became (`appliedAuditId`).
4. **Backs off a failure.** A failed replay keeps the row `PENDING` with
   `lastError` and a delay (5 s, 30 s, 2 min, then 10 min). After five attempts
   it is `FAILED` and logged at `error`. A `FAILED` row is never deleted: the
   terminal bad state is a row someone can query, not an absence.

An operator drains one workspace by enqueuing the job with its `tenantId`.
`tests/integration/audit-outbox-drain-order.test.ts` proves the order, the
links and that `verifyAuditChain` still reads the chain as valid;
`tests/integration/audit-outbox-no-silent-drop.test.ts` proves the three
outcomes and the parking.

## Erasure without breaking the chain

Pseudonymising a person sets `AuditLog.userId` to NULL, which the trigger
admits. But `actorUserId` is a hashed field, so a verifier recomputing the
row's hash from its current columns would report the row as tampered. The
erasure writer (sub-phase 8.3) therefore records an `ERASURE_EXECUTED` entry
**in the chain** naming each row it pseudonymises and the hash that row will
recompute to once `userId` is NULL (`src/lib/audit/erasure-record.ts`). The
verifier accepts a mismatch on a named row only when the recomputed hash
equals that commitment. The tolerance is `userId`-only by construction: any
other edit to a named row recomputes to something else and is reported.

## Streaming to a SIEM

A workspace that sets `TenantSecuritySettings.auditStreamUrl` and an HMAC
secret (`auditStreamSecretEncrypted`, encrypted under the workspace's DEK)
gets every committed entry posted to it
(`src/app-layer/events/audit-stream.ts`). The settings route arrives with the
admin security settings; until then the columns are set directly.

- **Fail-safe.** `appendAuditEntry` hands the committed row to
  `streamAuditEvent` through a lazy import; a broken SIEM never undoes or
  delays the write.
- **Batching.** A per-workspace in-memory buffer flushes at 100 events or
  5 seconds, capped at 1,000 events (the oldest are shed and counted).
- **Signed.** `X-Islestone-Signature: sha256=<hex>` over the body.
- **Retries.** Up to 3 attempts (the original and 2 retries) on a 408, 429,
  5xx or network error, with linear backoff (1 s, 2 s). Every attempt carries
  the same `X-Islestone-Batch-Id`, derived from the workspace, schema version
  and event ids (`computeBatchId`, `src/app-layer/events/webhook-headers.ts`),
  and the same value as `X-Islestone-Idempotency-Key`, so the receiver
  de-duplicates retries. `AUDIT_STREAM_RETRY_ENABLED=0` forces one POST.
- **Outbound requests go through `safeFetch`**
  (`src/app-layer/automation/webhook-safety.ts`): the host is resolved when
  the request is made and refused if any address is private, loopback,
  link-local or a metadata endpoint, the connection is pinned to the checked
  address, and redirects are refused. `checkWebhookUrl` is the same check for
  a form that saves a URL.
- **Privacy.** The payload drops free-text `details` and ships only
  `detailsJson`; the actor is an opaque `userId` and `actorType`, never an
  email.

Every outbound webhook uses `buildOutboundHeaders` and `computeBatchId`;
never spell an `X-Islestone-*` header inline. Delivery is measured
(`recordAuditStreamDelivery`, a buffer-overflow counter and a buffer-depth
gauge) and does not gate `/api/readyz`: the row is already committed.

## Verifying a chain

```bash
npx tsx scripts/verify-audit-chain.ts                     # every workspace
npx tsx scripts/verify-audit-chain.ts --tenant <tenantId> # one workspace
npx tsx scripts/verify-audit-chain.ts --from 2026-01-01 --to 2026-12-31
npx tsx scripts/verify-audit-chain.ts --json              # for automation
npx tsx scripts/verify-audit-chain.ts --max-breaks 5
```

Exit codes: `0` every chain valid, `1` a chain broken, `2` the script failed.
In code, `verifyTenantChain` and `verifyAllTenants` from
`src/lib/audit/verify.ts`, and `verifyAuditChain` from the writer. An admin
verify endpoint arrives with the audit-log views (2.x).

## Tests and teardown

Suites that write audit rows and then delete the workspace or user behind
them must **clear the audit rows first**: the foreign keys are
`ON DELETE RESTRICT` and the trigger refuses the delete. Most suites call
`resetDatabase` (TRUNCATE, which fires no row triggers). A suite that deletes
its own rows uses `tests/helpers/audit-cleanup.ts`
(`deleteAuditRowsForTenants`, `deleteAuditRowsForUsers`,
`deleteOrgAuditRowsForOrganizations`, …), the repository's only sanctioned
raw SQL against the trails: it turns the trigger off for one transaction with
`session_replication_role = 'replica'`, on the test database's owner URL.
`tests/guards/integration-suite-audit-teardown.test.ts` fails a suite that
deletes an audit parent without it, and one whose teardown swallows its own
failure.

| Guard | Holds |
|-------|-------|
| `tests/guards/audit-immutability-guardrails.test.ts` | No update or delete of either log outside the cleanup helper |
| `tests/guards/audit-structured-events.test.ts` | Every `logEvent` passes `detailsJson`; no raw INSERT outside the writers |
| `tests/guards/audit-chain-order-is-total.test.ts` | The chain order is total |
| `tests/guards/integration-suite-audit-teardown.test.ts` | Teardowns clear audit rows first, and do not swallow failures |
| `tests/integration/audit-hash-chain.test.ts`, `audit-immutability.test.ts`, `log-event-chain.test.ts`, `org-audit-immutability.test.ts` | The chain, the triggers and `logEvent`, against Postgres |
