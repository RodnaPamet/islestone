/**
 * `getTenantCtx` — the session-only, gate-free request-context builder of
 * sub-phase 1.3.
 *
 * Refusals: 401 with no session (the 1.3 stub always refuses), 404 for an
 * unknown or soft-deleted workspace, 403 for a non-member and for a
 * DEACTIVATED or REMOVED member. The happy path returns `role`,
 * `membershipRole`, `permissions` and `tenantSlug`, honours `x-request-id`,
 * and enriches the observability context.
 *
 * Written fresh (the source covers `getTenantCtx` across auth-gate suites
 * that move to 1.4 with their gates).
 */
const sessionMock = jest.fn();
const tenantFindUnique = jest.fn();
const membershipFindUnique = jest.fn();
const mergeRequestContextMock = jest.fn();

jest.mock('@/lib/auth/session', () => ({
    __esModule: true,
    getSessionOrThrow: () => sessionMock(),
}));

jest.mock('@/lib/prisma', () => {
    const client = {
        tenant: { findUnique: (...a: unknown[]) => tenantFindUnique(...a) },
        tenantMembership: { findUnique: (...a: unknown[]) => membershipFindUnique(...a) },
    };
    return { __esModule: true, prisma: client, default: client };
});

jest.mock('@/lib/observability/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/observability/context', () => ({
    __esModule: true,
    mergeRequestContext: (...a: unknown[]) => mergeRequestContextMock(...a),
    getRequestContext: () => undefined,
}));

import type { NextRequest } from 'next/server';

import { getTenantCtx } from '@/app-layer/context';
import { AppError } from '@/lib/errors/types';

const TENANT = { id: 'tenant-1', slug: 'acme', name: 'Acme', organizationId: null, deletedAt: null };
const MEMBERSHIP = { id: 'm-1', tenantId: 'tenant-1', userId: 'user-1', role: 'MEMBER', status: 'ACTIVE' };

function req(headers: Record<string, string> = {}): NextRequest {
    return { headers: new Headers(headers) } as unknown as NextRequest;
}

beforeEach(() => {
    jest.clearAllMocks();
    sessionMock.mockResolvedValue({ userId: 'user-1' });
    tenantFindUnique.mockResolvedValue(TENANT);
    membershipFindUnique.mockResolvedValue(MEMBERSHIP);
});

describe('getTenantCtx', () => {
    it('returns the context for an ACTIVE member', async () => {
        const ctx = await getTenantCtx({ tenantSlug: 'acme' }, req());

        expect(ctx).toEqual({
            requestId: expect.any(String),
            userId: 'user-1',
            tenantId: 'tenant-1',
            tenantSlug: 'acme',
            role: 'MEMBER',
            membershipRole: 'MEMBER',
            permissions: { canRead: true, canWrite: true, canAdmin: false, canExport: true },
            appPermissions: {},
        });
        expect(ctx.requestId.length).toBeGreaterThan(0);
        expect(tenantFindUnique).toHaveBeenCalledWith({ where: { slug: 'acme' } });
        expect(membershipFindUnique).toHaveBeenCalledWith({
            where: { tenantId_userId: { tenantId: 'tenant-1', userId: 'user-1' } },
        });
        expect(mergeRequestContextMock).toHaveBeenCalledWith({ tenantId: 'tenant-1', userId: 'user-1' });
    });

    it('honours an incoming x-request-id', async () => {
        const ctx = await getTenantCtx({ tenantSlug: 'acme' }, req({ 'x-request-id': 'req-from-edge' }));
        expect(ctx.requestId).toBe('req-from-edge');
    });

    it('generates a request id when there is no request', async () => {
        const a = await getTenantCtx({ tenantSlug: 'acme' });
        const b = await getTenantCtx({ tenantSlug: 'acme' });
        expect(a.requestId).not.toBe(b.requestId);
    });

    it('401 with no session, before any database read', async () => {
        sessionMock.mockRejectedValue(new AppError('Unauthorized', 'UNAUTHORIZED', 401));
        await expect(getTenantCtx({ tenantSlug: 'acme' }, req())).rejects.toMatchObject({ status: 401 });
        expect(tenantFindUnique).not.toHaveBeenCalled();
    });

    it('404 for an unknown workspace', async () => {
        tenantFindUnique.mockResolvedValue(null);
        await expect(getTenantCtx({ tenantSlug: 'nope' }, req())).rejects.toMatchObject({ status: 404 });
    });

    it('404 for a soft-deleted workspace, with the same message as an unknown one', async () => {
        tenantFindUnique.mockResolvedValue({ ...TENANT, deletedAt: new Date() });
        const deleted = await getTenantCtx({ tenantSlug: 'acme' }, req()).catch((e: AppError) => e);
        tenantFindUnique.mockResolvedValue(null);
        const unknown = await getTenantCtx({ tenantSlug: 'acme' }, req()).catch((e: AppError) => e);
        expect(deleted).toMatchObject({ status: 404 });
        expect((deleted as AppError).message).toBe((unknown as AppError).message);
    });

    it('403 for a non-member', async () => {
        membershipFindUnique.mockResolvedValue(null);
        await expect(getTenantCtx({ tenantSlug: 'acme' }, req())).rejects.toMatchObject({ status: 403 });
        expect(mergeRequestContextMock).not.toHaveBeenCalled();
    });

    it.each(['DEACTIVATED', 'REMOVED'])('403 for a %s member', async (status) => {
        membershipFindUnique.mockResolvedValue({ ...MEMBERSHIP, status });
        await expect(getTenantCtx({ tenantSlug: 'acme' }, req())).rejects.toMatchObject({ status: 403 });
    });

    it('an INVITED membership is not refused here (invitation acceptance is 1.4)', async () => {
        membershipFindUnique.mockResolvedValue({ ...MEMBERSHIP, status: 'INVITED', role: 'VIEWER' });
        await expect(getTenantCtx({ tenantSlug: 'acme' }, req())).resolves.toMatchObject({ role: 'VIEWER' });
    });
});

describe('the 1.3 session stub', () => {
    it('always refuses with 401, so getTenantCtx cannot succeed outside tests until 1.4', async () => {
        const { getSessionOrThrow } = jest.requireActual<{ getSessionOrThrow: () => Promise<unknown> }>(
            '@/lib/auth/session',
        );
        await expect(getSessionOrThrow()).rejects.toMatchObject({ status: 401 });
    });
});
