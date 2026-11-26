/**
 * Estimates (sub-phase 3.4a; docs/porting/maps/3.4.md, "Estimates (3.4a)";
 * ADR 0012 §1; ADR 0002 §18; owner decisions 257 to 259), against a real
 * Postgres:
 *
 *   - the catalogue: the two ranges on the item and the template, the
 *     transition trigger watching both columns, the field-set CHECK;
 *   - a team's unit: set under admin.manage, audited, moving no value;
 *   - the estimate write: off (409 `ESTIMATES_OFF`), another unit (400
 *     `ESTIMATE_UNIT`), out of range, the column of the CURRENT unit only,
 *     the other kept and restored on a switch back, versioned and audited;
 *   - creates in the unit's column, and refusals;
 *   - the transition record and the burn-up's Points and Hours measures,
 *     `MEASURE_UNAVAILABLE`;
 *   - copies: an item template, a project template's starter items and item
 *     templates, a repeat; a copy under another unit skipped as
 *     `estimate:unit`; a move keeping the value.
 */
import type { PrismaClient } from '@prisma/client';

import { processWorkItemRecurrence } from '@/app-layer/jobs/work-item-recurrence';
import type { RequestContext } from '@/app-layer/types';
import { addDays, dayKey } from '@/app-layer/domain/cycle';
import { todayInTz } from '@/app-layer/notifications/work-item-due';
import { createCycle, getCycleBurnUp, setWorkItemCycle } from '@/app-layer/usecases/cycle';
import { createProject } from '@/app-layer/usecases/project';
import { saveProjectAsTemplate } from '@/app-layer/usecases/project-template';
import { setWorkItemRecurrence } from '@/app-layer/usecases/recurrence';
import { createTeam, updateTeam } from '@/app-layer/usecases/team';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createWorkItem, getWorkItem, listWorkItems, setWorkItemState } from '@/app-layer/usecases/work-item';
import { setWorkItemEstimate } from '@/app-layer/usecases/work-item-estimate';
import { createWorkItemTemplate, listWorkItemTemplates } from '@/app-layer/usecases/work-item-template';
import { moveWorkItemToProject } from '@/app-layer/usecases/work-item-moves';
import { getWorkItemViewConfig } from '@/app-layer/usecases/work-item-views';
import { setTypeField } from '@/app-layer/usecases/field-set';
import { verifyAuditChain } from '@/lib/audit';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `est${Date.now().toString(36)}`;

/** The error's `details.reason`, or its status and message. */
async function reasonOf(p: Promise<unknown>): Promise<string> {
    try {
        await p;
    } catch (err) {
        const e = err as { details?: { reason?: string }; status?: number; message?: string };
        return e.details?.reason ?? `${e.status ?? ''} ${e.message ?? ''}`;
    }
    return 'no error';
}

