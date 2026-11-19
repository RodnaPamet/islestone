/**
 * Unit Test: Epic B.3 admin key-rotation API route.
 *
 * Focus: route wiring, authz, and rate-limit preset. The actual
 * rotation logic is covered by `key-rotation-job.test.ts`; here we
 * just prove the endpoint:
 *
 *   - Requires ADMIN (rejected with 403 for non-admins).
 *   - Enqueues the 'key-rotation' job with payload carrying the
 *     caller's tenantId + userId.
 *   - Returns 202 + jobId on success.
 *   - Writes an audit entry at initiation time.
 *   - Applies the tighter API_KEY_CREATE_LIMIT rate-limit override
 *     (verified by the 6th call in a short window being 429'd).
 *   - GET returns job state; non-own-tenant jobs return 404.
 *   - POST route uses the withApiErrorHandling rate-limit option;
 *     verified by triggering the limit boundary.
 *
 * Copied from inflect-compliance `tests/unit/key-rotation-admin-api.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 1.5b). Contexts come
 * from `makeRequestContext` (Islestone's roles: VIEWER stands in for READER);
 * the audit barrel is a strict mock; `runInTenantContext` is stubbed, because
 * the usecase writes its audit entry inside one; the two cases about the
 * requesting API key's id are cut with API keys (5.2), and one case instead
 * pins that the payload carries exactly the three fields the job reads.
 */

import { strictMock } from '../helpers/strict-mock';

// Enable rate limits inside this test (withApiErrorHandling
// auto-bypasses in NODE_ENV=test otherwise).
const savedRateEnv = process.env.RATE_LIMIT_ENABLED;
beforeAll(() => {
    process.env.RATE_LIMIT_ENABLED = '1';
});
afterAll(() => {
    if (savedRateEnv === undefined) delete process.env.RATE_LIMIT_ENABLED;
    else process.env.RATE_LIMIT_ENABLED = savedRateEnv;
});

// ── Mocks ───────────────────────────────────────────────────────────

// `requirePermission('admin.manage', …)` resolves the context via
// `@/app-layer/context.getTenantCtx`. Mock at the resolver layer: returning a
// non-admin ctx triggers the 403 path.
const getTenantCtxMock = jest.fn<Promise<RequestContext>, [unknown, unknown]>();
jest.mock('@/app-layer/context', () => ({

    getTenantCtx: (params: unknown, req: unknown) =>
        getTenantCtxMock(params, req),
}));

// Stub the audit writer so the AUTHZ_DENIED row that
// `requirePermission` writes on denial doesn't try to hit the real DB
// during the denied-path tests.
jest.mock('@/lib/audit', () =>
    strictMock('@/lib/audit', jest.requireActual('@/lib/audit'), {
        // `permission-middleware` records AUTHZ_DENIED through
        // `appendAuditEntryOrQueue`, which falls back to a durable
        // AuditOutbox row instead of swallowing a failed write.
        appendAuditEntryOrQueue: jest.fn(async () => ({
            recorded: 'chain' as const,
            auditId: 'audit-x',
        })),
        appendAuditEntry: jest.fn(async () => ({
            id: 'audit-x',
            entryHash: 'hash-x',
            previousHash: null,
        })),
    }),
);

// The usecase writes its audit entry inside a tenant transaction.
jest.mock('@/lib/db-context', () => ({
    runInTenantContext: jest.fn(async (_ctx: unknown, fn: (db: unknown) => unknown) => fn({})),
}));

const enqueueMock = jest.fn<Promise<{ id?: string }>, [string, unknown]>();
const getQueueMock = jest.fn();
jest.mock('@/app-layer/jobs/queue', () => ({
    enqueue: (name: string, payload: unknown) => enqueueMock(name, payload),
    getQueue: () => getQueueMock(),
}));

const logEventMock = jest.fn<Promise<void>, [unknown, unknown, Record<string, unknown>]>(
    async () => undefined,
);
jest.mock('@/app-layer/events/audit', () => ({
    logEvent: (db: unknown, ctx: unknown, payload: Record<string, unknown>) =>
        logEventMock(db, ctx, payload),
}));

// ─── Imports after mocks ────────────────────────────────────────────

import { NextRequest } from 'next/server';
import {
    POST,
    GET,
} from '@/app/api/t/[tenantSlug]/admin/key-rotation/route';
import {
    clearAllRateLimits,
    API_KEY_CREATE_LIMIT,
} from '@/lib/security/rate-limit-middleware';
import type { RequestContext } from '@/app-layer/types';
import { makeRequestContext } from '../helpers/make-context';

