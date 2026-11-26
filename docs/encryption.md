# Field encryption and lookup hashes

Sub-phase 1.5. Islestone encrypts personal data and secrets at rest in the
application, below Prisma, so a database dump, a backup or a read replica
holds ciphertext. Transport encryption, disk encryption and backup
encryption belong to the operations docs (`docs/deployment.md`, sub-phase 1.8).

Copied and edited from inflect-compliance's `docs/epic-b-encryption.md`,
Layer 1 of `docs/encryption-data-protection.md` and §F.2 of
`docs/epic-f-finishing-touches.md` (`PROVENANCE.md`). The compliance field
list, the plaintext backfill and the tenant-DEK backfill are left out:
Islestone starts with no data to backfill.

## Architecture

```
LAYER 0  root secret      DATA_ENCRYPTION_KEY            (operator env var)
                          DATA_ENCRYPTION_KEY_PREVIOUS   (only during a rotation)
            │ HKDF-SHA256
            ▼
LAYER 1  global KEK       256-bit, cached per key generation
            │ AES-256-GCM
            ▼
LAYER 2  per-tenant DEK   32 random bytes per workspace, stored wrapped on
                          Tenant.encryptedDek, unwrapped on first use and
                          held in an LRU cache
            │ AES-256-GCM
            ▼
LAYER 3  field ciphertext written to the column the plaintext would occupy
                          'v1:' under the global KEK
                          'v2:' under the workspace's DEK
```

| Layer | Module | What it owns |
|---|---|---|
| 0 root secret | env, operator | `DATA_ENCRYPTION_KEY` (+ optional `_PREVIOUS`) |
| 1 global KEK | `src/lib/security/encryption.ts` | HKDF derivation, `encryptField`/`decryptField` (v1), `encryptWithKey`/`decryptWithKey` (v2), `hashForLookup`, `deriveSubkey` |
| 2 per-tenant DEK | `src/lib/security/tenant-keys.ts`, `tenant-key-manager.ts` | DEK generation, wrap and unwrap, the cache |
| 3 field ciphertext | `src/lib/db/encryption-middleware.ts` (manifest fields), `src/lib/security/pii-middleware.ts` (personal data) | Prisma `$extends` query extensions: encrypt on write, decrypt on read |

`src/lib/prisma.ts` composes the extensions on the one client: the audit
extension innermost, then field encryption, then PII, then the RLS
tripwire.

## What is encrypted

**Business and secret fields** — the manifest
`src/lib/security/encrypted-fields.ts` (`ENCRYPTED_FIELDS`), written as
`v2:` under the workspace's DEK when the write runs in a tenant context:

| Model | Field | Why |
|---|---|---|
| `TenantSecuritySettings` | `auditStreamSecretEncrypted` | The HMAC secret that signs the workspace's audit-stream deliveries. |
| `WorkItem` | `description` | A work item's description (sub-phase 2.2, ADR 0002 §11). The title stays plaintext: it is searched and quoted. |
| `Comment` | `body` | A comment's text (2.2). |
| `WorkItemTemplate` | `description` | An item template's description (sub-phase 2.5c, owner decision 73). Its name and title stay plaintext. |
| `CalendarConnection` | `tokenEncrypted` | A member's calendar OAuth token pair and its expiry, one JSON blob (roadmap 3.3b, owner decision 238; ADR 0011 §7): under the workspace's DEK so both key rotations re-encrypt it; NULL once revoked or torn down; never rendered, logged or audited. Not on `Account`: a calendar grant never rides on a sign-in row. |
| `ProjectTemplate` | `contentJson` | A project template's whole content, one JSON document (fields, milestones, item templates with their descriptions, starter items), encrypted as one value (2.5c, decision 73). Its name stays plaintext. |

