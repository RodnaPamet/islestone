import * as fs from 'node:fs';
import * as path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the BUILT app: run `npm run build` first. The web
 * server is the standalone server the app image runs (`npm run start`,
 * scripts/start-standalone.mjs, sub-phase 1.8) on a fixed port, so a run tests
 * what ships, not the dev server.
 *
 * Browsers: CI installs Playwright's Chromium (`npx playwright install
 * --with-deps chromium`). Where a Chromium is already installed, point
 * PW_CHROMIUM_PATH at its binary, or at a directory containing one.
 */
const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const isCI = !!process.env.CI;

const CHROMIUM_BINARY_NAMES = new Set(['chrome', 'chromium', 'chrome-headless-shell', 'headless_shell']);

function findChromiumBinary(dir: string, depth: number): string | undefined {
    if (depth < 0) return undefined;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (CHROMIUM_BINARY_NAMES.has(entry.name) && fs.statSync(full).isFile()) return full;
    }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const found = findChromiumBinary(path.join(dir, entry.name), depth - 1);
        if (found) return found;
    }
    return undefined;
}

/** The Chromium to launch, from PW_CHROMIUM_PATH; undefined means Playwright's own. */
function chromiumExecutablePath(): string | undefined {
    const configured = process.env.PW_CHROMIUM_PATH;
    if (!configured) return undefined;
    const stat = fs.statSync(configured); // follows symlinks; throws if missing
    if (stat.isFile()) return configured;
    const found = findChromiumBinary(configured, 4);
    if (!found) throw new Error(`PW_CHROMIUM_PATH=${configured} contains no Chromium binary`);
    return found;
}

const executablePath = chromiumExecutablePath();

export default defineConfig({
    testDir: 'tests/e2e',
    fullyParallel: true,
    forbidOnly: isCI,
    retries: isCI ? 1 : 0,
    workers: isCI ? 2 : undefined,
    reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: BASE_URL,
        trace: 'off',
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                launchOptions: executablePath ? { executablePath } : {},
            },
        },
    ],
    webServer: {
        // AUTH_TEST_MODE=1 turns off the credential throttle and the
        // mutation-tier rate limit, which the auth specs would trip. The
        // standalone server forces NODE_ENV=production, where src/env.ts
        // refuses the flag unless NEXT_TEST_MODE=1, which only this server sets
        // (tests/unit/security/auth-test-mode-prod-refusal.test.ts).
        command: `AUTH_TEST_MODE=1 NEXT_TEST_MODE=1 HOSTNAME=127.0.0.1 PORT=${PORT} node scripts/start-standalone.mjs`,
        url: `${BASE_URL}/api/livez`,
        reuseExistingServer: !isCI,
        timeout: 120_000,
        env: {
            // Validated when the server first loads src/env-client.ts, so it must be real.
            NEXT_PUBLIC_APP_URL: BASE_URL,
            // Required by src/env.ts, which the server validates at start (src/instrumentation-node.ts). The auth
            // specs (sub-phase 1.4) register and sign in, so it must reach a
            // migrated database. Do not set
            // SKIP_ENV_VALIDATION here: this is the one run that exercises
            // the built app's env check.
            DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://islestone:islestone_dev@127.0.0.1:6432/islestone',
            // Sub-phase 1.4. A test value, never a real secret.
            AUTH_SECRET: process.env.AUTH_SECRET ?? 'e2e-auth-secret-at-least-16-characters',
            NEXTAUTH_URL: BASE_URL,
            APP_URL: BASE_URL,
            // `next start` is production, where public sign-up is closed by
            // default (ADR 0006); the specs register their own workspaces.
            AUTH_PUBLIC_SIGNUP: '1',
            // Sub-phase 2.6b: public intake forms are closed in production
            // by default; the intake spec sends one signed out.
            INTAKE_PUBLIC_FORMS: '1',
            // Sub-phase 1.5: a production start refuses to run without a
            // real field-encryption key (src/env.ts and the startup check in
            // src/instrumentation.ts). A throwaway test value, never a real key.
            DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY ?? 'e2e-data-encryption-key-not-a-real-secret-0001', // pragma: allowlist secret
            // In-memory counters, said explicitly: production refuses the
            // Upstash default without Upstash credentials (issue #17).
            RATE_LIMIT_MODE: 'memory',
            // Sub-phase 1.6: a production start refuses to run without an
            // authenticated REDIS_URL (src/env.ts and src/instrumentation-node.ts),
            // and checks its eviction policy at boot. The local compose Redis
            // by default; CI's E2E job runs a Redis service with this password.
            REDIS_URL: process.env.REDIS_URL ?? 'redis://:islestone_dev@127.0.0.1:6379', // pragma: allowlist secret
            NEXT_TELEMETRY_DISABLED: '1',
        },
    },
});
