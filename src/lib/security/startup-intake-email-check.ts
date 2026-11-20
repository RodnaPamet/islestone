/**
 * Sub-phase 2.6c — the production startup check for inbound email.
 *
 * `src/env.ts` refuses a production configuration that opens inbound email
 * (`INTAKE_EMAIL=1`) without `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET`:
 * without the secret no delivery can be verified, without the key no message
 * can be fetched. This is the same rule as a pure function, for
 * `src/instrumentation-node.ts`, so it also holds when `SKIP_ENV_VALIDATION=1`
 * leaks into the runtime container. Islestone-owned, on the pattern of
 * `startup-rate-limit-check.ts`.
 */
import type { StartupCheckOutcome } from './startup-encryption-check';

export function checkProductionIntakeEmail(env: Readonly<Record<string, string | undefined>>): StartupCheckOutcome {
    if (env.NODE_ENV !== 'production') return { ok: true };
    if (env.NEXT_TEST_MODE === '1') return { ok: true };
    if (env.INTAKE_EMAIL !== '1') return { ok: true };
    const missing = ['RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET'].filter((key) => !env[key]);
    if (missing.length > 0) {
        return { ok: false, reason: `INTAKE_EMAIL=1 but ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set: inbound email can be neither verified nor fetched.` };
    }
    if (!env.RESEND_WEBHOOK_SECRET!.startsWith('whsec_')) {
        return { ok: false, reason: 'RESEND_WEBHOOK_SECRET must be the whsec_ signing secret Resend shows for the webhook.' };
    }
    return { ok: true };
}
