/**
 * Recipient lists (sub-phase 2.7e; docs/porting/maps/2.7.md, part 6; owner
 * decisions 79 and 138 to 142; ADR 0006 "Recipient list").
 *
 * - A list is the workspace's (`projectId` null) or one project's: a name
 *   unique in its scope, an optional description and its people, each an
 *   ACTIVE member when added. A removed member leaves every list with the
 *   membership (the FK cascades).
 * - Reads take `projects.view`; workspace lists are written under
 *   `admin.manage`, a project's under `projects.edit` (decision 140). The
 *   routes are split by scope (`/recipient-lists/...` and
 *   `/projects/:id/recipient-lists/...`), so each carries the literal key its
 *   scope takes and a refusal is the middleware's audited denial; the
 *   usecases assert the same predicate (`assertCanManageListsOf`), and a list
 *   named under the wrong scope is a 404.
 * - Lists are archived and restored, never deleted (decision 141). An
 *   archived list is read-only and resolves to nobody; restoring it brings
 *   back what named it. An archived project's lists are read-only, like its
 *   items.
 * - Adding a list to an item's watchers copies the people it resolves to at
 *   that moment as ordinary watchers, each free to stop watching (decision
 *   139). The people are resolved by the send-time resolver
 *   (`resolveListRecipients`): active, reading work items, seeing the item's
 *   project, in a live workspace; the rest are skipped and counted.
 *
 * Every write is audited (`logEvent`, with the transaction client), naming
 * ids, never more than the list's own name. Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import { resolveListRecipients } from '../notifications/recipient-list';
import { assertCanManageListsOf, assertCanReadRecipientLists } from '../policies/recipient-list.policies';
import { assertCanEditWorkItems } from '../policies/work-item.policies';
import { visibleProjects, type ProjectVisibility } from '../policies/project-visibility';
import { MembershipRepository } from '../repositories/MembershipRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { RecipientListRepository, type RecipientListRow, type RecipientListScope } from '../repositories/RecipientListRepository';
import { WorkItemRepository, WorkItemWatcherRepository } from '../repositories/WorkItemRepository';
import type { RequestContext } from '../types';
import { assertProjectWritable, keyOf, loadVisibleItem } from './work-item-shared';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { ConflictError, badRequest, notFound } from '@/lib/errors/types';
import {
    RECIPIENT_LIST_DESCRIPTION_MAX,
    RECIPIENT_LIST_MEMBERS_MAX,
    RECIPIENT_LIST_NAME_MAX,
    type RecipientListData,
    type RecipientListWatchersResult,
} from '@/lib/recipient-lists/types';
import { sanitizePlainText } from '@/lib/security/sanitize';

// ─── Shapes and checks ──────────────────────────────────────────────────────

function toData(row: RecipientListRow, memberUserIds: string[]): RecipientListData {
    return {
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        description: row.description,
        archived: row.archivedAt !== null,
        memberUserIds,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

async function withMembers(db: PrismaTx, ctx: RequestContext, rows: readonly RecipientListRow[]): Promise<RecipientListData[]> {
    const members = await RecipientListRepository.listMembers(db, ctx, rows.map((r) => r.id));
    const by = new Map<string, string[]>();
    for (const m of members) by.set(m.listId, [...(by.get(m.listId) ?? []), m.userId]);
    return rows.map((r) => toData(r, by.get(r.id) ?? []));
}

function cleanName(raw: string): string {
    const name = sanitizePlainText(raw).replace(/[\r\n\t]+/g, ' ').trim();
    if (!name) throw badRequest('A recipient list needs a name.');
    if (name.length > RECIPIENT_LIST_NAME_MAX) throw badRequest(`A recipient list name is at most ${RECIPIENT_LIST_NAME_MAX} characters.`);
    return name;
}

function cleanDescription(raw: string | null | undefined): string | null {
    if (raw === null || raw === undefined) return null;
    const text = sanitizePlainText(raw).trim();
    if (text.length > RECIPIENT_LIST_DESCRIPTION_MAX) throw badRequest(`A description is at most ${RECIPIENT_LIST_DESCRIPTION_MAX} characters.`);
    return text || null;
}

function nameTaken(name: string, projectId: string | null): never {
    throw new ConflictError(
        projectId ? `This project already has a recipient list named ${name}.` : `The workspace already has a recipient list named ${name}.`,
        { reason: 'RECIPIENT_LIST_NAME_TAKEN' },
    );
}

function assertListOpen(list: RecipientListRow) {
    if (list.archivedAt) {
        throw new ConflictError('The recipient list is archived; restore it to change it.', { reason: 'RECIPIENT_LIST_ARCHIVED' });
    }
}

/** Of `userIds`, refuse any that is not an ACTIVE member of the workspace. */
async function assertActiveMembers(db: PrismaTx, ctx: RequestContext, userIds: readonly string[]) {
    if (userIds.length === 0) return;
    // Locked, so a removal in flight is waited for and seen (issue #70).
    const active = await MembershipRepository.lockActiveUserIds(db, ctx, userIds);
    if (userIds.some((id) => !active.has(id))) throw badRequest('Only active members of the workspace can be on a recipient list.');
}

