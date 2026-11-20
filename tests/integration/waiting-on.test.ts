/**
 * Waiting on against a real Postgres, as `app_user` (sub-phase 2.4b-a;
 * docs/porting/maps/2.4b.md; ADR 0002 §14; owner decisions 103 to 107):
 *
 *   - what migration `20261128120100_waiting_on` adds beyond Prisma, in the
 *     catalogue and by its bite: the member FK (RESTRICT), the CHECK that a
 *     closed item waits on nobody, the transition trigger firing on it;
 *   - the single-field write: an active member only, the version increases,
 *     `If-Match` honoured, a closed item refused, the bell to the person
 *     named (never to whoever named themselves), audited;
 *   - every state path that closes an item clears it (single, bulk, board,
 *     duplicate, a state's delete), and a create into a closed state with
 *     one is refused;
 *   - the list filter (ids and none);
 *   - member removal clears it, audited; a deactivated member stays named;
 *   - a repeat copy takes its source's;
 *   - who may set it (MEMBER yes, VIEWER no), and the chain verifies.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { addDays, dayKey } from '@/app-layer/domain/cycle';
import { todayInTz } from '@/app-layer/notifications/work-item-due';
import { processWorkItemRecurrence } from '@/app-layer/jobs/work-item-recurrence';
import { createProject } from '@/app-layer/usecases/project';
import { setWorkItemRecurrence } from '@/app-layer/usecases/recurrence';
import { createTeam } from '@/app-layer/usecases/team';
import { removeTenantMember } from '@/app-layer/usecases/tenant-admin';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import {
    bulkSetWorkItemState,
    createWorkItem,
    getWorkItem,
    listWorkItems,
    setWorkItemState,
    setWorkItemWaitingOn,
} from '@/app-layer/usecases/work-item';
import { moveWorkItemOnBoard } from '@/app-layer/usecases/work-item-moves';
import { addWorkItemRelation } from '@/app-layer/usecases/work-item-relations';
import { createWorkflowState, deleteWorkflowState } from '@/app-layer/usecases/workflow-state';
import { verifyAuditChain } from '@/lib/audit';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `wait${Date.now().toString(36)}`;

describeFn('waiting on', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let member: RequestContext;
    let viewer: RequestContext;
    let leaver: { ctx: RequestContext; membershipId: string };
    let teamId = '';
    let projectId = '';
    let typeId = '';
    let todoStateId = '';
    let doneStateId = '';
    let cancelledStateId = '';
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
            const m = await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            return { ctx: makeRequestContext(role, { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-${n}` }), membershipId: m.id };
        };
        owner = (await mk('OWNER', 'olive')).ctx;
        member = (await mk('MEMBER', 'max')).ctx;
        viewer = (await mk('VIEWER', 'vic')).ctx;
        leaver = await mk('MEMBER', 'lea');
        const team = await createTeam(owner, { name: 'Core' });
        teamId = team.id;
        todoStateId = team.workflowStates.find((s) => s.isDefault)!.id;
        doneStateId = team.workflowStates.find((s) => s.category === 'DONE')!.id;
        cancelledStateId = team.workflowStates.find((s) => s.category === 'CANCELLED')!.id;
        projectId = (await createProject(owner, { teamId, name: 'Waiting', keyPrefix: 'WAI' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
    });

    afterAll(async () => {
        process.env.NOTIFICATIONS_TZ = savedTz;
        await resetDatabase(prisma);
    });

    const newItem = (title: string, extra: Record<string, unknown> = {}) => createWorkItem(owner, { projectId, typeId, title, ...extra });
    const waitingOf = async (id: string) => (await prisma.workItem.findUnique({ where: { id }, select: { waitingOnUserId: true } }))?.waitingOnUserId;
    const transitionsOf = (id: string) =>
        prisma.workItemTransition.findMany({ where: { tenantId, workItemId: id }, orderBy: { id: 'asc' }, select: { waitingOnUserId: true, stateCategory: true } });

    describe('what the migration adds', () => {
        it('the catalogue: the member FK is RESTRICT, the CHECK exists, the update trigger watches waitingOnUserId', async () => {
            const [fk] = await prisma.$queryRaw<Array<{ deltype: string }>>`
                SELECT confdeltype::text AS deltype FROM pg_constraint WHERE conname = 'WorkItem_tenantId_waitingOnUserId_fkey'`;
            expect(fk?.deltype).toBe('r');
            const [check] = await prisma.$queryRaw<Array<{ def: string }>>`
                SELECT pg_get_constraintdef(oid)::text AS def FROM pg_constraint WHERE conname = 'WorkItem_waiting_on_open_only'`;
            expect(check?.def).toMatch(/waitingOnUserId/);
            const [trg] = await prisma.$queryRaw<Array<{ def: string }>>`
                SELECT pg_get_triggerdef(oid)::text AS def FROM pg_trigger WHERE tgname = 'work_item_transition_update'`;
            expect(trg?.def).toMatch(/UPDATE OF "stateId", "cycleId", "milestoneId", "projectId", "deletedAt", "waitingOnUserId"/);
        });

        it('the CHECK refuses a closed item that names someone, and the FK a non-member', async () => {
            const item = await newItem('check bite', { waitingOnUserId: member.userId });
            await expect(
                prisma.workItem.update({ where: { id: item.id }, data: { stateId: doneStateId, stateCategory: 'DONE' } }),
            ).rejects.toThrow(/WorkItem_waiting_on_open_only/);
            const stranger = await prisma.user.create({ data: { email: `stranger-${TAG}@example.test`, name: 'stranger' } });
            await expect(prisma.workItem.update({ where: { id: item.id }, data: { waitingOnUserId: stranger.id } })).rejects.toThrow();
        });
    });

    describe('the single-field write', () => {
        it('names an active member, increases the version, honours If-Match, records a transition and rings one bell', async () => {
            const item = await newItem('ask max');
            const before = await transitionsOf(item.id);
            const after = await setWorkItemWaitingOn(member, item.id, { userId: owner.userId }, item.version);
            expect(after.waitingOnUserId).toBe(owner.userId);
            expect(after.version).toBe(item.version + 1);
            const rows = await transitionsOf(item.id);
            expect(rows).toHaveLength(before.length + 1);
            expect(rows.at(-1)?.waitingOnUserId).toBe(owner.userId);
            // A no-op writes nothing.
            await setWorkItemWaitingOn(member, item.id, { userId: owner.userId });
            expect(await transitionsOf(item.id)).toHaveLength(rows.length);
            expect((await getWorkItem(owner, item.id)).version).toBe(after.version);
            // A stale version is a 409.
            await expect(setWorkItemWaitingOn(member, item.id, { userId: member.userId }, item.version)).rejects.toMatchObject({ status: 409 });
            // The person named got one bell; whoever named themselves gets none.
            const bells = await prisma.notification.findMany({ where: { tenantId, type: 'WORK_ITEM_WAITING_ON', linkUrl: { contains: item.id } } });
            expect(bells.map((b) => b.userId)).toEqual([owner.userId]);
            await setWorkItemWaitingOn(member, item.id, { userId: member.userId });
            expect(await prisma.notification.count({ where: { tenantId, type: 'WORK_ITEM_WAITING_ON', userId: member.userId, linkUrl: { contains: item.id } } })).toBe(0);
            // Cleared.
            expect((await setWorkItemWaitingOn(member, item.id, { userId: null })).waitingOnUserId).toBeNull();
            const audit = await prisma.auditLog.count({ where: { tenantId, action: 'WORK_ITEM_WAITING_ON_CHANGED', entityId: item.id } });
            expect(audit).toBe(3);
        });

        it('refuses a non-member, a closed item and a VIEWER', async () => {
            const item = await newItem('refusals');
            const stranger = await prisma.user.create({ data: { email: `outsider-${TAG}@example.test`, name: 'outsider' } });
            await expect(setWorkItemWaitingOn(member, item.id, { userId: stranger.id })).rejects.toMatchObject({ status: 400 });
            await expect(setWorkItemWaitingOn(viewer, item.id, { userId: member.userId })).rejects.toMatchObject({ status: 403 });
            await setWorkItemState(owner, item.id, { stateId: doneStateId });
            await expect(setWorkItemWaitingOn(member, item.id, { userId: member.userId })).rejects.toMatchObject({ status: 409, details: { reason: 'ITEM_CLOSED' } });
            // Clearing a closed item's (already empty) value is a no-op, not a refusal.
            expect((await setWorkItemWaitingOn(member, item.id, { userId: null })).waitingOnUserId).toBeNull();
        });

        it('a create may name one, but not into a closed state', async () => {
            const made = await newItem('created waiting', { waitingOnUserId: member.userId });
            expect(made.waitingOnUserId).toBe(member.userId);
            const entry = await prisma.auditLog.findFirst({ where: { tenantId, action: 'WORK_ITEM_CREATED', entityId: made.id } });
            expect(entry?.metadataJson).toMatchObject({ waitingOnUserId: member.userId });
            expect(await prisma.notification.count({ where: { tenantId, type: 'WORK_ITEM_WAITING_ON', userId: member.userId, linkUrl: { contains: made.id } } })).toBe(1);
            await expect(newItem('closed at birth', { waitingOnUserId: member.userId, stateId: doneStateId })).rejects.toMatchObject({
                status: 409,
                details: { reason: 'ITEM_CLOSED' },
            });
        });
    });

    describe('every move into a closed state clears it', () => {
        const waiting = (title: string) => newItem(title, { waitingOnUserId: member.userId });

        it('a single state change, and a reopen does not restore it', async () => {
            const item = await waiting('single');
            await setWorkItemState(owner, item.id, { stateId: doneStateId });
            expect(await waitingOf(item.id)).toBeNull();
            await setWorkItemState(owner, item.id, { stateId: todoStateId });
            expect(await waitingOf(item.id)).toBeNull();
            expect((await transitionsOf(item.id)).map((t) => [t.stateCategory, t.waitingOnUserId])).toEqual([
                ['UNSTARTED', member.userId],
                ['DONE', null],
                ['UNSTARTED', null],
            ]);
        });

        it('the bulk state change', async () => {
            const a = await waiting('bulk a');
            const b = await waiting('bulk b');
            await bulkSetWorkItemState(owner, { workItemIds: [a.id, b.id], stateCategory: 'CANCELLED' });
            expect(await waitingOf(a.id)).toBeNull();
            expect(await waitingOf(b.id)).toBeNull();
        });

        it('a board drop', async () => {
            const item = await waiting('board');
            await moveWorkItemOnBoard(owner, item.id, { stateId: doneStateId });
            expect(await waitingOf(item.id)).toBeNull();
        });

        it('marking a duplicate', async () => {
            const original = await newItem('original');
            const dup = await waiting('duplicate');
            await addWorkItemRelation(owner, dup.id, { type: 'DUPLICATES', toId: original.id });
            expect(await waitingOf(dup.id)).toBeNull();
            expect((await getWorkItem(owner, dup.id)).stateId).toBe(cancelledStateId);
        });

        it("a state's delete that moves its items into a closed state", async () => {
            const parked = await createWorkflowState(owner, teamId, { name: `Parked ${TAG}`, category: 'STARTED' });
            const item = await waiting('in a doomed state');
            await setWorkItemState(owner, item.id, { stateId: parked.id });
            expect(await waitingOf(item.id)).toBe(member.userId);
            await deleteWorkflowState(owner, parked.id, { moveToStateId: doneStateId });
            expect(await waitingOf(item.id)).toBeNull();
        });
    });

    it('the list filter reads ids and none', async () => {
        const named = await newItem('filter named', { waitingOnUserId: owner.userId });
        const nobody = await newItem('filter nobody');
        const byOwner = await listWorkItems(owner, { projectId, waitingOnId: owner.userId, limit: 100 });
        expect(byOwner.items.map((i) => i.id)).toContain(named.id);
        expect(byOwner.items.map((i) => i.id)).not.toContain(nobody.id);
        const none = await listWorkItems(owner, { projectId, waitingOnId: 'none', limit: 100 });
        expect(none.items.map((i) => i.id)).toContain(nobody.id);
        expect(none.items.map((i) => i.id)).not.toContain(named.id);
    });

    it('a deactivated member stays named; removing a member clears it, audited, versions increased', async () => {
        const item = await newItem('waits on lea', { waitingOnUserId: leaver.ctx.userId });
        await prisma.tenantMembership.update({ where: { id: leaver.membershipId }, data: { status: 'DEACTIVATED' } });
        expect(await waitingOf(item.id)).toBe(leaver.ctx.userId);
        const before = (await getWorkItem(owner, item.id)).version;
        await removeTenantMember(owner, { membershipId: leaver.membershipId });
        expect(await waitingOf(item.id)).toBeNull();
        expect((await getWorkItem(owner, item.id)).version).toBe(before + 1);
        expect(await prisma.auditLog.count({ where: { tenantId, action: 'WORK_ITEMS_WAITING_ON_CLEARED_ON_MEMBER_REMOVAL' } })).toBe(1);
    });

    it("a repeat copy takes its source's waiting on", async () => {
        const source = await createWorkItem(member, { projectId, typeId, title: 'weekly check-in', dueDate: k(0), waitingOnUserId: owner.userId });
        const rule = await setWorkItemRecurrence(member, source.id, { frequency: 'DAILY', interval: 1, weekdays: [], leadDays: 0 });
        const result = await processWorkItemRecurrence({ tenantId, now: new Date(`${k(1)}T12:00:00.000Z`), tz: 'UTC' });
        expect(result.created).toBe(1);
        const [copy] = await prisma.workItem.findMany({ where: { tenantId, recurrenceId: rule.id }, select: { waitingOnUserId: true } });
        expect(copy?.waitingOnUserId).toBe(owner.userId);
    });

    it('the audit chain verifies', async () => {
        const result = await verifyAuditChain(tenantId);
        expect(result.valid).toBe(true);
    });
});