describeFn('estimates (3.4a)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let member: RequestContext;
    let viewer: RequestContext;
    let pointsTeam = '';
    let hoursTeam = '';
    let offTeam = '';
    let pointsProject = '';
    let hoursProject = '';
    let offProject = '';
    let typeId = '';
    let doneStateId = '';
    let today: Date;
    const savedTz = process.env.NOTIFICATIONS_TZ;
    const k = (n: number) => dayKey(addDays(today, n));

    beforeAll(async () => {
        process.env.NOTIFICATIONS_TZ = 'UTC';
        today = todayInTz(new Date(), 'UTC');
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const mk = async (who: string, role: 'OWNER' | 'MEMBER' | 'VIEWER') => {
            const u = await prisma.user.create({ data: { email: `${who}-${TAG}@example.test`, name: who } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            return makeRequestContext(role, { tenantId, tenantSlug: TAG, userId: u.id, requestId: `${TAG}-${who}` });
        };
        owner = await mk('owner', 'OWNER');
        member = await mk('member', 'MEMBER');
        viewer = await mk('viewer', 'VIEWER');
        const p = await createTeam(owner, { name: 'Points team' });
        pointsTeam = p.id;
        doneStateId = p.workflowStates.find((s) => s.category === 'DONE')!.id;
        hoursTeam = (await createTeam(owner, { name: 'Hours team' })).id;
        offTeam = (await createTeam(owner, { name: 'No estimates' })).id;
        await updateTeam(owner, pointsTeam, { estimateUnit: 'POINTS' });
        await updateTeam(owner, hoursTeam, { estimateUnit: 'HOURS' });
        pointsProject = (await createProject(owner, { teamId: pointsTeam, name: 'Points', keyPrefix: 'PTS' })).id;
        hoursProject = (await createProject(owner, { teamId: hoursTeam, name: 'Hours', keyPrefix: 'HRS' })).id;
        offProject = (await createProject(owner, { teamId: offTeam, name: 'Off', keyPrefix: 'OFF' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
    });

    afterAll(async () => {
        process.env.NOTIFICATIONS_TZ = savedTz;
        await resetDatabase(prisma);
    });

    describe('the catalogue', () => {
        it('the ranges hold on the item and the template; the trigger watches both columns; the field set takes estimate', async () => {
            const checks = await prisma.$queryRaw<Array<{ conname: string; def: string }>>`
                SELECT conname::text, pg_get_constraintdef(oid)::text AS def FROM pg_constraint
                 WHERE conname IN ('WorkItem_estimate_points_range', 'WorkItem_estimate_minutes_range',
                                   'WorkItemTemplate_estimate_points_range', 'WorkItemTemplate_estimate_minutes_range', 'WorkItemTypeField_built_in_known')
                 ORDER BY conname`;
            expect(checks.map((c) => c.conname)).toEqual([
                'WorkItemTemplate_estimate_minutes_range',
                'WorkItemTemplate_estimate_points_range',
                'WorkItemTypeField_built_in_known',
                'WorkItem_estimate_minutes_range',
                'WorkItem_estimate_points_range',
            ]);
            expect(checks.find((c) => c.conname === 'WorkItemTypeField_built_in_known')!.def).toContain(`'estimate'`);
            expect(checks.find((c) => c.conname === 'WorkItem_estimate_points_range')!.def).toContain('"estimatePoints" <= 100');
            expect(checks.find((c) => c.conname === 'WorkItem_estimate_minutes_range')!.def).toContain('"estimateMinutes" <= 60000');
            const [trg] = await prisma.$queryRaw<Array<{ def: string }>>`
                SELECT pg_get_triggerdef(oid)::text AS def FROM pg_trigger WHERE tgname = 'work_item_transition_update'`;
            expect(trg?.def).toMatch(/UPDATE OF "stateId", "cycleId", "milestoneId", "projectId", "deletedAt", "waitingOnUserId", "estimatePoints", "estimateMinutes"/);
            expect(trg?.def).not.toContain('goalId');
        });

        it('the CHECKs refuse a value out of range for any writer', async () => {
            const item = await createWorkItem(owner, { projectId: pointsProject, typeId, title: 'check bite' });
            await expect(prisma.workItem.update({ where: { id: item.id }, data: { estimatePoints: 101 } })).rejects.toThrow(/WorkItem_estimate_points_range/);
            await expect(prisma.workItem.update({ where: { id: item.id }, data: { estimateMinutes: 60_001 } })).rejects.toThrow(/WorkItem_estimate_minutes_range/);
            await expect(prisma.workItem.update({ where: { id: item.id }, data: { estimatePoints: -1 } })).rejects.toThrow(/WorkItem_estimate_points_range/);
        });
    });

    describe("a team's unit", () => {
        it('is set under admin.manage, audited naming the field, and the view configuration carries it', async () => {
            const t = await createTeam(owner, { name: 'Switcher' });
            await expect(updateTeam(member, t.id, { estimateUnit: 'POINTS' })).rejects.toMatchObject({ status: 403 });
            await expect(updateTeam(owner, t.id, { estimateUnit: 'POINTS' })).resolves.toMatchObject({ estimateUnit: 'POINTS' });
            const entry = await prisma.auditLog.findFirst({ where: { tenantId, action: 'TEAM_UPDATED', entityId: t.id }, orderBy: { createdAt: 'desc' } });
            expect((entry?.detailsJson as { changedFields?: string[] })?.changedFields).toEqual(['estimateUnit']);
            expect(entry?.metadataJson).toMatchObject({ fromEstimateUnit: null, toEstimateUnit: 'POINTS' });
            const config = await getWorkItemViewConfig(member, {});
            expect(config.teams.find((x) => x.id === t.id)).toMatchObject({ estimateUnit: 'POINTS' });
            expect(config.teams.find((x) => x.id === offTeam)).toMatchObject({ estimateUnit: null });
            // The same value again changes and audits nothing.
            const count = await prisma.auditLog.count({ where: { tenantId, action: 'TEAM_UPDATED', entityId: t.id } });
            await updateTeam(owner, t.id, { estimateUnit: 'POINTS' });
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'TEAM_UPDATED', entityId: t.id } })).toBe(count);
        });
    });

    describe('the estimate write', () => {
        it('a team that does not estimate takes none, clearing included', async () => {
            const item = await createWorkItem(member, { projectId: offProject, typeId, title: 'no estimates here' });
            expect(await reasonOf(setWorkItemEstimate(member, item.id, { value: 3 }))).toBe('ESTIMATES_OFF');
            expect(await reasonOf(setWorkItemEstimate(member, item.id, { value: null }))).toBe('ESTIMATES_OFF');
        });

        it('writes the current unit\'s column, refuses another unit and out-of-range values, and keeps the other column across a switch', async () => {
            const t = await createTeam(owner, { name: 'Flip' });
            await updateTeam(owner, t.id, { estimateUnit: 'POINTS' });
            const project = await createProject(owner, { teamId: t.id, name: 'Flip', keyPrefix: 'FLP' });
            const item = await createWorkItem(member, { projectId: project.id, typeId, title: 'flip' });
            expect(await reasonOf(setWorkItemEstimate(member, item.id, { value: 5, unit: 'HOURS' }))).toBe('ESTIMATE_UNIT');
            expect(await reasonOf(setWorkItemEstimate(member, item.id, { value: 101 }))).toBe('ESTIMATE_RANGE');
            await expect(setWorkItemEstimate(viewer, item.id, { value: 5 })).rejects.toMatchObject({ status: 403 });
            const set = await setWorkItemEstimate(member, item.id, { value: 5, unit: 'POINTS' }, item.version);
            expect(set).toMatchObject({ estimatePoints: 5, estimateMinutes: null, version: item.version + 1 });
            const audit = await prisma.auditLog.findFirst({ where: { tenantId, action: 'WORK_ITEM_ESTIMATE_CHANGED', entityId: item.id } });
            expect(audit?.metadataJson).toMatchObject({ estimateUnit: 'POINTS', from: null, to: 5 });
            expect((audit?.detailsJson as { changedFields?: string[] })?.changedFields).toEqual(['estimatePoints']);
            // A stale version is a conflict.
            await expect(setWorkItemEstimate(member, item.id, { value: 8 }, item.version)).rejects.toMatchObject({ status: 409 });
            // The team switches to hours: the points stay, hidden, and a write sets minutes only.
            await updateTeam(owner, t.id, { estimateUnit: 'HOURS' });
            expect(await getWorkItem(member, item.id)).toMatchObject({ estimatePoints: 5, estimateMinutes: null });
            expect(await setWorkItemEstimate(member, item.id, { value: 150, unit: 'HOURS' })).toMatchObject({ estimatePoints: 5, estimateMinutes: 150 });
            // Clearing clears the current unit only.
            expect(await setWorkItemEstimate(member, item.id, { value: null })).toMatchObject({ estimatePoints: 5, estimateMinutes: null });
            // Back to points: the old value is the estimate again.
            await updateTeam(owner, t.id, { estimateUnit: 'POINTS' });
            expect(await getWorkItem(member, item.id)).toMatchObject({ estimatePoints: 5 });
        });

        it('a closed item may be estimated; an unchanged value writes nothing', async () => {
            const item = await createWorkItem(member, { projectId: pointsProject, typeId, title: 'closed one' });
            await setWorkItemState(member, item.id, { stateId: doneStateId });
            const set = await setWorkItemEstimate(member, item.id, { value: 2 });
            expect(set.estimatePoints).toBe(2);
            const again = await setWorkItemEstimate(member, item.id, { value: 2 });
            expect(again.version).toBe(set.version);
        });

        it('the field set may require or hide it, and ignores a rule on a team that does not estimate', async () => {
            const required = (await import('@/app-layer/usecases/work-item-type')).createWorkItemType;
            const strict = await required(owner, { name: 'Sized' });
            await setTypeField(owner, strict.id, { field: 'estimate', requirement: 'REQUIRED' });
            expect(await reasonOf(createWorkItem(member, { projectId: pointsProject, typeId: strict.id, title: 'unsized' }))).toBe('FIELD_SET_UNMET');
            const sized = await createWorkItem(member, { projectId: pointsProject, typeId: strict.id, title: 'sized', estimatePoints: 3 });
            expect(sized.estimatePoints).toBe(3);
            expect(await reasonOf(setWorkItemEstimate(member, sized.id, { value: null }))).toBe('FIELD_SET_UNMET');
            // A team that does not estimate cannot meet the rule, so it is ignored.
            await expect(createWorkItem(member, { projectId: offProject, typeId: strict.id, title: 'off and fine' })).resolves.toMatchObject({ estimatePoints: null });
        });
    });

    describe('creates', () => {
        it("take the estimate in the unit's column and refuse the other, and any on a team that does not estimate", async () => {
            expect(await createWorkItem(member, { projectId: hoursProject, typeId, title: 'timed', estimateMinutes: 90 })).toMatchObject({ estimateMinutes: 90, estimatePoints: null });
            expect(await reasonOf(createWorkItem(member, { projectId: hoursProject, typeId, title: 'wrong unit', estimatePoints: 3 }))).toBe('ESTIMATE_UNIT');
            expect(await reasonOf(createWorkItem(member, { projectId: offProject, typeId, title: 'off', estimatePoints: 3 }))).toBe('ESTIMATES_OFF');
            const made = await createWorkItem(member, { projectId: pointsProject, typeId, title: 'pointed', estimatePoints: 8 });
            const entry = await prisma.auditLog.findFirst({ where: { tenantId, action: 'WORK_ITEM_CREATED', entityId: made.id } });
            expect(entry?.metadataJson).toMatchObject({ estimateUnit: 'POINTS', estimate: 8 });
            expect((await listWorkItems(member, { projectId: pointsProject })).items.find((i) => i.id === made.id)).toMatchObject({ estimatePoints: 8 });
        });
    });

    describe('the transition record and the burn-up', () => {
        it('records each estimate change and counts points, with unestimated items named; hours are refused on a points team', async () => {
            const cycle = await createCycle(owner, { teamId: pointsTeam, startsOn: k(-1), endsOn: k(12) });
            const a = await createWorkItem(member, { projectId: pointsProject, typeId, title: 'burn a', estimatePoints: 3 });
            const b = await createWorkItem(member, { projectId: pointsProject, typeId, title: 'burn b' });
            const c = await createWorkItem(member, { projectId: pointsProject, typeId, title: 'burn c', estimatePoints: 5 });
            for (const i of [a, b, c]) await setWorkItemCycle(member, i.id, { cycleId: cycle.id });
            await setWorkItemState(member, c.id, { stateId: doneStateId });
            await setWorkItemEstimate(member, a.id, { value: 4 });
            const rows = await prisma.workItemTransition.findMany({ where: { tenantId, workItemId: a.id }, orderBy: { id: 'asc' }, select: { estimatePoints: true } });
            expect(rows.map((r) => r.estimatePoints)).toEqual([3, 3, 4]);

            const items = await getCycleBurnUp(viewer, cycle.id);
            expect(items).toMatchObject({ measure: 'items', measures: ['items', 'points'] });
            expect(items.points.at(-1)).toEqual({ date: dayKey(today), scope: 3, started: 1, completed: 1 });
            const points = await getCycleBurnUp(viewer, cycle.id, new Date(), 'points');
            expect(points.points.at(-1)).toEqual({ date: dayKey(today), scope: 9, started: 5, completed: 5, unestimated: 1 });
            expect(await reasonOf(getCycleBurnUp(viewer, cycle.id, new Date(), 'hours'))).toBe('MEASURE_UNAVAILABLE');
            // The team stops estimating: only items are offered.
            await updateTeam(owner, pointsTeam, { estimateUnit: null });
            expect(await reasonOf(getCycleBurnUp(viewer, cycle.id, new Date(), 'points'))).toBe('MEASURE_UNAVAILABLE');
            expect((await getCycleBurnUp(viewer, cycle.id)).measures).toEqual(['items']);
            await updateTeam(owner, pointsTeam, { estimateUnit: 'POINTS' });
        });
    });

    describe('copies and moves', () => {
        it('an item template carries the estimate; a use under another unit skips it, named', async () => {
            expect(await reasonOf(createWorkItemTemplate(member, offProject, { name: 'Off', title: 'off', estimatePoints: 2 }))).toBe('ESTIMATES_OFF');
            expect(await reasonOf(createWorkItemTemplate(member, pointsProject, { name: 'Wrong', title: 'wrong', estimateMinutes: 30 }))).toBe('ESTIMATE_UNIT');
            const t = await createWorkItemTemplate(member, pointsProject, { name: 'Sized', title: 'From a sized template', typeId, estimatePoints: 5 });
            expect(t).toMatchObject({ estimatePoints: 5, estimateMinutes: null });
            const made = await createWorkItem(member, { projectId: pointsProject, templateId: t.id });
            expect(made).toMatchObject({ estimatePoints: 5 });
            expect(made.templateSkipped ?? []).not.toContain('estimate:unit');
            // The request's own estimate wins.
            expect(await createWorkItem(member, { projectId: pointsProject, templateId: t.id, estimatePoints: 1 })).toMatchObject({ estimatePoints: 1 });
            // The team moves to hours: the template's points are skipped and named.
            await updateTeam(owner, pointsTeam, { estimateUnit: 'HOURS' });
            try {
                const skipped = await createWorkItem(member, { projectId: pointsProject, templateId: t.id });
                expect(skipped).toMatchObject({ estimatePoints: null, estimateMinutes: null });
                expect(skipped.templateSkipped).toContain('estimate:unit');
            } finally {
                await updateTeam(owner, pointsTeam, { estimateUnit: 'POINTS' });
            }
        });

        it("a project template carries starter items' and item templates' estimates; a team that does not estimate skips them, named", async () => {
            const source = await createProject(owner, { teamId: pointsTeam, name: 'Source', keyPrefix: 'SRC' });
            await createWorkItem(owner, { projectId: source.id, typeId, title: 'Sized starter', estimatePoints: 13 });
            await createWorkItemTemplate(owner, source.id, { name: 'Sized tpl', title: 'tpl', estimatePoints: 2 });
            const saved = await saveProjectAsTemplate(owner, { fromProjectId: source.id, name: 'Sized project', includeItems: true });
            const same = await createProject(owner, { teamId: pointsTeam, name: 'Same unit', keyPrefix: 'SAM', templateId: saved.id });
            expect((await listWorkItems(owner, { projectId: same.id })).items.find((i) => i.title === 'Sized starter')).toMatchObject({ estimatePoints: 13 });
            expect((await listWorkItemTemplates(owner, same.id)).find((x) => x.name === 'Sized tpl')).toMatchObject({ estimatePoints: 2 });
            const off = await createProject(owner, { teamId: offTeam, name: 'Off unit', keyPrefix: 'OFU', templateId: saved.id });
            expect((await listWorkItems(owner, { projectId: off.id })).items.find((i) => i.title === 'Sized starter')).toMatchObject({ estimatePoints: null, estimateMinutes: null });
            expect((await listWorkItemTemplates(owner, off.id)).find((x) => x.name === 'Sized tpl')).toMatchObject({ estimatePoints: null });
            const entry = await prisma.auditLog.findFirst({ where: { tenantId, action: 'PROJECT_CREATED', entityId: off.id } });
            expect(JSON.stringify(entry?.metadataJson)).toContain('estimate:unit');
        });

        it('a repeat copies its source\'s estimate', async () => {
            const source = await createWorkItem(member, { projectId: pointsProject, typeId, title: 'repeating', estimatePoints: 3, dueDate: k(0) });
            const rule = await setWorkItemRecurrence(member, source.id, { frequency: 'DAILY', interval: 1, weekdays: [], leadDays: 0 });
            await processWorkItemRecurrence({ tenantId, now: new Date(`${k(1)}T12:00:00.000Z`), tz: 'UTC' });
            const copies = await prisma.workItem.findMany({ where: { tenantId, recurrenceId: rule.id }, select: { estimatePoints: true } });
            expect(copies.length).toBeGreaterThan(0);
            expect(copies.every((c) => c.estimatePoints === 3)).toBe(true);
        });

        it('a move to a team with another unit keeps the value, hidden there and counted again on the way back', async () => {
            const item = await createWorkItem(member, { projectId: pointsProject, typeId, title: 'traveller', estimatePoints: 7 });
            await moveWorkItemToProject(member, item.id, { projectId: hoursProject });
            const there = await getWorkItem(member, item.id);
            expect(there).toMatchObject({ estimatePoints: 7, estimateMinutes: null, teamId: hoursTeam });
            await moveWorkItemToProject(member, item.id, { projectId: pointsProject });
            expect(await getWorkItem(member, item.id)).toMatchObject({ estimatePoints: 7, teamId: pointsTeam });
        });
    });

    it('the audit chain verifies', async () => {
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });
});
