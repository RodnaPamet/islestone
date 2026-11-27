/**
 * A purged project with time entries leaves a tombstone (issue #117, owner
 * decision 281; docs/work-items.md, "The purge"), against a real Postgres:
 *
 *   - the catalogue: `Project.purgedAt` and its CHECK, the time entries'
 *     link DEFERRABLE INITIALLY IMMEDIATE;
 *   - a purge without time entries deletes the project as before;
 *   - a purge with time entries keeps a minimal row (key, name, deletion,
 *     `purgedAt`; its team cleared, issue #120, decision 305), removes its
 *     items and everything it holds, keeps its billable rates (3.4d),
 *     keeps every entry with its project (an approved week's too), and the
 *     week's totals stay what they were;
 *   - the tombstone is read by nothing but time: not restorable, not in the
 *     project list, not purged again; its key is never reused; a team only
 *     tombstones named is deleted (issue #120), and no live project goes
 *     without a team (the CHECK);
 *   - two-tenant isolation: one workspace's purge leaves another's projects,
 *     and an outsider never reads a tombstone.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { createCustomField } from '@/app-layer/usecases/custom-field';
import { createIntakeForm } from '@/app-layer/usecases/intake-form';
import { setProjectIntake } from '@/app-layer/usecases/intake-settings';
import { createMilestone } from '@/app-layer/usecases/milestone';
import { createProject, deleteProject, listProjects, restoreProject } from '@/app-layer/usecases/project';
import { createRecipientList } from '@/app-layer/usecases/recipient-list';
import { createSavedView } from '@/app-layer/usecases/saved-view';
import { createTeam, deleteTeam } from '@/app-layer/usecases/team';
import { addTimeEntry, deleteTimeEntry, getTimeWeek } from '@/app-layer/usecases/time-entry';
import { setProjectRate } from '@/app-layer/usecases/billable-rate';
import { approveTimesheet, setTimeSettings, submitTimesheet } from '@/app-layer/usecases/timesheet';
import { purgeWorkspaceWorkItems } from '@/app-layer/usecases/work-item-purge';
import { createWorkItemTemplate } from '@/app-layer/usecases/work-item-template';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createWorkItem } from '@/app-layer/usecases/work-item';
import { verifyAuditChain } from '@/lib/audit';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `tmb${Date.now().toString(36)}`;

async function reasonOf(p: Promise<unknown>): Promise<string> {
    try {
        await p;
    } catch (err) {
        const e = err as { details?: { reason?: string }; status?: number; message?: string };
        return e.details?.reason ?? `${e.status ?? ''} ${e.message ?? ''}`;
    }
    return 'no error';
}

/** A day of the week starting 2003-03-03 (a Monday), `n` days in. */
function day(n: number): string {
    return new Date(Date.UTC(2003, 2, 3) + n * 86_400_000).toISOString().slice(0, 10);
}

const purge = (ctx: RequestContext) => purgeWorkspaceWorkItems({ ...ctx, actorType: 'JOB' }, new Date(Date.now() + 86_400_000), 0);

