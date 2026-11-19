/**
 * Runs `scripts/print-env-ok.ts` under `tsx` in a child process, so a test
 * exercises the REAL `src/env.ts` schema (Jest maps `@/env` to the mock).
 *
 * Copied from inflect-compliance `tests/unit/env.test.ts` (`runEnvScript`,
 * L29–51) at 5528464fc54a8681956f3b9ce23ca9c075f0420e, typed without `any`,
 * and shared by the env refusal suites.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/print-env-ok.ts');
const TSX = path.resolve(__dirname, '../../node_modules/.bin/tsx');

/** The variables Islestone's `src/env.ts` requires in every environment. */
export const VALID_ENV: Readonly<Record<string, string>> = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://user:password@localhost:5432/db',
    AUTH_SECRET: 'supersecretstringthatis16charplus', // pragma: allowlist secret — test fixture
};

/**
 * Variables the parent process may carry that would change the answer.
 * Each is cleared unless the case sets it.
 */
const CLEARED = [
    'SKIP_ENV_VALIDATION',
    'NEXT_TEST_MODE',
    'AUTH_TEST_MODE',
    'RATE_LIMIT_MODE',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'DATA_ENCRYPTION_KEY',
];

export interface EnvScriptResult {
    success: boolean;
    output: string;
    error: string;
}

export function runEnvScript(overrides: Record<string, string | undefined>): EnvScriptResult {
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    for (const key of CLEARED) delete childEnv[key];
    Object.assign(childEnv, VALID_ENV);
    for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) delete childEnv[key];
        else childEnv[key] = value;
    }
    try {
        const output = execFileSync(TSX, [SCRIPT], { env: childEnv, encoding: 'utf-8', stdio: 'pipe' });
        return { success: true, output, error: '' };
    } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        return { success: false, output: e.stdout ?? '', error: e.stderr || e.message || '' };
    }
}
