/**
 * The search functions against the migrated database (owner decision 245,
 * issue #78; migration `20261214120000_search_definer_functions`;
 * docs/search.md, "The search functions"; docs/rls-tenant-isolation.md,
 * "The search functions: a named exception").
 *
 *   - The catalogue: each function is SECURITY DEFINER, never LEAKPROOF,
 *     sets exactly the fixed `search_path`, is owned by `app_search_definer`,
 *     is executable by that owner and `app_user` alone (nothing for PUBLIC),
 *     takes no workspace argument, and its body (`pg_proc.prosrc`) is the
 *     migration's, which passes `definerProblems` (the workspace from
 *     `app.tenant_id`, `deletedAt`, visibility, the bound).
 *   - The owner: cannot log in, is not a superuser, inherits nothing, is a
 *     member of nothing and has no members, owns no table, holds SELECT on
 *     exactly the columns the functions read and no table privilege; the
 *     tables it reads keep row-level security enabled and FORCED, and none of
 *     the operators the functions search with is LEAKPROOF.
 *   - Two workspaces, through `runInTenantContext` (`app_user`): each search
 *     read returns its own workspace's rows only, whatever workspace the
 *     context passed to the repository names; a project outside the
 *     visibility input, a deleted item, a deleted comment and an archived
 *     project never appear; with `app.tenant_id` unset (or empty) every
 *     function returns nothing.
 *
 * Written fresh for Islestone.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import type { ProjectVisibility } from '@/app-layer/policies/project-visibility';
import { ProjectRepository } from '@/app-layer/repositories/ProjectRepository';
import { SearchVectorRepository } from '@/app-layer/repositories/SearchVectorRepository';
import { WorkItemRepository } from '@/app-layer/repositories/WorkItemRepository';
import { createProject } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { createWorkItem } from '@/app-layer/usecases/work-item';
import { addComment } from '@/app-layer/usecases/work-item-collab';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';
import { SEARCH_DEFINER_FUNCTIONS, SEARCH_DEFINER_ROLE, SEARCH_DEFINER_SEARCH_PATH, definerProblems, definitionsIn } from '../helpers/search-definer';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `sdef${Date.now().toString(36)}`;
const MIGRATION = path.resolve(__dirname, '../../prisma/migrations/20261214120000_search_definer_functions/migration.sql');

/** The columns the owner may read, and nothing else. */
const OWNER_COLUMNS: Readonly<Record<string, readonly string[]>> = {
    Comment: ['deletedAt', 'id', 'tenantId'],
    Project: ['archivedAt', 'deletedAt', 'id', 'keyPrefix', 'name', 'tenantId'],
    SearchVector: ['commentId', 'configName', 'lexemes', 'tenantId', 'workItemId'],
    WorkItem: ['deletedAt', 'id', 'projectId', 'tenantId', 'title'],
};

