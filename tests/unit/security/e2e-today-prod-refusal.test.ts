/**
 * Hardening H2g (owner decision 180): production refuses the E2E clock seam
 * as it refuses `AUTH_TEST_MODE`. `E2E_TODAY` is refused by the real schema in
 * `src/env.ts` (run in a child process through `scripts/print-env-ok.ts`,
 * because Jest maps `@/env` to the mock) and again by the startup check
 * `src/instrumentation-node.ts` runs; only the Playwright server, which sets
 * `NEXT_TEST_MODE=1`, may set it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { checkProductionTestClock } from '@/lib/security/startup-test-clock-check';

import { runEnvScript } from '../../helpers/run-env-script';
import { codeOf, functionBodyOf } from '../../helpers/source-blocks';

const PRODUCTION = {
    NODE_ENV: 'production',
    DATA_ENCRYPTION_KEY: 'a-real-production-key-at-least-32-chars-long-deterministic', // pragma: allowlist secret — test fixture
    RATE_LIMIT_MODE: 'memory',
} as const;

describe('E2E_TODAY in src/env.ts', () => {
    it('refuses production with E2E_TODAY set', () => {
        const result = runEnvScript({ ...PRODUCTION, E2E_TODAY: '2026-11-26' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('E2E_TODAY must not be set in production');
    });

    it('admits it on the Playwright server (NEXT_TEST_MODE=1)', () => {
        const result = runEnvScript({ ...PRODUCTION, NEXT_TEST_MODE: '1', E2E_TODAY: '2026-11-26' });
        expect(result.error).toBe('');
        expect(result.success).toBe(true);
    });

    it('starts in production without it', () => {
        const result = runEnvScript({ ...PRODUCTION });
        expect(result.error).toBe('');
        expect(result.success).toBe(true);
    });

    it('admits it outside production, and refuses a value that is not a calendar date anywhere', () => {
        expect(runEnvScript({ E2E_TODAY: '2026-11-26' }).success).toBe(true);
        const bad = runEnvScript({ E2E_TODAY: '2026-02-30' });
        expect(bad.success).toBe(false);
        expect(bad.error).toContain('E2E_TODAY must be a calendar date');
    });
});

describe('checkProductionTestClock (the startup check)', () => {
    it('refuses E2E_TODAY in production without NEXT_TEST_MODE=1', () => {
        const out = checkProductionTestClock({ NODE_ENV: 'production', E2E_TODAY: '2026-11-26' });
        expect(out.ok).toBe(false);
        expect(out.ok === false && out.reason).toContain('E2E_TODAY is set in production');
        expect(checkProductionTestClock({ NODE_ENV: 'production', NEXT_TEST_MODE: '0', E2E_TODAY: '2026-11-26' }).ok).toBe(false);
    });

    it('admits the Playwright server, an unset or empty value and every other environment', () => {
        expect(checkProductionTestClock({ NODE_ENV: 'production', NEXT_TEST_MODE: '1', E2E_TODAY: '2026-11-26' }).ok).toBe(true);
        expect(checkProductionTestClock({ NODE_ENV: 'production' }).ok).toBe(true);
        expect(checkProductionTestClock({ NODE_ENV: 'production', E2E_TODAY: '' }).ok).toBe(true);
        expect(checkProductionTestClock({ NODE_ENV: 'development', E2E_TODAY: '2026-11-26' }).ok).toBe(true);
    });

    it('runs in the production start refusals of src/instrumentation-node.ts, and exits on a refusal', () => {
        const src = codeOf(fs.readFileSync(path.resolve(__dirname, '../../../src/instrumentation-node.ts'), 'utf8'));
        const body = functionBodyOf(src, 'refuseUnsafeProductionStart');
        expect(body).toMatch(/checkProductionTestClock\(\{[^}]*E2E_TODAY: env\.E2E_TODAY[^}]*\}\)/);
        expect(body).toMatch(/if \(!testClock\.ok\) \{[^}]*process\.exit\(1\)/);
    });
});
