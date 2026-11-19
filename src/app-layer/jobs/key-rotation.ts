/**
 * Master-key (KEK) rotation for one workspace.
 *
 * Rotates one tenant's key material forward onto the currently-
 * primary `DATA_ENCRYPTION_KEY`. Two concrete side-effects:
 *
 *   1. **Re-wrap the tenant DEK.** `Tenant.encryptedDek` holds the
 *      tenant's 32-byte DEK wrapped under the KEK. After a master-
 *      KEK rotation the DEK is still valid — we just need to re-wrap
 *      it under the new KEK so the row stays readable once
 *      `DATA_ENCRYPTION_KEY_PREVIOUS` is retired.
 *
 *   2. **Re-encrypt v1 ciphertexts.** Any field in `ENCRYPTED_FIELDS`
 *      that still holds a `v1:` envelope was written under the
 *      global KEK (a bypass source, or a write with no workspace
 *      context), and every tenant-scoped PII column
 *      (`PII_TENANT_SCOPED_MODELS`, today the outbox recipient) is
 *      `v1:` by design. Those values need to round-trip through the
 *      dual-KEK decrypt + primary-KEK encrypt so a future operator
 *      can remove the previous-key env var without losing access.
 *
 *      v2 ciphertexts are out of scope — they're wrapped under the
 *      tenant DEK, not the master KEK, so master rotation leaves
 *      them untouched.
 *
 * ## Zero-downtime guarantee
 *
 * - `decryptField` transparently falls back to the previous KEK
 *   during rotation, so readers keep working on rows we haven't
 *   processed yet.
 * - `encryptField` always uses the current primary KEK, so new
 *   writes land under the new key regardless of job progress.
 * - Every UPDATE is single-row. Mid-rotation crash leaves partial
 *   progress intact; re-running the job picks up from wherever the
 *   SELECT cursor stops finding v1 rows belonging to this tenant.
 *
 * ## Idempotency
 *
 * - DEK re-wrap is a no-op if the DEK is already wrapped under the
 *   primary KEK (we can't cheaply detect this; every re-run pays
 *   one re-wrap per tenant — acceptable, it's one row).
 * - v1 re-encrypt is gated by `WHERE "field" LIKE 'v1:%'`, so rows
 *   already processed in a prior run are skipped by the SELECT.
 *
 * ## What this job does NOT do
 *
 *   - Tenant-DEK rotation (generating a new per-tenant DEK and
 *     re-encrypting every v2 ciphertext). That's a separate
 *     higher-privilege (OWNER-only) operation: `rotateTenantDek` in
 *     `src/lib/security/tenant-key-manager.ts` and its sweep,
 *     `tenant-dek-rotation.ts`.
 *   - The global PII columns (`User`, `Account`), which carry no
 *     `tenantId`: `rotateGlobalPiiColumns` below, run once per
 *     rotation by `scripts/rotate-global-pii.ts`.
 *   - Master-key material distribution. The operator still sets
 *     `DATA_ENCRYPTION_KEY` / `DATA_ENCRYPTION_KEY_PREVIOUS`
 *     outside the application.
 *
 * Copied from inflect-compliance `src/app-layer/jobs/key-rotation.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 1.5b). Cut: the
 * re-check of the API key that requested the rotation (`resolveApiKeyForJob`
 * and the `apiKeyId` option), which returns with API keys in sub-phase 5.2.
 * One index read made explicit; comments rewritten for Islestone's manifest.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { runJob } from '@/lib/observability/job-runner';
import { logger } from '@/lib/observability/logger';
import {
    encryptField,
    decryptField,
} from '@/lib/security/encryption';
import {
    unwrapDek,
    wrapDek,
    isWrappedDek,
} from '@/lib/security/tenant-keys';
import { clearTenantDekCache } from '@/lib/security/tenant-key-manager';
import { ENCRYPTED_FIELDS } from '@/lib/security/encrypted-fields';
import {
    PII_ENCRYPTED_COLUMNS,
    PII_GLOBAL_MODELS,
    PII_TENANT_SCOPED_MODELS,
} from '@/lib/security/pii-middleware';
import { appendAuditEntry } from '@/lib/audit/audit-writer';
import {
    resolveRotationActor,
    rotationActorRecord,
    type RotationActorRecord,
} from './rotation-actor';

// ─── Types ──────────────────────────────────────────────────────────

export interface KeyRotationOptions {
    tenantId: string;
    /**
     * Who asked. Re-resolved when the job runs (`resolveRotationActor`): the
     * job acts as them while they still hold `admin.tenant_lifecycle`, and as
     * the workspace system user otherwise, recording who asked and why.
     */
    initiatedByUserId: string;
    requestId?: string;
    /** Override SELECT batch size per (model, field). Default 500. */
    batchSize?: number;
}

