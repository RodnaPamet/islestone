/**
 * Goals and initiatives against a real Postgres, as `app_user` (sub-phase
 * 3.2a; docs/porting/maps/3.2.md; ADR 0002 §2 and §17; owner decisions 205 to
 * 224):
 *
 *   - what migrations `20261215120000` to `20261215120300` add beyond Prisma,
 *     in the catalogue and by their bite: the CHECKs (title and name length,
 *     archive only when finished, a delete group whole, a goal never its own
 *     parent), the four column-scoped `ON DELETE SET NULL` keys, the field-set
 *     CHECK widened to `goal`, the progress indexes, the grants, and the
 *     transition trigger not watching `goalId`;
 *   - the two tables are tenant tables: as `app_user` in workspace B nothing
 *     of A's is read, changed, removed or created;
 *   - the tree: one lock, the parent read in the caller's workspace, no
 *     cycle, at most three levels (deleted goals counted), new links refused
 *     to deleted (404) and archived (409) goals and initiatives;
 *   - archive (Completed or Cancelled only; read-only while archived), soft
 *     delete as a group with links kept, restore only through the group's
 *     root and only while its parent is live;
 *   - the lead: an active member (a Viewer may lead, a Guest may not),
 *     cleared on member removal, audited;
 *   - a project's initiative and an item's direct goal: versioned writes,
 *     audited, refused for a deleted or archived target, `goals.view` asked to
 *     name one; the goal kept on a move, never inherited by a sub-item; a
 *     repeat copy taking its source's goal, skipped and named when it is no
 *     longer linkable;
 *   - the list's `goalId` (both paths, the live subtree) and `initiativeId`
 *     filters, a deleted target a 404;
 *   - the ancestry in one statement, against hand-written vectors and a
 *     naive walk over random trees;
 *   - the purge: past the window only, every link cleared by the database,
 *     counts-only `GOALS_PURGED`;
 *   - keys (decision 213): Viewers read, Members manage, Guests nothing;
 *   - every write audited, and the chain verifies.
 */
import type { PrismaClient } from '@prisma/client';

import { processGoalPurge } from '@/app-layer/jobs/goal-purge';
import { processWorkItemRecurrence } from '@/app-layer/jobs/work-item-recurrence';
import type { RequestContext } from '@/app-layer/types';
import { addDays, dayKey } from '@/app-layer/domain/cycle';
import { todayInTz } from '@/app-layer/notifications/work-item-due';
import { createGoal, deleteGoal, getGoal, listGoals, restoreGoal, setGoalArchived, updateGoal } from '@/app-layer/usecases/goal';
import {
    createInitiative,
    deleteInitiative,
    getInitiative,
    listInitiatives,
    restoreInitiative,
    setInitiativeArchived,
    setProjectInitiative,
    updateInitiative,
} from '@/app-layer/usecases/initiative';
import { createProject, getProject } from '@/app-layer/usecases/project';
import { setWorkItemRecurrence } from '@/app-layer/usecases/recurrence';
import { createTeam } from '@/app-layer/usecases/team';
import { removeTenantMember } from '@/app-layer/usecases/tenant-admin';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createWorkItem, getWorkItem, listWorkItems } from '@/app-layer/usecases/work-item';
import { getWorkItemAncestry } from '@/app-layer/usecases/work-item-ancestry';
import { setWorkItemGoal } from '@/app-layer/usecases/work-item-goal';
import { moveWorkItemToProject } from '@/app-layer/usecases/work-item-moves';
import { getWorkItemViewConfig } from '@/app-layer/usecases/work-item-views';
import { verifyAuditChain } from '@/lib/audit';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { getPermissionsForRole } from '@/lib/permissions';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `gol${Date.now().toString(36)}`;

/** The error's `details.reason`, or its message. */
async function reasonOf(p: Promise<unknown>): Promise<string> {
    try {
        await p;
    } catch (err) {
        const e = err as { details?: { reason?: string }; status?: number; message?: string };
        return e.details?.reason ?? `${e.status ?? ''} ${e.message ?? ''}`;
    }
    return 'no error';
}

async function statusOf(p: Promise<unknown>): Promise<number> {
    try {
        await p;
    } catch (err) {
        return (err as { status?: number }).status ?? 500;
    }
    return 200;
}

