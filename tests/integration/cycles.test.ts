/**
 * Cycles against a real Postgres, as `app_user` (sub-phase 2.5a;
 * docs/porting/maps/2.5.md; owner decisions 62 to 75):
 *
 *   - one-off cycles: the overlap refusal, the date rules, delete of an
 *     upcoming cycle clearing its items, read-only completed cycles;
 *   - the schedule: saving fills the current window and the upcoming count,
 *     a re-save makes nothing twice and replaces only empty schedule cycles;
 *   - an item's cycle: another team's refused, a completed one refused, the
 *     version increases, the audit entry, the list filter (ids, none,
 *     current), the counts, and a cross-team move clearing it;
 *   - the burn-up from the transition record;
 *   - the rollover: closes once, moves unfinished items to the next cycle,
 *     leaves done, archived-project and deleted items behind, honours
 *     NO_CYCLE, writes as the system user (`actorType: 'JOB'`), and a second
 *     run changes nothing;
 *   - who may do what (VIEWER reads, MEMBER manages, GUEST nothing to see);
 *   - every write audited, and the chain verifies.
 */
import type { PrismaClient } from '@prisma/client';

import { buildTenantSystemJobContext } from '@/app-layer/context-system';
import type { RequestContext } from '@/app-layer/types';
import { addDays, dayKey } from '@/app-layer/domain/cycle';
import { todayInTz } from '@/app-layer/notifications/work-item-due';
import {
    createCycle,
    deleteCycle,
    getCycle,
    getCycleBurnUp,
    getCycleSchedule,
    listCycles,
    setCycleSchedule,
    setWorkItemCycle,
    updateCycle,
} from '@/app-layer/usecases/cycle';
import { rolloverWorkspaceCycles } from '@/app-layer/usecases/cycle-rollover';
import { createProject, setProjectArchived } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createWorkItem, deleteWorkItem, getWorkItem, listWorkItems, setWorkItemState } from '@/app-layer/usecases/work-item';
import { moveWorkItemToProject } from '@/app-layer/usecases/work-item-moves';
import { getWorkItemViewConfig } from '@/app-layer/usecases/work-item-views';
import { verifyAuditChain } from '@/lib/audit';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `cyc${Date.now().toString(36)}`;

