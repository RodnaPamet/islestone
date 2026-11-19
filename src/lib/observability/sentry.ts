/**
 * Sentry error reporting — a STUB at the final module path.
 *
 * inflect-compliance's `src/lib/observability/sentry.ts`
 * (5528464fc54a8681956f3b9ce23ca9c075f0420e) wraps `@sentry/nextjs`. That SDK
 * cannot be installed yet: every Sentry SDK at 11.12.0 (`@sentry/nextjs` and
 * `@sentry/node` alike) depends on `@sentry/bundler-plugins`, which depends on
 * the `sentry` package, licensed FSL-1.1-Apache-2.0, which is not on the
 * licence allowlist (`scripts/licence-gate.mjs`). Allowing it, exempting it,
 * or choosing another error tracker is an owner decision (ADR 0007).
 *
 * Until then every function keeps the source's signature and does nothing,
 * so the barrel, `job-runner.ts` and the shutdown handler call it unchanged
 * and the real module replaces this file without touching a caller. Errors
 * still reach the structured logger at their call sites; only the Sentry
 * copy is missing. `captureError` returns `undefined` (no event id), which is
 * what the source returns when Sentry is not configured.
 */

/** No-op: there is no SDK to initialise. */
export function initSentry(): void {}

/** Always false: no Sentry client exists in this build. */
export function isSentryInitialized(): boolean {
    return false;
}

/** No-op; resolves at once. */
export async function shutdownSentry(_timeoutMs = 2_000): Promise<void> {}

/** Always false: nothing was buffered, so nothing can be confirmed delivered. */
export async function flushSentry(_timeoutMs = 2_000): Promise<boolean> {
    return false;
}

/** No-op; returns no event id. */
export function captureError(
    _error: unknown,
    _extra?: {
        requestId?: string;
        route?: string;
        method?: string;
        status?: number;
        tenantId?: string;
        userId?: string;
        errorCode?: string;
    },
): string | undefined {
    return undefined;
}

/** No-op. */
export function setSentryContext(_ctx: {
    requestId: string;
    tenantId?: string;
    userId?: string;
    route?: string;
}): void {}

/** @internal Kept for the source's test helpers; nothing to reset. */
export function _resetForTesting(): void {}
