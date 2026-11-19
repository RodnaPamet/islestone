import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { env } from '@/env';
import { logger as auditMiddlewareLogger } from '@/lib/observability/logger';

import { DB_POOL_CONNECTION_TIMEOUT_MS, DB_POOL_MAX } from './db/concurrency-limits';
import { withRlsTripwireExtension } from './db/rls-middleware';

// Slow-query threshold. Typical Prisma p99 sits at 5-20ms; 50ms is the
// "this query is suspicious / worth a look" line, not a per-request SLO.
// Tune in one place. See docs/implementation-notes/2026-06-26-perf-baseline.md.
const SLOW_QUERY_THRESHOLD_MS = 50;



// ─── Singleton ───
//
// Prisma 7 — `PrismaClient` requires an adapter for connections.
// The runtime adapter is `@prisma/adapter-pg` which speaks to
// Postgres directly. CLI tooling (prisma migrate / generate /
// studio) reads the URL via `prisma.config.ts` at the repo root.
//
// Middleware is `client.$extends({ query: { ... } })` (Prisma 7 removed
// `$use`). `$extends` chains apply in reverse-call order: the LAST
// `.$extends(...)` is the OUTERMOST wrapper (intercepts the caller
// first). Sub-phase 1.3 installs one extension, the RLS tripwire; see
// `buildExtended` for where the others go.

type ExtendedClient = ReturnType<typeof buildClient>;

function buildClient(url: string = env.DATABASE_URL ?? ''): PrismaClient {
    // `??  ''` is load-bearing for build-time analysis. Next 16's
    // "Collecting page data" phase imports every route module to
    // discover route metadata, which transitively loads this module.
    // In that environment `SKIP_ENV_VALIDATION=1` is set but
    // `DATABASE_URL` is often unset — passing `undefined` to
    // `PrismaPg`'s `connectionString` throws ("p is not a function"
    // in the minified chunk) and the whole route fails to collect.
    // Falling back to an empty string lets module load succeed; the
    // first real query will surface the missing-URL error at request
    // time, not module-import time.
    //
    // The two pool limits below are DECLARED, not inherited (#2653).
    // `PrismaPg`'s first argument is a full `pg.PoolConfig`, so this is
    // the one call site where the product's connection ceiling is
    // settable. Derivations live in `db/concurrency-limits.ts`; the
    // short form:
    //   • `max`  — was node-postgres's default 10 (measured). 25 is the
    //     design point (k6 smoke, 25 VUs) and also PgBouncer's
    //     `DEFAULT_POOL_SIZE`, so a larger pool would only move the
    //     queue downstream where we cannot see it.
    //   • `connectionTimeoutMillis` — was `undefined`, i.e. wait
    //     forever (measured). Finite so pool exhaustion surfaces as an
    //     error instead of a hung request, and >= the largest per-call
    //     `maxWait` (10_000) so it does not silently preempt it.
    // NOTE: `connectionString` is untouched — the `?? ''` fallback
    // above is still what keeps "Collecting page data" working.
    const adapter = new PrismaPg({
        connectionString: url,
        max: DB_POOL_MAX,
        connectionTimeoutMillis: DB_POOL_CONNECTION_TIMEOUT_MS,
    });
    const client = new PrismaClient({
        adapter,
        // Emit query events so the slow-query listener below can observe
        // duration. `emit: 'event'` keeps queries OFF stdout (no log spam)
        // — only the >50ms ones are logged, by us.
        log: [{ level: 'query', emit: 'event' }],
    });

    // Slow-query observability. INTERNAL ONLY: `e.query` is raw SQL and
    // `e.params` may contain PII bound values, so this is truncated hard
    // and never shipped anywhere tenant-facing — it's a local operational
    // log. Sub-phase 1.6 adds a model-labelled slow-query metric here.
    client.$on('query', (e) => {
        if (e.duration > SLOW_QUERY_THRESHOLD_MS) {
            auditMiddlewareLogger.warn('slow query', {
                component: 'prisma',
                query: e.query.slice(0, 500),
                params: e.params.slice(0, 200),
                durationMs: e.duration,
            });
        }
    });

    return client;
}