export interface KeyRotationPerFieldResult {
    model: string;
    field: string;
    scanned: number;
    rewritten: number;
    errors: number;
}

export interface KeyRotationResult {
    tenantId: string;
    /** Whose authority the run carried, who asked, and why if not them. */
    actor: RotationActorRecord;
    dekRewrapped: boolean;
    dekRewrapError?: string;
    perField: KeyRotationPerFieldResult[];
    totalScanned: number;
    totalRewritten: number;
    totalErrors: number;
    durationMs: number;
    jobRunId: string;
}

// ─── Safety helpers ─────────────────────────────────────────────────

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdentifier(name: string, kind: string): void {
    if (!IDENT_RE.test(name)) {
        throw new Error(
            `key-rotation: invalid ${kind} identifier: ${JSON.stringify(name)}`,
        );
    }
}

// ─── DEK re-wrap ────────────────────────────────────────────────────

/**
 * Re-wrap this tenant's DEK under the current primary KEK. Idempotent
 * in outcome (the unwrapped DEK bytes are identical; only the wrap
 * changes) but we always perform the work — we can't cheaply check
 * "is this already under the primary KEK?" without decrypting with
 * the current primary, which we're doing anyway.
 *
 * Also invalidates the tenant-key-manager cache for this tenant so
 * subsequent requests re-unwrap fresh under the new KEK.
 */
