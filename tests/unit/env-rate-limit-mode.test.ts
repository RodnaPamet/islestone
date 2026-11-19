/**
 * Issue #17: no production configuration may run with the rate-limit store
 * silently missing. `RATE_LIMIT_MODE` defaults to `upstash`; when Upstash is
 * not configured, the credential throttle used to let every request through.
 * `src/env.ts` now refuses to start in production with `upstash` and either
 * Upstash value missing, and a production deployment that wants a per-process
 * limit says `memory` explicitly.
 *
 * Tested in a real process through `scripts/print-env-ok.ts`, because Jest
 * maps `@/env` to the mock.
 */
import { runEnvScript } from '../helpers/run-env-script';

const PRODUCTION = {
    NODE_ENV: 'production',
    DATA_ENCRYPTION_KEY: 'a-real-production-key-at-least-32-chars-long-deterministic', // pragma: allowlist secret — test fixture
} as const;
const UPSTASH = {
    UPSTASH_REDIS_REST_URL: 'https://example-upstash.invalid',
    UPSTASH_REDIS_REST_TOKEN: 'upstash-token-fixture', // pragma: allowlist secret — test fixture
} as const;

describe('RATE_LIMIT_MODE in src/env.ts (issue #17)', () => {
    it('defaults to upstash', () => {
        const result = runEnvScript({ RATE_LIMIT_MODE: undefined });
        expect(result.success).toBe(true);
        expect(result.output).toContain('RESOLVED {"RATE_LIMIT_MODE":"upstash"}');
    });

    it('refuses production with the default mode and no Upstash values', () => {
        const result = runEnvScript({ ...PRODUCTION, RATE_LIMIT_MODE: undefined });
        expect(result.success).toBe(false);
        expect(result.error).toContain('RATE_LIMIT_MODE');
        expect(result.error).toContain('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are not set');
    });

    it('refuses production with mode upstash and only the URL', () => {
        const result = runEnvScript({
            ...PRODUCTION,
            RATE_LIMIT_MODE: 'upstash',
            UPSTASH_REDIS_REST_URL: UPSTASH.UPSTASH_REDIS_REST_URL,
        });
        expect(result.success).toBe(false);
        expect(result.error).toContain('UPSTASH_REDIS_REST_TOKEN is not set');
    });

    it('refuses production with mode upstash and only the token', () => {
        const result = runEnvScript({
            ...PRODUCTION,
            RATE_LIMIT_MODE: 'upstash',
            UPSTASH_REDIS_REST_TOKEN: UPSTASH.UPSTASH_REDIS_REST_TOKEN,
        });
        expect(result.success).toBe(false);
        expect(result.error).toContain('UPSTASH_REDIS_REST_URL is not set');
    });

    it('treats an empty Upstash value as unset', () => {
        const result = runEnvScript({ ...PRODUCTION, ...UPSTASH, UPSTASH_REDIS_REST_TOKEN: '' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('UPSTASH_REDIS_REST_TOKEN is not set');
    });

    it('starts in production with mode upstash and both Upstash values', () => {
        const result = runEnvScript({ ...PRODUCTION, ...UPSTASH, RATE_LIMIT_MODE: 'upstash' });
        expect(result.error).toBe('');
        expect(result.success).toBe(true);
    });

    it('starts in production with mode memory chosen explicitly', () => {
        const result = runEnvScript({ ...PRODUCTION, RATE_LIMIT_MODE: 'memory' });
        expect(result.error).toBe('');
        expect(result.success).toBe(true);
        expect(result.output).toContain('RESOLVED {"RATE_LIMIT_MODE":"memory"}');
    });

    it('does not refuse outside production', () => {
        expect(runEnvScript({ NODE_ENV: 'development', RATE_LIMIT_MODE: 'upstash' }).success).toBe(true);
        expect(runEnvScript({ NODE_ENV: 'test', RATE_LIMIT_MODE: undefined }).success).toBe(true);
    });

    it('exempts the Playwright server (NEXT_TEST_MODE=1), as AUTH_TEST_MODE is', () => {
        expect(runEnvScript({ ...PRODUCTION, RATE_LIMIT_MODE: undefined, NEXT_TEST_MODE: '1' }).success).toBe(true);
    });
});
