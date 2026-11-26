/**
 * The roadmap's refusal (sub-phase 3.2c; docs/porting/maps/3.2.md, "The
 * read", steps 2 and 4): above its project or milestone limit it is a 422
 * `ROADMAP_TOO_LARGE` carrying the count, never a cut list. The limits are
 * lowered here (500 projects and 2,000 milestones would take minutes to
 * create through the usecases); the code path is the real one.
 */
import type { PrismaClient } from '@prisma/client';

jest.mock('@/lib/goals/roadmap', () => ({
    ...jest.requireActual('@/lib/goals/roadmap'),
    ROADMAP_PROJECT_LIMIT: 2,
    ROADMAP_MILESTONE_LIMIT: 1,
}));

import type { RequestContext } from '@/app-layer/types';
import { createInitiative } from '@/app-layer/usecases/initiative';
import { createMilestone } from '@/app-layer/usecases/milestone';
import { createProject } from '@/app-layer/usecases/project';
import { getRoadmap } from '@/app-layer/usecases/roadmap';
import { createTeam } from '@/app-layer/usecases/team';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `rdl${Date.now().toString(36)}`;

async function detailsOf(p: Promise<unknown>): Promise<unknown> {
    try {
        await p;
    } catch (err) {
        const e = err as { status?: number; details?: unknown };
        return { status: e.status, details: e.details };
    }
    return 'no error';
}

describeFn('the roadmap refuses a scope over its limits (3.2c)', () => {
    let prisma: PrismaClient;
    let owner: RequestContext;
    let teamId = '';

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        const tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const u = await prisma.user.create({ data: { email: `olive-${TAG}@example.test`, name: 'olive' } });
        await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role: 'OWNER' } });
        owner = makeRequestContext('OWNER', { tenantId, userId: u.id, tenantSlug: TAG, requestId: TAG });
        teamId = (await createTeam(owner, { name: 'Core' })).id;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    it('two milestones over a limit of one: 422 with the count', async () => {
        const project = await createProject(owner, { teamId, name: 'Only', keyPrefix: 'RL1' });
        await createMilestone(owner, project.id, { name: 'One', dueDate: '2051-01-31' });
        await createMilestone(owner, project.id, { name: 'Two', dueDate: '2051-02-28' });
        expect(await detailsOf(getRoadmap(owner))).toEqual({ status: 422, details: { reason: 'ROADMAP_TOO_LARGE', count: 2, limit: 1, what: 'milestones' } });
    });

    it('three projects over a limit of two: 422 with the real count; a narrower filter passes', async () => {
        const ini = await createInitiative(owner, { name: 'Narrow' });
        await createProject(owner, { teamId, name: 'Second', keyPrefix: 'RL2' });
        await createProject(owner, { teamId, name: 'Third', keyPrefix: 'RL3' });
        await createProject(owner, { teamId, name: 'Fourth', keyPrefix: 'RL4', initiativeId: ini.id });
        expect(await detailsOf(getRoadmap(owner))).toEqual({ status: 422, details: { reason: 'ROADMAP_TOO_LARGE', count: 4, limit: 2, what: 'projects' } });
        const narrowed = await getRoadmap(owner, { initiativeId: ini.id });
        expect(narrowed.projects.map((p) => p.name)).toEqual(['Fourth']);
    });
});
