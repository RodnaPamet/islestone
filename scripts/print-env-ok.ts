/**
 * Boots `src/env.ts` in a real process and prints `OK` when its schema
 * accepts the environment. `tests/unit/env-encryption-key.test.ts` and
 * `tests/unit/env-rate-limit-mode.test.ts` run it under `tsx` to test the
 * production refusals, because Jest maps `@/env` to `tests/mocks/env.ts` and
 * cannot exercise the real schema.
 *
 * It imports `../src/env` rather than `@/env`; tsx resolves the `@/` imports
 * inside `src/env.ts` through tsconfig `paths`.
 *
 * Copied from inflect-compliance `scripts/print-env-ok.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, with its compliance-storage
 * `RESOLVED` keys replaced by Islestone's defaulted `RATE_LIMIT_MODE`.
 */
import { env } from '../src/env';

// This simply forces evaluation of the env schema
if (env.DATABASE_URL) {
    console.log('OK');
}

// Print the RESOLVED value of a defaulted variable. A test cannot assert a
// zod `.default(...)` from inside Jest (`@/env` is the mock there), so the
// only way to observe what the schema produces for an ABSENT variable is to
// boot it in a real process, which is what this script exists to do.
console.log(`RESOLVED ${JSON.stringify({ RATE_LIMIT_MODE: env.RATE_LIMIT_MODE })}`);
