# Field encryption and lookup hashes

Sub-phase 1.5. Islestone encrypts personal data and secrets at rest in the
application, below Prisma, so a database dump, a backup or a read replica
holds ciphertext. Transport encryption, disk encryption and backup
encryption belong to the operations docs (1.8).

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

Every work-item and comment field joins the manifest in the sub-phase that
creates its model (2.2 on). `tests/guards/encryption-manifest-coverage.test.ts`
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
   `src/instrumentation.ts`, which also covers a process started with
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
rotation (1.5b) re-encrypts the workspace's rows, and the read path falls
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

The dual-key fallback is in place now; the per-tenant re-encryption job
(`POST /api/t/<slug>/admin/key-rotation`) and the global PII sweep
(`scripts/rotate-global-pii.ts`) arrive with sub-phase 1.5b, once 1.6 brings
the job queue. Until then a rotation can be started but not finished, so do
not start one unless a key is compromised.

Pre-flight:

- [ ] **`LOOKUP_HASH_KEY` and `DERIVED_SUBKEY_KEY` are both set to the
  current (outgoing) `DATA_ENCRYPTION_KEY` value, deployed and restarted,
  before the new key goes anywhere.** No backfill is needed: the material
  does not change, so every stored hash still resolves.
- [ ] A new `DATA_ENCRYPTION_KEY` is generated (`openssl rand -base64 48`).
- [ ] Every replica has the new key as `DATA_ENCRYPTION_KEY` and the old one
  as `DATA_ENCRYPTION_KEY_PREVIOUS`; a rolling restart is done and reads and
  writes still work.

Then (1.5b): run the per-tenant rotation for every workspace and the global
PII sweep once (`User` and `Account` carry no `tenantId`, so no per-tenant
run reaches them). Only when **both** report zero rows left under the old
key, remove `DATA_ENCRYPTION_KEY_PREVIOUS` and restart. Never remove the
previous key while a rotation is in flight.

### Key compromise

1. **Do not delete the old key**: existing ciphertext needs it.
2. Deploy the new key as primary and the compromised one as previous.
3. Rotate every workspace and sweep the global PII columns (1.5b).
4. When all report zero rows under the old key, remove it.
5. Verify the audit chain over the window (`npx tsx
   scripts/verify-audit-chain.ts`): a valid chain shows nobody rewrote the
   trail during the incident.

## Signals

| Key | Source | Meaning |
|---|---|---|
| `encryption.field.decrypt_failed` (metric, `outcome` label) | encryption middleware | Which of the three causes above. `decrypt_failed` should be zero. |
| `encryption-middleware.decrypt_failed` | encryption middleware | One field could not decrypt: `model`, `field`, `version`, `reason`; never plaintext or key bytes. |
| `encryption-middleware.dek_resolve_failed` | encryption middleware | `getTenantDek` threw. |
| `encryption-middleware.write_unscoped`, `.write_tenant_mismatch`; metric `encryption.write.tenant_context_mismatch` | encryption middleware | A manifest write ran with no tenant context, or under another workspace's. |
| `pii.decrypt_failure` | PII extension | A personal-data column could not decrypt. |
| `tenant-key-manager.tenant_created_with_dek`, `.dek_backfilled`, `.dek_backfill_raced` | key manager | A workspace got its key at creation, lazily, or lost a harmless race to another writer. |

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
