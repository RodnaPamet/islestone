/**
 * Two-tenant isolation for the fourteen tenant tables of sub-phases 2.1–2.2
 * (roadmap section 4: every tenant table gets a two-tenant test):
 * Team, WorkflowState, Project, ProjectKeyPrefix, ProjectKeySequence,
 * WorkItemType, WorkItem, WorkItemKeyAlias, WorkItemRelation, Label,
 * WorkItemLabel, Comment, WorkItemWatcher and WorkItemLink; and, from
 * sub-phase 2.4, CustomField, CustomFieldOption, CustomFieldValue and
 * SavedView; and, from sub-phase 2.5a, CycleSchedule, Cycle and
 * WorkItemTransition (which app_user may only read: its writer is a trigger);
 * and, from sub-phase 2.5b, Milestone.
 *
 * Every operation runs through `runInTenantContext` as tenant B, i.e. as
 * `app_user` with `app.tenant_id` = B: none may read, count, change or remove
 * tenant A's rows, or create one in A. Tenant A's rows are re-read through the
 * login role after each case, so a check cannot pass because the row was
 * never there; B reads its own rows, so the policy is not deny-all.
 *
 * The key bookkeeping (ProjectKeyPrefix, ProjectKeySequence,
 * WorkItemKeyAlias) is stricter than RLS: `app_user` holds no DELETE on it.
 *
 * Copied in pattern from inflect-compliance `tests/integration/task-isolation.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (extended to every work table)
 * and from Islestone's `notification-tables-isolation.test.ts`.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { runInTenantContext } from '@/lib/db/rls-middleware';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';
import { seedWorkItem, seedWorkWorld, type WorkWorld } from '../helpers/work-fixture';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

const SUFFIX = `workiso_${Date.now()}`;

interface Side {
    tenantId: string;
    userId: string;
    world: WorkWorld;
    itemId: string;
    otherItemId: string;
    labelId: string;
    commentId: string;
    linkId: string;
    relationId: string;
    fieldId: string;
    optionId: string;
    cycleId: string;
    milestoneId: string;
}

type Delegate = {
    count: (args: { where: Record<string, unknown> }) => Promise<number>;
    findMany: (args: { where?: Record<string, unknown>; select: Record<string, boolean> }) => Promise<Array<{ tenantId: string }>>;
    updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
    deleteMany: (args: { where: Record<string, unknown> }) => Promise<{ count: number }>;
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
};

/** Per table: the delegate, a harmless update, whether app_user may delete, and an insert for a side. */
const TABLES: ReadonlyArray<{
    model: string;
    delegate: string;
    update: Record<string, unknown>;
    deletable: boolean;
    /** app_user may only read (SELECT): updates and inserts are refused by privilege. */
    readOnly?: boolean;
    insert: (s: Side) => Record<string, unknown>;
}> = [
    { model: 'Team', delegate: 'team', update: { name: 'renamed' }, deletable: true, insert: (s) => ({ tenantId: s.tenantId, name: `planted-${SUFFIX}` }) },
    {
        model: 'WorkflowState',
        delegate: 'workflowState',
        update: { name: 'renamed' },
        deletable: true,
        insert: (s) => ({ tenantId: s.tenantId, teamId: s.world.teamId, name: 'planted', category: 'BACKLOG', sortKey: 'z' }),
    },
    {
        model: 'Project',
        delegate: 'project',
        update: { name: 'renamed' },
        deletable: true,
        insert: (s) => ({ tenantId: s.tenantId, teamId: s.world.teamId, name: 'planted', keyPrefix: 'PLANT' }),
    },
    {
        model: 'ProjectKeyPrefix',
        delegate: 'projectKeyPrefix',
        update: { retiredAt: new Date() },
        deletable: false,
        insert: (s) => ({ tenantId: s.tenantId, prefix: 'PLANTED', projectId: s.world.projectId }),
    },
    {
        model: 'ProjectKeySequence',
        delegate: 'projectKeySequence',
        update: { lastValue: 999 },
        deletable: false,
        insert: (s) => ({ tenantId: s.tenantId, projectId: `planted-${SUFFIX}` }),
    },
    { model: 'WorkItemType', delegate: 'workItemType', update: { name: 'renamed' }, deletable: true, insert: (s) => ({ tenantId: s.tenantId, name: 'Planted', sortKey: 'z' }) },
    {
        model: 'WorkItem',
        delegate: 'workItem',
        update: { title: 'renamed' },
        deletable: true,
        insert: (s) => ({
            tenantId: s.tenantId,
            teamId: s.world.teamId,
            projectId: s.world.projectId,
            number: 999,
            typeId: s.world.typeId,
            title: 'planted',
            stateId: s.world.defaultStateId,
            stateCategory: 'UNSTARTED',
            createdByUserId: s.userId,
            sortKey: 'z',
        }),
    },
    {
        model: 'WorkItemKeyAlias',
        delegate: 'workItemKeyAlias',
        update: { workItemId: 'moved' },
        deletable: false,
        insert: (s) => ({ tenantId: s.tenantId, projectId: s.world.projectId, number: 998, workItemId: s.itemId }),
    },
    {
        model: 'WorkItemRelation',
        delegate: 'workItemRelation',
        update: { createdAt: new Date() },
        deletable: true,
        insert: (s) => ({ tenantId: s.tenantId, type: 'BLOCKS', fromId: s.otherItemId, toId: s.itemId, createdByUserId: s.userId }),
    },
    { model: 'Label', delegate: 'label', update: { name: 'renamed' }, deletable: true, insert: (s) => ({ tenantId: s.tenantId, name: 'planted', sortKey: 'z' }) },
    {
        model: 'WorkItemLabel',
        delegate: 'workItemLabel',
        update: { createdAt: new Date() },
        deletable: true,
        insert: (s) => ({ tenantId: s.tenantId, workItemId: s.otherItemId, labelId: s.labelId }),
    },
    {
        model: 'Comment',
        delegate: 'comment',
        update: { body: 'rewritten' },
        deletable: true,
        insert: (s) => ({ tenantId: s.tenantId, workItemId: s.itemId, authorUserId: s.userId, body: 'planted' }),
    },
    {
        model: 'WorkItemWatcher',
        delegate: 'workItemWatcher',
        update: { createdAt: new Date() },
        deletable: true,
        insert: (s) => ({ tenantId: s.tenantId, workItemId: s.otherItemId, userId: s.userId }),
    },
    {
        model: 'WorkItemLink',
        delegate: 'workItemLink',
        update: { title: 'renamed' },
        deletable: true,
        insert: (s) => ({ tenantId: s.tenantId, workItemId: s.itemId, type: 'URL', location: 'https://example.com/p', createdByUserId: s.userId }),
    },
    // Sub-phase 2.4.
    {
        model: 'CustomField',
        delegate: 'customField',
        update: { name: 'renamed' },
        deletable: true,
        insert: (s) => ({ tenantId: s.tenantId, projectId: s.world.projectId, name: 'planted', type: 'TEXT', sortKey: 'z' }),
    },
    {
        model: 'CustomFieldOption',
        delegate: 'customFieldOption',
        update: { name: 'renamed' },
        deletable: true,
        insert: (s) => ({ tenantId: s.tenantId, fieldId: s.fieldId, name: 'planted', sortKey: 'z' }),
    },
    {
        model: 'CustomFieldValue',
        delegate: 'customFieldValue',
        update: { createdAt: new Date() },
        deletable: true,
        insert: (s) => ({
            tenantId: s.tenantId,
            projectId: s.world.projectId,
            workItemId: s.otherItemId,
            fieldId: s.fieldId,
            fieldType: 'SELECT',
            optionId: s.optionId,
        }),
    },
    {
        model: 'SavedView',
        delegate: 'savedView',
        update: { name: 'renamed' },
        deletable: true,
        insert: (s) => ({ tenantId: s.tenantId, name: 'planted', visibility: 'SHARED', layout: 'LIST', configJson: {}, createdByUserId: s.userId }),
    },
    {
        model: 'CycleSchedule',
        delegate: 'cycleSchedule',
        update: { upcomingCount: 3 },
        deletable: true,
        insert: (s) => ({ tenantId: s.tenantId, teamId: s.world.teamId, firstStartsOn: new Date('2027-01-04T00:00:00Z') }),
    },
    {
        model: 'Cycle',
        delegate: 'cycle',
        update: { name: 'renamed' },
        deletable: true,
        insert: (s) => ({
            tenantId: s.tenantId,
            teamId: s.world.teamId,
            number: 99,
            startsOn: new Date('2030-01-01T00:00:00Z'),
            endsOn: new Date('2030-01-14T00:00:00Z'),
        }),
    },
    {
        model: 'Milestone',
        delegate: 'milestone',
        update: { name: 'renamed' },
        deletable: true,
        insert: (s) => ({ tenantId: s.tenantId, projectId: s.world.projectId, name: 'planted', sortKey: 'z' }),
    },
    {
        model: 'WorkItemTransition',
        delegate: 'workItemTransition',
        update: { deleted: true },
        deletable: false,
        readOnly: true,
        insert: (s) => ({
            tenantId: s.tenantId,
            workItemId: s.itemId,
            projectId: s.world.projectId,
            teamId: s.world.teamId,
            stateId: s.world.defaultStateId,
            stateCategory: 'UNSTARTED',
            deleted: false,
        }),
    },
];