describeFn('project tombstones (issue #117, decision 281)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let member: RequestContext;
    let typeId = '';
    let teamId = '';

    async function world(prefix: string, team = teamId) {
        const project = await createProject(owner, { teamId: team, name: `Project ${prefix}`, keyPrefix: prefix, dueDate: '2003-12-31' });
        const item = await createWorkItem(owner, { projectId: project.id, typeId, title: `${prefix} work` });
        await createWorkItem(owner, { projectId: project.id, typeId, title: `${prefix} sub`, parentId: item.id });
        return { projectId: project.id, itemId: item.id };
    }

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const mk = async (who: string, role: 'OWNER' | 'MEMBER') => {
            const u = await prisma.user.create({ data: { email: `${who}-${TAG}@example.test`, name: who } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            return makeRequestContext(role, { tenantId, tenantSlug: TAG, userId: u.id, requestId: `${TAG}-${who}` });
        };
        owner = await mk('owner', 'OWNER');
        member = await mk('member', 'MEMBER');
        teamId = (await createTeam(owner, { name: 'Tombstones' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    it('declares the mark, its CHECK and the deferrable link', async () => {
        const check = await prisma.$queryRaw<Array<{ def: string }>>`
            SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'Project_purged_is_tombstone'`;
        expect(check[0]?.def).toMatch(/"purgedAt" IS NULL\) OR \(\("deletedAt" IS NOT NULL\) AND \("dueDate" IS NULL\) AND \("initiativeId" IS NULL\)/);
        const fk = await prisma.$queryRaw<Array<{ condeferrable: boolean; condeferred: boolean }>>`
            SELECT condeferrable, condeferred FROM pg_constraint WHERE conname = 'TimeEntry_projectId_tenantId_fkey'`;
        expect(fk[0]).toEqual({ condeferrable: true, condeferred: false });
        // Issue #120: only a tombstone has no team.
        const team = await prisma.$queryRaw<Array<{ def: string }>>`
            SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'Project_team_unless_tombstone'`;
        expect(team[0]?.def).toMatch(/"teamId" IS NOT NULL\) OR \("purgedAt" IS NOT NULL/);
        // The link still refuses a project's plain delete while entries name it.
        const w = await world('TBA');
        await addTimeEntry(member, { workItemId: w.itemId, workDate: day(0), minutes: 5 });
        await expect(prisma.project.delete({ where: { id: w.projectId } })).rejects.toThrow();
        // A live or deleted project keeps its team: no writer clears it.
        await expect(prisma.project.update({ where: { id: w.projectId }, data: { teamId: null } })).rejects.toThrow(/Project_team_unless_tombstone/);
    });

    it('deletes a purged project no time names, as before', async () => {
        const w = await world('TBN');
        await deleteProject(owner, w.projectId);
        const out = await purge(owner);
        expect(out.tombstones).toBe(0);
        expect(await prisma.project.count({ where: { id: w.projectId } })).toBe(0);
        expect(await prisma.workItem.count({ where: { projectId: w.projectId } })).toBe(0);
        // Its key prefix is never reused all the same.
        expect(await reasonOf(createProject(owner, { teamId, name: 'Again', keyPrefix: 'TBN' }))).not.toBe('no error');
    });

    it("leaves a tombstone of a project time names: its children gone, its entries kept, the week's totals unchanged", async () => {
        const w = await world('TBT');
        await createCustomField(owner, w.projectId, { name: 'Stage', type: 'SELECT', options: [{ name: 'A' }] });
        await createMilestone(owner, w.projectId, { name: 'Launch' });
        await createWorkItemTemplate(owner, w.projectId, { name: 'Template', title: 'From it' });
        await createRecipientList(owner, w.projectId, { name: 'Desk', userIds: [member.userId] });
        await setProjectIntake(owner, w.projectId, { enabled: true });
        await createIntakeForm(owner, { projectId: w.projectId, name: 'Form', definition: { fields: [] }, published: true });
        await createSavedView(member, { name: 'Ours', visibility: 'SHARED', projectId: w.projectId, layout: 'LIST', config: { filters: {}, sort: 'manual', laneBy: 'none' } });
        const a = await addTimeEntry(member, { workItemId: w.itemId, workDate: day(1), minutes: 90, billable: true, description: 'kept text' });
        // A project rate (3.4d): kept by the tombstone, so its entries' amounts do not move.
        await setTimeSettings(owner, { currency: 'EUR' });
        const rate = await setProjectRate(owner, w.projectId, { effectiveFrom: day(0), hourlyRateMinor: 12_000 });
        const b = await addTimeEntry(member, { workItemId: w.itemId, workDate: day(2), minutes: 30 });
        // One week approved (frozen) before the purge: the purge still passes it.
        await setTimeSettings(owner, { approvalRequired: true });
        const sheet = await submitTimesheet(member, { week: day(0) });
        await approveTimesheet(owner, sheet.timesheet!.id);
        const before = await getTimeWeek(member, { week: day(0) });

        await deleteProject(owner, w.projectId);
        const out = await purge(owner);
        expect(out.tombstones).toBe(1);

        const row = await prisma.project.findUniqueOrThrow({ where: { id: w.projectId } });
        // Issue #120 (decision 305): the tombstone names no team.
        expect(row).toMatchObject({ name: 'Project TBT', keyPrefix: 'TBT', teamId: null, dueDate: null, initiativeId: null });
        expect(await prisma.billableRate.findMany({ where: { projectId: w.projectId }, select: { id: true, hourlyRateMinor: true } })).toEqual([{ id: rate.id, hourlyRateMinor: 12_000 }]);
        expect(row.purgedAt).toBeInstanceOf(Date);
        expect(row.deletedAt).toBeInstanceOf(Date);
        for (const [model, count] of [
            ['workItem', prisma.workItem.count({ where: { projectId: w.projectId } })],
            ['customField', prisma.customField.count({ where: { projectId: w.projectId } })],
            ['milestone', prisma.milestone.count({ where: { projectId: w.projectId } })],
            ['workItemTemplate', prisma.workItemTemplate.count({ where: { projectId: w.projectId } })],
            ['recipientList', prisma.recipientList.count({ where: { projectId: w.projectId } })],
            ['projectIntake', prisma.projectIntake.count({ where: { projectId: w.projectId } })],
            ['intakeForm', prisma.intakeForm.count({ where: { projectId: w.projectId } })],
            ['savedView', prisma.savedView.count({ where: { projectId: w.projectId } })],
        ] as const) {
            expect({ model, rows: await count }).toEqual({ model, rows: 0 });
        }
        const entries = await prisma.timeEntry.findMany({ where: { id: { in: [a.id, b.id] } }, select: { id: true, projectId: true, workItemId: true, minutes: true }, orderBy: { minutes: 'asc' } });
        expect(entries).toEqual([
            { id: b.id, projectId: w.projectId, workItemId: null, minutes: 30 },
            { id: a.id, projectId: w.projectId, workItemId: null, minutes: 90 },
        ]);
        const after = await getTimeWeek(member, { week: day(0) });
        expect(after.totalMinutes).toBe(before.totalMinutes);
        expect(after.dayTotals).toEqual(before.dayTotals);
        expect(after.entries.filter((e) => e.projectId === w.projectId).map((e) => e.item)).toEqual([{ kind: 'deleted' }, { kind: 'deleted' }]);
        const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'WORK_ITEM_PURGED' }, orderBy: { createdAt: 'desc' } });
        expect(audit.metadataJson).toMatchObject({ tombstones: 1 });
    });

    it('reads the tombstone for nothing but time: not restorable, not listed, not purged again, its key never reused', async () => {
        const w = await world('TBR');
        await addTimeEntry(member, { workItemId: w.itemId, workDate: day(10), minutes: 15 });
        await deleteProject(owner, w.projectId);
        await purge(owner);
        expect(await reasonOf(restoreProject(owner, w.projectId))).toMatch(/404/);
        expect((await listProjects(owner)).map((p) => p.id)).not.toContain(w.projectId);
        const again = await purge(owner);
        expect(again.projects).toBe(0);
        expect(await prisma.project.count({ where: { id: w.projectId } })).toBe(1);
        expect(await reasonOf(createProject(owner, { teamId, name: 'Again', keyPrefix: 'TBR' }))).not.toBe('no error');
        // A tombstone cannot be brought back by any writer (the CHECK).
        await expect(prisma.project.update({ where: { id: w.projectId }, data: { deletedAt: null } })).rejects.toThrow(/Project_purged_is_tombstone/);
        // The time stays deletable by its person while its week is open; the tombstone remains.
        const [entry] = await prisma.timeEntry.findMany({ where: { projectId: w.projectId }, select: { id: true } });
        await deleteTimeEntry(member, entry!.id);
        expect(await prisma.project.count({ where: { id: w.projectId } })).toBe(1);
    });

    it('deletes a team only tombstones named (issue #120, decision 305), and holds one a deleted project names', async () => {
        const team = await createTeam(owner, { name: 'Holding' });
        const w = await world('TBH', team.id);
        await addTimeEntry(member, { workItemId: w.itemId, workDate: day(17), minutes: 10 });
        await deleteProject(owner, w.projectId);
        // A deleted project is restorable until the purge: it still holds its team.
        expect(await reasonOf(deleteTeam(owner, team.id))).toBe('TEAM_HAS_PROJECTS');
        await purge(owner);
        expect((await prisma.project.findUniqueOrThrow({ where: { id: w.projectId } })).teamId).toBeNull();
        await deleteTeam(owner, team.id);
        expect(await prisma.team.count({ where: { id: team.id } })).toBe(0);
        // The tombstone and its time stay.
        expect(await prisma.project.count({ where: { id: w.projectId } })).toBe(1);
        expect(await prisma.timeEntry.count({ where: { projectId: w.projectId } })).toBe(1);
    });

    describe('two-tenant isolation', () => {
        it("one workspace's purge leaves another's projects, and an outsider never reads a tombstone", async () => {
            const w = await world('TBI');
            await addTimeEntry(member, { workItemId: w.itemId, workDate: day(24), minutes: 10 });
            await deleteProject(owner, w.projectId);

            const otherTenant = (await createTenantWithDek({ name: `${TAG}x`, slug: `${TAG}x` })).id;
            const ou = await prisma.user.create({ data: { email: `outsider-${TAG}@example.test`, name: 'outsider' } });
            await prisma.tenantMembership.create({ data: { tenantId: otherTenant, userId: ou.id, role: 'OWNER' } });
            const outsider = makeRequestContext('OWNER', { tenantId: otherTenant, tenantSlug: `${TAG}x`, userId: ou.id, requestId: `${TAG}-outsider` });
            // The outsider's purge reaches nothing of this workspace.
            expect(await purge(outsider)).toMatchObject({ items: 0, projects: 0, tombstones: 0 });
            expect((await prisma.project.findUniqueOrThrow({ where: { id: w.projectId } })).purgedAt).toBeNull();
            await purge(owner);
            expect((await prisma.project.findUniqueOrThrow({ where: { id: w.projectId } })).purgedAt).toBeInstanceOf(Date);
            expect(await runInTenantContext(outsider, (db) => db.project.count({ where: { id: w.projectId } }))).toBe(0);
            expect(await reasonOf(restoreProject(outsider, w.projectId))).toMatch(/404/);
        });

        it('kept the audit chain whole', async () => {
            expect((await verifyAuditChain(tenantId)).valid).toBe(true);
        });
    });
});
