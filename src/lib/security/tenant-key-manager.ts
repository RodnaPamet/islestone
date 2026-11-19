/**
 * Epic B.2 — Tenant key manager (runtime layer).
 *
 * Sits above the primitives in `tenant-keys.ts` (which only know how
 * to generate / wrap / unwrap DEKs, in-memory) and provides the
 * tenant-lifecycle surface the rest of the app talks to:
 *
 *   - `createTenantWithDek(data)` — atomic "create a tenant with
 *     its wrapped DEK already populated". The one call every
 *     tenant-creation path should use.
 *
 *   - `ensureTenantDek(tenantId)` — idempotent backfill for a single
 *     tenant. Writes a DEK iff the column is currently NULL. Used
 *     by `scripts/generate-tenant-deks.ts` and (as a defensive
 *     fallback) by `getTenantDek` on first access.
 *
 *   - `getTenantDek(tenantId)` — the runtime hot path. Resolves a
 *     tenant's raw DEK (Buffer), hitting an in-memory cache in the
 *     common case. Unwraps on cold miss; lazily generates +
 *     persists + primes cache if the column is NULL.
 *
 *   - `clearTenantDekCache(tenantId?)` / `getTenantDekCacheSize()`
 *     — observability + invalidation hooks for rotation.
 *
 *   - `rotateTenantDek(options)` (sub-phase 1.5b) — per-tenant DEK rotation. Atomic
 *     swap of `Tenant.encryptedDek` ⇒ `Tenant.previousEncryptedDek`,
 *     primes both caches, enqueues a `tenant-dek-rotation` BullMQ
 *     sweep job that re-encrypts every v2 ciphertext under the new
 *     DEK and clears `previousEncryptedDek` on completion. Mid-flight
 *     reads remain correct via `decryptWithKeyOrPrevious` in the
 *     middleware.
 *
 *   - `getTenantPreviousDek(tenantId)` — runtime fallback for the
 *     middleware's v2-read path. Returns null in steady state (the
 *     column is null and the function caches that fact). Returns the
 *     unwrapped previous DEK during the brief window between a
 *     rotation and the sweep job's completion.
 *
 * ## Cache semantics
 *
 * The cache is an in-process `Map` of `tenantId → Buffer`, bounded
 * at `MAX_CACHE_SIZE`. It uses insertion-order LRU eviction (the
 * first key added gets evicted when the cap is hit). Lifetime is
 * process-lifetime with no TTL — the DEK bytes are the same for a
 * given tenant until a rotation, and holding the raw key in memory
 * avoids a DB read + unwrap on every request.
 *
 * This is a deliberate trade-off:
 *   + No per-request unwrap cost (otherwise every field access pays
 *     an AES-GCM decrypt of the wrapped DEK).
 *   + Recovery is automatic — cache miss re-reads + re-unwraps.
 *   – Raw key material lives in process memory until eviction or
 *     restart. A hostile read of process memory (coredump,
 *     debugger) could lift it out. The same threat applies to the
 *     derived KEK cached in `encryption.ts`; we accept the same
 *     posture here. Hardening (e.g. `sodium_memzero`, KMS-backed
 *     unwrap) is a future prompt's concern.
 *
 * ## Concurrency
 *
 * `ensureTenantDek` and `getTenantDek`'s lazy-init branch both
 * issue `UPDATE tenant SET encryptedDek = … WHERE id = … AND
 * encryptedDek IS NULL`. Two concurrent requests for the same
 * fresh tenant will BOTH try to write; one wins, one is a no-op
 * (affected rows = 0). Neither produces a corrupted state — the
 * losing request refetches and uses the winner's DEK.
 *
 * A process-level race where two processes unwrap the same wrapped
 * DEK and cache independent copies is fine: both Buffers carry the
 * same bytes by construction (AES-GCM decrypts deterministically
 * given the same key + ciphertext).
 */

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
    generateAndWrapDek,
    generateDek,
    unwrapDek,
    wrapDek,
    type TenantDek,
} from './tenant-keys';
import { logger } from '@/lib/observability/logger';

// ─── Cache ──────────────────────────────────────────────────────────

