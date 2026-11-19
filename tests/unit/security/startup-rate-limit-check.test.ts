/**
 * Issue #17 — `checkProductionRateLimitStore`, the startup twin of the
 * `src/env.ts` refusal (tests/unit/env-rate-limit-mode.test.ts covers the
 * schema in a real process).
 */
import { checkProductionRateLimitStore } from '@/lib/security/startup-rate-limit-check';

const UPSTASH = {
    UPSTASH_REDIS_REST_URL: 'https://example-upstash.invalid',
    UPSTASH_REDIS_REST_TOKEN: 'upstash-token-fixture', // pragma: allowlist secret — test fixture
};

describe('checkProductionRateLimitStore', () => {
    it('refuses production with the default mode and no Upstash values', () => {
        const out = checkProductionRateLimitStore({ NODE_ENV: 'production' });
        expect(out.ok).toBe(false);
        expect(!out.ok && out.reason).toContain('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are not set');
    });

    it('refuses production with mode upstash and one value missing, naming it', () => {
        const out = checkProductionRateLimitStore({
            NODE_ENV: 'production',
            RATE_LIMIT_MODE: 'upstash',
            UPSTASH_REDIS_REST_URL: UPSTASH.UPSTASH_REDIS_REST_URL,
            UPSTASH_REDIS_REST_TOKEN: '',
        });
        expect(out.ok).toBe(false);
        expect(!out.ok && out.reason).toContain('UPSTASH_REDIS_REST_TOKEN is not set');
    });

    it('admits production with both Upstash values', () => {
        expect(checkProductionRateLimitStore({ NODE_ENV: 'production', ...UPSTASH }).ok).toBe(true);
    });

    it('admits production with memory chosen explicitly', () => {
        expect(checkProductionRateLimitStore({ NODE_ENV: 'production', RATE_LIMIT_MODE: 'memory' }).ok).toBe(true);
    });

    it('admits development, test and the Playwright server', () => {
        expect(checkProductionRateLimitStore({ NODE_ENV: 'development' }).ok).toBe(true);
        expect(checkProductionRateLimitStore({ NODE_ENV: 'test' }).ok).toBe(true);
        expect(checkProductionRateLimitStore({ NODE_ENV: 'production', NEXT_TEST_MODE: '1' }).ok).toBe(true);
    });
});
