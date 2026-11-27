/**
 * The analytics reads through their usecases against a real Postgres
 * (sub-phase 3.6a; owner decisions 311 to 316, 329 and 331; ADR 0014;
 * docs/porting/maps/3.6.md, "The measures", "What counts and what does
 * not"):
 *
 *   - counts, throughput, cycle time, lead time and age, cumulative flow and
 *     the burn-up of one project over a planted history, by hand;
 *   - a moved item counts in each project for its time there (recorded
 *     fields as recorded), a label filter judges current values, the status
 *     filters are set aside and named;
 *   - an archived project's history counts and its open items are out of the
 *     figures about now (unless `includeArchived`); a deleted project's never
 *     count;
 *   - the scope's calendar draws the days (one project: its team's zone; two
 *     projects: the workspace's), and the cycle burn-up follows its team's
 *     calendar zone (decision 316);
 *   - the burn-up offers points only where every team in scope estimates in
 *     them (`MEASURE_UNAVAILABLE` otherwise);
 *   - a window over 366 days or reversed is a 400 `ANALYTICS_RANGE`; a GUEST
 *     is refused (decision 204); nothing is audited.
 *
 * The record's rows are replaced by planted, back-dated ones (the test
 * client, the login role); the items themselves are made through the
 * usecases. Written fresh for Islestone.
 */
