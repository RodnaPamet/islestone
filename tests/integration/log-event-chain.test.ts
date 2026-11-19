/**
 * `logEvent` writes a real, hash-chained `AuditLog` row (sub-phase 1.5).
 *
 * Until 1.5, `@/lib/audit` was a stub that wrote one log line per entry, and
 * every 1.4 usecase already called `logEvent` with its real input. This suite
 * proves the stub is gone end to end: an entry written inside a request's
 * `runInTenantContext` lands in the table, chained to the one before it, with
 * the context's actor and request id, and the chain verifies. A `detailsJson`
 * that is not a structured audit payload is refused before anything is
 * written.
 *
 * Written for Islestone (docs/porting/maps/1.5.md, "Integration": "logEvent
 * within runInTenantContext writes a chained row"). No code copied.
 */
import type { PrismaClient } from '@prisma/client';

import { logEvent } from '@/app-layer/events/audit';
import { verifyAuditChain } from '@/lib/audit';
import { runInTenantContext } from '@/lib/db/rls-middleware';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

const SUFFIX = `logev_${Date.now()}`;

describeFn('logEvent — a chained AuditLog row per event', () => {
    let prisma: PrismaClient;
    let tenantId: string;
    let userId: string;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await prisma.tenant.create({ data: { name: 'Log event', slug: `le-${SUFFIX}` } })).id;
        userId = (await prisma.user.create({ data: { email: `le-${SUFFIX}@example.com` } })).id;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    it('writes two events as two rows, the second chained to the first, and the chain verifies', async () => {
        const ctx = makeRequestContext('OWNER', { tenantId, userId, requestId: `req-${SUFFIX}` });
        await runInTenantContext(ctx, (db) =>
            logEvent(db, ctx, {
                action: 'MEMBER_ROLE_CHANGED',
                entityType: 'TenantMembership',
                entityId: 'm-1',
                detailsJson: { category: 'access', operation: 'role_changed', detail: 'MEMBER → ADMIN' },
            }),
        );
        await runInTenantContext(ctx, (db) =>
            logEvent(db, ctx, {
                action: 'INVITE_CREATED',
                entityType: 'TenantInvite',
                entityId: 'i-1',
                detailsJson: { category: 'entity_lifecycle', entityName: 'TenantInvite', operation: 'created' },
            }),
        );

        const rows = await prisma.auditLog.findMany({
            where: { tenantId, action: { in: ['MEMBER_ROLE_CHANGED', 'INVITE_CREATED'] } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        expect(rows.map((r) => r.action)).toEqual(['MEMBER_ROLE_CHANGED', 'INVITE_CREATED']);
        const [first, second] = rows;
        expect(first!.userId).toBe(userId);
        expect(first!.actorType).toBe('USER');
        expect(first!.requestId).toBe(`req-${SUFFIX}`);
        expect(first!.entryHash).toMatch(/^[0-9a-f]{64}$/);
        expect(second!.previousHash).toBe(first!.entryHash);

        const verdict = await verifyAuditChain(tenantId, prisma);
        expect(verdict.valid).toBe(true);
        expect(verdict.hashedEntries).toBeGreaterThanOrEqual(2);
    });

    it('refuses a detailsJson that is not a structured audit payload, and writes nothing', async () => {
        const ctx = makeRequestContext('OWNER', { tenantId, userId });
        const before = await prisma.auditLog.count({ where: { tenantId } });
        await expect(
            runInTenantContext(ctx, (db) =>
                logEvent(db, ctx, {
                    action: 'BAD_EVENT',
                    entityType: 'Tenant',
                    entityId: tenantId,
                    detailsJson: { category: 'not-a-category' },
                }),
            ),
        ).rejects.toThrow(/detailsJson/);
        expect(await prisma.auditLog.count({ where: { tenantId, action: 'BAD_EVENT' } })).toBe(0);
        expect(await prisma.auditLog.count({ where: { tenantId } })).toBe(before);
    });
});
