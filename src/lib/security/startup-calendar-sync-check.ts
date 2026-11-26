/**
 * Roadmap 3.3b — the production startup check for calendar sync (ADR 0011;
 * docs/porting/maps/3.3.md, "Environment variables").
 *
 * `src/env.ts` refuses a production configuration that opens calendar sync
 * (`CALENDAR_SYNC=1`) without a complete sign-in app pair: calendar sync uses
 * the sign-in apps' clients (decision 236), so without one no member can
 * connect and no token can be refreshed. This is the same rule as a pure
 * function, for `src/instrumentation-node.ts` and `scripts/worker.ts`, so it
 * also holds when `SKIP_ENV_VALIDATION=1` leaks into a runtime container.
 * Islestone-owned, on the pattern of `startup-intake-email-check.ts`.
 */
import type { StartupCheckOutcome } from './startup-encryption-check';

export function checkProductionCalendarSync(env: Readonly<Record<string, string | undefined>>): StartupCheckOutcome {
    if (env.NODE_ENV !== 'production') return { ok: true };
    if (env.NEXT_TEST_MODE === '1') return { ok: true };
    if (env.CALENDAR_SYNC !== '1') return { ok: true };
    const google = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
    const microsoft = Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET);
    if (google || microsoft) return { ok: true };
    return {
        ok: false,
        reason: 'CALENDAR_SYNC=1 but neither GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET nor MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET are set: calendar sync uses the sign-in apps.',
    };
}