import type { PrismaClient, Role, WorkflowStateCategory } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { getAnalyticsCounts, getDurations, getFlow, getThroughput, type AnalyticsQuery } from '@/app-layer/usecases/analytics';
import { createCycle, getCycleBurnUp } from '@/app-layer/usecases/cycle';
import { createLabel } from '@/app-layer/usecases/label';
import { createProject } from '@/app-layer/usecases/project';
import { createTeam, updateTeam } from '@/app-layer/usecases/team';
import { createWorkItem } from '@/app-layer/usecases/work-item';
import { addWorkItemLabels } from '@/app-layer/usecases/work-item-collab';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { setTeamWorkingCalendar } from '@/app-layer/usecases/working-calendar';
import { AppError } from '@/lib/errors/types';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `anly${Date.now().toString(36)}`;
const ROLES: readonly Role[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST'];

/** The moment of reading: Friday 21 March 2031, noon UTC. Mondays: 3, 10, 17 March. */
const NOW = new Date('2031-03-21T12:00:00.000Z');
const at = (s: string) => new Date(`2031-${s}:00.000Z`);
const WINDOW = { from: '2031-03-03', to: '2031-03-21' };

describeFn('the analytics reads (3.6a)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    const ctxs = {} as Record<Role, RequestContext>;
    let owner: RequestContext;
    let teamId = '';
    let otherTeamId = '';
    let p = '';
    let q = '';
    let archived = '';
    let gone = '';
    let typeId = '';
    let labelId = '';
    const states = {} as Record<WorkflowStateCategory, string>;
    const ids: Record<string, string> = {};
    const savedTz = process.env.NOTIFICATIONS_TZ;

    /** Replace an item's record with `rows` (in order), each the item's picture after a change. */
    async function history(item: string, rows: Array<{ at: Date; category: WorkflowStateCategory; projectId?: string; teamId?: string; deleted?: boolean; cycleId?: string | null; points?: number | null }>) {
        await prisma.workItemTransition.deleteMany({ where: { workItemId: ids[item]! } });
        let previous: WorkflowStateCategory | null = null;
        for (const r of rows) {
            await prisma.workItemTransition.create({
                data: {
                    tenantId,
                    workItemId: ids[item]!,
                    projectId: r.projectId ?? p,
                    teamId: r.teamId ?? teamId,
                    stateId: states[r.category],
                    stateCategory: r.category,
                    fromStateCategory: previous,
                    cycleId: r.cycleId ?? null,
                    deleted: r.deleted ?? false,
                    estimatePoints: r.points ?? null,
                    at: r.at,
                },
            });
            previous = r.category;
        }
    }

    async function item(key: string, projectId: string, category: WorkflowStateCategory) {
        ids[key] = (await createWorkItem(owner, { projectId, typeId, title: key })).id;
        const team = projectId === q ? otherTeamId : teamId;
        await prisma.workItem.update({ where: { id: ids[key] }, data: { stateId: (await prisma.workflowState.findFirst({ where: { teamId: team, category } }))!.id, stateCategory: category } });
    }

    const query = (extra: Partial<AnalyticsQuery> = {}): AnalyticsQuery => ({ ...WINDOW, projectId: p, ...extra });

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
        for (const s of await prisma.workflowState.findMany({ where: { teamId } })) states[s.category] ??= s.id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
        p = (await createProject(owner, { teamId, name: 'Platform', keyPrefix: 'PLT' })).id;
        q = (await createProject(owner, { teamId: otherTeamId, name: 'Mobile', keyPrefix: 'MOB' })).id;
        archived = (await createProject(owner, { teamId, name: 'Old', keyPrefix: 'OLD' })).id;
        gone = (await createProject(owner, { teamId, name: 'Gone', keyPrefix: 'GON' })).id;
        labelId = (await createLabel(owner, { name: 'Bug' })).id;

        // Platform: a, started Tuesday 4 and done Thursday 6 (one working day of cycle time from 09:00 to 09:00 … 2 days).
        await item('a', p, 'DONE');
        await history('a', [
            { at: at('03-04T09:00'), category: 'UNSTARTED' },
            { at: at('03-05T09:00'), category: 'STARTED' },
            { at: at('03-07T09:00'), category: 'DONE' },
        ]);
        // b: done Monday 10 without starting; labelled Bug.
        await item('b', p, 'DONE');
        await history('b', [
            { at: at('03-03T10:00'), category: 'BACKLOG' },
            { at: at('03-10T10:00'), category: 'DONE' },
        ]);
        await addWorkItemLabels(owner, ids.b!, [labelId]);
        await history('b', [
            { at: at('03-03T10:00'), category: 'BACKLOG' },
            { at: at('03-10T10:00'), category: 'DONE' },
        ]);
        // c: started Monday 10, open now (age), reopened once.
        await item('c', p, 'STARTED');
        await history('c', [
            { at: at('03-03T08:00'), category: 'UNSTARTED' },
            { at: at('03-10T08:00'), category: 'STARTED' },
            { at: at('03-12T08:00'), category: 'DONE' },
            { at: at('03-13T08:00'), category: 'STARTED' },
        ]);
        // m: moved from Platform to Mobile on Wednesday 12, started throughout.
        await item('m', q, 'STARTED');
        await history('m', [
            { at: at('03-03T09:00'), category: 'STARTED' },
            { at: at('03-12T09:00'), category: 'STARTED', projectId: q, teamId: otherTeamId },
        ]);
        // x: cancelled; never counted.
        await item('x', p, 'CANCELLED');
        await history('x', [
            { at: at('03-04T09:00'), category: 'UNSTARTED' },
            { at: at('03-06T09:00'), category: 'CANCELLED' },
        ]);
        // o: done in the archived project on Tuesday 11; s: started there now.
        await item('o', archived, 'DONE');
        await history('o', [
            { at: at('03-04T09:00'), category: 'STARTED', projectId: archived },
            { at: at('03-11T09:00'), category: 'DONE', projectId: archived },
        ]);
        await item('s', archived, 'STARTED');
        await history('s', [{ at: at('03-04T09:00'), category: 'STARTED', projectId: archived }]);
        // g: done in a project deleted since.
        await item('g', gone, 'DONE');
        await history('g', [
            { at: at('03-04T09:00'), category: 'STARTED', projectId: gone },
            { at: at('03-05T09:00'), category: 'DONE', projectId: gone },
        ]);
        await prisma.project.update({ where: { id: archived }, data: { archivedAt: new Date() } });
        await prisma.project.update({ where: { id: gone }, data: { deletedAt: new Date() } });
    });

    afterAll(async () => {
        process.env.NOTIFICATIONS_TZ = savedTz;
        await prisma.$disconnect();
    });

    it('counts a project: open and started now, done and created in the window', async () => {
        const counts = await getAnalyticsCounts(owner, query(), NOW);
        // Now: c started; a and b done; x cancelled; m has moved to Mobile. Created in Platform in the window:
        // a, b, c, x and m (judged by its first row's recorded project).
        expect({ open: counts.open, started: counts.started, done: counts.doneInWindow, created: counts.createdInWindow }).toEqual({ open: 1, started: 1, done: 2, created: 5 });
        expect(counts).toMatchObject({ from: WINDOW.from, to: WINDOW.to, asOf: '2031-03-21', timeZone: 'UTC', calendarTeamId: null, setAside: [] });
    });

    it('bins throughput per ISO week and per day, the reopened item out until it is done again', async () => {
        const weekly = await getThroughput(owner, { ...query(), bin: 'week' }, NOW);
        expect(weekly.bins.map((b) => [b.start, b.end, b.count, b.whole])).toEqual([
            ['2031-03-03', '2031-03-09', 1, true],
            ['2031-03-10', '2031-03-16', 1, true],
            ['2031-03-17', '2031-03-21', 0, false],
        ]);
        expect(weekly.total).toBe(2);
        expect(weekly.median).toBe(1);
        const daily = await getThroughput(owner, { ...query(), bin: 'day' }, NOW);
        expect(daily.bins.filter((b) => b.count > 0).map((b) => b.start)).toEqual(['2031-03-07', '2031-03-10']);
        // As of the 12th afternoon, c was done (and counted); its reopen on the 13th takes it out.
        const before = await getThroughput(owner, { ...query({ to: '2031-03-12' }), bin: 'day' }, new Date('2031-03-12T18:00:00Z'));
        expect(before.bins.filter((b) => b.count > 0).map((b) => b.start)).toEqual(['2031-03-07', '2031-03-10', '2031-03-12']);
    });

    it('measures cycle time from the first start and lead time from creation, on working days, with age', async () => {
        const d = await getDurations(owner, { ...query(), measure: 'cycle' }, NOW);
        // a: Wednesday 09:00 to Friday 09:00, 2.0; created Tuesday: 3.0. b: Monday 3 10:00 to Monday 10 10:00 less a weekend: 5.0.
        expect(d.cycleTime).toEqual({ count: 1, p50: 2, p85: 2, p95: 2 });
        expect(d.leadTime).toEqual({ count: 2, p50: 3, p85: 5, p95: 5 });
        expect(d.doneWithoutStarting).toBe(1);
        expect(d.points.map((x) => [x.key.slice(0, 3), x.completedOn, x.cycleTime, x.leadTime])).toEqual([
            ['PLT', '2031-03-10', null, 5],
            ['PLT', '2031-03-07', 2, 3],
        ]);
        expect(d.pointsNewestOnly).toBe(false);
        // c: first started Monday 10 08:00, now Friday 21 12:00 less one weekend: 9.2 days.
        expect(d.age.map((x) => [x.title, x.startedOn, x.age])).toEqual([['c', '2031-03-10', 9.2]]);
        expect(d.ageTotal).toBe(1);
        const lead = await getDurations(owner, { ...query(), measure: 'lead' }, NOW);
        expect(lead.age).toEqual([]);
    });

    it('draws cumulative flow by recorded project: a moved item counts in each project for its time there', async () => {
        const inP = await getFlow(owner, query(), NOW);
        const day = (f: typeof inP, date: string) => f.days.find((x) => x.date === date)!;
        // The 11th: m still in Platform (started), c started, a done since the window started, b backlog.
        expect(day(inP, '2031-03-11')).toEqual({ date: '2031-03-11', backlog: 0, unstarted: 0, started: 2, done: 2 });
        // The 12th: m has left; c done.
        expect(day(inP, '2031-03-12')).toEqual({ date: '2031-03-12', backlog: 0, unstarted: 0, started: 0, done: 3 });
        expect(day(inP, '2031-03-21')).toEqual({ date: '2031-03-21', backlog: 0, unstarted: 0, started: 1, done: 2 });
        const inQ = await getFlow(owner, query({ projectId: q }), NOW);
        expect(day(inQ, '2031-03-11').started).toBe(0);
        expect(day(inQ, '2031-03-12').started).toBe(1);
        expect(inP.resolution).toBe('day');
        expect(inP.burnUp).toBeNull();
    });

    it('counts the burn-up for any scope; points only where every team in scope estimates in them', async () => {
        const f = await getFlow(owner, { ...query(), burnUp: true }, NOW);
        expect(f.burnUp!.measures).toEqual(['items']);
        expect(f.burnUp!.points.find((x) => x.date === '2031-03-21')).toEqual({ date: '2031-03-21', scope: 3, started: 3, completed: 2 });
        await expect(getFlow(owner, { ...query(), burnUp: true, measure: 'points' }, NOW)).rejects.toMatchObject({ details: { reason: 'MEASURE_UNAVAILABLE' } });
        await updateTeam(owner, teamId, { estimateUnit: 'POINTS' });
        try {
            const pts = await getFlow(owner, { ...query(), burnUp: true, measure: 'points' }, NOW);
            expect(pts.burnUp!.measures).toEqual(['items', 'points']);
            expect(pts.burnUp!.points.at(-1)).toMatchObject({ scope: 0, unestimated: 3 });
            // Two teams, one not estimating: items only.
            const both = await getFlow(owner, { ...query({ projectId: `${p},${q}` }), burnUp: true }, NOW);
            expect(both.burnUp!.measures).toEqual(['items']);
        } finally {
            await updateTeam(owner, teamId, { estimateUnit: null });
        }
    });

    it('judges a label filter by current values, and sets the status filters aside, naming them', async () => {
        const bugs = await getThroughput(owner, { ...query({ labelId }), bin: 'day' }, NOW);
        expect(bugs.total).toBe(1);
        const setAside = await getThroughput(owner, { ...query({ stateCategory: 'BACKLOG', due: 'overdue' }) }, NOW);
        expect(setAside.total).toBe(2);
        expect(setAside.setAside).toEqual(['stateCategory', 'due']);
    });

    it("counts an archived project's history but not its open items now, and never a deleted project's", async () => {
        const ws = await getThroughput(owner, { ...WINDOW, bin: 'day' }, NOW);
        // a, b and the archived project's o; never g (its project is deleted).
        expect(ws.total).toBe(3);
        const counts = await getAnalyticsCounts(owner, WINDOW, NOW);
        // Started now: c and m; s is in an archived project.
        expect(counts.started).toBe(2);
        expect((await getAnalyticsCounts(owner, { ...WINDOW, includeArchived: true }, NOW)).started).toBe(3);
    });

    it("cuts days in the scope's calendar zone: one project its team's, two projects the workspace's", async () => {
        await setTeamWorkingCalendar(owner, teamId, { timeZone: 'Pacific/Kiritimati', workingWeekdays: [1, 2, 3, 4, 5] });
        try {
            const one = await getThroughput(owner, { ...query(), bin: 'day' }, NOW);
            expect(one.timeZone).toBe('Pacific/Kiritimati');
            expect(one.calendarTeamId).toBe(teamId);
            // a done Friday 7 at 09:00 UTC is 23:00 that day in UTC+14; b on Monday 10 at 10:00 UTC is Tuesday 11 there.
            expect(one.bins.filter((b) => b.count > 0).map((b) => b.start)).toEqual(['2031-03-07', '2031-03-11']);
            const two = await getThroughput(owner, { ...query({ projectId: `${p},${q}` }), bin: 'day' }, NOW);
            expect(two.timeZone).toBe('UTC');
            expect(two.calendarTeamId).toBeNull();
        } finally {
            await prisma.workingCalendar.deleteMany({ where: { tenantId, teamId } });
        }
    });

    it("draws the cycle burn-up's days in its team's calendar zone (decision 316)", async () => {
        const cycleId = (await createCycle(owner, { teamId, name: 'March', startsOn: '2031-03-03', endsOn: '2031-03-16' })).id;
        await item('k', p, 'DONE');
        await history('k', [
            { at: at('03-03T09:00'), category: 'UNSTARTED', cycleId },
            { at: at('03-05T11:00'), category: 'DONE', cycleId },
        ]);
        const utc = await getCycleBurnUp(owner, cycleId, NOW);
        expect(utc.points.find((x) => x.date === '2031-03-05')!.completed).toBe(1);
        await setTeamWorkingCalendar(owner, teamId, { timeZone: 'Pacific/Kiritimati', workingWeekdays: [1, 2, 3, 4, 5] });
        try {
            // 11:00 UTC on the 5th is 01:00 on the 6th in UTC+14.
            const kiri = await getCycleBurnUp(owner, cycleId, NOW);
            expect(kiri.points.find((x) => x.date === '2031-03-05')!.completed).toBe(0);
            expect(kiri.points.find((x) => x.date === '2031-03-06')!.completed).toBe(1);
        } finally {
            await prisma.workingCalendar.deleteMany({ where: { tenantId, teamId } });
        }
    });

    it('refuses a window over 366 days or reversed, and a guest; every other role reads', async () => {
        await expect(getThroughput(owner, { from: '2030-01-01', to: '2031-03-01' }, NOW)).rejects.toMatchObject({ details: { reason: 'ANALYTICS_RANGE' } });
        await expect(getFlow(owner, { from: '2031-03-10', to: '2031-03-01' }, NOW)).rejects.toMatchObject({ details: { reason: 'ANALYTICS_RANGE' } });
        await expect(getAnalyticsCounts(ctxs.GUEST, WINDOW, NOW)).rejects.toBeInstanceOf(AppError);
        for (const role of ['ADMIN', 'MEMBER', 'VIEWER'] as const) {
            // a, b and the cycle's k.
            expect((await getThroughput(ctxs[role], query(), NOW)).total).toBe(3);
        }
    });

    it('writes nothing to the audit trail', async () => {
        const before = await prisma.auditLog.count({ where: { tenantId } });
        await getFlow(owner, { ...query(), burnUp: true }, NOW);
        await getDurations(owner, query(), NOW);
        expect(await prisma.auditLog.count({ where: { tenantId } })).toBe(before);
    });
});
