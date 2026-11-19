/**
 * Issue #17 — the production startup check for the rate-limit store.
 *
 * `src/env.ts` refuses a production configuration whose `RATE_LIMIT_MODE` is
 * `upstash` (the default) while either Upstash value is missing: with no store
 * to reach, the credential throttle let every request through. This is the
 * same rule as a pure function, for `src/instrumentation.ts`, so it also holds
 * when `SKIP_ENV_VALIDATION=1` leaks from the build into the runtime container
 * (the case `startup-encryption-check.ts` covers for the encryption key).
 *
 * Islestone-owned; the pattern is inflect-compliance's
 * `startup-encryption-check.ts`.
 */
import type { StartupCheckOutcome } from './startup-encryption-check';

/**
 * Ok outside production, for the Playwright server (`NEXT_TEST_MODE=1`), for
 * `memory`, and for `upstash` with both values set. An unset mode is the
 * schema default, `upstash`; an empty value counts as unset.
 */
export function checkProductionRateLimitStore(
    env: Readonly<Record<string, string | undefined>>,
): StartupCheckOutcome {
    if (env.NODE_ENV !== 'production') return { ok: true };
    if (env.NEXT_TEST_MODE === '1') return { ok: true };
    const mode = env.RATE_LIMIT_MODE || 'upstash';
    if (mode !== 'upstash') return { ok: true };
    const missing = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'].filter((key) => !env[key]);
    if (missing.length === 0) return { ok: true };
    return {
        ok: false,
        reason:
            `RATE_LIMIT_MODE is "upstash" but ${missing.join(' and ')} ` +
            `${missing.length === 1 ? 'is' : 'are'} not set, so the sign-in throttle and the ` +
            'rate-limit tiers have no store. Set both Upstash values, or set ' +
            'RATE_LIMIT_MODE=memory to limit per process.',
    };
}
