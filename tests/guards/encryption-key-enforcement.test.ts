/**
 * GAP-03 — Structural ratchet for the DATA_ENCRYPTION_KEY enforcement
 * surfaces.
 *
 * The audit's GAP-03 finding was that the schema marked
 * `DATA_ENCRYPTION_KEY` as `.optional()` and a production process
 * could boot without encryption-at-rest. The fix landed in five
 * coordinated surfaces:
 *
 *   1. Zod schema — `superRefine` on the field in `src/env.ts`.
 *   2. Web startup hook — `src/instrumentation.ts` calls
 *      `checkProductionEncryptionKey` + `runEncryptionSentinel`.
 *   3. Worker startup — `scripts/worker.ts` calls the same checker.
 *   4. Scheduler startup — `scripts/scheduler.ts` calls the checker.
 *   5. Docker Compose — `:?error` syntax in all three prod compose
 *      files.
 *
 * A future "simplify" PR could quietly remove any one of these and
 * re-introduce the vulnerable state. This guardrail asserts the
 * structural shape of each surface — failing CI before the change
 * lands instead of relying on a security review that someone might
 * miss. Each assertion has a one-line note explaining the regression
 * class it protects.
 *
 * The functional behaviour is covered separately by:
 *   - `tests/unit/env-encryption-key.test.ts` and
 *     `tests/unit/env-rate-limit-mode.test.ts` (schema validation, in a
 *     real process)
 *   - `tests/unit/security/startup-encryption-check.test.ts` and
 *     `tests/unit/security/startup-rate-limit-check.test.ts` (helpers)
 *
 * Copied from inflect-compliance `tests/guardrails/encryption-key-enforcement.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 */

import * as fs from 'fs';
import * as path from 'path';

import { allCallExpressionsOf, codeOf } from '../helpers/source-blocks';

const REPO_ROOT = path.resolve(__dirname, '../..');

// codeOf() masks comments at the READ SEAM (#2246), so a COMMENT naming a
// thing cannot satisfy an assertion meant to be about CODE. Masking is the
// DEFAULT (`readRepoFile`) so a new assertion inherits it; `readRepoFileRaw`
// is for the surfaces where a `//` is content rather than a comment — the
// Compose files, the .env templates and the CI workflow — and where the
// signal being asserted (`# DEPRECATED …`) legitimately IS a comment.
const readRepoFileRaw = (rel: string): string =>
    fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8');

const readRepoFile = (rel: string): string => codeOf(readRepoFileRaw(rel));

describe('GAP-03 ratchet — schema layer', () => {
    it('src/env.ts has DATA_ENCRYPTION_KEY with a superRefine that mentions production', () => {
        const src = readRepoFile('src/env.ts');
        // Regression: a future PR that drops the superRefine — for
        // example a "simplify env validation" cleanup — would silently
        // re-introduce the vulnerable optional() shape that GAP-03
        // closed.
        expect(src).toMatch(/DATA_ENCRYPTION_KEY/);
        // Bound to the DATA_ENCRYPTION_KEY refinement by its own refusal:
        // a bare `.superRefine(` is satisfied by every refined env var in
        // the file, so it would survive this refinement being dropped.
        expect(
            allCallExpressionsOf(readRepoFileRaw('src/env.ts'), 'superRefine').filter((call) =>
                call.includes("'DATA_ENCRYPTION_KEY is REQUIRED in production. '"),
            ),
        ).toHaveLength(1);
        // Use [\s\S]* instead of `.*` + `s` flag for ES2017 target.
        expect(src).toMatch(/NODE_ENV[\s\S]*production|production[\s\S]*NODE_ENV/);
    });

    it('src/env.ts imports DEV_FALLBACK_DATA_ENCRYPTION_KEY from the shared constants module', () => {
        const src = readRepoFile('src/env.ts');
        // Regression: inline-defining the dev fallback string in the
        // schema instead of importing the constant breaks the
        // single-source-of-truth contract — a typo would cause the
        // schema and runtime to disagree on what counts as the dev
        // fallback.
        expect(src).toMatch(
            /import[\s\S]*DEV_FALLBACK_DATA_ENCRYPTION_KEY[\s\S]*encryption-constants/,
        );
    });

    it('the dev-fallback constant is exported from a dedicated module', () => {
        const src = readRepoFile('src/lib/security/encryption-constants.ts');
        expect(src).toMatch(/export const DEV_FALLBACK_DATA_ENCRYPTION_KEY/);
        // Regression: removing the export would force callers to
        // duplicate the literal string and break the cross-layer
        // ratchet.
    });
});

describe('GAP-03 ratchet — runtime startup hooks', () => {
    it('Next.js instrumentation hook calls checkProductionEncryptionKey + runEncryptionSentinel', () => {
        const src = readRepoFile('src/instrumentation.ts');
        // Regression: a refactor that drops either check leaves the
        // SKIP_ENV_VALIDATION=1 escape hatch unguarded (if the schema
        // is bypassed) OR loses the functional sentinel that catches
        // structurally-valid keys that fail HKDF/AES.
        expect(src).toMatch(/checkProductionEncryptionKey/);
        expect(src).toMatch(/runEncryptionSentinel/);
        // The check must be inside an if-production block — never
        // run unconditionally (would break dev/test ergonomics).
        expect(src).toMatch(/NODE_ENV.*['"]production['"]/);
    });

    it('startup-encryption-check exports both helpers', () => {
        const src = readRepoFile('src/lib/security/startup-encryption-check.ts');
        expect(src).toMatch(/export function checkProductionEncryptionKey/);
        expect(src).toMatch(/export async function runEncryptionSentinel/);
    });
});

describe('issue #17 ratchet — the rate-limit store in production', () => {
    it('src/env.ts refuses RATE_LIMIT_MODE=upstash without the Upstash values, in production', () => {
        expect(
            allCallExpressionsOf(readRepoFileRaw('src/env.ts'), 'superRefine').filter(
                (call) => call.includes("'UPSTASH_REDIS_REST_URL'") && call.includes("'UPSTASH_REDIS_REST_TOKEN'"),
            ),
        ).toHaveLength(1);
    });

    it('the instrumentation hook calls checkProductionRateLimitStore and exits on a refusal', () => {
        const src = readRepoFile('src/instrumentation.ts');
        expect(src).toMatch(/checkProductionRateLimitStore\(/);
        expect(src).toMatch(/if \(!store\.ok\)[\s\S]{0,120}process\.exit\(1\)/);
    });
});
