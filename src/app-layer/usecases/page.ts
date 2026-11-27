/**
 * Pages and the tree (sub-phase 4.1a; docs/pages.md; docs/porting/maps/4.1.md,
 * "Page and the tree"; ADR 0015 §1; owner decisions 339 and 341 to 344).
 *
 *   - Two kinds of tree, one table (decision 341): a project's (`projectId`
 *     set) and the workspace's (`projectId` NULL). A page's parent is in its
 *     own tree; pages nest at most ten levels.
 *   - Visibility equals the tree's (decision 342): a project page is readable
 *     exactly when its project is visible and live, a workspace page by every
 *     holder of `pages.view`. An archived project's pages are readable and
 *     take no write (409 `PROJECT_ARCHIVED`). A page the caller cannot read is
 *     a 404, never a 403.
 *   - The title is a plaintext row field of at most 200 characters, renamed
 *     by a versioned write (`If-Match` required; decision 343).
 *   - Every create, move, reorder, delete and restore waits its workspace's
 *     turn (`inPageTreeQueue`), takes the page-tree lock FIRST, then the page
 *     rows it changes in id order (decision 173). The cycle and depth checks
 *     count deleted pages, so a restore can never break them.
 *   - A move carries the page's whole subtree, deleted rows included, so every
 *     row stays in its parent's tree (the deferred trigger `page_same_scope`
 *     holds the same at commit); comments, versions and mentions (4.1c to
 *     4.1e) follow the page id.
 *   - Delete soft-deletes the page and its live subtree under one
 *     `deletionId`; only the group's root restores it, under a live parent in
 *     a live, unarchived project (decision 344). The purge is `page-purge.ts`.
 *   - Creating a page writes the row and its empty `PageContent` in one
 *     transaction; the body is 4.1b's.
 *   - Reads take `pages.view`, creates `pages.create`, renames and moves
 *     `pages.edit`, deletes, restores and the Deleted list `pages.delete`.
 *     Every write is audited with the transaction client, naming the page;
 *     titles are plaintext and named as work-item titles are.
 *
 * Written fresh for Islestone.
 */
import { randomUUID } from 'node:crypto';

import { logEvent } from '../events/audit';
import { keyBetween } from '../domain/fractional-index';
import { MAX_PAGE_DEPTH, pageGroupRoots, pageMoveRefusal, subpageFits } from '../domain/page-tree';
import { PageRepository, PAGE_SUBTREE_CAP, type PageRow, type PageTreeSpot } from '../repositories/PageRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { visibleProjects, type ProjectVisibility } from '../policies/project-visibility';
import { assertCanCreatePages, assertCanDeletePages, assertCanEditPages, assertCanReadPages, pageAffordances } from '../policies/page.policies';
import { inPageTreeQueue, lockPageTree } from './page-tree-lock';
import { preconditionRequired } from './work-item-shared';
import type { RequestContext } from '../types';
import { runInTenantContext, runInTenantReadContext, type PrismaTx } from '@/lib/db-context';
import { ConflictError, ValidationError, notFound } from '@/lib/errors/types';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { SEARCH_ROW_CAP, normaliseSearchQuery } from '@/lib/search/query';
import { MIN_QUERY_LENGTH } from '@/lib/search/types';
import {
    PAGE_CHILDREN_PAGE,
    PAGE_DEFAULT_TITLE,
    PAGE_TITLE_MAX,
    type DeletedPageData,
    type PageAffordances,
    type PageChildren,
    type PageCrumb,
    type PageData,
    type PageDetail,
    type PageNode,
    type PageScope,
} from '@/lib/pages/types';

// ─── Shapes ─────────────────────────────────────────────────────────────

export function toPageDto(row: PageRow): PageData {
    return {
        id: row.id,
        projectId: row.projectId,
        parentId: row.parentId,
        title: row.title,
        version: row.version,
        createdByUserId: row.createdByUserId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        contentUpdatedAt: row.contentUpdatedAt?.toISOString() ?? null,
    };
}

