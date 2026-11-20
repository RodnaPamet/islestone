/**
 * Mentions against a real Postgres (sub-phase 2.7d; owner decisions 127 to
 * 131):
 *
 *   - `Mention` is a tenant table: as `app_user` in workspace B nothing of
 *     A's is read, changed, removed or created (the two-tenant test
 *     `tests/guards/tenant-isolation-forward-lock.test.ts` names);
 *   - a comment records only ACTIVE members who can see the project
 *     (Viewers included; a GUEST, a deactivated member, another workspace's
 *     person, an unknown id and an agent token are dropped silently), adds
 *     the newly mentioned as watchers (audited `reason: 'mentioned'`), rings
 *     the mention bell and the immediate email to them and never to the
 *     author, and the watcher fan-out of the same comment skips them;
 *   - neither the bell, the email nor any audit entry carries the text;
 *   - an edit notifies only the people it adds and removes the rows of the
 *     people it drops; a deleted comment and a removed member take their rows;
 *   - a description edit, and a person's own create, record the
 *     description's people; an intake accept, whose description is the
 *     requester's text, records nobody (decision 129);
 *   - a member who switched mentions off is still recorded and watching but
 *     gets no bell and no email.
 *
 * Written fresh for Islestone.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { createIntakeForm } from '@/app-layer/usecases/intake-form';
import { acceptIntakeRequest, sendIntakeRequest } from '@/app-layer/usecases/intake-request';
import { setProjectIntake } from '@/app-layer/usecases/intake-settings';
import { createProject } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { createWorkItem, getWorkItem, updateWorkItem } from '@/app-layer/usecases/work-item';
import { addComment, deleteComment, editComment, listComments } from '@/app-layer/usecases/work-item-collab';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { verifyAuditChain } from '@/lib/audit';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `ment${Date.now().toString(36)}`;
const SECRET = 'the launch codes are 0000';

describeFn('mentions', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let otherTenantId = '';
    let owner: RequestContext;
    let member: RequestContext;
    let viewer: RequestContext;
    let guest: RequestContext;
    let mia: RequestContext;
    let inactiveId = '';
    let outsiderId = '';
    let outsider: RequestContext;
    let projectId = '';
    let typeId = '';

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        otherTenantId = (await createTenantWithDek({ name: `${TAG}-b`, slug: `${TAG}-b` })).id;
        const mk = async (role: 'OWNER' | 'MEMBER' | 'VIEWER' | 'GUEST', n: string, status: 'ACTIVE' | 'DEACTIVATED' = 'ACTIVE') => {
            const u = await prisma.user.create({ data: { email: `${n}-${TAG}@example.test`, name: n } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role, status } });
            return makeRequestContext(role, { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-${n}` });
        };
        owner = await mk('OWNER', 'Olive');
        member = await mk('MEMBER', 'Max');
        viewer = await mk('VIEWER', 'Vic');
        guest = await mk('GUEST', 'Gus');
        mia = await mk('MEMBER', 'Mia');
        inactiveId = (await mk('MEMBER', 'Ina', 'DEACTIVATED')).userId;
        const bea = await prisma.user.create({ data: { email: `bea-${TAG}@example.test`, name: 'Bea' } });
        outsiderId = bea.id;
        await prisma.tenantMembership.create({ data: { tenantId: otherTenantId, userId: bea.id, role: 'OWNER' } });
        outsider = makeRequestContext('OWNER', { tenantId: otherTenantId, userId: bea.id, tenantSlug: `${TAG}-b` });
        const team = await createTeam(owner, { name: 'Core' });
        projectId = (await createProject(owner, { teamId: team.id, name: 'Support', keyPrefix: 'SUP' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    const newItem = (title: string) => createWorkItem(owner, { projectId, typeId, title });
    const mentionRows = (where: { workItemId?: string; commentId?: string | null }) =>
        prisma.mention.findMany({ where: { tenantId, ...where }, orderBy: { mentionedUserId: 'asc' }, select: { mentionedUserId: true, commentId: true, mentionedById: true } });
    const bells = (workItemId: string, type: 'WORK_ITEM_MENTIONED' | 'WORK_ITEM_WATCH_UPDATE' = 'WORK_ITEM_MENTIONED') =>
        prisma.notification.findMany({ where: { tenantId, workItemId, type }, orderBy: { userId: 'asc' } });
    const mails = () => prisma.notificationOutbox.findMany({ where: { tenantId, type: 'WORK_ITEM_MENTIONED' } });
    const sorted = (...ids: string[]) => [...ids].sort();

    describe('a comment', () => {
        let itemId = '';
        let commentId = '';

        beforeAll(async () => {
            itemId = (await newItem('Ship the release')).id;
            await prisma.notificationOutbox.deleteMany({});
            const body = [
                `<@${member.userId}> <@${viewer.userId}> please check.`,
                `<@${guest.userId}> <@${inactiveId}> <@${outsiderId}> <@nobody> <@agent:reviewer>`,
                `Me: <@${owner.userId}>. ${SECRET}`,
            ].join(' ');
            const created = await addComment(owner, itemId, { body });
            commentId = created.id;
            expect(sorted(...created.mentions)).toEqual(sorted(member.userId, viewer.userId, owner.userId));
        });

        it('records only active members who can see the project (the author included), and drops the rest silently', async () => {
            expect((await mentionRows({ commentId })).map((r) => r.mentionedUserId)).toEqual(sorted(member.userId, viewer.userId, owner.userId));
            expect((await mentionRows({ commentId }))[0]!.mentionedById).toBe(owner.userId);
            const page = await listComments(owner, itemId);
            expect(sorted(...page.items[0]!.mentions)).toEqual(sorted(member.userId, viewer.userId, owner.userId));
        });

        it('rings the newly mentioned, never the author, with who and which item but never the text', async () => {
            const rows = await bells(itemId);
            expect(rows.map((r) => r.userId)).toEqual(sorted(member.userId, viewer.userId));
            for (const r of rows) {
                expect(r.body).toBe('Olive mentioned you in a comment on SUP-1 "Ship the release".');
                expect(`${r.title} ${r.body}`).not.toContain('launch');
                expect(r.linkUrl).toBe(`/t/${TAG}/work-items/${itemId}`);
            }
        });

        it('mails them at once by default, without the text', async () => {
            const sent = await mails();
            expect(sent).toHaveLength(2);
            for (const m of sent) {
                expect(m.subject).toBe('Mentioned on [SUP-1] Ship the release');
                expect(`${m.bodyText} ${m.bodyHtml}`).not.toContain('launch');
            }
        });

        it('adds them as watchers, audited as mentioned, and the comment\'s watcher bell skips them', async () => {
            const watchers = await prisma.workItemWatcher.findMany({ where: { workItemId: itemId }, select: { userId: true } });
            expect(watchers.map((w) => w.userId).sort()).toEqual(sorted(member.userId, viewer.userId));
            const added = await prisma.auditLog.findMany({ where: { tenantId, entityId: itemId, action: 'WORK_ITEM_WATCHER_ADDED' } });
            expect(added).toHaveLength(2);
            for (const a of added) expect(a.metadataJson).toMatchObject({ reason: 'mentioned' });
            expect(await bells(itemId, 'WORK_ITEM_WATCH_UPDATE')).toEqual([]);
        });

        it('audits the mention by people, never by text', async () => {
            const entries = await prisma.auditLog.findMany({ where: { tenantId, entityId: itemId, action: 'WORK_ITEM_MENTIONED' } });
            expect(entries).toHaveLength(1);
            expect(entries[0]!.metadataJson).toMatchObject({ commentId });
            expect(JSON.stringify(entries)).not.toContain('launch');
            expect((await verifyAuditChain(tenantId, prisma)).valid).toBe(true);
        });

        it('an edit notifies only the people it adds, and removes the rows of those it drops', async () => {
            await editComment(owner, itemId, commentId, { body: `<@${member.userId}> and now <@${mia.userId}>` });
            expect((await mentionRows({ commentId })).map((r) => r.mentionedUserId)).toEqual(sorted(member.userId, mia.userId));
            expect((await bells(itemId)).map((r) => r.userId)).toEqual(sorted(member.userId, viewer.userId, mia.userId));
            expect(await prisma.auditLog.count({ where: { tenantId, entityId: itemId, action: 'WORK_ITEM_MENTIONS_REMOVED' } })).toBe(1);
            // The same text again changes nothing.
            await editComment(owner, itemId, commentId, { body: `<@${member.userId}> and now <@${mia.userId}>` });
            expect(await prisma.auditLog.count({ where: { tenantId, entityId: itemId, action: 'WORK_ITEM_MENTIONED' } })).toBe(2);
        });

        it('a deleted comment mentions nobody', async () => {
            await deleteComment(owner, itemId, commentId);
            expect(await mentionRows({ commentId })).toEqual([]);
        });
    });

    describe('descriptions', () => {
        it('an edit records and rings the description\'s people once', async () => {
            const item = await newItem('Write the notes');
            const v1 = await updateWorkItem(owner, item.id, { description: `Over to <@${member.userId}>` }, item.version);
            expect(v1.descriptionMentions).toEqual([member.userId]);
            expect((await mentionRows({ workItemId: item.id, commentId: null })).map((r) => r.mentionedUserId)).toEqual([member.userId]);
            expect((await bells(item.id)).map((r) => r.body)).toEqual(['Olive mentioned you in the description of SUP-' + v1.number + ' "Write the notes".']);
            await updateWorkItem(owner, item.id, { description: `Over to <@${member.userId}>, thanks` }, v1.version);
            expect(await prisma.auditLog.count({ where: { tenantId, entityId: item.id, action: 'WORK_ITEM_MENTIONED' } })).toBe(1);
            expect((await getWorkItem(owner, item.id)).descriptionMentions).toEqual([member.userId]);
        });

        it('a person\'s own create records the description\'s people', async () => {
            const item = await createWorkItem(member, { projectId, typeId, title: 'Review', description: `For <@${owner.userId}>` });
            expect((await getWorkItem(owner, item.id)).descriptionMentions).toEqual([owner.userId]);
            expect((await bells(item.id)).map((r) => r.userId)).toEqual([owner.userId]);
        });

        it('an intake accept records nobody from the requester\'s text (decision 129)', async () => {
            await setProjectIntake(owner, projectId, { enabled: true, notifyUserIds: [] });
            const form = await createIntakeForm(owner, { projectId, name: 'Ask', definition: { fields: [] } });
            const sent = await sendIntakeRequest(member, form.id, { title: 'Please', body: `Ping <@${owner.userId}> <@${viewer.userId}>`, answers: {} });
            const accepted = await acceptIntakeRequest(owner, sent.id, { typeId }, sent.version);
            const itemId = accepted.workItemId!;
            const item = await getWorkItem(owner, itemId);
            expect(item.description).toContain(`<@${viewer.userId}>`);
            expect(item.descriptionMentions).toEqual([]);
            expect(await bells(itemId)).toEqual([]);
        });
    });

    describe('preferences and membership', () => {
        it('a member who switched mentions off is recorded and watching, but rung and mailed nothing', async () => {
            await prisma.notificationPreference.create({ data: { tenantId, userId: mia.userId, type: 'WORK_ITEM_MENTIONED', inApp: false, emailDelivery: 'OFF' } });
            await prisma.notificationOutbox.deleteMany({});
            const item = await newItem('Quiet one');
            await addComment(owner, item.id, { body: `<@${mia.userId}>` });
            expect((await mentionRows({ workItemId: item.id })).map((r) => r.mentionedUserId)).toEqual([mia.userId]);
            expect(await prisma.workItemWatcher.count({ where: { workItemId: item.id, userId: mia.userId } })).toBe(1);
            expect(await bells(item.id)).toEqual([]);
            expect(await mails()).toEqual([]);
        });

        it('a removed member\'s mentions go with the membership', async () => {
            const gone = await prisma.user.create({ data: { email: `gone-${TAG}@example.test`, name: 'Gone' } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: gone.id, role: 'MEMBER' } });
            const item = await newItem('Leaving');
            await addComment(owner, item.id, { body: `<@${gone.id}>` });
            expect(await mentionRows({ workItemId: item.id })).toHaveLength(1);
            await prisma.workItemWatcher.deleteMany({ where: { userId: gone.id } });
            await prisma.tenantMembership.delete({ where: { tenantId_userId: { tenantId, userId: gone.id } } });
            expect(await mentionRows({ workItemId: item.id })).toEqual([]);
        });
    });

    describe('two-tenant isolation as app_user', () => {
        let itemId = '';
        beforeAll(async () => {
            itemId = (await newItem('Isolated')).id;
            await addComment(owner, itemId, { body: `<@${member.userId}>` });
        });
        const snapshotA = () => prisma.mention.findMany({ where: { tenantId }, orderBy: { id: 'asc' } });

        it('B reads and counts none of A\'s rows', async () => {
            expect(await runInTenantContext(outsider, (db) => db.mention.count({}))).toBe(0);
            expect(await runInTenantContext(outsider, (db) => db.mention.findMany({ where: { tenantId } }))).toEqual([]);
            expect(await runInTenantContext(owner, (db) => db.mention.count({ where: { workItemId: itemId } }))).toBe(1);
        });

        it('B removes none of A\'s rows and cannot create one in A', async () => {
            const before = await snapshotA();
            const deleted = await runInTenantContext(outsider, (db) => db.mention.deleteMany({ where: { tenantId } }));
            expect(deleted.count).toBe(0);
            expect(await snapshotA()).toEqual(before);
            await expect(
                runInTenantContext(outsider, (db) =>
                    db.mention.create({ data: { tenantId, workItemId: itemId, mentionedUserId: member.userId, mentionedById: outsider.userId } }),
                ),
            ).rejects.toThrow();
        });

        it('one row per source and person', async () => {
            await expect(
                prisma.mention.create({ data: { tenantId, workItemId: itemId, commentId: null, mentionedUserId: viewer.userId, mentionedById: owner.userId } }),
            ).resolves.toBeDefined();
            await expect(
                prisma.mention.create({ data: { tenantId, workItemId: itemId, commentId: null, mentionedUserId: viewer.userId, mentionedById: owner.userId } }),
            ).rejects.toThrow(/Mention_one_per_description_person|Unique constraint/);
        });
    });
});
