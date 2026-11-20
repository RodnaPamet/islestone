/**
 * Milestones against a real Postgres, as `app_user` (sub-phase 2.5b;
 * docs/porting/maps/2.5.md; owner decisions 62 and 72):
 *
 *   - what migration `20261122120000_milestones` adds beyond Prisma, in the
 *     catalogue and by its bite: `sortKey` COLLATE "C", the composite FK
 *     (another project's milestone refused; NO ACTION, so a milestone an item
 *     names cannot be deleted but a workspace's cascade passes), and the
 *     transition trigger recording a milestone change;
 *   - create, rename, re-date, reorder by neighbour and delete (the name
 *     unique in the project; delete clears its items, deleted ones too, each
 *     audited, versions increased);
 *   - an item's milestone: another project's refused, the version increases,
 *     on create, the list filter (ids and none), a move clearing it;
 *   - progress and "late" over visible, live items, cancelled left out;
 *   - the cycle rollover leaves milestones alone;
 *   - who may do what (VIEWER reads, MEMBER manages, GUEST sees nothing);
 *   - every write audited, and the chain verifies.
 */
import type { PrismaClient } from '@prisma/client';

import { buildTenantSystemJobContext } from '@/app-layer/context-system';
import type { RequestContext } from '@/app-layer/types';
import { addDays, dayKey } from '@/app-layer/domain/cycle';
import { todayInTz } from '@/app-layer/notifications/work-item-due';
import { createCycle, setWorkItemCycle } from '@/app-layer/usecases/cycle';
import { rolloverWorkspaceCycles } from '@/app-layer/usecases/cycle-rollover';
import { createMilestone, deleteMilestone, getMilestone, listMilestones, setWorkItemMilestone, updateMilestone } from '@/app-layer/usecases/milestone';
import { createProject, setProjectArchived } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createWorkItem, deleteWorkItem, getWorkItem, listWorkItems, setWorkItemState } from '@/app-layer/usecases/work-item';
import { moveWorkItemToProject } from '@/app-layer/usecases/work-item-moves';
import { getWorkItemViewConfig } from '@/app-layer/usecases/work-item-views';
import { verifyAuditChain } from '@/lib/audit';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `mil${Date.now().toString(36)}`;

