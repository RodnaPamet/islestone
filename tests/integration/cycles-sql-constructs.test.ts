/**
 * What migration `20261121120000_cycles_and_transitions` adds beyond Prisma
 * (sub-phase 2.5a), each checked in the catalogue AND by its bite:
 *
 *   - `Cycle_no_overlap` (btree_gist exclusion) refuses overlapping cycles of
 *     one team and admits another team's; the date and range CHECKs refuse;
 *   - the composite FK refuses an item in another team's cycle, and RESTRICT
 *     refuses deleting a cycle an item names;
 *   - `work_item_transition_record` writes exactly one row per insert and per
 *     change of state, cycle, project or deletion, none for another column,
 *     also when the change runs as `app_user`;
 *   - `app_user` cannot insert, update or delete a transition itself.
 */
import type { PrismaClient } from '@prisma/client';

import { runInTenantContext } from '@/lib/db/rls-middleware';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';
import { seedWorkItem, seedWorkWorld, type WorkWorld } from '../helpers/work-fixture';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `cysql${Date.now().toString(36)}`;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describeFn('cycles: SQL constructs', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let userId = '';
    let world: WorkWorld;
    let otherTeamId = '';

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await prisma.tenant.create({ data: { name: TAG, slug: TAG } })).id;
        userId = (await prisma.user.create({ data: { email: `${TAG}@example.test` } })).id;
        await prisma.tenantMembership.create({ data: { tenantId, userId, role: 'OWNER' } });
        world = await seedWorkWorld(prisma, tenantId, { keyPrefix: 'CYS' });
        otherTeamId = (await prisma.team.create({ data: { tenantId, name: `Other ${TAG}` } })).id;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    const cycle = (teamId: string, number: number, startsOn: string, endsOn: string) =>
        prisma.cycle.create({ data: { tenantId, teamId, number, startsOn: d(startsOn), endsOn: d(endsOn) } });

    it('the catalogue holds the exclusion constraint, the CHECKs and the two triggers', async () => {
        const constraints = await prisma.$queryRaw<Array<{ conname: string; contype: string }>>`
            SELECT conname::text AS conname, contype::text AS contype FROM pg_constraint
             WHERE conrelid IN ('"Cycle"'::regclass, '"CycleSchedule"'::regclass) AND contype IN ('x', 'c')`;
        expect(constraints.map((c) => `${c.contype}:${c.conname}`).sort()).toEqual([
            'c:CycleSchedule_length_range',
            'c:CycleSchedule_upcoming_range',
            'c:Cycle_dates_ordered',
            'c:Cycle_number_positive',
            'x:Cycle_no_overlap',
        ]);
        const triggers = await prisma.$queryRaw<Array<{ tgname: string }>>`
            SELECT tgname::text AS tgname FROM pg_trigger WHERE tgrelid = '"WorkItem"'::regclass AND tgname LIKE 'work_item_transition_%' ORDER BY tgname`;
        expect(triggers.map((t) => t.tgname)).toEqual(['work_item_transition_insert', 'work_item_transition_update']);
        const [fn] = await prisma.$queryRaw<Array<{ prosecdef: boolean }>>`
            SELECT prosecdef FROM pg_proc WHERE proname = 'work_item_transition_record'`;
        expect(fn?.prosecdef).toBe(true);
    });

    it('refuses overlapping cycles of one team, inclusive at both ends, and admits another team\'s', async () => {
        await cycle(world.teamId, 1, '2030-01-01', '2030-01-14');
        await expect(cycle(world.teamId, 2, '2030-01-14', '2030-01-20')).rejects.toThrow(/Cycle_no_overlap|exclusion|conflicting/i);
        await expect(cycle(world.teamId, 2, '2029-12-20', '2030-01-01')).rejects.toThrow();
        await expect(cycle(world.teamId, 2, '2030-01-15', '2030-01-28')).resolves.toBeDefined();
        await expect(cycle(otherTeamId, 1, '2030-01-05', '2030-01-10')).resolves.toBeDefined();
    });

    it('refuses an end before the start, a number below 1 and a schedule out of range', async () => {
        await expect(cycle(world.teamId, 9, '2031-02-10', '2031-02-01')).rejects.toThrow(/Cycle_dates_ordered/);
        await expect(cycle(world.teamId, 0, '2031-03-01', '2031-03-02')).rejects.toThrow(/Cycle_number_positive/);
        await expect(
            prisma.cycleSchedule.create({ data: { tenantId, teamId: world.teamId, lengthWeeks: 9, firstStartsOn: d('2031-01-06') } }),
        ).rejects.toThrow(/CycleSchedule_length_range/);
        await expect(
            prisma.cycleSchedule.create({ data: { tenantId, teamId: world.teamId, upcomingCount: 0, firstStartsOn: d('2031-01-06') } }),
        ).rejects.toThrow(/CycleSchedule_upcoming_range/);
    });

    it('refuses an item in another team\'s cycle, and a delete of a cycle an item names', async () => {
        const mine = await cycle(world.teamId, 20, '2032-01-01', '2032-01-14');
        const theirs = await cycle(otherTeamId, 20, '2032-01-01', '2032-01-14');
        const item = await seedWorkItem(prisma, tenantId, world, { title: 'fk', createdByUserId: userId, sortKey: 'F' });
        await expect(prisma.workItem.update({ where: { id: item.id }, data: { cycleId: theirs.id } })).rejects.toThrow();
        await prisma.workItem.update({ where: { id: item.id }, data: { cycleId: mine.id } });
        await expect(prisma.cycle.delete({ where: { id: mine.id } })).rejects.toThrow();
    });

    it('writes one transition per insert and per relevant change, none for a title edit, also as app_user', async () => {
        const c = await cycle(world.teamId, 30, '2033-01-01', '2033-01-14');
        const item = await seedWorkItem(prisma, tenantId, world, { title: 'tr', createdByUserId: userId, sortKey: 'T' });
        const rows = () => prisma.workItemTransition.findMany({ where: { workItemId: item.id }, orderBy: [{ at: 'asc' }, { id: 'asc' }] });
        expect(await rows()).toHaveLength(1);

        await prisma.workItem.update({ where: { id: item.id }, data: { title: 'renamed', priority: 'HIGH' } });
        expect(await rows()).toHaveLength(1);

        const ctx = makeRequestContext('OWNER', { tenantId, userId, requestId: `${TAG}-tr` });
        const done = world.states['Done']!;
        await runInTenantContext(ctx, async (db) => {
            await db.workItem.update({ where: { id: item.id }, data: { cycleId: c.id } });
            await db.workItem.update({ where: { id: item.id }, data: { stateId: done.id, stateCategory: 'DONE' } });
            await db.workItem.update({ where: { id: item.id }, data: { deletedAt: new Date() } });
        });
        const after = await rows();
        expect(after.map((r) => [r.cycleId, r.stateCategory, r.deleted])).toEqual([
            [null, after[0]!.stateCategory, false],
            [c.id, after[0]!.stateCategory, false],
            [c.id, 'DONE', false],
            [c.id, 'DONE', true],
        ]);
        expect(after.every((r) => r.tenantId === tenantId && r.projectId === world.projectId && r.teamId === world.teamId)).toBe(true);
        // Ordered within one transaction: the wall clock, then the sequence.
        for (let i = 1; i < after.length; i++) expect(after[i]!.id > after[i - 1]!.id).toBe(true);
    });

    it('app_user may read transitions but not insert, update or delete one', async () => {
        const ctx = makeRequestContext('OWNER', { tenantId, userId, requestId: `${TAG}-ro` });
        const [first] = await runInTenantContext(ctx, (db) => db.workItemTransition.findMany({ take: 1, select: { id: true, workItemId: true } }));
        expect(first).toBeDefined();
        await expect(
            runInTenantContext(ctx, (db) =>
                db.workItemTransition.create({
                    data: { tenantId, workItemId: first!.workItemId, projectId: world.projectId, teamId: world.teamId, stateId: world.defaultStateId, stateCategory: 'DONE', deleted: false },
                }),
            ),
        ).rejects.toThrow(/permission denied/i);
        await expect(runInTenantContext(ctx, (db) => db.workItemTransition.updateMany({ where: { tenantId }, data: { deleted: true } }))).rejects.toThrow(/permission denied/i);
        await expect(runInTenantContext(ctx, (db) => db.workItemTransition.deleteMany({ where: { tenantId } }))).rejects.toThrow(/permission denied/i);
    });
});
