/**
 * Pages and the tree against a real Postgres, as `app_user` (sub-phase 4.1a;
 * docs/pages.md; docs/porting/maps/4.1.md, "The model (4.1a)"; ADR 0015 §1
 * to §3 and §10; owner decisions 339 and 341 to 347):
 *
 *   - what migration `20261230120000_pages` adds beyond Prisma, in the
 *     catalogue and by its bite: `COLLATE "C"`, the deferred parent key, the
 *     deferred trigger `page_same_scope`, the CHECKs, the partial tree
 *     indexes, the title search indexes, the grants;
 *   - both tables are tenant tables: as `app_user` in workspace B nothing of
 *     A's is read, changed, removed or created, and `search_page_titles`
 *     answers only the calling workspace;
 *   - create (with its empty content row), the order among siblings, the
 *     depth cap (ten), the cycle refusal, a parent in another tree;
 *   - rename: `If-Match` required, a stale version 409, sanitised, audited
 *     with both titles;
 *   - moves within a tree and across trees, the whole subtree (deleted rows
 *     included) taking the new tree, never into an archived project;
 *   - visibility (decision 342): a project's pages with its project, a
 *     workspace page for every holder of `pages.view`; an archived project's
 *     pages readable and read-only; keys (decision 339);
 *   - delete as a group, restore only through the root and under a live
 *     parent, a restored root's key re-placed; the Deleted list;
 *   - the purge past the window only, content cascading, counts-only
 *     `PAGES_PURGED`; the rebalance keeping order;
 *   - the data migration of decision 339: stored `docs` grants rewritten to
 *     `pages`, audited by count through the outbox;
 *   - every write audited, and the chain verifies.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { PrismaClient } from '@prisma/client';

import { flushAuditOutbox } from '@/app-layer/jobs/audit-outbox-flush';
import { processPagePurge } from '@/app-layer/jobs/page-purge';
import { processPageSortKeyRebalance } from '@/app-layer/jobs/page-sortkey-rebalance';
import { visibleProjects } from '@/app-layer/policies/project-visibility';
import { PageRepository } from '@/app-layer/repositories/PageRepository';
import type { RequestContext } from '@/app-layer/types';
import {
    createPage,
    deletePage,
    getPage,
    getPageTree,
    listDeletedPages,
    listPageChildren,
    movePage,
    renamePage,
    restorePage,
    searchPageTitles,
} from '@/app-layer/usecases/page';
import { createProject, deleteProject, setProjectArchived } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { verifyAuditChain } from '@/lib/audit';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { getPermissionsForRole, parsePermissionsJson } from '@/lib/permissions';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `pag${Date.now().toString(36)}`;
const DAY = 86_400_000;

/** The error's `details.reason`, or its status and message. */
async function reasonOf(p: Promise<unknown>): Promise<string> {
    try {
        await p;
    } catch (err) {
        const e = err as { details?: { reason?: string }; status?: number; message?: string };
        return e.details?.reason ?? `${e.status ?? ''} ${e.message ?? ''}`.trim();
    }
    return 'no error';
}

async function statusOf(p: Promise<unknown>): Promise<number> {
    try {
        await p;
    } catch (err) {
        return (err as { status?: number }).status ?? 500;
    }
    return 200;
}

