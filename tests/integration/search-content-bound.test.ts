/**
 * The bound on content matches (owner decision 250, issue #89; migration
 * `20261217120000_search_recent_candidates`; docs/search.md, "The bound on
 * content matches"), against the migrated database, through
 * `runInTenantContext` as `app_user`:
 *
 *   - a workspace with more live, visible matching vectors than
 *     `CONTENT_CANDIDATE_BOUND` ranks only the most recently written ones:
 *     an item whose vectors are older is not returned, however well it
 *     ranks, and the read says `bounded`; the palette's `meta` and the
 *     list's answer carry the flag, and a title match is still found in
 *     full;
 *   - a workspace with fewer returns every match, ranked, unbounded;
 *   - the bound counts only the caller's workspace and the projects the
 *     caller may see: another workspace's vectors, or an invisible
 *     project's, never cut a read or set the flag;
 *   - in a large workspace (100,000 vectors or more) a query dense among the
 *     newest vectors is answered by the walk on `SearchVector_search_recent`
 *     and a sparse one by the vector index, each with the newest matches;
 *   - the walk's index exists, tenant-leading and partial on the
 *     configuration.
 *
 * Written fresh for Islestone.
 */
import type { PrismaClient } from '@prisma/client';

import type { ProjectVisibility } from '@/app-layer/policies/project-visibility';
import { CONTENT_CANDIDATE_BOUND, SearchVectorRepository } from '@/app-layer/repositories/SearchVectorRepository';
import type { RequestContext } from '@/app-layer/types';
import { createProject } from '@/app-layer/usecases/project';
import { searchWorkspace } from '@/app-layer/usecases/search';
import { createTeam } from '@/app-layer/usecases/team';
import { createWorkItem, listWorkItems } from '@/app-layer/usecases/work-item';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';
import { nestedSearchPlans } from '../helpers/search-plans';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `sbnd${Date.now().toString(36)}`;
const WORD = 'фактура';
const ALL: ProjectVisibility = { kind: 'ALL' };

