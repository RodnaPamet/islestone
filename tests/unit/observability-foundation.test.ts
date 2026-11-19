/* eslint-disable @typescript-eslint/no-require-imports -- copied from inflect-compliance (PROVENANCE.md), whose lint config allows it */
/**
 * Observability Foundation Tests
 *
 * Tests for Epic 19 Phase 1:
 * 1. No console.* remains in backend/server code (allowlisted exceptions only)
 * 2. Structured logger compiles and is usable in server code
 * 3. Edge logger compiles and is usable
 *
 * Copied from inflect-compliance at 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 * The liveness, readiness and health-path cases stay behind: Islestone's
 * `tests/unit/health-routes.test.ts` and 1.4's guard tests own them. The
 * console scan takes its population from git.
 */

import * as fs from 'fs';
import * as path from 'path';
import { REPO_ROOT, repoFiles } from './../helpers/repo-files';

// ─── Test 1: No console.* in server code ───────────────────────────────

describe('console.* usage guard', () => {
    it('should have no console.log/warn/error in server-side src/ files except allowlisted', () => {
        const violations: string[] = [];

        // Files that are explicitly allowed to use console.*:
        const ALLOWED_FILES = new Set([
            // Edge logger (shim that intentionally wraps console.*)
            'lib/observability/edge-logger.ts',
            // Pre-init bootstrap: the startup refusals run before any logger
            // is guaranteed and exit the process right after.
            'instrumentation-node.ts',
        ]);

        // The mirrored shared UI (ui-mirror.json), which uses console.* by
        // design and may not be edited here.
        const ALLOWED_PREFIXES = [
            'components/ui/',
            'lib/hooks/',
        ];

        const CONSOLE_PATTERN = /console\.(log|warn|error|info|debug)\s*\(/;

        // Population from git, never a directory walk (CLAUDE.md, "Guards").
        for (const fullPath of repoFiles({ under: 'src', extensions: ['.ts', '.tsx'] })) {
            const relPath = path.relative(path.join(REPO_ROOT, 'src'), fullPath).replace(/\\/g, '/');
            if (ALLOWED_FILES.has(relPath)) continue;
            if (ALLOWED_PREFIXES.some(p => relPath.startsWith(p))) continue;

            const lines = fs.readFileSync(fullPath, 'utf-8').split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i]!;
                // Skip comments
                if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
                if (CONSOLE_PATTERN.test(line)) {
                    violations.push(`${relPath}:${i + 1}: ${line.trim()}`);
                }
            }
        }

        if (violations.length > 0) {
            throw new Error(
                `Found ${violations.length} console.* call(s) in server code that should use the structured logger:\n` +
                violations.map(v => `  ${v}`).join('\n')
            );
        }
    });
});

// ─── Test 2: Structured logger compiles and is usable ──────────────────

describe('structured logger', () => {
    it('should export logger with info/warn/error/debug/fatal methods', () => {
        const { logger } = require('../../src/lib/observability/logger');

        expect(logger).toBeDefined();
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.warn).toBe('function');
        expect(typeof logger.error).toBe('function');
        expect(typeof logger.debug).toBe('function');
        expect(typeof logger.fatal).toBe('function');
    });

    it('should export extractErrorMeta that extracts safe error metadata', () => {
        const { extractErrorMeta } = require('../../src/lib/observability/logger');

        const err = new TypeError('something broke');
        const meta = extractErrorMeta(err);

        expect(meta).toBeDefined();
        expect(meta!.name).toBe('TypeError');
        expect(meta!.message).toBe('something broke');
        expect(meta!.stack).toBeDefined();
    });

    it('should export extractErrorMeta that handles non-Error inputs', () => {
        const { extractErrorMeta } = require('../../src/lib/observability/logger');

        const meta = extractErrorMeta('string error');
        expect(meta!.name).toBe('UnknownError');
        expect(meta!.message).toBe('string error');
    });

    it('should export createChildLogger', () => {
        const { createChildLogger } = require('../../src/lib/observability/logger');

        const child = createChildLogger({ component: 'test-child' });
        expect(child).toBeDefined();
        expect(typeof child.info).toBe('function');
    });

    it('should export pinoInstance', () => {
        const { pinoInstance } = require('../../src/lib/observability/logger');

        expect(pinoInstance).toBeDefined();
        expect(typeof pinoInstance.info).toBe('function');
        expect(pinoInstance.level).toBeDefined();
    });
});

