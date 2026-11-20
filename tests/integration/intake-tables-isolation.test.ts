/**
 * Two-tenant isolation for the four tenant tables of sub-phase 2.6a
 * (roadmap section 4): ProjectIntake, IntakeNotifyMember, IntakeForm and
 * IntakeRequest.
 *
 * Every operation runs through `runInTenantContext` as tenant B, i.e. as
 * `app_user` with `app.tenant_id` = B: none may read, count, change or remove
 * tenant A's rows, or create one in A. Tenant A's rows are re-read through the
 * login role after each case, so a check cannot pass because the row was
 * never there; B reads its own rows, so the policy is not deny-all. The two
 * configuration tables (ProjectIntake, IntakeForm) are archive-only:
 * `app_user` holds no DELETE on them.
 *
 * Written in the pattern of `work-tables-isolation.test.ts`.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { runInTenantContext } from '@/lib/db/rls-middleware';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';
import { seedWorkWorld, type WorkWorld } from '../helpers/work-fixture';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

const SUFFIX = `intakeiso_${Date.now()}`;

interface Side {
    tenantId: string;
    userId: string;
    world: WorkWorld;
    formId: string;
}

type Delegate = {
    count: (args: { where: Record<string, unknown> }) => Promise<number>;
    findMany: (args: { where?: Record<string, unknown>; select: Record<string, boolean> }) => Promise<Array<{ tenantId: string }>>;
    updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
    deleteMany: (args: { where: Record<string, unknown> }) => Promise<{ count: number }>;
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
};

const TABLES: ReadonlyArray<{
    model: string;
    delegate: string;
    update: Record<string, unknown>;
    deletable: boolean;
    insert: (s: Side) => Record<string, unknown>;
}> = [
    {
        model: 'ProjectIntake',
        delegate: 'projectIntake',
        update: { enabled: false },
        deletable: false,
        insert: (s) => ({ tenantId: s.tenantId, projectId: s.world.projectId }),
    },
    {
        model: 'IntakeNotifyMember',
        delegate: 'intakeNotifyMember',
        update: { createdAt: new Date() },
        deletable: true,
        insert: (s) => ({ tenantId: s.tenantId, projectId: s.world.projectId, userId: s.userId }),
    },
    {
        model: 'IntakeForm',
        delegate: 'intakeForm',
        update: { name: 'renamed' },
        deletable: false,
        insert: (s) => ({
            tenantId: s.tenantId,
            projectId: s.world.projectId,
            name: `planted-${SUFFIX}`,
            publicId: `planted-${SUFFIX}-${s.tenantId}`,
            definitionJson: {},
            createdByUserId: s.userId,
        }),
    },
    {
        model: 'IntakeRequest',
        delegate: 'intakeRequest',
        update: { title: 'renamed' },
        deletable: true,
        insert: (s) => ({
            tenantId: s.tenantId,
            projectId: s.world.projectId,
            channel: 'INTERNAL_FORM',
            formId: s.formId,
            title: 'planted',
            requesterUserId: s.userId,
        }),
    },
];

describeFn('intake tables — two-tenant isolation as app_user', () => {
    let prisma: PrismaClient;
    const sides: { a?: Side; b?: Side } = {};
    let ctxB: RequestContext;

    async function seedSide(tag: string, prefix: string): Promise<Side> {
        const tenant = await prisma.tenant.create({ data: { name: tag, slug: `${tag}-${SUFFIX}` } });
        const user = await prisma.user.create({ data: { email: `${tag}-${SUFFIX}@example.com` } });
        await prisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id, role: 'OWNER' } });
        const world = await seedWorkWorld(prisma, tenant.id, { keyPrefix: prefix });
        await prisma.projectIntake.create({ data: { tenantId: tenant.id, projectId: world.projectId } });
        await prisma.intakeNotifyMember.create({ data: { tenantId: tenant.id, projectId: world.projectId, userId: user.id } });
        const form = await prisma.intakeForm.create({
            data: { tenantId: tenant.id, projectId: world.projectId, name: `${tag} form`, publicId: `${tag}-${SUFFIX}`, definitionJson: {}, createdByUserId: user.id },
        });
        await prisma.intakeRequest.create({
            data: { tenantId: tenant.id, projectId: world.projectId, channel: 'INTERNAL_FORM', formId: form.id, title: `${tag} request`, requesterUserId: user.id },
        });
        return { tenantId: tenant.id, userId: user.id, world, formId: form.id };
    }

    const delegateOf = (db: unknown, name: string) => (db as Record<string, Delegate>)[name]!;

    const snapshotA = async () =>
        Promise.all(TABLES.map((t) => delegateOf(prisma, t.delegate).findMany({ where: { tenantId: sides.a!.tenantId }, select: { tenantId: true } })));

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        sides.a = await seedSide('a', 'AAA');
        sides.b = await seedSide('b', 'BBB');
        ctxB = makeRequestContext('OWNER', { tenantId: sides.b.tenantId, userId: sides.b.userId, requestId: 'req-intake-iso' });
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
            const updated = await runInTenantContext(ctxB, (db) =>
                delegateOf(db, t.delegate).updateMany({ where: { tenantId: sides.a!.tenantId }, data: t.update }),
            );
            expect(updated.count).toBe(0);
        });

        it(t.deletable ? 'deleteMany over A removes nothing' : 'a delete is refused by privilege', async () => {
            if (t.deletable) {
                const deleted = await runInTenantContext(ctxB, (db) => delegateOf(db, t.delegate).deleteMany({ where: { tenantId: sides.a!.tenantId } }));
                expect(deleted.count).toBe(0);
            } else {
                await expect(
                    runInTenantContext(ctxB, (db) => delegateOf(db, t.delegate).deleteMany({ where: { tenantId: sides.b!.tenantId } })),
                ).rejects.toThrow(/permission denied/i);
            }
        });

        it('an insert carrying A id is refused', async () => {
            await expect(runInTenantContext(ctxB, (db) => delegateOf(db, t.delegate).create({ data: t.insert(sides.a!) }))).rejects.toThrow();
        });
    });

    it('a request cannot point B at A: the composite FKs refuse a cross-tenant project or form (raw client, RLS bypassed)', async () => {
        const a = sides.a!;
        const b = sides.b!;
        await expect(
            prisma.intakeRequest.create({
                data: { tenantId: b.tenantId, projectId: a.world.projectId, channel: 'INTERNAL_FORM', title: 'x', requesterUserId: b.userId },
            }),
        ).rejects.toThrow();
        await expect(
            prisma.intakeRequest.create({
                data: { tenantId: b.tenantId, projectId: b.world.projectId, channel: 'INTERNAL_FORM', formId: a.formId, title: 'x', requesterUserId: b.userId },
            }),
        ).rejects.toThrow();
        await expect(
            prisma.intakeNotifyMember.create({ data: { tenantId: b.tenantId, projectId: b.world.projectId, userId: a.userId } }),
        ).rejects.toThrow();
    });
});
