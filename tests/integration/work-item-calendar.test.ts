/**
 * The calendar view's read against a real Postgres (roadmap 3.3a;
 * docs/porting/maps/3.3.md, "The calendar view (3.3a)"):
 *
 *   - a project's calendar holds the items due in the window (a closed one
 *     included, shown done), counts the undated ones and leaves out items
 *     due outside the window, deleted items and other projects' items; it
 *     carries the team's cycles overlapping the window, the project's
 *     milestones and due date in the window, and the team's working
 *     calendar with only the window's holidays;
 *   - the list's filters apply through the list's own `where`: the calendar
 *     and the list with the same filters hold the same items in the window;
 *   - a cycle filter shows that cycle's band, a milestone filter that
 *     milestone and the team's calendar;
 *   - cycles and milestones a caller may not read are named in `omitted`,
 *     never silently dropped;
 *   - a window longer than 62 days or reversed is a 400 `CALENDAR_RANGE`;
 *   - a window over 2,000 items is refused with the count, never cut; a
 *     narrower filter is read;
 *   - a GUEST is refused (decision 204); one granted the read keys, as 8.4
 *     will, sees nothing;
 *   - the route: every role holding `work_items.view` is admitted, a GUEST
 *     and a role without the key get a 403 and an `AUTHZ_DENIED` row; a read
 *     writes nothing to the audit trail and the chain verifies.
 *
 * Written fresh for Islestone.
 */
import { NextRequest } from 'next/server';
import type { PrismaClient, Role } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';

const getTenantCtxMock = jest.fn<Promise<RequestContext>, [unknown, unknown]>();
jest.mock('@/app-layer/context', () => ({
    getTenantCtx: (params: unknown, req: unknown) => getTenantCtxMock(params, req),
}));

