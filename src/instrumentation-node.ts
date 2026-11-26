/**
 * The Node.js half of the instrumentation hook: the startup refusals, run
 * once when a Node.js server process starts. `src/instrumentation.ts` imports
 * it only on the Node.js runtime, so the Edge bundle never carries it (it
 * calls `process.exit` and loads `crypto`, which Edge lacks).
 *
 * Copied from inflect-compliance `src/instrumentation.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e and cut to the security
 * perimeter's startup refusals (docs/porting/maps/1.5.md). Each is defence in
 * depth behind the same rule in `src/env.ts`: the schema refuses the
 * configuration at module load, and this hook refuses it again when
 * `SKIP_ENV_VALIDATION=1` leaks from the build into the runtime container,
 * which is the configuration a container image is most likely to carry.
 *
 * Sub-phase 1.6 adds, below these refusals and without moving them: the
 * `REDIS_URL` production refusal, then (in every environment) telemetry, the
 * Sentry stub, the mailer, the graceful-shutdown handler (which drains the
 * audit-stream buffers first) and the Redis eviction-policy check, from
 * inflect-compliance's hook at the same commit. The RLS tripwire inflect
 * installed here is composed into the Prisma client instead
 * (`src/lib/prisma.ts`), and the automation-bus, integration-bootstrap and
 * freshness-reporting calls wait for sub-phases 5.1 and 5.x.
 *
 * `console.error` is the sink on purpose: it runs before any logger is
 * guaranteed, and the process exits right after (a per-file `no-console`
 * exception in eslint.config.mjs).
 */
import type { env as ServerEnvModule } from '@/env';

type ServerEnv = typeof ServerEnvModule;

export async function registerNode(): Promise<void> {
    const { env } = await import('@/env');

    if (env.NODE_ENV === 'production') {
        await refuseUnsafeProductionStart(env);
    }

    await startObservabilityAndServices();
}

