/**
 * Admin route enforcement smoke tests. Copied from inflect-compliance
 * (5528464fc54a8681956f3b9ce23ca9c075f0420e); the SCIM route (8.3) is
 * replaced by the security-settings route as the `admin.manage` sample.
 *
 * These tests pick one representative route per permission key from
 * `ROUTE_PERMISSIONS` and exercise it end-to-end through the
 * `withApiErrorHandling` + `requirePermission` chain. They verify:
 *
 *   - an ADMIN context reaches the inner handler
 *   - a VIEWER context is rejected with a 403 JSON envelope
 *   - the inner handler is NOT invoked on denial
 *   - an audit entry is recorded for the denial
 *
 * The unit test for `permission-middleware.ts` already covers the
 * middleware in isolation; this suite proves the wiring is intact at
 * the route boundary so a copy-paste typo (`requirePermsision('…')`,
 * `requirePermission('admni.scim'…)`) shows up in CI.
 */

// ─── Mocks (declared before route imports so Jest hoists them) ───

const mockGetTenantCtx = jest.fn();
const mockAppendAuditEntry = jest.fn();

jest.mock('@/app-layer/context', () => ({
    getTenantCtx: (...args: unknown[]) => mockGetTenantCtx(...args),
}));

jest.mock('@/lib/audit', () => ({
    // #2657 — `permission-middleware` now records AUTHZ_DENIED through
    // `appendAuditEntryOrQueue`, which falls back to a durable AuditOutbox
    // row instead of swallowing a failed write. Routed to the SAME spy as
    // `appendAuditEntry` on purpose: these tests assert the ENTRY'S SHAPE,
    // which the change does not alter, so they keep testing what they tested.
    appendAuditEntryOrQueue: (...args: unknown[]) => mockAppendAuditEntry(...args),
    appendAuditEntry: (...args: unknown[]) => mockAppendAuditEntry(...args),
}));

// The security-settings route reaches into its usecase — stub the read.
const mockGetTenantSecurityConfig = jest.fn();
jest.mock('@/app-layer/usecases/tenant-security-settings', () => ({
    getTenantSecurityConfig: (...args: unknown[]) => mockGetTenantSecurityConfig(...args),
    updateTenantSecurityConfig: jest.fn(),
}));

// Members route reaches into the tenant-admin usecase — stub the
// listing call we exercise below.
const mockListTenantMembers = jest.fn();
jest.mock('@/app-layer/usecases/tenant-admin', () => ({
    listTenantMembers: (...args: unknown[]) => mockListTenantMembers(...args),
    inviteTenantMember: jest.fn(),
    listPendingInvites: jest.fn(),
    getTenantAdminSettings: jest.fn(),
    updateTenantMemberRole: jest.fn(),
    deactivateTenantMember: jest.fn(),
}));

// ── Imports (after mocks) ──

import type { NextRequest } from 'next/server';
import { GET as securitySettingsGET } from '@/app/api/t/[tenantSlug]/admin/security-settings/route';
import { GET as membersGET } from '@/app/api/t/[tenantSlug]/admin/members/route';
import type { RequestContext } from '@/app-layer/types';
import { getPermissionsForRole } from '@/lib/permissions';

// ── Fixtures ──

function makeCtx(
    role: 'ADMIN' | 'MEMBER' | 'VIEWER',
): RequestContext {
    return {
        requestId: 'req-test-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        tenantSlug: 'acme',
        role,
        permissions: {
            canRead: true,
            canWrite: role === 'ADMIN' || role === 'MEMBER',
            canAdmin: role === 'ADMIN',
            canExport: role === 'ADMIN',
        },
        appPermissions: getPermissionsForRole(role),
    };
}

function makeReq(method: string, path: string) {
    return {
        method,
        url: `https://app.example.com${path}`,
        headers: new Headers(),
        nextUrl: {
            pathname: path,
            protocol: 'https:',
            host: 'app.example.com',
            searchParams: new URLSearchParams(),
        },
    } as unknown as NextRequest;
}

beforeEach(() => {
    mockGetTenantCtx.mockReset();
    mockAppendAuditEntry.mockReset();
    mockGetTenantSecurityConfig.mockReset();
    mockListTenantMembers.mockReset();
});

// ─── /admin/security-settings — admin.manage ───

describe('GET /api/t/:slug/admin/security-settings — admin.manage', () => {
    it('returns 200 + payload for an ADMIN', async () => {
        mockGetTenantCtx.mockResolvedValue(makeCtx('ADMIN'));
        mockGetTenantSecurityConfig.mockResolvedValue({ maxConcurrentSessions: null, mfaFailClosed: false });

        const res = await securitySettingsGET(makeReq('GET', '/api/t/acme/admin/security-settings'), {
            params: { tenantSlug: 'acme' },
        } as never);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ maxConcurrentSessions: null, mfaFailClosed: false });
        expect(mockAppendAuditEntry).not.toHaveBeenCalled();
    });

    it.each(['VIEWER', 'MEMBER'] as const)('returns 403 for a %s and records an audit entry', async (role) => {
        mockGetTenantCtx.mockResolvedValue(makeCtx(role));
        mockAppendAuditEntry.mockResolvedValue({ id: 'a1', entryHash: 'h', previousHash: null });

        const res = await securitySettingsGET(makeReq('GET', '/api/t/acme/admin/security-settings'), {
            params: { tenantSlug: 'acme' },
        } as never);

        expect(res.status).toBe(403);
        expect(mockGetTenantSecurityConfig).not.toHaveBeenCalled();
        expect(mockAppendAuditEntry.mock.calls[0][0]).toMatchObject({
            entity: 'Permission',
            entityId: 'admin.manage',
            action: 'AUTHZ_DENIED',
        });
    });
});

describe('GET /api/t/:slug/admin/members — admin.members', () => {
    it('returns 200 + payload for an ADMIN', async () => {
        mockGetTenantCtx.mockResolvedValue(makeCtx('ADMIN'));
        mockListTenantMembers.mockResolvedValue([{ id: 'm1' }]);

        const res = await membersGET(
            makeReq('GET', '/api/t/acme/admin/members'),
            { params: { tenantSlug: 'acme' } },
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as Array<{ id: string }>;
        expect(body).toEqual([{ id: 'm1' }]);
        expect(mockAppendAuditEntry).not.toHaveBeenCalled();
    });

    it('returns 403 for a VIEWER and records an audit entry', async () => {
        mockGetTenantCtx.mockResolvedValue(makeCtx('VIEWER'));
        mockAppendAuditEntry.mockResolvedValue({
            id: 'a1',
            entryHash: 'h',
            previousHash: null,
        });

        const res = await membersGET(
            makeReq('GET', '/api/t/acme/admin/members'),
            { params: { tenantSlug: 'acme' } },
        );

        expect(res.status).toBe(403);
        expect(mockListTenantMembers).not.toHaveBeenCalled();
        const entry = mockAppendAuditEntry.mock.calls[0][0];
        expect(entry).toMatchObject({
            entity: 'Permission',
            entityId: 'admin.members',
            action: 'AUTHZ_DENIED',
        });
    });
});
