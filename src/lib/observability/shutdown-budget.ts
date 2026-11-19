/**
 * Per-stage shutdown budgets. Each stage is Promise.race'd against
 * its budget so a slow exporter never blocks the process past the
 * container's grace period (k8s terminationGracePeriodSeconds
 * defaults to 30s).
 *
 * Budget invariant: SHUTDOWN_TOTAL_CEILING_MS should leave room for
 * Next.js's own HTTP-drain handler, which runs in parallel.
 *
 * Copied from inflect-compliance `src/lib/observability/shutdown-budget.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, without `SHUTDOWN_PAUSE_RUNS_MS`
 * (sub-phase 6.1 re-adds it with its stage).
 */

export const SHUTDOWN_AUDIT_FLUSH_MS = 3_000;
export const SHUTDOWN_OTEL_MS        = 2_000;
export const SHUTDOWN_SENTRY_MS      = 2_000;

/** Ceiling our observability stages must fit under. Rest of the
 * k8s grace period (default 30s) belongs to Next's HTTP drain. */
export const SHUTDOWN_TOTAL_CEILING_MS = 20_000;

/**
 * The stages, summed — 3 + 2 + 2 = 7s against a 20s ceiling. Sub-phase 6.1
 * adds the agent-run pause stage (2s) back.
 *
 * Declared rather than left implicit so a fifth stage cannot be added without
 * meeting the invariant; `tests/guards/shutdown-budget-sanity.test.ts` and the
 * shutdown tests assert it stays under the ceiling.
 */
export const SHUTDOWN_STAGES_TOTAL_MS =
    SHUTDOWN_AUDIT_FLUSH_MS + SHUTDOWN_OTEL_MS + SHUTDOWN_SENTRY_MS;
