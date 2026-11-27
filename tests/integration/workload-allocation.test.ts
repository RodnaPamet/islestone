/**
 * Allocation and the Workload view (sub-phase 3.5b; docs/porting/maps/3.5.md,
 * "Allocation (3.5b)", "The read" and "H3 and 3.5"; ADR 0013 §6 to §8; owner
 * decisions 292 to 298), against a real Postgres:
 *
 *   - what counts: live, open items of hours teams with an estimate, each on
 *     its assignee, its remaining minutes (less the time recorded on it, for
 *     a holder of `time.view` only, decision 295) spread over its working
 *     days; done items, points work and unestimated work never placed, the
 *     latter two named beside the hours; undated work named;
 *   - overdue work on today's next working day; a later window leaving it out;
 *   - over capacity; a deactivated member who still holds work shown with no
 *     capacity; work assigned to nobody as its own row;
 *   - the filters narrowing the people (named, a recipient list, a project or
 *     team with its share, over capacity only);
 *   - the cell: its items most minutes first, why each is there, listed only
 *     for a reader of work items; the unassigned cell; the range refused;
 *   - never a time-off type in either answer.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { createProject } from '@/app-layer/usecases/project';
import { createRecipientList } from '@/app-layer/usecases/recipient-list';
import { createTeam, updateTeam } from '@/app-layer/usecases/team';
import { addTimeEntry } from '@/app-layer/usecases/time-entry';
import { setTimeOffDays } from '@/app-layer/usecases/time-off';
import { createWorkItem, setWorkItemState } from '@/app-layer/usecases/work-item';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { getWorkload, getWorkloadCell } from '@/app-layer/usecases/workload';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `wka${Date.now().toString(36)}`;

async function reasonOf(p: Promise<unknown>): Promise<string> {
    try {
        await p;
    } catch (err) {
        const e = err as { details?: { reason?: string }; status?: number; message?: string };
        return e.details?.reason ?? `${e.status ?? ''} ${e.message ?? ''}`;
    }
    return 'no error';
}

/** This week's Monday in UTC (the tests' workspace counts on the default calendar in UTC), plus `n` days. */
function fromThisMonday(n: number): string {
    const now = new Date();
    const back = (now.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back + n)).toISOString().slice(0, 10);
}
const NEXT = (n: number) => fromThisMonday(7 + n);