const MAX_CACHE_SIZE = 1000;
const dekCache = new Map<string, TenantDek>();

/**
 * Parallel cache for `Tenant.previousEncryptedDek` — populated only
 * while a per-tenant rotation is mid-flight (job hasn't finished
 * re-encrypting every v2 row under the new DEK). Empty in steady
 * state.
 *
 * Same shape + LRU eviction as `dekCache`. The two are independent —
 * a tenant can have a primary cache hit and a previous cache miss
 * (or vice versa) without inconsistency, because the primary and
 * previous DEKs unwrap from independent columns.
 */
const previousDekCache = new Map<string, TenantDek>();

/**
 * Negative cache for `Tenant.previousEncryptedDek IS NULL`. Without
 * this, every encryption-middleware operation in steady state would
 * issue a fresh `findUnique` to confirm the column is still NULL —
 * doubling DB load on every read/write.
 *
 * The map stores the absolute expiry timestamp (ms since epoch) of
 * each cached negative result. After the TTL elapses the entry is
 * treated as expired and the next call re-queries.
 *
 * Staleness bound: a sibling-process rotation (worker rotates while
 * web tier serves reads) takes up to `NO_PREVIOUS_TTL_MS` to be
 * visible to this process. During that window, v2 reads of rows
 * still under the old DEK fail in this process. The middleware's
 * `decryptWithKeyOrPrevious` retry path WILL find the freshly
 * available previous DEK once this cache expires; the impact is a
 * brief read-failure window (≤ TTL) on rows the sweep job hasn't
 * rewritten yet, not data loss.
 *
 * `rotateTenantDek` proactively `.delete()`s the entry for the
 * tenant it rotates so the in-process flow has zero lag. Cross-
 * process is bounded by the TTL.
 */
const noPreviousDekCache = new Map<string, number>();

/** 30 s — see `noPreviousDekCache` doc for the staleness rationale. */
const NO_PREVIOUS_TTL_MS = 30_000;

/**
 * Insert or refresh the cache entry, evicting the oldest key when
 * the cap is exceeded. Map's iteration order is insertion-order, so
 * `keys().next().value` is the least-recently-inserted entry —
 * equivalent to a simple LRU when combined with delete-before-set
 * on cache-hit refresh.
 */
function setCached(tenantId: string, dek: TenantDek): void {
    if (dekCache.size >= MAX_CACHE_SIZE && !dekCache.has(tenantId)) {
        const oldest = dekCache.keys().next().value;
        if (oldest !== undefined) dekCache.delete(oldest);
    }
    dekCache.set(tenantId, dek);
}

function getCached(tenantId: string): TenantDek | undefined {
    const cached = dekCache.get(tenantId);
    if (!cached) return undefined;
    // LRU refresh — delete + re-insert moves the key to the end of
    // insertion order so it's the last to be evicted.
    dekCache.delete(tenantId);
    dekCache.set(tenantId, cached);
    return cached;
}

function setCachedPrevious(tenantId: string, dek: TenantDek): void {
    if (
        previousDekCache.size >= MAX_CACHE_SIZE &&
        !previousDekCache.has(tenantId)
    ) {
        const oldest = previousDekCache.keys().next().value;
        if (oldest !== undefined) previousDekCache.delete(oldest);
    }
    previousDekCache.set(tenantId, dek);
}

