/**
 * Redis production-auth ratchet — the env schema refuses an unauthenticated
 * `REDIS_URL` in production.
 *
 * An unauthenticated Redis that is network-reachable is wide open: anyone who
 * can reach the port can read and enqueue jobs. `src/env.ts` therefore
 * requires a password in the URL's userinfo when `NODE_ENV=production`
 * (`redis://:PASSWORD@HOST:6379`, or `rediss://` for TLS).
 *
 * Copied from inflect-compliance `tests/guards/redis-production-auth.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e, the `src/env.ts` half only,
 * and made behavioural: the real schema runs in a child process
 * (`scripts/print-env-ok.ts`) instead of a regex over the source. The compose
 * half (`--requirepass` on every production-like compose file) comes with
 * sub-phase 1.8's compose files.
 */
import { runEnvScript } from '../helpers/run-env-script';

const PRODUCTION = {
    NODE_ENV: 'production',
    RATE_LIMIT_MODE: 'memory',
    DATA_ENCRYPTION_KEY: 'a-real-production-key-at-least-32-chars-long-deterministic', // pragma: allowlist secret — test fixture
} as const;

describe('Redis production-auth ratchet — env schema enforces an authenticated URL', () => {
    it('rejects a bare redis://host:6379 in production', () => {
        const result = runEnvScript({ ...PRODUCTION, REDIS_URL: 'redis://localhost:6379' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('REDIS_URL must be AUTHENTICATED in production');
    });

    it('accepts a password-bearing URL in production (redis:// and rediss://)', () => {
        expect(runEnvScript({ ...PRODUCTION, REDIS_URL: 'redis://:secret-pw@localhost:6379' }).success).toBe(true); // pragma: allowlist secret — test fixture
        expect(runEnvScript({ ...PRODUCTION, REDIS_URL: 'rediss://user:secret-pw@cache.example:6380' }).success).toBe(true); // pragma: allowlist secret — test fixture
    });

    it('does not ask for a password outside production', () => {
        expect(runEnvScript({ NODE_ENV: 'development', REDIS_URL: 'redis://localhost:6379' }).success).toBe(true);
    });
});
