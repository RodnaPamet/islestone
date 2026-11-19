/**
 * GAP-13 — `REDIS_URL` is required in production, on two surfaces.
 *
 * The job queue and the worker heartbeat live in Redis, and a web process
 * that cannot enqueue silently drops the work, so:
 *   1. the Zod schema in `src/env.ts` refuses a production start without
 *      `REDIS_URL` (asserted behaviourally, in a child process);
 *   2. the startup hook's Node.js half, `src/instrumentation-node.ts`, exits
 *      1 in production when it is unset — the backstop for
 *      `SKIP_ENV_VALIDATION=1` leaking into the runtime container — with no
 *      `RATE_LIMIT_ENABLED` escape hatch (Redis underpins more than the rate
 *      limiter; inflect-compliance removed that toggle under GAP-13).
 *
 * Copied from inflect-compliance `tests/guardrails/redis-prod-required.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e, the schema and startup-hook
 * halves (the hook is `src/instrumentation-node.ts` in Islestone, owner
 * decision 2026-11-19). The health-endpoint, env-template, deployment-doc and
 * CI-workflow assertions wait for sub-phase 1.8.
 */
import * as fs from 'fs';
import * as path from 'path';

import { codeOf, functionBodyOf } from '../helpers/source-blocks';
import { runEnvScript } from '../helpers/run-env-script';

const REPO_ROOT = path.resolve(__dirname, '../..');
const hook = codeOf(fs.readFileSync(path.join(REPO_ROOT, 'src/instrumentation-node.ts'), 'utf-8'));

describe('GAP-13 ratchet — schema layer', () => {
    it('refuses a production start with REDIS_URL unset', () => {
        const result = runEnvScript({
            NODE_ENV: 'production',
            RATE_LIMIT_MODE: 'memory',
            DATA_ENCRYPTION_KEY: 'a-real-production-key-at-least-32-chars-long-deterministic', // pragma: allowlist secret — test fixture
            REDIS_URL: undefined,
        });
        expect(result.success).toBe(false);
        expect(result.error).toContain('REDIS_URL is REQUIRED in production');
    });

    it('lets development start without it', () => {
        expect(runEnvScript({ NODE_ENV: 'development', REDIS_URL: undefined }).success).toBe(true);
    });
});

describe('GAP-13 ratchet — runtime startup hook', () => {
    // The refusal lives in the production-only function, so it never runs in
    // development or test.
    const refusals = functionBodyOf(hook, 'refuseUnsafeProductionStart');

    it('the production refusals exit 1 when REDIS_URL is unset', () => {
        expect(refusals).toMatch(/if\s*\(\s*!env\.REDIS_URL\s*\)\s*\{[\s\S]*?process\.exit\(1\)/);
    });

    it('the refusals run only in production', () => {
        const register = functionBodyOf(hook, 'registerNode');
        expect(register).toMatch(/if\s*\(\s*env\.NODE_ENV\s*===\s*'production'\s*\)\s*\{\s*await\s+refuseUnsafeProductionStart\(env\)/);
    });

    it('has NO RATE_LIMIT_ENABLED escape hatch on the Redis check', () => {
        const check = refusals.match(/if\s*\(([^)]*REDIS_URL[^)]*)\)/);
        expect(check).not.toBeNull();
        expect(check![1]).not.toMatch(/RATE_LIMIT_ENABLED/);
    });
});