// ─── Test 3: Edge logger compiles and is usable ────────────────────────

describe('edge logger', () => {
    // edge-logger is silent in NODE_ENV=test by default (otherwise every
    // middleware-invoking integration test floods stderr with pino JSON).
    // These tests specifically assert the console-shape contract, so opt
    // back in for the duration of the suite.
    let savedEdgeLoggerInTest: string | undefined;
    beforeAll(() => {
        savedEdgeLoggerInTest = process.env.EDGE_LOGGER_IN_TEST;
        process.env.EDGE_LOGGER_IN_TEST = '1';
    });
    afterAll(() => {
        if (savedEdgeLoggerInTest === undefined) {
            delete process.env.EDGE_LOGGER_IN_TEST;
        } else {
            process.env.EDGE_LOGGER_IN_TEST = savedEdgeLoggerInTest;
        }
    });

    it('should export edgeLogger with info/warn/error/debug methods', () => {
        const { edgeLogger } = require('../../src/lib/observability/edge-logger');

        expect(edgeLogger).toBeDefined();
        expect(typeof edgeLogger.info).toBe('function');
        expect(typeof edgeLogger.warn).toBe('function');
        expect(typeof edgeLogger.error).toBe('function');
        expect(typeof edgeLogger.debug).toBe('function');
    });

    it('should emit structured JSON via console', () => {
        const { edgeLogger } = require('../../src/lib/observability/edge-logger');

        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        edgeLogger.info('test message', { component: 'test' });

        expect(logSpy).toHaveBeenCalledTimes(1);
        const output = logSpy.mock.calls[0][0];
        const parsed = JSON.parse(output);

        expect(parsed.msg).toBe('test message');
        expect(parsed.component).toBe('test');
        expect(parsed.level).toBe(30); // info = 30
        expect(parsed.time).toBeDefined();

        logSpy.mockRestore();
    });

    it('every line carries a requestId, so production ships it (#5131)', () => {
        // The Ops Agent keeps a container line only when its text contains
        // both `requestId` and `msg` (deploy/ops-agent-config.yaml); without
        // one, every middleware denominator line and edge warning was dropped.
        const { edgeLogger } = require('../../src/lib/observability/edge-logger');
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        edgeLogger.info('document_load', { route: '/t/[tenant]/dashboard', requestId: 'req-42' });
        edgeLogger.warn('consent callback rejected', { component: 'test' });

        const withId = JSON.parse(logSpy.mock.calls[0][0]);
        expect(withId.requestId).toBe('req-42');
        const without = warnSpy.mock.calls[0][0] as string;
        expect(JSON.parse(without).requestId).toBe('unknown');
        expect(without).toContain('requestId');
        expect(without).toContain('msg');

        logSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('should use console.error for error level', () => {
        const { edgeLogger } = require('../../src/lib/observability/edge-logger');

        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        edgeLogger.error('test error', { component: 'test' });

        expect(errorSpy).toHaveBeenCalledTimes(1);
        const parsed = JSON.parse(errorSpy.mock.calls[0][0]);
        expect(parsed.level).toBe(50); // error = 50

        errorSpy.mockRestore();
    });
});

// ─── Test 4: Liveness probe ────────────────────────────────────────────

// ─── Test 5: Readiness probe — contract validation ─────────────────────
// NOTE: The readyz route instantiates PrismaClient at module scope, which
// blocks/hangs in the Jest unit test environment. Readyz is validated via:
//   - Integration tests (npm run test:integration)
//   - Manual verification: curl http://localhost:3000/api/readyz
// The livez probe (no DB dependency) is tested above.

// ─── Test 6: Probe public path allowlist ───────────────────────────────
