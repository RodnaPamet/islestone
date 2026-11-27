/**
 * Page-tree writes under a burst (sub-phase 4.1a; docs/pages.md, "The tree
 * lock and the write queue"; the pattern of decision 254).
 *
 * Every create, move, reorder, delete and restore of a page waits its
 * workspace's turn in the process (`inPageTreeQueue`), then takes the
 * page-tree lock first in its transaction. A burst of them in one workspace
 * must all succeed (no expired transaction, no deadlock), place every page
 * under a distinct sort key, and never leave a cycle, a page past ten levels
 * or a page outside its parent's tree. Two pages moved under each other at
 * once: exactly one move wins.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { createPage, deletePage, movePage, restorePage } from '@/app-layer/usecases/page';
import { createProject } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { PAGE_TREE_WRITES_PER_WORKSPACE } from '@/lib/db/concurrency-limits';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../../helpers/db';
import { makeRequestContext } from '../../helpers/make-context';
import { roundNumbers } from '../../helpers/stress-scale';

import { DB_AVAILABLE } from '../db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `pgtr${Date.now().toString(36)}`;
const BASE_ROUNDS = 2;

describeFn('concurrency: page-tree writes under a burst', () => {
    let prisma: PrismaClient;
    let owner: RequestContext;
    let teamId = '';

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        const tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const u = await prisma.user.create({ data: { email: `owner-${TAG}@example.test`, name: 'Owner' } });
        await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role: 'OWNER' } });
        owner = makeRequestContext('OWNER', { tenantId, userId: u.id, tenantSlug: TAG, requestId: `${TAG}-owner` });
        teamId = (await createTeam(owner, { name: 'Pages' })).id;
    });

    afterAll(async () => {
        if (!process.env.KEEP_DB) await resetDatabase(prisma);
    });

    it('states the concurrency it proves', () => {
        expect(PAGE_TREE_WRITES_PER_WORKSPACE).toBe(1);
    });

    it.each(roundNumbers(BASE_ROUNDS))(
        'round %i: 30 tree writes of every kind at once in one workspace all succeed, and the trees stay whole',
        async (round) => {
            const project = await createProject(owner, { teamId, name: `Burst ${round}`, keyPrefix: `PB${round}` });
            const parent = await createPage(owner, { projectId: project.id, title: `Parent ${round}` });
            // guardrail-allow: n+1 — the test's own setup, one row at a time.
            const movers = [];
            for (let i = 0; i < 6; i++) movers.push(await createPage(owner, { projectId: project.id, title: `Mover ${i}` }));
            const doomed = [];
            for (let i = 0; i < 4; i++) doomed.push(await createPage(owner, { projectId: project.id, title: `Doomed ${i}` }));
            const gone = [];
            for (let i = 0; i < 4; i++) {
                const p = await createPage(owner, { projectId: project.id, title: `Gone ${i}` });
                await deletePage(owner, p.id);
                gone.push(p);
            }

            const writes: Array<Promise<unknown>> = [
                ...Array.from({ length: 12 }, (_, i) => createPage(owner, { projectId: project.id, parentId: parent.id, title: `Child ${i}` })),
                ...movers.slice(0, 3).map((m) => movePage(owner, m.id, { projectId: project.id, parentId: parent.id })),
                ...movers.slice(3).map((m) => movePage(owner, m.id, { projectId: null, parentId: null })),
                ...doomed.map((d) => deletePage(owner, d.id)),
                ...gone.map((g) => restorePage(owner, g.id)),
            ];
            const settled = await Promise.allSettled(writes);
            const failures = settled.filter((s) => s.status === 'rejected').map((s) => String((s as PromiseRejectedResult).reason));
            expect(failures).toEqual([]);

            // Every child of the parent under a distinct key, and every row in its parent's tree.
            const children = await prisma.page.findMany({ where: { parentId: parent.id, deletedAt: null }, select: { sortKey: true } });
            expect(children).toHaveLength(15);
            expect(new Set(children.map((c) => c.sortKey)).size).toBe(15);
            const strays = await prisma.$queryRaw<Array<{ n: bigint }>>`
                SELECT count(*) AS n FROM "Page" c JOIN "Page" p ON p."id" = c."parentId"
                 WHERE c."tenantId" = ${owner.tenantId} AND p."projectId" IS DISTINCT FROM c."projectId"`;
            expect(Number(strays[0]!.n)).toBe(0);
            expect(await prisma.page.count({ where: { id: { in: doomed.map((d) => d.id) }, deletedAt: null } })).toBe(0);
            expect(await prisma.page.count({ where: { id: { in: gone.map((g) => g.id) }, deletedAt: null } })).toBe(4);
        },
    );

    it.each(roundNumbers(BASE_ROUNDS))('round %i: two pages moved under each other at once: one move wins, no cycle', async (round) => {
        const a = await createPage(owner, { projectId: null, title: `A ${round}` });
        const b = await createPage(owner, { projectId: null, title: `B ${round}` });
        const settled = await Promise.allSettled([
            movePage(owner, a.id, { projectId: null, parentId: b.id }),
            movePage(owner, b.id, { projectId: null, parentId: a.id }),
        ]);
        expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
        const reasons = settled.flatMap((s) => (s.status === 'rejected' ? [(s.reason as { details?: { reason?: string } }).details?.reason] : []));
        expect(reasons).toEqual(['PAGE_WOULD_CYCLE']);
        const rows = await prisma.page.findMany({ where: { id: { in: [a.id, b.id] } }, select: { id: true, parentId: true } });
        const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
        expect(parentOf.get(a.id) === b.id && parentOf.get(b.id) === a.id).toBe(false);
    });
});
