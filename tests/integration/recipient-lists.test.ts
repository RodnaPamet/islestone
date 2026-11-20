/**
 * Recipient lists against a real Postgres (sub-phase 2.7e; owner decisions
 * 138 to 142):
 *
 *   - `RecipientList` and `RecipientListMember` are tenant tables: as
 *     `app_user` in workspace B nothing of A's is read, changed, removed or
 *     created (the two-tenant test `tests/guards/tenant-isolation-forward-lock.test.ts`
 *     names), and `app_user` cannot delete a list in its own workspace;
 *   - workspace lists are managed under `admin.manage`, a project's under
 *     `projects.edit`; a VIEWER reads both and changes neither; names are
 *     sanitised and unique in their scope; members must be ACTIVE when added;
 *     every write is audited and the chain verifies;
 *   - lists are archived and restored, never deleted; an archived list is
 *     read-only and resolves to nobody; a removed member leaves every list;
 *   - adding a list to an item's watchers copies the people who can see it
 *     (decision 139): a GUEST, a deactivated member and someone already
 *     watching are not added; another project's or an archived list is
 *     refused; each added person can stop watching on their own;
 *   - a project's intake may name one list (decision 142): its bell rings the
 *     union of the member rows and the list, each person once, only those who
 *     hold `intake.view`, never the sender; a removed workspace resolves to
 *     nobody.
 *
 * Written fresh for Islestone.
 */
import type { PrismaClient } from '@prisma/client';

import { resolveListRecipients } from '@/app-layer/notifications/recipient-list';
import type { RequestContext } from '@/app-layer/types';
import { createIntakeForm } from '@/app-layer/usecases/intake-form';
import { sendIntakeRequest } from '@/app-layer/usecases/intake-request';
import { listProjectIntakeSettings, setProjectIntake } from '@/app-layer/usecases/intake-settings';
import { createProject, setProjectArchived } from '@/app-layer/usecases/project';
import {
    addRecipientListAsWatchers,
    archiveRecipientList,
    changeRecipientListMembers,
    createRecipientList,
    getRecipientList,
    listProjectRecipientLists,
    listRecipientLists,
    restoreRecipientList,
    setRecipientListMembers,
    updateRecipientList,
} from '@/app-layer/usecases/recipient-list';
import { createTeam } from '@/app-layer/usecases/team';
import { createWorkItem } from '@/app-layer/usecases/work-item';
import { listWatchers, unwatchWorkItem, watchWorkItem } from '@/app-layer/usecases/work-item-collab';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { verifyAuditChain } from '@/lib/audit';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `rcpl${Date.now().toString(36)}`;

