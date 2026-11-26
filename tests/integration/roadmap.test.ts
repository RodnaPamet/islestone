/**
 * The roadmap's read against a real Postgres, as `app_user` (sub-phase 3.2c;
 * docs/porting/maps/3.2.md, "The roadmap"; owner decisions 210, 215 and 217):
 *
 *   - a project's bar is the engine's span of its live, non-cancelled items'
 *     stored dates on its team's calendar (a due date alone is one working
 *     day ending on it, a start alone one working day from it), never a
 *     stored date; an initiative's the span of its projects, archived ones
 *     included; "No initiative" holds the unlinked projects, and a project of
 *     a deleted initiative; nothing dated is no bar;
 *   - due dates are diamonds: a project finishing after its initiative's or
 *     goal's due date is flagged, and so is the initiative; a project is late
 *     when its due date passed with open items, its latest open item is due
 *     after it, or a milestone of it is late;
 *   - grouped by goal, a goal spans its subtree's projects and the items
 *     naming it directly, and counts each item once;
 *   - the filters (goal, initiative, team, health, archived) and their 404s;
 *     the usecase asks `projects.view` beside the route's `goals.view`.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { addDays, dayKey } from '@/app-layer/domain/cycle';
import { todayInTz } from '@/app-layer/notifications/work-item-due';
import { createGoal, deleteGoal } from '@/app-layer/usecases/goal';
import { setInitiativeHealth } from '@/app-layer/usecases/goal-health';
import { createInitiative, deleteInitiative } from '@/app-layer/usecases/initiative';
import { createMilestone } from '@/app-layer/usecases/milestone';
import { createProject, setProjectArchived } from '@/app-layer/usecases/project';
import { getRoadmap } from '@/app-layer/usecases/roadmap';
import { createTeam } from '@/app-layer/usecases/team';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createWorkItem, deleteWorkItem, setWorkItemState } from '@/app-layer/usecases/work-item';
import { getPermissionsForRole } from '@/lib/permissions';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `rdm${Date.now().toString(36)}`;

async function reasonOf(p: Promise<unknown>): Promise<string> {
    try {
        await p;
    } catch (err) {
        const e = err as { details?: { reason?: string }; status?: number; message?: string };
        return e.details?.reason ?? `${e.status ?? ''} ${e.message ?? ''}`;
    }
    return 'no error';
}

describeFn('the roadmap (3.2c)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let viewer: RequestContext;
    let teamId = '';
    let otherTeamId = '';
    let typeId = '';
    let cancelledStateId = '';
    let today: Date;
    let seq = 0;
    const savedTz = process.env.NOTIFICATIONS_TZ;
    const k = (n: number) => dayKey(addDays(today, n));

    const ids: Record<string, string> = {};

    const project = async (name: string, opts: { initiativeId?: string; dueDate?: string; team?: string } = {}) => {
        seq += 1;
        const p = await createProject(owner, {
            teamId: opts.team ?? teamId,
            name,
            keyPrefix: `RM${seq}`,
            ...(opts.initiativeId ? { initiativeId: opts.initiativeId } : {}),
            ...(opts.dueDate ? { dueDate: opts.dueDate } : {}),
        });
        return p.id;
    };
    const item = async (projectId: string, dates: { startDate?: string; dueDate?: string } = {}, extra: { goalId?: string; milestoneId?: string } = {}) =>
        (await createWorkItem(owner, { projectId, typeId, title: `Item ${++seq}`, ...dates, ...extra })).id;

    beforeAll(async () => {
        process.env.NOTIFICATIONS_TZ = 'UTC';
        today = todayInTz(new Date(), 'UTC');
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const mk = async (role: 'OWNER' | 'VIEWER', n: string) => {
            const u = await prisma.user.create({ data: { email: `${n}-${TAG}@example.test`, name: n } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            return makeRequestContext(role, { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-${n}` });
        };
        owner = await mk('OWNER', 'olive');
        viewer = await mk('VIEWER', 'vic');
        const team = await createTeam(owner, { name: 'Core' });
        teamId = team.id;
        cancelledStateId = team.workflowStates.find((s) => s.category === 'CANCELLED')!.id;
        otherTeamId = (await createTeam(owner, { name: 'Edge' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;

        // G1 (due 2051-05-15) ⊃ G1a; I1 serves G1 (due 2051-04-30), I3 serves G1a.
        ids.g1 = (await createGoal(owner, { title: 'Grow', dueDate: '2051-05-15' })).id;
        ids.g1a = (await createGoal(owner, { title: 'Grow abroad', parentId: ids.g1 })).id;
        ids.i1 = (await createInitiative(owner, { name: 'Launch', goalId: ids.g1, dueDate: '2051-04-30' })).id;
        ids.i3 = (await createInitiative(owner, { name: 'Expand', goalId: ids.g1a })).id;

        // P1: both dates, a Sunday due date alone, a Saturday start alone, no dates, a cancelled and a deleted item.
        ids.p1 = await project('Alpha', { initiativeId: ids.i1 });
        await item(ids.p1, { startDate: '2051-03-06', dueDate: '2051-03-10' });
        await item(ids.p1, { dueDate: '2051-03-05' });
        await item(ids.p1, { startDate: '2051-04-15' });
        ids.p1Undated = await item(ids.p1);
        const cancelled = await item(ids.p1, { dueDate: '2051-12-29' });
        await setWorkItemState(owner, cancelled, { stateId: cancelledStateId });
        const deleted = await item(ids.p1, { startDate: '2050-01-03' });
        await deleteWorkItem(owner, deleted);
        // P2 finishes after I1's and G1's due dates.
        ids.p2 = await project('Beta', { initiativeId: ids.i1 });
        await item(ids.p2, { startDate: '2051-05-02', dueDate: '2051-05-31' });
        // P5, archived, starts I1's bar earlier.
        ids.p5 = await project('Epsilon', { initiativeId: ids.i1 });
        await item(ids.p5, { startDate: '2051-02-01', dueDate: '2051-02-15' });
        await setProjectArchived(owner, ids.p5, true);
        // P6 under I3 (G1a).
        ids.p6 = await project('Zeta', { initiativeId: ids.i3 });
        await item(ids.p6, { dueDate: '2051-09-01' });
        // Unlinked: P3 dated, P4 nothing; an item of P3 and one of P1 name G1 directly.
        ids.p3 = await project('Gamma');
        await item(ids.p3, { dueDate: '2051-02-15' });
        ids.direct = await item(ids.p3, { dueDate: '2051-08-01' }, { goalId: ids.g1 });
        await item(ids.p1, { dueDate: '2051-03-10' }, { goalId: ids.g1 });
        ids.p4 = await project('Delta');
    });

    afterAll(async () => {
        process.env.NOTIFICATIONS_TZ = savedTz;
        await resetDatabase(prisma);
    });

    it('draws a project as the span of its items\' planned days, and an initiative as the span of its projects (decision 215)', async () => {
        const r = await getRoadmap(viewer);
        const p = new Map(r.projects.map((x) => [x.id, x]));
        // Fri 03-03 (the Sunday due date's working day) to Mon 04-17 (the Saturday start's): cancelled and deleted items ignored.
        expect(p.get(ids.p1)!.span).toEqual({ start: '2051-03-03', end: '2051-04-17' });
        expect(p.get(ids.p2)!.span).toEqual({ start: '2051-05-02', end: '2051-05-31' });
        // The archived project is not shown, but its dates and items count for its initiative.
        expect(p.has(ids.p5)).toBe(false);
        const i1 = r.initiatives.find((i) => i.id === ids.i1)!;
        expect(i1.span).toEqual({ start: '2051-02-01', end: '2051-05-31' });
        expect(i1.progress.scope).toBe(p.get(ids.p1)!.progress.scope + p.get(ids.p2)!.progress.scope + 1);
        // "No initiative": P3 and P4; P4 has no dated item.
        expect(r.unlinked.shown).toBe(true);
        expect(r.unlinked.span).toEqual({ start: '2051-02-15', end: '2051-08-01' });
        expect(p.get(ids.p4)!.span).toBeNull();
        expect(p.get(ids.p4)!.initiativeId).toBeNull();
        // Grouped by initiative, goals carry their names only.
        expect(r.groupBy).toBe('initiative');
        expect(r.goals.find((g) => g.id === ids.g1)).toMatchObject({ title: 'Grow', span: null });
    });

    it('flags a project finishing after its initiative\'s or goal\'s due date, and the initiative (decision 210)', async () => {
        const r = await getRoadmap(owner);
        const p = new Map(r.projects.map((x) => [x.id, x]));
        expect(p.get(ids.p1)).toMatchObject({ finishesAfterInitiativeDue: false, finishesAfterGoalDue: false });
        expect(p.get(ids.p2)).toMatchObject({ finishesAfterInitiativeDue: true, finishesAfterGoalDue: true });
        expect(r.initiatives.find((i) => i.id === ids.i1)!.finishesAfterDue).toBe(true);
        expect(r.initiatives.find((i) => i.id === ids.i3)!.finishesAfterDue).toBe(false);
    });

    it('shows archived projects when asked', async () => {
        const r = await getRoadmap(owner, { archived: 'true' });
        expect(r.projects.find((p) => p.id === ids.p5)).toMatchObject({ archived: true, span: { start: '2051-02-01', end: '2051-02-15' } });
    });

    it('a project is late by its due date, its latest open item or a late milestone; undated milestones are not read', async () => {
        const ini = (await createInitiative(owner, { name: 'Late things' })).id;
        const overdue = await project('Late one', { initiativeId: ini, dueDate: k(-3) });
        await item(overdue, { dueDate: k(-5) });
        const itemAfter = await project('Late two', { initiativeId: ini, dueDate: k(10) });
        await item(itemAfter, { dueDate: k(20) });
        const withMilestone = await project('Late three', { initiativeId: ini });
        const m = await createMilestone(owner, withMilestone, { name: 'Passed', dueDate: k(-2) });
        await createMilestone(owner, withMilestone, { name: 'Undated' });
        await item(withMilestone, {}, { milestoneId: m.id });
        const r = await getRoadmap(owner, { initiativeId: ini });
        const p = new Map(r.projects.map((x) => [x.id, x]));
        expect(p.get(overdue)).toMatchObject({ overdue: true, itemDueAfter: false, lateMilestones: 0, late: true });
        expect(p.get(itemAfter)).toMatchObject({ overdue: false, itemDueAfter: true, late: true });
        expect(p.get(withMilestone)).toMatchObject({ lateMilestones: 1, late: true, span: null });
        expect(r.milestones.map((x) => x.name)).toEqual(['Passed']);
        expect(r.milestones[0]).toMatchObject({ late: true, dueDate: k(-2) });
        expect(r.unlinked.shown).toBe(false);
        expect(r.initiatives.map((i) => i.id)).toEqual([ini]);
    });

    it('grouped by goal: a goal spans its subtree and its direct items, each item counted once', async () => {
        const r = await getRoadmap(owner, { groupBy: 'goal' });
        const g1 = r.goals.find((g) => g.id === ids.g1)!;
        const g1a = r.goals.find((g) => g.id === ids.g1a)!;
        // I1's projects (P5 archived included), I3's P6 under G1a, and the direct item of P3.
        expect(g1.span).toEqual({ start: '2051-02-01', end: '2051-09-01' });
        expect(g1a.span).toEqual({ start: '2051-09-01', end: '2051-09-01' });
        const i1 = r.initiatives.find((i) => i.id === ids.i1)!;
        const i3 = r.initiatives.find((i) => i.id === ids.i3)!;
        // The direct item of P1 is already on the project path; the one of P3 is added once.
        expect(g1.progress.scope).toBe(i1.progress.scope + i3.progress.scope + 1);
        expect(g1.finishesAfterDue).toBe(true);
    });

    it('filters by goal (its subtree), initiative, team and health; a deleted target is 404', async () => {
        const byGoal = await getRoadmap(owner, { goalId: ids.g1a });
        expect(byGoal.initiatives.map((i) => i.id)).toEqual([ids.i3]);
        expect(byGoal.projects.map((p) => p.id)).toEqual([ids.p6]);
        expect(byGoal.unlinked.shown).toBe(false);

        const edge = (await createInitiative(owner, { name: 'Edge work' })).id;
        const edgeProject = await project('Edge project', { initiativeId: edge, team: otherTeamId });
        await item(edgeProject, { dueDate: '2051-06-15' });
        const byTeam = await getRoadmap(owner, { teamId: otherTeamId });
        expect(byTeam.projects.map((p) => p.id)).toEqual([edgeProject]);
        expect(byTeam.initiatives.map((i) => i.id)).toEqual([edge]);

        await setInitiativeHealth(owner, edge, 'AT_RISK');
        const byHealth = await getRoadmap(owner, { health: 'AT_RISK' });
        expect(byHealth.initiatives.map((i) => i.id)).toEqual([edge]);
        expect(byHealth.initiatives[0]!.health).toBe('AT_RISK');

        const doomedGoal = (await createGoal(owner, { title: 'Doomed' })).id;
        await deleteGoal(owner, doomedGoal);
        expect(await reasonOf(getRoadmap(owner, { goalId: doomedGoal }))).toBe('GOAL_NOT_FOUND');
        expect(await reasonOf(getRoadmap(owner, { initiativeId: 'c000000000000000000000000' }))).toBe('INITIATIVE_NOT_FOUND');
    });

    it('a project of a deleted initiative shows under "No initiative"', async () => {
        const doomed = (await createInitiative(owner, { name: 'Doomed initiative' })).id;
        const orphan = await project('Orphan', { initiativeId: doomed });
        await deleteInitiative(owner, doomed);
        const r = await getRoadmap(owner);
        expect(r.projects.find((p) => p.id === orphan)).toMatchObject({ initiativeId: null });
        expect(r.initiatives.some((i) => i.id === doomed)).toBe(false);
    });

    it('asks projects.view beside goals.view', async () => {
        const perms = getPermissionsForRole('VIEWER');
        const goalsOnly: RequestContext = { ...viewer, appPermissions: { ...perms, projects: { ...perms.projects, view: false } } };
        expect(await reasonOf(getRoadmap(goalsOnly))).toMatch(/403/);
        const noGoals: RequestContext = { ...viewer, appPermissions: { ...perms, goals: { view: false, manage: false } } };
        expect(await reasonOf(getRoadmap(noGoals))).toMatch(/403/);
    });

    it('refuses an unknown status or health', async () => {
        expect(await reasonOf(getRoadmap(owner, { status: 'ACTIVE' }))).toMatch(/400/);
        expect(await reasonOf(getRoadmap(owner, { health: 'RED' }))).toMatch(/400/);
    });

    it('leaves the undated item where it is: the roadmap writes nothing', async () => {
        const before = await prisma.workItem.findUniqueOrThrow({ where: { id: ids.p1Undated }, select: { version: true, startDate: true, dueDate: true } });
        await getRoadmap(owner, { groupBy: 'goal' });
        expect(await prisma.workItem.findUniqueOrThrow({ where: { id: ids.p1Undated }, select: { version: true, startDate: true, dueDate: true } })).toEqual(before);
        expect(await prisma.auditLog.count({ where: { tenantId, action: { contains: 'ROADMAP' } } })).toBe(0);
    });
});