function assertSize(count: number) {
    if (count > RECIPIENT_LIST_MEMBERS_MAX) throw badRequest(`A recipient list holds at most ${RECIPIENT_LIST_MEMBERS_MAX} people.`);
}

/** The project of a project scope, visible, or a 404. `null` is the workspace. */
async function loadScope(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, projectId: string | null) {
    if (projectId === null) return null;
    const project = await ProjectRepository.getVisible(db, ctx, v, projectId);
    if (!project) throw notFound('Project not found');
    return project;
}

/** A list of this scope, or a 404 (a list of another scope is not this scope's). */
async function loadList(db: PrismaTx, ctx: RequestContext, projectId: string | null, listId: string): Promise<RecipientListRow> {
    const list = await RecipientListRepository.getById(db, ctx, listId);
    if (!list || list.projectId !== projectId) throw notFound('Recipient list not found');
    return list;
}

function scopeLabel(project: { keyPrefix: string } | null): string {
    return project ? `project ${project.keyPrefix}` : 'the workspace';
}

// ─── Reads ────────────────────────────────────────────────────────────────

export interface ListRecipientListsQuery {
    /** The lists usable on this project's items: the workspace's and the project's, live only. */
    projectId?: string;
    /** The lists usable on any visible project's items (Settings → Intake), live only. */
    usable?: boolean;
    /** Workspace lists only: include archived ones. */
    includeArchived?: boolean;
}

/** The workspace's lists, or the lists usable on one or every visible project's items. */
export async function listRecipientLists(ctx: RequestContext, query: ListRecipientListsQuery = {}): Promise<RecipientListData[]> {
    assertCanReadRecipientLists(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        let scope: RecipientListScope;
        let includeArchived = false;
        if (query.projectId) {
            const project = await loadScope(db, ctx, v, query.projectId);
            scope = { kind: 'usable', projectIds: [project!.id] };
        } else if (query.usable) {
            scope = { kind: 'usable', projectIds: (await ProjectRepository.list(db, ctx, v, { includeArchived: true })).map((p) => p.id) };
        } else {
            scope = { kind: 'workspace' };
            includeArchived = query.includeArchived === true;
        }
        return withMembers(db, ctx, await RecipientListRepository.list(db, ctx, scope, { includeArchived }));
    });
}

/** One visible project's own lists. */
export async function listProjectRecipientLists(ctx: RequestContext, projectId: string, opts: { includeArchived?: boolean } = {}): Promise<RecipientListData[]> {
    assertCanReadRecipientLists(ctx);
    return runInTenantContext(ctx, async (db) => {
        const project = await loadScope(db, ctx, await visibleProjects(ctx, db), projectId);
        return withMembers(db, ctx, await RecipientListRepository.list(db, ctx, { kind: 'project', projectId: project!.id }, opts));
    });
}

export async function getRecipientList(ctx: RequestContext, projectId: string | null, listId: string): Promise<RecipientListData> {
    assertCanReadRecipientLists(ctx);
    return runInTenantContext(ctx, async (db) => {
        await loadScope(db, ctx, await visibleProjects(ctx, db), projectId);
        return (await withMembers(db, ctx, [await loadList(db, ctx, projectId, listId)]))[0]!;
    });
}

// ─── Writes ───────────────────────────────────────────────────────────────

/**
 * Open a write on one scope's list: the key, the project (visible and not
 * archived), the scope's lock (names are unique in it) and, given a list id,
 * the list.
 */
async function openScopeWrite(db: PrismaTx, ctx: RequestContext, projectId: string | null) {
    assertCanManageListsOf(ctx, projectId);
    const project = await loadScope(db, ctx, await visibleProjects(ctx, db), projectId);
    if (project) assertProjectWritable(project);
    await RecipientListRepository.lockScope(db, ctx, projectId);
    return project;
}

export interface CreateRecipientListInput {
    name: string;
    description?: string | null;
    userIds?: string[];
}