function pageNotFound(): never {
    throw notFound('Page not found', { reason: 'PAGE_NOT_FOUND' });
}

function projectNotFound(): never {
    throw notFound('Project not found', { reason: 'PROJECT_NOT_FOUND' });
}

function refuseArchived(): never {
    throw new ConflictError('The project is archived; unarchive it to change its pages.', { reason: 'PROJECT_ARCHIVED' });
}

function tooDeep(depth: number): never {
    throw new ConflictError(`Pages nest at most ${MAX_PAGE_DEPTH} levels; this would make ${depth}.`, { reason: 'PAGE_TOO_DEEP', depth });
}

/** A title, sanitised, 1..200 characters; an empty create title is "Untitled". */
function checkedTitle(raw: string | undefined, fallback?: string): string {
    const title = raw === undefined ? '' : sanitizePlainText(raw).trim();
    if (title.length === 0) {
        if (fallback !== undefined) return fallback;
        throw new ValidationError('A page needs a title.', { reason: 'TITLE_REQUIRED' });
    }
    if (title.length > PAGE_TITLE_MAX) throw new ValidationError(`A page title holds at most ${PAGE_TITLE_MAX} characters.`, { reason: 'TITLE_TOO_LONG' });
    return title;
}

// ─── Trees ──────────────────────────────────────────────────────────────

/** A tree the caller names: the workspace's, or a project's by id. */
export type PageTreeRef = { kind: 'workspace' } | { kind: 'project'; projectId: string };

export function treeRefOf(input: { scope?: 'workspace'; projectId?: string | null }): PageTreeRef {
    return input.projectId ? { kind: 'project', projectId: input.projectId } : { kind: 'workspace' };
}

/**
 * The tree, as the caller may read it: the workspace's, or a visible, live
 * project's (archived included: readable). Anything else is a 404.
 */
async function resolveTree(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, ref: PageTreeRef): Promise<PageScope> {
    if (ref.kind === 'workspace') return { kind: 'workspace' };
    const project = await ProjectRepository.getVisible(db, ctx, v, ref.projectId);
    if (!project) projectNotFound();
    return { kind: 'project', projectId: project.id, keyPrefix: project.keyPrefix, name: project.name, archived: project.archivedAt !== null };
}

/** As `resolveTree`, for a write: an archived project's tree takes none (409 `PROJECT_ARCHIVED`). */
async function resolveWritableTree(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, ref: PageTreeRef): Promise<PageScope> {
    const scope = await resolveTree(db, ctx, v, ref);
    if (scope.kind === 'project' && scope.archived) refuseArchived();
    return scope;
}

const projectIdOf = (scope: PageScope): string | null => (scope.kind === 'project' ? scope.projectId : null);
const refOfRow = (row: { projectId: string | null }): PageTreeRef => (row.projectId ? { kind: 'project', projectId: row.projectId } : { kind: 'workspace' });

/** A live page the caller may read, with its tree; a deleted or invisible one is a 404. */
async function loadReadablePage(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, id: string): Promise<{ page: PageRow; scope: PageScope }> {
    const page = await PageRepository.getAny(db, ctx, id);
    if (!page || page.deletedAt) pageNotFound();
    try {
        return { page, scope: await resolveTree(db, ctx, v, refOfRow(page)) };
    } catch {
        // An invisible or deleted project hides its pages: the page is absent.
        pageNotFound();
    }
}

/** A live parent in the given tree, or a 404: a parent elsewhere reads as absent. */
async function loadParentIn(db: PrismaTx, ctx: RequestContext, spot: { projectId: string | null }, parentId: string): Promise<PageRow> {
    const parent = await PageRepository.getAny(db, ctx, parentId);
    if (!parent || parent.deletedAt || parent.projectId !== spot.projectId) {
        throw notFound('Parent page not found', { reason: 'PARENT_NOT_FOUND' });
    }
    return parent;
}