// ─── Helpers ────────────────────────────────────────────────────────

function adminCtx(overrides: Partial<{
    tenantId: string;
    userId: string;
    requestId: string;
}> = {}): RequestContext {
    return makeRequestContext('ADMIN', {
        requestId: overrides.requestId ?? 'req-1',
        userId: overrides.userId ?? 'admin-1',
        tenantId: overrides.tenantId ?? 'tenant-A',
    });
}

/**
 * A viewer, for the denied-path test: `requirePermission('admin.manage', …)`
 * denies on the resolved `appPermissions`, so we hand back a non-admin ctx and
 * let the middleware produce the 403.
 */
function readerCtx(): RequestContext {
    return makeRequestContext('VIEWER', {
        requestId: 'req-1',
        userId: 'reader-1',
        tenantId: 'tenant-A',
    });
}

function req(
    method: string,
    opts: { url?: string; ip?: string } = {},
): NextRequest {
    const headers = new Headers();
    headers.set('x-forwarded-for', opts.ip ?? '1.2.3.4');
    return new NextRequest(
        opts.url ?? 'http://localhost/api/t/acme/admin/key-rotation',
        { method, headers },
    );
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('POST /api/t/:tenantSlug/admin/key-rotation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearAllRateLimits();
    });

    test('non-admin is rejected with 403 before any queue interaction', async () => {
        getTenantCtxMock.mockResolvedValueOnce(readerCtx());

        const res = await POST(req('POST'), { params: { tenantSlug: 'acme' } });
        expect(res.status).toBe(403);
        expect(enqueueMock).not.toHaveBeenCalled();
        expect(logEventMock).not.toHaveBeenCalled();
    });

    test('admin → enqueues job + writes audit entry + returns 202', async () => {
        getTenantCtxMock.mockResolvedValueOnce(adminCtx());
        enqueueMock.mockResolvedValueOnce({ id: 'bullmq-job-42' });

        const res = await POST(req('POST'), { params: { tenantSlug: 'acme' } });
        expect(res.status).toBe(202);

        // Job enqueued with the right payload shape.
        expect(enqueueMock).toHaveBeenCalledWith('key-rotation', {
            tenantId: 'tenant-A',
            initiatedByUserId: 'admin-1',
            requestId: 'req-1',
        });

        // Audit entry at initiation — lets auditors see who fired it
        // even if the job is later purged from BullMQ.
        expect(logEventMock).toHaveBeenCalledTimes(1);
        const [, , payload] = logEventMock.mock.calls[0]!;
        expect(payload).toMatchObject({
            action: 'KEY_ROTATION_INITIATED',
            entityType: 'TenantKey',
            entityId: 'tenant-A',
            detailsJson: { category: 'custom', event: 'key_rotation_initiated', jobId: 'bullmq-job-42' },
            metadata: { jobId: 'bullmq-job-42' },
        });

        // Response carries the jobId so operators can poll via GET.
        const body = await res.json();
        expect(body).toEqual(
            expect.objectContaining({
                status: 'queued',
                jobId: 'bullmq-job-42',
                tenantId: 'tenant-A',
            }),
        );
    });

    test('applies API_KEY_CREATE_LIMIT (tighter than default)', async () => {
        getTenantCtxMock.mockImplementation(async () => adminCtx());
        enqueueMock.mockResolvedValue({ id: 'job-x' });

        const maxAttempts = API_KEY_CREATE_LIMIT.maxAttempts; // 5
        for (let i = 0; i < maxAttempts; i++) {
            const res = await POST(req('POST'), { params: { tenantSlug: 'acme' } });
            expect(res.status).toBe(202);
        }
        // (max+1)-th request blocked by rate-limit wrapper.
        const blocked = await POST(req('POST'), { params: { tenantSlug: 'acme' } });
        expect(blocked.status).toBe(429);
        expect(blocked.headers.get('Retry-After')).toMatch(/^\d+$/);
        const body = await blocked.json();
        expect(body.error.scope).toBe('key-rotation-initiate');
    });
});

