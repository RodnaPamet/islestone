/**
 * Both key-rotation routes are OWNER-only (owner decision, 2026-11-19), and a
 * refusal leaves its record on the chain.
 *
 *   POST /api/t/:slug/admin/key-rotation          admin.tenant_lifecycle
 *   POST /api/t/:slug/admin/tenant-dek-rotation   admin.tenant_lifecycle
 *
 * Against a real database: an ADMIN gets 403 and one `AUTHZ_DENIED` row naming
 * the key, and nothing is enqueued or swapped; an OWNER gets 202 and the start
 * entry (`KEY_ROTATION_INITIATED`, `TENANT_DEK_ROTATED`); the chain verifies.
 * Only the session resolution (`getTenantCtx`, which reads a NextAuth cookie)
 * and the queue (Redis) are doubles; the gate, the usecase, the DEK swap and
 * the audit writer are real.
 *
 * Written for Islestone (sub-phase 1.5b).
 */
import { NextRequest } from 'next/server';
import type { Role, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

import type { RequestContext } from '@/app-layer/types';

const getTenantCtxMock = jest.fn<Promise<RequestContext>, [unknown, unknown]>();
jest.mock('@/app-layer/context', () => ({
    getTenantCtx: (params: unknown, req: unknown) => getTenantCtxMock(params, req),
}));
const enqueueMock = jest.fn(async (..._a: unknown[]) => ({ id: 'route-test-job' }));
jest.mock('@/app-layer/jobs/queue', () => ({
    enqueue: (...a: unknown[]) => enqueueMock(...a),
    getQueue: () => {
        throw new Error('the status routes are not exercised here');
    },
}));

import { POST as postKeyRotation } from '@/app/api/t/[tenantSlug]/admin/key-rotation/route';
import { POST as postDekRotation } from '@/app/api/t/[tenantSlug]/admin/tenant-dek-rotation/route';
import { verifyAuditChain } from '@/lib/audit';
import { _resetTenantDekCache, createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';
import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = randomUUID().slice(0, 8);
const PARAMS = { params: Promise.resolve({ tenantSlug: `routes-${TAG}` }) };

describeFn('the key-rotation routes are OWNER-only (owner decision, 2026-11-19)', () => {
    let db: PrismaClient;
    let tenantId = '';
    const users: Record<'OWNER' | 'ADMIN', string> = { OWNER: '', ADMIN: '' };

    function ctxFor(role: 'OWNER' | 'ADMIN'): RequestContext {
        return makeRequestContext(role as Role, {
            tenantId,
            tenantSlug: `routes-${TAG}`,
            userId: users[role],
            requestId: `${TAG}-${role}`,
        });
    }

    function post(path: string): NextRequest {
        return new NextRequest(`http://localhost/api/t/routes-${TAG}/admin/${path}`, {
            method: 'POST',
            headers: { 'x-forwarded-for': '10.0.0.9' },
        });
    }

    beforeAll(async () => {
        db = prismaTestClient();
        const tenant = await createTenantWithDek({ name: `routes-${TAG}`, slug: `routes-${TAG}` });
        tenantId = tenant.id;
        for (const role of ['OWNER', 'ADMIN'] as const) {
            const u = await db.user.create({ data: { email: `${role.toLowerCase()}-${TAG}@example.test` } });
            await db.tenantMembership.create({ data: { tenantId, userId: u.id, role, status: 'ACTIVE' } });
            users[role] = u.id;
        }
    });

    afterAll(async () => {
        _resetTenantDekCache();
        await resetDatabase(db);
    });

    beforeEach(() => {
        enqueueMock.mockClear();
        _resetTenantDekCache();
    });

    const denials = (userId: string) =>
        db.auditLog.findMany({
            where: { tenantId, userId, action: 'AUTHZ_DENIED' },
            select: { entity: true, entityId: true, detailsJson: true },
        });

    test.each([
        ['key-rotation', () => postKeyRotation],
        ['tenant-dek-rotation', () => postDekRotation],
    ])('an ADMIN is refused %s with 403 and an AUTHZ_DENIED row; nothing moves', async (path, handler) => {
        const before = await db.tenant.findUniqueOrThrow({
            where: { id: tenantId },
            select: { encryptedDek: true, previousEncryptedDek: true },
        });
        const deniedBefore = (await denials(users.ADMIN)).length;
        getTenantCtxMock.mockResolvedValueOnce(ctxFor('ADMIN'));

        const res = await handler()(post(path), PARAMS);

        expect(res.status).toBe(403);
        const rows = await denials(users.ADMIN);
        expect(rows).toHaveLength(deniedBefore + 1);
        expect(rows[rows.length - 1]).toMatchObject({
            entity: 'Permission',
            entityId: 'admin.tenant_lifecycle',
            detailsJson: { category: 'access', event: 'authz_denied', role: 'ADMIN' },
        });
        expect(enqueueMock).not.toHaveBeenCalled();
        const after = await db.tenant.findUniqueOrThrow({
            where: { id: tenantId },
            select: { encryptedDek: true, previousEncryptedDek: true },
        });
        expect(after).toEqual(before);
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });

    test('an OWNER starts a master-key rotation: 202 and KEY_ROTATION_INITIATED', async () => {
        getTenantCtxMock.mockResolvedValueOnce(ctxFor('OWNER'));

        const res = await postKeyRotation(post('key-rotation'), PARAMS);

        expect(res.status).toBe(202);
        expect(enqueueMock).toHaveBeenCalledWith('key-rotation', {
            tenantId,
            initiatedByUserId: users.OWNER,
            requestId: `${TAG}-OWNER`,
        });
        const row = await db.auditLog.findFirstOrThrow({ where: { tenantId, action: 'KEY_ROTATION_INITIATED' } });
        expect(row.userId).toBe(users.OWNER);
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });

    test('an OWNER rotates the workspace DEK: 202, the swap, and TENANT_DEK_ROTATED', async () => {
        getTenantCtxMock.mockResolvedValueOnce(ctxFor('OWNER'));
        const before = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { encryptedDek: true } });

        const res = await postDekRotation(post('tenant-dek-rotation'), PARAMS);

        expect(res.status).toBe(202);
        const after = await db.tenant.findUniqueOrThrow({
            where: { id: tenantId },
            select: { encryptedDek: true, previousEncryptedDek: true },
        });
        expect(after.previousEncryptedDek).toBe(before.encryptedDek);
        const row = await db.auditLog.findFirstOrThrow({ where: { tenantId, action: 'TENANT_DEK_ROTATED' } });
        expect(row.userId).toBe(users.OWNER);
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);

        // A second one while that sweep is "in flight" (the queue is a double,
        // so the sweep never runs) is a 409, with no second entry.
        getTenantCtxMock.mockResolvedValueOnce(ctxFor('OWNER'));
        const again = await postDekRotation(post('tenant-dek-rotation'), PARAMS);
        expect(again.status).toBe(409);
        expect(await db.auditLog.count({ where: { tenantId, action: 'TENANT_DEK_ROTATED' } })).toBe(1);
    });
});
