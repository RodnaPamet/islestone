/**
 * A production process refuses to boot with AUTH_TEST_MODE=1.
 *
 * Setting the flag strips production controls at once: the login brute-force
 * throttle (`src/lib/auth/credential-rate-limit.ts`) and the mutation-tier
 * rate limit (`isRateLimitBypassed`) become no-ops. So a production process
 * with it set has no brute-force protection.
 *
 * Copied from inflect-compliance `tests/unit/security/auth-test-mode-prod-refusal.test.ts`
 * (5528464fc54a8681956f3b9ce23ca9c075f0420e) and cut to the surface sub-phase
 * 1.4 has: the env schema's refusal and its `next start` exemption. The
 * parent's second surface, the startup hook in `src/instrumentation.ts`, and
 * its deploy templates and CI harness checks arrive with sub-phases 1.6 and
 * 1.8.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { codeOf } from '../../helpers/source-blocks';

const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const codeOnly = (s: string) => codeOf(s);

/** The AUTH_TEST_MODE declaration in src/env.ts, to the next field. */
function declaration(): string {
    const src = codeOnly(read('src/env.ts'));
    const at = src.indexOf('AUTH_TEST_MODE: z');
    expect(at).toBeGreaterThan(-1);
    const rest = src.slice(at);
    const end = rest.search(/\n\s{8}[A-Z][A-Z0-9_]*:\s/);
    return end > 0 ? rest.slice(0, end) : rest;
}

describe('AUTH_TEST_MODE is refused in production', () => {
    it('the env schema rejects "1" when NODE_ENV is production', () => {
        // Bounded by the DECLARATION, not by a magic character count. The
        // previous `slice(at, at + 900)` over raw source broke the moment a
        // second exemption clause was added above `val === '1'` — a guard whose
        // window is a constant fails on unrelated edits to the thing it guards,
        // which is the opposite of useful.
        const block = declaration();
        expect(block).toMatch(/superRefine/);
        expect(block).toMatch(/NODE_ENV !== 'production'/);
        expect(block).toMatch(/val === '1'/);
    });

    it('exempts `next start` under test, or it kills the E2E webserver', () => {
        // `next start` sets NODE_ENV=production whatever the caller passed, so
        // the E2E server, which legitimately sets AUTH_TEST_MODE=1, presents
        // as production. NEXT_TEST_MODE is set only by the Playwright
        // webServer, so it separates the two cases without weakening the
        // refusal. Comment-stripped: the prose above the code must not be
        // what satisfies this.
        expect(declaration()).toMatch(/NEXT_TEST_MODE === '1'\)\s*return;/);
        expect(codeOnly(read('playwright.config.ts'))).toMatch(/NEXT_TEST_MODE=1/);
    });

    it('the flag still works outside production — this is a prod refusal, not a removal', () => {
        expect(declaration()).toMatch(/NODE_ENV !== 'production'\)\s*return;/);
    });
});
