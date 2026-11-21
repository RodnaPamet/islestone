/**
 * Workspace search over titles and keys (sub-phase 2.7b; docs/search.md),
 * against a real Postgres:
 *
 *   - migration `20261203120000_search_titles`: the two extensions and the
 *     four tenant-leading GIN indexes, and the planner using them for the
 *     search reads and for the list's `q` filter as Prisma renders it;
 *   - `searchWorkspace`: substring and any-order word matches, a typed key
 *     (current prefix and a move's alias) ranked first, wildcards matched as
 *     text, deleted items and archived or deleted projects never offered,
 *     another workspace never offered (by the query's own filter AND by RLS
 *     alone), a GUEST offered nothing, a custom role without
 *     `work_items.view` offered projects only, the per-type cap;
 *   - `GET /api/t/<slug>/search`: 200, a bounded `limit` (400 past it), and a
 *     403 with an `AUTHZ_DENIED` row for a caller without `projects.view`.
 *
 * No new table, so nothing joins `ISOLATION_TESTED`. Since 2.7f the full-text
 * indexes are built with `islestone_bg_en` (tests/integration/search-vectors.test.ts
 * covers the configuration and the stored vectors).
 */
import { NextRequest } from 'next/server';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import type { RequestContext } from '@/app-layer/types';

const getTenantCtxMock = jest.fn<Promise<RequestContext>, [unknown, unknown]>();
jest.mock('@/app-layer/context', () => ({
    getTenantCtx: (params: unknown, req: unknown) => getTenantCtxMock(params, req),
}));

import { searchWorkspace } from '@/app-layer/usecases/search';
import { listWorkItems } from '@/app-layer/usecases/work-item';
import { WorkItemRepository } from '@/app-layer/repositories/WorkItemRepository';
import { resolveProjectVisibility } from '@/app-layer/policies/project-visibility';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';
import { getPermissionsForRole } from '@/lib/permissions';
import { MAX_PER_TYPE_LIMIT } from '@/lib/search/types';

