/**
 * The shared route-handler wrapper: error shaping, request id, request
 * context, lifecycle logs, the OpenTelemetry root span, request metrics and
 * the mutation-tier rate limit.
 *
 * Copied from inflect-compliance `src/lib/errors/api.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e. Sub-phase 1.4 landed it without
 * the span and metrics; 1.5 restores them (the tracer and meter are the
 * OpenTelemetry API's no-ops until 1.6 registers the SDK). The Sentry
 * capture is not here: 1.6 brings Sentry and puts it back.
 */
import { SpanStatusCode } from '@opentelemetry/api';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { runWithRequestContext } from '@/lib/observability/context';
import { extractErrorMeta, logger } from '@/lib/observability/logger';
import { recordRequestError, recordRequestMetrics } from '@/lib/observability/metrics';
import { getTracer } from '@/lib/observability/tracing';
import type { RateLimitConfig } from '@/lib/security/rate-limit';
import type { RateLimitScope } from '@/lib/security/rate-limit-middleware';
import { API_MUTATION_LIMIT, enforceRateLimit, isRateLimitBypassed } from '@/lib/security/rate-limit-middleware';

import { toApiErrorResponse } from './types';
import { API_VERSION, API_VERSION_HEADER } from '@/lib/api-version';

// Depending on the Node.js / Edge runtime version, crypto.randomUUID() is natively available globally.
// If it fails (e.g. extremely old runtimes), fallback to a simple Math.random() based ID.
function generateRequestId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}



// ─── Rate-limit options for the shared wrapper ───────────────────────
//
// Mutation methods (POST/PUT/DELETE/PATCH) are rate-limited by default
// using API_MUTATION_LIMIT. Routes that need a stricter or looser
// policy pass an options object; routes that need to opt out entirely
// (webhook receivers, health checks — almost always already not using
// this wrapper anyway) pass `rateLimit: false`.

const MUTATION_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

export interface ApiWrapperOptions {
    /**
     * Rate-limit policy for this route.
     *   - omitted          → default API_MUTATION_LIMIT on mutation methods
     *   - `false`          → skip rate limiting entirely for this route
     *   - `{ ... }`        → custom config/scope/userId resolver
     */
    rateLimit?: false | {
        config?: RateLimitConfig;
        scope?: string;
        getUserId?: (
            req: NextRequest,
        ) => string | null | undefined | Promise<string | null | undefined>;
    };
}

async function resolveRateLimitScope(
    req: NextRequest,
    options: ApiWrapperOptions['rateLimit'],
): Promise<RateLimitScope | null> {
    if (options === false) return null;
    if (!MUTATION_METHODS.has(req.method)) return null;
    if (isRateLimitBypassed()) return null;

    const config = options?.config ?? API_MUTATION_LIMIT;
    const scope = options?.scope ?? 'api-mutation';
    let userId: string | null | undefined;
    if (options?.getUserId) {
        try {
            userId = await options.getUserId(req);
        } catch {
            userId = null;
        }
    }
    return { scope, config, userId: userId ?? null };
}

/**
 * Type-level transform — converts an inner handler's sync `params`
 * shape (`{ params: P }`) into Next 16's required `{ params: Promise<P> }`
 * for the route-level signature. Pass-through for handlers whose
 * Context already uses `Promise<P>` (idempotent), and pass-through
 * for Contexts without a `params` field at all (single-arg handlers).
 *
 * Why: Next 16 enforces `RouteHandlerConfig` where every dynamic
 * route handler is `(req, { params: Promise<{...}> })`. The 249
 * existing handlers in this codebase type `params` synchronously
 * because the runtime shim below resolves the Promise before
 * forwarding ctx. The type transform makes the OUTER wrapper
 * signature match Next's expectation without forcing every inner
 * handler to add `await params`.
 */
type AsyncifyParams<C> = C extends { params: infer P }
    ? Omit<C, 'params'> & {
          params: P extends Promise<unknown> ? P : Promise<P>;
      }
    : C;

/**
 * Dual-call signature for the wrapped handler — Next 16 invokes
 * route exports with `{ params: Promise<P> }`, while unit tests
 * invoke them directly with the sync `{ params: P }` shape. The
 * runtime shim accepts both (it awaits only when params is a
 * Promise), so the type surface should too.
 */
interface ApiRouteHandler<Context> {
    (
        req: NextRequest,
        ctx: AsyncifyParams<Context>,
    ): Promise<NextResponse | Response>;
    (
        req: NextRequest,
        ctx: Context,
    ): Promise<NextResponse | Response>;
}

/**
 * High-Order Wrapper for all app/api routes.
 *
 * Catch all throws (ZodError, AppError, primitive errors) and shapes them
 * into standardized ApiErrorResponse JSON payloads.
 *
 * Also provides:
 * - x-request-id for correlation tracking
 * - Observability request context (AsyncLocalStorage)
 * - Structured request lifecycle logs (start/end/error) via Pino
 * - OpenTelemetry root span (api.request) with HTTP attributes
 * - Request metrics (count, duration, errors)
 * - **Rate limiting (Epic A.2):** POST/PUT/DELETE/PATCH default to
 *   API_MUTATION_LIMIT. Pass `{ rateLimit: { config, scope } }` for
 *   stricter presets (LOGIN_LIMIT, API_KEY_CREATE_LIMIT), or
 *   `{ rateLimit: false }` to opt out.
 */
