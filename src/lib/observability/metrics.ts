/**
 * Observability Metrics — OpenTelemetry counters, histograms, and gauges.
 *
 * Copied from inflect-compliance `src/lib/observability/metrics.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e. Sub-phase 1.5 brought the request,
 * audit-stream and data-layer security ranges; sub-phase 1.6 adds the rest
 * that Islestone records today (repository, aggregation-cache, job, queue,
 * session-policy, verification-email, SCIM, slow-query and SSR-cache metrics)
 * and the two job-queue counters inflect kept in `integration-metrics.ts`.
 * The Entra group and role-sync families wait for sub-phase 8.3, the AI and
 * agent families for Phase 6.
 *
 * ── REQUEST METRICS ──
 *   api.request.count      — Counter   (method, route, status)
 *   api.request.duration   — Histogram (method, route, status) [ms]
 *   api.request.errors     — Counter   (method, route, errorCode)
 *
 * ── REPOSITORY METRICS (Epic OI-3) ──
 *   repo.method.duration     — Histogram (repo.method, outcome) [ms]
 *   repo.method.calls        — Counter   (repo.method, outcome)
 *   repo.method.errors       — Counter   (repo.method, error.type)
 *   repo.method.result_count — Histogram (repo.method)
 *
 *   tenant_id is intentionally NOT a metric label (would explode
 *   cardinality on multi-tenant deployments). It IS recorded as a
 *   span attribute (`repo.tenant_id`) so trace search can still
 *   pivot per-tenant.
 *
 * ── JOB METRICS ──
 *   job.execution.count    — Counter   (job_name, status: success|failure)
 *   job.execution.duration — Histogram (job_name, status) [ms]
 *   job.queue.depth        — Observable Gauge (queue.name, queue.state)
 *   job.queue.retry_bypassed — Counter (job_name, reason)
 *   job.fanout.enqueue_failed — Counter (component)
 *
 * ── AUDIT-STREAM METRICS ── (`src/app-layer/events/audit-stream.ts`)
 *   audit_stream.delivery.success  — Counter   (http.status_code)
 *   audit_stream.delivery.failures — Counter   (http.status_code)
 *   audit_stream.delivery.attempts — Histogram (outcome)
 *   audit_stream.delivery.duration — Histogram (outcome) [ms]
 *   audit_stream.buffer.overflow_dropped — Counter
 *   audit_stream.buffer.depth      — Observable Gauge
 *     One delivery-outcome record per batch (after the retry loop).
 *     Audit-stream failures deliberately do NOT gate /api/readyz: the path
 *     is out-of-band and fail-safe (the audit row is already committed);
 *     escalation is alert-based on these metrics.
 *
 * ── DATA-LAYER SECURITY METRICS ──
 *   tenant_context.mismatch — Counter (the encryption extension's write
 *                             tripwire)
 *   encryption.field_decrypt_failures — Counter (model, field, version,
 *                             outcome)
 *
 * ── AUTH METRICS ──
 *   auth.session_policy.resolution — Counter (outcome)
 *   auth.verification_email.sent   — Counter (outcome)
 *   auth.verification_email.failed — Counter (outcome)
 *     `issueEmailVerification` swallows mailer errors so the register
 *     API stays 200 (enumeration safety). These metrics surface the
 *     failure rate before a user-facing outage. `outcome` is
 *     `register | resend`.
 *   scim.auth.count                — Counter (outcome, reason); SCIM is
 *     sub-phase 8.3, which is its first caller.
 *
 * CARDINALITY SAFETY:
 *   Route labels are normalized via `normalizeRoute()` to collapse dynamic
 *   segments (UUIDs, slugs) into placeholder tokens. This prevents
 *   unbounded label growth from entity-specific URLs. Note for 2.x: it
 *   collapses UUIDs and cuids, not `ISL-123` work-item keys.
 *
 * LAZY INITIALIZATION:
 *   All instruments are created on first access to give the global
 *   MeterProvider time to register. When OTel is not initialized,
 *   the noop meter produces zero-overhead noop instruments.
 *
 * These are recorded from:
 *   - `withApiErrorHandling` (request metrics)
 *   - `runJob` / `executorRegistry.execute` (job metrics)
 *   - `startQueueDepthReporting` (queue depth gauge)
 */

import { metrics } from '@opentelemetry/api';
import { bindObservable } from './observable-registry';

const METER_NAME = 'islestone';

function getMeter() {
    return metrics.getMeter(METER_NAME);
}

// ════════════════════════════════════════════════════════════════════════
// ROUTE NORMALIZATION — Cardinality Safety
// ════════════════════════════════════════════════════════════════════════

/**
 * UUID v4 pattern — matches standard 36-char UUIDs.
 * Used to collapse entity IDs in URL paths.
 */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * CUID / nanoid / opaque-id pattern — matches 20+ char alphanumeric segments.
 * Guards against non-UUID ID formats that would still cause cardinality explosion.
 */
const OPAQUE_ID_RE = /\/[a-z0-9]{20,}\b/gi;

