/**
 * The forecast read against a real Postgres (sub-phase 3.6c; owner decisions
 * 318 to 325, 329; ADR 0014 §3 to §5; docs/porting/maps/3.6.md,
 * "Forecasting"):
 *
 *   - a project's open items forecast from its own completions: the dates,
 *     the based-on line, the window, the seed derived and stable on reload,
 *     the chance by the project's due date, the histogram and the curve, and
 *     the scope's own record over planted weeks;
 *   - the share, a subset of projects, the team and the workspace as the
 *     history; a team asked for a scope over two teams and a history project
 *     outside the scope refused (400 `FORECAST_HISTORY`);
 *   - a cycle forecast from its team by default, its end the due date; a
 *     milestone's due date;
 *   - refusals as answers, never dates: nothing open, too few completions,
 *     too few working days of record;
 *   - the history read as the record stands: a completion reopened or
 *     deleted is not in the sample, and the record's spans equal the
 *     completions read on random histories;
 *   - a GUEST refused (decision 204); nothing audited.
 *
 * The record's rows are planted directly (the test client, the login role):
 * `WorkItemTransition` has no key to `WorkItem`, so the history's items need
 * no rows of their own; the open items are made through the usecases.
 * Written fresh for Islestone.
 */
import fc from 'fast-check';
import type { PrismaClient, Role, WorkflowStateCategory } from '@prisma/client';

import { completionSpans, daySpansOf, type SpanRow } from '@/app-layer/domain/analytics/completion';
import { epochDayOf, startOfEpochDay } from '@/app-layer/domain/analytics/zone';
import type { RequestContext } from '@/app-layer/types';
import { getForecast } from '@/app-layer/usecases/analytics-forecast';
import { createCycle } from '@/app-layer/usecases/cycle';
import { createMilestone } from '@/app-layer/usecases/milestone';
import { createProject, updateProject } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { createWorkItem } from '@/app-layer/usecases/work-item';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { WorkItemTransitionRepository } from '@/app-layer/repositories/WorkItemTransitionRepository';
import { visibleProjects } from '@/app-layer/policies/project-visibility';
import { isoWeekday, toEpochDay } from '@/app-layer/domain/schedule/calendar';
import { runInTenantContext } from '@/lib/db-context';
import { AppError } from '@/lib/errors/types';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `fcst${Date.now().toString(36)}`;
const ROLES: readonly Role[] = ['OWNER', 'MEMBER', 'VIEWER', 'GUEST'];

/** The moment of reading: Friday 21 March 2031, noon UTC. */
const NOW = new Date('2031-03-21T12:00:00.000Z');
const TODAY = toEpochDay('2031-03-21');
const dayAt = (d: number, hour = 10) => new Date(startOfEpochDay(d, 'UTC').getTime() + hour * 3_600_000);

