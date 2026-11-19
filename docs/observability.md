# Observability

Sub-phase 1.6. Logs, traces and metrics for the web process and the worker,
through one barrel, `@/lib/observability`.

Copied and edited from inflect-compliance's `src/lib/observability/` at
`5528464fc54a8681956f3b9ce23ca9c075f0420e` and its `docs/observability/`
pages (`PROVENANCE.md`, "Copied: jobs, notifications and observability").

## Logs

`logger` (pino) from `@/lib/observability/logger`, or `log(level, message,
fields)` from the barrel. The request context (request id, workspace, user,
route) is read from AsyncLocalStorage inside the logger, never passed in.
`console` is a lint error in `src/`. The worker, scheduler and healthcheck
log through `createProcessLogger` (`process-logger.ts`), whose every line
carries a `requestId` too.

## Traces

OpenTelemetry, started by `initTelemetry()` (`instrumentation.ts`) from
`src/instrumentation-node.ts` in the web process and from `bootstrap()` in the
worker. It is a no-op unless `OTEL_ENABLED=true`.

| Variable | Default | What |
|---|---|---|
| `OTEL_ENABLED` | unset (off) | Start the SDK. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | The OTLP/HTTP collector for traces and metrics. |
| `OTEL_SERVICE_NAME` | `islestone` | The `service.name` resource attribute. |
| `OTEL_DEBUG` | unset | Log the SDK's own diagnostics. |

- `traceUsecase(name, ctx, fn)` and `traceOperation(name, attrs, fn)` wrap a
  usecase or any operation in a span; a repository method gets one through
  `repository-tracing.ts`.
- **Jobs are traced end to end.** `enqueue` writes the caller's trace context
  into the payload (`OTEL_CARRIER_KEY`); the worker reads it back and runs
  the job in an `execute <jobName>` span linked to the `enqueue` span
  (`job-trace.ts`), and `runJob` (`job-runner.ts`) opens the job's own
  AsyncLocalStorage context (`route: job:<name>`) and span.
  `tests/guards/job-trace-propagation.test.ts` holds the wiring.
- **Job payloads are logged by shape**, not value (`job-payload-log.ts`): a
  payload can carry an address or an id that must not reach a log line.

## Metrics

OpenTelemetry metrics through the same SDK, exported over OTLP. Without the
SDK the API calls are no-ops; an observable gauge registered before the SDK
starts is re-bound to the real meter when it does (`observable-registry.ts`;
the lint rule `local/observable-gauge-rebinds` refuses a gauge created any
other way).

| Area | Instruments (`metrics.ts`) |
|---|---|
| HTTP | `api.request.count`, `api.request.duration`, `api.request.errors`, by normalised route |
| Jobs | `job.execution.count` and `.duration` by job and status, `job.queue.depth` (read by the worker), `job.queue.retry_bypassed`, `job.fanout.enqueue_failed` |
| Data | slow queries, aggregation and SSR cache hits, field-decrypt failures, workspace-context mismatches |
| Auth | session-policy resolution, verification-email delivery, SCIM authentication |
| Audit stream | delivery outcomes and attempts, buffer overflow and depth |

### Business KPIs

`business-metrics.ts` holds fifteen product counters and gauges, one owner
each, so a dashboard reads one name: `business.tenant.created` / `.deleted`,
`business.user.signup`, `business.invite.sent` / `.redeemed`,
`business.user.mfa.enrolled`, the onboarding steps, plan changes and limits,
`business.automation.rule.created`, and the daily and monthly active-user
gauges (distinct users with an audited action, by plan). Wired today: workspace creation and sign-up
(`/api/auth/register`), invites sent and redeemed, and MFA enrolment. The
rest are wired by the sub-phase that builds their surface (onboarding 1.7,
automations 5.1, billing and the active-user aggregator 8.1).
`tests/guards/business-metrics-coverage.test.ts` holds each name to one
definition and one recorder. Attributes never carry a person's identity.

### Web vitals

`WebVitalsReporter` (`src/components/observability/`) sends each Core Web
Vital to `POST /api/telemetry/vitals` with `navigator.sendBeacon`; the route
records it as a histogram by route template (`vital-route.ts`), never by the
raw path, which can carry an id. The middleware logs one line per document
load and soft navigation, the denominator the vitals are read against. The
reporter is mounted by the app shell in 1.7. The beacon path is a machine
caller (`MACHINE_CALLER_PREFIXES` in `src/lib/auth/guard.ts`): it carries no
session and authenticates nothing.

## Errors (Sentry)

Not installed. `@sentry/nextjs` and `@sentry/node` depend on `sentry`,
licensed FSL-1.1-Apache-2.0, which is not on the licence allowlist; allowing
it is an owner decision (ADR 0007). `src/lib/observability/sentry.ts` keeps
the module's exports (`initSentry`, `captureError`, `flushSentry`,
`shutdownSentry`, …) as no-ops, so callers and the shutdown stage are wired
and the SDK drops in behind them. Errors reach the logs meanwhile.

## Shutdown

`installShutdownHandlers()` (`shutdown.ts`), installed once per web process
from `src/instrumentation-node.ts`, handles SIGTERM and SIGINT in the order
of what is most costly to lose: the audit-stream buffers
(`flushAllAuditStreams`), then OpenTelemetry, then Sentry. Each stage has its
own budget (`shutdown-budget.ts`, seven seconds in all, under the twenty-second
ceiling the guard enforces), a throw in one never skips the next, and the
handler never calls `process.exit`: `next start` owns the process. A second
signal falls through to Node's default. The worker runs its own shutdown in
`scripts/worker.ts`.

## Startup

`src/instrumentation-node.ts`, in production, refuses to start without the
secrets it needs (the field-encryption key, the rate-limit store, an
authenticated `REDIS_URL`). Then, in every environment: telemetry, Sentry
(the stub), the mailer, the shutdown handlers, and the Redis eviction-policy
check. The RLS tripwire is not started here: Islestone composes it into the
Prisma client (`src/lib/prisma.ts`), so every process that loads the client
has it.
