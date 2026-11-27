/**
 * The analytics reads' bounds (sub-phase 3.6a, owner decision 331;
 * docs/porting/maps/3.6.md, "Reads, routes and keys"): over a bound the read
 * is a 422 `ANALYTICS_TOO_LARGE` carrying what was over and the count, never
 * a cut answer; the points beyond `ANALYTICS_POINT_LIMIT` are the newest,
 * said so. The bounds are lowered here (the module's constants) so a handful
 * of items crosses them.
 */
import type { PrismaClient } from '@prisma/client';

jest.mock('@/lib/analytics/types', () => ({
    ...jest.requireActual('@/lib/analytics/types'),
    ANALYTICS_COMPLETION_LIMIT: 3,
    ANALYTICS_FLOW_ITEM_LIMIT: 3,
    ANALYTICS_FILTER_ITEM_LIMIT: 3,
    ANALYTICS_POINT_LIMIT: 2,
}));

import { getDurations, getFlow, getThroughput } from '@/app-layer/usecases/analytics';
import { createProject } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { createWorkItem } from '@/app-layer/usecases/work-item';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `anbig${Date.now().toString(36)}`;
const NOW = new Date('2031-03-21T12:00:00.000Z');
const WINDOW = { from: '2031-03-03', to: '2031-03-21' };

describeFn('the analytics bounds (3.6a)', () => {
    let prisma: PrismaClient;
    let owner: ReturnType<typeof makeRequestContext>;
    let projectId = '';

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        const tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const u = await prisma.user.create({ data: { email: `${TAG}@example.test` } });
        await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role: 'OWNER' } });
        owner = makeRequestContext('OWNER', { tenantId, userId: u.id, tenantSlug: TAG });
        const teamId = (await createTeam(owner, { name: 'Core' })).id;
        const typeId = (await listWorkItemTypes(owner))[0]!.id;
        projectId = (await createProject(owner, { teamId, name: 'Platform', keyPrefix: 'PLT' })).id;
        const done = (await prisma.workflowState.findFirst({ where: { teamId, category: 'DONE' } }))!;
        for (let i = 0; i < 4; i++) {
            const id = (await createWorkItem(owner, { projectId, typeId, title: `item ${i}` })).id;
            await prisma.workItemTransition.deleteMany({ where: { workItemId: id } });
            await prisma.workItemTransition.createMany({
                data: [
                    { tenantId, workItemId: id, projectId, teamId, stateId: done.id, stateCategory: 'UNSTARTED', deleted: false, at: new Date(`2031-03-0${4 + i}T09:00:00Z`) },
                    { tenantId, workItemId: id, projectId, teamId, stateId: done.id, stateCategory: 'DONE', fromStateCategory: 'UNSTARTED', deleted: false, at: new Date(`2031-03-1${i}T09:00:00Z`) },
                ],
            });
        }
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('refuses more completions than the bound with the count, and reads a narrower window', async () => {
        await expect(getThroughput(owner, { ...WINDOW, projectId }, NOW)).rejects.toMatchObject({ status: 422, details: { reason: 'ANALYTICS_TOO_LARGE', what: 'completions', count: 4, limit: 3 } });
        await expect(getDurations(owner, { ...WINDOW, projectId }, NOW)).rejects.toMatchObject({ status: 422, details: { what: 'completions' } });
        const narrow = await getDurations(owner, { from: '2031-03-11', to: '2031-03-21', projectId }, NOW);
        expect(narrow.leadTime.count).toBe(3);
        expect(narrow.points).toHaveLength(2);
        expect(narrow.pointsNewestOnly).toBe(true);
        expect(narrow.points.map((p) => p.completedOn)).toEqual(['2031-03-13', '2031-03-12']);
    });

    it('refuses a flow over more items than the bound, and a filter on current values selecting more', async () => {
        await expect(getFlow(owner, { ...WINDOW, projectId }, NOW)).rejects.toMatchObject({ status: 422, details: { what: 'items', count: 4, limit: 3 } });
        await expect(getThroughput(owner, { ...WINDOW, assigneeId: 'none' }, NOW)).rejects.toMatchObject({ status: 422, details: { what: 'filter', count: 4, limit: 3 } });
    });
});