async function rewrapTenantDek(tenantId: string): Promise<{
    ok: boolean;
    error?: string;
}> {
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { encryptedDek: true },
    });
    if (!tenant) {
        return { ok: false, error: 'tenant not found' };
    }
    if (!tenant.encryptedDek) {
        // No DEK yet — handled by tenant-key-manager's lazy-init path.
        // Not our concern.
        return { ok: true };
    }
    if (!isWrappedDek(tenant.encryptedDek)) {
        return { ok: false, error: 'encryptedDek is not a valid wrapped DEK' };
    }

    try {
        // Dual-KEK decrypt handles the rotation: if the DEK was wrapped
        // under the OLD KEK and primary is NEW, the fallback inside
        // `decryptField` unwraps successfully.
        const dek = unwrapDek(tenant.encryptedDek);
        const rewrapped = wrapDek(dek);
        await prisma.tenant.update({
            where: { id: tenantId },
            data: { encryptedDek: rewrapped },
        });
        // Drop the cached raw DEK so future requests re-unwrap under
        // the new KEK. (The raw bytes are identical, so functionally
        // the cache is already correct — but clearing keeps the
        // invariant "cached DEK came from the latest wrap" true,
        // which simplifies future rotation debugging.)
        clearTenantDekCache(tenantId);
        return { ok: true };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

// ─── v1 ciphertext re-encrypt ───────────────────────────────────────

/** The sweep's page size. Named once so the two sweeps cannot disagree. */
const DEFAULT_BATCH_SIZE = 500;

async function rewriteV1Field(
    /**
     * NULL sweeps the whole table — the global PII models (#5070), which carry
     * no `tenantId` and which the per-tenant job's own guard skips. Everything
     * below this point is already tenant-agnostic: only the SELECT ever named
     * a tenant, and the conditional UPDATE keys on the row id and the value it
     * read.
     */
    tenantId: string | null,
    model: string,
    field: string,
    batchSize: number,
): Promise<KeyRotationPerFieldResult> {
    assertIdentifier(model, 'model');
    assertIdentifier(field, 'field');

    const out: KeyRotationPerFieldResult = {
        model,
        field,
        scanned: 0,
        rewritten: 0,
        errors: 0,
    };

    // Read raw SQL — bypass the encryption middleware so we see the
    // actual v1 ciphertext (not a decrypted plaintext from the
    // middleware's read path).
    //
    // Keyset pagination on `id` is mandatory (#5099): a rewritten row is
    // STILL `v1:` (now under the new primary KEK), so the prefix cannot
    // mark progress, and re-reading from the top returned the same first
    // batch for ever once a field held `batchSize` rows. The cursor also
    // moves past a row that failed, so a batch of undecryptable rows
    // cannot loop either.
    //
    // The predicate and the bind list are built TOGETHER. Two edits that have
    // to agree about `$1` are two edits that eventually disagree, and the
    // failure would be a silent one: a mis-numbered bind either throws or,
    // worse, filters on the wrong value and reports `scanned: 0` as success.
    const scoped = tenantId !== null;
    const selectSql = scoped
        ? `
        SELECT id, "${field}" AS value
        FROM "${model}"
        WHERE "tenantId" = $1
          AND "${field}" IS NOT NULL
          AND "${field}" LIKE 'v1:%'
          AND ($3::text IS NULL OR id > $3)
        ORDER BY id
        LIMIT $2
    `
        : `
        SELECT id, "${field}" AS value
        FROM "${model}"
        WHERE "${field}" IS NOT NULL
          AND "${field}" LIKE 'v1:%'
          AND ($2::text IS NULL OR id > $2)
        ORDER BY id
        LIMIT $1
    `;
    const bindsFor = (lastId: string | null): unknown[] =>
        scoped ? [tenantId, batchSize, lastId] : [batchSize, lastId];
    let lastId: string | null = null;

    while (true) {
        let rows: Array<{ id: string; value: string }>;
        try {
            rows = await prisma.$queryRawUnsafe<
                Array<{ id: string; value: string }>
            >(selectSql, ...bindsFor(lastId));
        } catch (err) {
            logger.error('key-rotation.select_failed', {
                component: 'key-rotation',
                tenantId,
                model,
                field,
                error: err instanceof Error ? err.message : String(err),
            });
            out.errors++;
            return out;
        }

        if (rows.length === 0) break;
        out.scanned += rows.length;

        for (const row of rows) {
            let plaintext: string;
            try {
                // Dual-KEK decrypt — handles both keys.
                plaintext = decryptField(row.value);
            } catch (err) {
                out.errors++;
                logger.error('key-rotation.decrypt_failed', {
                    component: 'key-rotation',
                    tenantId,
                    model,
                    field,
                    id: row.id,
                    error: err instanceof Error ? err.message : 'unknown',
                });
                continue;
            }

            let fresh: string;
            try {
                // Always under the current primary KEK.
                fresh = encryptField(plaintext);
            } catch (err) {
                out.errors++;
                logger.error('key-rotation.encrypt_failed', {
                    component: 'key-rotation',
                    tenantId,
                    model,
                    field,
                    id: row.id,
                    error: err instanceof Error ? err.message : 'unknown',
                });
                continue;
            }

            try {
                // Conditional on the value read: a user edit that landed
                // after the SELECT is newer than our plaintext and must
                // not be overwritten with it (#5109). A row that moved on
                // was written by the middleware under the current key, so
                // it needs nothing from this sweep.
                const updated = await prisma.$executeRawUnsafe(
                    `UPDATE "${model}" SET "${field}" = $1 WHERE id = $2 AND "${field}" = $3`,
                    fresh,
                    row.id,
                    row.value,
                );
                if (updated > 0) out.rewritten++;
            } catch (err) {
                out.errors++;
                logger.error('key-rotation.update_failed', {
                    component: 'key-rotation',
                    tenantId,
                    model,
                    field,
                    id: row.id,
                    error: err instanceof Error ? err.message : 'unknown',
                });
            }
        }

        // `rows` is non-empty here (the empty page broke out above).
        lastId = rows[rows.length - 1]!.id;
        if (rows.length < batchSize) break;
    }

    return out;
}

// ─── Public entry point ─────────────────────────────────────────────

/**
 * Run the full rotation for one tenant. Structured as:
 *   1. Audit-log "started" event.
 *   2. Re-wrap Tenant.encryptedDek.
 *   3. For each (model, field) in the manifest that has a tenantId
 *      column, re-encrypt v1 ciphertexts.
 *   4. Audit-log "completed" event with summary.
 */
export async function runKeyRotation(
    options: KeyRotationOptions,
): Promise<KeyRotationResult> {
    return runJob(
        'key-rotation',
        async () => {
            const jobRunId = crypto.randomUUID();
            const started = Date.now();
            const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);

            // Who this run acts as: the person who asked, if they still hold
            // the key, else the workspace system user. Never a stop: see
            // `rotation-actor.ts` (owner decision, 2026-11-19).
            const actor = await resolveRotationActor({
                tenantId: options.tenantId,
                requestedByUserId: options.initiatedByUserId,
                job: 'key-rotation',
                requestId: options.requestId,
            });
            const actorRecord = rotationActorRecord(actor);

            await appendAuditEntry({
                tenantId: options.tenantId,
                userId: actor.ctx.userId,
                actorType: actor.ctx.actorType ?? 'USER',
                entity: 'TenantKey',
                entityId: options.tenantId,
                action: 'KEY_ROTATION_STARTED',
                details: null,
                detailsJson: { category: 'custom', event: 'key_rotation_started', ...actorRecord },
                metadataJson: { jobRunId },
                requestId: options.requestId ?? null,
            });

            // 1. DEK re-wrap.
            const dekOutcome = await rewrapTenantDek(options.tenantId);

            // 2. v1 re-encrypt per (model, field) that carries tenantId.
            //    The manifest doesn't expose which models have a
            //    tenantId column, so we probe each manifest model
            //    once via `modelHasTenantIdColumn`. Models without
            //    one are skipped — the encrypted content on those
            //    rows could only be reached by a parent-walking
            //    rotation, which does not exist: every model in
            //    Islestone's manifest carries its own tenantId.
            const perField: KeyRotationPerFieldResult[] = [];
            let totalScanned = 0;
            let totalRewritten = 0;
            let totalErrors = dekOutcome.ok ? 0 : 1;

            // ── THE PII COLUMNS, WHICH THIS SWEEP USED TO SKIP (#5070) ──
            //
            // `pii-middleware` writes its own columns with v1 `encryptField`,
            // and they are NOT in `ENCRYPTED_FIELDS`, so in inflect-compliance
            // this loop never saw them and no other job rewrote them. The
            // runbook then said to remove
            // `DATA_ENCRYPTION_KEY_PREVIOUS` once the job reports zero v1
            // rows — a report that was true of the manifest and false of the
            // database — after which `decryptOnRead` nulls every mapped PII
            // field and only the archived old key can recover it.
            //
            // Only the TENANT-SCOPED models can be done here. `User` and
            // `Account` carry no `tenantId`, and the guard below would skip
            // them anyway; they are the global sweep's job
            // (`scripts/rotate-global-pii.ts`), and the runbook pairs the two.
            //
            // The ciphertext column only: a lookup hash is an index keyed on
            // LOOKUP_HASH_KEY (#5071) and must not move during a rotation.
            const rotatable: Array<[string, readonly string[]]> = [
                ...Object.entries(ENCRYPTED_FIELDS),
                ...PII_TENANT_SCOPED_MODELS.map(
                    (m) => [m, PII_ENCRYPTED_COLUMNS[m] ?? []] as [string, readonly string[]],
                ),
            ];

            for (const [model, fields] of rotatable) {
                // Probe — does this model have a tenantId column? We
                // infer from the Prisma model by attempting a small
                // COUNT(*). Cheaper than walking DMMF; the probe
                // result is cached per (model) for the job's life.
                const hasTenantId = await modelHasTenantIdColumn(model);
                if (!hasTenantId) continue;

                for (const field of fields) {
                    const result = await rewriteV1Field(
                        options.tenantId,
                        model,
                        field,
                        batchSize,
                    );
                    perField.push(result);
                    totalScanned += result.scanned;
                    totalRewritten += result.rewritten;
                    totalErrors += result.errors;
                }
            }

            const durationMs = Date.now() - started;

            await appendAuditEntry({
                tenantId: options.tenantId,
                userId: actor.ctx.userId,
                actorType: actor.ctx.actorType ?? 'USER',
                entity: 'TenantKey',
                entityId: options.tenantId,
                action: 'KEY_ROTATION_COMPLETED',
                details: null,
                detailsJson: { category: 'custom', event: 'key_rotation_completed', ...actorRecord },
                metadataJson: {
                    jobRunId,
                    dekRewrapped: dekOutcome.ok,
                    dekRewrapError: dekOutcome.error,
                    totalScanned,
                    totalRewritten,
                    totalErrors,
                    durationMs,
                },
                requestId: options.requestId ?? null,
            });

            (totalErrors > 0 ? logger.error : logger.info)('key-rotation.complete', {
                component: 'key-rotation',
                tenantId: options.tenantId,
                jobRunId,
                dekRewrapped: dekOutcome.ok,
                totalScanned,
                totalRewritten,
                totalErrors,
                durationMs,
            });

            return {
                tenantId: options.tenantId,
                actor: actorRecord,
                dekRewrapped: dekOutcome.ok,
                dekRewrapError: dekOutcome.error,
                perField,
                totalScanned,
                totalRewritten,
                totalErrors,
                durationMs,
                jobRunId,
            };
        },
        { tenantId: options.tenantId },
    );
}