Both are sanitised before they are stored, and an audit entry records that
the description changed, never its text. A top-level write encrypts only the
manifest fields of its own model; the by-name fan-out applies to nested writes,
whose target model the payload does not name. (Until 2.2 the top level fanned
out too, which would have sealed `Notification.body` and
`TenantCustomRole.description` once `Comment.body` joined the manifest, outside
the rotation sweeps.) `tests/guards/encryption-manifest-coverage.test.ts`
fails on a free-text column that is neither in the manifest nor classified
as not sensitive, with its reason.

**Personal data** — the PII extension, `v1:` under the global KEK because
`User` and `Account` belong to no workspace:

| Model | Fields | Shape |
|---|---|---|
| `User` | `email` (+ `emailHash`), `name` | The column holds the ciphertext under the field's own name |
| `Account` | `access_token`, `refresh_token` | Dual-write: NextAuth's adapter reads the plaintext columns, and the extension writes `accessTokenEncrypted` and `refreshTokenEncrypted` beside them |

TOTP secrets (`UserMfaEnrollment.secretEncrypted`) are encrypted by
`src/lib/security/totp-crypto.ts`, which 1.4 brought.

**Plaintext derivatives of encrypted fields** (sub-phase 2.7f, [ADR 0008](adr/0008-search-over-encrypted-fields.md) D1, owner decision 124). `SearchVector.lexemes` is a `tsvector` of `WorkItem.description` and `Comment.body`: their stemmed words with positions, enough to reconstruct most of the text, **stored readable** so that descriptions and comments can be searched. For these two fields, field encryption no longer keeps the words from a reader of the database, a dump or the off-host backups; it still keeps the exact text, punctuation and stop words out of them, and it still protects every other field in the manifest, none of which has a derivative. `tests/guards/encryption-manifest-coverage.test.ts` lists the column in `PLAINTEXT_DERIVATIVES`, a class of its own kept apart from `NOT_SENSITIVE`: each entry cites the ADR and its encrypted sources, and any new `Unsupported("tsvector")` column on a workspace table fails CI until it is classified there, which is an amendment to ADR 0008. The vectors are not encrypted, so the key rotations do not touch them, and a workspace export leaves them out (`docs/search.md`, "Stored vectors").

**Deliberately not encrypted:** the audit trail (`AuditLog`,
`OrgAuditLog`): encrypting a hashed field would break `entryHash`, and an
investigation needs plaintext entries. Its free-text `details` holds
redacted, structured payloads (`docs/audit-trail.md`). Names, statuses,
enums, dates and foreign keys stay plaintext because filters and indexes
need them.

## `User.email` and `User.emailHash`

A ciphertext cannot be matched: AES-GCM with a random IV encrypts the same
address differently each time. So every lookup by address goes through
`emailHash`, an HMAC-SHA256 under the lookup key of the address trimmed and
lower-cased (`hashForLookup` normalises its input itself):

```ts
prisma.user.findUnique({ where: { emailHash: hashForLookup(email) } });
```

The PII extension also rewrites a `where: { email }` into the hash, but
code names the hash explicitly so the query says what it does.

The column is **nullable in the schema and NOT NULL in the database**, on
purpose (inflect-compliance GAP-21). The extension fills `emailHash` from
`email` on every write, so the schema's `String?` keeps every
`prisma.user.create` from naming it, and the database refuses a row that
skipped the extension. `prisma/fresh-db-schema-drift.expected.sql` records
the one line of residue this leaves, and
`tests/guards/pii-hash-not-null.test.ts` pins both halves. Making the field
required forces the hash into every create site; dropping the NOT NULL lets
a row without a hash break sign-in for that person.

The column names stay `email` and `name` rather than inflect-compliance's
`emailEncrypted`/`nameEncrypted`, because ADR 0006 rule 3 forbids `@map`.
The 1.5 migration refuses a database whose `User` table already holds rows
(their email would be plaintext with no hash); rebuild it from
`prisma/migrations`.

## Environment variables