import { fromEpochDay, todayIn } from '@/app-layer/domain/schedule/calendar';
import { createCycle } from '@/app-layer/usecases/cycle';
import { createMilestone } from '@/app-layer/usecases/milestone';
import { createProject } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { createWorkItem, deleteWorkItem, listWorkItems, setWorkItemState } from '@/app-layer/usecases/work-item';
import { getWorkItemCalendar } from '@/app-layer/usecases/work-item-calendar';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { addTeamHolidays, setTeamWorkingCalendar } from '@/app-layer/usecases/working-calendar';
import { verifyAuditChain } from '@/lib/audit';
import { AppError } from '@/lib/errors/types';
import { getPermissionsForRole } from '@/lib/permissions';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';
import { CALENDAR_ITEM_LIMIT, type CalendarResponse } from '@/lib/work-items/calendar';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `wcal${Date.now().toString(36)}`;
const ROLES: readonly Role[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST'];

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** The window: a 42-day grid starting on 2031-03-03 (a Monday). */
const FROM = '2031-03-03';
const TO = '2031-04-13';
const d = (offset: number) => fromEpochDay(Math.round(Date.parse(`${FROM}T00:00:00Z`) / 86_400_000) + offset);

describeFn('the calendar read (3.3a)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    const ctxs = {} as Record<Role, RequestContext>;
    let owner: RequestContext;
    let teamId = '';
    let otherTeamId = '';
    let projectId = '';
    let otherProjectId = '';
    let bigProjectId = '';
    let typeId = '';
    let cycleId = '';
    let milestoneId = '';
    const ids: Record<string, string> = {};
    const savedTz = process.env.NOTIFICATIONS_TZ;

    beforeAll(async () => {
        process.env.NOTIFICATIONS_TZ = 'UTC';
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        for (const role of ROLES) {
            const u = await prisma.user.create({ data: { email: `${role.toLowerCase()}-${TAG}@example.test`, name: role } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            ctxs[role] = makeRequestContext(role, { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-${role}` });
        }
        owner = ctxs.OWNER;
        teamId = (await createTeam(owner, { name: 'Core' })).id;
        otherTeamId = (await createTeam(owner, { name: 'Edge' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
        projectId = (await createProject(owner, { teamId, name: 'Platform', keyPrefix: 'PLT', dueDate: d(30) })).id;
        otherProjectId = (await createProject(owner, { teamId: otherTeamId, name: 'Mobile', keyPrefix: 'MOB' })).id;
        bigProjectId = (await createProject(owner, { teamId, name: 'Backlog', keyPrefix: 'BIG' })).id;

        cycleId = (await createCycle(owner, { teamId, name: 'Spring', startsOn: d(-7), endsOn: d(6) })).id;
        await createCycle(owner, { teamId, name: 'Summer', startsOn: d(100), endsOn: d(113) });
        await createCycle(owner, { teamId: otherTeamId, name: 'Edge one', startsOn: d(0), endsOn: d(13) });
        milestoneId = (await createMilestone(owner, projectId, { name: 'Beta', dueDate: d(20) })).id;
        await createMilestone(owner, projectId, { name: 'GA', dueDate: d(80) });
        await createMilestone(owner, projectId, { name: 'Someday' });
        await setTeamWorkingCalendar(owner, teamId, { timeZone: 'Europe/Sofia', workingWeekdays: [1, 2, 3, 4, 5] });
        await addTeamHolidays(owner, teamId, { holidays: [{ day: d(2), name: 'Liberation Day' }, { day: d(90), name: 'Later' }] });

        const mk = async (key: string, input: Record<string, unknown>, project = projectId) => {
            ids[key] = (await createWorkItem(owner, { projectId: project, typeId, title: key, ...input })).id;
        };
        await mk('First', { dueDate: d(0), cycleId });
        await mk('Last', { startDate: d(39), dueDate: d(41) });
        await mk('Shipped', { dueDate: d(10), milestoneId });
        await mk('Before', { dueDate: d(-1) });
        await mk('After', { dueDate: d(42) });
        await mk('Undated', {});
        await mk('Gone', { dueDate: d(5) });
        await mk('Elsewhere', { dueDate: d(5) }, otherProjectId);
        await deleteWorkItem(owner, ids.Gone!);
        const done = await prisma.workflowState.findFirstOrThrow({ where: { tenantId, teamId, category: 'DONE' } });
        await setWorkItemState(owner, ids.Shipped!, { stateId: done.id });
    });

    afterAll(async () => {
        process.env.NOTIFICATIONS_TZ = savedTz;
        await resetDatabase(prisma);
    });

    const titles = (c: CalendarResponse) => c.items.map((i) => i.title).sort();

    it("a project's calendar: the window's items, the undated counted, cycles, milestones, its due date and its team's calendar", async () => {
        const auditBefore = await prisma.auditLog.count({ where: { tenantId } });
        const c = await getWorkItemCalendar(ctxs.MEMBER, { projectId, from: FROM, to: TO });
        expect(titles(c)).toEqual(['First', 'Last', 'Shipped']);
        expect(c.items.find((i) => i.title === 'Shipped')).toMatchObject({ stateCategory: 'DONE', dueDate: d(10), milestoneId, key: expect.stringMatching(/^PLT-\d+$/) });
        expect(c.items.find((i) => i.title === 'Last')).toMatchObject({ startDate: d(39), dueDate: d(41) });
        expect(c.noDueDate).toBe(1);
        // The project's team's cycles overlapping the window, never another team's or one outside it.
        expect(c.cycles.map((cy) => cy.name)).toEqual(['Spring']);
        expect(c.cycles[0]).toMatchObject({ id: cycleId, teamId, startsOn: d(-7), endsOn: d(6) });
        // The milestones due in the window; an undated one and a later one are not drawn.
        expect(c.milestones).toEqual([{ id: milestoneId, projectId, name: 'Beta', dueDate: d(20) }]);
        expect(c.projects.find((p) => p.id === projectId)).toMatchObject({ dueDate: d(30), keyPrefix: 'PLT', archived: false });
        // The team's calendar, with only the window's holidays; today in its zone.
        expect(c.calendar).toMatchObject({ teamId, timeZone: 'Europe/Sofia', workingWeekdays: [1, 2, 3, 4, 5], holidays: [d(2)] });
        expect(c.asOf).toBe(fromEpochDay(todayIn('Europe/Sofia', new Date())));
        expect(c).toMatchObject({ from: FROM, to: TO, omitted: [], truncated: [] });
        // A read writes nothing.
        expect(await prisma.auditLog.count({ where: { tenantId } })).toBe(auditBefore);
    });

    it("the workspace's calendar: every visible project's window, the teams' cycles, the workspace calendar", async () => {
        const c = await getWorkItemCalendar(ctxs.MEMBER, { from: FROM, to: TO });
        expect(titles(c)).toEqual(['Elsewhere', 'First', 'Last', 'Shipped']);
        expect(c.cycles.map((cy) => cy.name).sort()).toEqual(['Edge one', 'Spring']);
        expect(c.calendar.teamId).toBeNull();
        expect(c.noDueDate).toBe(1);
    });

    it("the list's filters apply: the calendar and the list hold the same items in the window", async () => {
        for (const filters of [{ projectId, stateCategory: 'UNSTARTED,BACKLOG' }, { projectId, q: 'Last' }, { assigneeId: 'none' }, { cycleId }]) {
            const c = await getWorkItemCalendar(ctxs.MEMBER, { ...filters, from: FROM, to: TO });
            const list = await listWorkItems(ctxs.MEMBER, { ...filters, limit: 100 });
            const inWindow = list.items.filter((i) => i.dueDate !== null && i.dueDate >= FROM && i.dueDate <= TO);
            expect(c.items.map((i) => i.id).sort()).toEqual(inWindow.map((i) => i.id).sort());
        }
    });

    it("a cycle's page shows its band; a milestone's page its milestone and the team's calendar", async () => {
        const byCycle = await getWorkItemCalendar(ctxs.MEMBER, { cycleId, from: FROM, to: TO });
        expect(titles(byCycle)).toEqual(['First']);
        expect(byCycle.cycles.map((c) => c.id)).toEqual([cycleId]);
        expect(byCycle.calendar.teamId).toBe(teamId);
        const byMilestone = await getWorkItemCalendar(ctxs.MEMBER, { milestoneId, from: FROM, to: TO });
        expect(titles(byMilestone)).toEqual(['Shipped']);
        expect(byMilestone.milestones.map((m) => m.name)).toEqual(['Beta']);
        expect(byMilestone.calendar.teamId).toBe(teamId);
    });

    it('cycles and milestones a caller may not read are named as omitted, never silently dropped', async () => {
        const perms = getPermissionsForRole('MEMBER');
        const noCycles = await getWorkItemCalendar({ ...ctxs.MEMBER, appPermissions: { ...perms, cycles: { ...perms.cycles, view: false } } }, { projectId, from: FROM, to: TO });
        expect(noCycles).toMatchObject({ cycles: [], omitted: ['cycles'] });
        expect(noCycles.milestones).toHaveLength(1);
        const noProjects = await getWorkItemCalendar({ ...ctxs.MEMBER, appPermissions: { ...perms, projects: { ...perms.projects, view: false } } }, { projectId, from: FROM, to: TO });
        expect(noProjects).toMatchObject({ milestones: [], omitted: ['milestones'] });
        expect(noProjects.projects.every((p) => p.dueDate === null)).toBe(true);
        expect(titles(noProjects)).toEqual(['First', 'Last', 'Shipped']);
    });

    it('a window longer than 62 days, or reversed, is a 400 CALENDAR_RANGE', async () => {
        await expect(getWorkItemCalendar(ctxs.MEMBER, { from: FROM, to: d(62) })).rejects.toMatchObject({ status: 400, details: { reason: 'CALENDAR_RANGE' } });
        await expect(getWorkItemCalendar(ctxs.MEMBER, { from: TO, to: FROM })).rejects.toMatchObject({ status: 400, details: { reason: 'CALENDAR_RANGE' } });
        await expect(getWorkItemCalendar(ctxs.MEMBER, { from: FROM, to: d(61) })).resolves.toMatchObject({ from: FROM });
    });

    it('a GUEST is refused (decision 204); one granted the read keys, as 8.4 will, sees nothing', async () => {
        await expect(getWorkItemCalendar(ctxs.GUEST, { from: FROM, to: TO })).rejects.toMatchObject({ status: 403 });
        const c = await getWorkItemCalendar({ ...ctxs.GUEST, appPermissions: getPermissionsForRole('VIEWER') }, { from: FROM, to: TO });
        expect(c).toMatchObject({ items: [], noDueDate: 0, milestones: [] });
    });

    it('a window over 2,000 items is refused with the count; a narrower filter is read', async () => {
        const state = await prisma.workflowState.findFirstOrThrow({ where: { tenantId, teamId, category: 'BACKLOG' } });
        const n = CALENDAR_ITEM_LIMIT + 1;
        await prisma.workItem.createMany({
            data: Array.from({ length: n }, (_, i) => ({
                tenantId,
                projectId: bigProjectId,
                teamId,
                typeId,
                stateId: state.id,
                stateCategory: 'BACKLOG' as const,
                number: 100_000 + i,
                title: i === 0 ? 'needle' : `bulk ${i}`,
                sortKey: `a${String(i).padStart(6, '0')}`,
                dueDate: new Date(`${d(i % 42)}T00:00:00Z`),
                createdByUserId: owner.userId,
            })),
        });
        let refusal: unknown;
        try {
            await getWorkItemCalendar(ctxs.MEMBER, { projectId: bigProjectId, from: FROM, to: TO });
        } catch (err) {
            refusal = err;
        }
        expect(refusal).toBeInstanceOf(AppError);
        expect(refusal).toMatchObject({ status: 422, code: 'CALENDAR_TOO_LARGE', details: { reason: 'CALENDAR_TOO_LARGE', count: n, limit: CALENDAR_ITEM_LIMIT } });
        const narrow = await getWorkItemCalendar(ctxs.MEMBER, { projectId: bigProjectId, q: 'needle', from: FROM, to: TO });
        expect(titles(narrow)).toEqual(['needle']);
    });

    describe('the route', () => {
        const call = async (ctx: RequestContext, query = `projectId=${projectId}&from=${FROM}&to=${TO}`) => {
            getTenantCtxMock.mockResolvedValue({ ...ctx, requestId: `${TAG}-${Math.random()}` });
            const mod = (await import('../../src/app/api/t/[tenantSlug]/work-items/calendar/route')) as unknown as Record<string, Handler>;
            const req = new NextRequest(`http://localhost/api/t/${TAG}/work-items/calendar?${query}`, { headers: { 'x-forwarded-for': '10.0.0.7' } });
            const res = await mod.GET!(req, { params: Promise.resolve({ tenantSlug: TAG }) });
            return { status: res.status, body: (await res.json()) as CalendarResponse & { error?: { code: string } } };
        };

        it.each(ROLES.filter((r) => r !== 'GUEST'))('admits %s (work_items.view)', async (role) => {
            const res = await call(ctxs[role]);
            expect(res.status).toBe(200);
            expect(res.body.items).toHaveLength(3);
        });

        it('refuses a missing or malformed window with a 400', async () => {
            expect((await call(ctxs.MEMBER, `projectId=${projectId}`)).status).toBe(400);
            expect((await call(ctxs.MEMBER, `from=2031-02-30&to=${TO}`)).status).toBe(400);
            expect((await call(ctxs.MEMBER, `from=${FROM}&to=2031-12-31`)).status).toBe(400);
        });

        it('refuses a GUEST, who holds no key until 8.4 (decision 204), with a 403 and an AUTHZ_DENIED row naming the key', async () => {
            const where = { tenantId, action: 'AUTHZ_DENIED', entity: 'Permission', entityId: 'work_items.view' };
            const before = await prisma.auditLog.count({ where });
            expect((await call(ctxs.GUEST)).status).toBe(403);
            expect(await prisma.auditLog.count({ where })).toBe(before + 1);
        });

        it('refuses a role without work_items.view with a 403 and an AUTHZ_DENIED row', async () => {
            const perms = getPermissionsForRole('VIEWER');
            const narrowed: RequestContext = { ...ctxs.VIEWER, appPermissions: { ...perms, work_items: { ...perms.work_items, view: false } } };
            const before = await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED' } });
            expect((await call(narrowed)).status).toBe(403);
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED' } })).toBe(before + 1);
        });

        it('the audit chain verifies', async () => {
            expect((await verifyAuditChain(tenantId, prisma)).valid).toBe(true);
        });
    });
});
