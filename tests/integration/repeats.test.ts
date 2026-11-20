/**
 * Repeats against a real Postgres, as `app_user` (sub-phase 2.5d;
 * docs/porting/maps/2.5.md; owner decisions 67 to 70):
 *
 *   - what migration `20261124120000_repeats` adds: the CHECKs, the
 *     occurrence unique, the rule link's ON DELETE SET NULL ("recurrenceId");
 *   - setting a repeat: a due date needed, the keys, the owner, the next date;
 *   - the job: a copy as the owner (never the system user) through the
 *     create path, what it takes from the source as it is then, nothing twice
 *     on a re-run or a concurrent run, only the latest missed occurrence
 *     after an outage;
 *   - holds: the owner gone or without the key, the source deleted, the
 *     project archived, the end reached; each written as the system user,
 *     naming the owner; resuming makes the caller the owner;
 *   - stopping keeps the items; every write audited, and the chain verifies.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { addDays, dayKey } from '@/app-layer/domain/cycle';
import { todayInTz } from '@/app-layer/notifications/work-item-due';
import { processWorkItemRecurrence } from '@/app-layer/jobs/work-item-recurrence';
import { createCustomField } from '@/app-layer/usecases/custom-field';
import { createLabel } from '@/app-layer/usecases/label';
import { createMilestone } from '@/app-layer/usecases/milestone';
import { createProject, setProjectArchived } from '@/app-layer/usecases/project';
import { getWorkItemSeries, removeWorkItemRecurrence, setWorkItemRecurrence } from '@/app-layer/usecases/recurrence';
import { createTeam } from '@/app-layer/usecases/team';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createWorkItem, deleteWorkItem, getWorkItem, listSubItems } from '@/app-layer/usecases/work-item';
import { verifyAuditChain } from '@/lib/audit';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `rep${Date.now().toString(36)}`;
const RULE = { frequency: 'DAILY' as const, interval: 1, weekdays: [], leadDays: 0 };

describeFn('repeats', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let member: RequestContext;
    let other: RequestContext;
    let viewer: RequestContext;
    let memberMembershipId = '';
    let teamId = '';
    let projectId = '';
    let typeId = '';
    let today: Date;
    const k = (n: number) => dayKey(addDays(today, n));
    const noon = (n: number) => new Date(`${k(n)}T12:00:00.000Z`);
    const run = (n: number) => processWorkItemRecurrence({ tenantId, now: noon(n), tz: 'UTC' });
    const copiesOf = (recurrenceId: string) =>
        prisma.workItem.findMany({ where: { tenantId, recurrenceId }, orderBy: { occurrenceOn: 'asc' }, select: { id: true, occurrenceOn: true, createdByUserId: true } });

    beforeAll(async () => {
        process.env.NOTIFICATIONS_TZ = 'UTC';
        today = todayInTz(new Date(), 'UTC');
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const mk = async (role: 'OWNER' | 'MEMBER' | 'VIEWER', n: string) => {
            const u = await prisma.user.create({ data: { email: `${n}-${TAG}@example.test`, name: n } });
            const m = await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            return { ctx: makeRequestContext(role, { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-${n}` }), id: m.id };
        };
        owner = (await mk('OWNER', 'olive')).ctx;
        const m = await mk('MEMBER', 'max');
        member = m.ctx;
        memberMembershipId = m.id;
        other = (await mk('MEMBER', 'mia')).ctx;
        viewer = (await mk('VIEWER', 'vic')).ctx;
        teamId = (await createTeam(owner, { name: 'Core' })).id;
        projectId = (await createProject(owner, { teamId, name: 'Repeats', keyPrefix: 'REP' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    const item = (title: string, due = 0, extra: Record<string, unknown> = {}) =>
        createWorkItem(member, { projectId, typeId, title, dueDate: k(due), ...extra });

    describe('what the migration adds', () => {
        it('the CHECKs and the occurrence unique bite', async () => {
            const source = await item('catalogue');
            const base = { tenantId, sourceWorkItemId: source.id, frequency: 'DAILY' as const, firstOn: today, ownerUserId: member.userId };
            await expect(prisma.workItemRecurrence.create({ data: { ...base, interval: 0 } })).rejects.toThrow(/WorkItemRecurrence_interval_range/);
            await expect(prisma.workItemRecurrence.create({ data: { ...base, leadDays: 31 } })).rejects.toThrow(/WorkItemRecurrence_lead_days_range/);
            await expect(prisma.workItemRecurrence.create({ data: { ...base, weekdays: [1] } })).rejects.toThrow(/WorkItemRecurrence_weekdays_valid/);
            await expect(prisma.workItemRecurrence.create({ data: { ...base, heldAt: new Date() } })).rejects.toThrow(/WorkItemRecurrence_held_has_reason/);
            const rule = await prisma.workItemRecurrence.create({ data: base });
            await expect(prisma.workItem.update({ where: { id: source.id }, data: { recurrenceId: rule.id } })).rejects.toThrow(/WorkItem_occurrence_has_date/);
            const a = await item('copy a');
            const b = await item('copy b');
            await prisma.workItem.update({ where: { id: a.id }, data: { recurrenceId: rule.id, occurrenceOn: today } });
            await expect(prisma.workItem.update({ where: { id: b.id }, data: { recurrenceId: rule.id, occurrenceOn: today } })).rejects.toThrow();
            const [fk] = await prisma.$queryRaw<Array<{ setcols: number }>>`
                SELECT cardinality(confdelsetcols)::int AS setcols FROM pg_constraint WHERE conname = 'WorkItem_recurrenceId_tenantId_fkey'`;
            expect(fk?.setcols).toBe(1);
            await prisma.workItemRecurrence.delete({ where: { id: rule.id } });
            expect(await prisma.workItem.findUnique({ where: { id: a.id }, select: { tenantId: true, recurrenceId: true, occurrenceOn: true } })).toEqual({
                tenantId,
                recurrenceId: null,
                occurrenceOn: today,
            });
        });
    });

    describe('setting a repeat', () => {
        it('needs a due date and both keys; the caller owns it and the next date is stamped', async () => {
            const undated = await createWorkItem(member, { projectId, typeId, title: 'no due date' });
            await expect(setWorkItemRecurrence(member, undated.id, RULE)).rejects.toMatchObject({ status: 409, details: { reason: 'RECURRENCE_NEEDS_DUE_DATE' } });
            const source = await item('weekly thing');
            await expect(setWorkItemRecurrence(viewer, source.id, { ...RULE, frequency: 'WEEKLY' })).rejects.toMatchObject({ status: 403 });
            const rule = await setWorkItemRecurrence(member, source.id, { frequency: 'WEEKLY', interval: 2, weekdays: [today.getUTCDay()], leadDays: 3 });
            expect(rule).toMatchObject({ frequency: 'WEEKLY', interval: 2, firstOn: k(0), nextOccurrenceOn: k(14), ownerUserId: member.userId, heldAt: null });
            expect((await getWorkItemSeries(viewer, source.id)).rule?.id).toBe(rule.id);
            await expect(setWorkItemRecurrence(member, source.id, { ...RULE, frequency: 'MONTHLY', weekdays: [], endsOn: k(-1) })).rejects.toMatchObject({ status: 400 });
        });
    });

    describe('the job', () => {
        let ruleId = '';
        let sourceId = '';

        it('makes the occurrence as the owner, from the source as it is, and nothing twice', async () => {
            const label = await createLabel(owner, { name: 'Chore' });
            const field = await createCustomField(owner, projectId, { name: 'Area', type: 'SELECT', options: [{ name: 'Ops' }] });
            const milestone = await createMilestone(owner, projectId, { name: 'Q4' });
            const source = await item('Water the plants', 0, {
                description: 'Every pot',
                priority: 'HIGH',
                labelIds: [label.id],
                assigneeId: other.userId,
                startDate: k(-2),
                milestoneId: milestone.id,
                customFields: { [field.id]: field.options[0]!.id },
            });
            await createWorkItem(member, { projectId, typeId, title: 'Fill the can', parentId: source.id });
            sourceId = source.id;
            ruleId = (await setWorkItemRecurrence(member, source.id, RULE)).id;

            expect((await run(0)).created).toBe(0);
            const first = await run(1);
            expect(first).toMatchObject({ created: 1, held: 0 });
            const [made] = await copiesOf(ruleId);
            expect(made).toMatchObject({ occurrenceOn: addDays(today, 1), createdByUserId: member.userId });
            const copy = await getWorkItem(member, made!.id);
            expect(copy).toMatchObject({
                title: 'Water the plants',
                description: 'Every pot',
                priority: 'HIGH',
                labelIds: [label.id],
                assigneeId: other.userId,
                dueDate: k(1),
                startDate: k(-1),
                milestoneId: milestone.id,
                cycleId: null,
                customFields: { [field.id]: field.options[0]!.id },
            });
            expect(copy.state.category).not.toBe('DONE');
            expect((await listSubItems(member, copy.id)).items.map((s) => s.title)).toEqual(['Fill the can']);
            const entry = await prisma.auditLog.findFirst({ where: { tenantId, action: 'WORK_ITEM_CREATED', entityId: copy.id } });
            expect(entry?.userId).toBe(member.userId);
            expect(entry?.metadataJson).toMatchObject({ recurrenceId: ruleId, occurrenceOn: k(1) });
            expect((await getWorkItemSeries(member, copy.id)).occurrenceOf).toMatchObject({ id: source.id, occurrenceOn: k(1) });

            // A re-run and two concurrent runs make nothing more.
            expect((await run(1)).created).toBe(0);
            await Promise.all([run(1), run(1)]);
            expect(await copiesOf(ruleId)).toHaveLength(1);
        });

        it('after an outage makes only the latest missed occurrence and counts the rest', async () => {
            const r = await run(5);
            expect(r).toMatchObject({ created: 1, skippedOccurrences: 3 });
            expect((await copiesOf(ruleId)).map((c) => dayKey(c.occurrenceOn!))).toEqual([k(1), k(5)]);
            expect((await prisma.workItemRecurrence.findUnique({ where: { id: ruleId } }))?.nextOccurrenceOn).toEqual(addDays(today, 6));
        });

        it('a repeat whose owner left is held, written as the system user, naming the owner; resuming makes the caller the owner', async () => {
            await prisma.tenantMembership.update({ where: { id: memberMembershipId }, data: { status: 'DEACTIVATED' } });
            const r = await run(6);
            expect(r).toMatchObject({ created: 0, held: 1 });
            const held = await prisma.workItemRecurrence.findUnique({ where: { id: ruleId } });
            expect(held).toMatchObject({ heldReason: 'OWNER_NOT_ACTIVE' });
            const entry = await prisma.auditLog.findFirst({ where: { tenantId, action: 'RECURRENCE_HELD', entityId: ruleId } });
            expect(entry?.userId).toBe(`sys_${tenantId}`);
            expect(entry?.metadataJson).toMatchObject({ reason: 'OWNER_NOT_ACTIVE', ownerUserId: member.userId });
            expect((await copiesOf(ruleId)).every((c) => c.createdByUserId !== `sys_${tenantId}`)).toBe(true);

            const resumed = await setWorkItemRecurrence(other, sourceId, RULE);
            expect(resumed).toMatchObject({ ownerUserId: other.userId, heldAt: null, heldReason: null, nextOccurrenceOn: k(1) });
            await prisma.tenantMembership.update({ where: { id: memberMembershipId }, data: { status: 'ACTIVE' } });
        });

        it('holds for a lost key, a deleted source, an archived project and a reached end', async () => {
            // Lost key: the owner is now a VIEWER.
            const a = await item('a');
            const ra = await setWorkItemRecurrence(member, a.id, RULE);
            await prisma.tenantMembership.update({ where: { id: memberMembershipId }, data: { role: 'VIEWER' } });
            await run(1);
            expect((await prisma.workItemRecurrence.findUnique({ where: { id: ra.id } }))?.heldReason).toBe('OWNER_NOT_PERMITTED');
            await prisma.tenantMembership.update({ where: { id: memberMembershipId }, data: { role: 'MEMBER' } });

            const b = await item('b');
            const rb = await setWorkItemRecurrence(member, b.id, RULE);
            await deleteWorkItem(owner, b.id);
            await run(1);
            expect((await prisma.workItemRecurrence.findUnique({ where: { id: rb.id } }))?.heldReason).toBe('SOURCE_DELETED');

            const shelf = await createProject(owner, { teamId, name: 'Shelf', keyPrefix: 'SHF' });
            const c = await createWorkItem(member, { projectId: shelf.id, typeId, title: 'c', dueDate: k(0) });
            const rc = await setWorkItemRecurrence(member, c.id, RULE);
            await setProjectArchived(owner, shelf.id, true);
            await run(1);
            expect((await prisma.workItemRecurrence.findUnique({ where: { id: rc.id } }))?.heldReason).toBe('PROJECT_ARCHIVED');

            const d = await item('d');
            const rd = await setWorkItemRecurrence(member, d.id, { ...RULE, maxOccurrences: 2 });
            expect((await run(1)).created).toBeGreaterThanOrEqual(1);
            const ended = await prisma.workItemRecurrence.findUnique({ where: { id: rd.id } });
            expect(ended).toMatchObject({ heldReason: 'ENDED', nextOccurrenceOn: null, occurrenceCount: 1 });
            expect(await copiesOf(rd.id)).toHaveLength(1);
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'RECURRENCE_ENDED', entityId: rd.id } })).toBe(1);
        });

        it('putting a repeat on hold keeps its owner; stopping it keeps its items', async () => {
            const held = await setWorkItemRecurrence(other, sourceId, { ...RULE, onHold: true });
            expect(held).toMatchObject({ ownerUserId: other.userId, heldReason: 'HELD_BY_MEMBER' });
            expect((await run(2)).created).toBe(0);
            await expect(removeWorkItemRecurrence(viewer, sourceId)).rejects.toMatchObject({ status: 403 });
            await removeWorkItemRecurrence(member, sourceId);
            expect(await prisma.workItemRecurrence.count({ where: { id: ruleId } })).toBe(0);
            const kept = await prisma.workItem.findMany({ where: { tenantId, occurrenceOn: { not: null }, recurrenceId: null, title: 'Water the plants' } });
            expect(kept).toHaveLength(2);
        });
    });

    it('every repeat write is audited, and the audit chain verifies', async () => {
        const actions = (await prisma.auditLog.groupBy({ by: ['action'], where: { tenantId, action: { startsWith: 'RECURRENCE_' } } })).map((a) => a.action).sort();
        expect(actions).toEqual(['RECURRENCE_ENDED', 'RECURRENCE_HELD', 'RECURRENCE_REMOVED', 'RECURRENCE_RESUMED', 'RECURRENCE_SET']);
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });
});