describe('GET /api/t/:tenantSlug/admin/key-rotation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearAllRateLimits();
    });

    test('admin + valid jobId → returns state + progress + result', async () => {
        getTenantCtxMock.mockResolvedValueOnce(adminCtx());
        const fakeJob = {
            name: 'key-rotation',
            data: { tenantId: 'tenant-A' },
            getState: jest.fn(async () => 'completed'),
            progress: 100,
            returnvalue: {
                totalScanned: 7,
                totalRewritten: 7,
                totalErrors: 0,
            },
            failedReason: null,
        };
        getQueueMock.mockReturnValueOnce({
            getJob: jest.fn(async () => fakeJob),
        });

        const r = req('GET', {
            url: 'http://localhost/api/t/acme/admin/key-rotation?jobId=job-7',
        });
        const res = await GET(r, { params: { tenantSlug: 'acme' } });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual(
            expect.objectContaining({
                jobId: 'job-7',
                state: 'completed',
                progress: 100,
                result: expect.objectContaining({ totalScanned: 7 }),
            }),
        );
    });

    test('missing jobId parameter → 400', async () => {
        getTenantCtxMock.mockResolvedValueOnce(adminCtx());
        const res = await GET(req('GET'), { params: { tenantSlug: 'acme' } });
        expect(res.status).toBe(400);
    });

    test('job-from-another-tenant → 404 (no cross-tenant leak)', async () => {
        getTenantCtxMock.mockResolvedValueOnce(adminCtx({ tenantId: 'tenant-A' }));
        getQueueMock.mockReturnValueOnce({
            getJob: jest.fn(async () => ({
                name: 'key-rotation',
                data: { tenantId: 'tenant-B' }, // different tenant
                getState: jest.fn(),
            })),
        });
        const r = req('GET', {
            url: 'http://localhost/api/t/acme/admin/key-rotation?jobId=foreign',
        });
        const res = await GET(r, { params: { tenantSlug: 'acme' } });
        expect(res.status).toBe(404);
    });

    test.each([
        ['another kind of job of the same tenant', { name: 'identity-leaver-pass', data: { tenantId: 'tenant-A' } }],
        ['a platform-wide job with no tenant', { name: 'key-rotation', data: {} }],
    ])('%s → 404', async (_label, job) => {
        getTenantCtxMock.mockResolvedValueOnce(adminCtx({ tenantId: 'tenant-A' }));
        const getState = jest.fn();
        getQueueMock.mockReturnValueOnce({
            getJob: jest.fn(async () => ({ ...job, getState, returnvalue: { secret: 1 } })),
        });
        const r = req('GET', {
            url: 'http://localhost/api/t/acme/admin/key-rotation?jobId=7',
        });
        const res = await GET(r, { params: { tenantSlug: 'acme' } });
        expect(res.status).toBe(404);
        expect(getState).not.toHaveBeenCalled();
    });

    test('non-existent jobId → 404', async () => {
        getTenantCtxMock.mockResolvedValueOnce(adminCtx());
        getQueueMock.mockReturnValueOnce({
            getJob: jest.fn(async () => null),
        });
        const r = req('GET', {
            url: 'http://localhost/api/t/acme/admin/key-rotation?jobId=missing',
        });
        const res = await GET(r, { params: { tenantSlug: 'acme' } });
        expect(res.status).toBe(404);
    });

    test('non-admin rejected with 403 even before the queue is consulted', async () => {
        getTenantCtxMock.mockResolvedValueOnce(readerCtx());
        const r = req('GET', {
            url: 'http://localhost/api/t/acme/admin/key-rotation?jobId=x',
        });
        const res = await GET(r, { params: { tenantSlug: 'acme' } });
        expect(res.status).toBe(403);
        expect(getQueueMock).not.toHaveBeenCalled();
    });
});

/**
 * The payload carries exactly the fields the job reads (`KeyRotationPayload`).
 * inflect-compliance also forwarded the requesting API key's id for the job to
 * re-check; that returns with API keys (5.2), and until then nothing else
 * belongs in the payload.
 */
describe('key rotation — the payload', () => {
    test('names the workspace, the initiator and the request, and nothing else', async () => {
        enqueueMock.mockClear();
        getTenantCtxMock.mockResolvedValueOnce(adminCtx());
        enqueueMock.mockResolvedValueOnce({ id: 'bullmq-job-44' });

        await POST(req('POST'), { params: { tenantSlug: 'acme' } });

        expect(enqueueMock).toHaveBeenCalledTimes(1);
        expect(Object.keys(enqueueMock.mock.calls[0]![1] as object).sort()).toEqual([
            'initiatedByUserId',
            'requestId',
            'tenantId',
        ]);
    });
});
