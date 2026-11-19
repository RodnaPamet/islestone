import * as fs from 'node:fs';
import * as path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the BUILT app: run `npm run build` first. The web
 * server is `next start` on a fixed port, so a run tests what ships, not the
 * dev server.
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
        command: `npx next start --hostname 127.0.0.1 --port ${PORT}`,
        url: `${BASE_URL}/api/livez`,
        reuseExistingServer: !isCI,
        timeout: 120_000,
        env: {
            // Validated at start by next.config.ts, so it must be real.
            NEXT_PUBLIC_APP_URL: BASE_URL,
            NEXT_TELEMETRY_DISABLED: '1',
        },
    },
});
