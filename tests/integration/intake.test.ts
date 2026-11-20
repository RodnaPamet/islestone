/**
 * Intake against a real Postgres, as `app_user` (sub-phase 2.6a;
 * docs/porting/maps/2.6.md; owner decisions 85 to 99):
 *
 *   - project intake and the notify list (the first switch-on puts its
 *     author on the list; only active members);
 *   - forms: sanitised definitions, a mapped custom field of the right type,
 *     versioned edits (428, 409), publish and archive, and the open-form rule;
 *   - sending a request through an internal form: the form's own schema, the
 *     sanitised and encrypted text, the audit entry, the notify bell (never
 *     to the sender, never to a member without `intake.view`);
 *   - accept: one transaction creating the item (key, mapped field, the
 *     answers that fill nothing appended, the requester watching), and two
 *     concurrent accepts make ONE item;
 *   - decline, merge (into an item, into a request with re-pointing, refused
 *     into a merged one or itself), snooze (date after today), move (intake
 *     on), edit, reopen (never an accepted one);
 *   - the wake job and the purge job, as the system user;
 *   - who may do what: a MEMBER triages but cannot manage, a VIEWER sends
 *     but cannot read intake, a GUEST sees nothing;
 *   - every write audited without titles or text, and the chain verifies.
 */
import type { PrismaClient } from '@prisma/client';

import { buildTenantSystemJobContext } from '@/app-layer/context-system';
import type { RequestContext } from '@/app-layer/types';
import { createCustomField } from '@/app-layer/usecases/custom-field';
import { createIntakeForm, getOpenIntakeForm, listIntakeForms, listOpenIntakeForms, updateIntakeForm } from '@/app-layer/usecases/intake-form';
import { purgeDecidedRequests, wakeSnoozedRequests } from '@/app-layer/usecases/intake-jobs';
import {
    acceptIntakeRequest,
    countPendingIntake,
    declineIntakeRequest,
    editIntakeRequest,
    getIntakeRequest,
    listIntakeRequests,
    mergeIntakeRequest,
    moveIntakeRequest,
    reopenIntakeRequest,
    sendIntakeRequest,
    snoozeIntakeRequest,
} from '@/app-layer/usecases/intake-request';
import { listProjectIntakeSettings, setProjectIntake } from '@/app-layer/usecases/intake-settings';
import { createProject } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { createWorkItem, getWorkItem } from '@/app-layer/usecases/work-item';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { verifyAuditChain } from '@/lib/audit';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `intk${Date.now().toString(36)}`;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (n: number) => dayKey(new Date(Date.now() + n * 86_400_000));

