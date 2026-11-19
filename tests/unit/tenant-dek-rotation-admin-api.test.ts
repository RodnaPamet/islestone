/**
 * The per-workspace DEK rotation route (sub-phase 1.5b).
 *
 *   POST /api/t/:slug/admin/tenant-dek-rotation   OWNER-only (admin.tenant_lifecycle)
 *   GET  /api/t/:slug/admin/tenant-dek-rotation?jobId=…
 *
 * What is asserted:
 *   - an ADMIN is refused with 403 before the key is touched, on both verbs:
 *     ADMIN holds `admin.manage` but not `admin.tenant_lifecycle`, and a
 *     downgrade of the gate would let it rotate;
 *   - an OWNER's POST swaps the DEK through the REAL `rotateTenantDek` (only
 *     Prisma and the queue are doubles), enqueues the sweep, writes
 *     `TENANT_DEK_ROTATED` and answers 202 with the job id;
 *   - a POST while an earlier sweep is in flight answers 409 and writes no
 *     audit entry, for both of `rotateTenantDek`'s in-flight refusals (the
 *     column already set when it read, and a concurrent swap between its read
 *     and its update) — which pins the usecase's message match against the
 *     real function's messages;
 *   - the GET answers 400 without a jobId and 404 for another workspace's job.
 *
 * Written for Islestone; inflect-compliance tested these handlers only
 * through its alias route and the integration suite.
 */
import { strictMock } from '../helpers/strict-mock';

const getTenantCtxMock = jest.fn<Promise<RequestContext>, [unknown, unknown]>();
jest.mock('@/app-layer/context', () => ({
    getTenantCtx: (params: unknown, req: unknown) => getTenantCtxMock(params, req),
}));

const appendAuditEntryOrQueue = jest.fn(async (..._a: unknown[]) => ({ recorded: 'chain' as const, auditId: 'a1' }));
jest.mock('@/lib/audit', () =>
    strictMock('@/lib/audit', jest.requireActual('@/lib/audit'), {
        appendAuditEntryOrQueue: (...a: unknown[]) => appendAuditEntryOrQueue(...a),
        appendAuditEntry: jest.fn(async () => ({ id: 'a1', entryHash: 'h', previousHash: null })),
    }),
);

jest.mock('@/lib/db-context', () => ({
    runInTenantContext: jest.fn(async (_ctx: unknown, fn: (db: unknown) => unknown) => fn({})),
}));

const logEventMock = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('@/app-layer/events/audit', () => ({
    logEvent: (...a: unknown[]) => logEventMock(...a),
}));

const enqueueMock = jest.fn(async (..._a: unknown[]) => ({ id: 'sweep-1' }));
const getQueueMock = jest.fn();
jest.mock('@/app-layer/jobs/queue', () => ({
    enqueue: (...a: unknown[]) => enqueueMock(...a),
    getQueue: () => getQueueMock(),
}));

// `rotateTenantDek` is the real function; only its Prisma calls are doubles.
const mockTenant = {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
};
jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: {
        get tenant() {
            return mockTenant;
        },
    },
    prisma: {
        get tenant() {
            return mockTenant;
        },
    },
}));

import { NextRequest } from 'next/server';
import type { Role } from '@prisma/client';

import { GET, POST } from '@/app/api/t/[tenantSlug]/admin/tenant-dek-rotation/route';
import type { RequestContext } from '@/app-layer/types';
import { _resetTenantDekCache } from '@/lib/security/tenant-key-manager';
import { generateDek, wrapDek } from '@/lib/security/tenant-keys';
import { makeRequestContext } from '../helpers/make-context';

const PARAMS = { params: Promise.resolve({ tenantSlug: 'acme' }) };

function ctx(role: Role): RequestContext {
    return makeRequestContext(role, { tenantId: 'tenant-A', userId: `${role.toLowerCase()}-1`, requestId: 'req-1' });
}