/** The production start refusals. Each exits the process on a violation. */
async function refuseUnsafeProductionStart(env: ServerEnv): Promise<void> {

    // ── AUTH_TEST_MODE must not be "1" in production ──
    // The flag turns the login brute-force throttle into a no-op and bypasses
    // both rate-limit tiers. NEXT_TEST_MODE is the one exemption: `next start`
    // forces NODE_ENV=production, so the Playwright server, which sets
    // AUTH_TEST_MODE=1 legitimately, presents here as production. Only the
    // Playwright webServer sets NEXT_TEST_MODE.
    if (env.NEXT_TEST_MODE !== '1' && env.AUTH_TEST_MODE === '1') {
        console.error(
            '[startup] FATAL: AUTH_TEST_MODE=1 is set in production. ' +
                'It disables the login brute-force throttle and both rate-limit ' +
                'tiers. Remove AUTH_TEST_MODE from the production environment.',
        );
        process.exit(1);
    }

    // ── H2g: the E2E clock seam must not reach production ──
    // E2E_TODAY fixes "today" for every date read (src/lib/clock.ts). Only the
    // Playwright webServer sets it, beside NEXT_TEST_MODE=1.
    const { checkProductionTestClock } = await import('@/lib/security/startup-test-clock-check');
    const testClock = checkProductionTestClock({
        NODE_ENV: env.NODE_ENV,
        NEXT_TEST_MODE: env.NEXT_TEST_MODE,
        E2E_TODAY: env.E2E_TODAY,
    });
    if (!testClock.ok) {
        console.error('[startup] FATAL: ' + testClock.reason);
        process.exit(1);
    }

    // ── Issue #17: the rate-limit store must exist in production ──
    const { checkProductionRateLimitStore } = await import('@/lib/security/startup-rate-limit-check');
    const store = checkProductionRateLimitStore({
        NODE_ENV: env.NODE_ENV,
        NEXT_TEST_MODE: env.NEXT_TEST_MODE,
        RATE_LIMIT_MODE: env.RATE_LIMIT_MODE,
        UPSTASH_REDIS_REST_URL: env.UPSTASH_REDIS_REST_URL,
        UPSTASH_REDIS_REST_TOKEN: env.UPSTASH_REDIS_REST_TOKEN,
    });
    if (!store.ok) {
        console.error('[startup] FATAL: ' + store.reason);
        process.exit(1);
    }

    // ── Sub-phase 2.6c: inbound email opened needs its Resend secrets ──
    const { checkProductionIntakeEmail } = await import('@/lib/security/startup-intake-email-check');
    const intakeEmail = checkProductionIntakeEmail({
        NODE_ENV: env.NODE_ENV,
        NEXT_TEST_MODE: env.NEXT_TEST_MODE,
        INTAKE_EMAIL: env.INTAKE_EMAIL,
        RESEND_API_KEY: env.RESEND_API_KEY,
        RESEND_WEBHOOK_SECRET: env.RESEND_WEBHOOK_SECRET,
    });
    if (!intakeEmail.ok) {
        console.error('[startup] FATAL: ' + intakeEmail.reason);
        process.exit(1);
    }

    // ── GAP-03: DATA_ENCRYPTION_KEY is required in production ──
    // The config check catches a missing, short or dev-fallback key; the
    // sentinel round-trips a fixed plaintext so a key that is structurally
    // valid but breaks HKDF or AES-GCM fails here, not on the first write.
    const { checkProductionEncryptionKey, runEncryptionSentinel } = await import(
        '@/lib/security/startup-encryption-check'
    );
    const config = checkProductionEncryptionKey({
        NODE_ENV: env.NODE_ENV,
        DATA_ENCRYPTION_KEY: env.DATA_ENCRYPTION_KEY,
        DATA_ENCRYPTION_KEY_PREVIOUS: env.DATA_ENCRYPTION_KEY_PREVIOUS,
        LOOKUP_HASH_KEY: env.LOOKUP_HASH_KEY,
        DERIVED_SUBKEY_KEY: env.DERIVED_SUBKEY_KEY,
    });
    if (!config.ok) {
        console.error('[startup] FATAL: ' + config.reason);
        process.exit(1);
    }
    const sentinel = await runEncryptionSentinel();
    if (!sentinel.ok) {
        console.error('[startup] FATAL: ' + sentinel.reason);
        process.exit(1);
    }

    // ── Sub-phase 2.7f: the full-text configuration must stem as pinned ──
    // ADR 0008 D2 (decision 126): search has no degraded mode. A database
    // without Islestone's Postgres image (the Bulgarian dictionary) or not
    // migrated to `islestone_bg_en` refuses the start; nothing falls back to
    // `simple` or `english`. `/api/readyz` asks the same on every probe.
    const { checkSearchConfiguration, searchConfigurationRefusal } = await import('@/lib/search/configuration-check');
    const { prisma } = await import('@/lib/prisma');
    const search = await checkSearchConfiguration((query) => prisma.$queryRaw(query));
    if (!search.ok) {
        console.error('[startup] FATAL: ' + searchConfigurationRefusal(search));
        process.exit(1);
    }

    // ── GAP-13: Redis is required in production (sub-phase 1.6) ──
    // Defence in depth alongside the schema rule in `src/env.ts`: the schema
    // catches a missing or unauthenticated REDIS_URL at module load, this
    // catches the case where SKIP_ENV_VALIDATION=1 leaks into the runtime
    // container. The job queue and the worker heartbeat live in Redis, and a
    // web process that cannot enqueue silently drops the work. (The Playwright
    // server sets a REDIS_URL, so it starts.)
    if (!env.REDIS_URL) {
        console.error(
            '[startup] FATAL: REDIS_URL is required in production. ' +
                'The job queue and the worker heartbeat depend on it. ' +
                'Set REDIS_URL to an authenticated connection string (redis://:PASSWORD@HOST:6379).',
        );
        process.exit(1);
    }
}

/**
 * Telemetry, error reporting, the mailer, graceful shutdown and the Redis
 * eviction check, in every environment. Each is a no-op or a log line when
 * it is not configured (`OTEL_ENABLED` unset, no SMTP transport, no
 * `REDIS_URL`), so development pays nothing.
 */
async function startObservabilityAndServices(): Promise<void> {
    const { initTelemetry } = await import('@/lib/observability/instrumentation');
    const { initSentry } = await import('@/lib/observability/sentry');
    // The mailer reports its transport. No SMTP transport is installed yet
    // (src/lib/mailer.ts); until one is, every email stays on the console sink.
    const { initMailerFromEnv } = await import('@/lib/mailer');
    const { installShutdownHandlers } = await import('@/lib/observability/shutdown');

    await initTelemetry();
    initSentry();
    initMailerFromEnv();
    // SIGTERM/SIGINT: drain the audit-stream buffers (`flushAllAuditStreams`,
    // the irreversible loss), then the OTel exporters, then Sentry. Idempotent
    // under HMR; never calls process.exit (`next start` owns the process).
    installShutdownHandlers();

    // Verify Redis is not configured to EVICT keys — BullMQ job state lives
    // in Redis, so an eviction `maxmemory-policy` would silently drop queued
    // jobs. Best-effort and non-blocking: it logs loudly on a violation but
    // never crash-loops the process. The fail-fast gate is the structural
    // guard at PR time (tests/guards/redis-eviction-policy.test.ts).
    const { verifyRedisEvictionPolicy } = await import('@/lib/redis');
    void verifyRedisEvictionPolicy().catch(() => {
        // A diagnostic check must never break startup.
    });
}
