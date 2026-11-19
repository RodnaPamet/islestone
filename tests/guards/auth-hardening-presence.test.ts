/**
 * Guardrail: Epic 1 security-validation closures stay in place.
 *
 * R-3 — signIn callback rejects OAuth profiles with email_verified=false.
 * R-6 — startup aborts in production when REDIS_URL is unset and rate
 *       limiting is not explicitly disabled.
 *
 * These two checks are small but load-bearing. A "simplify" PR that
 * collapses the email_verified branch (because it "looks redundant
 * since OAuth verifies anyway") would silently reintroduce a known
 * threat path. The Redis-required check guards the rate-limit
 * security control from silently no-op'ing in prod.
 *
 * Static structural assertion: the relevant function bodies must
 * contain the load-bearing predicates.
 *
 * Copied from inflect-compliance at 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 * Only the R-3 half is ported in sub-phase 1.4. The R-6 half reads
 * `src/instrumentation.ts`, which Islestone does not have yet; it moves with
 * the startup hook (observability, sub-phase 1.6).
 */

import * as fs from 'fs';
import * as path from 'path';

import { codeOf } from '../helpers/source-blocks';

const ROOT = path.resolve(__dirname, '../..');

function read(rel: string): string {
    return codeOf(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

describe('R-3: signIn rejects email_verified=false', () => {
    const auth = read('src/auth.ts');

    it('reads profile.email_verified in the signIn callback', () => {
        // Match the exact predicate so a refactor that removes the
        // === false comparison (e.g. tightens to truthy check) shows
        // up as a guardrail diff rather than a silent acceptance.
        expect(auth).toMatch(/profile\.email_verified === false/);
    });

    it('returns false from the signIn callback when the predicate hits', () => {
        // Within ~25 lines of the email_verified check there must be
        // an explicit `return false` — this is what NextAuth uses to
        // reject the sign-in.
        const idx = auth.indexOf('profile.email_verified === false');
        expect(idx).toBeGreaterThan(-1);
        const window = auth.slice(idx, idx + 1500);
        expect(window).toMatch(/return false/);
    });

    it('logs the rejection via edgeLogger.warn', () => {
        const idx = auth.indexOf('profile.email_verified === false');
        expect(idx).toBeGreaterThan(-1);
        const window = auth.slice(idx, idx + 1500);
        expect(window).toMatch(/edgeLogger\.warn/);
    });
});