function req(method: string, query = ''): NextRequest {
    return new NextRequest(`http://localhost/api/t/acme/admin/tenant-dek-rotation${query}`, {
        method,
        headers: { 'x-forwarded-for': '1.2.3.4' },
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    _resetTenantDekCache();
});

describe('POST /api/t/:slug/admin/tenant-dek-rotation', () => {
    test('an ADMIN is refused with 403 and the key is never read', async () => {
        getTenantCtxMock.mockResolvedValueOnce(ctx('ADMIN'));

        const res = await POST(req('POST'), PARAMS);

        expect(res.status).toBe(403);
        expect(mockTenant.findUnique).not.toHaveBeenCalled();
        expect(mockTenant.updateMany).not.toHaveBeenCalled();
        expect(enqueueMock).not.toHaveBeenCalled();
        expect(logEventMock).not.toHaveBeenCalled();
        expect(appendAuditEntryOrQueue.mock.calls[0]?.[0]).toMatchObject({
            tenantId: 'tenant-A',
            userId: 'admin-1',
            action: 'AUTHZ_DENIED',
        });
    });

    test('an OWNER swaps the key, enqueues the sweep, audits it and gets 202', async () => {
        getTenantCtxMock.mockResolvedValueOnce(ctx('OWNER'));
        const oldWrapped = wrapDek(generateDek());
        mockTenant.findUnique.mockResolvedValueOnce({ id: 'tenant-A', encryptedDek: oldWrapped, previousEncryptedDek: null });
        mockTenant.updateMany.mockResolvedValueOnce({ count: 1 });

        const res = await POST(req('POST'), PARAMS);

        expect(res.status).toBe(202);
        expect(await res.json()).toEqual({
            status: 'queued',
            jobId: 'sweep-1',
            tenantId: 'tenant-A',
            initiatedByUserId: 'owner-1',
        });
        const swap = mockTenant.updateMany.mock.calls[0]?.[0] as { data: { previousEncryptedDek: string } };
        expect(swap.data.previousEncryptedDek).toBe(oldWrapped);
        expect(enqueueMock).toHaveBeenCalledWith('tenant-dek-rotation', {
            tenantId: 'tenant-A',
            initiatedByUserId: 'owner-1',
            requestId: 'req-1',
        });
        expect(logEventMock).toHaveBeenCalledTimes(1);
        expect(logEventMock.mock.calls[0]?.[2]).toMatchObject({
            action: 'TENANT_DEK_ROTATED',
            entityType: 'TenantKey',
            entityId: 'tenant-A',
            detailsJson: { category: 'custom', event: 'tenant_dek_rotated', jobId: 'sweep-1' },
        });
    });

    test('409 while an earlier sweep still holds the previous key, with no audit entry', async () => {
        getTenantCtxMock.mockResolvedValueOnce(ctx('OWNER'));
        mockTenant.findUnique.mockResolvedValueOnce({
            id: 'tenant-A',
            encryptedDek: wrapDek(generateDek()),
            previousEncryptedDek: wrapDek(generateDek()),
        });

        const res = await POST(req('POST'), PARAMS);

        expect(res.status).toBe(409);
        expect(mockTenant.updateMany).not.toHaveBeenCalled();
        expect(enqueueMock).not.toHaveBeenCalled();
        expect(logEventMock).not.toHaveBeenCalled();
    });

    test('409 when a concurrent rotation swapped between the read and the update', async () => {
        getTenantCtxMock.mockResolvedValueOnce(ctx('OWNER'));
        mockTenant.findUnique.mockResolvedValueOnce({
            id: 'tenant-A',
            encryptedDek: wrapDek(generateDek()),
            previousEncryptedDek: null,
        });
        mockTenant.updateMany.mockResolvedValueOnce({ count: 0 });

        const res = await POST(req('POST'), PARAMS);

        expect(res.status).toBe(409);
        expect(enqueueMock).not.toHaveBeenCalled();
        expect(logEventMock).not.toHaveBeenCalled();
    });
});

describe('GET /api/t/:slug/admin/tenant-dek-rotation', () => {
    test('an ADMIN is refused with 403 before the queue is read', async () => {
        getTenantCtxMock.mockResolvedValueOnce(ctx('ADMIN'));

        const res = await GET(req('GET', '?jobId=1'), PARAMS);

        expect(res.status).toBe(403);
        expect(getQueueMock).not.toHaveBeenCalled();
    });

    test('400 without a jobId', async () => {
        getTenantCtxMock.mockResolvedValueOnce(ctx('OWNER'));

        const res = await GET(req('GET'), PARAMS);

        expect(res.status).toBe(400);
        expect((await res.json()).error.message).toBe('jobId required');
        expect(getQueueMock).not.toHaveBeenCalled();
    });

    test("the workspace's own sweep reports its state and progress", async () => {
        getTenantCtxMock.mockResolvedValueOnce(ctx('OWNER'));
        getQueueMock.mockReturnValueOnce({
            getJob: jest.fn(async () => ({
                name: 'tenant-dek-rotation',
                data: { tenantId: 'tenant-A' },
                getState: jest.fn(async () => 'active'),
                progress: { phase: 'sweeping', totalRewritten: 3 },
                returnvalue: undefined,
                failedReason: undefined,
            })),
        });

        const res = await GET(req('GET', '?jobId=7'), PARAMS);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            jobId: '7',
            state: 'active',
            progress: { phase: 'sweeping', totalRewritten: 3 },
            result: null,
            failedReason: null,
        });
    });

    test.each([
        ['another workspace', { name: 'tenant-dek-rotation', data: { tenantId: 'tenant-B' } }],
        ['another kind of job', { name: 'key-rotation', data: { tenantId: 'tenant-A' } }],
    ])('404 for a job of %s', async (_label, job) => {
        getTenantCtxMock.mockResolvedValueOnce(ctx('OWNER'));
        const getState = jest.fn();
        getQueueMock.mockReturnValueOnce({ getJob: jest.fn(async () => ({ ...job, getState })) });

        const res = await GET(req('GET', '?jobId=7'), PARAMS);

        expect(res.status).toBe(404);
        expect(getState).not.toHaveBeenCalled();
    });
});