describeFn('the forecast read (3.6c)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    const ctxs = {} as Record<Role, RequestContext>;
    let owner: RequestContext;
    let teamId = '';
    let otherTeamId = '';
    let p = ''; // Platform: a steady history of 45 weeks
    let w = ''; // Web: same team, a thin history
    let m = ''; // Mobile: another team, no history
    let typeId = '';
    const states = {} as Record<WorkflowStateCategory, string>;
    let seq = 0;
    const savedTz = process.env.NOTIFICATIONS_TZ;

    /** Plant one history item's rows: each row the item's picture after a change. */
    function rows(projectId: string, team: string, spec: Array<{ at: Date; category: WorkflowStateCategory; deleted?: boolean }>) {
        seq += 1;
        const workItemId = `${TAG}h${seq}`;
        let previous: WorkflowStateCategory | null = null;
        return spec.map((r) => {
            const row = { tenantId, workItemId, projectId, teamId: team, stateId: states[r.category], stateCategory: r.category, fromStateCategory: previous, deleted: r.deleted ?? false, at: r.at };
            previous = r.category;
            return row;
        });
    }

    async function open(projectId: string, n: number, extra: { cycleId?: string; milestoneId?: string } = {}) {
        for (let i = 0; i < n; i += 1) await createWorkItem(owner, { projectId, typeId, title: `open ${i}`, ...extra });
    }

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
        w = (await createProject(owner, { teamId, name: 'Web', keyPrefix: 'WEB' })).id;
        m = (await createProject(owner, { teamId: otherTeamId, name: 'Mobile', keyPrefix: 'MOB' })).id;

        // Platform: 45 weeks of history, created a week before; 1 to 5 completions every working day.
        const planted: ReturnType<typeof rows> = [];
        const first = TODAY - 7 * 45;
        planted.push(...rows(p, teamId, [{ at: dayAt(first - 7), category: 'BACKLOG' }]));
        for (let d = first; d < TODAY; d += 1) {
            if (isoWeekday(d) > 5) continue;
            const n = 1 + ((d * 7) % 5);
            for (let k = 0; k < n; k += 1) {
                planted.push(...rows(p, teamId, [
                    { at: dayAt(d - 3), category: 'UNSTARTED' },
                    { at: dayAt(d - 1), category: 'STARTED' },
                    { at: dayAt(d, 9 + k), category: 'DONE' },
                ]));
            }
        }
        // Web: 8 completions over two weeks.
        for (let i = 0; i < 8; i += 1) planted.push(...rows(w, teamId, [{ at: dayAt(TODAY - 14 + i), category: 'UNSTARTED' }, { at: dayAt(TODAY - 13 + i), category: 'DONE' }]));
        await prisma.workItemTransition.createMany({ data: planted });

        await open(p, 30);
        await updateProject(owner, p, { dueDate: '2031-06-30' });
    });

    afterAll(async () => {
        process.env.NOTIFICATIONS_TZ = savedTz;
        await prisma.$disconnect();
    });

    it('forecasts a project from its own completions, with its due date, histogram, curve, seed and record', async () => {
        const f = await getForecast(owner, { projectId: p }, NOW);
        expect(f.refused).toBeNull();
        expect(f.remaining).toBe(30);
        expect(f.scope).toEqual({ kind: 'project', dueDate: '2031-06-30' });
        expect(f.basedOn).toEqual({ kind: 'projects', projects: [{ id: p, name: 'Platform', keyPrefix: 'PLT' }], team: null });
        expect(f.offered.team).toEqual({ id: teamId, name: 'Core' });
        expect(f.history).toMatchObject({ weeks: 12, from: '2030-12-27', to: '2031-03-20', workingDays: 60 });
        expect(f.history.completions).toBeGreaterThan(150);
        expect(f.share).toBe(100);
        expect(f.trials).toBe(10_000);
        expect(f.cautions).toEqual([]);
        // About three a day: thirty items are about two weeks away.
        expect(f.likely!.p50.date > '2031-03-21' && f.likely!.p50.date < '2031-04-15').toBe(true);
        expect(f.likely!.p50.date <= f.likely!.p85.date && f.likely!.p85.date <= f.likely!.p95.date).toBe(true);
        expect(f.due).toEqual({ date: '2031-06-30', finished: 10_000, passed: false });
        expect(f.histogram!.resolution).toBe('day');
        expect(f.histogram!.buckets.reduce((s, b) => s + b.trials, 0)).toBe(10_000);
        expect(f.curve!.at(-1)!.finished).toBe(10_000);
        // The record: weekly origins over the last 52 weeks with a full window, each the next 30 completions.
        expect(f.record).toMatchObject({ status: 'SHOWN', size: 30 });
        if (f.record.status === 'SHOWN') {
            expect(f.record.p85.scorable).toBeGreaterThanOrEqual(25);
            expect(f.record.p50.held).toBeLessThanOrEqual(f.record.p85.held);
        }
        // The same data on the same day: the same seed and the same answer (decision 323).
        const again = await getForecast(owner, { projectId: p }, new Date(NOW.getTime() + 3_600_000));
        expect(again.seed).toBe(f.seed);
        expect(again.likely).toEqual(f.likely);
        // Another day, another seed.
        expect((await getForecast(owner, { projectId: p }, new Date(NOW.getTime() + 86_400_000))).seed).not.toBe(f.seed);
    });

    it('takes a share, a window, the team and the workspace as the history, and prints them', async () => {
        const full = await getForecast(owner, { projectId: p }, NOW);
        const half = await getForecast(owner, { projectId: p, share: 50 }, NOW);
        expect(half.share).toBe(50);
        expect(half.likely!.p50.date > full.likely!.p50.date).toBe(true);
        const four = await getForecast(owner, { projectId: p, historyWeeks: 4 }, NOW);
        expect(four.history).toMatchObject({ weeks: 4, from: '2031-02-21', workingDays: 20 });
        const team = await getForecast(owner, { projectId: p, basedOn: 'team' }, NOW);
        expect(team.basedOn).toEqual({ kind: 'team', projects: [], team: { id: teamId, name: 'Core' } });
        // The team's history adds Web's eight completions of the last two weeks.
        expect(team.history.completions).toBe(full.history.completions + 8);
        const ws = await getForecast(owner, { projectId: p, basedOn: 'workspace' }, NOW);
        expect(ws.basedOn).toEqual({ kind: 'workspace', projects: [], team: null });
        expect(ws.history.completions).toBe(team.history.completions);
    });

    it('refuses a team over two teams and a history project outside the scope', async () => {
        await open(m, 1);
        const both = await getForecast(owner, { projectId: `${p},${m}` }, NOW);
        expect(both.offered.team).toBeNull();
        expect(both.offered.projects.map((x) => x.name)).toEqual(['Mobile', 'Platform']);
        expect(both.scope.kind).toBe('filter');
        const subset = await getForecast(owner, { projectId: `${p},${m}`, historyProjectIds: [p] }, NOW);
        expect(subset.basedOn.projects.map((x) => x.id)).toEqual([p]);
        expect(subset.remaining).toBe(31);
        await expect(getForecast(owner, { projectId: `${p},${m}`, basedOn: 'team' }, NOW)).rejects.toMatchObject({ status: 400, details: { reason: 'FORECAST_HISTORY' } });
        await expect(getForecast(owner, { projectId: p, historyProjectIds: [w] }, NOW)).rejects.toMatchObject({ status: 400, details: { reason: 'FORECAST_HISTORY' } });
    });

    it('forecasts a cycle from its team by default, by its end, and a milestone by its due date', async () => {
        const cycle = await createCycle(owner, { teamId, startsOn: '2031-03-17', endsOn: '2031-03-28' });
        await open(p, 3, { cycleId: cycle.id });
        const c = await getForecast(owner, { teamId, cycleId: cycle.id }, NOW);
        expect(c.scope).toEqual({ kind: 'cycle', dueDate: '2031-03-28' });
        expect(c.basedOn.kind).toBe('team');
        expect(c.remaining).toBe(3);
        expect(c.due).toMatchObject({ date: '2031-03-28', passed: false });
        expect(c.due!.finished).toBe(10_000);

        const ms = await createMilestone(owner, p, { name: 'Beta', dueDate: '2031-03-24' });
        await open(p, 25, { milestoneId: ms.id });
        const f = await getForecast(owner, { projectId: p, milestoneId: ms.id }, NOW);
        expect(f.scope).toEqual({ kind: 'milestone', dueDate: '2031-03-24' });
        expect(f.remaining).toBe(25);
        // One working day (Monday 24) at about three a day: 25 items are unlikely by then.
        expect(f.due!.finished!).toBeLessThan(1_000);
    });

    it('refuses with its counts, never a date: nothing open, too few completions, too few working days', async () => {
        const nothing = await getForecast(owner, { projectId: w }, NOW);
        expect(nothing).toMatchObject({ remaining: 0, refused: { reason: 'NOTHING_REMAINING' }, likely: null, histogram: null, record: { status: 'NONE' } });
        await open(w, 4);
        // The items made now carry rows of the real day, years before NOW: keep only the planted history.
        await prisma.workItemTransition.deleteMany({ where: { projectId: w, at: { gt: NOW } } });
        await prisma.workItemTransition.deleteMany({ where: { projectId: w, at: { lt: dayAt(TODAY - 20) } } });
        const thin = await getForecast(owner, { projectId: w }, NOW);
        // Eight completions, recorded from fourteen days ago: too few completions comes first.
        expect(thin.refused).toEqual({ reason: 'TOO_FEW_COMPLETIONS', completions: 8, needed: 20, weeks: 12 });
        expect(thin.likely).toBeNull();
        expect(thin.history).toMatchObject({ from: '2031-03-07', completions: 8 });
        const young = await createProject(owner, { teamId, name: 'Young', keyPrefix: 'YNG' });
        const burst: ReturnType<typeof rows> = [];
        for (let i = 0; i < 30; i += 1) burst.push(...rows(young.id, teamId, [{ at: dayAt(TODAY - 6, 8), category: 'BACKLOG' }, { at: dayAt(TODAY - 5, 9), category: 'DONE' }]));
        await open(young.id, 2);
        await prisma.workItemTransition.deleteMany({ where: { projectId: young.id } });
        await prisma.workItemTransition.createMany({ data: burst });
        const r = await getForecast(owner, { projectId: young.id }, NOW);
        // Recorded from Saturday 15 March: Monday 17 to Thursday 20 are its working days (today is never history).
        expect(r.refused).toEqual({ reason: 'TOO_FEW_WORKING_DAYS', workingDays: 4, needed: 20 });
    });

    it('reads the history as the record stands: a reopened or deleted completion is not in the sample', async () => {
        const proj = await createProject(owner, { teamId, name: 'Churn', keyPrefix: 'CHN' });
        const planted: ReturnType<typeof rows> = [];
        for (let d = TODAY - 40; d < TODAY; d += 1) {
            if (isoWeekday(d) > 5) continue;
            planted.push(...rows(proj.id, teamId, [{ at: dayAt(d - 50), category: 'UNSTARTED' }, { at: dayAt(d), category: 'DONE' }]));
        }
        planted.push(...rows(proj.id, teamId, [{ at: dayAt(TODAY - 60), category: 'UNSTARTED' }, { at: dayAt(TODAY - 10), category: 'DONE' }, { at: dayAt(TODAY - 9), category: 'STARTED' }]));
        planted.push(...rows(proj.id, teamId, [{ at: dayAt(TODAY - 60), category: 'UNSTARTED' }, { at: dayAt(TODAY - 10), category: 'DONE' }, { at: dayAt(TODAY - 8), category: 'DONE', deleted: true }]));
        await prisma.workItemTransition.createMany({ data: planted });
        await open(proj.id, 5);
        const f = await getForecast(owner, { projectId: proj.id }, NOW);
        const working = Array.from({ length: 40 }, (_, i) => TODAY - 40 + i).filter((d) => isoWeekday(d) <= 5).length;
        expect(f.history.completions).toBe(working);
    });

    it('gives the record\'s spans the completions the throughput read counts, on random histories (decision 311)', async () => {
        const proj = await createProject(owner, { teamId, name: 'Random', keyPrefix: 'RND' });
        const categories: WorkflowStateCategory[] = ['BACKLOG', 'STARTED', 'DONE', 'CANCELLED'];
        await fc.assert(
            fc.asyncProperty(
                fc.array(fc.array(fc.record({ dt: fc.integer({ min: 1, max: 30 }), cat: fc.constantFrom(...categories), deleted: fc.boolean() }), { minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 20 }),
                async (items) => {
                    await prisma.workItemTransition.deleteMany({ where: { projectId: proj.id } });
                    const planted: ReturnType<typeof rows> = [];
                    for (const spec of items) {
                        let t = TODAY - 120;
                        planted.push(...rows(proj.id, teamId, spec.map((r) => ({ at: dayAt((t += 1 + (r.dt % 9))), category: r.cat, deleted: r.deleted }))));
                    }
                    await prisma.workItemTransition.createMany({ data: planted });
                    await runInTenantContext(owner, async (db) => {
                        const v = await visibleProjects(owner, db);
                        const scope = { visibility: v, projectIds: [proj.id], teamIds: null, cycle: null, milestone: null, itemIds: null };
                        const from = startOfEpochDay(TODAY - 200, 'UTC');
                        const perDay = await WorkItemTransitionRepository.completionsPerDay(db, owner, scope, { from, to: startOfEpochDay(TODAY + 1, 'UTC'), asOf: NOW, tz: 'UTC' });
                        const spanRows = await WorkItemTransitionRepository.completionSpanRows(db, owner, scope, { from, asOf: NOW }, 1_000);
                        const byItem = new Map<string, SpanRow[]>();
                        for (const r of spanRows) byItem.set(r.workItemId, [...(byItem.get(r.workItemId) ?? []), r]);
                        const current = new Map<number, number>();
                        for (const list of byItem.values()) {
                            for (const s of daySpansOf(completionSpans(list), (at) => epochDayOf(at, 'UTC'))) if (s.seenUntil === null) current.set(s.day, (current.get(s.day) ?? 0) + 1);
                        }
                        expect([...current].sort((a, b) => a[0] - b[0])).toEqual(perDay.map((r) => [r.day, r.count] as [number, number]).sort((a, b) => a[0] - b[0]));
                    });
                },
            ),
            { numRuns: 15 },
        );
    });

    it('answers every role that reads analytics, refuses a GUEST, and audits nothing', async () => {
        const before = await prisma.auditLog.count({ where: { tenantId } });
        expect((await getForecast(ctxs.VIEWER, { projectId: p }, NOW)).refused).toBeNull();
        expect((await getForecast(ctxs.MEMBER, { projectId: p }, NOW)).refused).toBeNull();
        await expect(getForecast(ctxs.GUEST, { projectId: p }, NOW)).rejects.toBeInstanceOf(AppError);
        expect(await prisma.auditLog.count({ where: { tenantId } })).toBe(before);
    });
});
