/**
 * # The encrypted field manifest (field encryption, sub-phase 1.5)
 *
 * Copied in part from inflect-compliance `src/lib/security/encrypted-fields.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e: the helpers verbatim, the
 * manifest cut to Islestone's one entry, the header kept where it is about
 * the mechanism. See docs/encryption.md.
 *
 * Lists the business-content fields that the Prisma encryption extension
 * (`src/lib/db/encryption-middleware.ts`) encrypts at rest. The manifest
 * drives encrypt-on-write and decrypt-on-read; no other code path should
 * consult these columns without going through the extension.
 *
 * **Enforcement — this manifest is opt-OUT, not opt-in-by-memory.**
 * `tests/guards/encryption-manifest-coverage.test.ts` scans the live Prisma
 * schema and fails CI if any tenant-scoped `String` column whose NAME looks
 * sensitive (note / comment / description / summary / … — see the guard's
 * `SENSITIVITY_HEURISTIC`) is neither listed here NOR justified in that
 * guard's `NOT_SENSITIVE` allowlist with a written reason. A new sensitive
 * column cannot silently ship plaintext: its author encrypts it here or
 * records why it stays plaintext.
 *
 * Pattern: **in-place encryption**. Unlike the PII extension
 * (`src/lib/security/pii-middleware.ts`), which keeps a lookup hash beside
 * the ciphertext, a business-content field is encrypted into the column that
 * would otherwise hold its plaintext.
 *
 *   - No schema change is needed to encrypt a field.
 *   - Detection is idempotent: every ciphertext begins with a version prefix
 *     (`v1:` under the global KEK, `v2:` under the workspace's DEK; see
 *     `encryption.ts`). The extension checks `isEncryptedValue()` before both
 *     encrypt and decrypt, so double encryption and plaintext rows are safe.
 *
 * **Fields DELIBERATELY NOT in this manifest:**
 *   - PII fields (`User.email`, `User.name`) — handled by `pii-middleware.ts`,
 *     which also keeps the lookup hash.
 *   - Operational keys (status, category, priority, FKs, dates) —
 *     load-bearing for filters, joins and indexes.
 *   - Fields a repository searches with `contains`/`startsWith`/`orderBy`:
 *     an encrypted column cannot be searched (ADR 0002, section 11: search
 *     covers titles, keys and unencrypted fields until a search ADR decides).
 *   - `AuditLog.*` — the append-only hash-chained trail. Encrypting it would
 *     break `entryHash` integrity, and an investigation needs plaintext.
 *
 * **Sub-phases 2.2, 5.1 and 6.x add their own entries** (work-item and
 * comment bodies, automation rules, agent runs).
 */

/**
 * Map from Prisma model name → list of string fields to encrypt.
 * Field names match the Prisma schema exactly.
 *
 * Adding a new field requires:
 *   1. Append to the list here.
 *   2. Verify it's not used in a `contains` / `startsWith` /
 *      `orderBy` in any repository. If it is, either move the
 *      repository off the search (preferred) or skip this field
 *      (record the skip in the guard's `NOT_SENSITIVE` allowlist).
 *   3. Extend the encryption-extension tests with a write-then-read
 *      round trip for the new field.
 *   4. Backfill existing rows in a follow-up migration before the next
 *      tenant writes to the column.
 *
 * A future integration connection's credentials (5.x) do NOT belong in a
 * manifest-managed column holding public configuration: they go in an
 * explicit encrypted secret field, written with `encryptField` and decrypted
 * at the read, so the public half stays renderable.
 */
export const ENCRYPTED_FIELDS: Readonly<Record<string, readonly string[]>> = {
    // The audit stream's HMAC secret (src/app-layer/events/audit-stream.ts).
    // Never rendered and never searched; encrypted because a leaked secret
    // lets anyone forge the workspace's SIEM deliveries.
    TenantSecuritySettings: ['auditStreamSecretEncrypted'],
    // Work items and comments (sub-phase 2.2, ADR 0002 §11). Copied from
    // inflect-compliance `src/lib/security/encrypted-fields.ts` lines 292–296
    // at 5528464fc54a8681956f3b9ce23ca9c075f0420e (`Task: ['description',
    // 'resolution']` → `WorkItem: ['description']`, `TaskComment: ['body']` →
    // `Comment: ['body']`). The repository searches `title` and the key
    // number, never the description, so `description` is safe to encrypt;
    // `title` stays plaintext (searched, shown in notifications, quoted in
    // commit messages). Both are sanitised before they are stored.
    WorkItem: ['description'],
    Comment: ['body'],
    // Templates (sub-phase 2.5c, owner decision 73). An item template's
    // description is the same kind of text as an item's, so it is encrypted
    // the same way; a project template's whole content (fields, milestones,
    // item templates with their descriptions, starter items) is one JSON
    // document, encrypted as one value. Names and titles stay plaintext.
    // Both are sanitised before they are stored.
    WorkItemTemplate: ['description'],
    ProjectTemplate: ['contentJson'],
} as const;

/** Set of model names with at least one encrypted field. Fast-path check. */
export const ENCRYPTED_MODELS: ReadonlySet<string> = new Set(
    Object.keys(ENCRYPTED_FIELDS),
);

/**
 * Union of every encrypted field name across every model in the
 * manifest. Used by the middleware's fan-out path to short-circuit
 * node traversal: if a node has no keys that intersect this set, it
 * contains no encrypted fields and we can skip the per-model
 * iteration entirely.
 *
 * Correctness note: as the manifest grows, models will share field
 * names (`body` on a work item and a comment, say). The fan-out path does
 * NOT distinguish which model a nested node belongs to — it relies on the
 * flat set to gate whether decryption is even possible on this node. The
 * per-value `isEncryptedValue()` gate then decides whether to actually
 * decrypt. A plaintext field that shares a name with an encrypted field on
 * another model is safe: it has no `v1:`/`v2:` prefix, so the decrypt is
 * skipped.
 */
export const ALL_ENCRYPTED_FIELD_NAMES: ReadonlySet<string> = new Set(
    Object.values(ENCRYPTED_FIELDS).flat(),
);

/**
 * Fast check: does this node contain any key that could possibly be
 * an encrypted field? Used by the middleware to skip the traversal
 * entirely when a node (or nested included relation) has no
 * manifest-visible fields.
 */
export function nodeHasAnyEncryptedFieldKey(
    node: Record<string, unknown>,
): boolean {
    for (const key of Object.keys(node)) {
        if (ALL_ENCRYPTED_FIELD_NAMES.has(key)) return true;
    }
    return false;
}

/**
 * Returns the encrypted-field list for a model, or `undefined` if
 * the model has no encrypted fields. Callers MUST NOT mutate the
 * returned array.
 */
export function getEncryptedFields(
    modelName: string | undefined,
): readonly string[] | undefined {
    if (!modelName) return undefined;
    return ENCRYPTED_FIELDS[modelName];
}

/** Predicate — is this model in the manifest? */
export function isEncryptedModel(modelName: string | undefined): boolean {
    return modelName !== undefined && ENCRYPTED_MODELS.has(modelName);
}
