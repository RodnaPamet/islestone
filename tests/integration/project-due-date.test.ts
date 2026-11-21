/**
 * The project's due date and start-after-due, against a real Postgres
 * (roadmap 3.1a; owner decision 188; ADR 0002 §16; ADR 0010 §3):
 *
 *   - a project's due date is set on create and changed on edit, returned as
 *     `YYYY-MM-DD`, audited by naming the field, and moves no item or
 *     milestone; a viewer cannot change it;
 *   - a project template carries it as an offset from the day it is saved,
 *     dated from today when used, unless the create names its own;
 *   - start after due is refused on every date write (400 `START_AFTER_DUE`):
 *     a create, an edit of either date, the bulk due-date change; a row
 *     written before is never rewritten and an edit that touches neither
 *     date is not refused;
 *   - a repeat whose source has its start after its due date makes copies
 *     without a start, named in `skipped`.
 *
 * Written fresh for Islestone.
 */
import type { PrismaClient } from '@prisma/client';

import { addDays, dayKey } from '@/app-layer/domain/cycle';
import { processWorkItemRecurrence } from '@/app-layer/jobs/work-item-recurrence';
import { todayInTz } from '@/app-layer/notifications/work-item-due';
import type { RequestContext } from '@/app-layer/types';
import { createMilestone } from '@/app-layer/usecases/milestone';
import { createProject, getProject, listProjects, updateProject } from '@/app-layer/usecases/project';
import { saveProjectAsTemplate } from '@/app-layer/usecases/project-template';
import { setWorkItemRecurrence } from '@/app-layer/usecases/recurrence';
import { createTeam } from '@/app-layer/usecases/team';
import { bulkSetWorkItemDueDate, createWorkItem, getWorkItem, updateWorkItem } from '@/app-layer/usecases/work-item';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { verifyAuditChain } from '@/lib/audit';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `pdue${Date.now().toString(36)}`;
const reversed = { status: 400, details: { reason: 'START_AFTER_DUE' } };

