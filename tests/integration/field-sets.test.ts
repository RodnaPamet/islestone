/**
 * Field sets against a real Postgres, as `app_user` (sub-phase 2.4b-b;
 * docs/porting/maps/2.4b.md; ADR 0002 §1 and §7; owner decisions 108 to 112):
 *
 *   - what migration `20261130120100_field_sets` adds beyond Prisma: the
 *     CHECKs and the two partial uniques, by their bite;
 *   - who sets entries (built-in under `admin.manage`, custom under
 *     `projects.edit`), the answer never required, audited;
 *   - every write path, the same for every caller: a create (refused naming
 *     the fields; a closed item never refused), a hidden field set by a
 *     request refused and one a template brings skipped and named, an update
 *     emptying a required field, a type change, a single-field write, a bulk
 *     write, the last required label, a custom field, a template's
 *     sub-items, an intake accept, a repeat (held FIELD_SET_UNMET), a project
 *     template's starter items and the entries it carries;
 *   - an existing item that breaks a new entry is not rewritten, and other
 *     writes to it pass (decision 109); the chain verifies.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { addDays, dayKey } from '@/app-layer/domain/cycle';
import { todayInTz } from '@/app-layer/notifications/work-item-due';
import { processWorkItemRecurrence } from '@/app-layer/jobs/work-item-recurrence';
import { createCustomField, setWorkItemCustomFieldValue } from '@/app-layer/usecases/custom-field';
import { listProjectTypeFields, listTypeFields, setProjectTypeField, setTypeField } from '@/app-layer/usecases/field-set';
import { createIntakeForm } from '@/app-layer/usecases/intake-form';
import { acceptIntakeRequest, sendIntakeRequest } from '@/app-layer/usecases/intake-request';
import { setProjectIntake } from '@/app-layer/usecases/intake-settings';
import { createLabel } from '@/app-layer/usecases/label';
import { createProject } from '@/app-layer/usecases/project';
import { saveProjectAsTemplate } from '@/app-layer/usecases/project-template';
import { setWorkItemRecurrence } from '@/app-layer/usecases/recurrence';
import { createTeam } from '@/app-layer/usecases/team';
import { assignWorkItem, bulkSetWorkItemDueDate, createWorkItem, getWorkItem, updateWorkItem } from '@/app-layer/usecases/work-item';
import { removeWorkItemLabel } from '@/app-layer/usecases/work-item-collab';
import { createWorkItemTemplate } from '@/app-layer/usecases/work-item-template';
import { createWorkItemType } from '@/app-layer/usecases/work-item-type';
import { verifyAuditChain } from '@/lib/audit';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `fset${Date.now().toString(36)}`;

describeFn('field sets', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let member: RequestContext;
    let viewer: RequestContext;
    let teamId = '';
    let projectId = '';
    let doneStateId = '';
    let today: Date;
    const savedTz = process.env.NOTIFICATIONS_TZ;
    const k = (n: number) => dayKey(addDays(today, n));
    let n = 0;
    const newType = async (name: string) => (await createWorkItemType(owner, { name: `${name} ${++n}` })).id;

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
        projectId = (await createProject(owner, { teamId, name: 'Fields', keyPrefix: 'FLD' })).id;
    });

    afterAll(async () => {
        process.env.NOTIFICATIONS_TZ = savedTz;
        await resetDatabase(prisma);
    });

    const requireField = (typeId: string, field: string) => setTypeField(owner, typeId, { field, requirement: 'REQUIRED' });
    const unmet = (fields: string[]) => ({ status: 400, details: { reason: 'FIELD_SET_UNMET', fields } });

    describe('what the migration adds', () => {
        it('refuses a row naming two fields or none, a built-in entry with a project, an unknown field, a required answer, a second entry', async () => {
            const typeId = await newType('Catalogue');
            const base = { tenantId, typeId, requirement: 'REQUIRED' as const };
            await expect(prisma.workItemTypeField.create({ data: { ...base } })).rejects.toThrow(/WorkItemTypeField_one_field/);
            await expect(prisma.workItemTypeField.create({ data: { ...base, builtInField: 'dueDate', projectId } })).rejects.toThrow(/WorkItemTypeField_scope/);
            await expect(prisma.workItemTypeField.create({ data: { ...base, builtInField: 'colour' } })).rejects.toThrow(/WorkItemTypeField_built_in_known/);
            await expect(prisma.workItemTypeField.create({ data: { ...base, builtInField: 'answer' } })).rejects.toThrow(/WorkItemTypeField_answer_never_required/);
            await prisma.workItemTypeField.create({ data: { ...base, builtInField: 'dueDate' } });
            await expect(prisma.workItemTypeField.create({ data: { ...base, builtInField: 'dueDate', requirement: 'HIDDEN' } })).rejects.toThrow();
        });
    });

    describe('setting entries', () => {
        it('built-in entries take admin.manage; the default removes the row; the answer is never required; audited', async () => {
            const typeId = await newType('Settings');
            await expect(setTypeField(member, typeId, { field: 'dueDate', requirement: 'REQUIRED' })).rejects.toMatchObject({ status: 403 });
            await expect(setTypeField(owner, typeId, { field: 'answer', requirement: 'REQUIRED' })).rejects.toMatchObject({ status: 400 });
            const set = await setTypeField(owner, typeId, { field: 'dueDate', requirement: 'REQUIRED' });
            expect(set.fields.find((f) => f.field === 'dueDate')?.requirement).toBe('REQUIRED');
            expect((await listTypeFields(viewer, typeId)).fields.find((f) => f.field === 'answer')).toMatchObject({ requirement: 'HIDDEN', allowed: ['OPTIONAL', 'HIDDEN'] });
            await setTypeField(owner, typeId, { field: 'dueDate', requirement: 'OPTIONAL' });
            expect(await prisma.workItemTypeField.count({ where: { tenantId, typeId } })).toBe(0);
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'WORK_ITEM_TYPE_FIELD_SET', entityId: typeId } })).toBe(2);
        });

        it("custom entries take projects.edit (Members hold it) and name the project's own live field", async () => {
            const typeId = await newType('Custom');
            const field = await createCustomField(owner, projectId, { name: `Area ${TAG}`, type: 'TEXT' });
            await expect(setProjectTypeField(viewer, projectId, { typeId, customFieldId: field.id, requirement: 'REQUIRED' })).rejects.toMatchObject({ status: 403 });
            const rows = await setProjectTypeField(member, projectId, { typeId, customFieldId: field.id, requirement: 'REQUIRED' });
            expect(rows).toContainEqual(expect.objectContaining({ typeId, customFieldId: field.id, requirement: 'REQUIRED', projectId }));
            expect(await listProjectTypeFields(viewer, projectId)).toHaveLength(rows.length);
        });
    });

    describe('creating', () => {
        it('a create that leaves a required field empty is refused naming it; a closed one is not', async () => {
            const typeId = await newType('Question');
            await requireField(typeId, 'dueDate');
            await requireField(typeId, 'waitingOn');
            await expect(createWorkItem(member, { projectId, typeId, title: 'no answer yet' })).rejects.toMatchObject(unmet(['waitingOn', 'dueDate']));
            const made = await createWorkItem(member, { projectId, typeId, title: 'asked', dueDate: k(3), waitingOnUserId: owner.userId });
            expect(made.dueDate).toBe(k(3));
            await expect(createWorkItem(member, { projectId, typeId, title: 'closed at birth', stateId: doneStateId })).resolves.toMatchObject({ stateId: doneStateId });
        });

        it('a hidden field the request names is refused; one a template brings is skipped and named', async () => {
            const typeId = await newType('Hidden');
            await setTypeField(owner, typeId, { field: 'priority', requirement: 'HIDDEN' });
            await expect(createWorkItem(member, { projectId, typeId, title: 'loud', priority: 'HIGH' })).rejects.toMatchObject({
                status: 400,
                details: { reason: 'FIELD_HIDDEN', fields: ['priority'] },
            });
            const template = await createWorkItemTemplate(member, projectId, { name: `Loud ${TAG}`, title: 'From a template', typeId, priority: 'URGENT' });
            const made = await createWorkItem(member, { projectId, templateId: template.id });
            expect(made.priority).toBe('NONE');
            expect(made.templateSkipped).toContain('hidden:priority');
        });

        it("a template's sub-items are checked like any create, naming the sub-item", async () => {
            const typeId = await newType('Planned');
            await requireField(typeId, 'dueDate');
            const template = await createWorkItemTemplate(member, projectId, { name: `Planned ${TAG}`, title: 'Plan', typeId, subItems: [{ title: 'Step one' }] });
            await expect(createWorkItem(member, { projectId, templateId: template.id, dueDate: k(2) })).rejects.toMatchObject({ status: 400, details: { reason: 'FIELD_SET_UNMET' } });
        });

        it('a required custom field is asked of a create', async () => {
            const typeId = await newType('Area');
            const field = await createCustomField(owner, projectId, { name: `Zone ${TAG}`, type: 'TEXT' });
            await setProjectTypeField(member, projectId, { typeId, customFieldId: field.id, requirement: 'REQUIRED' });
            await expect(createWorkItem(member, { projectId, typeId, title: 'no zone' })).rejects.toMatchObject(unmet([`cf:${field.id}`]));
            const made = await createWorkItem(member, { projectId, typeId, title: 'zoned', customFields: { [field.id]: 'North' } });
            await expect(setWorkItemCustomFieldValue(member, made.id, field.id, null)).rejects.toMatchObject(unmet([`cf:${field.id}`]));
        });
    });

    describe('changing an item', () => {
        it('an existing item is not rewritten; a write that empties a required field is refused, others pass', async () => {
            const typeId = await newType('Later');
            const old = await createWorkItem(member, { projectId, typeId, title: 'before the entry' });
            await requireField(typeId, 'dueDate');
            await requireField(typeId, 'assignee');
            expect((await getWorkItem(member, old.id)).dueDate).toBeNull();
            // A write that leaves the required fields alone passes.
            const renamed = await updateWorkItem(member, old.id, { title: 'renamed' }, old.version);
            expect(renamed.title).toBe('renamed');
            // Filling, then emptying, a required field.
            const dated = await updateWorkItem(member, old.id, { dueDate: k(5) });
            await expect(updateWorkItem(member, old.id, { dueDate: null })).rejects.toMatchObject(unmet(['dueDate']));
            await assignWorkItem(member, old.id, { assigneeId: owner.userId });
            await expect(assignWorkItem(member, old.id, { assigneeId: null })).rejects.toMatchObject(unmet(['assignee']));
            await expect(bulkSetWorkItemDueDate(member, { workItemIds: [old.id], dueDate: null })).rejects.toMatchObject({ status: 400 });
            expect((await getWorkItem(member, old.id)).dueDate).toBe(dated.dueDate);
        });

        it("a type change is checked against the new type's whole set", async () => {
            const loose = await newType('Loose');
            const strict = await newType('Strict');
            await requireField(strict, 'startDate');
            const item = await createWorkItem(member, { projectId, typeId: loose, title: 'changing' });
            await expect(updateWorkItem(member, item.id, { typeId: strict })).rejects.toMatchObject({ status: 400, details: { reason: 'FIELD_SET_UNMET', fields: ['startDate'] } });
            const changed = await updateWorkItem(member, item.id, { typeId: strict, startDate: k(1) });
            expect(changed.typeId).toBe(strict);
        });

        it('the last label of an open item whose type requires labels stays', async () => {
            const typeId = await newType('Tagged');
            await requireField(typeId, 'labels');
            const label = await createLabel(owner, { name: `Tag ${TAG}` });
            const item = await createWorkItem(member, { projectId, typeId, title: 'tagged', labelIds: [label.id] });
            await expect(removeWorkItemLabel(member, item.id, label.id)).rejects.toMatchObject(unmet(['labels']));
            expect((await getWorkItem(member, item.id)).labelIds).toEqual([label.id]);
        });
    });

    it('an intake accept is checked, and takes the fields a type requires', async () => {
        const typeId = await newType('Ticketed');
        await requireField(typeId, 'dueDate');
        await setProjectIntake(owner, projectId, { enabled: true, notifyUserIds: [] });
        const form = await createIntakeForm(owner, { projectId, name: `Report ${TAG}`, definition: { fields: [{ id: 'f1', kind: 'SHORT_TEXT', label: 'What', required: false }] } });
        const request = await sendIntakeRequest(member, form.id, { title: 'Please look', answers: {} });
        await expect(acceptIntakeRequest(member, request.id, { typeId }, request.version)).rejects.toMatchObject(unmet(['dueDate']));
        const accepted = await acceptIntakeRequest(member, request.id, { typeId, dueDate: k(4) }, request.version);
        expect(accepted.status).toBe('ACCEPTED');
    });

    it('a repeat whose copy would break its type holds with FIELD_SET_UNMET instead of failing', async () => {
        const typeId = await newType('Weekly');
        const source = await createWorkItem(member, { projectId, typeId, title: 'Water the plants', dueDate: k(0) });
        const rule = await setWorkItemRecurrence(member, source.id, { frequency: 'DAILY', interval: 1, weekdays: [], leadDays: 0 });
        await requireField(typeId, 'description');
        const result = await processWorkItemRecurrence({ tenantId, now: new Date(`${k(1)}T12:00:00.000Z`), tz: 'UTC' });
        expect(result).toMatchObject({ created: 0, held: 1, failed: 0 });
        expect(await prisma.workItemRecurrence.findUnique({ where: { id: rule.id }, select: { heldReason: true } })).toEqual({ heldReason: 'FIELD_SET_UNMET' });
    });

    it("a project template carries the project's custom-field entries, and its starter items are checked", async () => {
        const typeId = await newType('Starter');
        const source = (await createProject(owner, { teamId, name: 'Source', keyPrefix: 'SRC' })).id;
        const field = await createCustomField(owner, source, { name: 'Owner team', type: 'TEXT' });
        await setProjectTypeField(owner, source, { typeId, customFieldId: field.id, requirement: 'HIDDEN' });
        await createWorkItem(owner, { projectId: source, typeId, title: 'a starter', dueDate: k(1) });
        const template = await saveProjectAsTemplate(owner, { fromProjectId: source, name: `Starter ${TAG}`, includeItems: true });
        const made = await createProject(owner, { teamId, name: 'From the template', keyPrefix: 'NEW', templateId: template.id });
        const entries = await listProjectTypeFields(owner, made.id);
        expect(entries).toEqual([expect.objectContaining({ typeId, requirement: 'HIDDEN', projectId: made.id })]);
        // Now the type requires an assignee: starter items carry none, so a project from it is refused.
        await requireField(typeId, 'assignee');
        await expect(createProject(owner, { teamId, name: 'Refused', keyPrefix: 'REF', templateId: template.id })).rejects.toMatchObject({ status: 400, details: { reason: 'FIELD_SET_UNMET' } });
        expect(await prisma.project.count({ where: { tenantId, keyPrefix: 'REF' } })).toBe(0);
    });

    it('the audit chain verifies', async () => {
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });
});