/**
 * Normalize a raw request pathname to a route template safe for metric labels.
 *
 * Collapses:
 *   - UUIDs → :id
 *   - Tenant slugs in /t/[slug]/ → :tenantSlug
 *   - Long opaque IDs → :id
 *
 * Examples:
 *   /api/t/acme-corp/work-items/550e8400-e29b-41d4-a716-446655440000
 *     → /api/t/:tenantSlug/work-items/:id
 *
 *   /api/t/my-tenant/members/abc123def456
 *     → /api/t/:tenantSlug/members/abc123def456  (short IDs kept — low cardinality)
 *
 * @param pathname — raw URL pathname from req.nextUrl.pathname
 * @returns normalized route string, safe for OTel labels
 */
export function normalizeRoute(pathname: string): string {
    let route = pathname;

    // 1. Replace UUIDs with :id
    route = route.replace(UUID_RE, ':id');

    // 2. Replace tenant slug in /t/<slug>/ or /api/t/<slug>/
    //    Next.js dynamic segment: /t/[tenantSlug]/...
    route = route.replace(/\/t\/([^/]+)\//, '/t/:tenantSlug/');

    // 3. Replace remaining long opaque IDs
    route = route.replace(OPAQUE_ID_RE, '/:id');

    return route;
}

// ════════════════════════════════════════════════════════════════════════
// REQUEST METRICS — Instrument Singletons
// ════════════════════════════════════════════════════════════════════════

let _requestCount: ReturnType<ReturnType<typeof getMeter>['createCounter']> | null = null;
let _requestDuration: ReturnType<ReturnType<typeof getMeter>['createHistogram']> | null = null;
let _requestErrors: ReturnType<ReturnType<typeof getMeter>['createCounter']> | null = null;

// Repository instruments — Epic OI-3.
// Cardinality safety: labels are { 'repo.method', 'outcome' } only.
// tenant_id, user_id are SPAN attributes (queryable in trace search)
// but NOT metric labels (where they'd explode cardinality).
let _repoDuration: ReturnType<ReturnType<typeof getMeter>['createHistogram']> | null = null;
let _repoCalls: ReturnType<ReturnType<typeof getMeter>['createCounter']> | null = null;
let _repoErrors: ReturnType<ReturnType<typeof getMeter>['createCounter']> | null = null;
let _repoResultCount: ReturnType<ReturnType<typeof getMeter>['createHistogram']> | null = null;

function getRequestCount() {
    if (!_requestCount) {
        _requestCount = getMeter().createCounter('api.request.count', {
            description: 'Total number of API requests',
            unit: '1',
        });
    }
    return _requestCount;
}

function getRequestDuration() {
    if (!_requestDuration) {
        _requestDuration = getMeter().createHistogram('api.request.duration', {
            description: 'API request duration in milliseconds',
            unit: 'ms',
        });
    }
    return _requestDuration;
}

function getRequestErrors() {
    if (!_requestErrors) {
        _requestErrors = getMeter().createCounter('api.request.errors', {
            description: 'Total number of API request errors',
            unit: '1',
        });
    }
    return _requestErrors;
}

/**
 * Record a completed API request.
 *
 * Route is auto-normalized to prevent label cardinality explosion.
 * Called from `withApiErrorHandling` on every request completion.
 */
export function recordRequestMetrics(attrs: {
    method: string;
    route: string;
    status: number;
    durationMs: number;
}): void {
    const normalizedRoute = normalizeRoute(attrs.route);

    const labels = {
        'http.method': attrs.method,
        'http.route': normalizedRoute,
        'http.status_code': attrs.status,
    };

    getRequestCount().add(1, labels);
    getRequestDuration().record(attrs.durationMs, labels);
}

/**
 * Record an API request error.
 *
 * Route is auto-normalized.
 */
export function recordRequestError(attrs: {
    method: string;
    route: string;
    errorCode: string;
}): void {
    getRequestErrors().add(1, {
        'http.method': attrs.method,
        'http.route': normalizeRoute(attrs.route),
        'error.code': attrs.errorCode,
    });
}

// ════════════════════════════════════════════════════════════════════════
// AGGREGATION CACHE METRICS
//
// Emitted by src/lib/cache/aggregation-cache.ts::cachedAggregationRead.
// The only label is `aggregation` (the registry key) — bounded
// cardinality (one value per AGGREGATIONS entry). Watch the hit ratio
// per aggregation in Grafana: a sustained low hit rate means the
// invalidation graph is over-eager or the TTL is too short.
// ════════════════════════════════════════════════════════════════════════

let _aggCacheHit: ReturnType<ReturnType<typeof getMeter>['createCounter']> | null = null;
let _aggCacheMiss: ReturnType<ReturnType<typeof getMeter>['createCounter']> | null = null;
let _aggCacheComputeDuration: ReturnType<ReturnType<typeof getMeter>['createHistogram']> | null = null;

function getAggCacheHit() {
    if (!_aggCacheHit) {
        _aggCacheHit = getMeter().createCounter('cache.aggregation.hit', {
            description: 'Aggregation cache hits',
            unit: '1',
        });
    }
    return _aggCacheHit;
}

function getAggCacheMiss() {
    if (!_aggCacheMiss) {
        _aggCacheMiss = getMeter().createCounter('cache.aggregation.miss', {
            description: 'Aggregation cache misses',
            unit: '1',
        });
    }
    return _aggCacheMiss;
}

function getAggCacheComputeDuration() {
    if (!_aggCacheComputeDuration) {
        _aggCacheComputeDuration = getMeter().createHistogram('cache.aggregation.compute_duration_ms', {
            description: 'Time to compute an aggregation on a cache miss',
            unit: 'ms',
        });
    }
    return _aggCacheComputeDuration;
}

/** Record an aggregation cache hit. */
export function recordAggregationCacheHit(aggregation: string): void {
    getAggCacheHit().add(1, { aggregation });
}

/** Record an aggregation cache miss + the time the underlying compute took. */
export function recordAggregationCacheMiss(aggregation: string, computeMs: number): void {
    getAggCacheMiss().add(1, { aggregation });
    getAggCacheComputeDuration().record(computeMs, { aggregation });
}

// ════════════════════════════════════════════════════════════════════════
// REPOSITORY METRICS — Epic OI-3
//
// Emitted by src/lib/observability/repository-tracing.ts::traceRepository.
// Labels are restricted to { 'repo.method', 'outcome' } to keep
// cardinality bounded. Use trace span attributes (tenant.id, user.id)
// for tenant-aware debugging — those don't explode metric storage.
// ════════════════════════════════════════════════════════════════════════

export function getRepositoryDurationHistogram() {
    if (!_repoDuration) {
        _repoDuration = getMeter().createHistogram('repo.method.duration', {
            description: 'Repository method execution duration in milliseconds',
            unit: 'ms',
        });
    }
    return _repoDuration;
}

export function getRepositoryCallCounter() {
    if (!_repoCalls) {
        _repoCalls = getMeter().createCounter('repo.method.calls', {
            description: 'Total number of repository method invocations',
            unit: '1',
        });
    }
    return _repoCalls;
}

export function getRepositoryErrorCounter() {
    if (!_repoErrors) {
        _repoErrors = getMeter().createCounter('repo.method.errors', {
            description: 'Total number of repository method errors',
            unit: '1',
        });
    }
    return _repoErrors;
}

export function getRepositoryResultCountHistogram() {
    if (!_repoResultCount) {
        _repoResultCount = getMeter().createHistogram('repo.method.result_count', {
            description: 'Distribution of result counts returned by repository methods',
            unit: '1',
        });
    }
    return _repoResultCount;
}

// ════════════════════════════════════════════════════════════════════════
// JOB METRICS — Instrument Singletons
// ════════════════════════════════════════════════════════════════════════

let _jobCount: ReturnType<ReturnType<typeof getMeter>['createCounter']> | null = null;
let _jobDuration: ReturnType<ReturnType<typeof getMeter>['createHistogram']> | null = null;

function getJobCount() {
    if (!_jobCount) {
        _jobCount = getMeter().createCounter('job.execution.count', {
            description: 'Total number of job executions',
            unit: '1',
        });
    }
    return _jobCount;
}

function getJobDuration() {
    if (!_jobDuration) {
        _jobDuration = getMeter().createHistogram('job.execution.duration', {
            description: 'Job execution duration in milliseconds',
            unit: 'ms',
        });
    }
    return _jobDuration;
}

/**
 * Record a completed job execution.
 *
 * @param attrs.jobName — the job name (bounded set from JobPayloadMap)
 * @param attrs.success — whether the job completed without error
 * @param attrs.durationMs — execution time in milliseconds
 */
export function recordJobMetrics(attrs: {
    jobName: string;
    success: boolean;
    durationMs: number;
}): void {
    const labels = {
        'job.name': attrs.jobName,
        'job.status': attrs.success ? 'success' : 'failure',
    };

    getJobCount().add(1, labels);
    getJobDuration().record(attrs.durationMs, labels);
}

// ════════════════════════════════════════════════════════════════════════
// AUDIT-STREAM METRICS — Instrument Singletons
//
// Delivery outcomes are recorded once per batch, after the retry loop in
// `deliverBatch` (src/app-layer/events/audit-stream.ts) settles. The set
// answers the operator questions:
//   - are batches landing?            success / failures counters
//   - what is the success ratio?      success / (success + failures)
//   - is the downstream flaky?        attempts histogram (1..3)
//   - how slow is delivery?           duration histogram [ms]
//   - is the buffer under pressure?   buffer.depth gauge + overflow counter
//
// Cardinality: only `http.status_code` (finite) and `outcome`
// (success|failure). tenantId is NEVER a label — tenant-level
// debugging uses the structured `logger.warn` in the same code path.
// ════════════════════════════════════════════════════════════════════════

let _auditStreamSuccess: ReturnType<ReturnType<typeof getMeter>['createCounter']> | null = null;
let _auditStreamFailures: ReturnType<ReturnType<typeof getMeter>['createCounter']> | null = null;
let _auditStreamAttempts: ReturnType<ReturnType<typeof getMeter>['createHistogram']> | null = null;
let _auditStreamDuration: ReturnType<ReturnType<typeof getMeter>['createHistogram']> | null = null;
let _auditStreamOverflow: ReturnType<ReturnType<typeof getMeter>['createCounter']> | null = null;

function getAuditStreamSuccess() {
    if (!_auditStreamSuccess) {
        _auditStreamSuccess = getMeter().createCounter('audit_stream.delivery.success', {
            description: 'Audit-stream batches delivered successfully (2xx on the final attempt)',
            unit: '1',
        });
    }
    return _auditStreamSuccess;
}

function getAuditStreamFailures() {
    if (!_auditStreamFailures) {
        _auditStreamFailures = getMeter().createCounter('audit_stream.delivery.failures', {
            description: 'Audit-stream batches whose final delivery attempt was not-ok (after retry)',
            unit: '1',
        });
    }
    return _auditStreamFailures;
}

function getAuditStreamAttempts() {
    if (!_auditStreamAttempts) {
        _auditStreamAttempts = getMeter().createHistogram('audit_stream.delivery.attempts', {
            description: 'Delivery attempts made per audit-stream batch (1 = no retry, up to 3)',
            unit: '1',
        });
    }
    return _auditStreamAttempts;
}

function getAuditStreamDuration() {
    if (!_auditStreamDuration) {
        _auditStreamDuration = getMeter().createHistogram('audit_stream.delivery.duration', {
            description: 'Wall-clock time to deliver an audit-stream batch, including retry backoff',
            unit: 'ms',
        });
    }
    return _auditStreamDuration;
}

function getAuditStreamOverflow() {
    if (!_auditStreamOverflow) {
        _auditStreamOverflow = getMeter().createCounter('audit_stream.buffer.overflow_dropped', {
            description: 'Audit-stream events dropped because a per-tenant buffer hit its hard cap',
            unit: '1',
        });
    }
    return _auditStreamOverflow;
}

/**
 * Record the outcome of an audit-stream batch delivery — called once
 * per batch by `deliverBatch` after the retry loop settles (NOT per
 * retry attempt).
 *
 * Emits, in one call:
 *   - `audit_stream.delivery.success` OR `.failures` (by outcome);
 *   - `audit_stream.delivery.attempts` (retry-pressure histogram);
 *   - `audit_stream.delivery.duration` (delivery latency).
 *
 * `status` is the final HTTP status (0 == network throw / timeout).
 * TenantId is deliberately NOT a label — tenant-level debugging
 * uses the structured `logger.warn` in the same code path.
 */
export function recordAuditStreamDelivery(attrs: {
    outcome: 'success' | 'failure';
    status: number;
    attempts: number;
    durationMs: number;
}): void {
    const statusLabel = { 'http.status_code': attrs.status };
    if (attrs.outcome === 'success') {
        getAuditStreamSuccess().add(1, statusLabel);
    } else {
        getAuditStreamFailures().add(1, statusLabel);
    }
    const outcomeLabel = { outcome: attrs.outcome };
    getAuditStreamAttempts().record(attrs.attempts, outcomeLabel);
    getAuditStreamDuration().record(attrs.durationMs, outcomeLabel);
}

/**
 * Record an audit-stream buffer overflow — one event dropped because
 * a per-tenant in-memory buffer hit `BUFFER_HARD_CAP`. A non-zero
 * rate here means the downstream SIEM is too slow to keep up with
 * audit volume and events are being shed.
 */
export function recordAuditStreamBufferOverflow(): void {
    getAuditStreamOverflow().add(1);
}

// ── Field decryption (Epic B) ─────────────────────────────────────────

let _fieldDecryptFailures: ReturnType<ReturnType<typeof getMeter>['createCounter']> | null = null;

function getFieldDecryptFailures() {
    if (!_fieldDecryptFailures) {
        _fieldDecryptFailures = getMeter().createCounter('encryption.field.decrypt_failed', {
            description:
                'Encrypted field values the middleware could not decrypt. Each one was handed to the caller as RAW CIPHERTEXT — see recordFieldDecryptFailure.',
            unit: '1',
        });
    }
    return _fieldDecryptFailures;
}

/**
 * Record a field the encryption middleware failed to decrypt.
 *
 * WHY THIS DESERVES A METRIC RATHER THAN JUST THE EXISTING WARN LINE: the
 * middleware fails OPEN. On a decrypt failure it logs and leaves the field
 * as the raw ciphertext, and the caller receives a string it cannot tell
 * from plaintext. So the blast radius is every downstream consumer of that
 * row — the UI renders a base64 blob, a PDF export embeds it, an audit-pack
 * share link publishes it, an SDK consumer reads it verbatim.
 *
 * A log line nobody is alerted on is not a control. This makes the failure
 * countable so it can be alerted on, and gives whoever decides the
 * fail-open/fail-closed question the evidence to decide it with.
 *
 * Labels are deliberately low-cardinality — model, field and envelope
 * version, never tenantId (that would blow up the series count and put a
 * tenant identifier in metrics).
 */
/**
 * A write whose row `tenantId` disagrees with the ambient tenant context.
 *
 * WHY THIS EXISTS AS ITS OWN SIGNAL
 * ---------------------------------
 * Field encryption keys off the AMBIENT tenant context, not off the row being
 * written. So a write that sets `tenantId: B` while the context says A
 * encrypts B's row under A's DEK — and nothing notices, because the write
 * succeeds. The damage surfaces much later, on an unrelated READ, as
 * `DecryptIntegrityError ... wrong key, corrupt row, or a write made under a
 * mismatched tenant context`. By then the offending write is long gone: the
 * read tells you which row is unreadable and nothing about who wrote it.
 *
 * That is what happened. E2E runs carry a steady 6-9 of those 500s, on green
 * runs as well as red, and the read-side error cannot name the writer. This
 * counter names it at the moment of the write, with the model, the operation
 * and BOTH tenant ids — which is the only place the information still exists.
 *
 * Two distinct outcomes, because they need opposite fixes:
 *
 *   `mismatch` — ambient tenant A, row tenant B. The row will be encrypted
 *     under the wrong DEK and become undecryptable. This is the corruption.
 *
 *   `unscoped` — no ambient tenant at all, but the row names one. The value
 *     is encrypted under the GLOBAL KEK (`v1:`) instead of the tenant's DEK.
 *     It stays readable, so it is not an outage — but it silently opts that
 *     row out of per-tenant key isolation, and a tenant-DEK rotation will not
 *     re-key it. Cross-tenant sweeps that write with the raw client land here
 *     (`automation-runner`'s all-tenants pass creates Findings this way).
 *
 * Deliberately observation-only for now, mirroring the posture this codebase
 * already took for `decrypt_failed`: make it countable, find the real call
 * sites, then decide whether to throw. Labels stay low-cardinality — no
 * tenant ids in metrics; those go to the log line instead.
 */
let _tenantContextMismatches: ReturnType<ReturnType<typeof getMeter>['createCounter']> | null = null;
function getTenantContextMismatches(): ReturnType<ReturnType<typeof getMeter>['createCounter']> {
    if (!_tenantContextMismatches) {
        _tenantContextMismatches = getMeter().createCounter('encryption.write.tenant_context_mismatch', {
            description:
                'Writes whose row tenantId disagrees with the ambient tenant context. `mismatch` corrupts (wrong DEK); `unscoped` silently downgrades the row to the global KEK.',
            unit: '1',
        });
    }
    return _tenantContextMismatches;
}

export function recordTenantContextMismatch(attrs: {
    model: string;
    operation: string;
    outcome: 'mismatch' | 'unscoped';
}): void {
    getTenantContextMismatches().add(1, {
        model: attrs.model,
        operation: attrs.operation,
        outcome: attrs.outcome,
    });
}

export function recordFieldDecryptFailure(attrs: {
    model: string;
    field: string;
    version: string;
    /**
     * WHICH of the three failure classes this was. They have opposite
     * correct responses, and before this label they were one undifferentiated
     * number — so a genuine key mismatch was invisible inside routine
     * no-DEK-by-design noise.
     *
     *   `no_dek_by_design` — the operation legitimately has no tenant DEK
     *     (the Tenant model itself, no ambient tenantId, or a BYPASS_SOURCES
     *     caller). Expected. The field is now handed back as NULL: the caller
     *     has no business reading plaintext, and a null surfaces a mistaken
     *     read immediately where a ciphertext blob hides it forever.
     *
     *   `dek_resolve_failed` — a tenantId WAS present but the DEK lookup
     *     threw. Not expected. Still fails open to ciphertext, because
     *     nulling a whole list page on a transient DB blip is its own
     *     outage. Watch this one.
     *
     *   `decrypt_failed` — a DEK resolved and AES-GCM still rejected the
     *     value: wrong key, corrupt row, or a write made under a mismatched
     *     tenant context. Also still fails open, pending the posture
     *     decision on whether it should throw.
     */
    outcome: 'no_dek_by_design' | 'dek_resolve_failed' | 'decrypt_failed';
}): void {
    getFieldDecryptFailures().add(1, {
        model: attrs.model,
        field: attrs.field,
        'ciphertext.version': attrs.version,
        outcome: attrs.outcome,
    });
}

// ── Session-policy resolution (Epic C.3) ──────────────────────────────

let _sessionPolicyResolution: ReturnType<ReturnType<typeof getMeter>['createCounter']> | undefined;

function getSessionPolicyResolution() {
    if (!_sessionPolicyResolution) {
        _sessionPolicyResolution = getMeter().createCounter('session.policy.resolution', {
            description:
                'Outcome of reading a tenant session policy at sign-in. `failed` means the ' +
                'concurrent-session cap and lifetime cap did NOT apply for that sign-in',
            unit: '1',
        });
    }
    return _sessionPolicyResolution;
}

/**
 * Record whether the tenant session policy could be resolved at sign-in.
 *
 * `outcome: 'failed'` is a SECURITY signal, not a availability one: the sign-in
 * still succeeds (the tracker is deliberately non-blocking), but it proceeds
 * with NO concurrent-session cap and NO lifetime cap. Any sustained non-zero
 * rate means a security control is silently not applying, which is exactly the
 * condition this counter exists to make alertable.
 */
export function recordSessionPolicyResolution(attrs: {
    outcome: 'ok' | 'failed';
}): void {
    getSessionPolicyResolution().add(1, { outcome: attrs.outcome });
}

// ── Auth verification-email delivery counters ─────────────────────────

let _verificationEmailSent: ReturnType<ReturnType<typeof getMeter>['createCounter']> | null = null;
let _verificationEmailFailed: ReturnType<ReturnType<typeof getMeter>['createCounter']> | null = null;

function getVerificationEmailSent() {
    if (!_verificationEmailSent) {
        _verificationEmailSent = getMeter().createCounter('auth.verification_email.sent', {
            description: 'Verification emails successfully handed off to the mailer',
            unit: '1',
        });
    }
    return _verificationEmailSent;
}

function getVerificationEmailFailed() {
    if (!_verificationEmailFailed) {
        _verificationEmailFailed = getMeter().createCounter('auth.verification_email.failed', {
            description: 'Verification emails that the mailer rejected (operator-only signal — the register API still returns 200)',
            unit: '1',
        });
    }
    return _verificationEmailFailed;
}

/**
 * Record the outcome of a single verification-email send attempt.
 * Called from `issueEmailVerification` after the `sendEmail` try/catch
 * settles.
 *
 * `flow` labels the call-site:
 *   - `register` — first email at signup
 *   - `resend`   — `/api/auth/verify-email/resend` re-issue
 *
 * No email or userId on the label (PII + cardinality). Per-tenant
 * debugging uses the structured pino warn line in the same code path.
 *
 * Failures here are best-effort signal — the token is already stored
 * and the API returns 200 regardless. Operators alert on
 * `auth.verification_email.failed` (rate or absolute) to catch a
 * mailer outage BEFORE `AUTH_REQUIRE_EMAIL_VERIFICATION=1` locks
 * legitimate signups out of verification.
 */
export function recordVerificationEmailDelivery(attrs: {
    outcome: 'sent' | 'failed';
    flow: 'register' | 'resend';
}): void {
    const labels = { flow: attrs.flow };
    if (attrs.outcome === 'sent') {
        getVerificationEmailSent().add(1, labels);
    } else {
        getVerificationEmailFailed().add(1, labels);
    }
}

// ── SCIM token-auth metrics (EI-4) ────────────────────────────────────

let _scimAuth: ReturnType<ReturnType<typeof getMeter>['createCounter']> | null = null;

function getScimAuth() {
    if (!_scimAuth) {
        _scimAuth = getMeter().createCounter('scim.auth.count', {
            description: 'SCIM bearer-token authentication attempts by outcome',
            unit: '1',
        });
    }
    return _scimAuth;
}

/**
 * Record one SCIM bearer-token authentication attempt — called from
 * `authenticateScimRequest` at every terminal branch.
 *
 * `reason` is a bounded enum (5 values) so cardinality stays flat:
 *   - `ok`             — authenticated.
 *   - `missing_header` — no / malformed `Authorization: Bearer` header.
 *   - `empty_token`    — `Bearer` with an empty value.
 *   - `not_found`      — token hash matched no row.
 *   - `revoked`        — token row exists but is revoked.
 *
 * A spike in `not_found` is the brute-force / stale-connector signal;
 * `revoked` rising means an IdP is still pushing with a rotated token.
 * No tenantId label (the failing cases have no resolved tenant anyway).
 */
export function recordScimAuth(attrs: {
    outcome: 'success' | 'failure';
    reason:
        | 'ok'
        | 'missing_header'
        | 'empty_token'
        | 'not_found'
        | 'revoked'
        /** The token is live but its tenant has been removed (#5184). */
        | 'tenant_deleted';
}): void {
    getScimAuth().add(1, { outcome: attrs.outcome, reason: attrs.reason });
}

let _auditStreamBufferGaugeStarted = false;

/**
 * Register the observable gauge `audit_stream.buffer.depth` — the
 * total number of audit events buffered across all per-tenant
 * buffers, read at metric-scrape time. A sustained high depth means
 * delivery is not keeping up with ingestion.
 *
 * Idempotent. Called once from `audit-stream.ts` on module init.
 *
 * @param getDepthFn — returns the current total buffered event count.
 */
export function startAuditStreamBufferReporting(getDepthFn: () => number): void {
    if (_auditStreamBufferGaugeStarted) return;
    _auditStreamBufferGaugeStarted = true;

    bindObservable(() => {
        const gauge = getMeter().createObservableGauge('audit_stream.buffer.depth', {
            description: 'Total audit events buffered across all per-tenant audit-stream buffers',
            unit: '1',
        });
        gauge.addCallback((result) => {
            try {
                result.observe(getDepthFn());
            } catch {
                // Buffer not available — noop; the gauge simply won't report.
            }
        });
    });
}

/** Reset the buffer-gauge flag (testing only). @internal */
export function _resetAuditStreamBufferGaugeForTesting(): void {
    _auditStreamBufferGaugeStarted = false;
}

// ════════════════════════════════════════════════════════════════════════
// QUEUE DEPTH GAUGE — Observable
//
// Registered by the BullMQ worker (`scripts/worker.ts`), the only
// long-running process that holds the queue. Its exported series is
// `job_queue_depth_ratio{queue_name, queue_state}`: the exporter adds
// `_ratio` to a gauge whose unit is `1`.
// ════════════════════════════════════════════════════════════════════════

/**
 * The BullMQ states the gauge reports, and the only ones it asks Redis for.
 *
 * `waiting` and `prioritized` together are the BACKLOG: jobs ready to run
 * that no worker has taken. BullMQ keeps a job enqueued with a `priority` in
 * `prioritized`, not `waiting`, so a backlog read from `waiting` alone misses
 * it. `delayed` is not backlog: it holds the next run of every job scheduler
 * and every retry's backoff, so it never drops below the number of schedules.
 * `active` is work in progress and `failed` is retained history. Anything
 * else BullMQ counts (`completed`, `waiting-children`) is left out.
 */
const QUEUE_DEPTH_STATES = ['waiting', 'prioritized', 'active', 'delayed', 'failed'] as const;
type QueueDepthState = (typeof QUEUE_DEPTH_STATES)[number];

/**
 * How long one read of the queue's counts may take. The metric reader waits
 * for every gauge callback before it exports, so a read that hangs on a
 * Redis outage would hold back every other metric of that export with it.
 */
export const QUEUE_DEPTH_READ_TIMEOUT_MS = 5_000;

/** What the gauge reads. A BullMQ `Queue` is one. */
export interface QueueDepthSource {
    /** Becomes the `queue.name` label, so the label names the queue that was read. */
    readonly name: string;
    getJobCounts(...states: QueueDepthState[]): Promise<Record<string, number>>;
}

/** The queue the gauge reads; `null` while reporting is stopped. */
let _queueDepthSource: (() => QueueDepthSource) | null = null;
/** The gauge is created once per process; stop/start only swaps its source. */
let _queueDepthGaugeRegistered = false;

function rejectAfter(ms: number): { promise: Promise<never>; cancel: () => void } {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const promise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`queue depth read timed out after ${ms}ms`)), ms);
        // Never the reason the process stays alive.
        timer.unref?.();
    });
    return { promise, cancel: () => clearTimeout(timer) };
}