describeFn('allocation and the Workload view (3.5b)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let ana: RequestContext;
    let viewer: RequestContext;
    const users: Record<string, string> = {};
    const ids: Record<string, string> = {};
    let webId = '';
    let opsId = '';
    let hoursTeamId = '';

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const mk = async (who: string, role: 'OWNER' | 'MEMBER' | 'VIEWER') => {
            const u = await prisma.user.create({ data: { email: `${who}-${TAG}@example.test`, name: who } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            users[who] = u.id;
            return makeRequestContext(role, { tenantId, tenantSlug: TAG, userId: u.id, requestId: `${TAG}-${who}` });
        };
        owner = await mk('owner', 'OWNER');
        ana = await mk('ana', 'MEMBER');
        await mk('bo', 'MEMBER');
        viewer = await mk('viewer', 'VIEWER');

        const hours = await createTeam(owner, { name: 'Hours' });
        hoursTeamId = hours.id;
        await updateTeam(owner, hours.id, { estimateUnit: 'HOURS' });
        const points = await createTeam(owner, { name: 'Points' });
        await updateTeam(owner, points.id, { estimateUnit: 'POINTS' });
        const none = await createTeam(owner, { name: 'None' });
        webId = (await createProject(owner, { teamId: hours.id, name: 'Website', keyPrefix: 'WEB' })).id;
        opsId = (await createProject(owner, { teamId: hours.id, name: 'Ops', keyPrefix: 'OPS' })).id;
        const ptsId = (await createProject(owner, { teamId: points.id, name: 'Pointed', keyPrefix: 'PTS' })).id;
        const noneId = (await createProject(owner, { teamId: none.id, name: 'Loose', keyPrefix: 'LSE' })).id;
        const typeId = (await listWorkItemTypes(owner))[0]!.id;

        const make = async (name: string, input: Record<string, unknown>) => {
            ids[name] = (await createWorkItem(owner, { projectId: webId, typeId, title: name, ...input })).id;
        };
        await make('a1', { assigneeId: users.ana, startDate: NEXT(0), dueDate: NEXT(4), estimateMinutes: 600 });
        await make('a2', { projectId: opsId, assigneeId: users.ana, dueDate: NEXT(9), estimateMinutes: 300 });
        await make('a3', { assigneeId: users.ana, estimateMinutes: 90 });
        await make('a4', { assigneeId: users.ana });
        await make('a5', { projectId: ptsId, assigneeId: users.ana, estimatePoints: 5 });
        await make('a6', { projectId: noneId, assigneeId: users.ana });
        await make('a7', { assigneeId: users.ana, dueDate: fromThisMonday(-10), estimateMinutes: 120 });
        await make('a8', { assigneeId: users.ana, startDate: NEXT(0), dueDate: NEXT(4), estimateMinutes: 9000 });
        await make('a9', { assigneeId: users.ana, startDate: NEXT(0), dueDate: NEXT(4), estimateMinutes: 2000 });
        await make('u1', { dueDate: NEXT(1), estimateMinutes: 200 });
        await make('b1', { assigneeId: users.bo, dueDate: NEXT(2), estimateMinutes: 60 });
        // a8 is done: never counted.
        const done = hours.workflowStates.find((s) => s.category === 'DONE')!.id;
        await setWorkItemState(owner, ids.a8!, { stateId: done });
        // Recorded time shrinks a1's remaining minutes (to holders of time.view).
        await addTimeEntry(ana, { workItemId: ids.a1!, workDate: fromThisMonday(-1), minutes: 100 });
        // Time off in next week (dates and hours only, never the type).
        await setTimeOffDays(ana, { days: [{ day: NEXT(3), minutes: null, type: 'SICK' }] });
        // Bo leaves, still holding b1.
        await prisma.tenantMembership.updateMany({ where: { tenantId, userId: users.bo }, data: { status: 'DEACTIVATED' } });
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    const row = (data: Awaited<ReturnType<typeof getWorkload>>, who: string) => data.people.find((p) => p.userId === users[who]);

    it('places counted work on each assignee, names what it cannot place, and flags over capacity', async () => {
        const data = await getWorkload(viewer, { weeks: 3 });
        const a = row(data, 'ana')!;
        // a1 (600 − 100 recorded) and a9 in next week; a7 overdue on today's next working day (this week, or next
        // on a weekend); a2 on one day the week after.
        expect(a.allocated[0]! + a.allocated[1]!).toBe(500 + 2000 + 120);
        expect(a.allocated[2]).toBe(300);
        expect(a.noDates).toEqual({ count: 1, minutes: 90 });
        expect(a.notEstimated).toBe(2);
        expect(a.pointsWork).toEqual({ count: 1, points: 5 });
        expect(a.later).toBe(0);
        // Next week: 40 hours less a whole day of time off, so 2,500 or more allocated is over.
        expect(a.capacity[1]).toBe(1920);
        expect(a.over[1]).toBe(a.allocated[1]! - 1920);
        expect(data.timeSpentCounted).toBe(true);

        const b = row(data, 'bo')!;
        expect(b.active).toBe(false);
        expect(b.capacity).toEqual([0, 0, 0]);
        expect(b.over[1]).toBe(60);

        expect(data.unassigned?.allocated).toEqual([0, 200, 0]);
        expect(row(data, 'viewer')!.allocated).toEqual([0, 0, 0]);
        expect(JSON.stringify(data)).not.toContain('"type"');
        expect(JSON.stringify(data)).not.toContain('SICK');
    });

    it('counts the whole estimate for a caller who may not see an item\'s time (decision 295)', async () => {
        const noTime = { ...viewer, appPermissions: { ...viewer.appPermissions, time: { ...viewer.appPermissions!.time, view: false } } } as RequestContext;
        const data = await getWorkload(noTime, { weeks: 3 });
        expect(data.timeSpentCounted).toBe(false);
        expect(row(data, 'ana')!.allocated[0]! + row(data, 'ana')!.allocated[1]!).toBe(600 + 2000 + 120);
    });

    it('leaves overdue work out of a window that starts after the current week', async () => {
        const data = await getWorkload(viewer, { from: NEXT(0), weeks: 2 });
        expect(row(data, 'ana')!.allocated).toEqual([2500, 300]);
        expect(await reasonOf(getWorkload(viewer, { from: fromThisMonday(-7) }))).toBe('WORKLOAD_RANGE');
        expect(await reasonOf(getWorkload(viewer, { from: NEXT(1) }))).toBe('WORKLOAD_RANGE');
    });

    it('narrows the people, never their figures', async () => {
        const mine = await getWorkload(ana, { userId: 'me', weeks: 3 });
        expect(mine.people.map((p) => p.userId)).toEqual([users.ana]);
        expect(mine.unassigned).toBeNull();
        expect(mine.people[0]!.allocated[2]).toBe(300);

        const ops = await getWorkload(viewer, { projectId: opsId, weeks: 3 });
        expect(ops.people.map((p) => p.userId)).toEqual([users.ana]);
        expect(ops.people[0]!.share).toEqual([0, 0, 300]);
        expect(ops.people[0]!.allocated[2]).toBe(300);
        expect(ops.unassigned).toBeNull();

        const team = await getWorkload(viewer, { teamId: hoursTeamId, weeks: 3 });
        expect(team.people.map((p) => p.userId).sort()).toEqual([users.ana, users.bo].sort());
        expect(team.unassigned?.share).toEqual([0, 200, 0]);

        const over = await getWorkload(viewer, { over: 'true', weeks: 3 });
        expect(over.people.map((p) => p.userId).sort()).toEqual([users.ana, users.bo].sort());
        expect(over.unassigned).toBeNull();

        const list = await createRecipientList(owner, null, { name: `Planners ${TAG}`, userIds: [users.ana!] });
        const listed = await getWorkload(viewer, { recipientListId: list.id, weeks: 3 });
        expect(listed.people.map((p) => p.userId)).toEqual([users.ana]);
        expect(listed.filters.recipientListId).toBe(list.id);
    });

    it('lists the items filling a week, most minutes first, with why each is there', async () => {
        const cell = await getWorkloadCell(viewer, { userId: users.ana!, week: NEXT(0) });
        expect(cell.itemsShown).toBe(true);
        const keyed = cell.items.filter((i) => i.id !== ids.a7);
        expect(keyed.map((i) => i.title)).toEqual(['a9', 'a1']);
        expect(keyed[0]).toMatchObject({ minutes: 2000, reason: 'SPREAD', workingDays: 5, from: NEXT(0), to: NEXT(4), projectName: 'Website' });
        expect(keyed[0]!.key).toMatch(/^WEB-\d+$/);
        expect(keyed[1]).toMatchObject({ minutes: 500, estimateMinutes: 600, remainingMinutes: 500 });
        expect(cell.capacityMinutes).toBe(1920);
        expect(cell.timeOff).toEqual([{ day: NEXT(3), minutes: null }]);
        expect(cell.overMinutes).toBe(cell.allocatedMinutes - 1920);
        expect(JSON.stringify(cell)).not.toContain('"type"');

        const later = await getWorkloadCell(viewer, { userId: users.ana!, week: NEXT(7) });
        expect(later.items.map((i) => i.title)).toEqual(['a2']);
        expect(later.items[0]).toMatchObject({ reason: 'ONE_DAY', minutes: 300 });

        const nobody = await getWorkloadCell(viewer, { userId: 'unassigned', week: NEXT(0) });
        expect(nobody.items.map((i) => i.title)).toEqual(['u1']);
        expect(nobody.capacityMinutes).toBeNull();

        const deactivated = await getWorkloadCell(viewer, { userId: users.bo!, week: NEXT(0) });
        expect(deactivated).toMatchObject({ active: false, capacityMinutes: 0, overMinutes: 60 });
    });

    it('withholds the items from a caller who may not read work items, and refuses a week outside the range', async () => {
        const noItems = { ...viewer, appPermissions: { ...viewer.appPermissions, work_items: { ...viewer.appPermissions!.work_items, view: false } } } as RequestContext;
        const cell = await getWorkloadCell(noItems, { userId: users.ana!, week: NEXT(0) });
        expect(cell.itemsShown).toBe(false);
        expect(cell.items).toEqual([]);
        expect(cell.allocatedMinutes).toBeGreaterThan(0);
        expect(await reasonOf(getWorkloadCell(viewer, { userId: users.ana!, week: fromThisMonday(-7) }))).toBe('WORKLOAD_RANGE');
        expect(await reasonOf(getWorkloadCell(viewer, { userId: 'nobody', week: NEXT(0) }))).toMatch(/404/);
    });
});