describeFn('intake', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let member: RequestContext;
    let viewer: RequestContext;
    let guest: RequestContext;
    let projectId = '';
    let otherProjectId = '';
    let quietProjectId = '';
    let typeId = '';
    let stageFieldId = '';
    let formId = '';
    const savedTz = process.env.NOTIFICATIONS_TZ;

    beforeAll(async () => {
        process.env.NOTIFICATIONS_TZ = 'UTC';
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
        projectId = (await createProject(owner, { teamId: team.id, name: 'Support', keyPrefix: 'SUP' })).id;
        otherProjectId = (await createProject(owner, { teamId: team.id, name: 'Platform', keyPrefix: 'PLT' })).id;
        quietProjectId = (await createProject(owner, { teamId: team.id, name: 'Quiet', keyPrefix: 'QUI' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
        stageFieldId = (await createCustomField(owner, projectId, { name: 'Stage', type: 'SELECT', options: [{ name: 'Triage' }, { name: 'Ready' }] })).id;
    });

    afterAll(async () => {
        process.env.NOTIFICATIONS_TZ = savedTz;
        await resetDatabase(prisma);
    });

    const definition = () => ({
        intro: 'Tell us <b>what</b> broke',
        confirmation: 'Thanks!',
        fields: [
            { id: 'f1', kind: 'SELECT', label: 'Stage', required: true, options: ['Triage', 'Ready'], customFieldId: stageFieldId },
            { id: 'f2', kind: 'LONG_TEXT', label: 'Steps <script>x</script>', required: false },
        ],
    });
    const send = (ctx: RequestContext, title = 'Printer on fire', extra: Record<string, unknown> = {}) =>
        sendIntakeRequest(ctx, formId, { title, body: 'It smokes <img src=x onerror=alert(1)>', answers: { f1: 'Ready', f2: 'Press print' }, ...extra });

    describe('settings and forms', () => {
        it('turning intake on puts its author on the notify list; the list takes only active members; a MEMBER cannot manage', async () => {
            const s = await setProjectIntake(owner, projectId, { enabled: true });
            expect(s).toMatchObject({ enabled: true, notifyUserIds: [owner.userId] });
            await expect(setProjectIntake(owner, projectId, { enabled: true, notifyUserIds: ['nobody'] })).rejects.toMatchObject({ status: 400 });
            const s2 = await setProjectIntake(owner, projectId, { enabled: true, notifyUserIds: [owner.userId, member.userId, viewer.userId] });
            expect(s2.notifyUserIds.sort()).toEqual([owner.userId, member.userId, viewer.userId].sort());
            await setProjectIntake(owner, otherProjectId, { enabled: true, notifyUserIds: [] });
            await expect(setProjectIntake(member, projectId, { enabled: false })).rejects.toMatchObject({ status: 403 });
            const listed = await listProjectIntakeSettings(owner);
            expect(listed.find((p) => p.projectId === quietProjectId)).toMatchObject({ enabled: false });
        });

        it('a form is created sanitised and published; a wrong-type mapping and a duplicate name are refused', async () => {
            const form = await createIntakeForm(owner, { projectId, name: 'Bug <i>report</i>', definition: definition() });
            formId = form.id;
            expect(form).toMatchObject({ name: 'Bug report', published: true, access: 'MEMBERS', version: 1, definitionVersion: 1 });
            expect(form.definition.intro).not.toMatch(/<b>/);
            expect(form.definition.fields[1]!.label).not.toMatch(/<script>/);
            await expect(
                createIntakeForm(owner, { projectId, name: 'Wrong', definition: { fields: [{ id: 'f1', kind: 'DATE', label: 'When', required: false, customFieldId: stageFieldId }] } }),
            ).rejects.toMatchObject({ status: 400 });
            await expect(createIntakeForm(owner, { projectId, name: 'bug REPORT', definition: definition() })).rejects.toMatchObject({ status: 409 });
            await expect(createIntakeForm(member, { projectId, name: 'Mine', definition: definition() })).rejects.toMatchObject({ status: 403 });
        });

        it('a definition edit needs If-Match (428), a stale one is a 409, and the definition version increases', async () => {
            await expect(updateIntakeForm(owner, formId, { name: 'Bugs' })).rejects.toMatchObject({ status: 428 });
            await expect(updateIntakeForm(owner, formId, { name: 'Bugs' }, 99)).rejects.toMatchObject({ status: 409, details: { reason: 'VERSION_CONFLICT' } });
            const after = await updateIntakeForm(owner, formId, { name: 'Bugs', definition: definition() }, 1);
            expect(after).toMatchObject({ name: 'Bugs', version: 2, definitionVersion: 1 });
            const changed = await updateIntakeForm(owner, formId, { definition: { ...definition(), confirmation: 'Got it' } }, 2);
            expect(changed.definitionVersion).toBe(2);
        });

        it('an unpublished form is not open; a member lists and opens only open forms; a GUEST sees none', async () => {
            const draft = await createIntakeForm(owner, { projectId, name: 'Draft', definition: definition(), published: false });
            expect((await listOpenIntakeForms(viewer)).map((f) => f.id)).toEqual([formId]);
            await expect(getOpenIntakeForm(viewer, draft.id)).rejects.toMatchObject({ status: 404 });
            await expect(sendIntakeRequest(member, draft.id, { title: 'x', answers: { f1: 'Ready' } })).rejects.toMatchObject({ status: 404 });
            expect(await listOpenIntakeForms(guest)).toEqual([]);
            expect((await listIntakeForms(member)).length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('sending and reading', () => {
        it('a VIEWER sends a request: sanitised, encrypted at rest, audited without text, the notify list rung (not the sender, not a VIEWER)', async () => {
            const row = await send(viewer);
            expect(row).toMatchObject({ status: 'PENDING', channel: 'INTERNAL_FORM', requesterUserId: viewer.userId, formName: 'Bugs' });
            const raw = await prisma.intakeRequest.findUniqueOrThrow({ where: { id: row.id } });
            expect(raw.body).toMatch(/^v[12]:/);
            expect(raw.answersJson).toMatch(/^v[12]:/);
            const detail = await getIntakeRequest(member, row.id);
            expect(detail.body).not.toMatch(/onerror/);
            expect(detail.answers.map((a) => [a.label.replace(/\s+$/, ''), a.value])).toEqual([
                ['Stage', 'Ready'],
                [expect.stringMatching(/^Steps/), 'Press print'],
            ]);
            const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'INTAKE_REQUEST_RECEIVED', entityId: row.id } });
            expect(JSON.stringify(audit)).not.toMatch(/Printer on fire|smokes|Press print/);
            const bells = await prisma.notification.findMany({ where: { tenantId, type: 'INTAKE_REQUEST_RECEIVED' } });
            expect(bells.map((b) => b.userId).sort()).toEqual([owner.userId, member.userId].sort());
            expect(bells[0]!.linkUrl).toBe(`/t/${TAG}/intake?request=${encodeURIComponent(row.id)}`);
        });

        it("the form's schema is the server's: a missing required answer or an unknown key is a 400", async () => {
            await expect(sendIntakeRequest(member, formId, { title: 'x', answers: {} })).rejects.toMatchObject({ status: 400 });
            await expect(sendIntakeRequest(member, formId, { title: 'x', answers: { f1: 'Ready', f9: 'y' } })).rejects.toMatchObject({ status: 400 });
            await expect(sendIntakeRequest(member, formId, { title: '<b></b>', answers: { f1: 'Ready' } })).rejects.toMatchObject({ status: 400 });
        });

        it('lists by view and counts the new ones; a VIEWER and a GUEST cannot read intake', async () => {
            const page = await listIntakeRequests(member, { view: 'new' });
            expect(page.items.length).toBeGreaterThan(0);
            expect((await countPendingIntake(member)).byProject[projectId]).toBeGreaterThan(0);
            await expect(listIntakeRequests(viewer)).rejects.toMatchObject({ status: 403 });
            await expect(listIntakeRequests(guest)).rejects.toMatchObject({ status: 403 });
            expect(await countPendingIntake(viewer)).toEqual({ total: 0, byProject: {} });
        });
    });

    describe('triage', () => {
        it('accept creates the item in one transaction: key, the mapped field, the rest appended, the requester watching, audited', async () => {
            const row = await send(viewer, 'Accept me');
            await expect(acceptIntakeRequest(member, row.id, { typeId })).rejects.toMatchObject({ status: 428 });
            const done = await acceptIntakeRequest(member, row.id, { typeId }, row.version);
            expect(done).toMatchObject({ status: 'ACCEPTED', workItemKey: expect.stringMatching(/^SUP-\d+$/) });
            const item = await getWorkItem(member, done.workItemId!);
            expect(item.title).toBe('Accept me');
            expect(item.description).toMatch(/It smokes/);
            expect(item.description).toMatch(/Steps.*: Press print/);
            const stage = await prisma.customFieldValue.findFirst({ where: { workItemId: item.id, fieldId: stageFieldId }, include: { option: true } });
            expect(stage?.option?.name).toBe('Ready');
            expect(await prisma.workItemWatcher.count({ where: { workItemId: item.id, userId: viewer.userId } })).toBe(1);
            const created = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'WORK_ITEM_CREATED', entityId: item.id } });
            expect(created.metadataJson).toMatchObject({ intakeRequestId: row.id, intakeChannel: 'INTERNAL_FORM' });
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'INTAKE_REQUEST_ACCEPTED', entityId: row.id } })).toBe(1);
            await expect(reopenIntakeRequest(member, row.id, done.version)).rejects.toMatchObject({ status: 409, details: { reason: 'NOT_REOPENABLE' } });
            await expect(declineIntakeRequest(member, row.id, { reason: 'OTHER' }, done.version)).rejects.toMatchObject({ status: 409 });
        });

        it('two concurrent accepts make one item; the other is a 409', async () => {
            const row = await send(member, 'Race');
            const before = await prisma.workItem.count({ where: { tenantId } });
            const results = await Promise.allSettled([
                acceptIntakeRequest(owner, row.id, { typeId }, row.version),
                acceptIntakeRequest(member, row.id, { typeId }, row.version),
            ]);
            expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
            expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
            expect(await prisma.workItem.count({ where: { tenantId } })).toBe(before + 1);
        });

        it('accept refuses a started state; a VIEWER cannot accept', async () => {
            const row = await send(member, 'State');
            const started = await prisma.workflowState.findFirstOrThrow({ where: { tenantId, category: 'STARTED' } });
            await expect(acceptIntakeRequest(member, row.id, { typeId, stateId: started.id }, row.version)).rejects.toMatchObject({ status: 400 });
            await expect(acceptIntakeRequest(viewer, row.id, { typeId }, row.version)).rejects.toMatchObject({ status: 403 });
        });

        it('decline with a reason keeps the explanation (not for spam); reopen brings it back', async () => {
            const row = await send(member, 'Decline me');
            const declined = await declineIntakeRequest(member, row.id, { reason: 'OUT_OF_SCOPE', explanation: 'Not <b>ours</b>', remark: 'internal' }, row.version);
            expect(declined).toMatchObject({ status: 'DECLINED', declineReason: 'OUT_OF_SCOPE', internalRemark: 'internal' });
            expect(declined.declineExplanation).toBe('Not ours');
            const reopened = await reopenIntakeRequest(member, row.id, declined.version);
            expect(reopened).toMatchObject({ status: 'PENDING', declineReason: null, decidedAt: null });
            const spam = await declineIntakeRequest(member, row.id, { reason: 'SPAM', explanation: 'x' }, reopened.version);
            expect(spam.declineExplanation).toBeNull();
            expect((await listIntakeRequests(member, { view: 'spam' })).items.map((i) => i.id)).toContain(row.id);
            expect((await listIntakeRequests(member, { view: 'decided' })).items.map((i) => i.id)).not.toContain(row.id);
        });

        it('merge into a work item; merge into a request re-points what was merged into it; never into a merged request or itself', async () => {
            const item = await createWorkItem(owner, { projectId, typeId, title: 'The original' });
            const a = await send(member, 'Dup A');
            const b = await send(member, 'Dup B');
            const c = await send(member, 'Dup C');
            const merged = await mergeIntakeRequest(member, a.id, { requestId: b.id }, a.version);
            expect(merged).toMatchObject({ status: 'MERGED', mergedIntoRequestId: b.id });
            expect((await getIntakeRequest(member, b.id)).mergedRequestCount).toBe(1);
            // B into the item: A follows it.
            const bNow = await getIntakeRequest(member, b.id);
            await mergeIntakeRequest(member, b.id, { workItemId: item.id }, bNow.version);
            const aNow = await getIntakeRequest(member, a.id);
            expect(aNow).toMatchObject({ mergedIntoRequestId: null, mergedIntoWorkItemId: item.id, mergedIntoWorkItemKey: item.key });
            const cNow = await getIntakeRequest(member, c.id);
            await expect(mergeIntakeRequest(member, c.id, { requestId: b.id }, cNow.version)).rejects.toMatchObject({ status: 409, details: { reason: 'MERGE_TARGET_NOT_OPEN' } });
            await expect(mergeIntakeRequest(member, c.id, { requestId: c.id }, cNow.version)).rejects.toMatchObject({ status: 400 });
            await expect(mergeIntakeRequest(member, c.id, { workItemId: 'nothing' }, cNow.version)).rejects.toMatchObject({ status: 404 });
        });

        it('snooze takes a date after today; move needs intake on; edit needs If-Match', async () => {
            const row = await send(member, 'Later');
            await expect(snoozeIntakeRequest(member, row.id, { until: addDays(0) }, row.version)).rejects.toMatchObject({ status: 400 });
            const snoozed = await snoozeIntakeRequest(member, row.id, { until: addDays(3) }, row.version);
            expect(snoozed).toMatchObject({ status: 'SNOOZED', snoozedUntil: addDays(3), snoozedByUserId: member.userId });
            await expect(moveIntakeRequest(member, row.id, { projectId: quietProjectId }, snoozed.version)).rejects.toMatchObject({ status: 409, details: { reason: 'INTAKE_OFF' } });
            const moved = await moveIntakeRequest(member, row.id, { projectId: otherProjectId }, snoozed.version);
            expect(moved.projectId).toBe(otherProjectId);
            await expect(editIntakeRequest(member, row.id, { title: 'Renamed' })).rejects.toMatchObject({ status: 428 });
            const edited = await editIntakeRequest(member, row.id, { title: 'Renamed <b>x</b>' }, moved.version);
            expect(edited.title).toBe('Renamed x');
        });
    });

    describe('jobs', () => {
        it('the wake brings due snoozed requests back and rings whoever snoozed them, once', async () => {
            const row = await send(member, 'Wake me');
            const snoozed = await snoozeIntakeRequest(owner, row.id, { until: addDays(1) }, row.version);
            const sys = await buildTenantSystemJobContext({ tenantId, tenantSlug: TAG, job: 'intake-snooze-wake' });
            const tomorrow = new Date(`${addDays(1)}T00:00:00Z`);
            expect((await wakeSnoozedRequests(sys, new Date(`${addDays(0)}T00:00:00Z`))).woken).toBe(0);
            expect((await wakeSnoozedRequests(sys, tomorrow)).woken).toBeGreaterThanOrEqual(1);
            expect(await getIntakeRequest(owner, row.id)).toMatchObject({ status: 'PENDING', snoozedUntil: null, version: snoozed.version + 1 });
            expect(await prisma.notification.count({ where: { tenantId, type: 'INTAKE_REQUEST_WOKEN', userId: owner.userId } })).toBe(1);
            expect((await wakeSnoozedRequests(sys, tomorrow)).woken).toBe(0);
            const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'INTAKE_REQUESTS_WOKEN' } });
            expect(audit.actorType).toBe('JOB');
        });

        it('the purge removes decided requests past the window (spam sooner) and leaves accepted items alone', async () => {
            const sys = await buildTenantSystemJobContext({ tenantId, tenantSlug: TAG, job: 'intake-purge' });
            const accepted = await prisma.intakeRequest.findFirstOrThrow({ where: { tenantId, status: 'ACCEPTED' } });
            const spam = await prisma.intakeRequest.findFirstOrThrow({ where: { tenantId, declineReason: 'SPAM' } });
            const pending = await prisma.intakeRequest.count({ where: { tenantId, status: 'PENDING' } });
            // Ten days on: the spam is gone, the accepted request stays.
            expect((await purgeDecidedRequests(sys, new Date(Date.now() + 10 * 86_400_000))).purged).toBe(1);
            expect(await prisma.intakeRequest.count({ where: { id: spam.id } })).toBe(0);
            expect(await prisma.intakeRequest.count({ where: { id: accepted.id } })).toBe(1);
            // A hundred days on: every decided request is gone; the open ones and the items stay.
            await purgeDecidedRequests(sys, new Date(Date.now() + 100 * 86_400_000));
            expect(await prisma.intakeRequest.count({ where: { tenantId, status: { in: ['ACCEPTED', 'DECLINED', 'MERGED'] } } })).toBe(0);
            expect(await prisma.intakeRequest.count({ where: { tenantId, status: 'PENDING' } })).toBe(pending);
            expect(await prisma.workItem.count({ where: { id: accepted.workItemId! } })).toBe(1);
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'INTAKE_REQUESTS_PURGED' } })).toBeGreaterThanOrEqual(2);
        });
    });

    it('the audit chain verifies', async () => {
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });
});