describeFn('work tables — two-tenant isolation as app_user', () => {
    let prisma: PrismaClient;
    const sides: { a?: Side; b?: Side } = {};
    let ctxB: RequestContext;

    async function seedSide(tag: string, prefix: string): Promise<Side> {
        const tenant = await prisma.tenant.create({ data: { name: tag, slug: `${tag}-${SUFFIX}` } });
        const user = await prisma.user.create({ data: { email: `${tag}-${SUFFIX}@example.com` } });
        await prisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id, role: 'OWNER' } });
        const world = await seedWorkWorld(prisma, tenant.id, { keyPrefix: prefix });
        const item = await seedWorkItem(prisma, tenant.id, world, { title: `${tag} item`, createdByUserId: user.id, sortKey: 'V' });
        const other = await seedWorkItem(prisma, tenant.id, world, { title: `${tag} other`, createdByUserId: user.id, sortKey: 'k' });
        const label = await prisma.label.create({ data: { tenantId: tenant.id, name: `${tag} label`, sortKey: 'V' } });
        await prisma.workItemLabel.create({ data: { tenantId: tenant.id, workItemId: item.id, labelId: label.id } });
        const comment = await prisma.comment.create({ data: { tenantId: tenant.id, workItemId: item.id, authorUserId: user.id, body: 'hello' } });
        await prisma.workItemWatcher.create({ data: { tenantId: tenant.id, workItemId: item.id, userId: user.id } });
        const link = await prisma.workItemLink.create({
            data: { tenantId: tenant.id, workItemId: item.id, type: 'URL', location: 'https://example.com', createdByUserId: user.id },
        });
        const relation = await prisma.workItemRelation.create({
            data: { tenantId: tenant.id, type: 'BLOCKS', fromId: item.id, toId: other.id, createdByUserId: user.id },
        });
        await prisma.workItemKeyAlias.create({ data: { tenantId: tenant.id, projectId: world.projectId, number: 500, workItemId: item.id } });
        const field = await prisma.customField.create({
            data: { tenantId: tenant.id, projectId: world.projectId, name: `${tag} stage`, type: 'SELECT', sortKey: 'V' },
        });
        const option = await prisma.customFieldOption.create({ data: { tenantId: tenant.id, fieldId: field.id, name: 'One', sortKey: 'V' } });
        await prisma.customFieldValue.create({
            data: { tenantId: tenant.id, projectId: world.projectId, workItemId: item.id, fieldId: field.id, fieldType: 'SELECT', optionId: option.id },
        });
        await prisma.savedView.create({
            data: { tenantId: tenant.id, name: `${tag} view`, visibility: 'SHARED', layout: 'LIST', configJson: {}, createdByUserId: user.id },
        });
        await prisma.cycleSchedule.create({ data: { tenantId: tenant.id, teamId: world.teamId, firstStartsOn: new Date('2026-11-02T00:00:00Z') } });
        const cycle = await prisma.cycle.create({
            data: { tenantId: tenant.id, teamId: world.teamId, number: 1, startsOn: new Date('2026-11-02T00:00:00Z'), endsOn: new Date('2026-11-15T00:00:00Z') },
        });
        // Putting the item in the cycle writes a transition (the trigger).
        await prisma.workItem.update({ where: { id: item.id }, data: { cycleId: cycle.id } });
        const milestone = await prisma.milestone.create({ data: { tenantId: tenant.id, projectId: world.projectId, name: `${tag} beta`, sortKey: 'V' } });
        await prisma.workItem.update({ where: { id: other.id }, data: { milestoneId: milestone.id } });
        return {
            cycleId: cycle.id,
            milestoneId: milestone.id,
            fieldId: field.id,
            optionId: option.id,
            tenantId: tenant.id,
            userId: user.id,
            world,
            itemId: item.id,
            otherItemId: other.id,
            labelId: label.id,
            commentId: comment.id,
            linkId: link.id,
            relationId: relation.id,
        };
    }

    const delegateOf = (db: unknown, name: string) => (db as Record<string, Delegate>)[name]!;

    const snapshotA = async () =>
        Promise.all(TABLES.map((t) => delegateOf(prisma, t.delegate).findMany({ where: { tenantId: sides.a!.tenantId }, select: { tenantId: true } })));

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        sides.a = await seedSide('a', 'AAA');
        sides.b = await seedSide('b', 'BBB');
        ctxB = makeRequestContext('OWNER', { tenantId: sides.b.tenantId, userId: sides.b.userId, requestId: 'req-work-iso' });
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

        it(t.readOnly ? 'an update is refused by privilege' : 'updateMany over A changes nothing', async () => {
            if (t.readOnly) {
                await expect(
                    runInTenantContext(ctxB, (db) => delegateOf(db, t.delegate).updateMany({ where: { tenantId: sides.b!.tenantId }, data: t.update })),
                ).rejects.toThrow(/permission denied/i);
                return;
            }
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

    it('a custom-field value cannot point B at A, or at another project\'s field (raw client, RLS bypassed)', async () => {
        const a = sides.a!;
        const b = sides.b!;
        await expect(
            prisma.customFieldValue.create({
                data: { tenantId: b.tenantId, projectId: a.world.projectId, workItemId: a.otherItemId, fieldId: a.fieldId, fieldType: 'SELECT', optionId: a.optionId },
            }),
        ).rejects.toThrow();
        await expect(
            prisma.customFieldValue.create({
                data: { tenantId: b.tenantId, projectId: b.world.projectId, workItemId: b.otherItemId, fieldId: b.fieldId, fieldType: 'SELECT', optionId: a.optionId },
            }),
        ).rejects.toThrow();
    });

    it('a child row cannot point B at A: the composite FKs refuse a cross-tenant parent (raw client, RLS bypassed)', async () => {
        // FK checks run as the table owner and bypass RLS; the composite
        // (id, tenantId) keys are what make the reference unrepresentable.
        await expect(
            prisma.comment.create({ data: { tenantId: sides.b!.tenantId, workItemId: sides.a!.itemId, authorUserId: sides.b!.userId, body: 'x' } }),
        ).rejects.toThrow();
        await expect(
            prisma.workItemRelation.create({
                data: { tenantId: sides.b!.tenantId, type: 'RELATES', fromId: sides.b!.itemId, toId: sides.a!.itemId, createdByUserId: sides.b!.userId },
            }),
        ).rejects.toThrow();
        await expect(
            prisma.workItem.create({
                data: {
                    tenantId: sides.b!.tenantId,
                    teamId: sides.a!.world.teamId,
                    projectId: sides.a!.world.projectId,
                    number: 77,
                    typeId: sides.b!.world.typeId,
                    title: 'cross',
                    stateId: sides.a!.world.defaultStateId,
                    stateCategory: 'UNSTARTED',
                    createdByUserId: sides.b!.userId,
                    sortKey: 'x',
                },
            }),
        ).rejects.toThrow();
    });
});
