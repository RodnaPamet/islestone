/**
 * Hardening H2g (owner decision 180): the production startup check for the
 * E2E clock seam.
 *
 * `E2E_TODAY` fixes the date every cycle, repeat, due window, reminder and
 * calendar reads (`todayClock`, src/lib/clock.ts). `src/env.ts` refuses it in
 * production unless `NEXT_TEST_MODE=1`, as it refuses `AUTH_TEST_MODE`; this is
 * the same rule as a pure function for `src/instrumentation-node.ts`, so it
 * also holds when `SKIP_ENV_VALIDATION=1` leaks from the build into the runtime
 * container (the case `startup-encryption-check.ts` covers for the key).
 *
 * Islestone-owned; the pattern is `startup-rate-limit-check.ts`.
 */
import type { StartupCheckOutcome } from './startup-encryption-check';

/** Ok outside production, for the Playwright server (`NEXT_TEST_MODE=1`), and with `E2E_TODAY` unset or empty. */
export function checkProductionTestClock(env: Readonly<Record<string, string | undefined>>): StartupCheckOutcome {
    if (env.NODE_ENV !== 'production') return { ok: true };
    if (env.NEXT_TEST_MODE === '1') return { ok: true };
    if (!env.E2E_TODAY) return { ok: true };
    return {
        ok: false,
        reason:
            'E2E_TODAY is set in production. It fixes the date every cycle, repeat, due date ' +
            'and reminder reads. Remove E2E_TODAY from the production environment.',
    };
}