/**
 * The sort key for a place among a parent's live children: after one
 * sibling, before one, or last (decision 341; ADR 0002 §5), computed while
 * the tree lock is held. `excludeId` is the page being placed (a reorder
 * among its own siblings).
 */
async function placementKey(db: PrismaTx, ctx: RequestContext, spot: PageTreeSpot, place: { afterId?: string | null; beforeId?: string | null }, excludeId?: string): Promise<string> {
    const named = [place.afterId, place.beforeId].filter((x): x is string => typeof x === 'string' && x !== excludeId);
    const keys = new Map((await PageRepository.siblingKeys(db, ctx, spot, named)).map((r) => [r.id, r.sortKey]));
    if (place.afterId && place.afterId !== excludeId) {
        const at = keys.get(place.afterId);
        if (at === undefined) throw new ValidationError('Place it beside a page under the same parent.', { reason: 'PLACEMENT_NOT_SIBLING' });
        return keyBetween(at, await PageRepository.neighbourKey(db, ctx, spot, at, 'after', excludeId));
    }
    if (place.beforeId && place.beforeId !== excludeId) {
        const at = keys.get(place.beforeId);
        if (at === undefined) throw new ValidationError('Place it beside a page under the same parent.', { reason: 'PLACEMENT_NOT_SIBLING' });
        return keyBetween(await PageRepository.neighbourKey(db, ctx, spot, at, 'before', excludeId), at);
    }
    return keyBetween(await PageRepository.neighbourKey(db, ctx, spot, null, 'before', excludeId), null);
}

/** A parent's live children in order, a page at a time, each with its live subpages counted. */
async function childrenOf(db: PrismaTx, ctx: RequestContext, spot: PageTreeSpot, afterId?: string): Promise<PageChildren> {
    let after: { sortKey: string; id: string } | undefined;
    if (afterId) {
        const row = await PageRepository.getAny(db, ctx, afterId);
        if (!row || row.deletedAt || row.projectId !== spot.projectId || row.parentId !== spot.parentId) {
            throw new ValidationError('The cursor names no page of this list.', { reason: 'CURSOR_INVALID' });
        }
        after = { sortKey: row.sortKey, id: row.id };
    }
    const rows = await PageRepository.children(db, ctx, spot, PAGE_CHILDREN_PAGE + 1, after);
    const page = rows.slice(0, PAGE_CHILDREN_PAGE);
    const counts = await PageRepository.childCounts(db, ctx, page.map((r) => r.id));
    const pages: PageNode[] = page.map((r) => ({ ...toPageDto(r), childCount: counts.get(r.id) ?? 0 }));
    return { pages, nextAfter: rows.length > PAGE_CHILDREN_PAGE ? (page[page.length - 1]?.id ?? null) : null };
}

// ─── Reads ──────────────────────────────────────────────────────────────

export interface PageTreeQuery {
    scope?: 'workspace';
    projectId?: string;
    parentId?: string;
    after?: string;
}

/**
 * One tree read: a parent's live children (the top level without a parent),
 * in order, a page at a time (`after`), each with its live subpages counted.
 */
export async function listPageChildren(ctx: RequestContext, query: PageTreeQuery): Promise<PageChildren> {
    assertCanReadPages(ctx);
    return runInTenantReadContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const scope = await resolveTree(db, ctx, v, treeRefOf(query));
        const projectId = projectIdOf(scope);
        if (query.parentId) await loadParentIn(db, ctx, { projectId }, query.parentId);
        return childrenOf(db, ctx, { projectId, parentId: query.parentId ?? null }, query.after);
    });
}