import { getTestDatabaseUrl, prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';
import { seedWorkItem, seedWorkWorld, type WorkWorld } from '../helpers/work-fixture';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `srch${Date.now().toString(36)}`;
const TAG_B = `${TAG}b`;

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

describeFn('workspace search (2.7b)', () => {
    let prisma: PrismaClient;
    let tenantA = '';
    let tenantB = '';
    let ownerA = '';
    let ownerB = '';
    let worldA: WorkWorld;
    let archivedWorld: WorkWorld;
    let worldB: WorkWorld;
    const items: Record<string, { id: string; number: number }> = {};

    const ctxA = (overrides: Partial<RequestContext> = {}) =>
        makeRequestContext('MEMBER', { tenantId: tenantA, tenantSlug: TAG, userId: ownerA, requestId: `${TAG}-${Math.random()}`, ...overrides });

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantA = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        tenantB = (await createTenantWithDek({ name: TAG_B, slug: TAG_B })).id;
        ownerA = (await prisma.user.create({ data: { email: `a-${TAG}@example.test` } })).id;
        ownerB = (await prisma.user.create({ data: { email: `b-${TAG}@example.test` } })).id;
        await prisma.tenantMembership.create({ data: { tenantId: tenantA, userId: ownerA, role: 'OWNER' } });
        await prisma.tenantMembership.create({ data: { tenantId: tenantB, userId: ownerB, role: 'OWNER' } });

        worldA = await seedWorkWorld(prisma, tenantA, { keyPrefix: 'SRA' });
        await prisma.project.update({ where: { id: worldA.projectId }, data: { name: 'Login revamp' } });
        archivedWorld = await seedWorkWorld(prisma, tenantA, { keyPrefix: 'SRZ', teamName: `Archived ${TAG}` });
        await prisma.project.update({ where: { id: archivedWorld.projectId }, data: { name: 'Login archive', archivedAt: new Date() } });
        worldB = await seedWorkWorld(prisma, tenantB, { keyPrefix: 'SRB' });
        await prisma.project.update({ where: { id: worldB.projectId }, data: { name: 'Login elsewhere' } });

        const seed = async (name: string, world: WorkWorld, tenantId: string, title: string, sortKey: string, by: string) => {
            const row = await seedWorkItem(prisma, tenantId, world, { title, createdByUserId: by, sortKey });
            items[name] = { id: row.id, number: row.number };
        };
        await seed('fix', worldA, tenantA, 'Fix the login redirect', 'a1', ownerA);
        await seed('copy', worldA, tenantA, 'Login page copy', 'a2', ownerA);
        await seed('after', worldA, tenantA, 'Redirect after login', 'a3', ownerA);
        await seed('percent', worldA, tenantA, '100% done', 'a4', ownerA);
        await seed('plain', worldA, tenantA, '100 done', 'a5', ownerA);
        await seed('thousand', worldA, tenantA, '1000 done', 'a55', ownerA);
        await seed('deleted', worldA, tenantA, 'Deleted login item', 'a6', ownerA);
        await prisma.workItem.update({ where: { id: items.deleted!.id }, data: { deletedAt: new Date(), deletionId: `${TAG}-del` } });
        await seed('archived', archivedWorld, tenantA, 'Login in an archived project', 'b1', ownerA);
        await seed('other', worldB, tenantB, 'Fix the login redirect elsewhere', 'c1', ownerB);
        // A key left by a move: SRA-90 now names "Redirect after login".
        await prisma.workItemKeyAlias.create({ data: { tenantId: tenantA, projectId: worldA.projectId, number: 90, workItemId: items.after!.id } });
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    const titles = (r: Awaited<ReturnType<typeof searchWorkspace>>, type: 'workItem' | 'project') =>
        r.hits.filter((h) => h.type === type).map((h) => h.title);

    // ─── The migration ──────────────────────────────────────────────

    it('creates pg_trgm and btree_gin and four tenant-leading, live-only GIN indexes', async () => {
        const ext = await prisma.$queryRaw<Array<{ extname: string }>>`
            SELECT extname::text AS extname FROM pg_extension WHERE extname IN ('pg_trgm', 'btree_gin') ORDER BY extname`;
        expect(ext.map((e) => e.extname)).toEqual(['btree_gin', 'pg_trgm']);
        const idx = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
            SELECT indexname::text AS indexname, indexdef FROM pg_indexes
             WHERE indexname IN ('WorkItem_search_title_trgm', 'WorkItem_search_title_fts', 'Project_search_name_trgm', 'Project_search_name_fts')
             ORDER BY indexname`;
        expect(idx.map((i) => i.indexname)).toEqual(['Project_search_name_fts', 'Project_search_name_trgm', 'WorkItem_search_title_fts', 'WorkItem_search_title_trgm']);
        for (const i of idx) {
            expect(i.indexdef).toMatch(/USING gin \("tenantId", /);
            expect(i.indexdef).toMatch(/WHERE \("deletedAt" IS NULL\)$/);
        }
        expect(idx.find((i) => i.indexname === 'WorkItem_search_title_fts')!.indexdef).toContain("to_tsvector('islestone_bg_en'::regconfig, title)");
        expect(idx.find((i) => i.indexname === 'WorkItem_search_title_trgm')!.indexdef).toContain('title gin_trgm_ops');
    });

    // ─── The usecase ────────────────────────────────────────────────

    it('finds titles by substring and project names, never a deleted item, an archived project or another workspace', async () => {
        const r = await searchWorkspace(ctxA(), 'login');
        expect(titles(r, 'workItem').sort()).toEqual(['Fix the login redirect', 'Login page copy', 'Redirect after login']);
        expect(titles(r, 'project')).toEqual(['Login revamp']);
        expect(r.meta).toMatchObject({ query: 'login', perTypeCounts: { workItem: 3, project: 1 }, truncated: false });
        const hit = r.hits.find((h) => h.id === items.copy!.id)!;
        expect(hit).toMatchObject({ subtitle: `SRA-${items.copy!.number}`, href: `/t/${TAG}/work-items/SRA-${items.copy!.number}`, iconKey: 'work-item' });
        expect(r.hits.find((h) => h.type === 'project')!.href).toBe(`/t/${TAG}/projects/SRA`);
    });

    it('ranks a prefix above a substring, and finds the words in any order through the full-text index', async () => {
        const prefix = await searchWorkspace(ctxA(), 'login');
        expect(titles(prefix, 'workItem')[0]).toBe('Login page copy');
        const words = await searchWorkspace(ctxA(), 'redirect login');
        expect(titles(words, 'workItem').sort()).toEqual(['Fix the login redirect', 'Redirect after login']);
    });

    it('a typed key ranks its item first, in any case, and a key left by a move still finds it', async () => {
        const key = `SRA-${items.plain!.number}`;
        const r = await searchWorkspace(ctxA(), key.toLowerCase());
        expect(r.hits[0]).toMatchObject({ id: items.plain!.id, subtitle: key });
        const alias = await searchWorkspace(ctxA(), 'SRA-90');
        expect(alias.hits[0]?.id).toBe(items.after!.id);
        // A key in another workspace or of a deleted item finds nothing.
        expect((await searchWorkspace(ctxA(), `SRB-${items.other!.number}`)).hits).toEqual([]);
        expect((await searchWorkspace(ctxA(), `SRA-${items.deleted!.number}`)).hits.filter((h) => h.type === 'workItem')).toEqual([]);
    });

    it('a project key prefix finds the project', async () => {
        const r = await searchWorkspace(ctxA(), 'sra');
        expect(r.hits.find((h) => h.type === 'project')).toMatchObject({ title: 'Login revamp', score: 100 });
    });

    it('matches % and _ as text, in the search and in the list filter', async () => {
        // Escaped, `100%` is no wildcard: "1000 done" never matches. The word
        // arm still finds "100 done" (full text ignores the punctuation).
        const r = titles(await searchWorkspace(ctxA(), '100%'), 'workItem');
        expect(r[0]).toBe('100% done');
        expect(r).not.toContain('1000 done');
        expect(titles(await searchWorkspace(ctxA(), '100_'), 'workItem')).not.toContain('1000 done');
        // The list's substring arm escapes too. Since 2.7f its full-text arm
        // also finds "100 done" for `100%` (punctuation is not a word), so the
        // wildcard is shown with `0%`: as a wildcard it would match every title
        // holding a 0; escaped it matches "100% done" only, and `0` is no word
        // of any title.
        expect((await listWorkItems(ctxA(), { q: '100%' })).items.map((i) => i.title)).not.toContain('1000 done');
        const list = await listWorkItems(ctxA(), { q: '0%' });
        expect(list.items.map((i) => i.title)).toEqual(['100% done']);
    });

    it('the list filter q still matches a title substring or a key, and never a deleted item', async () => {
        const list = await listWorkItems(ctxA(), { q: 'login' });
        expect(list.items.map((i) => i.title).sort()).toEqual(['Fix the login redirect', 'Login page copy', 'Redirect after login']);
        const key = await listWorkItems(ctxA(), { q: `SRA-${items.copy!.number}` });
        expect(key.items.map((i) => i.id)).toEqual([items.copy!.id]);
    });

    it('caps each type and says so', async () => {
        const r = await searchWorkspace(ctxA(), 'login', { perTypeLimit: 1 });
        expect(r.hits.filter((h) => h.type === 'workItem')).toHaveLength(1);
        expect(r.meta).toMatchObject({ truncated: true, perTypeLimit: 1, perTypeCounts: { workItem: 1, project: 1 } });
    });

    it('a GUEST is refused search (decision 204); one granted the read keys, as 8.4 will, with no project grant is offered nothing', async () => {
        await expect(searchWorkspace(ctxA({ role: 'GUEST', membershipRole: 'GUEST', appPermissions: getPermissionsForRole('GUEST') }), 'login')).rejects.toMatchObject({ status: 403 });
        const r = await searchWorkspace(ctxA({ role: 'GUEST', membershipRole: 'GUEST', appPermissions: getPermissionsForRole('VIEWER') }), 'login');
        expect(r.hits).toEqual([]);
        expect(r.meta.perTypeCounts).toEqual({ workItem: 0, project: 0 });
    });

    it('a custom role without work_items.view is offered projects only; without projects.view it is refused', async () => {
        const noItems = getPermissionsForRole('MEMBER');
        noItems.work_items.view = false;
        const r = await searchWorkspace(ctxA({ appPermissions: noItems }), 'login');
        expect(titles(r, 'workItem')).toEqual([]);
        expect(r.meta.perTypeCounts.workItem).toBe(0);
        expect(titles(r, 'project')).toEqual(['Login revamp']);
        const noProjects = getPermissionsForRole('MEMBER');
        noProjects.projects.view = false;
        await expect(searchWorkspace(ctxA({ appPermissions: noProjects }), 'login')).rejects.toThrow(/permission/);
    });

    it('row-level security alone hides another workspace, whatever the query asks', async () => {
        // The read runs in B's context but names A's workspace: RLS returns nothing.
        const ctxB = makeRequestContext('OWNER', { tenantId: tenantB, tenantSlug: TAG_B, userId: ownerB });
        const rows = await runInTenantContext(ctxB, (db) =>
            WorkItemRepository.searchTitles(db, ctxA(), resolveProjectVisibility(ctxA()), 'login', { limit: 10 }),
        );
        expect(rows).toEqual([]);
        const own = await runInTenantContext(ctxB, (db) => WorkItemRepository.searchTitles(db, ctxB, resolveProjectVisibility(ctxB), 'login', { limit: 10 }));
        expect(own.map((r) => r.id)).toEqual([items.other!.id]);
    });

    // ─── The planner ────────────────────────────────────────────────

    describe('the indexes serve the reads', () => {
        let logged: PrismaClient | null = null;
        const queries: Array<{ query: string; params: string }> = [];

        beforeAll(async () => {
            // Enough live rows in A that a full scan is not the cheap plan.
            // Enough live rows in each workspace (20,000) that the planner
            // weighs the indexes as it would in a busy workspace; with a few
            // thousand it reads one project's btree and filters instead.
            for (const [tenantId, world, by] of [
                [tenantA, worldA, ownerA],
                [tenantB, worldB, ownerB],
            ] as const) {
                await prisma.$executeRawUnsafe(
                    `INSERT INTO "WorkItem" ("id", "tenantId", "teamId", "projectId", "number", "typeId", "title", "stateId", "stateCategory", "createdByUserId", "sortKey", "updatedAt")
                     SELECT $1 || g, $2, $3, $4, 100000 + g, $5, 'Filler ' || md5(g::text) || ' widget ' || g, $6, 'UNSTARTED', $7, 'f' || lpad(g::text, 6, '0'), now()
                       FROM generate_series(1, 20000) g`,
                    `${TAG}-${tenantId === tenantA ? 'a' : 'b'}-`,
                    tenantId,
                    world.teamId,
                    world.projectId,
                    world.typeId,
                    world.defaultStateId,
                    by,
                );
            }
            await prisma.$executeRawUnsafe('ANALYZE "WorkItem"');
            await prisma.$executeRawUnsafe('ANALYZE "Project"');
            const base = new PrismaClient({ adapter: new PrismaPg({ connectionString: getTestDatabaseUrl() }), log: [{ emit: 'event', level: 'query' }] });
            (base as unknown as { $on: (e: 'query', cb: (ev: { query: string; params: string }) => void) => void }).$on('query', (ev) => queries.push(ev));
            logged = base;
        });

        afterAll(async () => {
            await logged?.$disconnect();
        });

        async function planOf(sql: string, params: unknown[]): Promise<string> {
            const rows = await prisma.$transaction(async (tx) => {
                await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
                return tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': unknown }>>(`EXPLAIN (FORMAT JSON) ${sql}`, ...params);
            });
            return JSON.stringify(rows[0]!['QUERY PLAN']);
        }

        it('the title search uses the trigram and full-text indexes', async () => {
            let captured: Prisma.Sql | null = null;
            const recorder = { $queryRaw: async (s: Prisma.Sql) => ((captured = s), []) } as never;
            await WorkItemRepository.searchTitles(recorder, ctxA(), { kind: 'ALL' }, 'redirect login', { limit: 15 });
            const plan = await planOf(captured!.text, captured!.values);
            expect(plan).toContain('WorkItem_search_title_trgm');
            expect(plan).toContain('WorkItem_search_title_fts');
        });

        it('the list filter q, as Prisma renders it, uses the trigram index', async () => {
            const where = WorkItemRepository._buildWhere(ctxA(), { kind: 'ALL' }, { q: 'redirect' });
            queries.length = 0;
            await logged!.workItem.findMany({ where, select: { id: true } });
            const q = queries.find((e) => /ILIKE/i.test(e.query));
            expect(q).toBeDefined();
            const plan = await planOf(q!.query, JSON.parse(q!.params) as unknown[]);
            expect(plan).toContain('WorkItem_search_title_trgm');
        });
    });

    // ─── The route ──────────────────────────────────────────────────

    describe('GET /api/t/<slug>/search', () => {
        let GET: Handler;
        beforeAll(async () => {
            GET = ((await import('../../src/app/api/t/[tenantSlug]/search/route')) as unknown as { GET: Handler }).GET;
        });

        const get = (qs: string) =>
            GET(new NextRequest(`http://localhost/api/t/${TAG}/search${qs}`, { headers: { 'x-forwarded-for': '10.0.0.9' } }), {
                params: Promise.resolve({ tenantSlug: TAG }),
            });

        it('answers a member with ranked hits', async () => {
            getTenantCtxMock.mockResolvedValue(ctxA());
            const res = await get('?q=login&limit=2');
            expect(res.status).toBe(200);
            const body = (await res.json()) as { hits: Array<{ type: string }>; meta: { perTypeLimit: number } };
            expect(body.meta.perTypeLimit).toBe(2);
            expect(body.hits.filter((h) => h.type === 'workItem')).toHaveLength(2);
        });

        it('refuses a page past the bound', async () => {
            getTenantCtxMock.mockResolvedValue(ctxA());
            expect((await get(`?q=login&limit=${MAX_PER_TYPE_LIMIT + 1}`)).status).toBe(400);
        });

        it('refuses a caller without projects.view with a 403 and an AUTHZ_DENIED row', async () => {
            const noProjects = getPermissionsForRole('MEMBER');
            noProjects.projects.view = false;
            getTenantCtxMock.mockResolvedValue(ctxA({ appPermissions: noProjects }));
            const before = await prisma.auditLog.count({ where: { tenantId: tenantA, action: 'AUTHZ_DENIED' } });
            expect((await get('?q=login')).status).toBe(403);
            expect(await prisma.auditLog.count({ where: { tenantId: tenantA, action: 'AUTHZ_DENIED' } })).toBe(before + 1);
        });
    });
});
