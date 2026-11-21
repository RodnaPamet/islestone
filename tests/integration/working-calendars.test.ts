/**
 * Working calendars against a real Postgres (roadmap 3.1a; ADR 0010 §5;
 * owner decisions 189 to 193):
 *
 *   - the workspace's calendar reads as the default (Monday to Friday, no
 *     holidays, `NOTIFICATIONS_TZ`) until saved; saving, a team's own
 *     calendar, holidays added (a date already there skipped) and removed,
 *     each audited with dates and settings, never a holiday's name re-listed;
 *   - refusals: an unknown time zone, no working weekday, a team holiday
 *     before the team has a calendar, too many holidays;
 *   - the database holds one workspace calendar, one per team, and the
 *     weekday set, whatever the writer;
 *   - review steps opened after 3.1 count working days on the item's team's
 *     calendar, else the workspace's, from today in its zone; with no
 *     calendar edited, exactly 2.8's Monday to Friday; a stored due day never
 *     moves when a calendar changes (ADR 0009 §13, decision 192);
 *   - the 08:00 review reminders read the same calendar for "the next
 *     working day";
 *   - the route matrix: reads under `projects.view`, writes under
 *     `admin.manage`, every key refusal a 403 with an `AUTHZ_DENIED` row;
 *   - the two tables are tenant tables: as `app_user` in workspace B nothing
 *     of A's is read, changed, removed or created;
 *   - the audit chain verifies.
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

import { compileCalendar, defaultCalendar, fromEpochDay, todayIn, workingDaysAfter } from '@/app-layer/domain/schedule/calendar';
import { processWorkItemDueNotifications } from '@/app-layer/jobs/work-item-due-notification';
import { createProject } from '@/app-layer/usecases/project';
import { getWorkItemReview, sendWorkItemReview, setWorkItemReviewSteps } from '@/app-layer/usecases/review';
import { createTeam } from '@/app-layer/usecases/team';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createWorkItem } from '@/app-layer/usecases/work-item';
import {
    addTeamHolidays,
    addWorkspaceHolidays,
    getTeamWorkingCalendar,
    getWorkingCalendars,
    removeTeamHoliday,
    removeTeamWorkingCalendar,
    removeWorkspaceHoliday,
    setTeamWorkingCalendar,
    setWorkspaceWorkingCalendar,
} from '@/app-layer/usecases/working-calendar';
import { verifyAuditChain } from '@/lib/audit';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `wcal${Date.now().toString(36)}`;
const ROLES: readonly Role[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST'];
const MON_FRI = [1, 2, 3, 4, 5];

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

function request(method: string, p: string, body?: unknown): NextRequest {
    return new NextRequest(`http://localhost/api/t/${TAG}${p}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.9' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

describeFn('working calendars', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let otherTenantId = '';
    let owner: RequestContext;
    let admin: RequestContext;
    let member: RequestContext;
    let viewer: RequestContext;
    let guest: RequestContext;
    let outsider: RequestContext;
    let teamId = '';
    let otherTeamId = '';
    let projectId = '';
    let otherProjectId = '';
    let typeId = '';
    const savedTz = process.env.NOTIFICATIONS_TZ;

    const audits = (action: string) => prisma.auditLog.findMany({ where: { tenantId, action }, orderBy: { createdAt: 'asc' } });

    beforeAll(async () => {
        process.env.NOTIFICATIONS_TZ = 'UTC';
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        otherTenantId = (await createTenantWithDek({ name: `${TAG}-b`, slug: `${TAG}-b` })).id;
        const mk = async (role: Role, n: string) => {
            const u = await prisma.user.create({ data: { email: `${n}-${TAG}@example.test`, name: n } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            return makeRequestContext(role, { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-${n}` });
        };
        owner = await mk('OWNER', 'Olive');
        admin = await mk('ADMIN', 'Ada');
        member = await mk('MEMBER', 'Max');
        viewer = await mk('VIEWER', 'Vic');
        guest = await mk('GUEST', 'Gus');
        const bea = await prisma.user.create({ data: { email: `bea-${TAG}@example.test`, name: 'Bea' } });
        await prisma.tenantMembership.create({ data: { tenantId: otherTenantId, userId: bea.id, role: 'OWNER' } });
        outsider = makeRequestContext('OWNER', { tenantId: otherTenantId, userId: bea.id, tenantSlug: `${TAG}-b` });
        teamId = (await createTeam(owner, { name: 'Sofia' })).id;
        otherTeamId = (await createTeam(owner, { name: 'Kiritimati' })).id;
        projectId = (await createProject(owner, { teamId, name: 'Core', keyPrefix: 'COR' })).id;
        otherProjectId = (await createProject(owner, { teamId: otherTeamId, name: 'Islands', keyPrefix: 'ISL' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
    });

    afterAll(async () => {
        process.env.NOTIFICATIONS_TZ = savedTz;
        await resetDatabase(prisma);
    });

    /** An item with one review step due in `n` working days, sent now; returns the stored due day. */
    const openStep = async (project: string, title: string, n: number) => {
        const item = await createWorkItem(owner, { projectId: project, typeId, title });
        await setWorkItemReviewSteps(owner, item.id, { steps: [{ name: 'Check', mode: 'ALL', dueInWorkingDays: n, memberIds: [member.userId], recipientListIds: [] }] });
        await sendWorkItemReview(owner, item.id);
        const step = (await getWorkItemReview(owner, item.id)).rounds[0]!.steps[0]!;
        return { itemId: item.id, stepId: step.id, dueOn: step.dueOn! };
    };

    describe('review steps before any calendar is saved (2.8 unchanged)', () => {
        it('read the default and count Monday to Friday in NOTIFICATIONS_TZ', async () => {
            const read = await getWorkingCalendars(viewer);
            expect(read.workspace).toMatchObject({ id: null, isDefault: true, timeZone: 'UTC', workingWeekdays: MON_FRI, holidays: [], version: 0 });
            expect(read.teams.map((t) => [t.teamName, t.calendarId])).toEqual(
                expect.arrayContaining([
                    ['Sofia', null],
                    ['Kiritimati', null],
                ]),
            );
            const { dueOn } = await openStep(projectId, 'Plain week', 3);
            expect(dueOn).toBe(fromEpochDay(workingDaysAfter(defaultCalendar(), todayIn('UTC', new Date()), 3)));
            expect(await prisma.workingCalendar.count({ where: { tenantId } })).toBe(0);
        });
    });

    describe('the workspace calendar', () => {
        it('saves sorted weekdays and a zone, audited with the settings', async () => {
            const saved = await setWorkspaceWorkingCalendar(admin, { timeZone: 'Europe/Sofia', workingWeekdays: [5, 1, 2, 3, 4, 1] });
            expect(saved).toMatchObject({ isDefault: false, name: 'Workspace', timeZone: 'Europe/Sofia', workingWeekdays: MON_FRI, version: 1 });
            const [entry] = await audits('WORKING_CALENDAR_SET');
            expect(entry?.detailsJson).toMatchObject({ category: 'entity_lifecycle', entityName: 'WorkingCalendar', operation: 'created' });
            expect(entry?.metadataJson).toMatchObject({ scope: 'workspace', timeZone: 'Europe/Sofia', workingWeekdays: MON_FRI });
            const renamed = await setWorkspaceWorkingCalendar(owner, { name: 'Bulgaria', timeZone: 'Europe/Sofia', workingWeekdays: MON_FRI });
            expect(renamed).toMatchObject({ name: 'Bulgaria', version: 2 });
            // No change writes nothing.
            await setWorkspaceWorkingCalendar(owner, { name: 'Bulgaria', timeZone: 'Europe/Sofia', workingWeekdays: MON_FRI });
            expect(await audits('WORKING_CALENDAR_SET')).toHaveLength(2);
        });

        it('refuses an unknown zone and an empty week, and members and viewers', async () => {
            await expect(setWorkspaceWorkingCalendar(owner, { timeZone: 'Mars/Olympus', workingWeekdays: MON_FRI })).rejects.toMatchObject({
                status: 400,
                details: { reason: 'TIME_ZONE_UNKNOWN' },
            });
            await expect(setWorkspaceWorkingCalendar(owner, { timeZone: 'UTC', workingWeekdays: [] })).rejects.toMatchObject({ status: 400, details: { reason: 'WEEKDAYS_INVALID' } });
            await expect(setWorkspaceWorkingCalendar(member, { timeZone: 'UTC', workingWeekdays: MON_FRI })).rejects.toMatchObject({ status: 403 });
            await expect(setWorkspaceWorkingCalendar(viewer, { timeZone: 'UTC', workingWeekdays: MON_FRI })).rejects.toMatchObject({ status: 403 });
        });

        it('adds holidays (skipping a date already there) and removes one, auditing dates only', async () => {
            const first = await addWorkspaceHolidays(admin, {
                holidays: [
                    { day: '2027-01-01', name: 'New Year' },
                    { day: '2027-03-03', name: 'Liberation Day' },
                ],
            });
            expect(first.added).toEqual(['2027-01-01', '2027-03-03']);
            const again = await addWorkspaceHolidays(admin, {
                holidays: [
                    { day: '2027-03-03', name: 'Liberation Day' },
                    { day: '2027-05-06', name: "St George's Day" },
                ],
            });
            expect(again).toMatchObject({ added: ['2027-05-06'], skipped: ['2027-03-03'] });
            expect(again.calendar.holidays.map((h) => h.day)).toEqual(['2027-01-01', '2027-03-03', '2027-05-06']);
            const gone = again.calendar.holidays.find((h) => h.day === '2027-05-06')!;
            const after = await removeWorkspaceHoliday(owner, gone.id);
            expect(after.holidays.map((h) => h.day)).toEqual(['2027-01-01', '2027-03-03']);
            const entries = await audits('WORKING_CALENDAR_HOLIDAYS_CHANGED');
            expect(entries.map((e) => e.metadataJson)).toEqual([
                expect.objectContaining({ added: ['2027-01-01', '2027-03-03'], removed: [] }),
                expect.objectContaining({ added: ['2027-05-06'], removed: [] }),
                expect.objectContaining({ added: [], removed: ['2027-05-06'] }),
            ]);
            expect(JSON.stringify(entries.map((e) => [e.metadataJson, e.detailsJson]))).not.toContain('Liberation');
            await expect(removeWorkspaceHoliday(owner, gone.id)).rejects.toMatchObject({ status: 404 });
            await expect(addWorkspaceHolidays(owner, { holidays: [{ day: '1999-12-31', name: 'Too early' }] })).rejects.toMatchObject({ status: 400 });
        });

        it('refuses more holidays than a calendar holds', async () => {
            const many = Array.from({ length: 100 }, (_, i) => ({ day: fromEpochDay(20_000 + i * 2), name: `Day ${i}` }));
            const ws = (await prisma.workingCalendar.findFirst({ where: { tenantId, teamId: null } }))!;
            await prisma.workingCalendarHoliday.createMany({
                data: Array.from({ length: 450 }, (_, i) => ({ tenantId, calendarId: ws.id, day: new Date(Date.UTC(2100, 0, 1) + i * 86_400_000), name: `Filler ${i}` })),
            });
            await expect(addWorkspaceHolidays(owner, { holidays: many })).rejects.toMatchObject({ status: 400, details: { reason: 'TOO_MANY_HOLIDAYS' } });
            await prisma.workingCalendarHoliday.deleteMany({ where: { calendarId: ws.id, name: { startsWith: 'Filler' } } });
        });
    });

    describe('team calendars', () => {
        it('a team uses the workspace calendar until it has its own; then its own; then the workspace again', async () => {
            expect(await getTeamWorkingCalendar(viewer, otherTeamId)).toMatchObject({ teamName: 'Kiritimati', calendar: null });
            await expect(addTeamHolidays(owner, otherTeamId, { holidays: [{ day: '2027-07-04', name: 'X' }] })).rejects.toMatchObject({
                status: 409,
                details: { reason: 'NO_TEAM_CALENDAR' },
            });
            const own = await setTeamWorkingCalendar(admin, otherTeamId, { timeZone: 'Pacific/Kiritimati', workingWeekdays: [1, 2, 3, 4, 5, 6, 7] });
            expect(own.calendar).toMatchObject({ teamId: otherTeamId, name: 'Kiritimati', timeZone: 'Pacific/Kiritimati', workingWeekdays: [1, 2, 3, 4, 5, 6, 7] });
            expect((await getWorkingCalendars(owner)).teams.find((t) => t.teamId === otherTeamId)?.calendarId).toBe(own.calendar!.id);
            const added = await addTeamHolidays(owner, otherTeamId, { holidays: [{ day: '2027-07-04', name: 'Island day' }] });
            await removeTeamHoliday(owner, otherTeamId, added.calendar.holidays[0]!.id);
            const back = await removeTeamWorkingCalendar(owner, otherTeamId);
            expect(back.calendar).toBeNull();
            const [removed] = await audits('WORKING_CALENDAR_REMOVED');
            expect(removed?.metadataJson).toMatchObject({ scope: 'team', teamId: otherTeamId });
            await expect(removeTeamWorkingCalendar(owner, otherTeamId)).rejects.toMatchObject({ status: 404 });
            await expect(getTeamWorkingCalendar(owner, 'no-such-team')).rejects.toMatchObject({ status: 404 });
        });
    });

    describe('review steps on working calendars (decision 192)', () => {
        it("count on the item's team's calendar, from today in its zone; a stored due day never moves", async () => {
            // Every day works in Kiritimati (UTC+14), except the next two there.
            const today = todayIn('Pacific/Kiritimati', new Date());
            await setTeamWorkingCalendar(owner, otherTeamId, { timeZone: 'Pacific/Kiritimati', workingWeekdays: [1, 2, 3, 4, 5, 6, 7] });
            await addTeamHolidays(owner, otherTeamId, {
                holidays: [
                    { day: fromEpochDay(today + 1), name: 'One' },
                    { day: fromEpochDay(today + 2), name: 'Two' },
                ],
            });
            const island = await openStep(otherProjectId, 'Island review', 1);
            expect(island.dueOn).toBe(fromEpochDay(today + 3));
            // The workspace's calendar (Sofia, Monday to Friday, its holidays) for the other team.
            const ws = (await getWorkingCalendars(owner)).workspace;
            const wsCal = compileCalendar({ id: 'ws', workingWeekdays: ws.workingWeekdays, holidays: ws.holidays.map((h) => Math.round(Date.parse(`${h.day}T00:00:00Z`) / 86_400_000)) });
            const core = await openStep(projectId, 'Core review', 4);
            expect(core.dueOn).toBe(fromEpochDay(workingDaysAfter(wsCal, todayIn('Europe/Sofia', new Date()), 4)));
            // A calendar changed afterwards moves no stored due day.
            await setTeamWorkingCalendar(owner, otherTeamId, { timeZone: 'UTC', workingWeekdays: [3] });
            await removeTeamWorkingCalendar(owner, otherTeamId);
            const stored = await prisma.workItemReviewStep.findUnique({ where: { id: island.stepId } });
            expect(stored?.dueOn?.toISOString().slice(0, 10)).toBe(island.dueOn);
        });

        it("the 08:00 reminders take the next working day from the item's calendar", async () => {
            // A team that works only Wednesdays: a step due next Wednesday is "next" from any day before it.
            await setTeamWorkingCalendar(owner, otherTeamId, { timeZone: 'UTC', workingWeekdays: [3] });
            const { itemId, stepId } = await openStep(otherProjectId, 'Wednesday review', 1);
            const step = await prisma.workItemReviewStep.findUnique({ where: { id: stepId } });
            const due = step!.dueOn!;
            expect(due.getUTCDay()).toBe(3);
            // Run on the Monday before: on Monday to Friday that is "neither", on this calendar "next".
            const monday = new Date(due.getTime() - 2 * 86_400_000 + 9 * 3_600_000);
            await processWorkItemDueNotifications({ tenantId, now: monday, tz: 'UTC' });
            const bells = await prisma.notification.findMany({ where: { tenantId, userId: member.userId, type: 'WORK_ITEM_REVIEW_DUE', workItemId: itemId } });
            expect(bells).toHaveLength(1);
            await removeTeamWorkingCalendar(owner, otherTeamId);
        });
    });

    describe('what the database holds', () => {
        it('one workspace calendar, one per team, and a weekday set', async () => {
            const ws = (await prisma.workingCalendar.findFirst({ where: { tenantId, teamId: null } }))!;
            const base = { tenantId, name: 'X', timeZone: 'UTC' };
            await expect(prisma.workingCalendar.create({ data: { ...base, teamId: null, workingWeekdays: MON_FRI } })).rejects.toThrow();
            const own = await prisma.workingCalendar.create({ data: { ...base, teamId, workingWeekdays: MON_FRI } });
            await expect(prisma.workingCalendar.create({ data: { ...base, teamId, workingWeekdays: MON_FRI } })).rejects.toThrow();
            await prisma.workingCalendar.delete({ where: { id: own.id } });
            for (const bad of [[], [0], [8], [2, 1], [1, 1]]) {
                await expect(prisma.workingCalendar.update({ where: { id: ws.id }, data: { workingWeekdays: bad } })).rejects.toThrow(/WorkingCalendar_working_weekdays/);
            }
            await expect(prisma.workingCalendarHoliday.create({ data: { tenantId, calendarId: ws.id, day: new Date('2027-01-01T00:00:00Z'), name: 'Dup' } })).rejects.toThrow();
        });

        it("a team's deletion removes its calendar", async () => {
            const temp = await createTeam(owner, { name: 'Temporary' });
            await setTeamWorkingCalendar(owner, temp.id, { timeZone: 'UTC', workingWeekdays: MON_FRI });
            await prisma.team.delete({ where: { id: temp.id } });
            expect(await prisma.workingCalendar.count({ where: { teamId: temp.id } })).toBe(0);
        });
    });

    describe('the route matrix (decision 193)', () => {
        const ctxFor = (role: Role) => ({ OWNER: owner, ADMIN: admin, MEMBER: member, VIEWER: viewer, GUEST: guest })[role as 'OWNER'];
        const denied = () => prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED' } });
        const call = async (role: Role, route: string, method: string, url: string, params: Record<string, string>, body?: unknown) => {
            getTenantCtxMock.mockResolvedValue({ ...ctxFor(role), requestId: `${TAG}-${role}-${Math.random()}` });
            const mod = (await import(`../../src/app/api/t/[tenantSlug]/${route}`)) as Record<string, Handler>;
            const res = await mod[method]!(request(method, url, body), { params: Promise.resolve({ tenantSlug: TAG, ...params }) });
            return res.status;
        };
        const write = (role: Role, ok: number) => (role === 'OWNER' || role === 'ADMIN' ? ok : 403);
        // Decision 204: a GUEST holds no key until 8.4, so it is refused the reads too.
        const read = (role: Role, ok: number) => (role === 'GUEST' ? 403 : ok);

        it.each(ROLES)('as %s', async (role) => {
            const before = await denied();
            const statuses: Array<[string, number, number]> = [];
            const check = async (label: string, got: Promise<number>, want: number) => statuses.push([label, await got, want]);
            await check('GET workspace', call(role, 'working-calendar/route.ts', 'GET', '/working-calendar', {}), read(role, 200));
            await check('PUT workspace', call(role, 'working-calendar/route.ts', 'PUT', '/working-calendar', {}, { timeZone: 'Europe/Sofia', workingWeekdays: MON_FRI }), write(role, 200));
            await check(
                'POST holidays',
                call(role, 'working-calendar/holidays/route.ts', 'POST', '/working-calendar/holidays', {}, { holidays: [{ day: '2028-01-01', name: 'New Year' }] }),
                write(role, 201),
            );
            const ws = (await getWorkingCalendars(owner)).workspace;
            const holiday = ws.holidays.find((h) => h.day === '2028-01-01') ?? (await addWorkspaceHolidays(owner, { holidays: [{ day: '2028-01-01', name: 'New Year' }] })).calendar.holidays.find((h) => h.day === '2028-01-01')!;
            await check('DELETE holiday', call(role, 'working-calendar/holidays/[holidayId]/route.ts', 'DELETE', `/working-calendar/holidays/${holiday.id}`, { holidayId: holiday.id }), write(role, 200));
            const t = `teams/[teamId]/working-calendar`;
            await check('GET team', call(role, `${t}/route.ts`, 'GET', `/teams/${teamId}/working-calendar`, { teamId }), read(role, 200));
            await check('PUT team', call(role, `${t}/route.ts`, 'PUT', `/teams/${teamId}/working-calendar`, { teamId }, { timeZone: 'UTC', workingWeekdays: MON_FRI }), write(role, 200));
            if (role !== 'OWNER' && role !== 'ADMIN') await setTeamWorkingCalendar(owner, teamId, { timeZone: 'UTC', workingWeekdays: MON_FRI });
            await check(
                'POST team holidays',
                call(role, `${t}/holidays/route.ts`, 'POST', `/teams/${teamId}/working-calendar/holidays`, { teamId }, { holidays: [{ day: '2028-02-02', name: 'Team day' }] }),
                write(role, 201),
            );
            const own = (await getTeamWorkingCalendar(owner, teamId)).calendar!;
            const th = own.holidays.find((h) => h.day === '2028-02-02') ?? (await addTeamHolidays(owner, teamId, { holidays: [{ day: '2028-02-02', name: 'Team day' }] })).calendar.holidays.find((h) => h.day === '2028-02-02')!;
            await check(
                'DELETE team holiday',
                call(role, `${t}/holidays/[holidayId]/route.ts`, 'DELETE', `/teams/${teamId}/working-calendar/holidays/${th.id}`, { teamId, holidayId: th.id }),
                write(role, 200),
            );
            await check('DELETE team', call(role, `${t}/route.ts`, 'DELETE', `/teams/${teamId}/working-calendar`, { teamId }), write(role, 200));
            if (role !== 'OWNER' && role !== 'ADMIN') await removeTeamWorkingCalendar(owner, teamId);
            for (const [label, got, want] of statuses) expect({ label, got }).toEqual({ label, got: want });
            const refusals = statuses.filter(([, got]) => got === 403).length;
            expect(await denied()).toBe(before + refusals);
        });

        it('a body that does not parse is a 400', async () => {
            expect(await call('OWNER', 'working-calendar/route.ts', 'PUT', '/working-calendar', {}, { timeZone: 'UTC', workingWeekdays: [9] })).toBe(400);
            expect(await call('OWNER', 'working-calendar/holidays/route.ts', 'POST', '/working-calendar/holidays', {}, { holidays: [{ day: '1 May', name: 'x' }] })).toBe(400);
        });
    });

    describe('two-tenant isolation as app_user', () => {
        const snapshotA = async () => ({
            calendars: await prisma.workingCalendar.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
            holidays: await prisma.workingCalendarHoliday.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
        });

        it("B reads and counts none of A's rows", async () => {
            expect((await snapshotA()).holidays.length).toBeGreaterThan(0);
            expect(await runInTenantContext(outsider, (db) => db.workingCalendar.count({}))).toBe(0);
            expect(await runInTenantContext(outsider, (db) => db.workingCalendarHoliday.count({}))).toBe(0);
            expect(await runInTenantContext(owner, (db) => db.workingCalendar.count({}))).toBeGreaterThan(0);
            expect((await getWorkingCalendars(outsider)).workspace.isDefault).toBe(true);
            await expect(getTeamWorkingCalendar(outsider, teamId)).rejects.toMatchObject({ status: 404 });
        });

        it("B changes or removes none of A's rows and cannot create one in A", async () => {
            const before = await snapshotA();
            const r1 = await runInTenantContext(outsider, (db) => db.workingCalendar.updateMany({ where: { tenantId }, data: { name: 'Hijacked' } }));
            expect(r1.count).toBe(0);
            const r2 = await runInTenantContext(outsider, (db) => db.workingCalendarHoliday.deleteMany({ where: { tenantId } }));
            expect(r2.count).toBe(0);
            const r3 = await runInTenantContext(outsider, (db) => db.workingCalendar.deleteMany({ where: { tenantId } }));
            expect(r3.count).toBe(0);
            expect(await snapshotA()).toEqual(before);
            await expect(
                runInTenantContext(outsider, (db) => db.workingCalendar.create({ data: { tenantId, teamId, name: 'Planted', timeZone: 'UTC', workingWeekdays: MON_FRI } })),
            ).rejects.toThrow();
            await expect(
                runInTenantContext(outsider, (db) =>
                    db.workingCalendarHoliday.create({ data: { tenantId, calendarId: before.calendars[0]!.id, day: new Date('2030-01-01T00:00:00Z'), name: 'Planted' } }),
                ),
            ).rejects.toThrow();
            await expect(removeWorkspaceHoliday(outsider, before.holidays[0]!.id)).rejects.toMatchObject({ status: 404 });
        });
    });

    it('the audit chain verifies', async () => {
        expect((await verifyAuditChain(tenantId, prisma)).valid).toBe(true);
    });
});