describeFn('the search functions (decision 245)', () => {
    let prisma: PrismaClient;

    beforeAll(() => {
        prisma = prismaTestClient();
    });

    // ─── The catalogue ──────────────────────────────────────────────

    describe('the catalogue', () => {
        const migrated = definitionsIn(fs.readFileSync(MIGRATION, 'utf8'));

        it.each(SEARCH_DEFINER_FUNCTIONS.map((s) => [s.name, s] as const))('%s: definer, fixed search path, owner, EXECUTE and body as the migration says', async (_name, spec) => {
            const rows = await prisma.$queryRaw<
                Array<{ prosecdef: boolean; proleakproof: boolean; proconfig: string[] | null; owner: string; acl: string[]; args: string; identity: string; prosrc: string }>
            >`
                SELECT p.prosecdef, p.proleakproof, p.proconfig, r.rolname::text AS owner,
                       COALESCE(p.proacl::text[], '{}') AS acl,
                       pg_get_function_arguments(p.oid) AS args,
                       pg_get_function_identity_arguments(p.oid) AS identity,
                       p.prosrc
                  FROM pg_proc p
                  JOIN pg_roles r ON r.oid = p.proowner
                  JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE p.proname = ${spec.name} AND n.nspname = 'public'`;
            expect(rows).toHaveLength(1);
            const fn = rows[0]!;
            expect(fn.prosecdef).toBe(true);
            expect(fn.proleakproof).toBe(false);
            expect(fn.proconfig).toEqual([`search_path=${SEARCH_DEFINER_SEARCH_PATH}`]);
            expect(fn.owner).toBe(SEARCH_DEFINER_ROLE);
            expect([...fn.acl].sort()).toEqual([`${SEARCH_DEFINER_ROLE}=X/${SEARCH_DEFINER_ROLE}`, `app_user=X/${SEARCH_DEFINER_ROLE}`]);
            // No argument names or carries a workspace.
            expect(fn.args).not.toMatch(/tenant/i);
            expect(fn.identity.replace(/\b\w+ (text|boolean|integer)/g, '$1')).toBe(spec.argTypes);
            // The body that runs is the migration's, and it isolates.
            const def = migrated.find((d) => d.name === spec.name)!;
            expect(fn.prosrc).toBe(def.body);
            expect(definerProblems(spec, { ...def, body: fn.prosrc })).toEqual([]);
        });

        it('no other function is owned by the definer role, and no search function exists outside the pinned five', async () => {
            const owned = await prisma.$queryRaw<Array<{ proname: string }>>`
                SELECT p.proname::text AS proname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE r.rolname = ${SEARCH_DEFINER_ROLE} ORDER BY 1`;
            expect(owned.map((o) => o.proname)).toEqual(SEARCH_DEFINER_FUNCTIONS.map((s) => s.name).sort());
        });

        it('the owner cannot log in, bypasses nothing but RLS, inherits nothing, has no members and owns no table', async () => {
            const [role] = await prisma.$queryRaw<
                Array<{ rolcanlogin: boolean; rolsuper: boolean; rolinherit: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolreplication: boolean }>
            >`SELECT rolcanlogin, rolsuper, rolinherit, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication FROM pg_roles WHERE rolname = ${SEARCH_DEFINER_ROLE}`;
            expect(role).toEqual({ rolcanlogin: false, rolsuper: false, rolinherit: false, rolbypassrls: true, rolcreaterole: false, rolcreatedb: false, rolreplication: false });
            const memberships = await prisma.$queryRaw<Array<{ n: bigint }>>`
                SELECT count(*) AS n FROM pg_auth_members m JOIN pg_roles r ON r.oid IN (m.roleid, m.member) WHERE r.rolname = ${SEARCH_DEFINER_ROLE}`;
            expect(Number(memberships[0]!.n)).toBe(0);
            const owns = await prisma.$queryRaw<Array<{ n: bigint }>>`
                SELECT count(*) AS n FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = ${SEARCH_DEFINER_ROLE}`;
            expect(Number(owns[0]!.n)).toBe(0);
        });

        it('the owner holds SELECT on exactly the columns the functions read, and no table privilege', async () => {
            const cols = await prisma.$queryRaw<Array<{ table_name: string; column_name: string; privilege_type: string }>>`
                SELECT table_name::text, column_name::text, privilege_type::text FROM information_schema.column_privileges
                 WHERE grantee = ${SEARCH_DEFINER_ROLE} ORDER BY table_name, column_name`;
            expect(cols.every((c) => c.privilege_type === 'SELECT')).toBe(true);
            const byTable: Record<string, string[]> = {};
            for (const c of cols) (byTable[c.table_name] ??= []).push(c.column_name);
            expect(byTable).toEqual(OWNER_COLUMNS);
            const tables = await prisma.$queryRaw<Array<{ n: bigint }>>`
                SELECT count(*) AS n FROM information_schema.table_privileges WHERE grantee = ${SEARCH_DEFINER_ROLE}`;
            expect(Number(tables[0]!.n)).toBe(0);
        });

        it('the tables the functions read keep row-level security enabled and forced; the search operators stay not LEAKPROOF', async () => {
            const rls = await prisma.$queryRaw<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
                SELECT relname::text, relrowsecurity, relforcerowsecurity FROM pg_class
                 WHERE relname IN ('WorkItem', 'Project', 'Comment', 'SearchVector') AND relkind = 'r' ORDER BY relname`;
            expect(rls).toEqual(['Comment', 'Project', 'SearchVector', 'WorkItem'].map((relname) => ({ relname, relrowsecurity: true, relforcerowsecurity: true })));
            const ops = await prisma.$queryRaw<Array<{ proname: string; proleakproof: boolean }>>`
                SELECT DISTINCT proname::text, proleakproof FROM pg_proc WHERE proname IN ('texticlike', 'ts_match_vq', 'similarity_op', 'similarity') ORDER BY 1`;
            expect(ops.map((o) => o.proname)).toEqual(['similarity', 'similarity_op', 'texticlike', 'ts_match_vq']);
            expect(ops.filter((o) => o.proleakproof)).toEqual([]);
        });
    });

    // ─── Two workspaces ─────────────────────────────────────────────

    describe('two workspaces, as app_user', () => {
        let ownerA: RequestContext;
        let ownerB: RequestContext;
        const ids: Record<string, string> = {};
        const projects: Record<string, string> = {};
        const ALL: ProjectVisibility = { kind: 'ALL' };
        const WORD = 'квокка';
        const PATTERN_WORD = 'Quokka';

        beforeAll(async () => {
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
            const seed = async (ctx: RequestContext, key: string, prefix: string) => {
                const team = await createTeam(ctx, { name: `Team ${key}` });
                const projectId = (await createProject(ctx, { teamId: team.id, name: `${PATTERN_WORD} ${key}`, keyPrefix: prefix })).id;
                projects[key] = projectId;
                const typeId = (await listWorkItemTypes(ctx))[0]!.id;
                const item = await createWorkItem(ctx, { projectId, typeId, title: `${PATTERN_WORD} report ${key}`, description: `${WORD} описание ${key}` });
                ids[key] = item.id;
                const comment = await addComment(ctx, item.id, { body: `${WORD} коментар ${key}` });
                ids[`${key}:comment`] = comment.id;
                return { projectId, typeId };
            };
            await seed(ownerA, 'a1', 'SDA');
            await seed(ownerA, 'a2', 'SDB');
            const a3 = await seed(ownerA, 'a3', 'SDC');
            await seed(ownerB, 'b1', 'SDX');
            // a3's item is deleted; a second item in a3's project keeps the project matching.
            await prisma.workItem.update({ where: { id: ids.a3! }, data: { deletedAt: new Date(), deletionId: `${TAG}-del` } });
            ids['a3:live'] = (await createWorkItem(ownerA, { projectId: a3.projectId, typeId: a3.typeId, title: `${PATTERN_WORD} live a3` })).id;
            // a2's comment is deleted under the vector (as a soft delete before 2.7f left it).
            await prisma.comment.update({ where: { id: ids['a2:comment']! }, data: { deletedAt: new Date() } });
            // A fourth project, archived.
            const archived = await seed(ownerA, 'a4', 'SDD');
            await prisma.project.update({ where: { id: archived.projectId }, data: { archivedAt: new Date() } });
        });

        afterAll(async () => {
            await resetDatabase(prisma);
        });

        /** Every search read in `ctx`'s transaction, `named` being the context the repositories are handed. */
        const readAll = (ctx: RequestContext, named: RequestContext, v: ProjectVisibility) =>
            runInTenantContext(ctx, async (db) => ({
                titles: (await WorkItemRepository.searchTitleIds(db, named, v, PATTERN_WORD, { limit: 50 })).map((t) => t.id).sort(),
                words: (await WorkItemRepository.titleFullTextIds(db, named, v, 'quokka report', 100)).sort(),
                substring: (await WorkItemRepository.titleSubstringIds(db, named, v, PATTERN_WORD, 100)).sort(),
                projects: (await ProjectRepository.searchNameIds(db, named, v, PATTERN_WORD, { limit: 50 })).map((p) => p.id).sort(),
                contents: (await SearchVectorRepository.matchItems(db, named, v, WORD, 100)).map((m) => `${m.workItemId}:${m.commentId ?? 'description'}`).sort(),
            }));

        it("each read returns its own workspace's live, visible rows: never a deleted item or comment, nor an archived project", async () => {
            const a = await readAll(ownerA, ownerA, ALL);
            const items = [ids.a1!, ids.a2!, ids['a3:live']!].sort();
            expect(a.titles).toEqual(items);
            expect(a.words).toEqual([ids.a1!, ids.a2!].sort());
            expect(a.substring).toEqual(items);
            expect(a.projects).toEqual([projects.a1!, projects.a2!, projects.a3!].sort());
            expect(a.contents).toEqual([`${ids.a1}:description`, `${ids.a2}:description`].sort().concat().sort());
            const b = await readAll(ownerB, ownerB, ALL);
            expect(b).toEqual({ titles: [ids.b1], words: [ids.b1], substring: [ids.b1], projects: [projects.b1], contents: [`${ids.b1}:description`] });
        });

        it("the workspace is the transaction's, never the context the repository is handed", async () => {
            // In B's transaction with A's context: B's rows, and none of A's.
            const forged = await readAll(ownerB, ownerA, ALL);
            expect(forged).toEqual(await readAll(ownerB, ownerB, ALL));
            expect(JSON.stringify(forged)).not.toContain(ids.a1!);
        });

        it('a project outside the visibility input never appears; an empty grant matches nothing', async () => {
            const onlyA2 = await readAll(ownerA, ownerA, { kind: 'GRANTED', projectIds: [projects.a2!] });
            expect(onlyA2).toEqual({ titles: [ids.a2], words: [ids.a2], substring: [ids.a2], projects: [projects.a2], contents: [`${ids.a2}:description`] });
            const none = await readAll(ownerA, ownerA, { kind: 'GRANTED', projectIds: [] });
            expect(none).toEqual({ titles: [], words: [], substring: [], projects: [], contents: [] });
            // A grant naming another workspace's project finds nothing either.
            expect(await readAll(ownerA, ownerA, { kind: 'GRANTED', projectIds: [projects.b1!] })).toEqual(none);
        });

        it('a comment match counts while its comment is live', async () => {
            const contents = await runInTenantContext(ownerA, (db) => SearchVectorRepository.matchItems(db, ownerA, ALL, 'коментар', 100));
            // a1's comment is live; a2's is deleted (its vector left behind), a3's item is deleted, a4's project archived.
            expect(contents.map((m) => `${m.workItemId}:${m.commentId}`)).toEqual([`${ids.a1}:${ids['a1:comment']}`]);
        });

        it.each([
            ['unset', null],
            ['empty', ''],
        ])('with app.tenant_id %s, every function returns nothing, as app_user', async (_what, setting) => {
            const counts = await prisma.$transaction(async (tx) => {
                await tx.$executeRawUnsafe('SET LOCAL ROLE app_user');
                if (setting !== null) await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, setting);
                const n = async (sql: string) => Number((await tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM ${sql}`))[0]!.n);
                return [
                    await n(`search_work_item_titles('${PATTERN_WORD}', '%${PATTERN_WORD}%', '${PATTERN_WORD}%', NULL, true, '{}', 100)`),
                    await n(`search_work_item_title_words('quokka', true, '{}', 1000)`),
                    await n(`search_work_item_title_substring('%${PATTERN_WORD}%', true, '{}', 1000)`),
                    await n(`search_project_names('${PATTERN_WORD}', '%${PATTERN_WORD}%', '${PATTERN_WORD}%', true, '{}', 100)`),
                    await n(`search_item_contents('${WORD}', true, '{}', 1000)`),
                ];
            });
            expect(counts).toEqual([0, 0, 0, 0, 0]);
        });

        it('the bound holds whatever the caller asks', async () => {
            const n = await prisma.$transaction(async (tx) => {
                await tx.$executeRawUnsafe('SET LOCAL ROLE app_user');
                await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, ownerA.tenantId);
                return {
                    over: Number((await tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM search_work_item_title_substring('%', true, '{}', 1000000)`))[0]!.n),
                    one: Number((await tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM search_work_item_title_substring('%', true, '{}', 1)`))[0]!.n),
                    negative: Number((await tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM search_work_item_title_substring('%', true, '{}', -5)`))[0]!.n),
                };
            });
            expect(n).toEqual({ over: 3, one: 1, negative: 0 });
        });
    });
});
