/**
 * Two-tenant isolation for the tenant tables sub-phase 1.5 adds: `AuditLog`
 * and `AuditOutbox` (roadmap section 4: every tenant table gets a two-tenant
 * test). `TenantSecuritySettings`, which 1.5 extends, keeps its case in
 * `auth-tables-isolation.test.ts`.
 *
 * Every operation runs through `runInTenantContext` as tenant B, i.e. as
 * `app_user` with `app.tenant_id` = B, and none of them may read, count,
 * change or remove tenant A's rows, or create one in A. Tenant A's rows are
 * re-read through the login role after each case, so a check cannot pass
 * because the row was never there, and B reaches its own row, so the policy
 * is not simply deny-all.
 *
 * `AuditLog` is stricter than RLS alone: `app_user` holds SELECT and INSERT
 * only, so an UPDATE or DELETE is refused by privilege before any policy is
 * asked, for B's own rows as much as A's.
 *
 * Written from the pattern of `auth-tables-isolation.test.ts`; no code copied.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { runInTenantContext } from '@/lib/db/rls-middleware';

import { attemptAuditDelete, attemptAuditUpdate } from '../helpers/audit-cleanup';
import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

const SUFFIX = `auditiso_${Date.now()}`;

describeFn('audit tables — two-tenant isolation as app_user', () => {
    let prisma: PrismaClient;
    let tenantA: string;
    let tenantB: string;
    let ctxB: RequestContext;
    const log: { a: string; b: string } = { a: '', b: '' };
    const outbox: { a: string; b: string } = { a: '', b: '' };

    const seedLog = async (tenantId: string) =>
        (
            await prisma.auditLog.create({
                data: { tenantId, entity: 'Tenant', entityId: tenantId, action: 'SEEDED', actorType: 'SYSTEM' },
            })
        ).id;
    const seedOutbox = async (tenantId: string) =>
        (
            await prisma.auditOutbox.create({
                data: { tenantId, payloadJson: { tenantId }, occurredAt: new Date(), action: 'AUTHZ_DENIED' },
            })
        ).id;

    const snapshotA = async () => ({
        log: await prisma.auditLog.findMany({ where: { tenantId: tenantA }, orderBy: { id: 'asc' } }),
        outbox: await prisma.auditOutbox.findMany({ where: { tenantId: tenantA }, orderBy: { id: 'asc' } }),
    });

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantA = (await prisma.tenant.create({ data: { name: 'A', slug: `a-${SUFFIX}` } })).id;
        tenantB = (await prisma.tenant.create({ data: { name: 'B', slug: `b-${SUFFIX}` } })).id;
        const userB = (await prisma.user.create({ data: { email: `b-${SUFFIX}@example.com` } })).id;
        log.a = await seedLog(tenantA);
        log.b = await seedLog(tenantB);
        outbox.a = await seedOutbox(tenantA);
        outbox.b = await seedOutbox(tenantB);
        ctxB = makeRequestContext('OWNER', { tenantId: tenantB, userId: userB, requestId: 'req-audit-iso' });
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    let before: Awaited<ReturnType<typeof snapshotA>>;
    beforeEach(async () => {
        before = await snapshotA();
        expect(before.log).toHaveLength(1);
        expect(before.outbox).toHaveLength(1);
    });
    afterEach(async () => {
        expect(await snapshotA()).toEqual(before);
    });

    describe('AuditLog', () => {
        it('read by A id returns nothing', async () => {
            expect(await runInTenantContext(ctxB, (db) => db.auditLog.findUnique({ where: { id: log.a } }))).toBeNull();
        });

        it('an unfiltered list holds only B rows, and a count of A is zero', async () => {
            const [rows, inA] = await runInTenantContext(ctxB, async (db) => [
                await db.auditLog.findMany({ select: { id: true, tenantId: true } }),
                await db.auditLog.count({ where: { tenantId: tenantA } }),
            ]);
            expect(rows.map((r) => r.id)).toContain(log.b);
            expect(rows.every((r) => r.tenantId === tenantB)).toBe(true);
            expect(inA).toBe(0);
        });

        it('an insert carrying A id is refused', async () => {
            await expect(
                runInTenantContext(ctxB, (db) =>
                    db.auditLog.create({
                        data: { tenantId: tenantA, entity: 'Tenant', entityId: tenantA, action: 'PLANTED' },
                    }),
                ),
            ).rejects.toThrow();
        });

        it('UPDATE and DELETE are refused by privilege, even on B rows', async () => {
            // Through the cleanup helper's refusal probes, which carry no
            // bypass: the immutability guard admits no Prisma update or delete
            // verb on the trail anywhere, tests included.
            await expect(
                runInTenantContext(ctxB, (db) => attemptAuditUpdate(db, 'AuditLog', '"action" = $1', '"tenantId" = $2', 'X', tenantA)),
            ).rejects.toThrow(/permission denied/i);
            await expect(
                runInTenantContext(ctxB, (db) => attemptAuditDelete(db, 'AuditLog', '"id" = $1', log.b)),
            ).rejects.toThrow(/permission denied/i);
        });

        it('tenant B still reads its own row (the policy is not deny-all)', async () => {
            const own = await runInTenantContext(ctxB, (db) => db.auditLog.findUnique({ where: { id: log.b } }));
            expect(own).toMatchObject({ id: log.b, tenantId: tenantB });
        });
    });

    describe('AuditOutbox', () => {
        it('read by A id returns nothing', async () => {
            expect(await runInTenantContext(ctxB, (db) => db.auditOutbox.findUnique({ where: { id: outbox.a } }))).toBeNull();
        });

        it('an unfiltered list returns only B rows, and a count of A is zero', async () => {
            const [rows, inA] = await runInTenantContext(ctxB, async (db) => [
                await db.auditOutbox.findMany({ select: { id: true, tenantId: true } }),
                await db.auditOutbox.count({ where: { tenantId: tenantA } }),
            ]);
            expect(rows).toEqual([{ id: outbox.b, tenantId: tenantB }]);
            expect(inA).toBe(0);
        });

        it('updateMany and deleteMany over A change nothing', async () => {
            const [updated, deleted] = await runInTenantContext(ctxB, async (db) => [
                await db.auditOutbox.updateMany({ where: { tenantId: tenantA }, data: { status: 'FAILED' } }),
                await db.auditOutbox.deleteMany({ where: { tenantId: tenantA } }),
            ]);
            expect(updated.count).toBe(0);
            expect(deleted.count).toBe(0);
        });

        it('a write carrying A id is refused', async () => {
            await expect(
                runInTenantContext(ctxB, (db) =>
                    db.auditOutbox.create({
                        data: { tenantId: tenantA, payloadJson: {}, occurredAt: new Date(), action: 'PLANTED' },
                    }),
                ),
            ).rejects.toThrow();
        });

        it('tenant B still reads its own row (the policy is not deny-all)', async () => {
            const own = await runInTenantContext(ctxB, (db) => db.auditOutbox.findUnique({ where: { id: outbox.b } }));
            expect(own).toMatchObject({ id: outbox.b, tenantId: tenantB });
        });
    });
});