describeFn('cycles', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let member: RequestContext;
    let viewer: RequestContext;
    let guest: RequestContext;
    let teamId = '';
    let otherTeamId = '';
    let projectId = '';
    let otherProjectId = '';
    let typeId = '';
    let doneStateId = '';
    let startedStateId = '';
    let today: Date;
    const savedTz = process.env.NOTIFICATIONS_TZ;
    const k = (n: number) => dayKey(addDays(today, n));

    beforeAll(async () => {
        process.env.NOTIFICATIONS_TZ = 'UTC';
        today = todayInTz(new Date(), 'UTC');
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const mk = async (role: 'OWNER' | 'MEMBER' | 'VIEWER' | 'GUEST', n: string) => {
            const u = await prisma.user.create({ data: { email: `${n}-${TAG}@example.test`, name: n } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            return makeRequestContext(role, { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-${n}` });
        };
        owner = await mk('OWNER', 'olive');
        member = await mk('MEMBER', 'max');
        viewer = await mk('VIEWER', 'vic');
        guest = await mk('GUEST', 'gus');
        const team = await createTeam(owner, { name: 'Core' });
        teamId = team.id;
        doneStateId = team.workflowStates.find((s) => s.category === 'DONE')!.id;
        startedStateId = team.workflowStates.find((s) => s.category === 'STARTED')!.id;
        otherTeamId = (await createTeam(owner, { name: 'Other' })).id;
        projectId = (await createProject(owner, { teamId, name: 'Cycles', keyPrefix: 'CYC' })).id;
        otherProjectId = (await createProject(owner, { teamId: otherTeamId, name: 'Elsewhere', keyPrefix: 'ELS' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
    });

    afterAll(async () => {
        process.env.NOTIFICATIONS_TZ = savedTz;
        await resetDatabase(prisma);
    });

    const newItem = (title: string, pid = projectId) => createWorkItem(owner, { projectId: pid, typeId, title });

    describe('one-off cycles', () => {
        it('a MEMBER creates one; an overlap is a 409; a VIEWER may read but not create', async () => {
            const c = await createCycle(member, { teamId, name: 'Launch', startsOn: k(100), endsOn: k(113) });
            expect(c).toMatchObject({ number: 1, name: 'Launch', status: 'upcoming', daysLeft: 14, fromSchedule: false });
            await expect(createCycle(member, { teamId, startsOn: k(113), endsOn: k(120) })).rejects.toMatchObject({
                status: 409,
                details: { reason: 'CYCLE_OVERLAP' },
            });
            await expect(createCycle(member, { teamId: otherTeamId, startsOn: k(100), endsOn: k(113) })).resolves.toMatchObject({ number: 1 });
            await expect(createCycle(viewer, { teamId, startsOn: k(200), endsOn: k(201) })).rejects.toMatchObject({ status: 403 });
            expect((await listCycles(viewer, { teamId })).map((x) => x.name)).toContain('Launch');
        });

        it('refuses a cycle that has already ended, an end before the start and a span past the limit', async () => {
            await expect(createCycle(owner, { teamId, startsOn: k(-20), endsOn: k(-1) })).rejects.toMatchObject({ status: 400 });
            await expect(createCycle(owner, { teamId, startsOn: k(300), endsOn: k(299) })).rejects.toMatchObject({ status: 400 });
            await expect(createCycle(owner, { teamId, startsOn: k(300), endsOn: k(500) })).rejects.toMatchObject({ status: 400 });
        });

        it('moves an upcoming cycle\'s dates; deleting it clears its items, which keep their keys', async () => {
            const c = await createCycle(owner, { teamId, startsOn: k(150), endsOn: k(156) });
            const moved = await updateCycle(owner, c.id, { startsOn: k(151), endsOn: k(160), name: 'Renamed' });
            expect(moved).toMatchObject({ startsOn: k(151), endsOn: k(160), name: 'Renamed' });
            const item = await newItem('in a doomed cycle');
            await setWorkItemCycle(owner, item.id, { cycleId: c.id });
            const res = await deleteCycle(owner, c.id);
            expect(res).toEqual({ deleted: true, clearedItems: 1 });
            const after = await getWorkItem(owner, item.id);
            expect(after.cycleId).toBeNull();
            expect(after.version).toBe(item.version + 2);
        });

        it('a started cycle keeps its start; only an upcoming cycle is deleted', async () => {
            const c = await createCycle(owner, { teamId, startsOn: k(-3), endsOn: k(10) }).catch(() => null);
            // The schedule tests below make the current window; this one-off owns today until then.
            expect(c).not.toBeNull();
            await expect(updateCycle(owner, c!.id, { startsOn: k(-2) })).rejects.toMatchObject({ status: 409, details: { reason: 'CYCLE_STARTED' } });
            await expect(updateCycle(owner, c!.id, { endsOn: k(-1) })).rejects.toMatchObject({ status: 400 });
            await expect(deleteCycle(owner, c!.id)).rejects.toMatchObject({ status: 409, details: { reason: 'CYCLE_NOT_UPCOMING' } });
            await expect(updateCycle(owner, c!.id, { endsOn: k(12) })).resolves.toMatchObject({ endsOn: k(12) });
        });
    });

    describe('an item\'s cycle', () => {
        it('refuses another team\'s cycle; a cycle change increases the version and is audited', async () => {
            const current = (await listCycles(owner, { teamId, status: 'current' }))[0]!;
            const theirs = (await listCycles(owner, { teamId: otherTeamId }))[0]!;
            const item = await newItem('planned');
            await expect(setWorkItemCycle(owner, item.id, { cycleId: theirs.id })).rejects.toMatchObject({ status: 400 });
            const after = await setWorkItemCycle(member, item.id, { cycleId: current.id }, item.version);
            expect(after.cycleId).toBe(current.id);
            expect(after.version).toBe(item.version + 1);
            await expect(setWorkItemCycle(member, item.id, { cycleId: null }, item.version)).rejects.toMatchObject({ status: 409 });
            await expect(setWorkItemCycle(viewer, item.id, { cycleId: null })).rejects.toMatchObject({ status: 403 });
            const entry = await prisma.auditLog.findFirst({ where: { tenantId, entityId: item.id, action: 'WORK_ITEM_CYCLE_CHANGED' } });
            expect(entry?.detailsJson).toMatchObject({ fromCycleId: null, toCycleId: current.id });
        });

        it('filters the list by cycle id, none and current, and counts the cycle\'s items', async () => {
            const current = (await listCycles(owner, { teamId, status: 'current' }))[0]!;
            const loose = await newItem('loose');
            const inCurrent = (await listWorkItems(owner, { cycleId: 'current' })).items.map((i) => i.title);
            expect(inCurrent).toContain('planned');
            expect(inCurrent).not.toContain('loose');
            expect((await listWorkItems(owner, { cycleId: current.id })).items.map((i) => i.title)).toEqual(inCurrent);
            expect((await listWorkItems(owner, { cycleId: 'none' })).items.map((i) => i.id)).toContain(loose.id);
            const read = await getCycle(viewer, current.id);
            expect(read.counts).toEqual({ scope: 1, started: 0, completed: 0 });
            expect(read.team).toEqual({ id: teamId, name: 'Core' });
            const config = await getWorkItemViewConfig(viewer);
            expect(config.cycles.map((c) => c.id)).toContain(current.id);
        });

        it('a move to another team\'s project clears the cycle', async () => {
            const current = (await listCycles(owner, { teamId, status: 'current' }))[0]!;
            const item = await newItem('travels');
            await setWorkItemCycle(owner, item.id, { cycleId: current.id });
            await moveWorkItemToProject(owner, item.id, { projectId: otherProjectId });
            expect((await getWorkItem(owner, item.id)).cycleId).toBeNull();
        });

        it('a GUEST sees no items, so no counts', async () => {
            const current = (await listCycles(owner, { teamId, status: 'current' }))[0]!;
            expect((await getCycle(guest, current.id)).counts).toEqual({ scope: 0, started: 0, completed: 0 });
            expect((await getCycleBurnUp(guest, current.id)).points.every((p) => p.scope === 0)).toBe(true);
        });
    });

    describe('the burn-up', () => {
        it('reads scope, started and completed from the transition record', async () => {
            const current = (await listCycles(owner, { teamId, status: 'current' }))[0]!;
            const a = await newItem('burn a');
            const b = await newItem('burn b');
            await setWorkItemCycle(owner, a.id, { cycleId: current.id });
            await setWorkItemCycle(owner, b.id, { cycleId: current.id });
            await setWorkItemState(owner, a.id, { stateId: startedStateId });
            await setWorkItemState(owner, b.id, { stateId: doneStateId });
            const { points, truncated } = await getCycleBurnUp(viewer, current.id);
            expect(truncated).toBe(false);
            expect(points[0]!.date).toBe(current.startsOn);
            expect(points.at(-1)).toEqual({ date: dayKey(today), scope: 3, started: 2, completed: 1 });
            expect((await getCycle(owner, current.id)).counts).toEqual({ scope: 3, started: 2, completed: 1 });
        });
    });

    describe('the schedule and the rollover', () => {
        it('saving a schedule fills the windows after the current cycle; a re-save makes nothing twice', async () => {
            const current = (await listCycles(owner, { teamId, status: 'current' }))[0]!;
            const before = await getCycleSchedule(viewer, teamId);
            expect(before.saved).toBe(false);
            // Two-week windows from the day after the one-off cycle ends.
            const first = addDays(new Date(`${current.endsOn}T00:00:00Z`), 1);
            const saved = await setCycleSchedule(member, teamId, { enabled: true, lengthWeeks: 2, firstStartsOn: dayKey(first), upcomingCount: 2, rollover: 'NEXT_CYCLE' });
            expect(saved).toMatchObject({ saved: true, enabled: true, created: 3, replaced: 0 });
            const again = await setCycleSchedule(member, teamId, { enabled: true, lengthWeeks: 2, firstStartsOn: dayKey(first), upcomingCount: 2, rollover: 'NEXT_CYCLE' });
            expect(again).toMatchObject({ created: 3, replaced: 3 });
            const scheduled = (await listCycles(owner, { teamId })).filter((c) => c.fromSchedule);
            expect(scheduled).toHaveLength(3);
            await expect(setCycleSchedule(viewer, teamId, { enabled: false, lengthWeeks: 2, firstStartsOn: dayKey(first), upcomingCount: 2, rollover: 'NEXT_CYCLE' })).rejects.toMatchObject({ status: 403 });
        });

        it('closes an ended cycle once, moving its unfinished items to the next cycle as the system user', async () => {
            const current = (await listCycles(owner, { teamId, status: 'current' }))[0]!;
            const inArchived = await createProject(owner, { teamId, name: 'Shelved', keyPrefix: 'SHV' });
            const shelved = await newItem('shelved', inArchived.id);
            await setWorkItemCycle(owner, shelved.id, { cycleId: current.id });
            await setProjectArchived(owner, inArchived.id, true);
            const gone = await newItem('gone');
            await setWorkItemCycle(owner, gone.id, { cycleId: current.id });
            await deleteWorkItem(owner, gone.id);

            const afterEnd = addDays(new Date(`${current.endsOn}T00:00:00Z`), 1);
            const sys = await buildTenantSystemJobContext({ tenantId, tenantSlug: TAG, job: 'cycle-rollover' });
            const first = await rolloverWorkspaceCycles(sys, afterEnd);
            expect(first.cyclesClosed).toBe(1);
            const closed = await getCycle(owner, current.id);
            expect(closed.status).toBe('completed');
            const next = (await listCycles(owner, { teamId })).find((c) => c.startsOn === dayKey(afterEnd))!;
            expect(next).toBeDefined();

            const titles = (await listWorkItems(owner, { cycleId: next.id })).items.map((i) => i.title).sort();
            expect(titles).toEqual(['burn a', 'planned']);
            expect((await listWorkItems(owner, { cycleId: current.id })).items.map((i) => i.title)).toEqual(['burn b']);
            const shelvedRow = await prisma.workItem.findUnique({ where: { id: shelved.id } });
            const goneRow = await prisma.workItem.findUnique({ where: { id: gone.id } });
            expect(shelvedRow?.cycleId).toBe(current.id);
            expect(goneRow?.cycleId).toBe(current.id);

            const moved = await prisma.auditLog.findMany({ where: { tenantId, action: 'WORK_ITEM_CYCLE_CHANGED', actorType: 'JOB' } });
            expect(moved).toHaveLength(2);
            expect(moved.every((m) => m.userId === sys.userId)).toBe(true);
            const completed = await prisma.auditLog.findFirst({ where: { tenantId, action: 'CYCLE_COMPLETED', entityId: current.id } });
            expect(completed?.metadataJson ?? completed?.detailsJson).toBeDefined();

            const second = await rolloverWorkspaceCycles(sys, afterEnd);
            expect(second).toMatchObject({ cyclesClosed: 0, itemsMoved: 0, cyclesCreated: 0 });
            await expect(setWorkItemCycle(owner, (await newItem('late')).id, { cycleId: current.id })).rejects.toMatchObject({
                status: 409,
                details: { reason: 'CYCLE_COMPLETED' },
            });
            await expect(updateCycle(owner, current.id, { name: 'x' })).rejects.toMatchObject({ status: 409, details: { reason: 'CYCLE_COMPLETED' } });
        });

        it('with NO_CYCLE, unfinished items leave cycles at rollover', async () => {
            const sched = await getCycleSchedule(owner, teamId);
            await setCycleSchedule(owner, teamId, { ...sched, rollover: 'NO_CYCLE' });
            const cycles = await listCycles(owner, { teamId });
            const next = cycles.filter((c) => c.status !== 'completed').sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1))[0]!;
            const afterEnd = addDays(new Date(`${next.endsOn}T00:00:00Z`), 1);
            const sys = await buildTenantSystemJobContext({ tenantId, tenantSlug: TAG, job: 'cycle-rollover' });
            const r = await rolloverWorkspaceCycles(sys, afterEnd);
            expect(r.cyclesClosed).toBe(1);
            expect(r.itemsMoved).toBe(2);
            expect((await listWorkItems(owner, { cycleId: next.id })).items).toHaveLength(0);
            const planned = (await listWorkItems(owner, { projectId })).items.find((i) => i.title === 'planned')!;
            expect(planned.cycleId).toBeNull();
        });
    });

    it('the audit chain verifies', async () => {
        const result = await verifyAuditChain(tenantId);
        expect(result.valid).toBe(true);
    });
});