export async function createRecipientList(ctx: RequestContext, projectId: string | null, input: CreateRecipientListInput): Promise<RecipientListData> {
    assertCanManageListsOf(ctx, projectId);
    const name = cleanName(input.name);
    const description = cleanDescription(input.description);
    const userIds = [...new Set(input.userIds ?? [])];
    assertSize(userIds.length);
    return runInTenantContext(ctx, async (db) => {
        const project = await openScopeWrite(db, ctx, projectId);
        if (await RecipientListRepository.nameTaken(db, ctx, projectId, name)) nameTaken(name, projectId);
        await assertActiveMembers(db, ctx, userIds);
        const list = await RecipientListRepository.create(db, ctx, { projectId, name, description });
        await RecipientListRepository.addMembers(db, ctx, list.id, userIds);
        await logEvent(db, ctx, {
            action: 'RECIPIENT_LIST_CREATED',
            entityType: 'RecipientList',
            entityId: list.id,
            details: `Created recipient list ${name} in ${scopeLabel(project)}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'RecipientList', operation: 'created', summary: 'RECIPIENT_LIST_CREATED' },
            metadata: { projectId, memberUserIds: userIds },
        });
        return toData(list, userIds);
    });
}

export interface UpdateRecipientListInput {
    name?: string;
    description?: string | null;
}

/** Rename a list, or change (or clear) its description. */
export async function updateRecipientList(ctx: RequestContext, projectId: string | null, listId: string, input: UpdateRecipientListInput): Promise<RecipientListData> {
    assertCanManageListsOf(ctx, projectId);
    return runInTenantContext(ctx, async (db) => {
        const project = await openScopeWrite(db, ctx, projectId);
        const list = await loadList(db, ctx, projectId, listId);
        assertListOpen(list);
        const data: { name?: string; description?: string | null } = {};
        if (input.name !== undefined) {
            const name = cleanName(input.name);
            if (name !== list.name) {
                if (await RecipientListRepository.nameTaken(db, ctx, projectId, name, list.id)) nameTaken(name, projectId);
                data.name = name;
            }
        }
        if (input.description !== undefined) {
            const description = cleanDescription(input.description);
            if (description !== list.description) data.description = description;
        }
        const changedFields = Object.keys(data);
        let after = list;
        if (changedFields.length > 0) {
            after = await RecipientListRepository.update(db, ctx, list.id, data);
            await logEvent(db, ctx, {
                action: 'RECIPIENT_LIST_UPDATED',
                entityType: 'RecipientList',
                entityId: list.id,
                details: `Changed recipient list ${after.name} in ${scopeLabel(project)}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'RecipientList', operation: 'updated', changedFields },
                metadata: { projectId, changedFields },
            });
        }
        return (await withMembers(db, ctx, [after]))[0]!;
    });
}

export interface ChangeRecipientListMembersInput {
    add?: string[];
    remove?: string[];
}

/**
 * The one member write: add and remove people, each audited in one entry
 * naming their ids. Setting the whole set is the same write computed from
 * the stored members.
 */
async function changeMembersInTx(
    db: PrismaTx,
    ctx: RequestContext,
    projectId: string | null,
    listId: string,
    plan: (current: ReadonlySet<string>) => { add: string[]; remove: string[] },
): Promise<RecipientListData> {
    const project = await openScopeWrite(db, ctx, projectId);
    const list = await loadList(db, ctx, projectId, listId);
    assertListOpen(list);
    const current = new Set((await RecipientListRepository.listMembers(db, ctx, [list.id])).map((m) => m.userId));
    const { add, remove } = plan(current);
    if (add.some((id) => remove.includes(id))) throw badRequest('A person cannot be both added and removed.');
    const toAdd = [...new Set(add)].filter((id) => !current.has(id));
    const toRemove = [...new Set(remove)].filter((id) => current.has(id));
    assertSize(current.size + toAdd.length - toRemove.length);
    await assertActiveMembers(db, ctx, toAdd);
    const added = await RecipientListRepository.addMembers(db, ctx, list.id, toAdd);
    const removed = await RecipientListRepository.removeMembers(db, ctx, list.id, toRemove);
    if (added.length > 0 || removed.length > 0) {
        await logEvent(db, ctx, {
            action: 'RECIPIENT_LIST_MEMBERS_CHANGED',
            entityType: 'RecipientList',
            entityId: list.id,
            details: `Changed the people on recipient list ${list.name} in ${scopeLabel(project)}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'RecipientListMember', operation: 'updated', changedFields: ['members'] },
            metadata: { projectId, addedUserIds: added, removedUserIds: removed },
        });
    }
    return (await withMembers(db, ctx, [list]))[0]!;
}

/** Replace a list's people with `userIds`. */
export async function setRecipientListMembers(ctx: RequestContext, projectId: string | null, listId: string, userIds: string[]): Promise<RecipientListData> {
    assertCanManageListsOf(ctx, projectId);
    const wanted = new Set(userIds);
    assertSize(wanted.size);
    return runInTenantContext(ctx, (db) =>
        changeMembersInTx(db, ctx, projectId, listId, (current) => ({
            add: [...wanted].filter((id) => !current.has(id)),
            remove: [...current].filter((id) => !wanted.has(id)),
        })),
    );
}

/** Add and remove people (the page's write: two people editing one list never undo each other). */
export async function changeRecipientListMembers(ctx: RequestContext, projectId: string | null, listId: string, input: ChangeRecipientListMembersInput): Promise<RecipientListData> {
    assertCanManageListsOf(ctx, projectId);
    return runInTenantContext(ctx, (db) => changeMembersInTx(db, ctx, projectId, listId, () => ({ add: input.add ?? [], remove: input.remove ?? [] })));
}

async function setArchived(ctx: RequestContext, projectId: string | null, listId: string, archived: boolean): Promise<RecipientListData> {
    assertCanManageListsOf(ctx, projectId);
    return runInTenantContext(ctx, async (db) => {
        const project = await openScopeWrite(db, ctx, projectId);
        const list = await loadList(db, ctx, projectId, listId);
        let after = list;
        if ((list.archivedAt !== null) !== archived) {
            after = await RecipientListRepository.update(db, ctx, list.id, { archivedAt: archived ? new Date() : null });
            await logEvent(db, ctx, {
                action: archived ? 'RECIPIENT_LIST_ARCHIVED' : 'RECIPIENT_LIST_RESTORED',
                entityType: 'RecipientList',
                entityId: list.id,
                details: `${archived ? 'Archived' : 'Restored'} recipient list ${list.name} in ${scopeLabel(project)}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'RecipientList', operation: 'updated', changedFields: ['archivedAt'] },
                metadata: { projectId },
            });
        }
        return (await withMembers(db, ctx, [after]))[0]!;
    });
}

