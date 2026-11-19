/**
 * Whether env validation is switched off for this process.
 *
 * Set `SKIP_ENV_VALIDATION=1` (or `true`) for builds and tests that run
 * without a real environment: CI's `next build`, Jest. Any other value,
 * including `0` and `false`, leaves validation on, so a typo cannot disable it.
 *
 * Shared by `env.ts` and `env-client.ts`, and safe on both sides: it reads one
 * flag and declares no variables.
 */
export function skipEnvValidation(): boolean {
    const raw = process.env.SKIP_ENV_VALIDATION?.trim().toLowerCase();
    return raw === '1' || raw === 'true';
}