describeFn("the project's due date and start after due", () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let member: RequestContext;
    let viewer: RequestContext;
    let teamId = '';
    let projectId = '';
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
        const mk = async (role: 'OWNER' | 'MEMBER' | 'VIEWER', n: string) => {
            const u = await prisma.user.create({ data: { email: `${n}-${TAG}@example.test`, name: n } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            return makeRequestContext(role, { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-${n}` });
        };
        owner = await mk('OWNER', 'olive');
        member = await mk('MEMBER', 'max');
        viewer = await mk('VIEWER', 'vic');
        teamId = (await createTeam(owner, { name: 'Core' })).id;
        projectId = (await createProject(owner, { teamId, name: 'Dated', keyPrefix: 'DAT', dueDate: '2027-03-14' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
    });

    afterAll(async () => {
        process.env.NOTIFICATIONS_TZ = savedTz;
        await resetDatabase(prisma);
    });

    describe("a project's due date (decision 188)", () => {
        it('is set on create, read as YYYY-MM-DD, and audited by name', async () => {
            expect((await getProject(viewer, projectId)).dueDate).toBe('2027-03-14');
            expect((await listProjects(viewer)).find((p) => p.id === projectId)?.dueDate).toBe('2027-03-14');
            const created = await prisma.auditLog.findFirst({ where: { tenantId, entityId: projectId, action: 'PROJECT_CREATED' } });
            expect(created?.detailsJson).toMatchObject({ changedFields: ['dueDate'] });
        });

        it('is changed and cleared on edit, the version moving, and moves nothing else', async () => {
            const milestone = await createMilestone(owner, projectId, { name: 'Beta', dueDate: '2027-02-01' });
            const item = await createWorkItem(owner, { projectId, typeId, title: 'Untouched', dueDate: '2027-04-01' });
            const before = await getProject(owner, projectId);
            const changed = await updateProject(member, projectId, { dueDate: '2027-05-01' });
            expect(changed).toMatchObject({ dueDate: '2027-05-01', version: before.version + 1 });
            const entry = await prisma.auditLog.findFirst({ where: { tenantId, entityId: projectId, action: 'PROJECT_UPDATED' }, orderBy: { createdAt: 'desc' } });
            expect(entry?.detailsJson).toMatchObject({ changedFields: ['dueDate'] });
            // The same date again changes nothing.
            expect((await updateProject(member, projectId, { dueDate: '2027-05-01' })).version).toBe(changed.version);
            expect((await updateProject(owner, projectId, { dueDate: null })).dueDate).toBeNull();
            expect((await getWorkItem(owner, item.id)).dueDate).toBe('2027-04-01');
            expect((await prisma.milestone.findUnique({ where: { id: milestone.id } }))?.dueDate?.toISOString().slice(0, 10)).toBe('2027-02-01');
            await expect(updateProject(viewer, projectId, { dueDate: '2027-06-01' })).rejects.toMatchObject({ status: 403 });
            await expect(updateProject(owner, projectId, { dueDate: '2027-02-30' })).rejects.toMatchObject({ status: 400, details: { reason: 'DUE_DATE_INVALID' } });
            await updateProject(owner, projectId, { dueDate: '2027-03-14' });
        });

        it('a project template carries it as days from today; a due date the create names wins', async () => {
            const source = await createProject(owner, { teamId, name: 'Source', keyPrefix: 'SRC', dueDate: k(30) });
            const template = await saveProjectAsTemplate(owner, { fromProjectId: source.id, name: `Dated ${TAG}` });
            const made = await createProject(owner, { teamId, name: 'Made', keyPrefix: 'MAD', templateId: template.id });
            expect(made.dueDate).toBe(k(30));
            expect((await getProject(owner, made.id)).dueDate).toBe(k(30));
            expect((await getProject(owner, made.id)).version).toBe(1);
            const named = await createProject(owner, { teamId, name: 'Named', keyPrefix: 'NAM', templateId: template.id, dueDate: k(5) });
            expect((await getProject(owner, named.id)).dueDate).toBe(k(5));
            const cleared = await createProject(owner, { teamId, name: 'Cleared', keyPrefix: 'CLR', templateId: template.id, dueDate: null });
            expect((await getProject(owner, cleared.id)).dueDate).toBeNull();
            const undated = await createProject(owner, { teamId, name: 'Undated', keyPrefix: 'UND' });
            const plain = await saveProjectAsTemplate(owner, { fromProjectId: undated.id, name: `Undated ${TAG}` });
            expect((await createProject(owner, { teamId, name: 'Plain', keyPrefix: 'PLN', templateId: plain.id })).dueDate).toBeNull();
        });
    });

    describe('start after due is refused (ADR 0010 §3)', () => {
        it('on a create', async () => {
            await expect(createWorkItem(owner, { projectId, typeId, title: 'Backwards', startDate: k(5), dueDate: k(2) })).rejects.toMatchObject(reversed);
            const same = await createWorkItem(owner, { projectId, typeId, title: 'One day', startDate: k(2), dueDate: k(2) });
            expect(same.startDate).toBe(k(2));
        });

        it('on an edit of either date, never on an edit that touches neither', async () => {
            const item = await createWorkItem(owner, { projectId, typeId, title: 'Edited', startDate: k(1), dueDate: k(4) });
            await expect(updateWorkItem(owner, item.id, { startDate: k(6) })).rejects.toMatchObject(reversed);
            await expect(updateWorkItem(owner, item.id, { dueDate: k(0) })).rejects.toMatchObject(reversed);
            expect((await updateWorkItem(owner, item.id, { startDate: k(4) })).startDate).toBe(k(4));
            // A row written before 3.1a stays as it is; a title edit is not refused.
            await prisma.workItem.update({ where: { id: item.id }, data: { startDate: new Date(`${k(9)}T00:00:00Z`) } });
            const current = await getWorkItem(owner, item.id);
            expect((await updateWorkItem(owner, item.id, { title: 'Renamed' }, current.version)).startDate).toBe(k(9));
            expect((await updateWorkItem(owner, item.id, { startDate: null })).startDate).toBeNull();
        });

        it('on the bulk due-date change, naming the items, and nothing is written', async () => {
            const a = await createWorkItem(owner, { projectId, typeId, title: 'Bulk a', startDate: k(3) });
            const b = await createWorkItem(owner, { projectId, typeId, title: 'Bulk b' });
            await expect(bulkSetWorkItemDueDate(owner, { workItemIds: [a.id, b.id], dueDate: k(1) })).rejects.toMatchObject({
                status: 400,
                details: { reason: 'START_AFTER_DUE', workItemIds: [a.id] },
            });
            expect((await getWorkItem(owner, b.id)).dueDate).toBeNull();
            await bulkSetWorkItemDueDate(owner, { workItemIds: [a.id, b.id], dueDate: k(3) });
            expect((await getWorkItem(owner, a.id)).dueDate).toBe(k(3));
        });

        it('a repeat whose source has its start after its due date copies no start, and names it', async () => {
            const source = await createWorkItem(member, { projectId, typeId, title: 'Daily', dueDate: k(0) });
            const rule = await setWorkItemRecurrence(member, source.id, { frequency: 'DAILY', interval: 1, weekdays: [], leadDays: 0 });
            await prisma.workItem.update({ where: { id: source.id }, data: { startDate: new Date(`${k(2)}T00:00:00Z`) } });
            const result = await processWorkItemRecurrence({ tenantId, now: new Date(`${k(1)}T12:00:00Z`), tz: 'UTC' });
            expect(result.created).toBe(1);
            const copy = await prisma.workItem.findFirst({ where: { tenantId, recurrenceId: rule.id, occurrenceOn: new Date(`${k(1)}T00:00:00Z`) } });
            expect(copy?.startDate).toBeNull();
            const entry = await prisma.auditLog.findFirst({ where: { tenantId, entityId: copy!.id, action: 'WORK_ITEM_CREATED' } });
            expect(JSON.stringify(entry?.metadataJson)).toContain('startDate:afterDue');
        });
    });

    it('the audit chain verifies', async () => {
        expect((await verifyAuditChain(tenantId, prisma)).valid).toBe(true);
    });
});
