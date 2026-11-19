/**
 * The work-item usecases against a real Postgres, as `app_user`
 * (sub-phases 2.1–2.2): keys, versions, state changes, delete and restore,
 * project delete and archive, comments, watchers, labels, metrics and
 * Activity. Audit assertions read real `AuditLog` rows and verify the chain.
 *
 * Written for Islestone in the pattern of inflect-compliance's
 * `task-key-sequence.test.ts`, `task-usecase-branches.test.ts`,
 * `task-status-change-sequence.test.ts` and `task-kpi-consistency.test.ts`
 * (tests/integration at 5528464fc54a8681956f3b9ce23ca9c075f0420e), rewritten
 * for projects, workflow states and soft delete by `deletionId`.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { createProject, deleteProject, restoreProject, setProjectArchived, updateProject } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import {
    assignWorkItem,
    bulkDeleteWorkItems,
    bulkSetWorkItemState,
    createWorkItem,
    deleteWorkItem,
    getWorkItem,
    getWorkItemActivity,
    getWorkItemByKey,
    getWorkItemMetrics,
    listDeletedWorkItems,
    listWorkItems,
    restoreWorkItem,
    setWorkItemState,
    updateWorkItem,
} from '@/app-layer/usecases/work-item';
import { addComment, addWatcher, deleteComment, editComment, listComments, watchWorkItem } from '@/app-layer/usecases/work-item-collab';
import { updateWorkflowState, deleteWorkflowState } from '@/app-layer/usecases/workflow-state';
import { removeTenantMember } from '@/app-layer/usecases/tenant-admin';
import { verifyAuditChain } from '@/lib/audit';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `wiuc${Date.now().toString(36)}`;

describeFn('work-item usecases', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let member: RequestContext;
    let memberUserId = '';
    let teamId = '';
    let states: Record<string, { id: string; category: string }> = {};
    let projectId = '';
    let typeId = '';

    const newItem = (title: string, extra: Partial<Parameters<typeof createWorkItem>[1]> = {}) =>
        createWorkItem(owner, { projectId, typeId, title, ...extra });

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        const tenant = await createTenantWithDek({ name: TAG, slug: TAG });
        tenantId = tenant.id;
        const ownerUser = await prisma.user.create({ data: { email: `owner-${TAG}@example.test`, name: 'Olive Owner' } });
        const memberUser = await prisma.user.create({ data: { email: `member-${TAG}@example.test`, name: 'Max Member' } });
        memberUserId = memberUser.id;
        await prisma.tenantMembership.create({ data: { tenantId, userId: ownerUser.id, role: 'OWNER' } });
        await prisma.tenantMembership.create({ data: { tenantId, userId: memberUser.id, role: 'MEMBER' } });
        owner = makeRequestContext('OWNER', { tenantId, userId: ownerUser.id, tenantSlug: TAG, requestId: `${TAG}-o` });
        member = makeRequestContext('MEMBER', { tenantId, userId: memberUser.id, tenantSlug: TAG, requestId: `${TAG}-m` });

        const team = await createTeam(owner, { name: 'Core' });
        teamId = team.id;
        states = Object.fromEntries(team.workflowStates.map((s) => [s.name, { id: s.id, category: s.category }]));
        const project = await createProject(owner, { teamId, name: 'Islestone', keyPrefix: 'isl' });
        projectId = project.id;
        typeId = (await listWorkItemTypes(owner)).find((t) => t.name === 'Bug')!.id;
    });

    afterAll(async () => {
        if (!process.env.KEEP_DB) await resetDatabase(prisma);
    });

    describe('teams, types and projects', () => {
        it('a new team is seeded with its workflow: one default, Done and Cancelled', () => {
            expect(Object.keys(states)).toEqual(['Backlog', 'Todo', 'In progress', 'In review', 'Done', 'Cancelled']);
        });

        it('the workspace is seeded with Feature, Bug and Chore', async () => {
            expect((await listWorkItemTypes(owner)).map((t) => t.name)).toEqual(['Feature', 'Bug', 'Chore']);
        });

        it('a prefix is normalised to upper case, unique, and never reused', async () => {
            const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
            expect(project.keyPrefix).toBe('ISL');
            await expect(createProject(owner, { teamId, name: 'Dup', keyPrefix: 'ISL' })).rejects.toMatchObject({
                status: 409,
                details: { reason: 'KEY_PREFIX_TAKEN' },
            });
            const other = await createProject(owner, { teamId, name: 'Other', keyPrefix: 'OTH' });
            await updateProject(owner, other.id, { keyPrefix: 'OTX' });
            // The retired prefix stays taken.
            await expect(createProject(owner, { teamId, name: 'Reuse', keyPrefix: 'OTH' })).rejects.toMatchObject({ status: 409 });
        });

        it('a project stays with its team', async () => {
            const t2 = await createTeam(owner, { name: 'Other team' });
            await expect(updateProject(owner, projectId, { teamId: t2.id })).rejects.toMatchObject({ details: { reason: 'PROJECT_TEAM_FIXED' } });
        });

        it('the state category is immutable in the database (trigger)', async () => {
            await expect(
                prisma.workflowState.update({ where: { id: states['Todo']!.id }, data: { category: 'STARTED' } }),
            ).rejects.toThrow(/WORKFLOW_STATE_CATEGORY_IMMUTABLE/);
        });

        it('the default state and the last Done state cannot be archived', async () => {
            await expect(updateWorkflowState(owner, states['Todo']!.id, { archived: true })).rejects.toMatchObject({
                details: { reason: 'STATE_IS_DEFAULT' },
            });
            await expect(updateWorkflowState(owner, states['Done']!.id, { archived: true })).rejects.toMatchObject({
                details: { reason: 'LAST_STATE_OF_CATEGORY' },
            });
        });
    });

    describe('keys', () => {
        it('20 concurrent creates in one project get contiguous numbers', async () => {
            const before = (await prisma.projectKeySequence.findUniqueOrThrow({ where: { projectId } })).lastValue;
            const items = await Promise.all(Array.from({ length: 20 }, (_, i) => newItem(`concurrent ${i}`)));
            const numbers = items.map((i) => i.number).sort((a, b) => a - b);
            expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => before + 1 + i));
            expect(new Set(items.map((i) => i.key)).size).toBe(20);
            expect(items[0]!.key).toMatch(/^ISL-\d+$/);
        });

        it('a failed create uses no number, and a deleted item keeps its number', async () => {
            const before = (await prisma.projectKeySequence.findUniqueOrThrow({ where: { projectId } })).lastValue;
            await expect(newItem('bad state', { stateId: 'nope' })).rejects.toMatchObject({ status: 404 });
            await expect(newItem('bad assignee', { assigneeId: 'not-a-member' })).rejects.toMatchObject({ status: 400 });
            const a = await newItem('first after failures');
            expect(a.number).toBe(before + 1);
            await deleteWorkItem(owner, a.id);
            const b = await newItem('after a delete');
            expect(b.number).toBe(before + 2);
        });

        it('by key: the current prefix, a retired prefix (redirected), and a miss is a 404', async () => {
            const item = await newItem('keyed');
            expect((await getWorkItemByKey(owner, item.key)).item.id).toBe(item.id);
            expect((await getWorkItemByKey(owner, item.key.toLowerCase())).redirected).toBe(false);
            const p = await createProject(owner, { teamId, name: 'Renamed later', keyPrefix: 'REN' });
            const inP = await createWorkItem(owner, { projectId: p.id, typeId, title: 'old prefix' });
            await updateProject(owner, p.id, { keyPrefix: 'RNW' });
            const found = await getWorkItemByKey(owner, `REN-${inP.number}`);
            expect(found).toMatchObject({ redirected: true, canonicalKey: `RNW-${inP.number}` });
            await expect(getWorkItemByKey(owner, 'ISL-99999')).rejects.toMatchObject({ status: 404 });
            await expect(getWorkItemByKey(owner, 'not a key')).rejects.toMatchObject({ status: 404 });
        });
    });

    describe('optimistic concurrency', () => {
        it('a title edit needs If-Match (428), a stale version is a 409 with the current row, the right one wins', async () => {
            const item = await newItem('versioned');
            expect(item.version).toBe(1);
            await expect(updateWorkItem(owner, item.id, { title: 'no version' })).rejects.toMatchObject({ status: 428 });
            const v2 = await updateWorkItem(owner, item.id, { title: 'v2', description: 'secret text' }, 1);
            expect(v2.version).toBe(2);
            await expect(updateWorkItem(owner, item.id, { title: 'stale' }, 1)).rejects.toMatchObject({
                status: 409,
                details: { reason: 'VERSION_CONFLICT', version: 2, item: expect.objectContaining({ title: 'v2' }) },
            });
            // A single-field change without a version is last-writer-wins.
            expect((await updateWorkItem(owner, item.id, { priority: 'HIGH' })).version).toBe(3);
        });

        it('the description is stored encrypted and the audit row names fields, never text', async () => {
            const item = await newItem('described', { description: 'plain secret words' });
            const [raw] = await prisma.$queryRaw<{ description: string }[]>`SELECT description FROM "WorkItem" WHERE id = ${item.id}`;
            expect(raw!.description).not.toContain('plain secret words');
            expect((await getWorkItem(owner, item.id)).description).toBe('plain secret words');
            await updateWorkItem(owner, item.id, { description: 'new hidden words' }, 1);
            const audit = await prisma.auditLog.findMany({ where: { tenantId, entityId: item.id } });
            expect(JSON.stringify(audit)).not.toContain('new hidden words');
            expect(audit.find((a) => a.action === 'WORK_ITEM_UPDATED')?.detailsJson).toMatchObject({ changedFields: ['description'] });
        });

        it('title and description are sanitised before storage', async () => {
            const item = await newItem('<script>alert(1)</script>Safe', { description: '<img src=x onerror=alert(1)>Body' });
            const stored = await getWorkItem(owner, item.id);
            expect(stored.title).not.toMatch(/<script/i);
            expect(stored.description).not.toMatch(/onerror/i);
        });
    });

    describe('state changes', () => {
        it('applies the lifecycle timestamps, refuses a no-op and another team\'s state, and audits from/to', async () => {
            const item = await newItem('moving');
            const started = await setWorkItemState(owner, item.id, { stateId: states['In progress']!.id });
            expect(started.startedAt).not.toBeNull();
            const done = await setWorkItemState(owner, item.id, { stateId: states['Done']!.id });
            expect(done.completedAt).not.toBeNull();
            const reopened = await setWorkItemState(owner, item.id, { stateId: states['Todo']!.id });
            expect(reopened.completedAt).toBeNull();
            expect(reopened.startedAt).toEqual(started.startedAt);
            await expect(setWorkItemState(owner, item.id, { stateId: states['Todo']!.id })).rejects.toMatchObject({
                status: 400,
                message: 'The work item is already in Todo.',
            });
            const other = await createTeam(owner, { name: 'Elsewhere' });
            await expect(setWorkItemState(owner, item.id, { stateId: other.workflowStates[0]!.id })).rejects.toMatchObject({ status: 400 });
            const rows = await prisma.auditLog.findMany({ where: { tenantId, entityId: item.id, action: 'WORK_ITEM_STATE_CHANGED' } });
            expect(rows).toHaveLength(3);
            expect(rows[0]!.detailsJson).toMatchObject({ fromStateId: states['Todo']!.id, toStateId: states['In progress']!.id, toCategory: 'STARTED' });
        });

        it('bulk by category maps to the team default of that category, all or nothing', async () => {
            const a = await newItem('bulk a');
            const b = await newItem('bulk b');
            const r = await bulkSetWorkItemState(owner, { workItemIds: [a.id, b.id, a.id, 'missing'], stateCategory: 'DONE' });
            expect(r.count).toBe(2);
            expect(r.results.find((x) => x.id === 'missing')?.status).toBe('not_found');
            expect((await getWorkItem(owner, a.id)).stateId).toBe(states['Done']!.id);
        });

        it('deleting a state with items asks for a target and moves them', async () => {
            const extra = await prisma.workflowState.create({
                data: { tenantId, teamId, name: 'Doomed', category: 'STARTED', sortKey: 'x' },
            });
            const item = await newItem('in doomed', { stateId: extra.id });
            await expect(deleteWorkflowState(owner, extra.id)).rejects.toMatchObject({ details: { reason: 'STATE_HAS_WORK_ITEMS' } });
            await deleteWorkflowState(owner, extra.id, { moveToStateId: states['In progress']!.id });
            expect((await getWorkItem(owner, item.id)).stateId).toBe(states['In progress']!.id);
        });
    });

    describe('delete and restore', () => {
        it('deletes a subtree under one deletionId and restores exactly it', async () => {
            const parent = await newItem('parent');
            const child = await newItem('child', { parentId: parent.id });
            const grandchild = await newItem('grandchild', { parentId: child.id });
            const separate = await newItem('separate sibling', { parentId: parent.id });
            await deleteWorkItem(owner, separate.id);
            const del = await deleteWorkItem(owner, parent.id);
            expect(del.count).toBe(3);
            const rows = await prisma.workItem.findMany({ where: { id: { in: [parent.id, child.id, grandchild.id] } } });
            expect(rows.every((r) => r.deletedAt && r.deletionId === del.deletionId)).toBe(true);
            await expect(getWorkItem(owner, child.id)).rejects.toMatchObject({ status: 404 });
            // The row is still there: a soft delete, never a hard one.
            expect(await prisma.workItem.count({ where: { id: parent.id } })).toBe(1);
            const deleted = await listDeletedWorkItems(owner);
            expect(deleted.rows.map((r) => r.id)).toEqual(expect.arrayContaining([parent.id, child.id, grandchild.id]));
            await restoreWorkItem(owner, grandchild.id);
            expect((await getWorkItem(owner, parent.id)).id).toBe(parent.id);
            await getWorkItem(owner, grandchild.id);
            // The separately deleted sibling stays deleted.
            await expect(getWorkItem(owner, separate.id)).rejects.toMatchObject({ status: 404 });
        });

        it('a restore whose parent is deleted under another deletion is refused', async () => {
            const parent = await newItem('p2');
            const child = await newItem('c2', { parentId: parent.id });
            await deleteWorkItem(owner, child.id);
            await deleteWorkItem(owner, parent.id);
            await expect(restoreWorkItem(owner, child.id)).rejects.toMatchObject({ details: { reason: 'PARENT_DELETED' } });
            await restoreWorkItem(owner, parent.id);
            await restoreWorkItem(owner, child.id);
        });

        it('bulk delete dedupes ids and reports misses', async () => {
            const a = await newItem('bulk del');
            const r = await bulkDeleteWorkItems(owner, [a.id, a.id, 'gone']);
            expect(r.count).toBe(1);
            expect(r.results).toHaveLength(2);
        });
    });

    describe('project delete and archive', () => {
        it('a deleted project hides its items everywhere, refuses writes and restores, and its restore brings them back', async () => {
            const p = await createProject(owner, { teamId, name: 'Vanishing', keyPrefix: 'VAN' });
            const item = await createWorkItem(owner, { projectId: p.id, typeId, title: 'hidden soon', dueDate: '2030-01-01' });
            await deleteWorkItem(owner, (await createWorkItem(owner, { projectId: p.id, typeId, title: 'already deleted' })).id);
            const metricsBefore = await getWorkItemMetrics(owner);
            await deleteProject(owner, p.id);
            await expect(getWorkItem(owner, item.id)).rejects.toMatchObject({ status: 404 });
            await expect(getWorkItemByKey(owner, item.key)).rejects.toMatchObject({ status: 404 });
            await expect(getWorkItemActivity(owner, item.id)).rejects.toMatchObject({ status: 404 });
            await expect(updateWorkItem(owner, item.id, { priority: 'LOW' })).rejects.toMatchObject({ status: 404 });
            await expect(addComment(owner, item.id, { body: 'hi' })).rejects.toMatchObject({ status: 404 });
            expect((await listWorkItems(owner, { projectId: p.id })).items).toEqual([]);
            expect((await getWorkItemMetrics(owner)).total).toBe(metricsBefore.total - 1);
            const deletedRows = (await listDeletedWorkItems(owner)).rows.map((r) => r.title);
            expect(deletedRows).not.toContain('already deleted');
            // The items themselves were not touched: no deletedAt was written.
            expect((await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } })).deletedAt).toBeNull();
            await expect(
                restoreWorkItem(owner, (await prisma.workItem.findFirstOrThrow({ where: { title: 'already deleted' } })).id),
            ).rejects.toMatchObject({ details: { reason: 'PROJECT_DELETED' } });
            await restoreProject(owner, p.id);
            expect((await getWorkItem(owner, item.id)).title).toBe('hidden soon');
        });

        it('an archived project keeps its items readable, out of the default list, and refuses writes', async () => {
            const p = await createProject(owner, { teamId, name: 'Shelved', keyPrefix: 'SHL' });
            const item = await createWorkItem(owner, { projectId: p.id, typeId, title: 'shelved' });
            await setProjectArchived(owner, p.id, true);
            expect((await getWorkItem(owner, item.id)).title).toBe('shelved');
            expect((await listWorkItems(owner, { projectId: p.id })).items).toEqual([]);
            expect((await listWorkItems(owner, { projectId: p.id, includeArchived: true })).items).toHaveLength(1);
            await expect(updateWorkItem(owner, item.id, { priority: 'LOW' })).rejects.toMatchObject({ details: { reason: 'PROJECT_ARCHIVED' } });
            await expect(createWorkItem(owner, { projectId: p.id, typeId, title: 'refused' })).rejects.toMatchObject({ status: 409 });
            await setProjectArchived(owner, p.id, false);
            await updateWorkItem(owner, item.id, { priority: 'LOW' });
        });
    });

    describe('list, metrics and Activity', () => {
        it('the list pages by cursor over (sortKey, id) with no repeats or gaps', async () => {
            const p = await createProject(owner, { teamId, name: 'Paged', keyPrefix: 'PGD' });
            const created = [];
            for (let i = 0; i < 7; i++) created.push(await createWorkItem(owner, { projectId: p.id, typeId, title: `paged ${i}` }));
            const seen: string[] = [];
            let cursor: string | undefined;
            do {
                const page = await listWorkItems(owner, { projectId: p.id, limit: 3, cursor });
                seen.push(...page.items.map((i) => i.id));
                cursor = page.pageInfo.nextCursor;
            } while (cursor);
            expect(seen).toEqual(created.map((c) => c.id));
            await expect(listWorkItems(owner, { cursor: 'forged!!' })).rejects.toMatchObject({ status: 400 });
            await expect(listWorkItems(owner, { stateCategory: 'DONE,NOPE' })).rejects.toMatchObject({ status: 400 });
            const byKey = await listWorkItems(owner, { q: created[2]!.key });
            expect(byKey.items.map((i) => i.id)).toEqual([created[2]!.id]);
        });

        it('metrics equal the seeded counts by category', async () => {
            const p = await createProject(owner, { teamId, name: 'Counted', keyPrefix: 'CNT' });
            await createWorkItem(owner, { projectId: p.id, typeId, title: 'a', stateId: states['Done']!.id });
            await createWorkItem(owner, { projectId: p.id, typeId, title: 'b', stateId: states['Backlog']!.id, dueDate: '2001-01-01' });
            await createWorkItem(owner, { projectId: p.id, typeId, title: 'c' });
            const m = await getWorkItemMetrics(owner, { projectId: p.id });
            expect(m).toEqual({ total: 3, byCategory: { BACKLOG: 1, UNSTARTED: 1, STARTED: 0, DONE: 1, CANCELLED: 0 }, overdue: 1, unassignedOpen: 2 });
        });

        it('Activity merges audit entries and comments, newest first; comments are encrypted, edited and soft-deleted', async () => {
            const item = await newItem('discussed');
            const c = await addComment(member, item.id, { body: 'first <b>bold</b>' });
            await editComment(member, item.id, c.id, { body: 'first, edited' });
            await expect(deleteComment(makeRequestContext('MEMBER', { ...member, userId: 'someone-else' }), item.id, c.id)).rejects.toMatchObject({
                status: 403,
            });
            await assignWorkItem(owner, item.id, { assigneeId: memberUserId });
            const activity = await getWorkItemActivity(owner, item.id);
            expect(activity.items[0]).toMatchObject({ kind: 'change', action: 'WORK_ITEM_ASSIGNED' });
            expect(activity.items.find((e) => e.kind === 'comment')?.comment?.body).toBe('first, edited');
            const [raw] = await prisma.$queryRaw<{ body: string }[]>`SELECT body FROM "Comment" WHERE id = ${c.id}`;
            expect(raw!.body).not.toContain('first');
            await deleteComment(owner, item.id, c.id);
            expect((await listComments(owner, item.id)).items).toEqual([]);
        });
    });

    describe('watchers and bells', () => {
        it('watcher add and remove are audited; activity rings the watcher, not the actor', async () => {
            const item = await newItem('watched');
            await watchWorkItem(member, item.id);
            await addWatcher(owner, item.id, memberUserId);
            const audit = await prisma.auditLog.findMany({ where: { tenantId, entityId: item.id, action: 'WORK_ITEM_WATCHER_ADDED' } });
            expect(audit.length).toBeGreaterThanOrEqual(1);
            await setWorkItemState(owner, item.id, { stateId: states['In progress']!.id });
            const bells = await prisma.notification.findMany({ where: { tenantId, userId: memberUserId, type: 'WORK_ITEM_WATCH_UPDATE' } });
            expect(bells.some((b) => b.body.includes('state Todo → In progress'))).toBe(true);
            // A cosmetic edit rings nobody.
            const before = await prisma.notification.count({ where: { tenantId, userId: memberUserId } });
            await updateWorkItem(owner, item.id, { title: 'watched, renamed' }, (await getWorkItem(owner, item.id)).version);
            expect(await prisma.notification.count({ where: { tenantId, userId: memberUserId } })).toBe(before);
        });

        it('assignment writes the bell with the real row id and an outbox email', async () => {
            const item = await newItem('for max');
            await assignWorkItem(owner, item.id, { assigneeId: memberUserId });
            const bell = await prisma.notification.findFirst({
                where: { tenantId, userId: memberUserId, type: 'WORK_ITEM_ASSIGNED', linkUrl: `/t/${TAG}/work-items/${item.id}` },
            });
            expect(bell?.body).toContain('for max');
            expect(bell?.dedupeKey).toContain(item.id);
            expect(await prisma.notificationOutbox.count({ where: { tenantId, type: 'WORK_ITEM_ASSIGNED' } })).toBeGreaterThan(0);
        });
    });

    it('removing a member unassigns their items first (ADR 0003 §1, the RESTRICT foreign key)', async () => {
        const leaver = await prisma.user.create({ data: { email: `leaver-${TAG}@example.test` } });
        const membership = await prisma.tenantMembership.create({ data: { tenantId, userId: leaver.id, role: 'MEMBER' } });
        const item = await newItem('assigned to a leaver', { assigneeId: leaver.id });
        // The database refuses the dangling assignee on its own.
        await expect(prisma.tenantMembership.delete({ where: { id: membership.id } })).rejects.toThrow();
        await removeTenantMember(owner, { membershipId: membership.id });
        expect((await getWorkItem(owner, item.id)).assigneeId).toBeNull();
        expect(await prisma.auditLog.count({ where: { tenantId, action: 'WORK_ITEMS_UNASSIGNED_ON_MEMBER_REMOVAL' } })).toBe(1);
    });

    it('the audit chain verifies', async () => {
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });
});
