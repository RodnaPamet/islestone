/**
 * The perf project's per-test timeout: a plan check runs its queries under
 * EXPLAIN ANALYZE, and a statement budget repeats its scenario. Set here, not
 * as `testTimeout`, which Jest ignores inside a project
 * (`tests/unit/jest-config-timeouts.test.ts`).
 */
jest.setTimeout(120_000);
