/**
 * Search over descriptions and comments against Islestone's Postgres image
 * (sub-phase 2.7f; ADR 0008; owner decisions 124, 126 and 145 to 147;
 * docs/search.md):
 *
 *   - the configuration: `islestone_bg_en` exists, maps Latin words to
 *     `english_stem` and other-letter words to the Bulgarian dictionary then
 *     `simple`, and stems the fixtures as pinned (the startup and readiness
 *     check passes); 2.7b's two full-text indexes are rebuilt on it, and the
 *     vector index, the partial uniques and the CHECKs exist;
 *   - `SearchVector` is a tenant table: as `app_user` in workspace B nothing
 *     of A's is read, changed, removed or created (the two-tenant test
 *     `tests/guards/tenant-isolation-forward-lock.test.ts` names);
 *   - the one seam, in the text's own transaction: a create with a
 *     description, a description edit, a cleared description, a comment, its
 *     edit and its delete; a write that fails leaves the vector as it was;
 *     mention tokens are never lexemes (the other writers, the template item
 *     and every caller of the create core, are held to the seam by
 *     `tests/guards/search-vector-write-seam.test.ts`);
 *   - the search: Bulgarian and English stems, phrases, description and
 *     comment hits below title hits with a snippet, never a deleted comment or
 *     item, an archived project, a GUEST or another workspace; the list's `q`
 *     finds them, and stemmed titles, too;
 *   - the reads are spelled so the vector index and the stemmed title index
 *     can serve them;
 *   - the purge, a comment's and a workspace's hard delete take the vectors;
 *   - the rebuild: missing and older rows rewritten, counts-only audit, an
 *     admin's request re-resolved when it runs.
 *
 * Written fresh for Islestone.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { processSearchIndexRebuild } from '@/app-layer/jobs/search-index-rebuild';
import { SearchVectorRepository } from '@/app-layer/repositories/SearchVectorRepository';
import { WorkItemRepository } from '@/app-layer/repositories/WorkItemRepository';
import { createProject } from '@/app-layer/usecases/project';
import { searchWorkspace } from '@/app-layer/usecases/search';
import { rebuildSearchIndex } from '@/app-layer/usecases/search-index';
import { createTeam } from '@/app-layer/usecases/team';
import { createWorkItem, listWorkItems, updateWorkItem } from '@/app-layer/usecases/work-item';
import { addComment, deleteComment, editComment } from '@/app-layer/usecases/work-item-collab';
import { purgeWorkspaceWorkItems } from '@/app-layer/usecases/work-item-purge';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { getPermissionsForRole } from '@/lib/permissions';
import { checkSearchConfiguration } from '@/lib/search/configuration-check';
import { SEARCH_VECTOR_REVISION } from '@/lib/search/configuration';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { deleteAuditRowsForTenants } from '../helpers/audit-cleanup';
import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `svec${Date.now().toString(36)}`;

describeFn('search over descriptions and comments (2.7f)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let otherTenantId = '';
    let owner: RequestContext;
    let member: RequestContext;
    let guest: RequestContext;
    let outsider: RequestContext;
    let projectId = '';
    let archivedProjectId = '';
    let otherProjectId = '';
    let typeId = '';
    let otherTypeId = '';

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        otherTenantId = (await createTenantWithDek({ name: `${TAG}-b`, slug: `${TAG}-b` })).id;
        const mk = async (tenant: string, slug: string, role: 'OWNER' | 'MEMBER' | 'GUEST', n: string) => {
            const u = await prisma.user.create({ data: { email: `${n}-${TAG}@example.test`, name: n } });
            await prisma.tenantMembership.create({ data: { tenantId: tenant, userId: u.id, role } });
            return makeRequestContext(role, { tenantId: tenant, userId: u.id, tenantSlug: slug, requestId: `${TAG}-${n}` });
        };
        owner = await mk(tenantId, TAG, 'OWNER', 'Olga');
        member = await mk(tenantId, TAG, 'MEMBER', 'Mira');
        guest = await mk(tenantId, TAG, 'GUEST', 'Gena');
        outsider = await mk(otherTenantId, `${TAG}-b`, 'OWNER', 'Bora');
        const team = await createTeam(owner, { name: 'Ядро' });
        projectId = (await createProject(owner, { teamId: team.id, name: 'Поддръжка', keyPrefix: 'SVP' })).id;
        const archivedTeam = await createTeam(owner, { name: 'Archive team' });
        archivedProjectId = (await createProject(owner, { teamId: archivedTeam.id, name: 'Old', keyPrefix: 'SVO' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
        const otherTeam = await createTeam(outsider, { name: 'Other' });
        otherProjectId = (await createProject(outsider, { teamId: otherTeam.id, name: 'Elsewhere', keyPrefix: 'SVX' })).id;
        otherTypeId = (await listWorkItemTypes(outsider))[0]!.id;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    /** The stored vectors of a workspace, as text, by source. */
    const vectors = (where: { workItemId?: string; commentId?: string | null } = {}) =>
        prisma.$queryRawUnsafe<Array<{ workItemId: string; commentId: string | null; lexemes: string; configName: string; revision: number }>>(
            `SELECT "workItemId", "commentId", "lexemes"::text AS lexemes, "configName", "revision" FROM "SearchVector"
              WHERE "tenantId" = $1
                AND ($2::text IS NULL OR "workItemId" = $2)
                AND ($3::boolean IS FALSE OR "commentId" IS NOT DISTINCT FROM $4)
              ORDER BY "workItemId", "commentId" NULLS FIRST`,
            tenantId,
            where.workItemId ?? null,
            where.commentId !== undefined,
            where.commentId ?? null,
        );

    // ─── The configuration and the catalogue ────────────────────────

    describe('the configuration', () => {
        it('stems as pinned: the readiness and startup check passes', async () => {
            await expect(checkSearchConfiguration((q) => prisma.$queryRaw(q))).resolves.toEqual({ ok: true });
        });

        it('maps Latin words to english_stem and other-letter words to the Bulgarian dictionary, then simple', async () => {
            const rows = await prisma.$queryRaw<Array<{ alias: string; dictionaries: string }>>`
                SELECT alias::text AS alias, array_to_string(dictionaries::regdictionary[]::text[], ',') AS dictionaries
                  FROM ts_debug('islestone_bg_en', 'Задачата running')
                 WHERE alias IN ('word', 'asciiword')`;
            expect(rows).toEqual([
                { alias: 'word', dictionaries: 'bulgarian_hunspell,simple' },
                { alias: 'asciiword', dictionaries: 'english_stem' },
            ]);
        });

        it('2.7b\'s full-text indexes are rebuilt on islestone_bg_en, and the vector index and constraints exist', async () => {
            const idx = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
                SELECT indexname::text AS indexname, indexdef FROM pg_indexes
                 WHERE indexname IN ('WorkItem_search_title_fts', 'Project_search_name_fts', 'SearchVector_search_lexemes',
                                     'SearchVector_one_per_description', 'SearchVector_one_per_comment')
                 ORDER BY indexname`;
            const def = (name: string) => idx.find((i) => i.indexname === name)!.indexdef;
            expect(def('WorkItem_search_title_fts')).toContain("to_tsvector('islestone_bg_en'::regconfig, title)");
            expect(def('Project_search_name_fts')).toContain("to_tsvector('islestone_bg_en'::regconfig, name)");
            expect(def('SearchVector_search_lexemes')).toMatch(/USING gin \("tenantId", lexemes\) WHERE \("configName" = 'islestone_bg_en'::text\)/);
            expect(def('SearchVector_one_per_description')).toMatch(/WHERE \("commentId" IS NULL\)/);
            expect(def('SearchVector_one_per_comment')).toMatch(/WHERE \("commentId" IS NOT NULL\)/);
            const fks = await prisma.$queryRaw<Array<{ conname: string; confdeltype: string }>>`
                SELECT conname::text AS conname, confdeltype::text AS confdeltype FROM pg_constraint
                 WHERE conrelid = '"SearchVector"'::regclass AND contype = 'f' ORDER BY conname`;
            // The workspace, the item and the comment each take their vectors with them.
            expect(fks.map((f) => [f.conname, f.confdeltype])).toEqual([
                ['SearchVector_commentId_workItemId_tenantId_fkey', 'c'],
                ['SearchVector_tenantId_fkey', 'c'],
                ['SearchVector_workItemId_tenantId_fkey', 'c'],
            ]);
        });
    });

    // ─── The seam ───────────────────────────────────────────────────

    describe('the one seam, in the text\'s own transaction', () => {
        let itemId = '';
        let commentId = '';

        beforeAll(async () => {
            const item = await createWorkItem(owner, {
                projectId,
                typeId,
                title: 'Нещо се счупи',
                description: `Потребителите не виждат задачите си. <@${member.userId}> please check the failing builds.`,
            });
            itemId = item.id;
        });

        it('a create writes the description\'s vector, stemmed, with no mention token in it', async () => {
            const [row] = await vectors({ workItemId: itemId, commentId: null });
            expect(row).toMatchObject({ configName: 'islestone_bg_en', revision: SEARCH_VECTOR_REVISION });
            expect(row!.lexemes).toContain("'потребител'");
            expect(row!.lexemes).toContain("'задача'");
            expect(row!.lexemes).toContain("'fail'");
            expect(row!.lexemes).toContain("'build'");
            expect(row!.lexemes).not.toContain(member.userId.toLowerCase());
        });

        it('an edit replaces it; a write that fails (a stale version) leaves it as it was', async () => {
            const current = await prisma.workItem.findUniqueOrThrow({ where: { id: itemId }, select: { version: true } });
            await updateWorkItem(owner, itemId, { description: 'Отговорът на въпросите е в документацията.' }, current.version);
            const [row] = await vectors({ workItemId: itemId, commentId: null });
            expect(row!.lexemes).toContain("'отговор'");
            expect(row!.lexemes).not.toContain("'потребител'");
            await expect(updateWorkItem(owner, itemId, { description: 'stale words only' }, current.version)).rejects.toThrow();
            const [after] = await vectors({ workItemId: itemId, commentId: null });
            expect(after!.lexemes).toBe(row!.lexemes);
        });

        it('a comment, its edit and its delete keep its vector in step', async () => {
            const c = await addComment(member, itemId, { body: 'Проверих сроковете на проекта.' });
            commentId = c.id;
            expect((await vectors({ workItemId: itemId, commentId }))[0]!.lexemes).toContain("'срок'");
            await editComment(member, itemId, commentId, { body: 'Running the migration again.' });
            const [edited] = await vectors({ workItemId: itemId, commentId });
            expect(edited!.lexemes).toContain("'migrat'");
            expect(edited!.lexemes).not.toContain("'срок'");
            await deleteComment(member, itemId, commentId);
            expect(await vectors({ workItemId: itemId, commentId })).toEqual([]);
        });

        it('a cleared description removes its vector; an item without one has none', async () => {
            const current = await prisma.workItem.findUniqueOrThrow({ where: { id: itemId }, select: { version: true } });
            await updateWorkItem(owner, itemId, { description: null }, current.version);
            expect(await vectors({ workItemId: itemId, commentId: null })).toEqual([]);
            const bare = await createWorkItem(owner, { projectId, typeId, title: 'No words' });
            expect(await vectors({ workItemId: bare.id })).toEqual([]);
        });
    });

    // ─── Isolation ──────────────────────────────────────────────────

    describe('SearchVector is a tenant table', () => {
        let mineId = '';
        let theirsId = '';

        beforeAll(async () => {
            mineId = (await createWorkItem(owner, { projectId, typeId, title: 'Mine', description: 'isolation canary words' })).id;
            theirsId = (await createWorkItem(outsider, { projectId: otherProjectId, typeId: otherTypeId, title: 'Theirs', description: 'isolation canary words' })).id;
        });

        it('as app_user in B, none of A\'s rows are read, changed, removed or created', async () => {
            await runInTenantContext(outsider, async (db) => {
                const seen = await db.$queryRaw<Array<{ workItemId: string }>>`SELECT "workItemId" FROM "SearchVector"`;
                expect(seen.map((r) => r.workItemId)).toEqual([theirsId]);
                // The delegate reads (the lexemes are not selectable through it) see B's row only.
                expect(await db.searchVector.count({ where: { workItemId: mineId } })).toBe(0);
                expect((await db.searchVector.findMany({ take: 10, select: { workItemId: true } })).map((r) => r.workItemId)).toEqual([theirsId]);
                expect(await db.$executeRaw`UPDATE "SearchVector" SET "revision" = 99 WHERE "workItemId" = ${mineId}`).toBe(0);
                expect(await db.$executeRaw`DELETE FROM "SearchVector" WHERE "workItemId" = ${mineId}`).toBe(0);
            });
            await expect(
                runInTenantContext(outsider, (db) =>
                    db.$executeRaw`INSERT INTO "SearchVector" ("id", "tenantId", "workItemId", "commentId", "lexemes", "configName", "revision", "updatedAt")
                                   VALUES ('forged', ${tenantId}, ${mineId}, NULL, to_tsvector('islestone_bg_en', 'x'), 'islestone_bg_en', 1, now())`,
                ),
            ).rejects.toThrow();
            expect((await vectors({ workItemId: mineId }))[0]!.revision).toBe(SEARCH_VECTOR_REVISION);
        });

        it('a row built with another configuration is refused', async () => {
            await expect(
                runInTenantContext(owner, (db) =>
                    db.$executeRaw`UPDATE "SearchVector" SET "configName" = 'simple' WHERE "workItemId" = ${mineId}`,
                ),
            ).rejects.toThrow();
        });

        it('the search never offers another workspace\'s item', async () => {
            const r = await searchWorkspace(outsider, 'canary');
            expect(r.hits.map((h) => h.id)).toEqual([theirsId]);
        });
    });

    // ─── The search ─────────────────────────────────────────────────

    describe('searching descriptions and comments', () => {
        const ids: Record<string, string> = {};

        beforeAll(async () => {
            const make = async (name: string, title: string, description?: string, project = projectId) => {
                ids[name] = (await createWorkItem(owner, { projectId: project, typeId, title, ...(description ? { description } : {}) })).id;
            };
            await make('titled', 'Задачата за фактурите');
            await make('described', 'Счетоводство', `${'Въведение. '.repeat(30)}Задачите по фактурите чакат одобрение от счетоводството.`);
            await make('commented', 'Plain title');
            await addComment(member, ids.commented!, { body: 'Фактурата е изпратена на клиента.' });
            await make('deletedComment', 'Another title');
            const gone = await addComment(member, ids.deletedComment!, { body: 'фактура в изтрит коментар' });
            await deleteComment(member, ids.deletedComment!, gone.id);
            await make('deletedItem', 'Deleted', 'фактура в изтрита задача');
            await prisma.workItem.update({ where: { id: ids.deletedItem! }, data: { deletedAt: new Date(), deletionId: `${TAG}-d` } });
            await make('archived', 'Archived', 'фактура в архивиран проект', archivedProjectId);
            await prisma.project.update({ where: { id: archivedProjectId }, data: { archivedAt: new Date() } });
            await make('english', 'Release', 'The invoices were running late again.');
        });

        afterAll(async () => {
            await prisma.project.update({ where: { id: archivedProjectId }, data: { archivedAt: null } });
        });

        it('finds a stem in a description and a comment, below the title match, with where and a snippet', async () => {
            const r = await searchWorkspace(owner, 'фактура', { perTypeLimit: 10 });
            const items = r.hits.filter((h) => h.type === 'workItem');
            expect(items.map((h) => h.id).sort()).toEqual([ids.titled, ids.described, ids.commented].sort());
            expect(items[0]).toMatchObject({ id: ids.titled, matchedIn: 'title', snippet: null });
            const described = items.find((h) => h.id === ids.described)!;
            expect(described.matchedIn).toBe('description');
            expect(described.snippet).toContain('фактурите');
            expect(described.snippet!.startsWith('…')).toBe(true);
            const commented = items.find((h) => h.id === ids.commented)!;
            expect(commented).toMatchObject({ matchedIn: 'comment', snippet: 'Фактурата е изпратена на клиента.' });
            expect(described.score).toBeLessThan(items[0]!.score);
        });

        it('stems English through english_stem, and a phrase must match as a phrase', async () => {
            expect((await searchWorkspace(owner, 'invoice run')).hits.map((h) => h.id)).toEqual([ids.english]);
            expect((await searchWorkspace(owner, '"invoices were running"')).hits.map((h) => h.id)).toEqual([ids.english]);
            expect((await searchWorkspace(owner, '"running invoices"')).hits).toEqual([]);
        });

        it('never offers a deleted comment, a deleted item, an archived project, or anything to a GUEST', async () => {
            const found = (await searchWorkspace(owner, 'изтрит')).hits.map((h) => h.id);
            expect(found).toEqual([]);
            expect((await searchWorkspace(owner, 'архивиран')).hits).toEqual([]);
            // Decision 204: a GUEST is refused; one granted the read keys, as 8.4 will, with no grant finds nothing.
            await expect(searchWorkspace(guest, 'фактура')).rejects.toMatchObject({ status: 403 });
            expect((await searchWorkspace({ ...guest, appPermissions: getPermissionsForRole('VIEWER') }, 'фактура')).hits).toEqual([]);
        });

        it('the list\'s q finds description and comment matches too, under its own filters', async () => {
            const page = await listWorkItems(member, { q: 'фактура' });
            expect(page.items.map((i) => i.id).sort()).toEqual([ids.titled, ids.described, ids.commented].sort());
            const typed = await listWorkItems(member, { q: 'фактура', projectId: archivedProjectId });
            expect(typed.items).toEqual([]);
        });
    });

    // ─── The planner ────────────────────────────────────────────────

    describe('the indexes serve the reads', () => {
        const FILLER = `${TAG}-f-`;

        beforeAll(async () => {
            // Enough live rows and vectors in the workspace (20,000) that the
            // planner weighs the indexes as in a busy workspace (as 2.7b's test).
            const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { teamId: true } });
            const state = await prisma.workflowState.findFirstOrThrow({ where: { teamId: project.teamId }, select: { id: true, category: true } });
            await prisma.$executeRawUnsafe(
                `INSERT INTO "WorkItem" ("id", "tenantId", "teamId", "projectId", "number", "typeId", "title", "stateId", "stateCategory", "createdByUserId", "sortKey", "updatedAt")
                 SELECT $1 || g, $2, $3, $4, 100000 + g, $5, 'Пълнеж ' || md5(g::text) || ' widget ' || g, $6, $7::"WorkflowStateCategory", $8, 'f' || lpad(g::text, 6, '0'), now()
                   FROM generate_series(1, 20000) g`,
                FILLER, tenantId, project.teamId, projectId, typeId, state.id, state.category, owner.userId,
            );
            await prisma.$executeRawUnsafe(
                `INSERT INTO "SearchVector" ("id", "tenantId", "workItemId", "commentId", "lexemes", "configName", "revision", "updatedAt")
                 SELECT $1 || g, $2, $1 || g, NULL, to_tsvector('islestone_bg_en', 'пълнеж ' || md5(g::text)), 'islestone_bg_en', 1, now()
                   FROM generate_series(1, 20000) g`,
                FILLER, tenantId,
            );
            await prisma.$executeRawUnsafe('ANALYZE "WorkItem"');
            await prisma.$executeRawUnsafe('ANALYZE "SearchVector"');
        });

        afterAll(async () => {
            await prisma.$executeRawUnsafe(`DELETE FROM "WorkItem" WHERE "id" LIKE $1`, `${FILLER}%`);
        });

        /**
         * The plan with only bitmap scans and hash joins allowed: with one
         * project in the workspace the planner's merge-join estimate otherwise
         * prefers walking a btree, which says nothing about whether the
         * expression and the partial predicate are spelled so an index CAN
         * serve them, which is what these tests hold.
         */
        async function planOf(sql: string, params: unknown[], withoutIndexes: readonly string[] = []): Promise<string> {
            let plan = '';
            await prisma
                .$transaction(async (tx) => {
                    // Dropped inside the transaction, which always rolls back.
                    for (const index of withoutIndexes) await tx.$executeRawUnsafe(`DROP INDEX "${index}"`);
                    await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
                    await tx.$executeRawUnsafe('SET LOCAL enable_indexscan = off');
                    await tx.$executeRawUnsafe('SET LOCAL enable_mergejoin = off');
                    await tx.$executeRawUnsafe('SET LOCAL enable_nestloop = off');
                    const rows = await tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': unknown }>>(`EXPLAIN (FORMAT JSON) ${sql}`, ...params);
                    plan = JSON.stringify(rows[0]!['QUERY PLAN']);
                    throw new Error('roll back');
                })
                .catch((err: unknown) => {
                    if (!(err instanceof Error) || err.message !== 'roll back') throw err;
                });
            return plan;
        }
        const capture = () => {
            let captured: Prisma.Sql | null = null;
            const db = { $queryRaw: async (q: Prisma.Sql) => ((captured = q), []) } as never;
            return { db, sql: () => captured! };
        };

        it('the description and comment match can use the tenant-leading vector index', async () => {
            const c = capture();
            await SearchVectorRepository.matchItems(c.db, owner, { kind: 'ALL' }, 'фактура', 20);
            // The tenant-leading btrees answer `tenantId = $1` as cheaply by the
            // planner's estimate (every row of the workspace); without them the
            // vector index must serve the match, which proves the read names
            // the configuration and the match as the partial index needs.
            const plan = await planOf(c.sql().text, c.sql().values, [
                'SearchVector_tenantId_revision_idx',
                'SearchVector_tenantId_workItemId_idx',
                'SearchVector_tenantId_commentId_idx',
                'SearchVector_one_per_comment',
                'SearchVector_one_per_description',
            ]);
            expect(plan).toContain('SearchVector_search_lexemes');
            expect(plan).toMatch(/lexemes @@ /);
        });

        it('the list\'s stemmed title match can use the islestone_bg_en title index', async () => {
            const c = capture();
            await WorkItemRepository.titleFullTextIds(c.db, owner, { kind: 'ALL' }, 'фактура', 20);
            expect(await planOf(c.sql().text, c.sql().values)).toContain('WorkItem_search_title_fts');
        });
    });

    // ─── Purge and cascades ─────────────────────────────────────────

    describe('the vectors go with their text', () => {
        it('the 30-day purge takes an item\'s vectors with it', async () => {
            const item = await createWorkItem(owner, { projectId, typeId, title: 'To purge', description: 'purge canary' });
            await addComment(member, item.id, { body: 'purge canary comment' });
            expect(await vectors({ workItemId: item.id })).toHaveLength(2);
            await prisma.workItem.update({ where: { id: item.id }, data: { deletedAt: new Date('2020-01-01'), deletionId: `${TAG}-p` } });
            await purgeWorkspaceWorkItems(makeRequestContext('OWNER', { tenantId, userId: owner.userId, tenantSlug: TAG }), new Date('2021-01-01'), 30);
            expect(await vectors({ workItemId: item.id })).toEqual([]);
        });

        it('a workspace\'s delete takes every vector it holds', async () => {
            const slug = `${TAG}-c`;
            const goneTenant = (await createTenantWithDek({ name: slug, slug })).id;
            const u = await prisma.user.create({ data: { email: `c-${TAG}@example.test`, name: 'Cora' } });
            await prisma.tenantMembership.create({ data: { tenantId: goneTenant, userId: u.id, role: 'OWNER' } });
            const cora = makeRequestContext('OWNER', { tenantId: goneTenant, userId: u.id, tenantSlug: slug });
            const team = await createTeam(cora, { name: 'Gone' });
            const project = await createProject(cora, { teamId: team.id, name: 'Gone', keyPrefix: 'SVG' });
            const type = (await listWorkItemTypes(cora))[0]!.id;
            const item = await createWorkItem(cora, { projectId: project.id, typeId: type, title: 'Gone', description: 'workspace canary' });
            await addComment(cora, item.id, { body: 'workspace canary comment' });
            const count = () => prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM "SearchVector" WHERE "tenantId" = ${goneTenant}`;
            expect((await count())[0]!.n).toBe(2);
            // A deleted workspace's last owner may leave (the last-owner trigger's exit).
            await prisma.tenant.update({ where: { id: goneTenant }, data: { deletedAt: new Date() } });
            await prisma.tenantMembership.deleteMany({ where: { tenantId: goneTenant } });
            await deleteAuditRowsForTenants(prisma, goneTenant);
            await prisma.tenant.delete({ where: { id: goneTenant } });
            expect((await count())[0]!.n).toBe(0);
        });
    });

    // ─── The rebuild ────────────────────────────────────────────────

    describe('search-index-rebuild', () => {
        let itemId = '';

        beforeAll(async () => {
            itemId = (await createWorkItem(owner, { projectId, typeId, title: 'Rebuild me', description: 'Проверка на индекса' })).id;
            await addComment(member, itemId, { body: 'Още една проверка' });
        });

        it('rewrites missing and older rows, writes counts only to the trail, and changes nothing on a second run', async () => {
            await prisma.$executeRaw`DELETE FROM "SearchVector" WHERE "workItemId" = ${itemId} AND "commentId" IS NULL`;
            // Revision 1 is the first, so an older row cannot exist yet (the
            // CHECK refuses 0); a missing row is the backfill's case.
            await expect(prisma.$executeRaw`UPDATE "SearchVector" SET "revision" = 0 WHERE "workItemId" = ${itemId}`).rejects.toThrow();
            const before = await vectors({ workItemId: itemId });
            expect(before.map((r) => r.commentId === null)).toEqual([false]);
            const result = await rebuildSearchIndex(makeRequestContext('OWNER', { tenantId, userId: owner.userId, tenantSlug: TAG }));
            expect(result.descriptions).toBeGreaterThanOrEqual(1);
            expect(result.complete).toBe(true);
            const after = await vectors({ workItemId: itemId });
            expect(after.map((r) => r.commentId === null)).toEqual([true, false]);
            expect(after[0]!.lexemes).toContain("'проверка'");
            const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'SEARCH_INDEX_REBUILT' }, orderBy: { createdAt: 'desc' } });
            expect(JSON.stringify(audit)).not.toContain('Проверка');
            const again = await rebuildSearchIndex(makeRequestContext('OWNER', { tenantId, userId: owner.userId, tenantSlug: TAG }));
            expect(again).toMatchObject({ descriptions: 0, comments: 0, removed: 0 });
        });

        it('an admin\'s request runs as them, forced, and is refused once they no longer hold admin.manage', async () => {
            const forced = await processSearchIndexRebuild({ tenantId, force: true, requestedByUserId: owner.userId });
            expect(forced.tenants).toBe(1);
            expect(forced.descriptions).toBeGreaterThan(0);
            await expect(processSearchIndexRebuild({ tenantId, force: true, requestedByUserId: member.userId })).rejects.toThrow(/admin\.manage/);
        });

        it('the nightly run passes every live workspace as its system user', async () => {
            const r = await processSearchIndexRebuild({});
            expect(r.failedTenants).toBe(0);
            expect(r.tenants).toBeGreaterThanOrEqual(2);
        });
    });
});