// ─── Helpers ────────────────────────────────────────────────────────

const _modelHasTenantIdCache = new Map<string, boolean>();

async function modelHasTenantIdColumn(model: string): Promise<boolean> {
    assertIdentifier(model, 'model');
    const cached = _modelHasTenantIdCache.get(model);
    if (cached !== undefined) return cached;
    try {
        await prisma.$queryRawUnsafe(
            `SELECT "tenantId" FROM "${model}" LIMIT 0`,
        );
        _modelHasTenantIdCache.set(model, true);
        return true;
    } catch (err) {
        // ONLY Postgres' undefined_column (42703) means "this model has no
        // tenantId". Any other failure — a dropped connection, a pool or
        // statement timeout — is thrown, never cached as false: a model
        // skipped on a transient error contributed no errors to the sweep,
        // so the run reported clean while that model's rows were never
        // touched (#5108).
        if (isUndefinedColumnError(err)) {
            _modelHasTenantIdCache.set(model, false);
            return false;
        }
        logger.error('key-rotation.model_probe_failed', {
            component: 'key-rotation',
            model,
            error: err instanceof Error ? err.message : String(err),
        });
        throw err;
    }
}

function isUndefinedColumnError(err: unknown): boolean {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
        const meta = err.meta as { code?: unknown } | undefined;
        if (meta?.code === '42703') return true;
    }
    return err instanceof Error && /column "?tenantId"? does not exist/i.test(err.message);
}