describeFn('milestones', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let member: RequestContext;
    let viewer: RequestContext;
    let guest: RequestContext;
    let teamId = '';
    let projectId = '';
    let otherProjectId = '';
    let typeId = '';
    let doneStateId = '';
    let cancelledStateId = '';
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
        cancelledStateId = team.workflowStates.find((s) => s.category === 'CANCELLED')!.id;
        projectId = (await createProject(owner, { teamId, name: 'Milestones', keyPrefix: 'MIL' })).id;
        otherProjectId = (await createProject(owner, { teamId, name: 'Elsewhere', keyPrefix: 'ELS' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
    });

    afterAll(async () => {
        process.env.NOTIFICATIONS_TZ = savedTz;
        await resetDatabase(prisma);
    });

    const newItem = (title: string, pid = projectId, milestoneId?: string) => createWorkItem(owner, { projectId: pid, typeId, title, ...(milestoneId ? { milestoneId } : {}) });

    describe('what the migration adds', () => {
        it('the catalogue: sortKey is COLLATE "C", the item FK is NO ACTION, the update trigger watches milestoneId', async () => {
            const [col] = await prisma.$queryRaw<Array<{ collname: string }>>`
                SELECT c.collname::text AS collname FROM pg_attribute a JOIN pg_collation c ON c.oid = a.attcollation
                 WHERE a.attrelid = '"Milestone"'::regclass AND a.attname = 'sortKey'`;
            expect(col?.collname).toBe('C');
            const [fk] = await prisma.$queryRaw<Array<{ deltype: string; updtype: string }>>`
                SELECT confdeltype::text AS deltype, confupdtype::text AS updtype FROM pg_constraint
                 WHERE conrelid = '"WorkItem"'::regclass AND confrelid = '"Milestone"'::regclass AND contype = 'f'`;
            expect(fk).toEqual({ deltype: 'a', updtype: 'a' });
            const [trg] = await prisma.$queryRaw<Array<{ def: string }>>`
                SELECT pg_get_triggerdef(oid)::text AS def FROM pg_trigger WHERE tgname = 'work_item_transition_update'`;
            expect(trg?.def).toMatch(/UPDATE OF "stateId", "cycleId", "milestoneId", "projectId", "deletedAt"/);
        });

        it('refuses another project\'s milestone and a delete of a milestone an item names; records a milestone change as a transition', async () => {
            const mine = await createMilestone(owner, projectId, { name: 'FK mine' });
            const theirs = await createMilestone(owner, otherProjectId, { name: 'FK theirs' });
            const item = await newItem('fk');
            await expect(prisma.workItem.update({ where: { id: item.id }, data: { milestoneId: theirs.id } })).rejects.toThrow();
            await runInTenantContext(owner, (db) => db.workItem.update({ where: { id: item.id }, data: { milestoneId: mine.id } }));
            await expect(prisma.milestone.delete({ where: { id: mine.id } })).rejects.toThrow();
            const rows = await prisma.workItemTransition.findMany({ where: { workItemId: item.id }, orderBy: [{ at: 'asc' }, { id: 'asc' }] });
            expect(rows.map((r) => r.milestoneId)).toEqual([null, mine.id]);
            // A title edit records nothing.
            await prisma.workItem.update({ where: { id: item.id }, data: { title: 'renamed' } });
            expect(await prisma.workItemTransition.count({ where: { workItemId: item.id } })).toBe(2);
        });

        it('deleting a whole project with an item that names its milestone cascades (NO ACTION checks at the end)', async () => {
            const scratch = await createProject(owner, { teamId, name: 'Scratch', keyPrefix: 'SCR' });
            const m = await createMilestone(owner, scratch.id, { name: 'Gone with it' });
            await newItem('goes too', scratch.id, m.id);
            await prisma.project.delete({ where: { id: scratch.id } });
            expect(await prisma.milestone.count({ where: { id: m.id } })).toBe(0);
        });
    });

    describe('milestone writes', () => {
        it('a MEMBER creates them in order; a name is unique in its project; a VIEWER reads but does not write; a GUEST sees no project', async () => {
            const a = await createMilestone(member, projectId, { name: '  Alpha  ', dueDate: k(10) });
            const b = await createMilestone(member, projectId, { name: 'Beta' });
            expect(a).toMatchObject({ name: 'Alpha', dueDate: k(10), progress: { scope: 0, done: 0 }, late: false });
            expect(b.dueDate).toBeNull();
            await expect(createMilestone(member, projectId, { name: 'Alpha' })).rejects.toMatchObject({ status: 409, details: { reason: 'MILESTONE_NAME_TAKEN' } });
            await expect(createMilestone(owner, otherProjectId, { name: 'Alpha' })).resolves.toMatchObject({ name: 'Alpha' });
            await expect(createMilestone(viewer, projectId, { name: 'Nope' })).rejects.toMatchObject({ status: 403 });
            const names = (await listMilestones(viewer, projectId)).map((m) => m.name);
            expect(names.indexOf('Alpha')).toBeLessThan(names.indexOf('Beta'));
            await expect(listMilestones(guest, projectId)).rejects.toMatchObject({ status: 404 });
            // A sanitised name: markup does not survive.
            expect((await createMilestone(member, projectId, { name: '<b>Gamma</b>' })).name).toBe('Gamma');
        });

        it('renames, re-dates, clears the date and reorders by neighbour', async () => {
            const list = await listMilestones(owner, projectId);
            const alpha = list.find((m) => m.name === 'Alpha')!;
            const gamma = list.find((m) => m.name === 'Gamma')!;
            const renamed = await updateMilestone(owner, projectId, alpha.id, { name: 'Alpha one', dueDate: k(20) });
            expect(renamed).toMatchObject({ name: 'Alpha one', dueDate: k(20) });
            expect((await updateMilestone(owner, projectId, alpha.id, { dueDate: null })).dueDate).toBeNull();
            await updateMilestone(owner, projectId, gamma.id, { position: { beforeId: alpha.id } });
            const order = (await listMilestones(owner, projectId)).map((m) => m.name);
            expect(order.indexOf('Gamma')).toBe(order.indexOf('Alpha one') - 1);
            await expect(updateMilestone(owner, projectId, gamma.id, { position: { afterId: gamma.id } })).rejects.toMatchObject({ status: 400 });
            const theirs = (await listMilestones(owner, otherProjectId))[0]!;
            await expect(updateMilestone(owner, projectId, gamma.id, { position: { afterId: theirs.id } })).rejects.toMatchObject({ status: 400 });
            await expect(updateMilestone(owner, projectId, theirs.id, { name: 'x' })).rejects.toMatchObject({ status: 404 });
            await expect(updateMilestone(owner, projectId, gamma.id, { name: 'Beta' })).rejects.toMatchObject({ status: 409 });
        });

        it('deleting a milestone clears its items, deleted ones included, each audited, versions increased', async () => {
            const m = await createMilestone(owner, projectId, { name: 'Doomed' });
            const live = await newItem('live in doomed', projectId, m.id);
            const gone = await newItem('deleted in doomed', projectId, m.id);
            await deleteWorkItem(owner, gone.id);
            await expect(deleteMilestone(viewer, projectId, m.id)).rejects.toMatchObject({ status: 403 });
            expect(await deleteMilestone(member, projectId, m.id)).toEqual({ deleted: true, clearedItems: 2 });
            const after = await getWorkItem(owner, live.id);
            expect(after.milestoneId).toBeNull();
            expect(after.version).toBe(live.version + 1);
            expect((await prisma.workItem.findUnique({ where: { id: gone.id } }))?.milestoneId).toBeNull();
            const entries = await prisma.auditLog.findMany({ where: { tenantId, action: 'WORK_ITEM_MILESTONE_CHANGED', entityId: { in: [live.id, gone.id] } } });
            expect(entries).toHaveLength(2);
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'MILESTONE_DELETED', entityId: m.id } })).toBe(1);
            await expect(getMilestone(owner, projectId, m.id)).rejects.toMatchObject({ status: 404 });
        });

        it('an archived project\'s milestones are read-only', async () => {
            const shelf = await createProject(owner, { teamId, name: 'Shelf', keyPrefix: 'SHF' });
            const m = await createMilestone(owner, shelf.id, { name: 'Kept' });
            await setProjectArchived(owner, shelf.id, true);
            await expect(listMilestones(viewer, shelf.id)).resolves.toHaveLength(1);
            await expect(createMilestone(owner, shelf.id, { name: 'More' })).rejects.toMatchObject({ status: 409, details: { reason: 'PROJECT_ARCHIVED' } });
            await expect(updateMilestone(owner, shelf.id, m.id, { name: 'x' })).rejects.toMatchObject({ status: 409 });
            await expect(deleteMilestone(owner, shelf.id, m.id)).rejects.toMatchObject({ status: 409 });
        });
    });

    describe('an item\'s milestone', () => {
        it('sets one of the item\'s project (the version increases), refuses another project\'s, and clears it', async () => {
            const m = await createMilestone(owner, projectId, { name: 'First' });
            const theirs = await createMilestone(owner, otherProjectId, { name: 'Theirs' });
            const item = await newItem('aimed');
            await expect(setWorkItemMilestone(viewer, item.id, { milestoneId: m.id })).rejects.toMatchObject({ status: 403 });
            const set = await setWorkItemMilestone(member, item.id, { milestoneId: m.id }, item.version);
            expect(set).toMatchObject({ milestoneId: m.id, version: item.version + 1 });
            await expect(setWorkItemMilestone(member, item.id, { milestoneId: theirs.id })).rejects.toMatchObject({ status: 400 });
            await expect(setWorkItemMilestone(member, item.id, { milestoneId: null }, item.version)).rejects.toMatchObject({ status: 409 });
            const cleared = await setWorkItemMilestone(member, item.id, { milestoneId: null });
            expect(cleared.milestoneId).toBeNull();
            const audit = await prisma.auditLog.findMany({ where: { tenantId, action: 'WORK_ITEM_MILESTONE_CHANGED', entityId: item.id }, orderBy: { createdAt: 'asc' } });
            expect(audit).toHaveLength(2);
            await expect(createWorkItem(owner, { projectId, typeId, title: 'wrong', milestoneId: theirs.id })).rejects.toMatchObject({ status: 400 });
        });

        it('filters the list by milestone id and by none, and the view configuration names the milestones', async () => {
            const m = await createMilestone(owner, projectId, { name: 'Filter' });
            const a = await newItem('filter a', projectId, m.id);
            const b = await newItem('filter b');
            const ids = (await listWorkItems(owner, { milestoneId: m.id })).items.map((i) => i.id);
            expect(ids).toEqual([a.id]);
            const none = (await listWorkItems(owner, { projectId, milestoneId: 'none' })).items.map((i) => i.id);
            expect(none).toContain(b.id);
            expect(none).not.toContain(a.id);
            const config = await getWorkItemViewConfig(viewer);
            expect(config.milestones.find((x) => x.id === m.id)).toEqual({ id: m.id, projectId, name: 'Filter', dueDate: null });
            expect((await getWorkItemViewConfig(guest)).milestones).toEqual([]);
        });

        it('a move to another project clears the milestone', async () => {
            const m = await createMilestone(owner, projectId, { name: 'Stays here' });
            const item = await newItem('mover', projectId, m.id);
            await moveWorkItemToProject(owner, item.id, { projectId: otherProjectId });
            const moved = await getWorkItem(owner, item.id);
            expect(moved).toMatchObject({ projectId: otherProjectId, milestoneId: null });
        });
    });

    describe('progress', () => {
        it('scope leaves out cancelled items, done counts Done; late is a passed due date with open items', async () => {
            const m = await createMilestone(owner, projectId, { name: 'Progress', dueDate: k(-1) });
            const done = await newItem('p done', projectId, m.id);
            await newItem('p open', projectId, m.id);
            const cancelled = await newItem('p cancelled', projectId, m.id);
            const deleted = await newItem('p deleted', projectId, m.id);
            await setWorkItemState(owner, done.id, { stateId: doneStateId });
            await setWorkItemState(owner, cancelled.id, { stateId: cancelledStateId });
            await deleteWorkItem(owner, deleted.id);
            const read = await getMilestone(viewer, projectId, m.id);
            expect(read).toMatchObject({ progress: { scope: 2, done: 1 }, late: true });

            const open = (await listWorkItems(owner, { milestoneId: m.id, q: 'p open' })).items[0]!;
            await setWorkItemState(owner, open.id, { stateId: doneStateId });
            expect(await getMilestone(viewer, projectId, m.id)).toMatchObject({ progress: { scope: 2, done: 2 }, late: false });
            // A future date is never late.
            const later = await createMilestone(owner, projectId, { name: 'Later', dueDate: k(5) });
            await newItem('later open', projectId, later.id);
            expect(await getMilestone(owner, projectId, later.id)).toMatchObject({ progress: { scope: 1, done: 0 }, late: false });
        });
    });

    it('the cycle rollover leaves milestones alone', async () => {
        const m = await createMilestone(owner, projectId, { name: 'Through rollover' });
        const cycle = await createCycle(owner, { teamId, startsOn: k(0), endsOn: k(1) });
        const item = await newItem('rolls', projectId, m.id);
        await setWorkItemCycle(owner, item.id, { cycleId: cycle.id });
        const sys = await buildTenantSystemJobContext({ tenantId, tenantSlug: TAG, job: 'cycle-rollover' });
        const r = await rolloverWorkspaceCycles(sys, addDays(today, 2));
        expect(r.cyclesClosed).toBe(1);
        const after = await prisma.workItem.findUnique({ where: { id: item.id } });
        expect(after?.milestoneId).toBe(m.id);
        expect(await getMilestone(owner, projectId, m.id)).toMatchObject({ name: 'Through rollover', progress: { scope: 1, done: 0 } });
        expect(await prisma.auditLog.count({ where: { tenantId, action: 'WORK_ITEM_MILESTONE_CHANGED', entityId: item.id } })).toBe(0);
    });

    it('every milestone write is audited, and the audit chain verifies', async () => {
        const actions = await prisma.auditLog.groupBy({ by: ['action'], where: { tenantId, action: { startsWith: 'MILESTONE_' } }, _count: { _all: true } });
        expect(actions.map((a) => a.action).sort()).toEqual(['MILESTONE_CREATED', 'MILESTONE_DELETED', 'MILESTONE_UPDATED']);
        const result = await verifyAuditChain(tenantId);
        expect(result.valid).toBe(true);
    });
});