| Variable | Required | When to set |
|---|---|---|
| `DATA_ENCRYPTION_KEY` | **Yes** in production, at least 32 characters. Development uses the published fallback with a WARN on every start; tests use it silently. | Once per environment, identical across replicas. Generate with `openssl rand -base64 48`. |
| `DATA_ENCRYPTION_KEY_PREVIOUS` | Optional, at least 32 characters | **Only during a master-key rotation.** `decryptField` tries the primary key, then the previous one on an authentication failure. |
| `LOOKUP_HASH_KEY` | Optional, at least 32 characters; unset falls back to `DATA_ENCRYPTION_KEY`'s material | The key the lookup hashes derive from (`hashForLookup`, `keyedChangeDigest`). **Set it to the current `DATA_ENCRYPTION_KEY` value before the first rotation.** A lookup hash is an index, with no previous-key fallback: while it derives from the master key, a rotation makes every email sign-in, OAuth account match and invite redemption miss. |
| `DERIVED_SUBKEY_KEY` | Optional, at least 32 characters; unset falls back to `DATA_ENCRYPTION_KEY`'s material | The material every HKDF subkey (`deriveSubkey`) derives from. Set it with `LOOKUP_HASH_KEY`, for the same reason: a subkey has no fallback either. A separate variable because an index never rotates and a signing key should be able to. |
| `ENCRYPTION_DECRYPT_FAIL_CLOSED` | Optional; unset is fail closed | `0` only as an incident lever (below). |

### Production refuses to start without a key

Two independent checks refuse a production process whose
`DATA_ENCRYPTION_KEY` is missing, shorter than 32 characters or equal to the
development fallback:

1. the Zod schema in `src/env.ts`, at module load;
2. `checkProductionEncryptionKey` in
   `src/lib/security/startup-encryption-check.ts`, run from
   `src/instrumentation-node.ts`, which also covers a process started with
   `SKIP_ENV_VALIDATION=1`, and then an encrypt → decrypt sentinel
   (`runEncryptionSentinel`) that catches a key that passes the shape check
   but breaks HKDF or AES. Each exits with `[startup] FATAL: …`.