/**
 * Re-encrypt the GLOBAL PII columns under the current primary KEK — #5070.
 *
 * `User` and `Account` carry no `tenantId`, so the per-tenant job cannot touch
 * them: its loop skips any model without that column, deliberately, because a
 * per-tenant sweep over a global table would either run N times or race with
 * itself. They are swept ONCE, by `scripts/rotate-global-pii.ts`, and the
 * rotation runbook pairs the two steps — the per-tenant job's "zero v1 rows"
 * report says nothing about these tables, which is exactly how #5070 stayed
 * invisible.
 *
 * Idempotent: it selects only `v1:%` rows and the UPDATE is conditional on the
 * value it read, so a second run rewrites nothing a concurrent writer has
 * already moved on. Safe to re-run after a partial failure.
 */
export async function rotateGlobalPiiColumns(
    batchSize = DEFAULT_BATCH_SIZE,
): Promise<{ perField: KeyRotationPerFieldResult[]; scanned: number; rewritten: number; errors: number }> {
    const perField: KeyRotationPerFieldResult[] = [];
    let scanned = 0;
    let rewritten = 0;
    let errors = 0;

    for (const model of PII_GLOBAL_MODELS) {
        for (const field of PII_ENCRYPTED_COLUMNS[model] ?? []) {
            // `null` tenant: the whole table.
            const result = await rewriteV1Field(null, model, field, batchSize);
            perField.push(result);
            scanned += result.scanned;
            rewritten += result.rewritten;
            errors += result.errors;
        }
    }

    logger.info('key-rotation.global_pii_swept', {
        component: 'key-rotation',
        models: PII_GLOBAL_MODELS.length,
        scanned,
        rewritten,
        errors,
    });

    return { perField, scanned, rewritten, errors };
}

/** @internal — expose for tests that need to reset cross-run state. */
export function _resetKeyRotationForTests(): void {
    _modelHasTenantIdCache.clear();
}