/** A tree's own view (the Pages tab, Workspace pages): its scope, top level and what the caller may do there. */
export async function getPageTree(ctx: RequestContext, ref: PageTreeRef): Promise<{ scope: PageScope; children: PageChildren; affordances: PageAffordances }> {
    assertCanReadPages(ctx);
    return runInTenantReadContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const scope = await resolveTree(db, ctx, v, ref);
        const children = await childrenOf(db, ctx, { projectId: projectIdOf(scope), parentId: null });
        return { scope, children, affordances: pageAffordances(ctx, { archived: scope.kind === 'project' && scope.archived }) };
    });
}

/**
 * A page's own view: the row, its tree, its ancestors (root first, one
 * recursive statement), its level, its first page of subpages and what the
 * caller may do on it. Never the body (4.1b).
 */
export async function getPage(ctx: RequestContext, id: string): Promise<PageDetail> {
    assertCanReadPages(ctx);
    return runInTenantReadContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const { page, scope } = await loadReadablePage(db, ctx, v, id);
        const chain = await PageRepository.chainUp(db, ctx, page.id);
        const ancestors: PageCrumb[] = chain
            .slice(1)
            .reverse()
            .filter((c) => c.deletedAt === null)
            .map((c) => ({ id: c.id, title: c.title }));
        const children = await childrenOf(db, ctx, { projectId: page.projectId, parentId: page.id });
        return {
            page: toPageDto(page),
            scope,
            ancestors,
            level: chain.length,
            subpageFits: subpageFits(chain.length),
            children,
            affordances: pageAffordances(ctx, { archived: scope.kind === 'project' && scope.archived }),
        };
    });
}

/**
 * Pages by title in the trees the caller reads, best first (the move
 * dialog's parent search; 4.1f's palette group reads the same function):
 * `search_page_titles`, then the rows by id under row-level security.
 * Narrowed to one tree when the query names one.
 */
export async function searchPageTitles(
    ctx: RequestContext,
    rawQuery: string,
    ref?: PageTreeRef,
): Promise<{ pages: Array<{ id: string; title: string; projectId: string | null }> }> {
    assertCanReadPages(ctx);
    const query = normaliseSearchQuery(rawQuery);
    if (query.length < MIN_QUERY_LENGTH) return { pages: [] };
    return runInTenantReadContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const ids = await PageRepository.searchTitleIds(db, ctx, v, query, { limit: SEARCH_ROW_CAP });
        const rows = new Map((await PageRepository.findSearchRows(db, ctx, v, ids.map((i) => i.id))).map((r) => [r.id, r] as const));
        const wanted = ref === undefined ? undefined : ref.kind === 'project' ? ref.projectId : null;
        const pages = ids.flatMap((i) => rows.get(i.id) ?? []).filter((r) => wanted === undefined || r.projectId === wanted);
        return { pages };
    });
}

/** The Deleted list of one tree: each deleted group's root, newest first, with the group's size. */
export async function listDeletedPages(ctx: RequestContext, ref: PageTreeRef): Promise<{ pages: DeletedPageData[] }> {
    assertCanDeletePages(ctx);
    return runInTenantReadContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const scope = await resolveTree(db, ctx, v, ref);
        const rows = await PageRepository.listDeletedRoots(db, ctx, projectIdOf(scope));
        return {
            pages: rows.map((r) => ({
                id: r.id,
                projectId: r.projectId,
                parentId: r.parentId,
                title: r.title,
                deletedAt: r.deletedAt!.toISOString(),
                deletedByUserId: r.deletedByUserId,
                deletionId: r.deletionId!,
                groupSize: r.groupSize,
            })),
        };
    });
}

// ─── Writes ─────────────────────────────────────────────────────────────

export interface CreatePageInput {
    projectId: string | null;
    parentId?: string | null;
    title?: string;
    afterId?: string | null;
    beforeId?: string | null;
}

/**
 * Create a page in a tree, under an optional parent (it must fit: decision
 * 341), at a place among its siblings (last by default), with its empty
 * content row, audited `PAGE_CREATED`.
 */
