/**
 * Two-tenant isolation for calendar sync's three tables (roadmap 3.3b; ADR
 * 0011): TenantCalendarSettings, CalendarConnection and CalendarSyncedEvent.
 *
 * Every operation runs through `runInTenantContext` as tenant B, i.e. as
 * `app_user` with `app.tenant_id` = B: none may read, count, change or remove
 * tenant A's rows, or create one in A. Tenant A's rows are re-read through the
 * login role after each case, so a check cannot pass because the row was
 * never there; B reads its own rows, so the policy is not deny-all. The
 * settings row is never deleted: `app_user` holds no DELETE on it.
 *
 * Written in the pattern of `intake-tables-isolation.test.ts`.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { runInTenantContext } from '@/lib/db/rls-middleware';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

const SUFFIX = `caliso_${Date.now()}`;

interface Side {
    tenantId: string;
    userId: string;
    connectionId: string;
}

type Delegate = {
    count: (args: { where: Record<string, unknown> }) => Promise<number>;
    findMany: (args: { where?: Record<string, unknown>; select: Record<string, boolean> }) => Promise<Array<{ tenantId: string }>>;
    updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
    deleteMany: (args: { where: Record<string, unknown> }) => Promise<{ count: number }>;
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
};

const event = (s: Side, n: string) => ({
    tenantId: s.tenantId,
    connectionId: s.connectionId,
    kind: 'WORK_ITEM',
    workItemId: `item-${n}`,
    clientEventId: 'a'.repeat(40),
    pushedDueDate: new Date('2026-12-01T00:00:00.000Z'),
    contentHash: 'b'.repeat(32),
});

const TABLES: ReadonlyArray<{
    model: string;
    delegate: string;
    update: Record<string, unknown>;
    deletable: boolean;
    insert: (s: Side) => Record<string, unknown>;
}> = [
    { model: 'TenantCalendarSettings', delegate: 'tenantCalendarSettings', update: { syncEnabled: true }, deletable: false, insert: (s) => ({ tenantId: s.tenantId }) },
    {
        model: 'CalendarConnection',
        delegate: 'calendarConnection',
        update: { lastSyncedAt: new Date() },
        deletable: true,
        insert: (s) => ({ tenantId: s.tenantId, userId: s.userId, provider: 'MICROSOFT', state: 'REVOKED', revokedReason: 'ACCESS_WITHDRAWN' }),
    },
    { model: 'CalendarSyncedEvent', delegate: 'calendarSyncedEvent', update: { lastError: 'NOT_FOUND' }, deletable: true, insert: (s) => event(s, 'planted') },
];

describeFn('calendar sync tables — two-tenant isolation as app_user', () => {
    let prisma: PrismaClient;
    const sides: { a?: Side; b?: Side } = {};
    let ctxB: RequestContext;

    async function seedSide(tag: string): Promise<Side> {
        const tenant = await prisma.tenant.create({ data: { name: tag, slug: `${tag}-${SUFFIX}` } });
        const user = await prisma.user.create({ data: { email: `${tag}-${SUFFIX}@example.com` } });
        await prisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id, role: 'OWNER' } });
        await prisma.tenantCalendarSettings.create({ data: { tenantId: tenant.id, syncEnabled: false } });
        const connection = await prisma.calendarConnection.create({
            data: { tenantId: tenant.id, userId: user.id, provider: 'GOOGLE', state: 'REVOKED', revokedReason: 'ACCESS_WITHDRAWN' },
        });
        const side = { tenantId: tenant.id, userId: user.id, connectionId: connection.id };
        await prisma.calendarSyncedEvent.create({ data: { ...event(side, tag), kind: 'WORK_ITEM' } });
        return side;
    }

    const delegateOf = (db: unknown, name: string) => (db as Record<string, Delegate>)[name]!;
    const snapshotA = async () =>
        Promise.all(TABLES.map((t) => delegateOf(prisma, t.delegate).findMany({ where: { tenantId: sides.a!.tenantId }, select: { tenantId: true } })));

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        sides.a = await seedSide('a');
        sides.b = await seedSide('b');
        ctxB = makeRequestContext('OWNER', { tenantId: sides.b.tenantId, userId: sides.b.userId, requestId: 'req-calendar-iso' });
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    let before: Awaited<ReturnType<typeof snapshotA>>;
    beforeEach(async () => {
        before = await snapshotA();
        for (const rows of before) expect(rows.length).toBeGreaterThan(0);
    });
    afterEach(async () => {
        expect((await snapshotA()).map((r) => r.length)).toEqual(before.map((r) => r.length));
    });

    describe.each(TABLES)('$model', (t) => {
        it('B reads none of A: a count of A is zero and an unfiltered list holds only B rows', async () => {
            const [inA, rows] = await runInTenantContext(ctxB, async (db) => [
                await delegateOf(db, t.delegate).count({ where: { tenantId: sides.a!.tenantId } }),
                await delegateOf(db, t.delegate).findMany({ select: { tenantId: true } }),
            ] as const);
            expect(inA).toBe(0);
            expect(rows.length).toBeGreaterThan(0);
            expect(new Set(rows.map((r) => r.tenantId))).toEqual(new Set([sides.b!.tenantId]));
        });

        it('updateMany over A changes nothing', async () => {
            const updated = await runInTenantContext(ctxB, (db) => delegateOf(db, t.delegate).updateMany({ where: { tenantId: sides.a!.tenantId }, data: t.update }));
            expect(updated.count).toBe(0);
        });

        it(t.deletable ? 'deleteMany over A removes nothing' : 'a delete is refused by privilege', async () => {
            if (t.deletable) {
                // The synced event first: a connection is never deleted before its events (the key is NO ACTION).
                const deleted = await runInTenantContext(ctxB, (db) => delegateOf(db, t.delegate).deleteMany({ where: { tenantId: sides.a!.tenantId } }));
                expect(deleted.count).toBe(0);
            } else {
                await expect(runInTenantContext(ctxB, (db) => delegateOf(db, t.delegate).deleteMany({ where: { tenantId: sides.b!.tenantId } }))).rejects.toThrow(/permission denied/i);
            }
        });

        it('an insert carrying A id is refused', async () => {
            await expect(runInTenantContext(ctxB, (db) => delegateOf(db, t.delegate).create({ data: t.insert(sides.a!) }))).rejects.toThrow();
        });
    });

    it("a synced event cannot point B at A's connection: the composite key refuses it (raw client, RLS bypassed)", async () => {
        await expect(prisma.calendarSyncedEvent.create({ data: { ...event(sides.a!, 'cross'), tenantId: sides.b!.tenantId } })).rejects.toThrow();
    });

    it('a connection is never deleted while it has a synced event (the teardown deletes the events first)', async () => {
        await expect(prisma.calendarConnection.delete({ where: { id: sides.b!.connectionId } })).rejects.toThrow();
    });
});