/**
 * Report the depth of a BullMQ queue, by state, on the `job.queue.depth`
 * observable gauge.
 *
 * The callback runs when the metric reader collects: every export interval
 * (30s, `instrumentation.ts`) and once more on the meter provider's shutdown
 * flush. Each run is one `getJobCounts` round trip, bounded by
 * `QUEUE_DEPTH_READ_TIMEOUT_MS`. A read that fails or times out observes
 * nothing rather than failing the export. The SDK's storage is cumulative,
 * so an unobserved state is exported again at the last value it was read
 * at: the series holds its last reading, it does not disappear.
 *
 * Registered through `bindObservable`, so a call made before `initTelemetry()`
 * is moved onto the real meter provider when telemetry starts (see
 * `observable-registry.ts`). The worker still calls it after, because it reads
 * the worker's Redis connection, which exists only from `bootstrap()` on.
 *
 * Idempotent: a second call while reporting is a no-op. `getQueueFn` is not
 * called here, only at collection.
 *
 * @param getQueueFn — returns the queue to read, e.g. a BullMQ `Queue`
 */
export function startQueueDepthReporting(getQueueFn: () => QueueDepthSource): void {
    if (_queueDepthSource) return;
    _queueDepthSource = getQueueFn;
    if (_queueDepthGaugeRegistered) return;
    _queueDepthGaugeRegistered = true;

    bindObservable(() => {
        const gauge = getMeter().createObservableGauge('job.queue.depth', {
            description: 'Number of jobs in the queue by state',
            unit: '1',
        });

        gauge.addCallback(async (result) => {
            const getQueue = _queueDepthSource;
            if (!getQueue) return; // stopped: read nothing
            const timeout = rejectAfter(QUEUE_DEPTH_READ_TIMEOUT_MS);
            try {
                const queue = getQueue();
                const counts = await Promise.race([
                    queue.getJobCounts(...QUEUE_DEPTH_STATES),
                    timeout.promise,
                ]);

                for (const state of QUEUE_DEPTH_STATES) {
                    if (counts[state] !== undefined) {
                        result.observe(counts[state], {
                            'queue.name': queue.name,
                            'queue.state': state,
                        });
                    }
                }
            } catch {
                // Queue unavailable, or the read timed out: observe nothing this
                // time. The export goes ahead with the last values read.
            } finally {
                timeout.cancel();
            }
        });
    });
}

