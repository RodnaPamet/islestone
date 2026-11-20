/**
 * The Settings pages' server side against a real Postgres, as `app_user`
 * (decision 55): the first-project path a brand-new workspace's owner walks
 * in Settings (a team brings its workflow and the types; a project; a work
 * item lands in the default state), the order the workflow page shows and
 * the moves it sends (`workflow-order.ts`) as the server applies them, and
 * the writes `workConfigAffordances` offers matching what the usecases admit
 * for an Admin whose custom role withholds `admin.manage`. Audit rows are
 * real and the chain verifies.
 */
import type { PrismaClient } from '@prisma/client';

import { workConfigAffordances } from '@/app-layer/policies/work-config.policies';
import type { RequestContext } from '@/app-layer/types';
import { createLabel } from '@/app-layer/usecases/label';
import { createProject, listProjects, setProjectArchived } from '@/app-layer/usecases/project';
import { createTeam, listTeams } from '@/app-layer/usecases/team';
import { createWorkItem } from '@/app-layer/usecases/work-item';
import { createWorkItemType, listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createWorkflowState, listWorkflowStates, updateWorkflowState } from '@/app-layer/usecases/workflow-state';
import { neighbourPosition, orderStates } from '@/components/settings/workflow-order';
import { verifyAuditChain } from '@/lib/audit';
import { getPermissionsForRole } from '@/lib/permissions';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `setfp${Date.now().toString(36)}`;

describeFn('Settings: the first-project path and the affordances', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let restrictedAdmin: RequestContext;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        const tenant = await createTenantWithDek({ name: TAG, slug: TAG });
        tenantId = tenant.id;
        const ownerUser = await prisma.user.create({ data: { email: `owner-${TAG}@example.test`, name: 'Olive Owner' } });
        const adminUser = await prisma.user.create({ data: { email: `admin-${TAG}@example.test`, name: 'Ada Admin' } });
        await prisma.tenantMembership.create({ data: { tenantId, userId: ownerUser.id, role: 'OWNER' } });
        await prisma.tenantMembership.create({ data: { tenantId, userId: adminUser.id, role: 'ADMIN' } });
        owner = makeRequestContext('OWNER', { tenantId, userId: ownerUser.id, tenantSlug: TAG, requestId: `${TAG}-o` });
        const perms = getPermissionsForRole('ADMIN');
        perms.admin.manage = false;
        restrictedAdmin = makeRequestContext('ADMIN', { tenantId, userId: adminUser.id, tenantSlug: TAG, requestId: `${TAG}-a`, appPermissions: perms });
    });

    afterAll(async () => {
        if (!process.env.KEEP_DB) await resetDatabase(prisma);
    });

    it('a brand-new workspace reaches its first work item through the Settings writes alone', async () => {
        // What the landing page reads on a fresh workspace: nothing.
        expect(await listTeams(owner)).toEqual([]);
        expect(await listWorkItemTypes(owner)).toEqual([]);
        expect(await listProjects(owner, { includeArchived: true })).toEqual([]);

        // Teams → "Create team": the workflow and the types come with it.
        const team = await createTeam(owner, { name: 'Core' });
        expect(team.workflowStates.map((s) => s.name)).toEqual(['Backlog', 'Todo', 'In progress', 'In review', 'Done', 'Cancelled']);
        expect((await listWorkItemTypes(owner)).map((t) => t.name)).toEqual(['Feature', 'Bug', 'Chore']);

        // Projects → "Create project", the prefix as the dialog sends it.
        const project = await createProject(owner, { teamId: team.id, name: 'First steps', keyPrefix: 'FST' });
        expect(project.keyPrefix).toBe('FST');

        // Work items → "Create work item" with the dialog's defaults: the
        // first type and the team's default state.
        const types = await listWorkItemTypes(owner);
        const todo = team.workflowStates.find((s) => s.isDefault)!;
        const item = await createWorkItem(owner, { projectId: project.id, typeId: types[0]!.id, stateId: todo.id, title: 'The first item' });
        expect(item.key).toBe('FST-1');
        expect(item.stateId).toBe(todo.id);

        const actions = (await prisma.auditLog.findMany({ where: { tenantId }, select: { action: true }, take: 50 })).map((a) => a.action);
        expect(actions).toEqual(expect.arrayContaining(['TEAM_CREATED', 'PROJECT_CREATED', 'WORK_ITEM_CREATED']));
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });

    it('the workflow page\'s moves keep a state in its category, in the order the server stores', async () => {
        const team = await createTeam(owner, { name: 'Moves' });
        // A second STARTED state, created at the end of the list as the page does.
        await createWorkflowState(owner, team.id, { name: 'Blocked', category: 'STARTED' });
        let ordered = orderStates(await listWorkflowStates(owner, team.id, { includeArchived: true }));
        expect(ordered.map((s) => s.name)).toEqual(['Backlog', 'Todo', 'In progress', 'In review', 'Blocked', 'Done', 'Cancelled']);

        // "Move Blocked up" twice: it ends first among the STARTED states.
        for (let i = 0; i < 2; i++) {
            const blocked = ordered.find((s) => s.name === 'Blocked')!;
            await updateWorkflowState(owner, blocked.id, { position: neighbourPosition(ordered, blocked, 'up')! });
            ordered = orderStates(await listWorkflowStates(owner, team.id, { includeArchived: true }));
        }
        expect(ordered.map((s) => s.name)).toEqual(['Backlog', 'Todo', 'Blocked', 'In progress', 'In review', 'Done', 'Cancelled']);
        // At the category's edge the page offers no further move.
        expect(neighbourPosition(ordered, ordered.find((s) => s.name === 'Blocked')!, 'up')).toBeNull();
    });

    it('offers an Admin without admin.manage exactly the writes the usecases admit', async () => {
        const offered = workConfigAffordances(restrictedAdmin);
        expect(offered).toEqual({ manageWorkConfig: false, createProject: true, editProject: true, archiveProject: true, manageCustomFields: true });

        const [team] = await listTeams(restrictedAdmin);
        await expect(createTeam(restrictedAdmin, { name: 'Nope' })).rejects.toMatchObject({ status: 403 });
        await expect(createWorkflowState(restrictedAdmin, team!.id, { name: 'Nope', category: 'BACKLOG' })).rejects.toMatchObject({ status: 403 });
        await expect(createWorkItemType(restrictedAdmin, { name: 'Nope' })).rejects.toMatchObject({ status: 403 });
        await expect(createLabel(restrictedAdmin, { name: 'Nope' })).rejects.toMatchObject({ status: 403 });

        const project = await createProject(restrictedAdmin, { teamId: team!.id, name: 'Allowed', keyPrefix: 'ALW' });
        const archived = await setProjectArchived(restrictedAdmin, project.id, true);
        expect(archived?.archivedAt).not.toBeNull();
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });
});