function getCachedPrevious(tenantId: string): TenantDek | undefined {
    const cached = previousDekCache.get(tenantId);
    if (!cached) return undefined;
    previousDekCache.delete(tenantId);
    previousDekCache.set(tenantId, cached);
    return cached;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Create a tenant with its wrapped DEK populated atomically. The
 * DEK is generated, wrapped under the global KEK, and saved in a
 * single `tenant.create` call; the raw DEK is primed into the
 * cache so the first request against the new tenant doesn't pay
 * an unwrap round-trip.
 *
 * Use this EVERYWHERE a new tenant is created:
 *   - register route
 *   - SSO auto-onboarding (when it lands)
 *   - seed scripts
 *   - test fixtures that need a DEK from the start
 *
 * Direct `prisma.tenant.create` still works (nullable column) but
 * leaves the tenant dependent on backfill to get a DEK.
 */
export async function createTenantWithDek(
    data: Omit<Prisma.TenantCreateInput, 'encryptedDek'>,
): Promise<Prisma.TenantGetPayload<Record<string, never>>> {
    const { dek, wrapped } = generateAndWrapDek();
    const tenant = await prisma.tenant.create({
        data: { ...data, encryptedDek: wrapped },
    });
    setCached(tenant.id, dek);
    logger.info('tenant-key-manager.tenant_created_with_dek', {
        component: 'tenant-key-manager',
        tenantId: tenant.id,
    });
    return tenant;
}

/**
 * Guarantee that this tenant has a wrapped DEK. Idempotent:
 *   - If encryptedDek is already set → no-op, return.
 *   - If NULL → generate + wrap + save + prime cache.
 *
 * Use this from backfill scripts and from safety-net paths that
 * want to ensure a tenant is ready for encryption before hitting
 * a hot read path. `getTenantDek` internally calls this on demand,
 * so usecase code rarely needs to call it directly.
 */
export async function ensureTenantDek(tenantId: string): Promise<void> {
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { encryptedDek: true },
    });
    if (!tenant) {
        throw new Error(
            `ensureTenantDek: tenant ${tenantId} not found`,
        );
    }
    if (tenant.encryptedDek !== null) return;

    const dek = generateDek();
    const wrapped = wrapDek(dek);

    // Race-safe write: if another process beat us to it, the
    // `encryptedDek IS NULL` predicate makes our UPDATE a no-op and
    // no row is mutated. Either way the tenant ends up with a DEK;
    // callers that need to use it can re-fetch.
    const result = await prisma.tenant.updateMany({
        where: { id: tenantId, encryptedDek: null },
        data: { encryptedDek: wrapped },
    });

    if (result.count === 1) {
        setCached(tenantId, dek);
        logger.info('tenant-key-manager.dek_backfilled', {
            component: 'tenant-key-manager',
            tenantId,
        });
    } else {
        // Someone else won the race — clear our local DEK and let
        // the next getTenantDek unwrap the winner's value.
        logger.debug('tenant-key-manager.dek_backfill_raced', {
            component: 'tenant-key-manager',
            tenantId,
        });
    }
}

/**
 * Resolve a tenant's raw DEK for use as an AES-256-GCM key. Hot
 * path — most calls hit the in-memory cache.
 *
 * Behaviour:
 *   1. Cache hit → return (touches LRU).
 *   2. Cache miss + encryptedDek present → unwrap, cache, return.
 *   3. Cache miss + encryptedDek NULL → lazy init via
 *      `ensureTenantDek`, re-read, return.
 *
 * Throws if the tenant doesn't exist.
 */
export async function getTenantDek(tenantId: string): Promise<TenantDek> {
    const cached = getCached(tenantId);
    if (cached) return cached;

    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { encryptedDek: true },
    });
    if (!tenant) {
        throw new Error(`getTenantDek: tenant ${tenantId} not found`);
    }

    if (tenant.encryptedDek === null) {
        // Lazy init + read-after-write to handle the race where
        // another process concurrently populated encryptedDek. After
        // ensureTenantDek returns, one of us wrote; re-read to get
        // the canonical value.
        await ensureTenantDek(tenantId);
        const reloaded = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { encryptedDek: true },
        });
        if (!reloaded || !reloaded.encryptedDek) {
            throw new Error(
                `getTenantDek: tenant ${tenantId} has no encryptedDek after ensure`,
            );
        }
        const dek = unwrapDek(reloaded.encryptedDek);
        setCached(tenantId, dek);
        return dek;
    }

    const dek = unwrapDek(tenant.encryptedDek);
    setCached(tenantId, dek);
    return dek;
}