/**
 * Stop reading the queue. After this returns the gauge's callback reads
 * nothing, so the caller may close the queue and its Redis connection. Call
 * it on shutdown BEFORE closing them: the meter provider's shutdown flush
 * runs the callback once more. That flush still exports the last values
 * read, from the SDK's memory, not from Redis.
 *
 * The gauge itself stays registered (OTel offers no way to delete an
 * instrument), and observes nothing until `startQueueDepthReporting` is
 * called again.
 */
export function stopQueueDepthReporting(): void {
    _queueDepthSource = null;
}

/**
 * Reset queue depth reporting (for testing only).
 * @internal
 */
export function _resetQueueDepthForTesting(): void {
    _queueDepthSource = null;
    _queueDepthGaugeRegistered = false;
}

// ════════════════════════════════════════════════════════════════════════
// SLOW-QUERY COUNTER
//
// Emitted by src/lib/prisma.ts's query-event listener when a query
// exceeds the slow threshold (50ms). Label is { model } only — the raw
// SQL + bound params go to the internal log, NEVER to a metric label.
// ════════════════════════════════════════════════════════════════════════

let _slowQueryCount: ReturnType<ReturnType<typeof getMeter>['createCounter']> | null = null;

function getSlowQueryCount() {
    if (!_slowQueryCount) {
        _slowQueryCount = getMeter().createCounter('db.slow_query.count', {
            description: 'Queries exceeding the slow-query threshold',
            unit: '1',
        });
    }
    return _slowQueryCount;
}