The same startup check refuses a production start with
`DATA_ENCRYPTION_KEY_PREVIOUS` set and `LOOKUP_HASH_KEY` or
`DERIVED_SUBKEY_KEY` unset, naming the variable.
`tests/guards/encryption-key-enforcement.test.ts` holds the wiring. The
fallback string is published in `src/lib/security/encryption-constants.ts`
on purpose: its property is "refused in production", not "secret". The
Playwright server runs `next start` in production mode, so it sets its own
throwaway key (`playwright.config.ts`, CI's `E2E` job).

> **Losing `DATA_ENCRYPTION_KEY` loses every encrypted column.** Keep it in
> the secret store with the database backups' own keys, never beside them.

## Per-tenant data keys

A workspace gets its DEK in the write that creates it: the register route
wraps one with `generateAndWrapDek` inside its transaction, as
`createTenantWithDek` does, so a rolled-back registration leaves no key
behind. `Tenant.encryptedDek` stays nullable so seeds and tests can create
a bare `Tenant`; `getTenantDek` then creates the key on first use
(`ensureTenantDek`, which tolerates a concurrent writer).

`Tenant.previousEncryptedDek` holds the old wrapped DEK while a per-tenant
rotation re-encrypts the workspace's rows (below), and the read path falls
back to it (`decryptWithKeyOrPrevious`). The migration adds two things
Prisma's schema cannot express, each tested in
`tests/integration/tenant-dek-schema.test.ts`:

- the CHECK `Tenant_previousEncryptedDek_differs`
  (`"previousEncryptedDek" IS NULL OR "previousEncryptedDek" != "encryptedDek"`):
  a rotation that wrote the same key into both columns would look like a
  rotation in flight that never finishes, and would mix two generations of
  ciphertext under one key with nothing to tell them apart;
- the partial index `Tenant_rotation_in_flight_idx` on `("id") WHERE
  "previousEncryptedDek" IS NOT NULL`, so the sweep's "which workspaces are
  mid-rotation" query reads a handful of rows rather than every tenant.

Both shipped with the columns rather than with the rotation job, so the
job lands with no schema change.

## Decrypt-failure posture (fail closed)

A read that cannot decrypt a value has three causes, with three answers:

| Cause | `outcome` label | Behaviour |
|---|---|---|
| No tenant DEK by design: the `Tenant` model, no ambient `tenantId`, or a bypass caller | `no_dek_by_design` | the field reads as `null` |
| The DEK lookup threw | `dek_resolve_failed` | the ciphertext passes through (fail open) |
| Decryption failed with a DEK in hand: a wrong key, a corrupt row, or a write made under a mismatched tenant context | `decrypt_failed` | **throws** (fail closed) |

Only the third stops the request. A failed request is recoverable (fix the
row); a ciphertext blob that reads as a valid string ends up in an export or
an audit stream and nobody learns. A transient database error is not a data
anomaly, so it does not fail the page.

**Incident lever.** `ENCRYPTION_DECRYPT_FAIL_CLOSED=0` returns to passing
the ciphertext through, without a redeploy, when one corrupt row blocks a
page for longer than the fix will take. Unset it once the row is repaired.

**The ordering this makes load-bearing.** `Tenant.previousEncryptedDek` must
stay set until the per-tenant sweep reports zero rows left under it: clearing
it early turns those rows' reads into 500s.

## Rotating the master key

Three pieces, sub-phase 1.5b:

- **`key-rotation`** (`src/app-layer/jobs/key-rotation.ts`), one workspace per
  run, started by `POST /api/t/<slug>/admin/key-rotation`
  (`admin.tenant_lifecycle`: OWNER-only, owner decision 2026-11-19; 5 per
  hour). It re-wraps `Tenant.encryptedDek` under the
  primary key, then rewrites every `v1:` value the workspace owns: the
  manifest fields of every model with a `tenantId` column, and the
  tenant-scoped PII columns (`PII_TENANT_SCOPED_MODELS`, today the outbox
  recipient). `v2:` values are under the workspace DEK, whose bytes do not
  change, so they are untouched.
- **`scripts/rotate-global-pii.ts`**, once per rotation, for the PII columns
  of tables with no `tenantId` (`User.email`, `User.name`, the `Account`
  token copies): no per-workspace run reaches them. Without `--execute` it
  only counts; with it, it rewrites and exits non-zero if any row failed.
- **`GET /api/t/<slug>/admin/key-rotation?jobId=…`**: the job's state and
  result (counts, never key material). Another workspace's job, another kind
  of job, or an unknown id is a 404.

Each sweep reads `v1:%` rows in pages keyed on `id` (a rewritten row is still
`v1:`, so the prefix cannot mark progress), decrypts with the dual-key
`decryptField`, re-encrypts under the primary and writes with an `UPDATE`
conditional on the value it read, so a user's newer write is never
overwritten with the old plaintext. It is idempotent: a second run rewrites
the same rows again, harmlessly. A model probe that fails for any reason but a
missing column fails the run rather than skipping the model. The job writes
`KEY_ROTATION_STARTED` and `KEY_ROTATION_COMPLETED` (with the counts) to the
workspace's chain, under the authority described in "Who a rotation acts as"
below; the route writes
`KEY_ROTATION_INITIATED` naming the job. A run with any error, or a DEK that
did not re-wrap, is a failed job (`keyRotationOutcome`), and it is not retried
by the queue: the operator reads it and re-enqueues.

Pre-flight:

- [ ] **`LOOKUP_HASH_KEY` and `DERIVED_SUBKEY_KEY` are both set to the
  current (outgoing) `DATA_ENCRYPTION_KEY` value, deployed and restarted,
  before the new key goes anywhere.** No backfill is needed: the material
  does not change, so every stored hash still resolves.
- [ ] A new `DATA_ENCRYPTION_KEY` is generated (`openssl rand -base64 48`).
- [ ] Every replica, the worker included, has the new key as
  `DATA_ENCRYPTION_KEY` and the old one as `DATA_ENCRYPTION_KEY_PREVIOUS`; a
  rolling restart is done and reads and writes still work. From here on,
  reads try the new key first and fall back to the old one, and every write
  uses the new one.

Then:

1. For every workspace, `POST /api/t/<slug>/admin/key-rotation` and wait for
   the job to complete with zero errors (`GET …?jobId=`).
2. Once: `npx tsx scripts/rotate-global-pii.ts --execute` (with the app's
   environment exported), until it reports zero errors.
3. Only when **both** report zero errors, remove
   `DATA_ENCRYPTION_KEY_PREVIOUS` and restart. Never remove the previous key
   while a rotation is in flight: a value still under it would no longer
   read.

`tests/integration/key-rotation.test.ts` plays this runbook against a real
database: every value the rotation owns reads mid-flight, is rewritten, and
reads under the new key alone after the old one is removed.

The API-key liveness check inflect-compliance makes before the work (a key
revoked while the job waited) returns with API keys in 5.2.

### Who a rotation acts as

Owner decision, 2026-11-19, for both rotations
(`src/app-layer/jobs/rotation-actor.ts`). When the job runs, the person who
started it is resolved again (`resolveInitiatorContext`):

- **Still an ACTIVE member holding `admin.tenant_lifecycle`:** the job acts as
  them. Its STARTED and COMPLETED entries name them (`actorType: 'USER'`) with
  `authority: 'INITIATOR'`.
- **Anything else** (removed from the workspace, deactivated, demoted below the
  key, or the workspace soft-deleted): the rotation **still finishes**, as the
  workspace's system user (`sys_<tenantId>`, `buildTenantSystemJobContext`,
  `actorType: 'JOB'`). The entries' `detailsJson` and the job result's `actor`
  carry `authority: 'SYSTEM'`, `requestedByUserId` (who asked) and `refusal`
  (`NOT_A_MEMBER`, `NOT_ACTIVE` with the status, `LACKS_PERMISSION`, or
  `TENANT_DELETED`). The person who asked is never written as the actor.