/**
 * Resolve the previous-generation DEK for this tenant, or `null` if
 * no rotation is in flight (i.e. `Tenant.previousEncryptedDek` is
 * NULL). Mirrors `getTenantDek`'s cache shape but with three
 * essential differences:
 *
 *   - Returns null instead of lazy-initialising. There's no concept
 *     of "ensure a previous DEK exists" — the column is populated
 *     only by `rotateTenantDek` and cleared by the re-encrypt job.
 *   - Cache miss + NULL column → no work, no error. Steady state.
 *   - Tenant-not-found IS still an error (mirrors `getTenantDek`).
 *
 * Used by the encryption middleware on every v2 read to provide the
 * fallback key for `decryptWithKeyOrPrevious`. In steady state every
 * tenant's column is NULL and this function returns null in O(1)
 * after the first DB miss is cached. While a rotation is in flight,
 * the previous DEK is in cache and reads pay the same per-call cost
 * as the primary path.
 *
 * Throws if the tenant doesn't exist.
 */
export async function getTenantPreviousDek(
    tenantId: string,
): Promise<TenantDek | null> {
    const cached = getCachedPrevious(tenantId);
    if (cached) return cached;

    // Negative cache — short-circuit the DB lookup for tenants we
    // recently observed to have no previous DEK. See
    // `noPreviousDekCache` docstring for staleness bounds.
    const expiresAt = noPreviousDekCache.get(tenantId);
    if (expiresAt !== undefined && expiresAt > Date.now()) {
        return null;
    }

    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { previousEncryptedDek: true },
    });
    if (!tenant) {
        throw new Error(`getTenantPreviousDek: tenant ${tenantId} not found`);
    }

    if (tenant.previousEncryptedDek === null) {
        noPreviousDekCache.set(tenantId, Date.now() + NO_PREVIOUS_TTL_MS);
        return null;
    }

    // Tenant entered a rotation since we last looked — drop any
    // stale negative entry so subsequent calls take the cache-hit
    // path.
    noPreviousDekCache.delete(tenantId);
    const dek = unwrapDek(tenant.previousEncryptedDek);
    setCachedPrevious(tenantId, dek);
    return dek;
}

/**
 * Invalidate the primary-DEK cache for a tenant (rotation) or
 * globally (restart / test cleanup). The previous-DEK cache is left
 * untouched — call `clearTenantPreviousDekCache` separately for
 * that. Splitting the two avoids forcing every cache invalidation
 * (e.g. master-KEK rewrap) to also drop the in-flight previous DEK.
 */
export function clearTenantDekCache(tenantId?: string): void {
    if (tenantId) {
        dekCache.delete(tenantId);
    } else {
        dekCache.clear();
    }
}

/**
 * Invalidate the previous-DEK cache for a tenant (rotation completion)
 * or globally (test cleanup). Called by the re-encrypt job on
 * completion so that subsequent reads stop attempting the previous-DEK
 * fallback. Idempotent.
 */
export function clearTenantPreviousDekCache(tenantId?: string): void {
    if (tenantId) {
        previousDekCache.delete(tenantId);
        noPreviousDekCache.delete(tenantId);
    } else {
        previousDekCache.clear();
        noPreviousDekCache.clear();
    }
}

/** Observability — current cache size. Useful for metrics. */
export function getTenantDekCacheSize(): number {
    return dekCache.size;
}

/** Observability — current previous-DEK cache size. */
export function getTenantPreviousDekCacheSize(): number {
    return previousDekCache.size;
}

// ─── Per-tenant DEK rotation ────────────────────────────────────────
//
// `rotateTenantDek` (the atomic swap into `previousEncryptedDek` and the
// enqueue of the `tenant-dek-rotation` re-encryption sweep) lands with
// sub-phase 1.5b, once 1.6 provides the job queue. Until then the
// previous-DEK read path below is already live, so a rotation that lands
// later needs no change here.

// ─── Test-only helpers ──────────────────────────────────────────────

/** @internal — visible to tests only. Peek without touching LRU order. */
export function _peekCachedDek(tenantId: string): TenantDek | undefined {
    return dekCache.get(tenantId);
}

/** @internal — reset all caches AND reclaim capacity. */
export function _resetTenantDekCache(): void {
    dekCache.clear();
    previousDekCache.clear();
    noPreviousDekCache.clear();
}

/** @internal — expose the size cap so tests can craft eviction scenarios. */
export const _MAX_CACHE_SIZE = MAX_CACHE_SIZE;