/** Record a slow query, labelled by the parsed model name. */
export function recordSlowQuery(model: string): void {
    getSlowQueryCount().add(1, { model });
}

// ════════════════════════════════════════════════════════════════════════
// SSR PAYLOAD CACHE METRICS
//
// Emitted by src/lib/cache/ssr-cache.ts::cachedSsrPayload. Label is
// `route` (the canonical route name — bounded: dashboard, risks, …) plus
// `outcome` on the duration histogram. Watch the per-route hit ratio in
// Grafana; a low ratio means the tenant-wide invalidation is too eager or
// the TTL is too short.
// ════════════════════════════════════════════════════════════════════════

let _ssrHit: ReturnType<ReturnType<typeof getMeter>['createCounter']> | null = null;
let _ssrMiss: ReturnType<ReturnType<typeof getMeter>['createCounter']> | null = null;
let _ssrDuration: ReturnType<ReturnType<typeof getMeter>['createHistogram']> | null = null;

function getSsrHit() {
    if (!_ssrHit) _ssrHit = getMeter().createCounter('cache.ssr.hit', { description: 'SSR payload cache hits', unit: '1' });
    return _ssrHit;
}
function getSsrMiss() {
    if (!_ssrMiss) _ssrMiss = getMeter().createCounter('cache.ssr.miss', { description: 'SSR payload cache misses', unit: '1' });
    return _ssrMiss;
}
function getSsrDuration() {
    if (!_ssrDuration) _ssrDuration = getMeter().createHistogram('cache.ssr.duration', { description: 'SSR payload fetch duration (hit = cache read, miss = compute)', unit: 'ms' });
    return _ssrDuration;
}

