/**
 * The ways to rebalance (sub-phase 3.5c; docs/porting/maps/3.5.md, "Ways to
 * rebalance (3.5c)"; decisions 283 and 299), through `getWorkloadCell`
 * against a real database:
 *
 *   - an over-capacity week lists its largest items with "Assign to" naming
 *     only ACTIVE people already on the item's project who stay within
 *     capacity, "Move dates" later dates that fit, and the items due on a
 *     whole day off (never a type);
 *   - offered only to a signed-in person who reads work items and holds
 *     `work_items.assign` or `work_items.edit`: a Viewer, a custom role with
 *     neither, an API key and a job get none; a role with one key gets
 *     that kind only;
 *   - nothing is written by reading them (no audit entry, no item version);
 *   - a week within capacity has none, a week further than 52 weeks ahead
 *     says so; the existing assign write then moves the hours.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { getPermissionsForRole } from '@/lib/permissions';
import { createProject } from '@/app-layer/usecases/project';
import { createTeam, updateTeam } from '@/app-layer/usecases/team';
import { setTimeOffDays } from '@/app-layer/usecases/time-off';
import { assignWorkItem, createWorkItem } from '@/app-layer/usecases/work-item';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { getWorkloadCell } from '@/app-layer/usecases/workload';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `wkr${Date.now().toString(36)}`;

/** This week's Monday in UTC (the workspace counts on the default calendar in UTC), plus `n` days. */
function fromThisMonday(n: number): string {
    const now = new Date();
    const back = (now.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back + n)).toISOString().slice(0, 10);
}
const NEXT = (n: number) => fromThisMonday(7 + n);