describeFn('goals and initiatives', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let otherTenantId = '';
    let owner: RequestContext;
    let member: RequestContext;
    let viewer: RequestContext;
    let guest: RequestContext;
    let outsider: RequestContext;
    let leaver: { ctx: RequestContext; membershipId: string };
    let teamId = '';
    let projectId = '';
    let otherProjectId = '';
    let typeId = '';
    let today: Date;
    const savedTz = process.env.NOTIFICATIONS_TZ;
    const k = (n: number) => dayKey(addDays(today, n));

    beforeAll(async () => {
        process.env.NOTIFICATIONS_TZ = 'UTC';
        today = todayInTz(new Date(), 'UTC');
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        otherTenantId = (await createTenantWithDek({ name: `${TAG}b`, slug: `${TAG}b` })).id;
        const mk = async (tid: string, role: 'OWNER' | 'MEMBER' | 'VIEWER' | 'GUEST', n: string) => {
            const u = await prisma.user.create({ data: { email: `${n}-${TAG}@example.test`, name: n } });
            const m = await prisma.tenantMembership.create({ data: { tenantId: tid, userId: u.id, role } });
            return { ctx: makeRequestContext(role, { tenantId: tid, userId: u.id, tenantSlug: tid === tenantId ? TAG : `${TAG}b`, requestId: `${TAG}-${n}` }), membershipId: m.id };
        };
        owner = (await mk(tenantId, 'OWNER', 'olive')).ctx;
        member = (await mk(tenantId, 'MEMBER', 'max')).ctx;
        viewer = (await mk(tenantId, 'VIEWER', 'vic')).ctx;
        guest = (await mk(tenantId, 'GUEST', 'gus')).ctx;
        leaver = await mk(tenantId, 'MEMBER', 'lea');
        outsider = (await mk(otherTenantId, 'OWNER', 'otto')).ctx;
        const team = await createTeam(owner, { name: 'Core' });
        teamId = team.id;
        projectId = (await createProject(owner, { teamId, name: 'Goals', keyPrefix: 'GOL' })).id;
        otherProjectId = (await createProject(owner, { teamId, name: 'Elsewhere', keyPrefix: 'ELS' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
    });

    afterAll(async () => {
        process.env.NOTIFICATIONS_TZ = savedTz;
        await resetDatabase(prisma);
    });

    const newItem = (title: string, extra: Record<string, unknown> = {}) => createWorkItem(owner, { projectId, typeId, title, ...extra });

    describe('what the migrations add', () => {
        it('the four column-scoped SET NULL keys, each clearing only its own column', async () => {
            const rows = await prisma.$queryRaw<Array<{ conname: string; deltype: string; cols: string[] }>>`
                SELECT c.conname::text AS conname, c.confdeltype::text AS deltype,
                       ARRAY(SELECT a.attname::text FROM unnest(c.confdelsetcols) n JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = n) AS cols
                  FROM pg_constraint c
                 WHERE c.conname IN ('Goal_parentId_tenantId_fkey', 'Initiative_goalId_tenantId_fkey', 'Project_initiativeId_tenantId_fkey', 'WorkItem_goalId_tenantId_fkey')
                 ORDER BY c.conname`;
            expect(rows).toEqual([
                { conname: 'Goal_parentId_tenantId_fkey', deltype: 'n', cols: ['parentId'] },
                { conname: 'Initiative_goalId_tenantId_fkey', deltype: 'n', cols: ['goalId'] },
                { conname: 'Project_initiativeId_tenantId_fkey', deltype: 'n', cols: ['initiativeId'] },
                { conname: 'WorkItem_goalId_tenantId_fkey', deltype: 'n', cols: ['goalId'] },
            ]);
        });

        it('the CHECKs bite whatever the writer', async () => {
            const at = new Date();
            const base = { tenantId, createdByUserId: owner.userId };
            await expect(prisma.goal.create({ data: { ...base, title: '' } })).rejects.toThrow(/Goal_title_length/);
            await expect(prisma.goal.create({ data: { ...base, title: 'x'.repeat(201) } })).rejects.toThrow(/Goal_title_length/);
            await expect(prisma.initiative.create({ data: { ...base, name: 'x'.repeat(121) } })).rejects.toThrow(/Initiative_name_length/);
            await expect(prisma.goal.create({ data: { ...base, title: 'archived but planned', archivedAt: at } })).rejects.toThrow(/Goal_archived_finished_only/);
            await expect(prisma.initiative.create({ data: { ...base, name: 'archived but started', status: 'STARTED', archivedAt: at } })).rejects.toThrow(/Initiative_archived_finished_only/);
            await expect(prisma.goal.create({ data: { ...base, title: 'half deleted', deletedAt: at } })).rejects.toThrow(/Goal_deletion_group/);
            await expect(prisma.initiative.create({ data: { ...base, name: 'half deleted', deletionId: 'd' } })).rejects.toThrow(/Initiative_deletion_group/);
            const g = await prisma.goal.create({ data: { ...base, title: 'self' } });
            await expect(prisma.goal.update({ where: { id: g.id }, data: { parentId: g.id } })).rejects.toThrow(/Goal_not_own_parent/);
            await prisma.goal.delete({ where: { id: g.id } });
        });

        it("the field set CHECK takes 'goal'; the progress indexes exist; the transition trigger does not watch goalId", async () => {
            const [chk] = await prisma.$queryRaw<Array<{ def: string }>>`
                SELECT pg_get_constraintdef(oid)::text AS def FROM pg_constraint WHERE conname = 'WorkItemTypeField_built_in_known'`;
            expect(chk?.def).toContain(`'goal'`);
            const idx = await prisma.$queryRaw<Array<{ indexname: string }>>`
                SELECT indexname::text AS indexname FROM pg_indexes
                 WHERE indexname IN ('WorkItem_tenantId_goalId_stateCategory_idx', 'WorkItem_tenantId_projectId_stateCategory_idx', 'Project_tenantId_initiativeId_idx')
                 ORDER BY indexname`;
            expect(idx.map((i) => i.indexname)).toEqual(['Project_tenantId_initiativeId_idx', 'WorkItem_tenantId_goalId_stateCategory_idx', 'WorkItem_tenantId_projectId_stateCategory_idx']);
            const [trg] = await prisma.$queryRaw<Array<{ def: string }>>`
                SELECT pg_get_triggerdef(oid)::text AS def FROM pg_trigger WHERE tgname = 'work_item_transition_update'`;
            expect(trg?.def).not.toContain('goalId');
        });

        it('app_user holds SELECT, INSERT, UPDATE and DELETE on both tables (DELETE for the purge)', async () => {
            const rows = await prisma.$queryRaw<Array<{ table_name: string; privilege_type: string }>>`
                SELECT table_name::text, privilege_type::text FROM information_schema.role_table_grants
                 WHERE grantee = 'app_user' AND table_name IN ('Goal', 'Initiative') ORDER BY table_name, privilege_type`;
            for (const t of ['Goal', 'Initiative']) {
                expect(rows.filter((r) => r.table_name === t).map((r) => r.privilege_type)).toEqual(expect.arrayContaining(['DELETE', 'INSERT', 'SELECT', 'UPDATE']));
            }
        });
    });

    describe('two-tenant isolation as app_user', () => {
        it('a workspace reads, changes, deletes and plants nothing of another', async () => {
            const g = await createGoal(owner, { title: 'Isolated goal' });
            const i = await createInitiative(owner, { name: 'Isolated initiative', goalId: g.id });
            expect(await runInTenantContext(outsider, (db) => db.goal.count({ where: { tenantId } }))).toBe(0);
            expect(await runInTenantContext(outsider, (db) => db.initiative.count({ where: { tenantId } }))).toBe(0);
            expect((await runInTenantContext(outsider, (db) => db.goal.updateMany({ where: { tenantId }, data: { title: 'Hijacked' } }))).count).toBe(0);
            expect((await runInTenantContext(outsider, (db) => db.initiative.updateMany({ where: { tenantId }, data: { name: 'Hijacked' } }))).count).toBe(0);
            expect((await runInTenantContext(outsider, (db) => db.goal.deleteMany({ where: { id: g.id } }))).count).toBe(0);
            expect((await runInTenantContext(outsider, (db) => db.initiative.deleteMany({ where: { id: i.id } }))).count).toBe(0);
            await expect(runInTenantContext(outsider, (db) => db.goal.create({ data: { tenantId, title: 'Planted', createdByUserId: outsider.userId } }))).rejects.toThrow();
            await expect(runInTenantContext(outsider, (db) => db.initiative.create({ data: { tenantId, name: 'Planted', createdByUserId: outsider.userId } }))).rejects.toThrow();
            expect(await runInTenantContext(owner, (db) => db.goal.count({ where: { id: g.id } }))).toBe(1);
            // The composite key refuses another workspace's goal, whatever the writer.
            const theirs = await createGoal(outsider, { title: 'Theirs' });
            await expect(prisma.initiative.update({ where: { id: i.id }, data: { goalId: theirs.id } })).rejects.toThrow();
            expect(await reasonOf(createInitiative(owner, { name: 'Cross', goalId: theirs.id }))).toBe('GOAL_NOT_FOUND');
        });
    });

    describe('the tree', () => {
        it('nests at most three levels, deleted goals counted, and refuses a cycle', async () => {
            const a = await createGoal(member, { title: 'Level 1' });
            const b = await createGoal(member, { title: 'Level 2', parentId: a.id });
            const c = await createGoal(member, { title: 'Level 3', parentId: b.id });
            expect(await reasonOf(createGoal(member, { title: 'Level 4', parentId: c.id }))).toBe('GOAL_TOO_DEEP');
            expect(await reasonOf(updateGoal(member, a.id, { parentId: c.id }))).toBe('GOAL_WOULD_CYCLE');
            expect(await reasonOf(updateGoal(member, a.id, { parentId: a.id }))).toBe('GOAL_WOULD_CYCLE');
            const d = await createGoal(member, { title: 'Another root' });
            const e = await createGoal(member, { title: 'Its child', parentId: d.id });
            // Moving d (height 2) under b (level 2) would make four levels.
            expect(await reasonOf(updateGoal(member, d.id, { parentId: b.id }))).toBe('GOAL_TOO_DEEP');
            // A deleted child still counts: d under a would be d (2), its deleted child (3) … fine; under b it is refused.
            await deleteGoal(member, e.id);
            expect(await reasonOf(updateGoal(member, d.id, { parentId: b.id }))).toBe('GOAL_TOO_DEEP');
            const moved = await updateGoal(member, d.id, { parentId: a.id });
            expect(moved.parentId).toBe(a.id);
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'GOAL_MOVED', entityId: d.id } })).toBe(1);
        });

        it('a new link to a deleted goal is 404, to an archived one 409; a goal under an archived parent stays', async () => {
            const parent = await createGoal(member, { title: 'Done parent', status: 'COMPLETED' });
            const child = await createGoal(member, { title: 'Child of done', parentId: parent.id });
            await setGoalArchived(member, parent.id, true);
            expect((await getGoal(member, child.id)).ancestors.map((g) => g.id)).toEqual([parent.id]);
            expect(await reasonOf(createGoal(member, { title: 'New child', parentId: parent.id }))).toBe('GOAL_ARCHIVED');
            expect(await reasonOf(createInitiative(member, { name: 'Under archived', goalId: parent.id }))).toBe('GOAL_ARCHIVED');
            const gone = await createGoal(member, { title: 'Gone' });
            await deleteGoal(member, gone.id);
            expect(await reasonOf(createGoal(member, { title: 'Under gone', parentId: gone.id }))).toBe('GOAL_NOT_FOUND');
            expect(await reasonOf(getGoal(member, gone.id))).toBe('GOAL_NOT_FOUND');
        });
    });

    describe('fields, status, archive, delete and restore', () => {
        it('creates and changes a goal: title and description need If-Match, the status any order, sanitised, never the description in the audit', async () => {
            const g = await createGoal(member, { title: '  Ship <b>the</b> beta  ', description: 'Why <script>x</script> it matters', dueDate: k(30) });
            expect(g.title).not.toContain('<b>');
            expect(g.description).not.toContain('<script>');
            expect(g.dueDate).toBe(k(30));
            expect(g.status).toBe('PLANNED');
            expect(await statusOf(updateGoal(member, g.id, { title: 'Renamed' }))).toBe(428);
            const done = await updateGoal(member, g.id, { status: 'COMPLETED' });
            const again = await updateGoal(member, g.id, { status: 'STARTED' });
            expect([done.status, again.status]).toEqual(['COMPLETED', 'STARTED']);
            expect(await reasonOf(updateGoal(member, g.id, { title: 'Stale' }, 1))).toBe('VERSION_CONFLICT');
            const renamed = await updateGoal(member, g.id, { title: 'Renamed', description: 'New why' }, again.version);
            expect(renamed.title).toBe('Renamed');
            const rows = await prisma.auditLog.findMany({ where: { tenantId, entityId: g.id, action: 'GOAL_UPDATED' } });
            expect(JSON.stringify(rows)).not.toContain('New why');
            // Health is never touched here (3.2b).
            expect(renamed.health).toBeNull();
            // The description is ciphertext at rest.
            const raw = await prisma.$queryRaw<Array<{ description: string }>>`SELECT "description" FROM "Goal" WHERE "id" = ${g.id}`;
            expect(raw[0]?.description).not.toContain('New why');
        });

        it('archives only a Completed or Cancelled goal; an archived one is read-only and leaves the list', async () => {
            const g = await createGoal(member, { title: 'To archive' });
            expect(await reasonOf(setGoalArchived(member, g.id, true))).toBe('GOAL_NOT_FINISHED');
            await updateGoal(member, g.id, { status: 'CANCELLED' });
            const archived = await setGoalArchived(member, g.id, true);
            expect(archived.archived).toBe(true);
            expect(await reasonOf(updateGoal(member, g.id, { status: 'STARTED' }))).toBe('ARCHIVED');
            expect((await listGoals(member)).goals.map((x) => x.id)).not.toContain(g.id);
            expect((await listGoals(member, { archived: 'true' })).goals.map((x) => x.id)).toContain(g.id);
            const back = await setGoalArchived(member, g.id, false);
            expect(back.archived).toBe(false);
            const i = await createInitiative(member, { name: 'To archive' });
            expect(await reasonOf(setInitiativeArchived(member, i.id, true))).toBe('INITIATIVE_NOT_FINISHED');
        });

        it('deletes a goal with the goals below it and their initiatives as one group, links kept; restores through the root only', async () => {
            const root = await createGoal(member, { title: 'Group root' });
            const mid = await createGoal(member, { title: 'Group mid', parentId: root.id });
            const init = await createInitiative(member, { name: 'Group initiative', goalId: mid.id });
            const loose = await createInitiative(member, { name: 'Already deleted', goalId: mid.id });
            await deleteInitiative(member, loose.id);
            await setProjectInitiative(member, otherProjectId, { initiativeId: init.id });
            const item = await newItem('names mid', { goalId: mid.id });
            const del = await deleteGoal(member, root.id);
            expect(del).toMatchObject({ goals: 2, initiatives: 1 });
            const rows = await prisma.goal.findMany({ where: { id: { in: [root.id, mid.id] } }, select: { deletionId: true } });
            expect(new Set(rows.map((r) => r.deletionId))).toEqual(new Set([del.deletionId]));
            // Links are kept while deleted; reads leave the rows out.
            expect((await getProject(member, otherProjectId)).initiativeId).toBe(init.id);
            expect((await getWorkItem(member, item.id)).goalId).toBe(mid.id);
            expect((await listGoals(member)).goals.map((g) => g.id)).not.toContain(root.id);
            expect((await listGoals(member, { deleted: 'true' })).goals.map((g) => g.id)).toEqual(expect.arrayContaining([root.id, mid.id]));
            expect((await getWorkItemAncestry(member, item.id)).directGoals).toBeNull();
            expect((await getWorkItemAncestry(member, (await newItem('in other', { projectId: otherProjectId })).id)).initiative).toBeNull();
            // Restore only through the root.
            expect(await reasonOf(restoreGoal(member, mid.id))).toBe('DELETED_WITH_PARENT');
            expect(await reasonOf(restoreInitiative(member, init.id))).toBe('DELETED_WITH_PARENT');
            // The initiative deleted on its own waits for its goal.
            expect(await reasonOf(restoreInitiative(member, loose.id))).toBe('PARENT_DELETED');
            const back = await restoreGoal(member, root.id);
            expect(back.deletedAt).toBeNull();
            expect((await getGoal(member, mid.id)).initiatives.map((x) => x.id)).toEqual([init.id]);
            expect((await getWorkItemAncestry(member, item.id)).directGoals?.map((g) => g.id)).toEqual([root.id, mid.id]);
            const restored = await restoreInitiative(member, loose.id);
            expect(restored.deletedAt).toBeNull();
        });

        it('a goal deleted inside another delete group restores only after its parent (PARENT_DELETED)', async () => {
            const top = await createGoal(member, { title: 'Top' });
            const child = await createGoal(member, { title: 'Deleted first', parentId: top.id });
            await deleteGoal(member, child.id);
            await deleteGoal(member, top.id);
            expect(await reasonOf(restoreGoal(member, child.id))).toBe('PARENT_DELETED');
            await restoreGoal(member, top.id);
            expect((await restoreGoal(member, child.id)).deletedAt).toBeNull();
        });

        it('the lead is an active member (a Viewer may lead, a Guest may not), cleared on member removal, audited', async () => {
            expect(await reasonOf(createGoal(member, { title: 'Led by a guest', leadUserId: guest.userId }))).toBe('LEAD_NOT_MEMBER');
            expect((await createGoal(member, { title: 'Led by a viewer', leadUserId: viewer.userId })).leadUserId).toBe(viewer.userId);
            const g = await createGoal(member, { title: 'Led by lea', leadUserId: leaver.ctx.userId });
            const i = await createInitiative(member, { name: 'Led by lea', leadUserId: leaver.ctx.userId });
            await deleteInitiative(member, i.id);
            await removeTenantMember(owner, { membershipId: leaver.membershipId });
            expect((await getGoal(member, g.id)).goal.leadUserId).toBeNull();
            expect((await prisma.initiative.findUniqueOrThrow({ where: { id: i.id } })).leadUserId).toBeNull();
            const entries = await prisma.auditLog.findMany({ where: { tenantId, entityId: { in: [g.id, i.id] }, action: { in: ['GOAL_UPDATED', 'INITIATIVE_UPDATED'] } } });
            expect(entries.length).toBe(2);
        });

        it('lists by status (Started, Planned, Completed, Cancelled), then due date; filters by status, lead and health', async () => {
            const s = await createGoal(member, { title: 'zz started', status: 'STARTED' });
            const p = await createGoal(member, { title: 'zz planned' });
            const ids = (await listGoals(member)).goals.map((g) => g.id);
            expect(ids.indexOf(s.id)).toBeLessThan(ids.indexOf(p.id));
            expect((await listGoals(member, { status: 'STARTED' })).goals.every((g) => g.status === 'STARTED')).toBe(true);
            expect((await listGoals(member, { health: 'none' })).goals.map((g) => g.id)).toContain(p.id);
            expect(await statusOf(listGoals(member, { status: 'ACTIVE' }))).toBe(400);
            expect((await listInitiatives(member, { status: 'PLANNED' })).initiatives.every((i) => i.status === 'PLANNED')).toBe(true);
        });
    });

    describe("a project's initiative and an item's goal", () => {
        it("names a project's initiative: versioned, audited, refusing a deleted or archived one", async () => {
            const i = await createInitiative(member, { name: 'Linked' });
            const p = await getProject(member, projectId);
            const linked = await setProjectInitiative(member, projectId, { initiativeId: i.id }, p.version);
            expect(linked.initiativeId).toBe(i.id);
            expect(linked.version).toBe(p.version + 1);
            expect(await reasonOf(setProjectInitiative(member, projectId, { initiativeId: null }, p.version))).toBe('VERSION_CONFLICT');
            const done = await createInitiative(member, { name: 'Done initiative', status: 'COMPLETED' });
            await setInitiativeArchived(member, done.id, true);
            expect(await reasonOf(setProjectInitiative(member, projectId, { initiativeId: done.id }))).toBe('INITIATIVE_ARCHIVED');
            const gone = await createInitiative(member, { name: 'Gone initiative' });
            await deleteInitiative(member, gone.id);
            expect(await reasonOf(setProjectInitiative(member, projectId, { initiativeId: gone.id }))).toBe('INITIATIVE_NOT_FOUND');
            const entry = await prisma.auditLog.findFirst({ where: { tenantId, entityId: projectId, action: 'PROJECT_UPDATED' }, orderBy: { createdAt: 'desc' } });
            expect(JSON.stringify(entry?.detailsJson)).toContain('initiativeId');
            expect((await getInitiative(member, i.id)).projects.map((x) => x.id)).toContain(projectId);
            // A project created with an initiative names it.
            const made = await createProject(member, { teamId, name: 'Born linked', keyPrefix: 'BLK', initiativeId: i.id });
            expect(made.initiativeId).toBe(i.id);
        });

        it("names an item's goal: versioned, audited, refusing a deleted or archived goal; kept on a move; never inherited", async () => {
            const g = await createGoal(member, { title: 'Item goal' });
            const item = await newItem('aims at a goal');
            const set = await setWorkItemGoal(member, item.id, { goalId: g.id });
            expect(set.goalId).toBe(g.id);
            expect(set.version).toBe(item.version + 1);
            const sub = await newItem('a sub-item', { parentId: item.id });
            expect(sub.goalId).toBeNull();
            await moveWorkItemToProject(member, item.id, { projectId: otherProjectId });
            expect((await getWorkItem(member, item.id)).goalId).toBe(g.id);
            const archivedGoal = await createGoal(member, { title: 'Archived goal', status: 'COMPLETED' });
            await setGoalArchived(member, archivedGoal.id, true);
            expect(await reasonOf(setWorkItemGoal(member, item.id, { goalId: archivedGoal.id }))).toBe('GOAL_ARCHIVED');
            expect(await reasonOf(newItem('born archived', { goalId: archivedGoal.id }))).toBe('GOAL_ARCHIVED');
            const goneGoal = await createGoal(member, { title: 'Deleted goal' });
            await deleteGoal(member, goneGoal.id);
            expect(await reasonOf(setWorkItemGoal(member, item.id, { goalId: goneGoal.id }))).toBe('GOAL_NOT_FOUND');
            const cleared = await setWorkItemGoal(member, item.id, { goalId: null });
            expect(cleared.goalId).toBeNull();
            expect(await prisma.auditLog.count({ where: { tenantId, entityId: item.id, action: 'WORK_ITEM_GOAL_CHANGED' } })).toBe(2);
            const born = await newItem('born with a goal', { goalId: g.id });
            expect(born.goalId).toBe(g.id);
        });

        it('naming a goal or an initiative asks goals.view; clearing asks only the field key', async () => {
            const g = await createGoal(member, { title: 'Needs view' });
            const item = await newItem('no goals.view', { goalId: g.id });
            const perms = getPermissionsForRole('MEMBER');
            perms.goals.view = false;
            const blind = { ...member, appPermissions: perms };
            expect(await statusOf(setWorkItemGoal(blind, item.id, { goalId: g.id }))).toBe(403);
            expect((await setWorkItemGoal(blind, item.id, { goalId: null })).goalId).toBeNull();
            expect(await statusOf(setProjectInitiative(blind, projectId, { initiativeId: (await createInitiative(member, { name: 'x' })).id }))).toBe(403);
            expect(await statusOf(listWorkItems(blind, { goalId: g.id }))).toBe(403);
        });

        it("a repeat copy takes its source's goal; an archived one is skipped and named", async () => {
            const live = await createGoal(member, { title: 'Repeat live goal' });
            const finished = await createGoal(member, { title: 'Repeat finished goal', status: 'COMPLETED' });
            const a = await createWorkItem(member, { projectId, typeId, title: 'repeats with a live goal', dueDate: k(0), goalId: live.id });
            const b = await createWorkItem(member, { projectId, typeId, title: 'repeats with a finished goal', dueDate: k(0), goalId: finished.id });
            const ra = await setWorkItemRecurrence(member, a.id, { frequency: 'DAILY', interval: 1, weekdays: [], leadDays: 0 });
            const rb = await setWorkItemRecurrence(member, b.id, { frequency: 'DAILY', interval: 1, weekdays: [], leadDays: 0 });
            await setGoalArchived(member, finished.id, true);
            await processWorkItemRecurrence({ tenantId, now: new Date(`${k(1)}T12:00:00.000Z`), tz: 'UTC' });
            const [copyA] = await prisma.workItem.findMany({ where: { tenantId, recurrenceId: ra.id }, select: { goalId: true } });
            const [copyB] = await prisma.workItem.findMany({ where: { tenantId, recurrenceId: rb.id }, select: { id: true, goalId: true } });
            expect(copyA?.goalId).toBe(live.id);
            expect(copyB?.goalId).toBeNull();
            const created = await prisma.auditLog.findFirst({ where: { tenantId, entityId: copyB!.id, action: 'WORK_ITEM_CREATED' } });
            expect(JSON.stringify(created?.metadataJson)).toContain('goal:archived');
        });

        it('the view configuration names live, unarchived goals and initiatives; none without goals.view', async () => {
            const cfg = await getWorkItemViewConfig(viewer);
            expect((cfg.goals ?? []).length).toBeGreaterThan(0);
            expect((cfg.goals ?? []).some((g) => g.title === 'Archived goal')).toBe(false);
            const perms = getPermissionsForRole('VIEWER');
            perms.goals.view = false;
            const blind = await getWorkItemViewConfig({ ...viewer, appPermissions: perms });
            expect(blind.goals).toEqual([]);
            expect(blind.initiatives).toEqual([]);
        });
    });

    describe("the list's goalId and initiativeId filters", () => {
        it('goalId matches the project path and the direct path over the live subtree, each item once; initiativeId the projects', async () => {
            const team = await createTeam(owner, { name: 'Filters' });
            const pa = (await createProject(owner, { teamId: team.id, name: 'Filter A', keyPrefix: 'FLA' })).id;
            const pb = (await createProject(owner, { teamId: team.id, name: 'Filter B', keyPrefix: 'FLB' })).id;
            const top = await createGoal(owner, { title: 'Filter top' });
            const below = await createGoal(owner, { title: 'Filter below', parentId: top.id });
            const init = await createInitiative(owner, { name: 'Filter initiative', goalId: below.id });
            await setProjectInitiative(owner, pa, { initiativeId: init.id });
            const viaProject = await createWorkItem(owner, { projectId: pa, typeId, title: 'via project' });
            const viaBoth = await createWorkItem(owner, { projectId: pa, typeId, title: 'via both', goalId: top.id });
            const direct = await createWorkItem(owner, { projectId: pb, typeId, title: 'direct below', goalId: below.id });
            const outside = await createWorkItem(owner, { projectId: pb, typeId, title: 'outside' });
            const byTop = (await listWorkItems(viewer, { goalId: top.id, limit: 100 })).items.map((i) => i.id);
            expect(byTop.sort()).toEqual([viaProject.id, viaBoth.id, direct.id].sort());
            expect(byTop).not.toContain(outside.id);
            const byBelow = (await listWorkItems(viewer, { goalId: below.id, limit: 100 })).items.map((i) => i.id);
            expect(byBelow).toEqual(expect.arrayContaining([viaProject.id, direct.id]));
            const byInit = (await listWorkItems(viewer, { initiativeId: init.id, limit: 100 })).items.map((i) => i.id);
            expect(byInit.sort()).toEqual([viaProject.id, viaBoth.id].sort());
            await deleteGoal(owner, below.id);
            // The walk stops at the deleted goal: neither its initiative's projects nor its direct items match the top.
            expect((await listWorkItems(viewer, { goalId: top.id, limit: 100 })).items.map((i) => i.id)).toEqual([viaBoth.id]);
            expect(await reasonOf(listWorkItems(viewer, { goalId: below.id }))).toBe('GOAL_NOT_FOUND');
            expect(await reasonOf(listWorkItems(viewer, { initiativeId: init.id }))).toBe('INITIATIVE_NOT_FOUND');
            await restoreGoal(owner, below.id);
        });
    });

    describe('the ancestry', () => {
        it('reads parents, project, initiative and both goal chains in one statement; never a description', async () => {
            const g1 = await createGoal(owner, { title: 'Anc 1', description: 'secret why' });
            const g2 = await createGoal(owner, { title: 'Anc 2', parentId: g1.id });
            const g3 = await createGoal(owner, { title: 'Anc 3', parentId: g2.id });
            const direct = await createGoal(owner, { title: 'Anc direct' });
            const init = await createInitiative(owner, { name: 'Anc initiative', goalId: g3.id });
            const p = (await createProject(owner, { teamId, name: 'Ancestry', keyPrefix: 'ANC', initiativeId: init.id })).id;
            let parent = await createWorkItem(owner, { projectId: p, typeId, title: 'level 0' });
            const chain = [parent.id];
            for (let n = 1; n <= 5; n += 1) {
                // guardrail-allow: n+1 — building a five-level chain of sub-items, one per level.
                parent = await createWorkItem(owner, { projectId: p, typeId, title: `level ${n}`, parentId: parent.id, ...(n === 5 ? { goalId: direct.id } : {}) });
                chain.push(parent.id);
            }
            const a = await getWorkItemAncestry(viewer, parent.id);
            expect(a.parents.map((x) => x.id)).toEqual(chain.slice(0, 5));
            expect(a.project).toMatchObject({ id: p, keyPrefix: 'ANC' });
            expect(a.initiative?.id).toBe(init.id);
            expect(a.goals.map((x) => x.id)).toEqual([g1.id, g2.id, g3.id]);
            expect(a.directGoals?.map((x) => x.id)).toEqual([direct.id]);
            expect(a.hiddenLevels).toBe(0);
            expect(JSON.stringify(a)).not.toContain('secret why');
            // Without goals.view the levels are counted, never named.
            const perms = getPermissionsForRole('VIEWER');
            perms.goals.view = false;
            const hidden = await getWorkItemAncestry({ ...viewer, appPermissions: perms }, parent.id);
            expect(hidden).toMatchObject({ initiative: null, goals: [], directGoals: null, hiddenLevels: 5 });
            // An archived goal stays in the chain, shown archived; a deleted initiative shows nothing.
            await updateGoal(owner, g2.id, { status: 'COMPLETED' });
            await setGoalArchived(owner, g2.id, true);
            expect((await getWorkItemAncestry(viewer, parent.id)).goals.find((x) => x.id === g2.id)?.archived).toBe(true);
            await deleteInitiative(owner, init.id);
            expect((await getWorkItemAncestry(viewer, parent.id))).toMatchObject({ initiative: null, goals: [] });
            // Missing, invisible to a guest, deleted: 404 / refused.
            expect(await statusOf(getWorkItemAncestry(viewer, 'no-such-item'))).toBe(404);
            expect(await statusOf(getWorkItemAncestry(guest, parent.id))).toBe(403);
        });

        it('matches a naive in-memory walk over random trees', async () => {
            let seed = 7;
            const rnd = (n: number) => {
                seed = (seed * 48271) % 2147483647;
                return seed % n;
            };
            const goals: Array<{ id: string; parentId: string | null; depth: number }> = [];
            for (let n = 0; n < 9; n += 1) {
                const candidates = goals.filter((g) => g.depth < 3);
                const parent = n > 0 && rnd(3) > 0 && candidates.length ? candidates[rnd(candidates.length)]! : null;
                // guardrail-allow: n+1 — building a random tree, one goal at a time.
                const g = await createGoal(owner, { title: `Rand ${n}`, parentId: parent?.id ?? null });
                goals.push({ id: g.id, parentId: parent?.id ?? null, depth: (parent?.depth ?? 0) + 1 });
            }
            const up = (id: string | null): string[] => {
                const out: string[] = [];
                for (let cur = id; cur; cur = goals.find((g) => g.id === cur)?.parentId ?? null) out.unshift(cur);
                return out;
            };
            for (let n = 0; n < 6; n += 1) {
                const g = goals[rnd(goals.length)]!;
                const d = goals[rnd(goals.length)]!;
                // guardrail-allow: n+1 — one random case per pass.
                const init = await createInitiative(owner, { name: `Rand init ${n}`, goalId: g.id });
                const p = (await createProject(owner, { teamId, name: `Rand ${n}`, keyPrefix: `RND${String.fromCharCode(65 + n)}`, initiativeId: init.id })).id;
                const item = await createWorkItem(owner, { projectId: p, typeId, title: `rand ${n}`, goalId: d.id });
                const a = await getWorkItemAncestry(owner, item.id);
                expect(a.goals.map((x) => x.id)).toEqual(up(g.id));
                expect(a.directGoals?.map((x) => x.id)).toEqual(up(d.id));
            }
        });
    });

    describe('the purge (decision 219)', () => {
        it('purges past the window only, clears every link, counts it, and writes one counts-only entry', async () => {
            const g = await createGoal(owner, { title: 'Purged goal' });
            const child = await createGoal(owner, { title: 'Purged child', parentId: g.id });
            const keptChild = await createGoal(owner, { title: 'Moved off later' });
            const init = await createInitiative(owner, { name: 'Purged initiative', goalId: g.id });
            const p = (await createProject(owner, { teamId, name: 'Purge', keyPrefix: 'PRG', initiativeId: init.id })).id;
            const item = await createWorkItem(owner, { projectId: p, typeId, title: 'names purged goal', goalId: child.id });
            const versionBefore = (await getWorkItem(owner, item.id)).version;
            await deleteGoal(owner, g.id);
            // Within the window: nothing.
            expect((await processGoalPurge({ tenantId, windowDays: 30 })).goals).toBe(0);
            // Past it (now moved forward 31 days): every deleted row of the workspace goes, this group's among them.
            const deletedGoals = (await prisma.goal.findMany({ where: { tenantId, deletedAt: { not: null } }, select: { id: true } })).map((x) => x.id);
            const deletedInits = (await prisma.initiative.findMany({ where: { tenantId, deletedAt: { not: null } }, select: { id: true } })).map((x) => x.id);
            const expected = {
                goals: deletedGoals.length,
                initiatives: deletedInits.length,
                projectsUnlinked: await prisma.project.count({ where: { tenantId, initiativeId: { in: deletedInits } } }),
                itemsUnlinked: await prisma.workItem.count({ where: { tenantId, goalId: { in: deletedGoals } } }),
            };
            expect(deletedGoals).toEqual(expect.arrayContaining([g.id, child.id]));
            expect(expected.projectsUnlinked).toBeGreaterThanOrEqual(1);
            expect(expected.itemsUnlinked).toBeGreaterThanOrEqual(1);
            const r = await processGoalPurge({ tenantId, windowDays: 30, now: new Date(Date.now() + 31 * 86_400_000) });
            expect(r).toMatchObject({ tenants: 1, ...expected });
            expect(await prisma.goal.count({ where: { id: { in: [g.id, child.id] } } })).toBe(0);
            expect((await getProject(owner, p)).initiativeId).toBeNull();
            const after = await getWorkItem(owner, item.id);
            expect(after.goalId).toBeNull();
            expect(after.version).toBe(versionBefore);
            expect(await prisma.goal.count({ where: { id: keptChild.id } })).toBe(1);
            const [entry] = await prisma.auditLog.findMany({ where: { tenantId, action: 'GOALS_PURGED' } });
            expect(entry?.metadataJson).toMatchObject(expected);
            expect(await prisma.goal.count({ where: { tenantId, deletedAt: { not: null } } })).toBe(0);
            expect(JSON.stringify(entry)).not.toContain('Purged goal');
        });
    });

    describe('keys (decision 213)', () => {
        it('a Viewer reads and writes nothing; a Guest reads nothing', async () => {
            const g = await createGoal(owner, { title: 'Keys' });
            expect((await listGoals(viewer)).goals.map((x) => x.id)).toContain(g.id);
            expect(await statusOf(createGoal(viewer, { title: 'no' }))).toBe(403);
            expect(await statusOf(updateGoal(viewer, g.id, { status: 'STARTED' }))).toBe(403);
            expect(await statusOf(deleteGoal(viewer, g.id))).toBe(403);
            expect(await statusOf(createInitiative(viewer, { name: 'no' }))).toBe(403);
            expect(await statusOf(listGoals(guest))).toBe(403);
            expect(await statusOf(listInitiatives(guest))).toBe(403);
            expect(await statusOf(getGoal(guest, g.id))).toBe(403);
            expect(await statusOf(updateInitiative(guest, 'x', { status: 'STARTED' }))).toBe(403);
        });
    });

    it('the audit chain verifies', async () => {
        const result = await verifyAuditChain(tenantId);
        expect(result.valid).toBe(true);
    });
});