A rotation is not stopped because the person who asked has gone: that would
leave a workspace's keys half-moved (a previous master key that cannot be
retired, or a compromised DEK still kept as the previous one). This is the one
exception to the rule that a job doing what a person asked stops when that
person no longer resolves (CLAUDE.md, "Job identity").
`tests/integration/rotation-initiator.test.ts` proves both branches for both
jobs.

### Key compromise

1. **Do not delete the old key**: existing ciphertext needs it.
2. Deploy the new key as primary and the compromised one as previous.
3. Rotate every workspace and sweep the global PII columns (above).
4. When all report zero errors, remove the old key.
5. Verify the audit chain over the window (`npx tsx
   scripts/verify-audit-chain.ts`): a valid chain shows nobody rewrote the
   trail during the incident.

## Rotating a workspace's data key

The response to a suspected compromise of ONE workspace's DEK, without
touching the master key. OWNER-only (`admin.tenant_lifecycle`), 5 per hour.

`POST /api/t/<slug>/admin/tenant-dek-rotation` calls `rotateTenantDek`
(`src/lib/security/tenant-key-manager.ts`):

1. **The swap.** A fresh DEK, wrapped under the master key, is written to
   `encryptedDek` and the old wrapped DEK to `previousEncryptedDek`, in one
   `UPDATE … WHERE previousEncryptedDek IS NULL`. A rotation already in
   flight, or a concurrent one that won the swap, is refused: the route
   answers **409** and nothing changes. The CHECK
   `Tenant_previousEncryptedDek_differs` refuses the same key in both columns.
2. **The caches.** This process primes its cache with the new DEK and keeps
   the old one as the previous.
3. **The sweep.** `tenant-dek-rotation` is enqueued (`TENANT_DEK_ROTATED` is
   written naming the job). If the enqueue fails after the swap, the call
   throws; reads keep working through the previous DEK, and the operator
   re-enqueues `tenant-dek-rotation` with the same payload.

