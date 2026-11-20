/**
 * Templates against a real Postgres, as `app_user` (sub-phase 2.5c;
 * docs/porting/maps/2.5.md; owner decisions 71 and 73):
 *
 *   - what migration `20261123120000_templates` adds beyond Prisma: the
 *     `dueInDays` CHECK, and both encrypted columns stored as ciphertext;
 *   - item templates: who may read and write, checks at save, a create from
 *     one (the request winning, sub-items made in the transaction, the
 *     template recorded, what no longer fits skipped and named), an archived
 *     template or type refused, member removal clearing the assignee;
 *   - project templates: saved from a project (fields, milestones as offsets,
 *     item templates, open items with sub-items, no people), listed without
 *     content to `projects.create`, managed only under `admin.manage`, used
 *     by `createProject` in one transaction (no team or workflow created,
 *     types and labels by name, misses reported, a failure leaving no
 *     project);
 *   - every write audited, and the chain verifies.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { addDays, dayKey } from '@/app-layer/domain/cycle';
import { todayInTz } from '@/app-layer/notifications/work-item-due';
import { createCustomField, listCustomFields } from '@/app-layer/usecases/custom-field';
import { createLabel } from '@/app-layer/usecases/label';
import { createMilestone, listMilestones } from '@/app-layer/usecases/milestone';
import { createProject } from '@/app-layer/usecases/project';
import { deleteProjectTemplate, listProjectTemplates, saveProjectAsTemplate, updateProjectTemplate } from '@/app-layer/usecases/project-template';
import { createTeam } from '@/app-layer/usecases/team';
import { removeTenantMember } from '@/app-layer/usecases/tenant-admin';
import { listWorkItemTypes, updateWorkItemType } from '@/app-layer/usecases/work-item-type';
import { createWorkItem, deleteWorkItem, getWorkItem, listSubItems, listWorkItems } from '@/app-layer/usecases/work-item';
import { createWorkItemTemplate, deleteWorkItemTemplate, listWorkItemTemplates, updateWorkItemTemplate } from '@/app-layer/usecases/work-item-template';
import { verifyAuditChain } from '@/lib/audit';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `tpl${Date.now().toString(36)}`;

describeFn('templates', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let admin: RequestContext;
    let member: RequestContext;
    let viewer: RequestContext;
    let leaver: RequestContext;
    let leaverMembershipId = '';
    let teamId = '';
    let projectId = '';
    let typeId = '';
    let bugTypeId = '';
    let labelId = '';
    let today: Date;
    const savedTz = process.env.NOTIFICATIONS_TZ;

    beforeAll(async () => {
        process.env.NOTIFICATIONS_TZ = 'UTC';
        today = todayInTz(new Date(), 'UTC');
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const mk = async (role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER', n: string) => {
            const u = await prisma.user.create({ data: { email: `${n}-${TAG}@example.test`, name: n } });
            const m = await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            return { ctx: makeRequestContext(role, { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-${n}` }), membershipId: m.id };
        };
        owner = (await mk('OWNER', 'olive')).ctx;
        admin = (await mk('ADMIN', 'ada')).ctx;
        member = (await mk('MEMBER', 'max')).ctx;
        viewer = (await mk('VIEWER', 'vic')).ctx;
        const l = await mk('MEMBER', 'lee');
        leaver = l.ctx;
        leaverMembershipId = l.membershipId;
        const team = await createTeam(owner, { name: 'Core' });
        teamId = team.id;
        projectId = (await createProject(owner, { teamId, name: 'Templates', keyPrefix: 'TPL' })).id;
        const types = await listWorkItemTypes(owner);
        typeId = types[0]!.id;
        bugTypeId = types.find((t) => t.name === 'Bug')?.id ?? types[1]!.id;
        labelId = (await createLabel(owner, { name: 'Release' })).id;
    });

    afterAll(async () => {
        process.env.NOTIFICATIONS_TZ = savedTz;
        await resetDatabase(prisma);
    });

    describe('what the migration adds', () => {
        it('the dueInDays CHECK refuses a negative or huge offset', async () => {
            const base = { tenantId, projectId, title: 't', sortKey: 'z', createdByUserId: owner.userId };
            await expect(prisma.workItemTemplate.create({ data: { ...base, name: 'neg', dueInDays: -1 } })).rejects.toThrow(/WorkItemTemplate_due_in_days_range/);
            await expect(prisma.workItemTemplate.create({ data: { ...base, name: 'big', dueInDays: 3651 } })).rejects.toThrow(/WorkItemTemplate_due_in_days_range/);
        });
    });

    describe('item templates', () => {
        it('a MEMBER creates one; the description is ciphertext on disk; a VIEWER reads but does not write', async () => {
            const t = await createWorkItemTemplate(member, projectId, {
                name: 'Release',
                title: 'Release <b>v1</b>',
                description: 'Ship it <script>alert(1)</script>',
                typeId,
                priority: 'HIGH',
                labelIds: [labelId],
                assigneeId: member.userId,
                dueInDays: 5,
                subItems: [{ title: 'Tag the build' }, { title: 'Write the notes' }],
            });
            expect(t).toMatchObject({ name: 'Release', title: 'Release v1', priority: 'HIGH', labelIds: [labelId], dueInDays: 5, archived: false });
            expect(t.description).not.toMatch(/script/);
            const [raw] = await prisma.$queryRaw<Array<{ description: string }>>`SELECT description FROM "WorkItemTemplate" WHERE id = ${t.id}`;
            expect(raw!.description.startsWith('v2:')).toBe(true);
            expect(raw!.description).not.toContain('Ship it');
            await expect(createWorkItemTemplate(viewer, projectId, { name: 'Nope', title: 'n' })).rejects.toMatchObject({ status: 403 });
            expect((await listWorkItemTemplates(viewer, projectId)).map((x) => x.name)).toEqual(['Release']);
            await expect(createWorkItemTemplate(member, projectId, { name: 'Release', title: 'again' })).rejects.toMatchObject({ status: 409, details: { reason: 'TEMPLATE_NAME_TAKEN' } });
        });

        it('checks at save: a missing type, a non-member assignee and a dead field are refused', async () => {
            await expect(createWorkItemTemplate(member, projectId, { name: 'Bad type', title: 't', typeId: 'nope' })).rejects.toMatchObject({ status: 404 });
            await expect(createWorkItemTemplate(member, projectId, { name: 'Bad person', title: 't', assigneeId: 'nope' })).rejects.toMatchObject({ status: 400 });
            await expect(createWorkItemTemplate(member, projectId, { name: 'Bad field', title: 't', customFields: { nope: 'x' } })).rejects.toMatchObject({ status: 400 });
        });

        it('a create from a template makes the item and its sub-items, records the template, and the request wins', async () => {
            const [t] = await listWorkItemTemplates(member, projectId);
            const field = await createCustomField(owner, projectId, { name: 'Stage', type: 'SELECT', options: [{ name: 'Draft' }, { name: 'Final' }] });
            await updateWorkItemTemplate(member, projectId, t!.id, { customFields: { [field.id]: field.options[0]!.id } });
            const item = await createWorkItem(member, { projectId, templateId: t!.id, priority: 'LOW' });
            expect(item).toMatchObject({ title: 'Release v1', typeId, priority: 'LOW', labelIds: [labelId], assigneeId: member.userId, dueDate: dayKey(addDays(today, 5)) });
            expect(item.customFields).toEqual({ [field.id]: field.options[0]!.id });
            expect((await getWorkItem(member, item.id)).description).toMatch(/^Ship it/);
            const subs = await listSubItems(member, item.id);
            expect(subs.items.map((s) => s.title)).toEqual(['Tag the build', 'Write the notes']);
            const created = await prisma.auditLog.findMany({ where: { tenantId, action: 'WORK_ITEM_CREATED', entityId: { in: [item.id, ...subs.items.map((s) => s.id)] } } });
            expect(created).toHaveLength(3);
            expect(created.every((c) => (c.metadataJson as { templateId?: string } | null)?.templateId === t!.id)).toBe(true);
        });

        it('skips what no longer fits and names it; an archived template and an archived type are refused', async () => {
            const t = await createWorkItemTemplate(member, projectId, { name: 'Leaver', title: 'For lee', assigneeId: leaver.userId, typeId: bugTypeId });
            await removeTenantMember(owner, { membershipId: leaverMembershipId });
            // Member removal cleared the template's assignee.
            expect((await listWorkItemTemplates(member, projectId)).find((x) => x.id === t.id)?.assigneeId).toBeNull();
            const made = await createWorkItem(member, { projectId, templateId: t.id });
            expect(made.assigneeId).toBeNull();
            await updateWorkItemType(owner, bugTypeId, { archived: true });
            await expect(createWorkItem(member, { projectId, templateId: t.id })).rejects.toMatchObject({ status: 409, details: { reason: 'TEMPLATE_TYPE_ARCHIVED' } });
            await expect(createWorkItem(member, { projectId, templateId: t.id, typeId })).resolves.toMatchObject({ typeId });
            await updateWorkItemType(owner, bugTypeId, { archived: false });
            await updateWorkItemTemplate(member, projectId, t.id, { archived: true });
            await expect(createWorkItem(member, { projectId, templateId: t.id })).rejects.toMatchObject({ status: 409, details: { reason: 'TEMPLATE_ARCHIVED' } });
            expect((await listWorkItemTemplates(member, projectId)).map((x) => x.id)).not.toContain(t.id);
            await expect(deleteWorkItemTemplate(viewer, projectId, t.id)).rejects.toMatchObject({ status: 403 });
            await deleteWorkItemTemplate(member, projectId, t.id);
            expect(await prisma.workItemTemplate.count({ where: { id: t.id } })).toBe(0);
        });

        it('a deleted label leaves the template, and a template of another project is a 404', async () => {
            const gone = await createLabel(owner, { name: 'Ephemeral' });
            const t = await createWorkItemTemplate(member, projectId, { name: 'Labelled', title: 'x', typeId, labelIds: [gone.id] });
            await prisma.label.delete({ where: { id: gone.id } });
            expect((await listWorkItemTemplates(member, projectId)).find((x) => x.id === t.id)?.labelIds).toEqual([]);
            const other = await createProject(owner, { teamId, name: 'Other', keyPrefix: 'OTH' });
            await expect(createWorkItem(member, { projectId: other.id, templateId: t.id })).rejects.toMatchObject({ status: 404 });
        });
    });

    describe('project templates', () => {
        let templateId = '';

        it('an ADMIN saves a project as a template, with no people and due dates as offsets', async () => {
            await createMilestone(owner, projectId, { name: 'Beta', dueDate: dayKey(addDays(today, 10)) });
            const beta = (await listMilestones(owner, projectId)).find((m) => m.name === 'Beta')!;
            const open = await createWorkItem(owner, { projectId, typeId, title: 'Open starter', dueDate: dayKey(addDays(today, 2)), milestoneId: beta.id, labelIds: [labelId] });
            await createWorkItem(owner, { projectId, typeId, title: 'Its sub-item', parentId: open.id });
            const removed = await createWorkItem(owner, { projectId, typeId, title: 'Deleted one' });
            await deleteWorkItem(owner, removed.id);

            await expect(saveProjectAsTemplate(member, { fromProjectId: projectId, name: 'Nope' })).rejects.toMatchObject({ status: 403 });
            const saved = await saveProjectAsTemplate(admin, { fromProjectId: projectId, name: 'Standard', includeItems: true });
            templateId = saved.id;
            expect(saved.counts).toMatchObject({ customFields: 1, milestones: 1 });
            const [raw] = await prisma.$queryRaw<Array<{ contentJson: string }>>`SELECT "contentJson" FROM "ProjectTemplate" WHERE id = ${saved.id}`;
            expect(raw!.contentJson.startsWith('v2:')).toBe(true);
            expect(raw!.contentJson).not.toContain('Open starter');
        });

        it('lists names to projects.create and counts to admins; renames and archives only under admin.manage', async () => {
            const forMember = await listProjectTemplates(member);
            expect(forMember).toEqual([expect.objectContaining({ id: templateId, name: 'Standard' })]);
            expect(forMember[0]!.counts).toBeUndefined();
            await expect(listProjectTemplates(viewer)).rejects.toMatchObject({ status: 403 });
            expect((await listProjectTemplates(admin))[0]!.counts?.items).toBeGreaterThanOrEqual(1);
            await expect(updateProjectTemplate(member, templateId, { name: 'Mine' })).rejects.toMatchObject({ status: 403 });
            await expect(updateProjectTemplate(admin, templateId, { name: 'Default project' })).resolves.toMatchObject({ name: 'Default project' });
        });

        it('createProject applies it in one transaction: fields, milestones dated from today, item templates, starter items and sub-items', async () => {
            const teamsBefore = await prisma.team.count({ where: { tenantId } });
            const statesBefore = await prisma.workflowState.count({ where: { tenantId } });
            const made = await createProject(member, { teamId, name: 'From template', keyPrefix: 'NEW', templateId });
            expect(await prisma.team.count({ where: { tenantId } })).toBe(teamsBefore);
            expect(await prisma.workflowState.count({ where: { tenantId } })).toBe(statesBefore);
            expect((await listCustomFields(member, made.id)).map((f) => [f.name, f.options.map((o) => o.name)])).toEqual([['Stage', ['Draft', 'Final']]]);
            const [beta] = await listMilestones(member, made.id);
            expect(beta).toMatchObject({ name: 'Beta', dueDate: dayKey(addDays(today, 10)) });
            const templates = await listWorkItemTemplates(member, made.id);
            expect(templates.map((t) => t.name)).toEqual(expect.arrayContaining(['Release']));
            expect(templates.every((t) => t.assigneeId === null)).toBe(true);
            const items = (await listWorkItems(member, { projectId: made.id })).items;
            const starter = items.find((i) => i.title === 'Open starter')!;
            expect(starter).toMatchObject({ milestoneId: beta!.id, labelIds: [labelId], dueDate: dayKey(addDays(today, 2)), assigneeId: null });
            expect(items.map((i) => i.title)).not.toContain('Deleted one');
            expect((await listSubItems(member, starter.id)).items.map((s) => s.title)).toEqual(['Its sub-item']);
            const entry = await prisma.auditLog.findFirst({ where: { tenantId, action: 'PROJECT_CREATED', entityId: made.id } });
            expect((entry?.metadataJson as { projectTemplateId?: string })?.projectTemplateId).toBe(templateId);
        });

        it('a name that matches nothing in the workspace is reported, not created', async () => {
            const other = await createTeam(owner, { name: 'Elsewhere' });
            const teamLabel = await createLabel(owner, { name: 'Core only', teamId });
            const p = await createProject(owner, { teamId, name: 'Labelled', keyPrefix: 'LAB' });
            await createWorkItem(owner, { projectId: p.id, typeId, title: 'Has a team label', labelIds: [teamLabel.id] });
            const saved = await saveProjectAsTemplate(owner, { fromProjectId: p.id, name: 'Team labelled', includeItems: true });
            const labelsBefore = await prisma.label.count({ where: { tenantId } });
            const made = await createProject(owner, { teamId: other.id, name: 'Other team', keyPrefix: 'OTT', templateId: saved.id });
            expect(made).toMatchObject({ fromTemplate: { skipped: ['label:Core only'] } });
            expect(await prisma.label.count({ where: { tenantId } })).toBe(labelsBefore);
            const item = (await listWorkItems(owner, { projectId: made.id })).items[0]!;
            expect(item.labelIds).toEqual([]);
        });

        it('a failure part-way leaves no project; an archived template is refused; delete is admin only', async () => {
            await expect(createProject(owner, { teamId, name: 'Broken', keyPrefix: 'BRK', templateId: 'missing' })).rejects.toMatchObject({ status: 404 });
            expect(await prisma.project.count({ where: { tenantId, keyPrefix: 'BRK' } })).toBe(0);
            await prisma.projectTemplate.update({ where: { id: templateId }, data: { contentJson: 'not json' } });
            await expect(createProject(owner, { teamId, name: 'Broken', keyPrefix: 'BRK', templateId })).rejects.toMatchObject({ status: 409, details: { reason: 'TEMPLATE_CONTENT_INVALID' } });
            expect(await prisma.project.count({ where: { tenantId, keyPrefix: 'BRK' } })).toBe(0);
            await updateProjectTemplate(admin, templateId, { archived: true });
            await expect(createProject(owner, { teamId, name: 'Archived', keyPrefix: 'ARC', templateId })).rejects.toMatchObject({ status: 409, details: { reason: 'TEMPLATE_ARCHIVED' } });
            await expect(deleteProjectTemplate(member, templateId)).rejects.toMatchObject({ status: 403 });
            await deleteProjectTemplate(admin, templateId);
            expect(await prisma.projectTemplate.count({ where: { id: templateId } })).toBe(0);
        });
    });

    it('every template write is audited, and the audit chain verifies', async () => {
        const actions = (await prisma.auditLog.groupBy({ by: ['action'], where: { tenantId, action: { contains: 'TEMPLATE' } } })).map((a) => a.action).sort();
        expect(actions).toEqual(
            expect.arrayContaining([
                'ITEM_TEMPLATES_CLEARED_ON_MEMBER_REMOVAL',
                'ITEM_TEMPLATE_ARCHIVED',
                'ITEM_TEMPLATE_CREATED',
                'ITEM_TEMPLATE_DELETED',
                'ITEM_TEMPLATE_UPDATED',
                'PROJECT_TEMPLATE_ARCHIVED',
                'PROJECT_TEMPLATE_CREATED',
                'PROJECT_TEMPLATE_DELETED',
                'PROJECT_TEMPLATE_UPDATED',
            ]),
        );
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });
});