export function withApiErrorHandling<Context = unknown>(
    handler: (req: NextRequest, ctx: Context) => Promise<NextResponse | Response> | NextResponse | Response,
    options: ApiWrapperOptions = {},
): ApiRouteHandler<Context> {
    const impl = async (
        req: NextRequest,
        ctxIn: unknown,
    ): Promise<NextResponse | Response> => {
        // GAP-05 follow-up (Roadmap-6 P3): the transparent async-params
        // shim that once reified a Promise-shaped `ctx.params` to its
        // sync form was removed once every route handler migrated to
        // the Next 15 contract — each handler now types `params` as
        // `Promise<…>` and `await`s it itself. `withApiErrorHandling`
        // forwards `ctx` through untouched. (Unit tests that pass a
        // plain sync `params` object still work: a migrated handler's
        // `await params` resolves a non-thenable to itself.)
        const ctx = ctxIn as Context;
        const requestId = req.headers.get('x-request-id') || generateRequestId();
        const route = req.nextUrl.pathname;
        const method = req.method;
        const startTime = performance.now();

        // Run the entire request inside an observability context so that
        // any downstream code can access requestId/route via getRequestContext().
        // tenantId and userId are enriched later by getTenantCtx/getOrgCtx.
        return runWithRequestContext(
            { requestId, route, startTime },
            async () => {
                // ── OTel root span ──
                const tracer = getTracer();
                return tracer.startActiveSpan('api.request', async (span) => {
                    span.setAttributes({
                        'http.method': method,
                        'http.route': route,
                        'app.requestId': requestId,
                    });

                    // ── Request started ──
                    logger.info('request started', { component: 'api', method });

                    try {
                        // ── Rate-limit check (Epic A.2) ──
                        const rateScope = await resolveRateLimitScope(req, options.rateLimit);
                        if (rateScope) {
                            const { response: rateBlocked } = enforceRateLimit(
                                req,
                                rateScope,
                            );
                            if (rateBlocked) {
                                const durationMs = Math.round(
                                    performance.now() - startTime,
                                );
                                span.setAttributes({
                                    'http.status_code': 429,
                                    'rate_limit.scope': rateScope.scope,
                                });
                                span.setStatus({ code: SpanStatusCode.OK });
                                recordRequestMetrics({
                                    method,
                                    route,
                                    status: 429,
                                    durationMs,
                                });
                                logger.warn('request rate-limited', {
                                    component: 'api',
                                    method,
                                    scope: rateScope.scope,
                                    durationMs,
                                });
                                rateBlocked.headers.set('x-request-id', requestId);
                                rateBlocked.headers.set(API_VERSION_HEADER, API_VERSION);
                                return rateBlocked;
                            }
                        }

                        // Execute the original handler
                        const response = await handler(req, ctx);

                        const status = response.status;
                        const durationMs = Math.round(performance.now() - startTime);

                        // ── Span + metrics ──
                        span.setAttributes({ 'http.status_code': status });
                        span.setStatus({ code: SpanStatusCode.OK });
                        recordRequestMetrics({ method, route, status, durationMs });

                        // ── Request completed ──
                        logger.info('request completed', {
                            component: 'api',
                            method,
                            status,
                            durationMs,
                        });

                        // Apply request ID + API version header. Wrapped
                        // (canonical-contract) routes ALL emit X-API-Version;
                        // future breaking changes bump it in `src/lib/api-version.ts`.
                        if (response instanceof NextResponse) {
                            response.headers.set('x-request-id', requestId);
                            response.headers.set(API_VERSION_HEADER, API_VERSION);
                        } else if (response instanceof Response) {
                            // clone and append headers if plain standard Response
                            const newHeaders = new Headers(response.headers);
                            newHeaders.set('x-request-id', requestId);
                            newHeaders.set(API_VERSION_HEADER, API_VERSION);
                            return new Response(response.body, {
                                status: response.status,
                                statusText: response.statusText,
                                headers: newHeaders
                            });
                        }

                        return response;

                    } catch (error) {
                        // Unhandled throw! Map it.
                        const { payload, status } = toApiErrorResponse(error, requestId);
                        const durationMs = Math.round(performance.now() - startTime);

                        // ── Span error ──
                        span.setAttributes({ 'http.status_code': status });
                        span.setStatus({
                            code: SpanStatusCode.ERROR,
                            message: error instanceof Error ? error.message : String(error),
                        });
                        if (error instanceof Error) {
                            span.recordException(error);
                        }

                        // ── Metrics ──
                        recordRequestMetrics({ method, route, status, durationMs });
                        recordRequestError({ method, route, errorCode: payload.error.code });

                        // Sub-phase 1.6 adds the Sentry capture (5xx only) here.

                        // ── Request failed ──
                        // A 4xx is the API refusing a request it was right to
                        // refuse (bad input, no session, no permission, absent
                        // row), so it is a warning. Only a 5xx is the server
                        // failing, and only that is an error. Logging both as
                        // errors buried real 500s among routine refusals: on
                        // 2026-11-10, five of production's six error lines in a
                        // day were correct 401/403/404s. The request-error
                        // metric above still counts every failure, and a
                        // denial still writes its AUTHZ_DENIED audit row.
                        const logFailure = status >= 500 ? logger.error : logger.warn;
                        logFailure(`request failed ${status} ${method} ${route}`, {
                            component: 'api',
                            method,
                            status,
                            durationMs,
                            errorCode: payload.error.code,
                            error: extractErrorMeta(error),
                        });

                        return NextResponse.json(payload, {
                            status,
                            headers: {
                                'x-request-id': requestId,
                                [API_VERSION_HEADER]: API_VERSION,
                                'Cache-Control': 'no-store, max-age=0'
                            }
                        });
                    } finally {
                        span.end();
                    }
                });
            },
        );
    };
    return impl as ApiRouteHandler<Context>;
}