describeFn('the bound on content matches (decision 250)', () => {
    let prisma: PrismaClient;
    let ownerA: RequestContext;
    let ownerB: RequestContext;
    const projects: Record<string, string> = {};
    const items: Record<string, string> = {};

    /** `n` live comments on `workItemId`, written by the superuser, each with a vector through the seam's bulk path. */
    async function comments(ctx: RequestContext, workItemId: string, n: number, key: string): Promise<void> {
        await prisma.$executeRawUnsafe(
            `INSERT INTO "Comment" ("id", "tenantId", "workItemId", "authorUserId", "body", "createdAt", "updatedAt")
             SELECT $1 || '-' || g, $2, $3, $4, 'v2:not-read', now(), now() FROM generate_series(1, $5::int) g`,
            `${TAG}-${key}`,
            ctx.tenantId,
            workItemId,
            ctx.userId,
            n,
        );
        const sources = Array.from({ length: n }, (_, i) => ({ workItemId, commentId: `${TAG}-${key}-${i + 1}`, plaintext: `Коментар за ${WORD}` }));
        await runInTenantContext(ctx, (db) => SearchVectorRepository.insertBulkForSeed(db, ctx, sources));
    }

    /** Sets the time of every vector of `workItemId` (as the superuser), so the walk's order is the test's. */
    const age = (workItemId: string, interval: string) =>
        prisma.$executeRawUnsafe(`UPDATE "SearchVector" SET "updatedAt" = now() - $2::interval WHERE "workItemId" = $1`, workItemId, interval);

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        const tenantA = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const tenantB = (await createTenantWithDek({ name: `${TAG}-b`, slug: `${TAG}-b` })).id;
        const mk = async (tenantId: string, slug: string, n: string) => {
            const u = await prisma.user.create({ data: { email: `${n}-${TAG}@example.test`, name: n } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role: 'OWNER' } });
            return makeRequestContext('OWNER', { tenantId, userId: u.id, tenantSlug: slug, requestId: `${TAG}-${n}` });
        };
        ownerA = await mk(tenantA, TAG, 'Ana');
        ownerB = await mk(tenantB, `${TAG}-b`, 'Bob');

        // Workspace A: an older project whose items rank best, and a newer one.
        const teamA = await createTeam(ownerA, { name: 'Счетоводство' });
        projects.old = (await createProject(ownerA, { teamId: teamA.id, name: 'Архив', keyPrefix: 'SBO' })).id;
        projects.recent = (await createProject(ownerA, { teamId: teamA.id, name: 'Текущи', keyPrefix: 'SBR' })).id;
        const typeA = (await listWorkItemTypes(ownerA))[0]!.id;
        const create = (ctx: RequestContext, projectId: string, typeId: string, title: string, description: string) =>
            createWorkItem(ctx, { projectId, typeId, title, description }).then((i) => i.id);
        items.oldBest = await create(ownerA, projects.old, typeA, 'Old ledger', `${WORD} ${WORD} ${WORD} ${WORD}`);
        items.oldTitled = await create(ownerA, projects.old, typeA, `Годишна ${WORD}`, `Описание: ${WORD}`);
        items.middle = await create(ownerA, projects.recent, typeA, 'Middle ledger', `${WORD} ${WORD}`);
        items.newBest = await create(ownerA, projects.recent, typeA, 'New ledger one', `${WORD} ${WORD} ${WORD}`);
        items.newOther = await create(ownerA, projects.recent, typeA, 'New ledger two', `Описание: ${WORD}`);
        // 1,001 comments each on the two newest items: with their descriptions,
        // 2,004 matching vectors newer than any other, past the bound.
        await comments(ownerA, items.newBest, 1001, 'nb');
        await comments(ownerA, items.newOther, 1001, 'no');
        await comments(ownerA, items.middle, 5, 'mid');
        // The descriptions are the newest of all, the comments a minute older.
        await prisma.$executeRawUnsafe(
            `UPDATE "SearchVector" SET "updatedAt" = now() - interval '1 minute' WHERE "commentId" IS NOT NULL AND "workItemId" = ANY($1::text[])`,
            [items.newBest, items.newOther],
        );
        await age(items.oldBest, '3 days');
        await age(items.oldTitled, '3 days');
        await age(items.middle, '1 day');

        // Workspace B: a few matches, and 2,100 newer vectors of another word.
        const teamB = await createTeam(ownerB, { name: 'Other' });
        projects.b = (await createProject(ownerB, { teamId: teamB.id, name: 'Elsewhere', keyPrefix: 'SBX' })).id;
        const typeB = (await listWorkItemTypes(ownerB))[0]!.id;
        items.b1 = await create(ownerB, projects.b, typeB, 'B one', `${WORD} ${WORD} ${WORD}`);
        items.b2 = await create(ownerB, projects.b, typeB, 'B two', `${WORD} ${WORD}`);
        items.b3 = await create(ownerB, projects.b, typeB, 'B three', `Описание: ${WORD}`);
        await age(items.b1, '2 days');
    }, 120_000);

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    const match = (ctx: RequestContext, v: ProjectVisibility = ALL, cap = 100) => runInTenantContext(ctx, (db) => SearchVectorRepository.matchItems(db, ctx, v, WORD, cap));

    it('the walk reads its own index: tenant-leading, partial on the configuration', async () => {
        const [idx] = await prisma.$queryRaw<Array<{ indexdef: string }>>`SELECT indexdef FROM pg_indexes WHERE indexname = 'SearchVector_search_recent'`;
        expect(idx?.indexdef).toMatch(/ON public\."SearchVector" USING btree \("tenantId", "updatedAt", id\) WHERE \("configName" = 'islestone_bg_en'::text\)/);
    });

    it('past the bound, only the most recently written matches are ranked, and the read says so', async () => {
        const r = await match(ownerA);
        expect(r.bounded).toBe(true);
        // The two newest items, best first; the older ones are not candidates, however well they rank.
        expect(r.matches.map((m) => m.workItemId)).toEqual([items.newBest, items.newOther]);
        expect(r.matches[0]!.rank).toBeGreaterThan(r.matches[1]!.rank);
        expect(r.matches[0]!.commentId).toBeNull();
        expect(CONTENT_CANDIDATE_BOUND).toBe(2000);
    });

    it('a smaller cap keeps the flag', async () => {
        const r = await match(ownerA, ALL, 1);
        expect(r).toEqual({ matches: [expect.objectContaining({ workItemId: items.newBest })], bounded: true });
    });

    it('the bound counts only the projects the caller sees: an invisible project never cuts a read or sets the flag', async () => {
        const r = await match(ownerA, { kind: 'GRANTED', projectIds: [projects.old!] });
        expect(r.bounded).toBe(false);
        expect(r.matches.map((m) => m.workItemId)).toEqual([items.oldBest, items.oldTitled]);
    });

    it('under the bound, every match is ranked and the read is not bounded', async () => {
        const r = await match(ownerB);
        expect(r.bounded).toBe(false);
        expect(r.matches.map((m) => m.workItemId)).toEqual([items.b1, items.b2, items.b3]);
        const ranks = r.matches.map((m) => m.rank);
        expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
    });

    it("the bound counts only the caller's workspace: another's vectors never cut a read, and neither sees the other's", async () => {
        // Workspace B gains 2,100 vectors of the word, newer than A's: A's read is unchanged.
        await comments(ownerB, items.b3!, 2100, 'b');
        try {
            const a = await match(ownerA);
            expect(a.matches.map((m) => m.workItemId)).toEqual([items.newBest, items.newOther]);
            const b = await match(ownerB);
            expect(b.bounded).toBe(true);
            // B's 2,000 newest matching vectors are all b3's new comments.
            expect(b.matches.map((m) => m.workItemId)).toEqual([items.b3]);
            expect(b.matches.some((m) => Object.values(items).slice(0, 5).includes(m.workItemId))).toBe(false);
            // A's context naming B's workspace still reads A's: the workspace is the transaction's.
            const named = await runInTenantContext(ownerA, (db) => SearchVectorRepository.matchItems(db, ownerB, ALL, WORD, 100));
            expect(named.matches.map((m) => m.workItemId)).toEqual([items.newBest, items.newOther]);
        } finally {
            await prisma.$executeRawUnsafe(`DELETE FROM "Comment" WHERE "id" LIKE $1`, `${TAG}-b-%`);
        }
        await expect(match(ownerB)).resolves.toMatchObject({ bounded: false });
    });

    it('the palette says the content matches were bounded, and still finds a title in full', async () => {
        const r = await searchWorkspace(ownerA, WORD, { perTypeLimit: 10 });
        expect(r.meta.contentMatchesBounded).toBe(true);
        const byId = new Map(r.hits.map((h) => [h.id, h] as const));
        // The older item whose title holds the word is found by its title.
        expect(byId.get(items.oldTitled!)?.matchedIn).toBe('title');
        expect(byId.get(items.newBest!)?.matchedIn).toBe('description');
        expect(byId.has(items.oldBest!)).toBe(false);
        const small = await searchWorkspace(ownerB, WORD, { perTypeLimit: 10 });
        expect(small.meta.contentMatchesBounded).toBe(false);
    });

    it("the list's q says the content matches were bounded and holds the recent matches and the titles", async () => {
        const list = await listWorkItems(ownerA, { q: WORD, limit: 50 });
        expect(list.contentMatchesBounded).toBe(true);
        expect(new Set(list.items.map((i) => i.id))).toEqual(new Set([items.newBest, items.newOther, items.oldTitled]));
        const small = await listWorkItems(ownerB, { q: WORD, limit: 50 });
        expect(small.contentMatchesBounded).toBe(false);
        expect(small.items).toHaveLength(3);
        await expect(listWorkItems(ownerA, { limit: 5 })).resolves.toMatchObject({ contentMatchesBounded: false });
    });

    describe('a large workspace: the walk and the vector index (100,000 vectors and more)', () => {
        let ownerC: RequestContext;
        const large: Record<string, string> = {};

        /** `n` comments on `workItemId` with vectors of `text`, through the seam's bulk path. */
        async function bulkComments(ctx: RequestContext, workItemId: string, n: number, key: string, text: string): Promise<void> {
            await prisma.$executeRawUnsafe(
                `INSERT INTO "Comment" ("id", "tenantId", "workItemId", "authorUserId", "body", "createdAt", "updatedAt")
                 SELECT $1 || '-' || g, $2, $3, $4, 'v2:not-read', now(), now() FROM generate_series(1, $5::int) g`,
                `${TAG}-${key}`,
                ctx.tenantId,
                workItemId,
                ctx.userId,
                n,
            );
            for (let from = 0; from < n; from += 10_000) {
                const sources = Array.from({ length: Math.min(10_000, n - from) }, (_, i) => ({ workItemId, commentId: `${TAG}-${key}-${from + i + 1}`, plaintext: text }));
                // guardrail-allow: n+1 — the fixture's bounded pages of the bulk path (at most 10,000 sources each), as the seeder writes them.
                await prisma.$transaction((tx) => SearchVectorRepository.insertBulkForSeed(tx as unknown as PrismaTx, ctx, sources), { timeout: 120_000 });
            }
        }

        beforeAll(async () => {
            const tenantC = (await createTenantWithDek({ name: `${TAG}-c`, slug: `${TAG}-c` })).id;
            const u = await prisma.user.create({ data: { email: `cara-${TAG}@example.test`, name: 'Cara' } });
            await prisma.tenantMembership.create({ data: { tenantId: tenantC, userId: u.id, role: 'OWNER' } });
            ownerC = makeRequestContext('OWNER', { tenantId: tenantC, userId: u.id, tenantSlug: `${TAG}-c`, requestId: `${TAG}-cara` });
            const team = await createTeam(ownerC, { name: 'Large' });
            const projectId = (await createProject(ownerC, { teamId: team.id, name: 'Large', keyPrefix: 'SBL' })).id;
            const typeId = (await listWorkItemTypes(ownerC))[0]!.id;
            const create = (title: string, description: string) => createWorkItem(ownerC, { projectId, typeId, title, description }).then((i) => i.id);
            large.oldRare = await create('Old rare', 'Рядка дума кооператив');
            large.oldDense = await create('Old dense', `${WORD} ${WORD} ${WORD} ${WORD}`);
            large.newA = await create('New A', `${WORD} ${WORD}`);
            large.newB = await create('New B', `Описание: ${WORD}`);
            // 25,000 older items, each with a description and three comments of other words (100,000 vectors) ...
            const state = await prisma.workflowState.findFirstOrThrow({ where: { teamId: team.id }, select: { id: true, category: true } });
            const FILL = `${TAG}-fill-`;
            await prisma.$executeRawUnsafe(
                `INSERT INTO "WorkItem" ("id", "tenantId", "teamId", "projectId", "number", "typeId", "title", "stateId", "stateCategory", "createdByUserId", "sortKey", "updatedAt")
                 SELECT $1 || g, $2, $3, $4, 100000 + g, $5, 'Пълнеж ' || g, $6, $7::"WorkflowStateCategory", $8, 'f' || lpad(g::text, 6, '0'), now()
                   FROM generate_series(1, 25000) g`,
                FILL, tenantC, team.id, projectId, typeId, state.id, state.category, u.id,
            );
            await prisma.$executeRawUnsafe(
                `INSERT INTO "Comment" ("id", "tenantId", "workItemId", "authorUserId", "body", "createdAt", "updatedAt")
                 SELECT $1 || g || '-' || n, $2, $1 || g, $3, 'v2:not-read', now(), now() FROM generate_series(1, 25000) g, generate_series(1, 3) n`,
                FILL, tenantC, u.id,
            );
            const words = ['обем', 'пълнеж', 'отчет', 'среща', 'бюджет', 'договор', 'склад', 'доставка'];
            for (let from = 1; from <= 25000; from += 2500) {
                const page = Array.from({ length: 2500 }, (_, i) => from + i).flatMap((g) => [
                    { workItemId: `${FILL}${g}`, commentId: null, plaintext: `Пълнеж ${words[g % 8]} ${words[(g * 3) % 8]}` },
                    ...[1, 2, 3].map((n) => ({ workItemId: `${FILL}${g}`, commentId: `${FILL}${g}-${n}`, plaintext: `Коментар ${words[(g + n) % 8]} ${words[(g * n) % 8]}` })),
                ]);
                // guardrail-allow: n+1 — the fixture's bounded pages of the bulk path (10,000 sources each), as the seeder writes them.
                await prisma.$transaction((tx) => SearchVectorRepository.insertBulkForSeed(tx as unknown as PrismaTx, ownerC, page), { timeout: 120_000 });
            }
            await prisma.$executeRawUnsafe(`UPDATE "SearchVector" SET "updatedAt" = now() - interval '1 day' WHERE "tenantId" = $1`, tenantC);
            // ... then 2,100 newer matches on two items.
            await bulkComments(ownerC, large.newA, 1050, 'lna', `Коментар за ${WORD}`);
            await bulkComments(ownerC, large.newB, 1050, 'lnb', `Коментар за ${WORD}`);
            await prisma.$executeRawUnsafe('ANALYZE "WorkItem"');
            await prisma.$executeRawUnsafe('ANALYZE "Comment"');
            await prisma.$executeRawUnsafe('ANALYZE "SearchVector"');
        }, 300_000);

        const plansOf = (query: string) =>
            nestedSearchPlans(ownerC.tenantId, `SELECT * FROM search_item_contents($1, true, '{}', 100)`, [query]).then((plans) => JSON.stringify(plans.map((p) => p.plan)));

        it('a query dense among the newest vectors is walked on the recency index, and only the newest matches are ranked', async () => {
            const r = await match(ownerC);
            expect(r.bounded).toBe(true);
            // The older, better-ranked item is not among the newest 2,000 matches.
            expect(new Set(r.matches.map((m) => m.workItemId))).toEqual(new Set([large.newA, large.newB]));
            const plans = await plansOf(WORD);
            expect(plans).toMatch(/"Scan Direction":"Backward","Index Name":"SearchVector_search_recent"/);
        });

        it('a sparse query reads the vector index with its operator, and finds an old match', async () => {
            const r = await runInTenantContext(ownerC, (db) => SearchVectorRepository.matchItems(db, ownerC, ALL, 'кооператив', 100));
            expect(r).toEqual({ matches: [expect.objectContaining({ workItemId: large.oldRare })], bounded: false });
            const plans = await plansOf('кооператив');
            expect(plans).toMatch(/"Index Name":"SearchVector_search_lexemes"/);
        });
    });
});