While the sweep runs, reads stay correct: the extension tries the new DEK
first and falls back to the previous one (`decryptWithKeyOrPrevious`), and
new writes use the new DEK. The sweep (`src/app-layer/jobs/tenant-dek-rotation.ts`):

- resolves BOTH keys from the row, after dropping its own process's caches: the
  swap happened in the web process, and the worker may still hold the old DEK
  as the current one;
- walks every `v2:` value of every manifest field of the workspace, in pages
  keyed on `id`; decrypts under the previous DEK only; re-encrypts under the
  new; writes conditionally on the value it read;
- counts a row that already reads under the new DEK as skipped, and a row that
  reads under neither key as an error;
- clears `previousEncryptedDek` only when the run had **zero errors**. With
  any error the previous DEK stays, reads keep working, and the job fails for
  the operator to investigate and re-enqueue;
- reports progress (`phase`: `starting`, `sweeping`, `finalising`, `complete`
  or `noop`, with counts) through the job, which
  `GET /api/t/<slug>/admin/tenant-dek-rotation?jobId=…` returns, and writes
  `TENANT_DEK_ROTATION_STARTED` and `_COMPLETED` to the chain, under the
  authority described in "Who a rotation acts as" above.

A second rotation is accepted once the sweep has cleared the previous slot.
`tests/integration/tenant-dek-rotation.test.ts` proves the swap, the 409's
condition, the mid-flight reads through the app's client and the sweep;
`tests/guards/tenant-dek-rotation-fallback.test.ts` holds the fallback wiring
and the OWNER-only gate.

Any future write-once trigger on an encrypted column must admit the sweep's
ciphertext-to-`v2:` re-wrap with every other column unchanged, or the sweep
fails on that table and the rotation never finishes.

## Signals

| Key | Source | Meaning |
|---|---|---|
| `encryption.field.decrypt_failed` (metric, `outcome` label) | encryption middleware | Which of the three causes above. `decrypt_failed` should be zero. |
| `encryption-middleware.decrypt_failed` | encryption middleware | One field could not decrypt: `model`, `field`, `version`, `reason`; never plaintext or key bytes. |
| `encryption-middleware.dek_resolve_failed` | encryption middleware | `getTenantDek` threw. |
| `encryption-middleware.write_unscoped`, `.write_tenant_mismatch`; metric `encryption.write.tenant_context_mismatch` | encryption middleware | A manifest write ran with no tenant context, or under another workspace's. |
| `pii.decrypt_failure` | PII extension | A personal-data column could not decrypt. |
| `tenant-key-manager.tenant_created_with_dek`, `.dek_backfilled`, `.dek_backfill_raced` | key manager | A workspace got its key at creation, lazily, or lost a harmless race to another writer. |
| `tenant-key-manager.dek_rotated`, `.dek_rotated_but_enqueue_failed` | key manager | A workspace's DEK was swapped; or swapped and its sweep could not be enqueued (re-enqueue `tenant-dek-rotation`). |
| `key-rotation.complete` (`error` level when `totalErrors > 0`), `.decrypt_failed`, `.update_failed`, `.model_probe_failed`, `.global_pii_swept` | master-key rotation | A run's counts; a row it could not rewrite (`model`, `field`, `id`; never a value). |
| `tenant-dek-rotation.complete` (`error` level when `totalErrors > 0`), `.row_unreadable`, `.concurrent_write_unreadable`, `.no_previous_dek` | DEK sweep | A sweep's counts; a row that reads under neither key, so the previous DEK was kept. |

## Caveats

- **Raw SQL bypasses the extensions.** `$queryRaw` and the test client's
  raw reads see ciphertext; the integration suites use that to prove a
  column is encrypted.
- **Key material lives in process memory**, in the KEK cache and the DEK
  LRU, per replica. A rotation clears the cache on the replica that ran it;
  the others keep identical DEK bytes until restart, because a master-key
  rotation re-wraps the DEK without changing it.
- **An encrypted field cannot be searched by substring.** A field that needs
  `contains` search stays out of the manifest, and the decision is a
  product one, recorded in the manifest beside it.
