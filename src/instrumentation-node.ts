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
 * Sub-phase 1.6 adds telemetry, Sentry, the mailer, the shutdown handler
 * (which must call `flushAllAuditStreams`) and the Redis check BELOW these
 * blocks, without moving them.
 *
 * `console.error` is the sink on purpose: it runs before any logger is
 * guaranteed, and the process exits right after (a per-file `no-console`
 * exception in eslint.config.mjs).
 */
export async function registerNode(): Promise<void> {
    const { env } = await import('@/env');

    if (env.NODE_ENV !== 'production') return;

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
}