export async function createPage(ctx: RequestContext, input: CreatePageInput): Promise<PageData> {
    assertCanCreatePages(ctx);
    const title = checkedTitle(input.title, PAGE_DEFAULT_TITLE);
    return inPageTreeQueue(ctx.tenantId, () =>
        runInTenantContext(ctx, async (db) => {
            await lockPageTree(db, ctx.tenantId);
            const v = await visibleProjects(ctx, db);
            const scope = await resolveWritableTree(db, ctx, v, input.projectId ? { kind: 'project', projectId: input.projectId } : { kind: 'workspace' });
            const projectId = projectIdOf(scope);
            const parentId = input.parentId ?? null;
            if (parentId) {
                await loadParentIn(db, ctx, { projectId }, parentId);
                const chain = await PageRepository.chainUp(db, ctx, parentId);
                if (!subpageFits(chain.length)) tooDeep(chain.length + 1);
            }
            const sortKey = await placementKey(db, ctx, { projectId, parentId }, input);
            const page = await PageRepository.create(db, ctx, { projectId, parentId, title, sortKey });
            await logEvent(db, ctx, {
                action: 'PAGE_CREATED',
                entityType: 'Page',
                entityId: page.id,
                details: `Created page ${title}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'Page', operation: 'created', summary: 'PAGE_CREATED' },
                metadata: { projectId, parentId },
            });
            return toPageDto(page);
        }),
    );
}

async function throwPageConflict(db: PrismaTx, ctx: RequestContext, id: string): Promise<never> {
    const current = await PageRepository.getAny(db, ctx, id);
    if (!current || current.deletedAt) pageNotFound();
    throw new ConflictError('The page changed since you read it.', { reason: 'VERSION_CONFLICT', version: current.version, page: toPageDto(current) });
}

/**
 * Rename a page (decision 343): a versioned write naming the version it was
 * based on (428 without `If-Match`, 409 `VERSION_CONFLICT` with the current
 * row), audited `PAGE_RENAMED` with the old and new title.
 */
export async function renamePage(ctx: RequestContext, id: string, rawTitle: string, expectedVersion: number | undefined): Promise<PageData> {
    assertCanEditPages(ctx);
    if (expectedVersion === undefined) throw preconditionRequired();
    const title = checkedTitle(rawTitle);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const { page, scope } = await loadReadablePage(db, ctx, v, id);
        if (scope.kind === 'project' && scope.archived) refuseArchived();
        if (page.version !== expectedVersion) await throwPageConflict(db, ctx, page.id);
        if (title === page.title) return toPageDto(page);
        const count = await PageRepository.rename(db, ctx, page.id, expectedVersion, title);
        if (count === 0) await throwPageConflict(db, ctx, page.id);
        await logEvent(db, ctx, {
            action: 'PAGE_RENAMED',
            entityType: 'Page',
            entityId: page.id,
            details: `Renamed page ${page.title} to ${title}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Page', operation: 'updated', changedFields: ['title'] },
            metadata: { fromTitle: page.title, toTitle: title },
        });
        return toPageDto((await PageRepository.getAny(db, ctx, page.id))!);
    });
}

export interface MovePageInput {
    /** The tree it goes to: null the workspace's. */
    projectId: string | null;
    /** The new parent in that tree; null the top level. */
    parentId: string | null;
    afterId?: string | null;
    beforeId?: string | null;
}

/**
 * Move a page with its subtree: to a new parent and a place, in its own tree
 * or another (decision 341). Never under itself or a page below it
 * (`PAGE_WOULD_CYCLE`), never past ten levels (`PAGE_TOO_DEEP`), never into
 * or out of an archived project (`PROJECT_ARCHIVED`); a deleted or
 * invisible target is a 404. Every row of the subtree, deleted ones
 * included, takes the new tree. `If-Match`, when sent, must name the page's
 * version. Audited `PAGE_MOVED`.
 */
export async function movePage(ctx: RequestContext, id: string, input: MovePageInput, expectedVersion?: number): Promise<PageData> {
    assertCanEditPages(ctx);
    return inPageTreeQueue(ctx.tenantId, () =>
        runInTenantContext(ctx, async (db) => {
            await lockPageTree(db, ctx.tenantId);
            const v = await visibleProjects(ctx, db);
            const { page, scope: from } = await loadReadablePage(db, ctx, v, id);
            if (from.kind === 'project' && from.archived) refuseArchived();
            if (expectedVersion !== undefined && page.version !== expectedVersion) await throwPageConflict(db, ctx, page.id);
            const to = await resolveWritableTree(db, ctx, v, input.projectId ? { kind: 'project', projectId: input.projectId } : { kind: 'workspace' });
            const projectId = projectIdOf(to);
            const parentId = input.parentId;

            const subtree = await PageRepository.subtree(db, ctx, page.id, PAGE_SUBTREE_CAP + 1);
            if (subtree.length > PAGE_SUBTREE_CAP) {
                throw new ConflictError('This page holds too many pages below it to move in one step.', { reason: 'PAGE_TREE_TOO_LARGE' });
            }
            let chain: string[] = [];
            if (parentId) {
                if (parentId === page.id || subtree.some((s) => s.id === parentId)) {
                    throw new ConflictError('A page cannot be placed under itself or a page below it.', { reason: 'PAGE_WOULD_CYCLE' });
                }
                await loadParentIn(db, ctx, { projectId }, parentId);
                chain = (await PageRepository.chainUp(db, ctx, parentId)).map((c) => c.id);
            }
            const refusal = pageMoveRefusal(page.id, chain, subtree.map((s) => s.id), subtree.map((s) => s.depth));
            if (refusal?.reason === 'PAGE_WOULD_CYCLE') throw new ConflictError('A page cannot be placed under itself or a page below it.', { reason: 'PAGE_WOULD_CYCLE' });
            if (refusal?.reason === 'PAGE_TOO_DEEP') tooDeep(refusal.depth);

            // Every row of the subtree in id order before the first write (decision 173).
            const locked = await PageRepository.lockForWrite(db, ctx, subtree.map((s) => s.id));
            const sortKey = await placementKey(db, ctx, { projectId, parentId }, input, page.id);
            const changesTree = projectId !== page.projectId;
            if (changesTree) await PageRepository.setTree(db, ctx, locked, projectId);
            const count = await PageRepository.place(db, ctx, locked, page.id, { parentId, sortKey });
            if (count === 0) pageNotFound();
            await logEvent(db, ctx, {
                action: 'PAGE_MOVED',
                entityType: 'Page',
                entityId: page.id,
                details: `Moved page ${page.title}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'Page', operation: 'updated', changedFields: changesTree ? ['parentId', 'projectId', 'sortKey'] : ['parentId', 'sortKey'] },
                metadata: {
                    fromParentId: page.parentId,
                    toParentId: parentId,
                    fromProjectId: page.projectId,
                    toProjectId: projectId,
                    ...(changesTree ? { pagesMoved: locked.length } : {}),
                },
            });
            return toPageDto((await PageRepository.getAny(db, ctx, page.id))!);
        }),
    );
}

/**
 * Soft-delete a page (decision 344): it and every live page below it under
 * one new `deletionId`, audited `PAGE_DELETED`. From 4.1b it also closes
 * every open connection to them.
 */
export async function deletePage(ctx: RequestContext, id: string): Promise<{ deleted: true; deletionId: string; pages: number }> {
    assertCanDeletePages(ctx);
    return inPageTreeQueue(ctx.tenantId, () =>
        runInTenantContext(ctx, async (db) => {
            await lockPageTree(db, ctx.tenantId);
            const v = await visibleProjects(ctx, db);
            const { page, scope } = await loadReadablePage(db, ctx, v, id);
            if (scope.kind === 'project' && scope.archived) refuseArchived();
            const subtree = await PageRepository.subtree(db, ctx, page.id, PAGE_SUBTREE_CAP + 1);
            if (subtree.length > PAGE_SUBTREE_CAP) {
                throw new ConflictError('This page holds too many pages below it to delete in one step.', { reason: 'PAGE_TREE_TOO_LARGE' });
            }
            const locked = await PageRepository.lockForWrite(db, ctx, subtree.filter((s) => s.deletedAt === null).map((s) => s.id));
            const deletionId = randomUUID();
            const pages = await PageRepository.softDeleteMany(db, ctx, locked, deletionId, new Date());
            await logEvent(db, ctx, {
                action: 'PAGE_DELETED',
                entityType: 'Page',
                entityId: page.id,
                details: `Deleted page ${page.title}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'Page', operation: 'deleted', summary: 'PAGE_DELETED' },
                metadata: { deletionId, projectId: page.projectId, pages },
            });
            return { deleted: true as const, deletionId, pages };
        }),
    );
}