function buildExtended(url: string = env.DATABASE_URL ?? '') {
    const base = buildClient(url);
    if (typeof EdgeRuntime !== 'undefined') {
        // Edge Runtime — extensions either don't bundle or import
        // server-only deps. Ship the bare client; Edge code paths do
        // not perform writes that need the extensions.
        return base as unknown as ReturnType<typeof base.$extends>;
    }
    // `withRlsTripwireExtension` is now imported statically at the
    // top of this file. The "circular import" comment that lived
    // here previously was only theoretical — `rls-middleware.ts`
    // only references `@/lib/prisma` from inside a function body
    // (`getPrismaClient()` for `runWithoutRls`), so there is no
    // module-init cycle. Turbopack's production bundle didn't
    // resolve the dynamic `require('./db/rls-middleware')` correctly
    // during Next 16's "Collecting page data" phase ("p is not a
    // function") which made the static form load-bearing.
    //
    // Composition order — the tripwire is observation-only so its
    // position in the chain is irrelevant; placing it outermost
    // makes the logged model/action match the caller's intent
    // before later extensions rewrite the args.
    //
    // WHERE THE OTHER EXTENSIONS GO. Sub-phase 1.5 (audit log, field
    // encryption, PII) and 2.1 (soft delete) insert theirs INSIDE the
    // tripwire, in this order, innermost first:
    //   audit → soft-delete → field-encryption → PII → RLS-tripwire
    // i.e.
    //   withRlsTripwireExtension(
    //       withPiiEncryptionExtension(
    //           withEncryptionExtension(
    //               withSoftDeleteExtension(base.$extends(buildAuditExtension())))))
    // Field encryption sees the post-soft-delete write args (so it
    // encrypts the rewritten update payload) before PII rewrites
    // where-clauses; the two cover disjoint models.
    return withRlsTripwireExtension(base);
}

const globalForPrisma = globalThis as unknown as {
    prisma?: ExtendedClient;
    prismaRead?: ExtendedClient;
};

export const prisma = (globalForPrisma.prisma ?? buildExtended()) as ExtendedClient;

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// ─── Read-replica client (Epic: read-replica routing) ───
//
// A SECOND extended client pointed at DATABASE_READ_URL (the replica,
// via its own PgBouncer). It carries the SAME extension chain as the
// primary, so once 1.5 adds field encryption and PII, reads of
// encrypted columns decrypt correctly on the replica too.
//
// Reads are NOT auto-routed: callers OPT IN via `runInTenantReadContext`
// (which opens its RLS transaction on this client). Routing is a
// deliberate, reviewable choice at the usecase boundary — NEVER for
// read-after-write or auth/billing paths. See docs/database-routing.md.
//
// When DATABASE_READ_URL is unset, `prismaRead === prisma` — single-DB
// mode, and `runInTenantReadContext` transparently uses the primary.
// This makes unsetting DATABASE_READ_URL the safe rollback for a
// replica incident.
//
// Edge runtime never sees a replica URL (DB access is Node-only), so the
// guard naturally falls back to `prisma`.
export const prismaRead = (
    env.DATABASE_READ_URL && typeof EdgeRuntime === 'undefined'
        ? (globalForPrisma.prismaRead ?? buildExtended(env.DATABASE_READ_URL))
        : prisma
) as ExtendedClient;

if (env.NODE_ENV !== 'production' && env.DATABASE_READ_URL) {
    globalForPrisma.prismaRead = prismaRead;
}

/**
 * Explicit global export for admin operations / scripts that need
 * to bypass RLS by running without a tenant context.
 */
export function getPrisma() {
    return prisma;
}

export { withTenantDb } from './db-context';

export default prisma;
