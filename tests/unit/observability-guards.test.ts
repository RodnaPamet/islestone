/* eslint-disable @typescript-eslint/no-require-imports -- copied from inflect-compliance (PROVENANCE.md), whose lint config allows it */
/**
 * Observability Regression Guards
 *
 * Structural tests that ensure:
 * 1. No raw console.log/warn/error in app-layer or route handlers
 * 2. Logger wrapper exists and exports the expected API
 * 3. RequestId propagation works through ALS
 * 4. Observability modules export expected interfaces
 * 5. Sentry is harmless when SENTRY_DSN is not set
 * 6. OTel is harmless when OTEL_ENABLED is not set
 */

import * as fs from 'fs';
import * as path from 'path';
import { REPO_ROOT, repoFiles } from '../helpers/repo-files';

// ─── Helpers ───

/**
 * Every .ts/.tsx file git lists under `dir` (absolute). Population from git,
 * never a directory walk (CLAUDE.md, "Guards"). Copied from inflect-compliance
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e with that helper swapped in, and
 * the route-coverage percentage replaced by a named exemption list.
 */
function findTsFiles(dir: string): string[] {
    const under = path.relative(REPO_ROOT, dir).replace(/\\/g, '/');
    return repoFiles({ under, extensions: ['.ts', '.tsx'] });
}

function readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
}

const SRC = path.resolve(__dirname, '../../src');

// ─── 1. Console.log ban in app-layer and route handlers ───

