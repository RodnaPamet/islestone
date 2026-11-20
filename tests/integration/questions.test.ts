/**
 * Questions and the marked answer against a real Postgres, as `app_user`
 * (sub-phase 2.4b-c; docs/porting/maps/2.4b.md; ADR 0002 §15; owner
 * decisions 113 to 118):
 *
 *   - what migration `20261202120000_answers` adds: the composite FK refusing
 *     another item's comment, and the trigger refusing a soft delete of the
 *     marked comment (while a re-wrap of its text passes);
 *   - "Add the Question type": the type and its field set in one go, under
 *     `admin.manage`, a taken name refused; nothing seeded;
 *   - the creator of an item whose type shows the answer watches it;
 *   - marking: a person under `work_items.edit` only (an API key and a viewer
 *     refused), where the field set shows the answer; an open item moves to
 *     the team's first live Done state or the one chosen, waiting on cleared,
 *     one transition, audited, watchers told; a closed item keeps its state;
 *   - clearing keeps the state; the marked comment is locked for edit and
 *     delete, an admin moderates by clearing then deleting;
 *   - an answered item is purged with its comments; the chain verifies.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { addDays, dayKey } from '@/app-layer/domain/cycle';
import { todayInTz } from '@/app-layer/notifications/work-item-due';
import { setTypeField } from '@/app-layer/usecases/field-set';
import { createProject } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { createWorkItem, getWorkItem, setWorkItemState } from '@/app-layer/usecases/work-item';
import { clearWorkItemAnswer, markWorkItemAnswer } from '@/app-layer/usecases/work-item-answer';
import { addComment, addWatcher, deleteComment, editComment } from '@/app-layer/usecases/work-item-collab';
import { addQuestionType, createWorkItemType } from '@/app-layer/usecases/work-item-type';
import { createWorkflowState } from '@/app-layer/usecases/workflow-state';
import { verifyAuditChain } from '@/lib/audit';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `qna${Date.now().toString(36)}`;

describeFn('questions and the marked answer', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let member: RequestContext;
    let viewer: RequestContext;
    let teamId = '';
    let projectId = '';
    let doneStateId = '';
    let cancelledStateId = '';
    let questionTypeId = '';
    let plainTypeId = '';
    let today: Date;
    const savedTz = process.env.NOTIFICATIONS_TZ;
    const k = (n: number) => dayKey(addDays(today, n));

    beforeAll(async () => {
        process.env.NOTIFICATIONS_TZ = 'UTC';
        today = todayInTz(new Date(), 'UTC');
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const mk = async (role: 'OWNER' | 'MEMBER' | 'VIEWER', name: string) => {
            const u = await prisma.user.create({ data: { email: `${name}-${TAG}@example.test`, name } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            return makeRequestContext(role, { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-${name}` });
        };
        owner = await mk('OWNER', 'olive');
        member = await mk('MEMBER', 'max');
        viewer = await mk('VIEWER', 'vic');
        const team = await createTeam(owner, { name: 'Core' });
        teamId = team.id;
        doneStateId = team.workflowStates.find((s) => s.category === 'DONE')!.id;
        cancelledStateId = team.workflowStates.find((s) => s.category === 'CANCELLED')!.id;
        projectId = (await createProject(owner, { teamId, name: 'Questions', keyPrefix: 'QNA' })).id;
        plainTypeId = (await createWorkItemType(owner, { name: `Plain ${TAG}` })).id;
    });

    afterAll(async () => {
        process.env.NOTIFICATIONS_TZ = savedTz;
        await resetDatabase(prisma);
    });

    /** An open question by `member`, with a comment by `member` and one by `owner`. */
    const askQuestion = async (title: string) => {
        const item = await createWorkItem(member, { projectId, typeId: questionTypeId, title, dueDate: k(5), waitingOnUserId: owner.userId });
        const mine = await addComment(member, item.id, { body: 'What is the deadline?' });
        const reply = await addComment(owner, item.id, { body: 'Friday, end of day.' });
        return { item, mine, reply };
    };

    describe('Add the Question type (decision 116)', () => {
        it('makes the type and its field set under admin.manage; nothing is seeded; a taken name is refused', async () => {
            expect(await prisma.workItemType.count({ where: { tenantId, name: 'Question' } })).toBe(0);
            await expect(addQuestionType(member)).rejects.toMatchObject({ status: 403 });
            const type = await addQuestionType(owner);
            questionTypeId = type.id;
            expect(type.name).toBe('Question');
            const rows = await prisma.workItemTypeField.findMany({ where: { tenantId, typeId: type.id }, orderBy: { builtInField: 'asc' } });
            expect(rows.map((r) => [r.builtInField, r.requirement])).toEqual([
                ['answer', 'OPTIONAL'],
                ['dueDate', 'REQUIRED'],
                ['waitingOn', 'REQUIRED'],
            ]);
            await expect(addQuestionType(owner)).rejects.toMatchObject({ status: 409, details: { reason: 'TYPE_NAME_TAKEN' } });
            await expect(addQuestionType(owner, { name: 'Support question' })).resolves.toMatchObject({ name: 'Support question' });
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'WORK_ITEM_TYPE_FIELD_SET', entityId: type.id } })).toBe(3);
        });

        it('its items need a due date and someone they wait on', async () => {
            await expect(createWorkItem(member, { projectId, typeId: questionTypeId, title: 'bare' })).rejects.toMatchObject({
                status: 400,
                details: { reason: 'FIELD_SET_UNMET', fields: ['waitingOn', 'dueDate'] },
            });
        });
    });

    describe('the creator watches (decision 117)', () => {
        it('when the type shows the answer, and not otherwise', async () => {
            const { item } = await askQuestion('who watches');
            expect(await prisma.workItemWatcher.count({ where: { tenantId, workItemId: item.id, userId: member.userId } })).toBe(1);
            const plain = await createWorkItem(member, { projectId, typeId: plainTypeId, title: 'plain' });
            expect(await prisma.workItemWatcher.count({ where: { tenantId, workItemId: plain.id } })).toBe(0);
            const created = await prisma.auditLog.findFirst({ where: { tenantId, action: 'WORK_ITEM_CREATED', entityId: item.id } });
            expect(JSON.stringify(created?.metadataJson)).toContain('creatorWatching');
        });
    });

    describe('marking', () => {
        it("moves an open item to the team's first Done state, clears waiting on, records one transition, audits, and tells the watchers", async () => {
            const { item, reply } = await askQuestion('when is it due');
            expect(item.waitingOnUserId).toBe(owner.userId);
            const before = await prisma.workItemTransition.count({ where: { tenantId, workItemId: item.id } });
            const marked = await markWorkItemAnswer(owner, item.id, { commentId: reply.id }, item.version);
            expect(marked).toMatchObject({ answerCommentId: reply.id, stateId: doneStateId, stateCategory: 'DONE', waitingOnUserId: null });
            expect(marked.answer).toMatchObject({ id: reply.id, body: 'Friday, end of day.', authorUserId: owner.userId });
            expect(marked.version).toBe(item.version + 1);
            expect(await prisma.workItemTransition.count({ where: { tenantId, workItemId: item.id } })).toBe(before + 1);
            const actions = (await prisma.auditLog.findMany({ where: { tenantId, entityId: item.id }, orderBy: { createdAt: 'asc' }, select: { action: true } })).map((a) => a.action);
            expect(actions.slice(-2)).toEqual(['WORK_ITEM_ANSWER_MARKED', 'WORK_ITEM_STATE_CHANGED']);
            const bells = await prisma.notification.findMany({ where: { tenantId, userId: member.userId, type: 'WORK_ITEM_WATCH_UPDATE', body: { contains: 'answered' } } });
            expect(bells.length).toBe(1);
            expect(await prisma.notification.count({ where: { tenantId, userId: owner.userId, body: { contains: 'answered' } } })).toBe(0);
        });

        it('moves it to the Done state the person chose when the team has several; refuses one that is not', async () => {
            const released = await createWorkflowState(owner, teamId, { name: `Released ${TAG}`, category: 'DONE' });
            const { item, reply } = await askQuestion('which done');
            await expect(markWorkItemAnswer(owner, item.id, { commentId: reply.id, stateId: cancelledStateId })).rejects.toMatchObject({
                status: 400,
                details: { reason: 'NOT_A_DONE_STATE' },
            });
            await expect(markWorkItemAnswer(owner, item.id, { commentId: reply.id, stateId: released.id })).resolves.toMatchObject({ stateId: released.id });
        });

        it('on a closed item changes only the answer; clearing keeps the state and never reopens (decision 115)', async () => {
            const { item, mine, reply } = await askQuestion('closed already');
            await setWorkItemState(owner, item.id, { stateId: cancelledStateId });
            const marked = await markWorkItemAnswer(member, item.id, { commentId: mine.id });
            expect(marked).toMatchObject({ answerCommentId: mine.id, stateId: cancelledStateId });
            const remarked = await markWorkItemAnswer(member, item.id, { commentId: reply.id });
            expect(remarked).toMatchObject({ answerCommentId: reply.id, stateId: cancelledStateId });
            const cleared = await clearWorkItemAnswer(member, item.id);
            expect(cleared).toMatchObject({ answerCommentId: null, stateId: cancelledStateId, answer: null });
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'WORK_ITEM_ANSWER_CLEARED', entityId: item.id } })).toBe(1);
        });

        it('is a person\'s act: an API key and a viewer are refused', async () => {
            const { item, reply } = await askQuestion('who may mark');
            const key = { ...owner, apiKeyId: 'key-1' } as RequestContext;
            await expect(markWorkItemAnswer(key, item.id, { commentId: reply.id })).rejects.toMatchObject({ status: 403, details: { reason: 'NOT_A_PERSON' } });
            await expect(markWorkItemAnswer(viewer, item.id, { commentId: reply.id })).rejects.toMatchObject({ status: 403 });
            await expect(clearWorkItemAnswer(key, item.id)).rejects.toMatchObject({ status: 403 });
        });

        it("is refused where the field set hides the answer, for another item's comment, and on a stale version", async () => {
            const plain = await createWorkItem(member, { projectId, typeId: plainTypeId, title: 'not a question' });
            const c = await addComment(member, plain.id, { body: 'hello' });
            await expect(markWorkItemAnswer(owner, plain.id, { commentId: c.id })).rejects.toMatchObject({ status: 400, details: { reason: 'FIELD_HIDDEN' } });
            const { item } = await askQuestion('foreign comment');
            await expect(markWorkItemAnswer(owner, item.id, { commentId: c.id })).rejects.toMatchObject({ status: 404 });
            const { reply } = await askQuestion('stale');
            const fresh = await getWorkItem(owner, reply.workItemId);
            await expect(markWorkItemAnswer(owner, fresh.id, { commentId: reply.id }, fresh.version - 1)).rejects.toMatchObject({ status: 409 });
        });

        it('showing the answer on another type makes it question-like: no type identity in code (decision 118)', async () => {
            const typeId = (await createWorkItemType(owner, { name: `Decision ${TAG}` })).id;
            await setTypeField(owner, typeId, { field: 'answer', requirement: 'OPTIONAL' });
            const item = await createWorkItem(member, { projectId, typeId, title: 'pick a vendor' });
            const c = await addComment(owner, item.id, { body: 'Vendor B' });
            await expect(markWorkItemAnswer(member, item.id, { commentId: c.id })).resolves.toMatchObject({ answerCommentId: c.id, stateCategory: 'DONE' });
        });
    });

    describe('the marked comment is locked (decision 113)', () => {
        it('its author cannot edit it and an admin cannot delete it until the answer is cleared; then the admin moderates', async () => {
            const { item, mine } = await askQuestion('locked');
            await markWorkItemAnswer(owner, item.id, { commentId: mine.id });
            await expect(editComment(member, item.id, mine.id, { body: 'changed' })).rejects.toMatchObject({ status: 409, details: { reason: 'ANSWER_LOCKED' } });
            await expect(deleteComment(member, item.id, mine.id)).rejects.toMatchObject({ status: 409, details: { reason: 'ANSWER_LOCKED' } });
            await expect(deleteComment(owner, item.id, mine.id)).rejects.toMatchObject({ status: 409, details: { reason: 'ANSWER_LOCKED' } });
            await clearWorkItemAnswer(owner, item.id);
            await expect(deleteComment(owner, item.id, mine.id)).resolves.toMatchObject({ deleted: true, basis: 'moderation' });
        });

        it("the database refuses another item's comment and a soft delete of the marked comment; a re-wrap of its text passes", async () => {
            const a = await askQuestion('db a');
            const b = await askQuestion('db b');
            await expect(prisma.workItem.update({ where: { id: a.item.id }, data: { answerCommentId: b.reply.id } })).rejects.toThrow();
            await markWorkItemAnswer(owner, a.item.id, { commentId: a.reply.id });
            await expect(prisma.comment.update({ where: { id: a.reply.id }, data: { deletedAt: new Date() } })).rejects.toThrow(/ANSWER_COMMENT_LOCKED/);
            const stored = await prisma.comment.findUniqueOrThrow({ where: { id: a.reply.id }, select: { body: true } });
            await expect(prisma.comment.update({ where: { id: a.reply.id }, data: { body: stored.body } })).resolves.toBeTruthy();
        });
    });

    describe('the purge and the trail', () => {
        it('an answered item is hard-deleted with its comments (the FK is NO ACTION)', async () => {
            const { item, reply } = await askQuestion('purged');
            await addWatcher(owner, item.id, owner.userId);
            await markWorkItemAnswer(owner, item.id, { commentId: reply.id });
            await prisma.workItem.delete({ where: { id: item.id } });
            expect(await prisma.comment.count({ where: { workItemId: item.id } })).toBe(0);
        });

        it('the audit chain verifies', async () => {
            expect((await verifyAuditChain(tenantId)).valid).toBe(true);
        });
    });
});