/** Archive a list: it resolves to nobody until restored (decision 141). */
export async function archiveRecipientList(ctx: RequestContext, projectId: string | null, listId: string): Promise<RecipientListData> {
    return setArchived(ctx, projectId, listId, true);
}

export async function restoreRecipientList(ctx: RequestContext, projectId: string | null, listId: string): Promise<RecipientListData> {
    return setArchived(ctx, projectId, listId, false);
}

// ─── Watchers (decision 139) ──────────────────────────────────────────────

/**
 * Copy a list's people onto an item's watchers (`work_items.edit`, the key
 * adding another watcher takes). The list must be live and the workspace's or
 * the item's project's. Only the people who may see the item are added; the
 * others are skipped and counted. One audit entry names the list and the
 * people added; nobody is notified (as adding a watcher notifies nobody).
 */
export async function addRecipientListAsWatchers(ctx: RequestContext, workItemId: string, listId: string): Promise<RecipientListWatchersResult> {
    assertCanEditWorkItems(ctx);
    assertCanReadRecipientLists(ctx);
    return runInTenantContext(ctx, async (db) => {
        const item = await loadVisibleItem(db, ctx, await visibleProjects(ctx, db), workItemId);
        // The item, then the people's memberships, in a member removal's own
        // order (it locks the items it writes, then deletes the membership),
        // so a removal in flight is waited for and its person skipped, never
        // met by the watcher rows' foreign key (Hardening H2, issue #70).
        await WorkItemRepository.lockForWrite(db, ctx, [item.id]);
        const list = await RecipientListRepository.getById(db, ctx, listId);
        if (!list) throw notFound('Recipient list not found');
        if (list.projectId !== null && list.projectId !== item.projectId) {
            throw badRequest('This recipient list belongs to another project.');
        }
        if (list.archivedAt) throw new ConflictError('The recipient list is archived.', { reason: 'RECIPIENT_LIST_ARCHIVED' });
        const resolved = await resolveListRecipients(db, ctx.tenantId, {
            listIds: [list.id],
            projectId: item.projectId,
            may: (p) => p.work_items.view === true,
        });
        const stillMembers = await MembershipRepository.lockActiveUserIds(db, ctx, resolved.userIds);
        const userIds = resolved.userIds.filter((id) => stillMembers.has(id));
        const added = await WorkItemWatcherRepository.addMany(db, ctx, item.id, userIds);
        const alreadyWatching = userIds.filter((id) => !added.includes(id));
        if (added.length > 0) {
            await logEvent(db, ctx, {
                action: 'WORK_ITEM_WATCHERS_ADDED_FROM_LIST',
                entityType: 'WorkItem',
                entityId: item.id,
                details: `Added ${added.length === 1 ? 'a watcher' : `${added.length} watchers`} to ${keyOf(item)} from recipient list ${list.name}`,
                detailsJson: {
                    category: 'relationship',
                    operation: 'linked',
                    sourceEntity: 'WorkItem',
                    sourceId: item.id,
                    targetEntity: 'RecipientList',
                    targetId: list.id,
                    relation: 'watcher',
                },
                metadata: { listId: list.id, watcherUserIds: added, skipped: resolved.named.length - userIds.length },
            });
        }
        return { listId: list.id, added, alreadyWatching, skipped: resolved.named.length - userIds.length };
    });
}