describeFn('pages and the tree', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let otherTenantId = '';
    let owner: RequestContext;
    let member: RequestContext;
    let viewer: RequestContext;
    let guest: RequestContext;
    let outsider: RequestContext;
    let teamId = '';
    let projectId = '';
    let otherProjectId = '';

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        otherTenantId = (await createTenantWithDek({ name: `${TAG}b`, slug: `${TAG}b` })).id;
        const mk = async (tid: string, role: 'OWNER' | 'MEMBER' | 'VIEWER' | 'GUEST', n: string) => {
            const u = await prisma.user.create({ data: { email: `${n}-${TAG}@example.test`, name: n } });
            await prisma.tenantMembership.create({ data: { tenantId: tid, userId: u.id, role } });
            return makeRequestContext(role, { tenantId: tid, userId: u.id, tenantSlug: tid === tenantId ? TAG : `${TAG}b`, requestId: `${TAG}-${n}` });
        };
        owner = await mk(tenantId, 'OWNER', 'olive');
        member = await mk(tenantId, 'MEMBER', 'max');
        viewer = await mk(tenantId, 'VIEWER', 'vic');
        guest = await mk(tenantId, 'GUEST', 'gus');
        outsider = await mk(otherTenantId, 'OWNER', 'otto');
        teamId = (await createTeam(owner, { name: 'Core' })).id;
        projectId = (await createProject(owner, { teamId, name: 'Pages', keyPrefix: 'PAG' })).id;
        otherProjectId = (await createProject(owner, { teamId, name: 'Elsewhere', keyPrefix: 'ELS' })).id;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    const titles = async (spot: { projectId?: string; parentId?: string }, ctx: RequestContext = member) =>
        (await listPageChildren(ctx, spot.projectId ? { projectId: spot.projectId, parentId: spot.parentId } : { scope: 'workspace', parentId: spot.parentId })).pages.map((p) => p.title);

    describe('what the migration adds', () => {
        it('the sort key is COLLATE "C"; the parent key is deferred; the scope trigger is a deferred constraint trigger', async () => {
            const [col] = await prisma.$queryRaw<Array<{ collation: string | null }>>`
                SELECT collation_name::text AS collation FROM information_schema.columns WHERE table_name = 'Page' AND column_name = 'sortKey'`;
            expect(col?.collation).toBe('C');
            const [fk] = await prisma.$queryRaw<Array<{ deferrable: boolean; deferred: boolean; deltype: string }>>`
                SELECT condeferrable AS deferrable, condeferred AS deferred, confdeltype::text AS deltype FROM pg_constraint WHERE conname = 'Page_parentId_tenantId_fkey'`;
            expect(fk).toEqual({ deferrable: true, deferred: true, deltype: 'a' });
            const [trg] = await prisma.$queryRaw<Array<{ deferrable: boolean; deferred: boolean }>>`
                SELECT tgdeferrable AS deferrable, tginitdeferred AS deferred FROM pg_trigger WHERE tgname = 'page_same_scope'`;
            expect(trg).toEqual({ deferrable: true, deferred: true });
        });

        it('the partial tree indexes and the title search indexes exist', async () => {
            const rows = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
                SELECT indexname::text AS indexname, indexdef::text AS indexdef FROM pg_indexes
                 WHERE tablename = 'Page' AND indexname IN ('Page_live_project_tree', 'Page_live_workspace_tree', 'Page_search_title_trgm', 'Page_search_title_fts')
                 ORDER BY indexname`;
            expect(rows.map((r) => r.indexname)).toEqual(['Page_live_project_tree', 'Page_live_workspace_tree', 'Page_search_title_fts', 'Page_search_title_trgm']);
            const def = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
            expect(def.Page_live_project_tree).toMatch(/\("tenantId", "projectId", "parentId", "sortKey"\) WHERE \(\("deletedAt" IS NULL\) AND \("projectId" IS NOT NULL\)\)/);
            expect(def.Page_live_workspace_tree).toMatch(/\("tenantId", "parentId", "sortKey"\) WHERE \(\("deletedAt" IS NULL\) AND \("projectId" IS NULL\)\)/);
            expect(def.Page_search_title_fts).toContain(`to_tsvector('islestone_bg_en'::regconfig, title)`);
        });

        it('the CHECKs and the scope trigger bite whatever the writer', async () => {
            const base = { tenantId, createdByUserId: owner.userId, sortKey: 'a0' };
            await expect(prisma.page.create({ data: { ...base, title: '' } })).rejects.toThrow(/Page_title_length/);
            await expect(prisma.page.create({ data: { ...base, title: 'x'.repeat(201) } })).rejects.toThrow(/Page_title_length/);
            await expect(prisma.page.create({ data: { ...base, title: 'half deleted', deletedAt: new Date() } })).rejects.toThrow(/Page_deletion_group/);
            const p = await prisma.page.create({ data: { ...base, title: 'self' } });
            await expect(prisma.page.update({ where: { id: p.id }, data: { parentId: p.id } })).rejects.toThrow(/Page_not_own_parent/);
            // A project page under a workspace page: refused at commit.
            await expect(prisma.page.create({ data: { ...base, title: 'elsewhere', projectId, parentId: p.id } })).rejects.toThrow(/PAGE_SCOPE/);
            // Moving the parent alone to a project, leaving its child in the workspace: refused too.
            const child = await prisma.page.create({ data: { ...base, title: 'child', parentId: p.id } });
            await expect(prisma.page.update({ where: { id: p.id }, data: { projectId } })).rejects.toThrow(/PAGE_SCOPE/);
            // Both together, in one transaction, pass.
            await prisma.$transaction([prisma.page.update({ where: { id: p.id }, data: { projectId } }), prisma.page.update({ where: { id: child.id }, data: { projectId } })]);
            await prisma.page.deleteMany({ where: { id: { in: [p.id, child.id] } } });
        });

        it('app_user holds SELECT, INSERT, UPDATE and DELETE on Page (DELETE for the purge), and no DELETE on PageContent', async () => {
            const rows = await prisma.$queryRaw<Array<{ table_name: string; privilege_type: string }>>`
                SELECT table_name::text, privilege_type::text FROM information_schema.role_table_grants
                 WHERE grantee = 'app_user' AND table_name IN ('Page', 'PageContent') ORDER BY table_name, privilege_type`;
            expect(rows.filter((r) => r.table_name === 'Page').map((r) => r.privilege_type)).toEqual(expect.arrayContaining(['DELETE', 'INSERT', 'SELECT', 'UPDATE']));
            expect(rows.filter((r) => r.table_name === 'PageContent').map((r) => r.privilege_type).sort()).toEqual(['INSERT', 'SELECT', 'UPDATE']);
        });
    });

    describe('two-tenant isolation as app_user', () => {
        it("workspace B neither reads, changes, removes nor creates A's pages or content", async () => {
            const p = await createPage(owner, { projectId: null, title: 'Isolated quokka page' });
            expect(await runInTenantContext(outsider, (db) => db.page.count({ where: { tenantId } }))).toBe(0);
            expect(await runInTenantContext(outsider, (db) => db.pageContent.count({ where: { tenantId } }))).toBe(0);
            expect((await runInTenantContext(outsider, (db) => db.page.updateMany({ where: { tenantId }, data: { title: 'Hijacked' } }))).count).toBe(0);
            expect((await runInTenantContext(outsider, (db) => db.pageContent.updateMany({ where: { tenantId }, data: { stateBytes: 9 } }))).count).toBe(0);
            expect((await runInTenantContext(outsider, (db) => db.page.deleteMany({ where: { id: p.id } }))).count).toBe(0);
            await expect(runInTenantContext(outsider, (db) => db.page.create({ data: { tenantId, title: 'Planted', sortKey: 'a0', createdByUserId: outsider.userId } }))).rejects.toThrow();
            await expect(runInTenantContext(outsider, (db) => db.pageContent.create({ data: { tenantId, pageId: p.id } }))).rejects.toThrow();
            expect(await runInTenantContext(owner, (db) => db.page.count({ where: { id: p.id } }))).toBe(1);
            expect(await runInTenantContext(owner, (db) => db.pageContent.count({ where: { pageId: p.id } }))).toBe(1);
            // The usecases read A's page in B as absent.
            expect(await reasonOf(getPage(outsider, p.id))).toBe('PAGE_NOT_FOUND');
        });

        it('search_page_titles answers only the calling workspace, live pages, visible projects', async () => {
            await createPage(outsider, { projectId: null, title: 'Their quokka page' });
            const ours = (await searchPageTitles(member, 'quokka')).pages.map((p) => p.title);
            expect(ours).toEqual(['Isolated quokka page']);
            const theirs = (await searchPageTitles(outsider, 'quokka')).pages.map((p) => p.title);
            expect(theirs).toEqual(['Their quokka page']);
            // Without app.tenant_id the function returns nothing.
            const unset = await prisma.$queryRaw<Array<{ id: string }>>`SELECT * FROM search_page_titles('quokka', '%quokka%', 'quokka%', true, '{}', 100)`;
            expect(unset).toEqual([]);
            // Bounded, whatever the caller asks.
            const n = await runInTenantContext(owner, (db) => db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM search_page_titles('', '%', '%', true, '{}', 1000000)`));
            expect(Number(n[0]!.n)).toBeLessThanOrEqual(100);
            // An empty grant sees no project page; a workspace page still matches.
            const pp = await createPage(owner, { projectId, title: 'Project quokka page' });
            const granted = await runInTenantContext(owner, (db) =>
                db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM search_page_titles('quokka', '%quokka%', 'quokka%', false, '{}'::text[], 100)`,
            );
            expect(granted.map((r) => r.id)).not.toContain(pp.id);
            expect(granted.length).toBe(1);
        });
    });

    describe('create, order, depth and cycles', () => {
        it('creates a page with its empty content row, default title, last among its siblings; after and before place it', async () => {
            const a = await createPage(member, { projectId, title: 'Alpha' });
            expect(a.projectId).toBe(projectId);
            const content = await prisma.pageContent.findUniqueOrThrow({ where: { pageId: a.id } });
            expect(content).toMatchObject({ state: null, contentJson: null, plainText: null, schemaRevision: 0, stateBytes: 0 });
            const untitled = await createPage(member, { projectId, parentId: a.id });
            expect(untitled.title).toBe('Untitled');
            const c = await createPage(member, { projectId, parentId: a.id, title: 'Charlie' });
            await createPage(member, { projectId, parentId: a.id, title: 'Bravo', afterId: untitled.id });
            await createPage(member, { projectId, parentId: a.id, title: 'Zero', beforeId: untitled.id });
            expect(await titles({ projectId, parentId: a.id })).toEqual(['Zero', 'Untitled', 'Bravo', 'Charlie']);
            expect(await reasonOf(createPage(member, { projectId, parentId: a.id, title: 'Nowhere', afterId: a.id }))).toBe('PLACEMENT_NOT_SIBLING');
            // A parent in another tree reads as absent.
            expect(await reasonOf(createPage(member, { projectId: otherProjectId, parentId: c.id }))).toBe('PARENT_NOT_FOUND');
            expect(await reasonOf(createPage(member, { projectId: null, parentId: c.id }))).toBe('PARENT_NOT_FOUND');
            // Titles are sanitised and bounded.
            const s = await createPage(member, { projectId, title: '  Notes <script>x</script>  ' });
            expect(s.title).not.toContain('<script>');
            expect(await reasonOf(createPage(member, { projectId, title: 'x'.repeat(201) }))).toBe('TITLE_TOO_LONG');
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'PAGE_CREATED', entityId: a.id } })).toBe(1);
        });

        it('nests at most ten levels, deleted pages counted, and refuses a cycle', async () => {
            const chain: string[] = [];
            let parentId: string | undefined;
            for (let level = 1; level <= 10; level++) {
                const p = await createPage(member, { projectId: null, parentId, title: `Level ${level}` });
                chain.push(p.id);
                parentId = p.id;
            }
            expect(await reasonOf(createPage(member, { projectId: null, parentId: chain[9], title: 'Level 11' }))).toBe('PAGE_TOO_DEEP');
            expect((await getPage(member, chain[9]!)).subpageFits).toBe(false);
            expect((await getPage(member, chain[9]!)).ancestors.map((a) => a.id)).toEqual(chain.slice(0, 9));
            expect(await reasonOf(movePage(member, chain[0]!, { projectId: null, parentId: chain[5]! }))).toBe('PAGE_WOULD_CYCLE');
            expect(await reasonOf(movePage(member, chain[0]!, { projectId: null, parentId: chain[0]! }))).toBe('PAGE_WOULD_CYCLE');
            // A root with a (deleted) child, height 2, cannot go under level 9.
            const root = await createPage(member, { projectId: null, title: 'Loose root' });
            const kid = await createPage(member, { projectId: null, parentId: root.id, title: 'Loose kid' });
            await deletePage(member, kid.id);
            expect(await reasonOf(movePage(member, root.id, { projectId: null, parentId: chain[8]! }))).toBe('PAGE_TOO_DEEP');
            const moved = await movePage(member, root.id, { projectId: null, parentId: chain[7]! });
            expect(moved.parentId).toBe(chain[7]);
        });
    });

    describe('rename', () => {
        it('needs If-Match, refuses a stale version, sanitises, audits both titles', async () => {
            const p = await createPage(member, { projectId, title: 'Draft spec' });
            expect(await statusOf(renamePage(member, p.id, 'Spec', undefined))).toBe(428);
            const renamed = await renamePage(member, p.id, 'Spec <b>v1</b>', p.version);
            expect(renamed.title).not.toContain('<b>');
            expect(renamed.version).toBe(p.version + 1);
            expect(await reasonOf(renamePage(member, p.id, 'Spec v2', p.version))).toBe('VERSION_CONFLICT');
            expect(await reasonOf(renamePage(member, p.id, '   ', renamed.version))).toBe('TITLE_REQUIRED');
            const entry = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'PAGE_RENAMED', entityId: p.id } });
            expect(JSON.stringify(entry.metadataJson ?? entry.detailsJson)).toContain('Draft spec');
        });
    });

    describe('moves', () => {
        it('reorders among siblings, and moves a subtree to another tree with its deleted rows', async () => {
            const top = await createPage(member, { projectId, title: 'Move me' });
            const child = await createPage(member, { projectId, parentId: top.id, title: 'Its child' });
            const gone = await createPage(member, { projectId, parentId: child.id, title: 'Deleted grandchild' });
            await deletePage(member, gone.id);
            const first = await createPage(member, { projectId: otherProjectId, title: 'First there' });
            const moved = await movePage(member, top.id, { projectId: otherProjectId, parentId: null, beforeId: first.id });
            expect(moved.projectId).toBe(otherProjectId);
            const rows = await prisma.page.findMany({ where: { id: { in: [top.id, child.id, gone.id] } }, select: { id: true, projectId: true } });
            expect(rows.every((r) => r.projectId === otherProjectId)).toBe(true);
            expect(await titles({ projectId: otherProjectId })).toEqual(['Move me', 'First there']);
            // Reorder within the same parent, then to the workspace's tree.
            await movePage(member, top.id, { projectId: otherProjectId, parentId: null, afterId: first.id });
            expect(await titles({ projectId: otherProjectId })).toEqual(['First there', 'Move me']);
            await movePage(member, top.id, { projectId: null, parentId: null });
            expect((await prisma.page.findUniqueOrThrow({ where: { id: gone.id } })).projectId).toBeNull();
            const entry = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'PAGE_MOVED', entityId: top.id }, orderBy: { createdAt: 'asc' } });
            expect(JSON.stringify(entry.metadataJson)).toContain(otherProjectId);
            // A stale If-Match is refused.
            expect(await reasonOf(movePage(member, top.id, { projectId: null, parentId: null }, 1))).toBe('VERSION_CONFLICT');
        });
    });

    describe('visibility, archived and deleted projects, keys', () => {
        it('a viewer reads and writes nothing; a guest reads nothing (decisions 339 and 204)', async () => {
            const p = await createPage(member, { projectId: null, title: 'Readable' });
            expect((await getPage(viewer, p.id)).affordances).toEqual({ view: true, create: false, edit: false, delete: false });
            expect((await getPage(member, p.id)).affordances).toEqual({ view: true, create: true, edit: true, delete: true });
            expect(await statusOf(createPage(viewer, { projectId: null, title: 'No' }))).toBe(403);
            expect(await statusOf(renamePage(viewer, p.id, 'No', p.version))).toBe(403);
            expect(await statusOf(deletePage(viewer, p.id))).toBe(403);
            expect(await statusOf(getPage(guest, p.id))).toBe(403);
            expect(await statusOf(listPageChildren(guest, { scope: 'workspace' }))).toBe(403);
        });

        it("an archived project's pages read and take no write; a deleted project hides its pages", async () => {
            const team = await createTeam(owner, { name: `Arch ${TAG}` });
            const archived = await createProject(owner, { teamId: team.id, name: 'Archived', keyPrefix: 'ARC' });
            const p = await createPage(member, { projectId: archived.id, title: 'Kept' });
            await setProjectArchived(owner, archived.id, true);
            expect((await getPage(member, p.id)).affordances.edit).toBe(false);
            expect((await getPageTree(member, { kind: 'project', projectId: archived.id })).affordances.create).toBe(false);
            expect(await reasonOf(renamePage(member, p.id, 'Changed', p.version))).toBe('PROJECT_ARCHIVED');
            expect(await reasonOf(createPage(member, { projectId: archived.id, title: 'New' }))).toBe('PROJECT_ARCHIVED');
            expect(await reasonOf(deletePage(member, p.id))).toBe('PROJECT_ARCHIVED');
            const loose = await createPage(member, { projectId: null, title: 'Loose' });
            expect(await reasonOf(movePage(member, loose.id, { projectId: archived.id, parentId: null }))).toBe('PROJECT_ARCHIVED');
            expect(await reasonOf(movePage(member, p.id, { projectId: null, parentId: null }))).toBe('PROJECT_ARCHIVED');
            // Search leaves an archived project's pages out, as the item search does.
            expect((await searchPageTitles(member, 'Kept')).pages).toEqual([]);

            const doomed = await createProject(owner, { teamId: team.id, name: 'Doomed', keyPrefix: 'DOO' });
            const q = await createPage(member, { projectId: doomed.id, title: 'Hidden with it' });
            await deleteProject(owner, doomed.id);
            expect(await reasonOf(getPage(member, q.id))).toBe('PAGE_NOT_FOUND');
            expect(await reasonOf(listPageChildren(member, { projectId: doomed.id }))).toBe('PROJECT_NOT_FOUND');
        });
    });

    describe('delete, restore and the Deleted list', () => {
        it('deletes a subtree as one group; only the root restores it, under a live parent; a restored key is re-placed', async () => {
            const parent = await createPage(member, { projectId, title: 'Group parent' });
            const root = await createPage(member, { projectId, parentId: parent.id, title: 'Group root' });
            const a = await createPage(member, { projectId, parentId: root.id, title: 'Group a' });
            const b = await createPage(member, { projectId, parentId: a.id, title: 'Group b' });
            const out = await deletePage(member, root.id);
            expect(out.pages).toBe(3);
            const rows = await prisma.page.findMany({ where: { id: { in: [root.id, a.id, b.id] } }, select: { deletionId: true } });
            expect(new Set(rows.map((r) => r.deletionId)).size).toBe(1);
            expect(await reasonOf(getPage(member, a.id))).toBe('PAGE_NOT_FOUND');
            expect(await reasonOf(restorePage(member, a.id))).toBe('DELETED_WITH_PARENT');
            const deleted = (await listDeletedPages(member, { kind: 'project', projectId })).pages;
            expect(deleted.find((d) => d.id === root.id)?.groupSize).toBe(3);
            expect(deleted.find((d) => d.id === a.id)).toBeUndefined();
            expect(await statusOf(listDeletedPages(viewer, { kind: 'project', projectId }))).toBe(403);

            // A parent deleted after: the root waits for it.
            await deletePage(member, parent.id);
            expect(await reasonOf(restorePage(member, root.id))).toBe('PARENT_DELETED');
            await restorePage(member, parent.id);

            // A live sibling now holds the root's key: the root comes back right after it.
            const rootRow = await prisma.page.findUniqueOrThrow({ where: { id: root.id } });
            const twin = await prisma.page.create({ data: { tenantId, projectId, parentId: parent.id, sortKey: rootRow.sortKey, title: 'Twin', createdByUserId: owner.userId } });
            await prisma.pageContent.create({ data: { tenantId, pageId: twin.id } });
            const back = await restorePage(member, root.id);
            expect(back.id).toBe(root.id);
            const restored = await prisma.page.findUniqueOrThrow({ where: { id: root.id } });
            expect(restored.sortKey > rootRow.sortKey).toBe(true);
            expect(await titles({ projectId, parentId: parent.id })).toEqual(['Twin', 'Group root']);
            expect((await getPage(member, b.id)).ancestors.map((x) => x.id)).toEqual([parent.id, root.id, a.id]);
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'PAGE_RESTORED', entityId: root.id } })).toBe(1);
        });
    });

    describe('jobs', () => {
        it('purges groups past the window only, content cascading, with a counts-only entry', async () => {
            const old = await createPage(member, { projectId: null, title: 'Old' });
            const oldKid = await createPage(member, { projectId: null, parentId: old.id, title: 'Old kid' });
            const fresh = await createPage(member, { projectId: null, title: 'Fresh' });
            await deletePage(member, old.id);
            await deletePage(member, fresh.id);
            await prisma.page.updateMany({ where: { id: { in: [old.id, oldKid.id] } }, data: { deletedAt: new Date(Date.now() - 40 * DAY) } });
            const r = await processPagePurge({ tenantId });
            expect(r.pages).toBe(2);
            expect(await prisma.page.count({ where: { id: { in: [old.id, oldKid.id] } } })).toBe(0);
            expect(await prisma.pageContent.count({ where: { pageId: { in: [old.id, oldKid.id] } } })).toBe(0);
            expect(await prisma.page.count({ where: { id: fresh.id } })).toBe(1);
            const entry = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'PAGES_PURGED' } });
            expect(JSON.stringify(entry.detailsJson)).not.toContain('Old');
        });

        it('rebalances a sibling group whose keys passed 64 characters, keeping its order', async () => {
            const parent = await createPage(member, { projectId: null, title: 'Crowded' });
            const ids: string[] = [];
            for (const [i, key] of ['a0', 'a0'.padEnd(70, 'V'), 'a0'.padEnd(71, 'W'), 'a1'].entries()) {
                const row = await prisma.page.create({ data: { tenantId, parentId: parent.id, sortKey: key, title: `Crowd ${i}`, createdByUserId: owner.userId } });
                ids.push(row.id);
            }
            const r = await processPageSortKeyRebalance({ tenantId });
            expect(r.pages).toBeGreaterThanOrEqual(4);
            const rows = await prisma.page.findMany({ where: { parentId: parent.id }, orderBy: [{ sortKey: 'asc' }, { id: 'asc' }], select: { id: true, sortKey: true } });
            expect(rows.map((x) => x.id)).toEqual(ids);
            expect(rows.every((x) => x.sortKey.length <= 64)).toBe(true);
        });
    });

    describe('the data migration of decision 339', () => {
        it("rewrites a stored role's docs grants to pages, comment and delete from edit, audited by count through the outbox", async () => {
            const blob = { ...getPermissionsForRole('MEMBER') } as Record<string, unknown>;
            delete blob.pages;
            blob.docs = { view: true, create: false, edit: true };
            const role = await prisma.tenantCustomRole.create({ data: { tenantId, name: `docs role ${TAG}`, baseRole: 'MEMBER', grantsJson: blob as object } });
            const sql = fs.readFileSync(path.join(__dirname, '../../prisma/migrations/20261230120100_pages_permission_domain/migration.sql'), 'utf8');
            const statements = sql
                .split('\n')
                .filter((l) => !l.trim().startsWith('--'))
                .join('\n')
                .split(/;\s*\n/)
                .map((s) => s.trim())
                .filter(Boolean);
            for (const statement of statements) await prisma.$executeRawUnsafe(statement);
            const after = await prisma.tenantCustomRole.findUniqueOrThrow({ where: { id: role.id } });
            const grants = after.grantsJson as Record<string, unknown>;
            expect(grants.docs).toBeUndefined();
            expect(grants.pages).toEqual({ view: true, create: false, edit: true, comment: true, delete: true });
            expect(parsePermissionsJson(grants, 'MEMBER').pages).toEqual({ view: true, create: false, edit: true, comment: true, delete: true });
            const queued = await prisma.auditOutbox.findMany({ where: { tenantId, action: 'CUSTOM_ROLES_DOMAIN_RENAMED' } });
            expect(queued).toHaveLength(1);
            expect((queued[0]!.payloadJson as { detailsJson: { rolesRewritten: number } }).detailsJson.rolesRewritten).toBe(1);
            await flushAuditOutbox({ tenantId });
            const entry = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'CUSTOM_ROLES_DOMAIN_RENAMED' } });
            expect(entry.detailsJson).toMatchObject({ category: 'custom', fromDomain: 'docs', toDomain: 'pages', rolesRewritten: 1, replayedFromOutbox: true });
            // Running it again changes nothing and queues nothing.
            for (const statement of statements) await prisma.$executeRawUnsafe(statement);
            expect(await prisma.auditOutbox.count({ where: { tenantId, action: 'CUSTOM_ROLES_DOMAIN_RENAMED' } })).toBe(1);
        });
    });

    it('every write was audited and the chain verifies', async () => {
        const v = await visibleProjects(owner);
        expect(v.kind).toBe('ALL');
        // The repository reads only the caller's workspace.
        const theirs = await runInTenantContext(outsider, (db) => PageRepository.children(db, outsider, { projectId: null, parentId: null }, 50));
        expect(theirs.every((p) => p.title !== 'Readable')).toBe(true);
        const chain = await verifyAuditChain(tenantId);
        expect(chain.valid).toBe(true);
    });
});
