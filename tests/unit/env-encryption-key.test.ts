/**
 * The DATA_ENCRYPTION_KEY production refusal in `src/env.ts` (GAP-03 in
 * inflect-compliance), tested in a real process through
 * `scripts/print-env-ok.ts`, because Jest maps `@/env` to the mock.
 *
 * Copied from inflect-compliance `tests/unit/env.test.ts` L97–186 at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e. The production cases set
 * `RATE_LIMIT_MODE=memory`, so the issue #17 refusal (its own suite) does not
 * mask the one under test.
 */
import { runEnvScript } from '../helpers/run-env-script';

const PRODUCTION = { NODE_ENV: 'production', RATE_LIMIT_MODE: 'memory' } as const;

describe('DATA_ENCRYPTION_KEY in src/env.ts', () => {
    it('accepts the baseline environment and prints OK', () => {
        const result = runEnvScript({});
        expect(result.error).toBe('');
        expect(result.success).toBe(true);
        expect(result.output).toContain('OK');
    });

    it('rejects NODE_ENV=production when DATA_ENCRYPTION_KEY is unset', () => {
        const result = runEnvScript({ ...PRODUCTION, DATA_ENCRYPTION_KEY: undefined });
        expect(result.success).toBe(false);
        expect(result.error).toContain('DATA_ENCRYPTION_KEY');
        expect(result.error).toContain('REQUIRED in production');
    });

    it('rejects NODE_ENV=production when DATA_ENCRYPTION_KEY equals the documented dev fallback', () => {
        const result = runEnvScript({
            ...PRODUCTION,
            // Kept in sync with `encryption-constants.ts` by hand: the child
            // process cannot import the constant, and a test that imported it
            // would pass whatever the constant became.
            DATA_ENCRYPTION_KEY: 'islestone-dev-encryption-key-not-for-production-use!!',
        });
        expect(result.success).toBe(false);
        expect(result.error).toContain('DATA_ENCRYPTION_KEY');
        expect(result.error).toContain('dev fallback');
    });

    it('rejects NODE_ENV=production when DATA_ENCRYPTION_KEY is shorter than 32 chars', () => {
        const result = runEnvScript({ ...PRODUCTION, DATA_ENCRYPTION_KEY: 'too-short' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('DATA_ENCRYPTION_KEY');
        expect(result.error).toContain('at least 32 characters');
    });

    it('passes when DATA_ENCRYPTION_KEY is unset under NODE_ENV=test', () => {
        expect(runEnvScript({ NODE_ENV: 'test', DATA_ENCRYPTION_KEY: undefined }).success).toBe(true);
    });

    it('passes when DATA_ENCRYPTION_KEY is unset under NODE_ENV=development', () => {
        expect(runEnvScript({ NODE_ENV: 'development', DATA_ENCRYPTION_KEY: undefined }).success).toBe(true);
    });

    it('passes when production has a real key of at least 32 characters', () => {
        const result = runEnvScript({
            ...PRODUCTION,
            DATA_ENCRYPTION_KEY: 'a-real-production-key-at-least-32-chars-long-deterministic', // pragma: allowlist secret — test fixture
        });
        expect(result.error).toBe('');
        expect(result.success).toBe(true);
    });
});