describe('Observability Guard: No raw console in app-layer', () => {
    const appLayerDir = path.join(SRC, 'app-layer');
    const files = findTsFiles(appLayerDir);

    it('finds at least 10 TypeScript files in app-layer', () => {
        expect(files.length).toBeGreaterThanOrEqual(10);
    });

    it('has no console.log/warn/error in any app-layer file', () => {
        const violations: { file: string; line: number; content: string }[] = [];

        for (const file of files) {
            const content = readFile(file);
            const lines = content.split('\n');
            lines.forEach((ln, idx) => {
                // Skip comments
                const trimmed = ln.trim();
                if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

                if (/console\.(log|warn|error)\s*\(/.test(ln)) {
                    violations.push({
                        file: path.relative(SRC, file),
                        line: idx + 1,
                        content: ln.trim(),
                    });
                }
            });
        }

        if (violations.length > 0) {
            expect(violations).toEqual([]);
        }
    });
});

describe('Observability Guard: No raw console in route handlers', () => {
    const apiDir = path.join(SRC, 'app', 'api');

    // Infrastructure routes that operate outside withApiErrorHandling
    // and legitimately use console for server-bootstrap or auth-callback logging.
    const ALLOWLISTED_ROUTE_PATTERNS = [
        'auth', 'staging', 'stripe', 'cron',
    ];

    const files = findTsFiles(apiDir).filter((f) => {
        const rel = path.relative(apiDir, f);
        return !ALLOWLISTED_ROUTE_PATTERNS.some((pat) => rel.startsWith(pat));
    });

    it('finds at least 20 route handler files', () => {
        expect(files.length).toBeGreaterThanOrEqual(20);
    });

    it('has no console.log/warn/error in any API route file (excluding allowlisted infra routes)', () => {
        const violations: { file: string; line: number; content: string }[] = [];

        for (const file of files) {
            const content = readFile(file);
            const lines = content.split('\n');
            lines.forEach((ln, idx) => {
                const trimmed = ln.trim();
                if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

                if (/console\.(log|warn|error)\s*\(/.test(ln)) {
                    violations.push({
                        file: path.relative(SRC, file),
                        line: idx + 1,
                        content: ln.trim(),
                    });
                }
            });
        }

            expect(violations).toEqual([]);
    });
});

// ─── 2. Logger module structure guard ───

describe('Observability Guard: Logger module exports', () => {
    it('exports a logger object with standard methods', () => {
        const { logger } = require('../../src/lib/observability/logger');
        expect(logger).toBeDefined();
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.warn).toBe('function');
        expect(typeof logger.error).toBe('function');
        expect(typeof logger.debug).toBe('function');
    });

    it('exports createChildLogger', () => {
        const { createChildLogger } = require('../../src/lib/observability/logger');
        expect(typeof createChildLogger).toBe('function');
    });
});

// ─── 3. RequestId propagation guard ───

describe('Observability Guard: RequestId propagation', () => {
    it('runWithRequestContext and getRequestContext roundtrip correctly', () => {
        const { runWithRequestContext, getRequestContext } = require('../../src/lib/observability/context');

        const requestId = 'regression-test-' + Date.now();
        let captured: string | undefined;

        // runWithRequestContext is sync continuation — use synchronous callback
        runWithRequestContext(
            { requestId, route: '/test', startTime: 0 },
            () => {
                const ctx = getRequestContext();
                captured = ctx?.requestId;
                return Promise.resolve();
            },
        );

        expect(captured).toBe(requestId);
    });

    it('getRequestContext returns undefined outside of context', () => {
        const { getRequestContext } = require('../../src/lib/observability/context');
        const ctx = getRequestContext();
        // Outside ALS, should be undefined
        expect(ctx).toBeUndefined();
    });
});

// ─── 4. Barrel export guard ───

describe('Observability Guard: Barrel exports', () => {
    it('exports all critical observability functions', () => {
        const obs = require('../../src/lib/observability/index');
        expect(typeof obs.logger).toBeDefined();
        expect(typeof obs.runWithRequestContext).toBe('function');
        expect(typeof obs.getRequestContext).toBe('function');
        expect(typeof obs.traceUsecase).toBe('function');
        expect(typeof obs.traceOperation).toBe('function');
        expect(typeof obs.captureError).toBe('function');
        expect(typeof obs.initSentry).toBe('function');
        expect(typeof obs.runJob).toBe('function');
    });
});

// ─── 5. Sentry is harmless when DSN is absent ───

describe('Observability Guard: Sentry safe when disabled', () => {
    it('captureError does not throw when Sentry is not initialized', () => {
        const { captureError } = require('../../src/lib/observability/sentry');
        // Should be a no-op, not throw
        expect(() => captureError(new Error('test'), { status: 500 })).not.toThrow();
    });

    it('initSentry does not throw when SENTRY_DSN is missing', () => {
        const { initSentry } = require('../../src/lib/observability/sentry');
        // initSentry checks for DSN — should be a no-op
        expect(() => initSentry()).not.toThrow();
    });
});

// ─── 6. OTel is harmless when disabled ───

describe('Observability Guard: OTel safe when disabled', () => {
    it('traceUsecase runs callback transparently when OTel is not initialized', async () => {
        const { traceUsecase } = require('../../src/lib/observability/tracing');
        const ctx = {
            requestId: 'test',
            userId: 'u1',
            tenantId: 't1',
            tenantSlug: 'acme',
            role: 'ADMIN',
            permissions: { canAdmin: true, canWrite: true, canRead: true, canAudit: false, canExport: false },
        };
        const result = await traceUsecase('test.op', ctx, async () => 42);
        expect(result).toBe(42);
    });

    it('traceOperation runs callback transparently when OTel is not initialized', async () => {
        const { traceOperation } = require('../../src/lib/observability/tracing');
        const result = await traceOperation('test.op', {}, async () => 'hello');
        expect(result).toBe('hello');
    });
});

// ─── 7. withApiErrorHandling coverage guard ───

describe('Observability Guard: Route handler coverage', () => {
    const apiDir = path.join(SRC, 'app', 'api');
    const routeFiles = findTsFiles(apiDir).filter((f) => f.endsWith('route.ts'));

    /**
     * Routes that answer outside `withApiErrorHandling`, each with its reason.
     * Repository-relative. A route not listed must use the wrapper; a listed
     * route that no longer exists, or that now uses it, fails as stale.
     */
    const EXEMPT: Record<string, string> = {
        'src/app/api/auth/[...nextauth]/route.ts': "NextAuth's own handler, which owns its responses",
        'src/app/api/auth/verify-email/route.ts': 'answers every outcome with a redirect to the login page',
        'src/app/api/auth/verify-email/resend/route.ts': 'answers every outcome with the same shape (enumeration safety)',
        'src/app/api/livez/route.ts': 'health probe: must answer without the rate limiter',
        'src/app/api/readyz/route.ts': 'health probe: must answer without the rate limiter',
        'src/app/api/telemetry/vitals/route.ts': 'public beacon sink: always 204, never an error body',
        'src/app/api/security/csp-report/route.ts': 'public browser report sink: always 204, rate-limited itself',
        'src/app/api/csp-report/route.ts': 'legacy alias of the CSP report sink',
        'src/app/api/t/[tenantSlug]/notifications/stream/route.ts': 'a long-lived SSE stream, not a JSON response',
    };
    const rel = (f: string) => path.relative(REPO_ROOT, f).replace(/\\/g, '/');

    it('finds the route files', () => {
        expect(routeFiles.length).toBeGreaterThanOrEqual(20);
    });

    it('every route file outside EXEMPT uses withApiErrorHandling', () => {
        const missing = routeFiles
            .filter((f) => !(rel(f) in EXEMPT))
            .filter((f) => !readFile(f).includes('withApiErrorHandling'))
            .map(rel);
        expect(missing).toEqual([]);
    });

    it('no EXEMPT entry is stale', () => {
        const present = new Set(routeFiles.map(rel));
        const stale = Object.keys(EXEMPT).filter(
            (f) => !present.has(f) || readFile(path.join(REPO_ROOT, f)).includes('withApiErrorHandling'),
        );
        expect(stale).toEqual([]);
    });
});

// ─── 8. Job runner exists and works ───

describe('Observability Guard: runJob wrapper', () => {
    it('exports runJob function', () => {
        const { runJob } = require('../../src/lib/observability/job-runner');
        expect(typeof runJob).toBe('function');
    });

    it('runs a job and returns the result', async () => {
        const { runJob } = require('../../src/lib/observability/job-runner');
        const result = await runJob('test-guard', async () => {
            return { ok: true };
        });
        expect(result).toEqual({ ok: true });
    });
});