/** Record an SSR payload cache hit. */
export function recordSsrCacheHit(route: string, durationMs: number): void {
    getSsrHit().add(1, { route });
    getSsrDuration().record(durationMs, { route, outcome: 'hit' });
}

/** Record an SSR payload cache miss + the time the underlying compute took. */
export function recordSsrCacheMiss(route: string, durationMs: number): void {
    getSsrMiss().add(1, { route });
    getSsrDuration().record(durationMs, { route, outcome: 'miss' });
}


// ════════════════════════════════════════════════════════════════════════
// JOB-QUEUE COUNTERS
//
// Moved from inflect-compliance's `integration-metrics.ts` (where they were
// `integration.queue.retry_bypassed` and `integration.dispatch.enqueue_failed`):
// they describe the job queue, not an integration, and Islestone has no
// integrations yet. Nothing in Islestone reads the old names.
// ════════════════════════════════════════════════════════════════════════

let _queueRetryBypass: ReturnType<ReturnType<typeof getMeter>['createCounter']> | null = null;
let _dispatchEnqueueFailed: ReturnType<ReturnType<typeof getMeter>['createCounter']> | null = null;

/**
 * A job failure was flagged `noRetry`, so BullMQ did not immediately re-run it.
 *
 * Worth counting separately from the failure itself: this is the difference
 * between "a job failed" and "a job failed AND we deliberately declined to
 * retry it", and the second needs its own eye — a bug in the classifier shows
 * up here as a suppression rate that does not match the failure mix. The
 * reason is the thrown `NonRetryableJobError`'s own (`src/app-layer/jobs/non-retryable.ts`).
 */
export function recordQueueRetryBypass(attrs: { jobName: string; reason: 'terminal' | 'rate_limited' }): void {
    if (!_queueRetryBypass) {
        _queueRetryBypass = getMeter().createCounter('job.queue.retry_bypassed', {
            description: 'Job failures where the queue retry was deliberately suppressed',
            unit: '1',
        });
    }
    _queueRetryBypass.add(1, { job_name: attrs.jobName, reason: attrs.reason });
}

/**
 * A fan-out enqueue threw and was skipped.
 *
 * The dispatcher continues past these instead of aborting, which is right —
 * but it means the loss is silent unless it is counted. Any non-zero rate is
 * units of work that did not get their job this cycle.
 */
export function recordDispatchEnqueueFailed(attrs: { component: string }): void {
    if (!_dispatchEnqueueFailed) {
        _dispatchEnqueueFailed = getMeter().createCounter('job.fanout.enqueue_failed', {
            description: 'Fan-out enqueues that threw and were skipped (unit not processed this cycle)',
            unit: '1',
        });
    }
    _dispatchEnqueueFailed.add(1, { component: attrs.component });
}
