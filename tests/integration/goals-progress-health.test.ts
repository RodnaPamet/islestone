/**
 * Goals' and initiatives' progress and health against a real Postgres, as
 * `app_user` (sub-phase 3.2b; docs/porting/maps/3.2.md, "Progress and
 * health"; owner decisions 205 to 207, 211, 212 and 214):
 *
 *   - the partial `WorkItem_progress_project_path` (migration
 *     `20261216120000`) in the catalogue, with its predicate;
 *   - an initiative counts its live projects' live, non-cancelled items,
 *     archived projects included, deleted projects and items not;
 *   - a goal counts its subtree's initiatives' projects and the items naming
 *     it or a goal below it directly, each item once; a deleted child goal
 *     and its initiatives count nothing; zero items is no progress, never
 *     complete; "late" is a passed due date with open items;
 *   - the lists carry progress, the Deleted views none; a goal's page says
 *     its level, whether a child fits, and its directly named items; an
 *     initiative's page has its projects table with late milestones;
 *   - health: a person holding `goals.manage` sets it; a Viewer, an API key
 *     and a job are refused (the person-only refusal audited); archived 409,
 *     deleted 404; never tied to the status either way; the history read
 *     from the audit trail, newest first; `If-Match` honoured;
 *   - the audit chain verifies.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { addDays, dayKey } from '@/app-layer/domain/cycle';
import { todayInTz } from '@/app-layer/notifications/work-item-due';
import { createGoal, deleteGoal, getGoal, listGoals, setGoalArchived, updateGoal } from '@/app-layer/usecases/goal';
import { setGoalHealth, setInitiativeHealth } from '@/app-layer/usecases/goal-health';
import { createInitiative, deleteInitiative, getInitiative, listInitiatives, updateInitiative } from '@/app-layer/usecases/initiative';
import { createMilestone } from '@/app-layer/usecases/milestone';
import { createProject, deleteProject, setProjectArchived } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createWorkItem, deleteWorkItem, setWorkItemState } from '@/app-layer/usecases/work-item';
import { verifyAuditChain } from '@/lib/audit';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `gph${Date.now().toString(36)}`;

async function reasonOf(p: Promise<unknown>): Promise<string> {
    try {
        await p;
    } catch (err) {
        const e = err as { details?: { reason?: string }; status?: number; message?: string };
        return e.details?.reason ?? `${e.status ?? ''} ${e.message ?? ''}`;
    }
    return 'no error';
}

describeFn('goals and initiatives: progress and health (3.2b)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let member: RequestContext;
    let viewer: RequestContext;
    let teamId = '';
    let typeId = '';
    let doneStateId = '';
    let startedStateId = '';
    let cancelledStateId = '';
    let today: Date;
    let seq = 0;
    const savedTz = process.env.NOTIFICATIONS_TZ;
    const k = (n: number) => dayKey(addDays(today, n));

    beforeAll(async () => {
        process.env.NOTIFICATIONS_TZ = 'UTC';
        today = todayInTz(new Date(), 'UTC');
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const mk = async (role: 'OWNER' | 'MEMBER' | 'VIEWER', n: string) => {
            const u = await prisma.user.create({ data: { email: `${n}-${TAG}@example.test`, name: n } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            return makeRequestContext(role, { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-${n}` });
        };
        owner = await mk('OWNER', 'olive');
        member = await mk('MEMBER', 'max');
        viewer = await mk('VIEWER', 'vic');
        const team = await createTeam(owner, { name: 'Core' });
        teamId = team.id;
        doneStateId = team.workflowStates.find((s) => s.category === 'DONE')!.id;
        startedStateId = team.workflowStates.find((s) => s.category === 'STARTED')!.id;
        cancelledStateId = team.workflowStates.find((s) => s.category === 'CANCELLED')!.id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
    });

    afterAll(async () => {
        process.env.NOTIFICATIONS_TZ = savedTz;
        await resetDatabase(prisma);
    });

    const project = async (initiativeId?: string, dueDate?: string) => {
        seq += 1;
        return (await createProject(owner, { teamId, name: `P${seq}`, keyPrefix: `PG${seq}`, ...(initiativeId ? { initiativeId } : {}), ...(dueDate ? { dueDate } : {}) })).id;
    };
    /** Items of `projectId` in the given categories, optionally naming a goal directly. */
    const items = async (projectId: string, cats: Array<'open' | 'started' | 'done' | 'cancelled'>, goalId?: string) => {
        const ids: string[] = [];
        for (const c of cats) {
            const it = await createWorkItem(owner, { projectId, typeId, title: `${c} ${++seq}`, ...(goalId ? { goalId } : {}) });
            if (c === 'done') await setWorkItemState(owner, it.id, { stateId: doneStateId });
            if (c === 'started') await setWorkItemState(owner, it.id, { stateId: startedStateId });
            if (c === 'cancelled') await setWorkItemState(owner, it.id, { stateId: cancelledStateId });
            ids.push(it.id);
        }
        return ids;
    };

    it('the partial progress index is in the catalogue with its predicate', async () => {
        const [row] = await prisma.$queryRaw<Array<{ def: string }>>`
            SELECT indexdef::text AS def FROM pg_indexes WHERE indexname = 'WorkItem_progress_project_path'`;
        expect(row?.def).toContain('("tenantId", "projectId", "stateCategory")');
        expect(row?.def).toMatch(/WHERE \(\("deletedAt" IS NULL\) AND \("stateCategory" <> 'CANCELLED'::"WorkflowStateCategory"\)\)/);
    });

    describe('progress (decisions 211 and 212)', () => {
        it('an initiative: archived projects count, deleted projects and items do not, cancelled items leave the scope', async () => {
            const ini = await createInitiative(owner, { name: 'Counted' });
            const live = await project(ini.id);
            const archived = await project(ini.id);
            const gone = await project(ini.id);
            await items(live, ['open', 'done', 'cancelled']);
            const [deletedItem] = await items(live, ['open']);
            await deleteWorkItem(owner, deletedItem!);
            await items(archived, ['done', 'started']);
            await setProjectArchived(owner, archived, true);
            await items(gone, ['open', 'open']);
            await deleteProject(owner, gone);
            const read = await getInitiative(owner, ini.id);
            expect(read.initiative.progress).toEqual({ scope: 4, done: 2, started: 1 });
            expect(read.projects.map((p) => [p.archived, p.progress.scope])).toEqual(expect.arrayContaining([[false, 2], [true, 2]]));
            const listed = (await listInitiatives(owner)).initiatives.find((i) => i.id === ini.id);
            expect(listed?.progress).toEqual({ scope: 4, done: 2, started: 1 });
        });

        it('a goal: its subtree, its initiatives\' projects and its direct items, each item once', async () => {
            const root = await createGoal(owner, { title: 'Root outcome' });
            const child = await createGoal(owner, { title: 'Child outcome', parentId: root.id });
            const ini = await createInitiative(owner, { name: 'Under the child', goalId: child.id });
            const p1 = await project(ini.id);
            const outside = await project();
            await items(p1, ['open', 'done']);
            // Names the root directly AND sits in a project on its path: counted once.
            await items(p1, ['done'], root.id);
            // Names the child directly in a project off the path: counted.
            await items(outside, ['started'], child.id);
            // Names nothing and sits off the path: not counted.
            await items(outside, ['open']);
            const g = await getGoal(owner, root.id);
            expect(g.goal.progress).toEqual({ scope: 4, done: 2, started: 1 });
            expect(g.children.find((c) => c.id === child.id)?.progress).toEqual({ scope: 4, done: 2, started: 1 });
            expect(g.directItems).toBe(1);
            expect(g.depth).toBe(1);
            expect(g.childFits).toBe(true);
            const listed = (await listGoals(owner)).goals.find((x) => x.id === root.id);
            expect(listed?.progress).toEqual({ scope: 4, done: 2, started: 1 });
            // Two levels down, a third fits no more.
            const grandchild = await createGoal(owner, { title: 'Grandchild', parentId: child.id });
            expect((await getGoal(owner, grandchild.id)).childFits).toBe(false);
            expect((await getGoal(owner, grandchild.id)).depth).toBe(3);
        });

        it('a deleted child goal and its initiatives count nothing; a goal with nothing under it has no items', async () => {
            const root = await createGoal(owner, { title: 'Pruned' });
            const child = await createGoal(owner, { title: 'Pruned child', parentId: root.id });
            const ini = await createInitiative(owner, { name: 'Pruned initiative', goalId: child.id });
            await items(await project(ini.id), ['open']);
            expect((await getGoal(owner, root.id)).goal.progress?.scope).toBe(1);
            await deleteGoal(owner, child.id);
            expect((await getGoal(owner, root.id)).goal.progress).toEqual({ scope: 0, done: 0, started: 0 });
            const deleted = (await listGoals(owner, { deleted: 'true' })).goals.find((x) => x.id === child.id);
            expect(deleted?.progress).toBeNull();
            const ini2 = await createInitiative(owner, { name: 'Deleted alone' });
            await deleteInitiative(owner, ini2.id);
            expect((await listInitiatives(owner, { deleted: 'true' })).initiatives.find((i) => i.id === ini2.id)?.progress).toBeNull();
        });

        it('"late" is a passed due date with open items, and an initiative\'s projects table names late milestones', async () => {
            const ini = await createInitiative(owner, { name: 'Late one', dueDate: k(-1) });
            const p = await project(ini.id, k(-2));
            await items(p, ['open', 'done']);
            await createMilestone(owner, p, { name: 'Passed', dueDate: k(-3) });
            const [m] = await items(p, ['open']);
            const milestone = (await prisma.milestone.findFirstOrThrow({ where: { projectId: p, name: 'Passed' } })).id;
            await prisma.workItem.update({ where: { id: m! }, data: { milestoneId: milestone } });
            const read = await getInitiative(owner, ini.id);
            expect(read.initiative.late).toBe(true);
            expect(read.projects[0]).toMatchObject({ late: true, lateMilestones: 1 });
            const done = await createInitiative(owner, { name: 'Finished in time', dueDate: k(-1) });
            await items(await project(done.id), ['done']);
            expect((await getInitiative(owner, done.id)).initiative.late).toBe(false);
            const goal = await createGoal(owner, { title: 'Late goal', dueDate: k(-1) });
            await updateInitiative(owner, ini.id, { goalId: goal.id });
            expect((await getGoal(owner, goal.id)).goal.late).toBe(true);
        });

        it('an initiative\'s page breadcrumb names its goal and the goal\'s ancestors, root first', async () => {
            const a = await createGoal(owner, { title: 'Crumb A' });
            const b = await createGoal(owner, { title: 'Crumb B', parentId: a.id });
            const ini = await createInitiative(owner, { name: 'Crumbed', goalId: b.id });
            expect((await getInitiative(owner, ini.id)).goals.map((g) => g.title)).toEqual(['Crumb A', 'Crumb B']);
        });
    });

    describe('health (decisions 205, 206, 207 and 214)', () => {
        it('a person holding goals.manage sets and clears it, recorded on the row and audited with both values', async () => {
            const g = await createGoal(owner, { title: 'Healthy' });
            const set = await setGoalHealth(member, g.id, 'AT_RISK');
            expect(set).toMatchObject({ health: 'AT_RISK', healthSetByUserId: member.userId, status: 'PLANNED' });
            expect(set.healthSetAt).not.toBeNull();
            const cleared = await setGoalHealth(owner, g.id, null);
            expect(cleared.health).toBeNull();
            const entries = await prisma.auditLog.findMany({ where: { tenantId, entity: 'Goal', entityId: g.id, action: 'GOAL_HEALTH_SET' }, orderBy: { createdAt: 'asc' } });
            expect(entries.map((e) => e.metadataJson)).toEqual([
                expect.objectContaining({ fromHealth: null, toHealth: 'AT_RISK' }),
                expect.objectContaining({ fromHealth: 'AT_RISK', toHealth: null }),
            ]);
            const history = (await getGoal(owner, g.id)).healthHistory;
            expect(history.map((h) => [h.previous, h.health])).toEqual([
                ['AT_RISK', null],
                [null, 'AT_RISK'],
            ]);
            expect(history[1]!.setByUserId).toBe(member.userId);
        });

        it('never tied to the status either way: "Completed" health on a Started goal, "Off track" on a Completed one', async () => {
            const g = await createGoal(owner, { title: 'Independent', status: 'STARTED' });
            await setGoalHealth(owner, g.id, 'COMPLETED');
            expect((await getGoal(owner, g.id)).goal).toMatchObject({ status: 'STARTED', health: 'COMPLETED' });
            await updateGoal(owner, g.id, { status: 'COMPLETED' });
            expect((await getGoal(owner, g.id)).goal).toMatchObject({ status: 'COMPLETED', health: 'COMPLETED' });
            await setGoalHealth(owner, g.id, 'OFF_TRACK');
            expect((await getGoal(owner, g.id)).goal).toMatchObject({ status: 'COMPLETED', health: 'OFF_TRACK' });
        });

        it('setting the same value again records it again; If-Match is honoured', async () => {
            const g = await createGoal(owner, { title: 'Confirmed' });
            const first = await setGoalHealth(owner, g.id, 'ON_TRACK');
            const second = await setGoalHealth(owner, g.id, 'ON_TRACK', first.version);
            expect(second.version).toBe(first.version + 1);
            expect((await getGoal(owner, g.id)).healthHistory).toHaveLength(2);
            expect(await reasonOf(setGoalHealth(owner, g.id, 'AT_RISK', first.version))).toBe('VERSION_CONFLICT');
        });

        it('a Viewer is refused; an API key and a job are refused as not a person, and that refusal is audited', async () => {
            const g = await createGoal(owner, { title: 'Guarded' });
            expect((await reasonOf(setGoalHealth(viewer, g.id, 'ON_TRACK'))).length).toBeGreaterThan(0);
            const key = { ...member, apiKeyId: 'key-1' };
            expect(await reasonOf(setGoalHealth(key, g.id, 'ON_TRACK'))).toBe('NOT_A_PERSON');
            const job = { ...member, actorType: 'JOB' as const };
            expect(await reasonOf(setGoalHealth(job, g.id, 'ON_TRACK'))).toBe('NOT_A_PERSON');
            const ini = await createInitiative(owner, { name: 'Guarded initiative' });
            expect(await reasonOf(setInitiativeHealth(key, ini.id, 'ON_TRACK'))).toBe('NOT_A_PERSON');
            const denied = await prisma.auditLog.findMany({ where: { tenantId, action: 'AUTHZ_DENIED', entityId: { in: [g.id, ini.id] } } });
            expect(denied).toHaveLength(3);
            expect((await getGoal(owner, g.id)).goal.health).toBeNull();
        });

        it('archived is read-only (409 ARCHIVED), deleted is 404; an initiative too', async () => {
            const g = await createGoal(owner, { title: 'Shelved', status: 'COMPLETED' });
            await setGoalHealth(owner, g.id, 'COMPLETED');
            await setGoalArchived(owner, g.id, true);
            expect(await reasonOf(setGoalHealth(owner, g.id, 'AT_RISK'))).toBe('ARCHIVED');
            expect((await getGoal(owner, g.id)).goal.health).toBe('COMPLETED');
            const gone = await createGoal(owner, { title: 'Gone' });
            await deleteGoal(owner, gone.id);
            expect(await reasonOf(setGoalHealth(owner, gone.id, 'AT_RISK'))).toBe('GOAL_NOT_FOUND');
            const ini = await createInitiative(owner, { name: 'Initiative health' });
            expect((await setInitiativeHealth(member, ini.id, 'OFF_TRACK')).health).toBe('OFF_TRACK');
            expect((await getInitiative(owner, ini.id)).healthHistory.map((h) => h.health)).toEqual(['OFF_TRACK']);
            await deleteInitiative(owner, ini.id);
            expect(await reasonOf(setInitiativeHealth(owner, ini.id, 'AT_RISK'))).toBe('INITIATIVE_NOT_FOUND');
        });
    });

    it('the audit chain verifies', async () => {
        const result = await verifyAuditChain(tenantId);
        expect(result.valid).toBe(true);
    });
});
