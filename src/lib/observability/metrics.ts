/**
 * Observability metrics — OpenTelemetry counters, histograms and gauges.
 *
 * Copied in part from inflect-compliance `src/lib/observability/metrics.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e. Sub-phase 1.5 holds the
 * ranges its own code records (docs/porting/maps/1.5.md, "Handoff to 1.6"):
 *
 * ── REQUEST METRICS ── (`withApiErrorHandling`)
 *   api.request.count      — Counter   (method, route, status)
 *   api.request.duration   — Histogram (method, route, status) [ms]
 *   api.request.errors     — Counter   (method, route, errorCode)
 *
 * ── AUDIT-STREAM METRICS ── (`src/app-layer/events/audit-stream.ts`)
 *   audit_stream.delivery.success  — Counter   (http.status_code)
 *   audit_stream.delivery.failures — Counter   (http.status_code)
 *   audit_stream.delivery.attempts — Histogram (outcome)
 *   audit_stream.delivery.duration — Histogram (outcome) [ms]
 *   audit_stream.buffer.overflow_dropped — Counter
 *   audit_stream.buffer.depth      — Observable Gauge
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
 * Sub-phase 1.6 APPENDS the rest of the source module (repository, job and
 * queue metrics, the session-policy and verification-email counters, which
 * are no-ops below until then) and must not overwrite these ranges.
 *
 * CARDINALITY SAFETY: route labels are normalised by `normalizeRoute()`.
 * Note for 2.x: it collapses UUIDs and cuids, not `ISL-123` work-item keys.
 *
 * LAZY INITIALISATION: every instrument is created on first use. Until 1.6
 * registers a MeterProvider, the OpenTelemetry API's no-op meter makes each
 * record a no-op.
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
 *   /api/t/acme-corp/controls/550e8400-e29b-41d4-a716-446655440000
 *     → /api/t/:tenantSlug/controls/:id
 *
 *   /api/t/my-tenant/evidence/abc123def456
 *     → /api/t/:tenantSlug/evidence/abc123def456  (short IDs kept — low cardinality)
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

// ── Sub-phase 1.4 counters, no-ops until 1.6 brings their instruments ──

/** Session-policy resolution outcome (session-tracker). No-op until 1.6. */
export function recordSessionPolicyResolution(_attrs: { outcome: 'ok' | 'failed' }): void {}

/** Verification-email delivery outcome (email-verification). No-op until 1.6. */
export function recordVerificationEmailDelivery(_attrs: {
    outcome: 'sent' | 'failed';
    flow: 'register' | 'resend';
}): void {}
