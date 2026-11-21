/**
 * The board drop (sub-phase 2.3) against a real Postgres, as `app_user`:
 * `moveWorkItemOnBoard` changes the state and the place among the
 * destination's neighbours in one transaction, with the state change's audit
 * entry and effects and the reorder's own entry; a same-column drop is a
 * reorder that leaves the version alone; another team's or an archived state
 * is refused with nothing written; a stale `If-Match` is a 409.
 *
 * Written fresh for Islestone.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { createProject } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createWorkItem, getWorkItem } from '@/app-layer/usecases/work-item';
import { moveWorkItemOnBoard } from '@/app-layer/usecases/work-item-moves';
import { getWorkItemViewConfig } from '@/app-layer/usecases/work-item-views';
import { listAssignableUsers } from '@/app-layer/usecases/tenant-admin';
import { updateWorkflowState } from '@/app-layer/usecases/workflow-state';
import { verifyAuditChain } from '@/lib/audit';
import { getPermissionsForRole } from '@/lib/permissions';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `wibm${Date.now().toString(36)}`;

describeFn('the board drop', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let states: Record<string, string> = {};
    let otherTeamState = '';
    let projectId = '';
    let typeId = '';

    const newItem = (title: string) => createWorkItem(owner, { projectId, typeId, title });

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const user = await prisma.user.create({ data: { email: `owner-${TAG}@example.test`, name: 'Olive Owner' } });
        await prisma.tenantMembership.create({ data: { tenantId, userId: user.id, role: 'OWNER' } });
        owner = makeRequestContext('OWNER', { tenantId, userId: user.id, tenantSlug: TAG, requestId: `${TAG}-o` });
        const team = await createTeam(owner, { name: 'Core' });
        states = Object.fromEntries(team.workflowStates.map((s) => [s.name, s.id]));
        const other = await createTeam(owner, { name: 'Other' });
        otherTeamState = other.workflowStates.find((s) => s.name === 'In progress')!.id;
        projectId = (await createProject(owner, { teamId: team.id, name: 'Board', keyPrefix: 'BRD' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    it('moves the state and the place in one write, with both audit entries and the state effects', async () => {
        const a = await newItem('a');
        const b = await newItem('b');
        const moving = await newItem('moving');
        // b is in progress; drop "moving" above b in that column.
        await moveWorkItemOnBoard(owner, b.id, { stateId: states['In progress']! });
        const before = await getWorkItem(owner, moving.id);
        const after = await moveWorkItemOnBoard(owner, moving.id, { stateId: states['In progress']!, position: { beforeId: b.id } }, before.version);
        expect(after.stateId).toBe(states['In progress']);
        expect(after.stateCategory).toBe('STARTED');
        expect(after.version).toBe(before.version + 1);
        const bRow = await getWorkItem(owner, b.id);
        expect(after.sortKey < bRow.sortKey).toBe(true);
        expect(after.sortKey > (await getWorkItem(owner, a.id)).sortKey).toBe(true);
        const row = await prisma.workItem.findUniqueOrThrow({ where: { id: moving.id } });
        expect(row.startedAt).not.toBeNull();
        const actions = (await prisma.auditLog.findMany({ where: { tenantId, entityId: moving.id }, orderBy: { createdAt: 'asc' } })).map((r) => r.action);
        expect(actions).toEqual(expect.arrayContaining(['WORK_ITEM_STATE_CHANGED', 'WORK_ITEM_REORDERED']));
    });

    it('a drop in the item\'s own column is a reorder: no version bump, no state entry', async () => {
        const first = await newItem('first');
        const second = await newItem('second');
        const before = await getWorkItem(owner, second.id);
        const after = await moveWorkItemOnBoard(owner, second.id, { stateId: before.stateId, position: { beforeId: first.id } });
        expect(after.version).toBe(before.version);
        expect(after.sortKey < (await getWorkItem(owner, first.id)).sortKey).toBe(true);
        expect(await prisma.auditLog.count({ where: { tenantId, entityId: second.id, action: 'WORK_ITEM_STATE_CHANGED' } })).toBe(0);
    });

    it('refuses another team\'s state, and an archived state, writing nothing', async () => {
        const item = await newItem('refused');
        await expect(moveWorkItemOnBoard(owner, item.id, { stateId: otherTeamState })).rejects.toMatchObject({ status: 400, details: { reason: 'other_team' } });
        await updateWorkflowState(owner, states['In review']!, { archived: true });
        await expect(moveWorkItemOnBoard(owner, item.id, { stateId: states['In review']! })).rejects.toMatchObject({ status: 400, details: { reason: 'archived' } });
        const row = await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } });
        expect(row.stateId).toBe(states['Todo']);
        expect(row.version).toBe(1);
    });

    it('a stale If-Match is a 409 carrying the current row, and nothing moves', async () => {
        const item = await newItem('stale');
        await moveWorkItemOnBoard(owner, item.id, { stateId: states['Done']! }, 1);
        await expect(moveWorkItemOnBoard(owner, item.id, { stateId: states['In progress']! }, 1)).rejects.toMatchObject({
            status: 409,
            details: { reason: 'VERSION_CONFLICT', version: 2 },
        });
        expect((await getWorkItem(owner, item.id)).stateId).toBe(states['Done']);
    });

    it('the view configuration holds the visible projects, teams, live states, types and labels', async () => {
        const config = await getWorkItemViewConfig(owner);
        expect(config.projects.map((p) => p.keyPrefix)).toEqual(['BRD']);
        expect(config.teams.map((t) => t.name).sort()).toEqual(['Core', 'Other']);
        expect(config.states.some((s) => s.id === states['In review'])).toBe(false);
        expect(config.types.length).toBeGreaterThanOrEqual(3);
        // Decision 204: a GUEST is refused the configuration; one granted the read keys, as 8.4 will, sees no project.
        const guest = makeRequestContext('GUEST', { tenantId, userId: owner.userId, tenantSlug: TAG, requestId: `${TAG}-g` });
        await expect(getWorkItemViewConfig(guest)).rejects.toMatchObject({ status: 403 });
        expect((await getWorkItemViewConfig({ ...guest, appPermissions: getPermissionsForRole('VIEWER') })).projects).toEqual([]);
    });

    it('the roster lists active members only, in the pickers\' shape', async () => {
        const gone = await prisma.user.create({ data: { email: `gone-${TAG}@example.test`, name: 'Gone' } });
        await prisma.tenantMembership.create({ data: { tenantId, userId: gone.id, role: 'MEMBER', status: 'DEACTIVATED' } });
        const roster = await listAssignableUsers(owner);
        expect(roster.map((m) => m.id)).toEqual([owner.userId]);
        expect(roster[0]).toMatchObject({ name: 'Olive Owner', email: `owner-${TAG}@example.test`, image: null });
    });

    it('the roster, members\' names and emails, is never read by a GUEST (decision 204)', async () => {
        const guest = makeRequestContext('GUEST', { tenantId, userId: owner.userId, tenantSlug: TAG, requestId: `${TAG}-g-roster` });
        await expect(listAssignableUsers(guest)).rejects.toMatchObject({ status: 403 });
    });

    it('the audit chain verifies', async () => {
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });
});