describeFn('the ways to rebalance (3.5c)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    const users: Record<string, string> = {};
    const ids: Record<string, string> = {};

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
        const ana = await mk('ana', 'MEMBER');
        await mk('bo', 'MEMBER');
        await mk('cy', 'MEMBER');
        await mk('dan', 'MEMBER');
        await mk('viewer', 'VIEWER');

        const hours = await createTeam(owner, { name: 'Hours' });
        await updateTeam(owner, hours.id, { estimateUnit: 'HOURS' });
        const web = (await createProject(owner, { teamId: hours.id, name: 'Website', keyPrefix: 'WEB' })).id;
        const ops = (await createProject(owner, { teamId: hours.id, name: 'Ops', keyPrefix: 'OPS' })).id;
        const typeId = (await listWorkItemTypes(owner))[0]!.id;
        const make = async (name: string, input: Record<string, unknown>) => {
            ids[name] = (await createWorkItem(owner, { projectId: web, typeId, title: name, ...input })).id;
        };
        // Ana next week: 30h and 20h on Website, 5h on Ops, all due on her day off: 55h against 32h.
        await make('big', { assigneeId: users.ana, startDate: NEXT(0), dueDate: NEXT(4), estimateMinutes: 1800 });
        await make('mid', { assigneeId: users.ana, startDate: NEXT(0), dueDate: NEXT(4), estimateMinutes: 1200 });
        await make('opsy', { projectId: ops, assigneeId: users.ana, dueDate: NEXT(4), estimateMinutes: 300 });
        // Bo on Website with 10h; Cy on Ops with 2h; Dan on Website but deactivated.
        await make('bo1', { assigneeId: users.bo, startDate: NEXT(0), dueDate: NEXT(4), estimateMinutes: 600 });
        await make('cy1', { projectId: ops, assigneeId: users.cy, dueDate: NEXT(2), estimateMinutes: 120 });
        await make('dan1', { assigneeId: users.dan, dueDate: NEXT(2), estimateMinutes: 60 });
        // Far ahead: a week over capacity 60 weeks from now.
        await make('far', { assigneeId: users.ana, startDate: fromThisMonday(7 * 60), dueDate: fromThisMonday(7 * 60 + 4), estimateMinutes: 3000 });
        await setTimeOffDays(ana, { days: [{ day: NEXT(4), minutes: null, type: 'SICK' }] });
        await prisma.tenantMembership.updateMany({ where: { tenantId, userId: users.dan }, data: { status: 'DEACTIVATED' } });
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    const ctxOf = (who: string, role: 'OWNER' | 'MEMBER' | 'VIEWER', extra: Partial<RequestContext> = {}) =>
        makeRequestContext(role, { tenantId, tenantSlug: TAG, userId: users[who], requestId: `${TAG}-${who}-${Math.random()}`, ...extra });

    it('names who on the project has room, the earliest later dates and what is due on a day off', async () => {
        const cell = await getWorkloadCell(ctxOf('owner', 'OWNER'), { userId: users.ana!, week: NEXT(0) });
        expect(cell.overMinutes).toBeGreaterThan(0);
        const r = cell.rebalance!;
        expect(r.offered).toEqual({ assign: true, moveDates: true });
        expect(r.assignUnavailable).toBe(false);
        expect(r.items.map((i) => [i.key, i.minutes])).toEqual([
            ['WEB-1', 1800],
            ['WEB-2', 1200],
            ['OPS-1', 300],
        ]);
        // Bo (30h free) takes either Website item; Dan is deactivated, Cy is not on Website.
        expect(r.items[0]!.assignTo).toEqual([{ userId: users.bo, name: 'bo', freeMinutes: 1800 }]);
        expect(r.items[1]!.assignTo.map((a) => a.userId)).toEqual([users.bo]);
        // Cy takes the Ops item; Bo is not on Ops.
        expect(r.items[2]!.assignTo.map((a) => a.userId)).toEqual([users.cy]);
        for (const i of r.items) {
            expect(i.moveTo).not.toBeNull();
            expect(i.moveTo!.dueDate! > NEXT(4)).toBe(true);
        }
        // Every item due on Friday, her day off, is named, most minutes first.
        expect(r.dueDuringTimeOff).toEqual([
            { id: ids.big, key: 'WEB-1', title: 'big', dueDate: NEXT(4) },
            { id: ids.mid, key: 'WEB-2', title: 'mid', dueDate: NEXT(4) },
            { id: ids.opsy, key: 'OPS-1', title: 'opsy', dueDate: NEXT(4) },
        ]);
        expect(JSON.stringify(cell)).not.toContain('"type"');
        expect(JSON.stringify(cell)).not.toContain('SICK');
    });

    it('writes nothing when it is read', async () => {
        const before = await prisma.auditLog.count({ where: { tenantId } });
        const versions = await prisma.workItem.findMany({ where: { tenantId }, select: { id: true, version: true }, orderBy: { id: 'asc' } });
        await getWorkloadCell(ctxOf('owner', 'OWNER'), { userId: users.ana!, week: NEXT(0) });
        expect(await prisma.auditLog.count({ where: { tenantId } })).toBe(before);
        expect(await prisma.workItem.findMany({ where: { tenantId }, select: { id: true, version: true }, orderBy: { id: 'asc' } })).toEqual(versions);
    });

    it('is offered only to a person who could make the write', async () => {
        const viewer = await getWorkloadCell(ctxOf('viewer', 'VIEWER'), { userId: users.ana!, week: NEXT(0) });
        expect(viewer.overMinutes).toBeGreaterThan(0);
        expect(viewer.rebalance).toBeNull();
        expect(viewer.rebalanceNote).toBeNull();

        const key = await getWorkloadCell(ctxOf('owner', 'OWNER', { apiKeyId: 'key-1' }), { userId: users.ana!, week: NEXT(0) });
        expect(key.rebalance).toBeNull();
        const job = await getWorkloadCell(ctxOf('owner', 'OWNER', { actorType: 'JOB' }), { userId: users.ana!, week: NEXT(0) });
        expect(job.rebalance).toBeNull();

        const noAssign = getPermissionsForRole('MEMBER');
        noAssign.work_items.assign = false;
        const datesOnly = await getWorkloadCell(ctxOf('cy', 'MEMBER', { appPermissions: noAssign }), { userId: users.ana!, week: NEXT(0) });
        expect(datesOnly.rebalance!.offered).toEqual({ assign: false, moveDates: true });
        expect(datesOnly.rebalance!.items.every((i) => i.assignTo.length === 0 && i.moveTo !== null)).toBe(true);

        const neither = getPermissionsForRole('MEMBER');
        neither.work_items.assign = false;
        neither.work_items.edit = false;
        expect((await getWorkloadCell(ctxOf('cy', 'MEMBER', { appPermissions: neither }), { userId: users.ana!, week: NEXT(0) })).rebalance).toBeNull();
    });

    it('has none for a week within capacity, and says when a week is too far ahead', async () => {
        const bo = await getWorkloadCell(ctxOf('owner', 'OWNER'), { userId: users.bo!, week: NEXT(0) });
        expect(bo.overMinutes).toBe(0);
        expect(bo.rebalance).toBeNull();
        const far = await getWorkloadCell(ctxOf('owner', 'OWNER'), { userId: users.ana!, week: fromThisMonday(7 * 60) });
        expect(far.overMinutes).toBeGreaterThan(0);
        expect(far.rebalance).toBeNull();
        expect(far.rebalanceNote).toBe('TOO_FAR_AHEAD');
    });

    it('lets the existing assign write move the hours', async () => {
        const item = await prisma.workItem.findUniqueOrThrow({ where: { id: ids.big! }, select: { version: true } });
        await assignWorkItem(owner, ids.big!, { assigneeId: users.bo! }, item.version);
        const ana = await getWorkloadCell(ctxOf('owner', 'OWNER'), { userId: users.ana!, week: NEXT(0) });
        expect(ana.items.map((i) => i.key)).not.toContain('WEB-1');
        const bo = await getWorkloadCell(ctxOf('owner', 'OWNER'), { userId: users.bo!, week: NEXT(0) });
        expect(bo.items.map((i) => i.key)).toContain('WEB-1');
        expect(bo.overMinutes).toBe(0);
    });
});
