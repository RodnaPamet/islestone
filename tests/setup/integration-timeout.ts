/**
 * The integration project's per-test timeout.
 *
 * Jest reads `testTimeout` only from the top-level (global) config: an entry
 * inside `projects` is silently ignored, so this project ran at the 5 s
 * default for every suite while `jest.config.mjs` claimed 30 s. Real database
 * round trips, advisory-lock waits (20 concurrent creates queue on one key
 * sequence) and a cold Prisma client through PgBouncer need longer in CI.
 * `jest.setTimeout` in a `setupFilesAfterEnv` file does apply per project.
 * `tests/unit/jest-config-timeouts.test.ts` holds both halves.
 */
jest.setTimeout(30_000);