describeFn('recipient lists', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let otherTenantId = '';
    let owner: RequestContext;
    let member: RequestContext;
    let viewer: RequestContext;
    let guest: RequestContext;
    let mia: RequestContext;
    let outsider: RequestContext;
    let projectId = '';
    let otherProjectId = '';
    let typeId = '';

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        otherTenantId = (await createTenantWithDek({ name: `${TAG}-b`, slug: `${TAG}-b` })).id;
        const mk = async (role: 'OWNER' | 'MEMBER' | 'VIEWER' | 'GUEST', n: string) => {
            const u = await prisma.user.create({ data: { email: `${n}-${TAG}@example.test`, name: n } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            return makeRequestContext(role, { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-${n}` });
        };
        owner = await mk('OWNER', 'Olive');
        member = await mk('MEMBER', 'Max');
        viewer = await mk('VIEWER', 'Vic');
        guest = await mk('GUEST', 'Gus');
        mia = await mk('MEMBER', 'Mia');
        const bea = await prisma.user.create({ data: { email: `bea-${TAG}@example.test`, name: 'Bea' } });
        await prisma.tenantMembership.create({ data: { tenantId: otherTenantId, userId: bea.id, role: 'OWNER' } });
        outsider = makeRequestContext('OWNER', { tenantId: otherTenantId, userId: bea.id, tenantSlug: `${TAG}-b` });
        const team = await createTeam(owner, { name: 'Core' });
        projectId = (await createProject(owner, { teamId: team.id, name: 'Support', keyPrefix: 'SUP' })).id;
        otherProjectId = (await createProject(owner, { teamId: team.id, name: 'Ops', keyPrefix: 'OPS' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    const audits = (entityId: string, action: string) => prisma.auditLog.count({ where: { tenantId, entityId, action } });
    const sorted = (...ids: string[]) => [...ids].sort();

    describe('workspace lists', () => {
        it('are created under admin.manage, sanitised and audited; a Member or Viewer is refused', async () => {
            const list = await createRecipientList(owner, null, { name: '  <b>Leads</b>  ', description: 'Team <i>leads</i>', userIds: [member.userId, viewer.userId] });
            expect(list).toMatchObject({ projectId: null, name: 'Leads', description: 'Team leads', archived: false });
            expect(sorted(...list.memberUserIds)).toEqual(sorted(member.userId, viewer.userId));
            expect(await audits(list.id, 'RECIPIENT_LIST_CREATED')).toBe(1);
            await expect(createRecipientList(member, null, { name: 'Mine' })).rejects.toMatchObject({ status: 403 });
            await expect(createRecipientList(viewer, null, { name: 'Mine' })).rejects.toMatchObject({ status: 403 });
            // Anyone who reads projects reads the lists.
            expect((await getRecipientList(viewer, null, list.id)).name).toBe('Leads');
        });

        it('keep one name per scope, and take only active members', async () => {
            await expect(createRecipientList(owner, null, { name: 'Leads' })).rejects.toMatchObject({ status: 409, details: { reason: 'RECIPIENT_LIST_NAME_TAKEN' } });
            const gone = await prisma.user.create({ data: { email: `off-${TAG}@example.test`, name: 'Off' } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: gone.id, role: 'MEMBER', status: 'DEACTIVATED' } });
            await expect(createRecipientList(owner, null, { name: 'Off', userIds: [gone.id] })).rejects.toMatchObject({ status: 400 });
            await expect(createRecipientList(owner, null, { name: 'Off', userIds: [outsider.userId] })).rejects.toMatchObject({ status: 400 });
            // The same name is free in a project's scope.
            await expect(createRecipientList(owner, projectId, { name: 'Leads' })).resolves.toMatchObject({ projectId, name: 'Leads' });
        });

        it('are renamed, and their people set and changed, each audited by ids', async () => {
            const list = await createRecipientList(owner, null, { name: 'Reviewers' });
            const renamed = await updateRecipientList(owner, null, list.id, { name: 'Release reviewers', description: 'Who signs off' });
            expect(renamed).toMatchObject({ name: 'Release reviewers', description: 'Who signs off' });
            await expect(updateRecipientList(owner, null, list.id, { name: 'Leads' })).rejects.toMatchObject({ status: 409 });
            const set = await setRecipientListMembers(owner, null, list.id, [member.userId, mia.userId]);
            expect(sorted(...set.memberUserIds)).toEqual(sorted(member.userId, mia.userId));
            const changed = await changeRecipientListMembers(owner, null, list.id, { add: [owner.userId], remove: [member.userId] });
            expect(sorted(...changed.memberUserIds)).toEqual(sorted(mia.userId, owner.userId));
            const entries = await prisma.auditLog.findMany({ where: { tenantId, entityId: list.id, action: 'RECIPIENT_LIST_MEMBERS_CHANGED' }, orderBy: { createdAt: 'asc' } });
            expect(entries).toHaveLength(2);
            expect(entries[1]!.detailsJson).toMatchObject({ category: 'entity_lifecycle', entityName: 'RecipientListMember' });
            expect(await audits(list.id, 'RECIPIENT_LIST_UPDATED')).toBe(1);
            // A change that changes nothing writes nothing.
            await changeRecipientListMembers(owner, null, list.id, { add: [owner.userId] });
            expect(await audits(list.id, 'RECIPIENT_LIST_MEMBERS_CHANGED')).toBe(2);
            await expect(changeRecipientListMembers(owner, null, list.id, { add: [mia.userId], remove: [mia.userId] })).rejects.toMatchObject({ status: 400 });
        });

        it('are archived and restored, never deleted; an archived list is read-only', async () => {
            const list = await createRecipientList(owner, null, { name: 'Old', userIds: [mia.userId] });
            const archived = await archiveRecipientList(owner, null, list.id);
            expect(archived.archived).toBe(true);
            await expect(updateRecipientList(owner, null, list.id, { name: 'Older' })).rejects.toMatchObject({ status: 409, details: { reason: 'RECIPIENT_LIST_ARCHIVED' } });
            await expect(changeRecipientListMembers(owner, null, list.id, { add: [member.userId] })).rejects.toMatchObject({ status: 409 });
            expect((await listRecipientLists(owner)).map((l) => l.id)).not.toContain(list.id);
            expect((await listRecipientLists(owner, { includeArchived: true })).map((l) => l.id)).toContain(list.id);
            expect((await restoreRecipientList(owner, null, list.id)).archived).toBe(false);
            expect(await audits(list.id, 'RECIPIENT_LIST_ARCHIVED')).toBe(1);
            expect(await audits(list.id, 'RECIPIENT_LIST_RESTORED')).toBe(1);
            // app_user holds no DELETE on lists.
            await expect(runInTenantContext(owner, (db) => db.recipientList.deleteMany({ where: { id: list.id } }))).rejects.toThrow(/permission denied/);
        });
    });

    describe("a project's lists", () => {
        it('are managed under projects.edit (a Member), not by a Viewer, and only in their own scope', async () => {
            const list = await createRecipientList(member, projectId, { name: 'Support desk', userIds: [mia.userId] });
            expect(list.projectId).toBe(projectId);
            await expect(createRecipientList(viewer, projectId, { name: 'Nope' })).rejects.toMatchObject({ status: 403 });
            // Named under another scope, the list is not found.
            await expect(getRecipientList(owner, otherProjectId, list.id)).rejects.toMatchObject({ status: 404 });
            await expect(getRecipientList(owner, null, list.id)).rejects.toMatchObject({ status: 404 });
            await expect(archiveRecipientList(owner, otherProjectId, list.id)).rejects.toMatchObject({ status: 404 });
            expect((await listProjectRecipientLists(viewer, projectId)).map((l) => l.name)).toContain('Support desk');
        });

        it('the lists usable on a project are the workspace\'s and its own, live only', async () => {
            const ops = await createRecipientList(owner, otherProjectId, { name: 'Ops only' });
            const usable = (await listRecipientLists(viewer, { projectId })).map((l) => l.name);
            expect(usable).toEqual(expect.arrayContaining(['Leads', 'Support desk']));
            expect(usable).not.toContain('Ops only');
            const everywhere = (await listRecipientLists(owner, { usable: true })).map((l) => l.id);
            expect(everywhere).toContain(ops.id);
        });

        it("an archived project's lists are read-only", async () => {
            const team = (await prisma.team.findFirst({ where: { tenantId } }))!;
            const p = await createProject(owner, { teamId: team.id, name: 'Frozen', keyPrefix: 'FRZ' });
            const list = await createRecipientList(owner, p.id, { name: 'Frozen list' });
            await setProjectArchived(owner, p.id, true);
            await expect(changeRecipientListMembers(owner, p.id, list.id, { add: [mia.userId] })).rejects.toMatchObject({ status: 409, details: { reason: 'PROJECT_ARCHIVED' } });
            expect((await listProjectRecipientLists(owner, p.id)).map((l) => l.id)).toEqual([list.id]);
        });
    });

    describe('added to an item\'s watchers (decision 139)', () => {
        it('copies the people who can see the item; the rest are skipped and nobody is notified', async () => {
            const off = await prisma.user.create({ data: { email: `later-${TAG}@example.test`, name: 'Later' } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: off.id, role: 'MEMBER' } });
            const list = await createRecipientList(owner, projectId, {
                name: 'Watchers',
                userIds: [member.userId, viewer.userId, guest.userId, mia.userId, off.id],
            });
            await prisma.tenantMembership.update({ where: { tenantId_userId: { tenantId, userId: off.id } }, data: { status: 'DEACTIVATED' } });
            const item = await createWorkItem(owner, { projectId, typeId, title: 'Launch' });
            await watchWorkItem(mia, item.id);
            const before = await prisma.notification.count({ where: { tenantId } });

            const result = await addRecipientListAsWatchers(owner, item.id, list.id);
            expect(sorted(...result.added)).toEqual(sorted(member.userId, viewer.userId));
            expect(result.alreadyWatching).toEqual([mia.userId]);
            expect(result.skipped).toBe(2);
            const watchers = (await listWatchers(owner, item.id)).map((w) => w.userId);
            expect(watchers).toEqual(expect.arrayContaining([member.userId, viewer.userId, mia.userId]));
            expect(watchers).not.toContain(guest.userId);
            expect(watchers).not.toContain(off.id);
            expect(await audits(item.id, 'WORK_ITEM_WATCHERS_ADDED_FROM_LIST')).toBe(1);
            expect(await prisma.notification.count({ where: { tenantId } })).toBe(before);

            // A copy: each person stops watching on their own, and the list is unchanged.
            await unwatchWorkItem(viewer, item.id);
            expect((await listWatchers(owner, item.id)).map((w) => w.userId)).not.toContain(viewer.userId);
            expect((await getRecipientList(owner, projectId, list.id)).memberUserIds).toContain(viewer.userId);
            // Adding it again adds the person back, and writes one more entry.
            expect((await addRecipientListAsWatchers(member, item.id, list.id)).added).toEqual([viewer.userId]);
            // Nothing new to add: no entry.
            expect((await addRecipientListAsWatchers(member, item.id, list.id)).added).toEqual([]);
            expect(await audits(item.id, 'WORK_ITEM_WATCHERS_ADDED_FROM_LIST')).toBe(2);
        });

        it("refuses another project's list, an archived list and a Viewer", async () => {
            const item = await createWorkItem(owner, { projectId, typeId, title: 'Elsewhere' });
            const ops = await createRecipientList(owner, otherProjectId, { name: 'Ops watchers', userIds: [member.userId] });
            await expect(addRecipientListAsWatchers(owner, item.id, ops.id)).rejects.toMatchObject({ status: 400 });
            const old = await createRecipientList(owner, null, { name: 'Archived watchers', userIds: [member.userId] });
            await archiveRecipientList(owner, null, old.id);
            await expect(addRecipientListAsWatchers(owner, item.id, old.id)).rejects.toMatchObject({ status: 409 });
            await expect(addRecipientListAsWatchers(viewer, item.id, ops.id)).rejects.toMatchObject({ status: 403 });
        });
    });

    describe("a project's intake (decision 142)", () => {
        let formId = '';
        let listId = '';
        const bellsFor = async (requestTitle: string) =>
            (await prisma.notification.findMany({ where: { tenantId, type: 'INTAKE_REQUEST_RECEIVED', body: { contains: requestTitle } }, select: { userId: true } }))
                .map((n) => n.userId)
                .sort();

        beforeAll(async () => {
            const list = await createRecipientList(owner, projectId, { name: 'Intake desk', userIds: [owner.userId, mia.userId, viewer.userId, member.userId] });
            listId = list.id;
            formId = (await createIntakeForm(owner, { projectId, name: 'Ask', definition: { fields: [] } })).id;
        });

        it('names a live list of the workspace or the project, and nothing else', async () => {
            const ops = await createRecipientList(owner, otherProjectId, { name: 'Ops intake' });
            await expect(setProjectIntake(owner, projectId, { enabled: true, recipientListId: ops.id })).rejects.toMatchObject({ status: 400 });
            const old = await createRecipientList(owner, null, { name: 'Old intake' });
            await archiveRecipientList(owner, null, old.id);
            await expect(setProjectIntake(owner, projectId, { enabled: true, recipientListId: old.id })).rejects.toMatchObject({ status: 400 });
            const s = await setProjectIntake(owner, projectId, { enabled: true, notifyUserIds: [owner.userId], recipientListId: listId });
            expect(s.recipientListId).toBe(listId);
            expect((await listProjectIntakeSettings(owner)).find((p) => p.projectId === projectId)?.recipientListId).toBe(listId);
            const entry = await prisma.auditLog.findFirst({ where: { tenantId, action: 'PROJECT_INTAKE_UPDATED' }, orderBy: { createdAt: 'desc' } });
            expect(entry?.detailsJson).toMatchObject({ changedFields: expect.arrayContaining(['recipientListId']) });
        });

        it('rings the union once each, only intake readers, never the sender', async () => {
            await sendIntakeRequest(member, formId, { title: 'Union please', answers: {} });
            // owner on both: once; mia from the list; viewer holds no intake.view; member sent it.
            expect(await bellsFor('Union please')).toEqual(sorted(owner.userId, mia.userId));
        });

        it('an archived list rings nobody until it is restored', async () => {
            await archiveRecipientList(owner, projectId, listId);
            await sendIntakeRequest(member, formId, { title: 'While archived', answers: {} });
            expect(await bellsFor('While archived')).toEqual([owner.userId]);
            await restoreRecipientList(owner, projectId, listId);
            await sendIntakeRequest(member, formId, { title: 'After restore', answers: {} });
            expect(await bellsFor('After restore')).toEqual(sorted(owner.userId, mia.userId));
        });

        it('clearing the list leaves the member rows', async () => {
            const s = await setProjectIntake(owner, projectId, { enabled: true, recipientListId: null });
            expect(s).toMatchObject({ recipientListId: null, notifyUserIds: [owner.userId] });
        });
    });

    describe('send-time checks', () => {
        it('a removed workspace resolves to nobody', async () => {
            const list = await createRecipientList(owner, null, { name: 'Live check', userIds: [mia.userId] });
            const resolve = () => runInTenantContext(owner, (db) => resolveListRecipients(db, tenantId, { listIds: [list.id], projectId, may: () => true }));
            expect((await resolve()).userIds).toEqual([mia.userId]);
            await prisma.tenant.update({ where: { id: tenantId }, data: { deletedAt: new Date() } });
            try {
                expect((await resolve()).userIds).toEqual([]);
            } finally {
                await prisma.tenant.update({ where: { id: tenantId }, data: { deletedAt: null } });
            }
        });

        it('a removed member leaves every list', async () => {
            const gone = await prisma.user.create({ data: { email: `gone-${TAG}@example.test`, name: 'Gone' } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: gone.id, role: 'MEMBER' } });
            const a = await createRecipientList(owner, null, { name: 'Gone A', userIds: [gone.id, mia.userId] });
            const b = await createRecipientList(owner, projectId, { name: 'Gone B', userIds: [gone.id] });
            await prisma.tenantMembership.delete({ where: { tenantId_userId: { tenantId, userId: gone.id } } });
            expect((await getRecipientList(owner, null, a.id)).memberUserIds).toEqual([mia.userId]);
            expect((await getRecipientList(owner, projectId, b.id)).memberUserIds).toEqual([]);
        });

        it('the audit chain verifies', async () => {
            expect((await verifyAuditChain(tenantId, prisma)).valid).toBe(true);
        });
    });

    describe('two-tenant isolation as app_user', () => {
        let listId = '';
        beforeAll(async () => {
            listId = (await createRecipientList(owner, null, { name: 'Isolated', userIds: [member.userId] })).id;
        });
        const snapshotA = async () => ({
            lists: await prisma.recipientList.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
            members: await prisma.recipientListMember.findMany({ where: { tenantId }, orderBy: [{ listId: 'asc' }, { userId: 'asc' }] }),
        });

        it("B reads and counts none of A's rows", async () => {
            expect(await runInTenantContext(outsider, (db) => db.recipientList.count({}))).toBe(0);
            expect(await runInTenantContext(outsider, (db) => db.recipientListMember.count({}))).toBe(0);
            expect(await runInTenantContext(outsider, (db) => db.recipientList.findMany({ where: { tenantId } }))).toEqual([]);
            expect(await runInTenantContext(owner, (db) => db.recipientListMember.count({ where: { listId } }))).toBe(1);
            await expect(listRecipientLists(outsider)).resolves.toEqual([]);
            await expect(getRecipientList(outsider, null, listId)).rejects.toMatchObject({ status: 404 });
        });

        it("B changes or removes none of A's rows and cannot create one in A", async () => {
            const before = await snapshotA();
            const updated = await runInTenantContext(outsider, (db) => db.recipientList.updateMany({ where: { tenantId }, data: { name: 'Hijacked' } }));
            expect(updated.count).toBe(0);
            const deleted = await runInTenantContext(outsider, (db) => db.recipientListMember.deleteMany({ where: { tenantId } }));
            expect(deleted.count).toBe(0);
            expect(await snapshotA()).toEqual(before);
            await expect(
                runInTenantContext(outsider, (db) => db.recipientList.create({ data: { tenantId, name: 'Planted', createdById: outsider.userId } })),
            ).rejects.toThrow();
            await expect(
                runInTenantContext(outsider, (db) => db.recipientListMember.create({ data: { tenantId, listId, userId: mia.userId, addedById: outsider.userId } })),
            ).rejects.toThrow();
        });
    });
});