/**
 * Restore a deleted page's group (its `deletionId`): only the group's root
 * restores it (409 `DELETED_WITH_PARENT`, naming the root), only under a
 * live parent (409 `PARENT_DELETED`) in a live, unarchived project (404,
 * 409 `PROJECT_ARCHIVED`). A root whose kept sort key a live sibling now
 * holds is placed just after it. Audited `PAGE_RESTORED`.
 */
export async function restorePage(ctx: RequestContext, id: string): Promise<PageData> {
    assertCanDeletePages(ctx);
    return inPageTreeQueue(ctx.tenantId, () =>
        runInTenantContext(ctx, async (db) => {
            await lockPageTree(db, ctx.tenantId);
            const v = await visibleProjects(ctx, db);
            const page = await PageRepository.getAny(db, ctx, id);
            if (!page || !page.deletedAt || !page.deletionId) pageNotFound();
            let scope: PageScope;
            try {
                scope = await resolveTree(db, ctx, v, refOfRow(page));
            } catch {
                pageNotFound();
            }
            if (scope.kind === 'project' && scope.archived) refuseArchived();
            const group = await PageRepository.ofDeletion(db, ctx, page.deletionId);
            const roots = pageGroupRoots(group);
            if (!roots.includes(page.id)) {
                throw new ConflictError('This page was deleted with the page above it. Restore that page instead.', { reason: 'DELETED_WITH_PARENT', rootId: roots[0] ?? null });
            }
            if (page.parentId) {
                const parent = await PageRepository.getAny(db, ctx, page.parentId);
                if (parent?.deletedAt) {
                    throw new ConflictError(`Restore the page ${parent.title} first.`, { reason: 'PARENT_DELETED', parentId: parent.id });
                }
            }
            const locked = await PageRepository.lockForWrite(db, ctx, group.map((g) => g.id));
            const spot = { projectId: page.projectId, parentId: page.parentId };
            let replaced = false;
            if (await PageRepository.keyTaken(db, ctx, spot, page.sortKey, page.id)) {
                const next = await PageRepository.neighbourKey(db, ctx, spot, page.sortKey, 'after', page.id);
                await PageRepository.setSortKey(db, ctx, locked, page.id, keyBetween(page.sortKey, next));
                replaced = true;
            }
            const pages = await PageRepository.restoreGroup(db, ctx, locked, page.deletionId);
            await logEvent(db, ctx, {
                action: 'PAGE_RESTORED',
                entityType: 'Page',
                entityId: page.id,
                details: `Restored page ${page.title}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'Page', operation: 'restored', summary: 'PAGE_RESTORED' },
                metadata: { deletionId: page.deletionId, pages, ...(replaced ? { replaced: true } : {}) },
            });
            return toPageDto((await PageRepository.getAny(db, ctx, page.id))!);
        }),
    );
}
