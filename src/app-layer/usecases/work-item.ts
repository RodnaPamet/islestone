/**
 * The work-item usecases (sub-phase 2.2): list, get, key lookup, create,
 * update, state, assign, delete and restore, the bulk verbs, metrics,
 * activity and sub-items.
 *
 * Copied from inflect-compliance `src/app-layer/usecases/task.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e and edited per
 * docs/porting/maps/2.1-2.2.md ("work-item.ts edits"): renamed to the ADR 0006
 * vocabulary; the fixed status enum replaced by a team's workflow states
 * (`checkWorkflowStateTransition`, whose effects every path applies); the
 * compliance sections cut (type relevance, link targets, reviewer and
 * four-eyes, source reconciliation, SLA, metadata, evidence, the checklist);
 * delete made an explicit subtree soft delete under one `deletionId` (the
 * source's `db.task.delete` was soft only through an extension Islestone does
 * not port); optimistic concurrency on every write that changes what the
 * item shows; project visibility on every read and write; and every Prisma
 * call moved into a repository.
 *
 * Side-effect ORDER is each path's own, as in the source, and pinned by
 * tests/unit/usecases/work-item-sequence-order.test.ts:
 *   - create: audit, automation and the assignment email INSIDE the
 *     transaction; the due bell and the assignment bell after it;
 *   - a state change (single and bulk): audit inside; then COMMIT, the
 *     automation event and the watcher fan-out;
 *   - update and assign: audit inside; bells and watchers after.
 */
import { randomUUID } from 'node:crypto';

import type { WorkflowStateCategory, WorkItemPriority } from '@prisma/client';

import { emitAutomationEvent } from '../automation';
import { logEvent } from '../events/audit';
import { ActivityRepository, ACTIVITY_ORDER } from '../repositories/ActivityRepository';
import { LabelRepository } from '../repositories/LabelRepository';
import { MembershipRepository } from '../repositories/MembershipRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { TeamRepository } from '../repositories/TeamRepository';
import { WorkItemTypeRepository } from '../repositories/WorkItemTypeRepository';
import {
    CommentRepository,
    LIST_ORDERS,
    WorkItemRepository,
    listSortSpec,
    type KeyHit,
    type WorkItemFilters,
    type WorkItemPatch,
} from '../repositories/WorkItemRepository';
import {
    assertCanAssignWorkItems,
    assertCanCreateWorkItem,
    assertCanDeleteWorkItems,
    assertCanEditWorkItems,
    assertCanReadWorkItems,
} from '../policies/work-item.policies';
import { visibleProjects, type ProjectVisibility } from '../policies/project-visibility';
import { keyBetween } from '../domain/fractional-index';
import { fitsDepthCap, MAX_SUB_ITEM_DEPTH } from '../domain/work-item-graph';
import { formatKey, parseKey } from '../domain/work-item-key';
import {
    checkWorkflowStateTransition,
    formatStateTransitionError,
    stateTransitionEffects,
    type StateRef,
} from '../domain/workflow-state';
import { todayInTz } from '../notifications/work-item-due';
import { lockWorkItemGraph } from './work-item-graph-lock';
import {
    assertProjectWritable,
    emitAssignedBells,
    emitDueBell,
    emitWatcherActivity,
    enqueueAssignedEmail,
    keyOf,
    loadVisibleItem,
    loadWritableItem,
    notificationsTz,
    parseDateOnly,
    preconditionRequired,
    throwWriteConflict,
    toWorkItemDto,
    type WorkItemDto,
} from './work-item-shared';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { ConflictError, badRequest, notFound } from '@/lib/errors/types';
import { WORK_ITEM_DELETED_LIST_CAP } from '@/lib/list-backfill-cap';
import {
    clampLimit,
    computeKeysetPage,
    computeSortPage,
    decodeCursor,
    decodeSortCursor,
    encodeSortCursor,
    InvalidCursorError,
    type CursorPayload,
    type KeysetOrder,
    type SortCursor,
    type SortSpec,
} from '@/lib/pagination';
import { CUSTOM_FIELD_TYPE_SPECS, fieldIdOfOrder } from '@/lib/work-items/custom-fields';
import { DEFAULT_SORT_DIRECTION, LIST_SORTS, type ListSort, type SortDirection } from '@/lib/work-items/list-sorts';
import { resolveListCustomFields, writeInitialCustomFieldValues } from './custom-field';
import { assertCycleTakesItems, currentCycleIdsInTx } from './cycle';
import { sanitizePlainText } from '@/lib/security/sanitize';

// ─── Shared helpers ───────────────────────────────────────────────────────

function cursorOf(raw: string | undefined, order: KeysetOrder): CursorPayload | undefined {
    if (!raw) return undefined;
    try {
        return decodeCursor(raw, order);
    } catch (err) {
        if (err instanceof InvalidCursorError) throw badRequest('Invalid cursor.');
        throw err;
    }
}

/** Per-id outcome of a bulk verb: applied, or not found among the visible live items. */
function bulkResults(requested: readonly string[], applied: ReadonlySet<string>) {
    return {
        count: applied.size,
        results: requested.map((id) => ({ id, status: applied.has(id) ? ('ok' as const) : ('not_found' as const) })),
    };
}

/** Bulk refusals name the item by its title. */
function bulkStateRefusalPrefix(item: { title?: string | null } | undefined): string {
    const title = item?.title?.trim();
    return title ? `Cannot change the state of "${title}": ` : 'Cannot change the state of a selected work item: ';
}

/** De-duplicate ids, keeping their order (inflect #5318: a repeated id counted twice). */
function uniqueIds(ids: readonly string[]): string[] {
    return [...new Set(ids)];
}

async function assertActiveMember(db: PrismaTx, ctx: RequestContext, userId: string) {
    const active = await MembershipRepository.listActiveUserIds(db, ctx, [userId]);
    if (!active.has(userId)) throw badRequest('The assignee must be an active member of this workspace.');
}

/**
 * A `sortKey` for a placement among a project's live items. The caller has
 * locked the project's key sequence first, so placements in one project are
 * serialised and two writers never mint the same key into one gap.
 */
export async function sortKeyForPosition(
    db: PrismaTx,
    ctx: RequestContext,
    projectId: string,
    position: { afterId?: string; beforeId?: string } | undefined,
    selfId?: string,
): Promise<string> {
    if (!position || (!position.afterId && !position.beforeId)) {
        return keyBetween(await WorkItemRepository.lastSortKey(db, ctx, projectId), null);
    }
    if (position.afterId && position.beforeId) throw badRequest('Give either afterId or beforeId, not both.');
    const anchorId = (position.afterId ?? position.beforeId)!;
    if (anchorId === selfId) throw badRequest('An item cannot be placed next to itself.');
    const [anchor] = await WorkItemRepository.sortKeysOf(db, ctx, projectId, [anchorId]);
    if (!anchor) throw badRequest('The position names an item that is not a live item of this project.');
    if (position.afterId) {
        const next = await WorkItemRepository.nextSortKeyAfter(db, ctx, projectId, anchor, selfId);
        return keyBetween(anchor.sortKey, next && next.sortKey > anchor.sortKey ? next.sortKey : null);
    }
    const prev = await WorkItemRepository.prevSortKeyBefore(db, ctx, projectId, anchor, selfId);
    return keyBetween(prev && prev.sortKey < anchor.sortKey ? prev.sortKey : null, anchor.sortKey);
}

/** Checks a parent for a new or re-parented item, under the graph lock the caller holds. */
export async function assertParentAllowed(
    db: PrismaTx,
    ctx: RequestContext,
    v: ProjectVisibility,
    parentId: string,
    child: { id?: string; projectId: string; subtreeHeight: number },
): Promise<void> {
    const parent = await WorkItemRepository.findVisible(db, ctx, v, parentId);
    if (!parent) throw notFound('Parent work item not found');
    if (parent.projectId !== child.projectId) {
        throw badRequest('A sub-item is in the same project as its parent.');
    }
    const ancestors = await WorkItemRepository.ancestors(db, ctx, parentId);
    if (child.id && (parentId === child.id || ancestors.includes(child.id))) {
        throw new ConflictError('An item cannot be placed under itself or one of its sub-items.', { reason: 'PARENT_WOULD_CYCLE' });
    }
    if (!fitsDepthCap(ancestors.length, child.subtreeHeight)) {
        throw new ConflictError(`Sub-items nest at most ${MAX_SUB_ITEM_DEPTH} levels deep.`, { reason: 'SUB_ITEM_DEPTH_EXCEEDED' });
    }
}

// ─── List / get / key lookup ──────────────────────────────────────────────

export interface ListWorkItemsQuery extends Omit<WorkItemFilters, 'customFields'> {
    limit?: number;
    cursor?: string;
    /** A named sort (`LIST_SORTS`) or `cf:<fieldId>` (2.4). */
    order?: string;
    dir?: SortDirection;
    /** `cf.<fieldId>` conditions, keyed by field id (2.4). */
    customFields?: Readonly<Record<string, string>>;
}

function sortCursorOf(raw: string | undefined, spec: SortSpec): SortCursor | undefined {
    if (!raw) return undefined;
    try {
        return decodeSortCursor(raw, spec);
    } catch (err) {
        if (err instanceof InvalidCursorError) throw badRequest('Invalid cursor.');
        throw err;
    }
}

/** Resolve a `q` that parses as a key to its project and number (any prefix the project had). */
async function keyHitFor(db: PrismaTx, ctx: RequestContext, q: string | undefined): Promise<KeyHit | null> {
    const parsed = q ? parseKey(q) : null;
    if (!parsed) return null;
    const prefix = await ProjectRepository.projectIdForPrefix(db, ctx, parsed.prefix);
    return prefix ? { projectId: prefix.projectId, number: parsed.number } : null;
}

/**
 * The cycle filter (2.5a): ids and `none` as given; `current` becomes the ids of the
 * cycles current today (each team's), alongside any ids given. An empty
 * result is the empty string, which matches nothing.
 */
async function resolveCycleFilter(db: PrismaTx, ctx: RequestContext, raw: string): Promise<string> {
    const members = raw.split(',').map((m) => m.trim()).filter(Boolean);
    if (!members.includes('current')) return members.join(',');
    const current = await currentCycleIdsInTx(db, ctx);
    return [...members.filter((m) => m !== 'current'), ...current].join(',');
}

/**
 * The live list, one cursor page. Sorts (2.4, docs/pagination.md): a named
 * sort over the item's own columns, or `cf:<fieldId>`, a custom field's value
 * (empty values last). `cf.<fieldId>` conditions filter by a field.
 */
export async function listWorkItems(ctx: RequestContext, query: ListWorkItemsQuery = {}) {
    assertCanReadWorkItems(ctx);
    const order = query.order ?? 'manual';
    const sortFieldId = fieldIdOfOrder(order);
    if (!sortFieldId && !(LIST_SORTS as readonly string[]).includes(order)) {
        throw badRequest(`Invalid order. Must be one of: ${LIST_SORTS.join(', ')}, or cf:<fieldId>.`);
    }
    const limit = clampLimit(query.limit);
    const { customFields: rawConditions, order: _order, dir, cursor: rawCursor, ...filters } = query;
    void _order;
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const keyHit = await keyHitFor(db, ctx, query.q);
        const today = todayInTz(new Date(), notificationsTz());
        const { conditions, sortField } = await resolveListCustomFields(db, ctx, rawConditions ?? {}, sortFieldId);
        const listFilters: WorkItemFilters = { ...filters, customFields: conditions };
        // An empty parameter is no filter; a resolved empty list matches nothing.
        if (filters.cycleId) listFilters.cycleId = await resolveCycleFilter(db, ctx, filters.cycleId);
        else delete listFilters.cycleId;
        if (sortField) {
            const direction = dir ?? 'asc';
            const valueKind = CUSTOM_FIELD_TYPE_SPECS[sortField.type].column === 'dateValue' ? 'date' : 'string';
            const cursor = sortCursorOf(rawCursor, {
                columns: [
                    { path: ['phase'], direction: 'asc', kind: 'number' },
                    { path: ['value'], direction, kind: valueKind, nullable: true },
                ],
            });
            if (cursor && cursor.v[0] !== 0 && cursor.v[0] !== 1) throw badRequest('Invalid cursor.');
            const page = await WorkItemRepository.listByCustomField(db, ctx, v, listFilters, {
                limit,
                field: sortField,
                direction,
                cursor,
                keyHit,
                today,
            });
            const items = page.rows.slice(0, limit);
            return {
                items: items.map(toWorkItemDto),
                pageInfo: page.next ? { hasNextPage: true, nextCursor: encodeSortCursor(page.next) } : { hasNextPage: false },
            };
        }
        const sort = listSortSpec(order as ListSort, order === 'manual' ? undefined : (dir ?? DEFAULT_SORT_DIRECTION[order as ListSort]));
        const cursor = sortCursorOf(rawCursor, sort);
        const rows = await WorkItemRepository.list(db, ctx, v, listFilters, { limit, sort, cursor, keyHit, today });
        const page = computeSortPage(rows, limit, sort);
        return { items: page.items.map(toWorkItemDto), pageInfo: page.pageInfo };
    });
}

/** The Deleted view: the restore surface, capped (one past the cap marks truncation). */
export async function listDeletedWorkItems(ctx: RequestContext) {
    assertCanDeleteWorkItems(ctx);
    return runInTenantContext(ctx, async (db) => {
        const rows = await WorkItemRepository.listDeleted(db, ctx, await visibleProjects(ctx, db), WORK_ITEM_DELETED_LIST_CAP);
        const truncated = rows.length > WORK_ITEM_DELETED_LIST_CAP;
        return {
            rows: rows.slice(0, WORK_ITEM_DELETED_LIST_CAP).map((r) => ({
                ...toWorkItemDto(r),
                deletedAt: r.deletedAt,
                deletedByUserId: r.deletedByUserId,
                deletionId: r.deletionId,
            })),
            truncated,
        };
    });
}

export async function getWorkItem(ctx: RequestContext, id: string) {
    assertCanReadWorkItems(ctx);
    return runInTenantContext(ctx, async (db) => {
        const item = await WorkItemRepository.getById(db, ctx, await visibleProjects(ctx, db), id);
        if (!item) throw notFound('Work item not found');
        return {
            ...toWorkItemDto(item),
            description: item.description,
            createdByUserId: item.createdByUserId,
            project: item.project,
            state: item.state,
            type: item.type,
            parent: item.parent && !item.parent.deletedAt
                ? { id: item.parent.id, key: formatKey(item.parent.project.keyPrefix, item.parent.number), title: item.parent.title }
                : null,
            labels: item.labels.map((l) => l.label),
            counts: { subItems: item._count.subItems, comments: item._count.comments, watchers: item._count.watchers },
        };
    });
}

/**
 * Resolve a key: the current prefix, then a retired one (`ProjectKeyPrefix`),
 * then an alias left by a move (`WorkItemKeyAlias`). `redirected` tells the
 * client to rewrite an old key's URL to `canonicalKey`. Unknown and invisible
 * keys are the same 404.
 */
export async function getWorkItemByKey(ctx: RequestContext, rawKey: string) {
    assertCanReadWorkItems(ctx);
    const parsed = parseKey(rawKey);
    if (!parsed) throw notFound('Work item not found');
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const prefix = await ProjectRepository.projectIdForPrefix(db, ctx, parsed.prefix);
        if (!prefix) throw notFound('Work item not found');
        let id = (await WorkItemRepository.findByNumber(db, ctx, v, prefix.projectId, parsed.number))?.id;
        let redirected = prefix.retiredAt !== null;
        if (!id) {
            const alias = await WorkItemRepository.findAlias(db, ctx, prefix.projectId, parsed.number);
            if (alias) {
                id = alias.workItemId;
                redirected = true;
            }
        }
        if (!id) throw notFound('Work item not found');
        const item = await WorkItemRepository.getById(db, ctx, v, id);
        if (!item) throw notFound('Work item not found');
        const dto = toWorkItemDto(item);
        return { item: dto, canonicalKey: dto.key, redirected };
    });
}

// ─── Create ───────────────────────────────────────────────────────────────

export interface CreateWorkItemInput {
    projectId: string;
    typeId: string;
    title: string;
    description?: string | null;
    stateId?: string;
    priority?: WorkItemPriority;
    assigneeId?: string | null;
    parentId?: string | null;
    labelIds?: string[];
    startDate?: string | null;
    dueDate?: string | null;
    position?: { afterId?: string; beforeId?: string };
    /** Field id → value, for the project's live custom fields (2.4). */
    customFields?: Readonly<Record<string, unknown>>;
    /** A cycle of the project's team that is not completed (2.5a). */
    cycleId?: string | null;
}

export async function createWorkItem(ctx: RequestContext, input: CreateWorkItemInput): Promise<WorkItemDto> {
    assertCanCreateWorkItem(ctx);
    const title = sanitizePlainText(input.title).trim();
    if (!title) throw badRequest('A work item needs a title.');
    const description = input.description ? sanitizePlainText(input.description) : null;
    const labelIds = uniqueIds(input.labelIds ?? []);

    const result = await runInTenantContext(ctx, async (db) => {
        // The graph lock comes FIRST, before any row read or lock.
        if (input.parentId) await lockWorkItemGraph(db, ctx.tenantId);
        const v = await visibleProjects(ctx, db);
        const project = await ProjectRepository.getVisible(db, ctx, v, input.projectId);
        if (!project) throw notFound('Project not found');
        assertProjectWritable(project);

        const type = await WorkItemTypeRepository.getById(db, ctx, input.typeId);
        if (!type) throw notFound('Work item type not found');
        if (type.archivedAt) throw badRequest(`The type ${type.name} is archived and takes no new work items.`);

        const state = input.stateId
            ? await TeamRepository.getState(db, ctx, input.stateId)
            : await TeamRepository.defaultState(db, ctx, project.teamId);
        if (!state) throw input.stateId ? notFound('Workflow state not found') : new ConflictError('The team has no default state.', { reason: 'NO_DEFAULT_STATE' });
        if (state.teamId !== project.teamId) throw badRequest(`${state.name} belongs to another team's workflow.`);
        if (state.archivedAt) throw badRequest(`${state.name} is archived and takes no work items.`);

        if (input.assigneeId) await assertActiveMember(db, ctx, input.assigneeId);
        if (input.cycleId) await assertCycleTakesItems(db, ctx, input.cycleId, project.teamId);
        if (labelIds.length > 0) await assertLabelsUsable(db, ctx, labelIds, project.teamId);
        if (input.parentId) await assertParentAllowed(db, ctx, v, input.parentId, { projectId: project.id, subtreeHeight: 0 });

        // The number first: its row lock serialises creates in the project,
        // so the append below reads a settled last key.
        const number = await ProjectRepository.claimNumber(db, ctx, project.id);
        const sortKey = await sortKeyForPosition(db, ctx, project.id, input.position);
        const now = new Date();
        // A new item is created INTO its state: the timestamps a move from
        // the backlog into that state writes.
        const effects = stateTransitionEffects('BACKLOG', state.category, {}, now);

        const row = await WorkItemRepository.create(db, ctx, {
            projectId: project.id,
            teamId: project.teamId,
            number,
            typeId: type.id,
            title,
            description,
            stateId: state.id,
            stateCategory: state.category,
            priority: input.priority ?? 'NONE',
            assigneeId: input.assigneeId ?? null,
            parentId: input.parentId ?? null,
            cycleId: input.cycleId ?? null,
            sortKey,
            startDate: parseDateOnly(input.startDate),
            dueDate: parseDateOnly(input.dueDate),
            startedAt: effects.startedAt ?? null,
            completedAt: effects.completedAt ?? null,
            cancelledAt: effects.cancelledAt ?? null,
        });
        if (labelIds.length > 0) await LabelRepository.attach(db, ctx, row.id, labelIds);
        const customFieldIds = await writeInitialCustomFieldValues(db, ctx, { id: row.id, projectId: project.id }, input.customFields ?? {});
        const key = formatKey(project.keyPrefix, number);

        await logEvent(db, ctx, {
            action: 'WORK_ITEM_CREATED',
            entityType: 'WorkItem',
            entityId: row.id,
            details: `Created work item ${key}: ${title}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItem', operation: 'created', summary: 'WORK_ITEM_CREATED' },
            metadata: {
                typeId: type.id,
                priority: row.priority,
                projectId: project.id,
                parentId: row.parentId,
                ...(row.cycleId ? { cycleId: row.cycleId } : {}),
                ...(customFieldIds.length ? { customFieldIds } : {}),
            },
        });

        await emitAutomationEvent(ctx, {
            event: 'WORK_ITEM_CREATED',
            entityType: 'WorkItem',
            entityId: row.id,
            actorUserId: ctx.userId,
            stableKey: row.id,
            data: {
                key,
                title,
                projectId: project.id,
                teamId: project.teamId,
                typeId: type.id,
                stateId: state.id,
                stateCategory: state.category,
                priority: row.priority,
                assigneeId: row.assigneeId,
                parentId: row.parentId,
            },
        });

        if (row.assigneeId) {
            await enqueueAssignedEmail(db, ctx, row.assigneeId, [{ id: row.id, title, key, typeName: type.name }]);
        }
        const withLabels = labelIds.length > 0 ? { ...row, labels: labelIds.map((labelId) => ({ labelId })) } : row;
        if (customFieldIds.length === 0) return toWorkItemDto(withLabels);
        const reread = await WorkItemRepository.getById(db, ctx, v, row.id);
        return toWorkItemDto({ ...withLabels, customFieldValues: reread?.customFieldValues ?? [] });
    });

    // After the commit: the due reminder and the assignment bell.
    await emitDueBell(ctx, { ...result, dueDate: parseDateOnly(result.dueDate) });
    if (result.assigneeId) {
        await emitAssignedBells(ctx, result.assigneeId, [{ id: result.id, title: result.title, key: result.key }]);
    }
    return result;
}

async function assertLabelsUsable(db: PrismaTx, ctx: RequestContext, labelIds: readonly string[], teamId: string) {
    const labels = await LabelRepository.getMany(db, ctx, labelIds);
    if (labels.length !== labelIds.length) throw notFound('Label not found');
    for (const label of labels) {
        if (label.deletionStartedAt) {
            throw new ConflictError(`The label ${label.name} is being deleted.`, { reason: 'LABEL_BEING_DELETED' });
        }
        if (label.teamId && label.teamId !== teamId) throw badRequest(`The label ${label.name} belongs to another team.`);
    }
}

export { assertLabelsUsable };

// ─── Update ───────────────────────────────────────────────────────────────

export interface UpdateWorkItemInput {
    title?: string;
    description?: string | null;
    priority?: WorkItemPriority;
    typeId?: string;
    startDate?: string | null;
    dueDate?: string | null;
}

/**
 * A multi-field edit. A title or description change must name the version it
 * was based on (`If-Match`, ADR 0002 §9): a 428 without it, a 409 when the
 * item has moved on. The audit entry lists the changed field NAMES only,
 * never the description's text (ADR 0002 §11).
 */
export async function updateWorkItem(ctx: RequestContext, id: string, input: UpdateWorkItemInput, expectedVersion?: number) {
    assertCanEditWorkItems(ctx);
    if ((input.title !== undefined || input.description !== undefined) && expectedVersion === undefined) {
        throw preconditionRequired();
    }
    const patch: WorkItemPatch = {};
    if (input.title !== undefined) {
        patch.title = sanitizePlainText(input.title).trim();
        if (!patch.title) throw badRequest('A work item needs a title.');
    }
    if (input.description !== undefined) patch.description = input.description ? sanitizePlainText(input.description) : null;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.startDate !== undefined) patch.startDate = parseDateOnly(input.startDate);
    if (input.dueDate !== undefined) patch.dueDate = parseDateOnly(input.dueDate);

    const result = await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const before = await loadWritableItem(db, ctx, v, id);
        if (input.typeId !== undefined && input.typeId !== before.typeId) {
            const type = await WorkItemTypeRepository.getById(db, ctx, input.typeId);
            if (!type) throw notFound('Work item type not found');
            if (type.archivedAt) throw badRequest(`The type ${type.name} is archived.`);
            patch.typeId = type.id;
        }
        const changedFields = Object.keys(patch);
        if (changedFields.length === 0) return { item: before, changedFields, dueChanged: false, startChanged: false };
        const count = await WorkItemRepository.updateVersioned(db, ctx, v, id, expectedVersion, patch);
        if (count === 0) await throwWriteConflict(db, ctx, v, id);
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_UPDATED',
            entityType: 'WorkItem',
            entityId: id,
            details: `Updated work item ${keyOf(before)}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItem', operation: 'updated', changedFields },
            metadata: { changedFields },
        });
        const dueChanged = input.dueDate !== undefined && (before.dueDate?.getTime() ?? null) !== (patch.dueDate?.getTime() ?? null);
        const startChanged = input.startDate !== undefined;
        return { item: before, changedFields, dueChanged, startChanged };
    });

    const after = await getWorkItem(ctx, id);
    if (result.changedFields.length > 0) {
        // Material edits only: a title or description edit rings no bell.
        const material: string[] = [];
        if (result.dueChanged) material.push(after.dueDate ? `due date ${after.dueDate}` : 'due date cleared');
        if (result.startChanged && result.changedFields.includes('startDate')) {
            material.push(after.startDate ? `start date ${after.startDate}` : 'start date cleared');
        }
        if (material.length > 0) {
            await emitWatcherActivity(ctx, [
                { workItemId: id, kind: 'updated', discriminator: `v${after.version}`, detail: material.join(', ') },
            ]);
        }
        if (result.dueChanged) {
            await emitDueBell(ctx, { ...after, dueDate: parseDateOnly(after.dueDate) });
        }
    }
    return after;
}

// ─── State ────────────────────────────────────────────────────────────────

function toStateRef(s: { id: string; teamId: string; name: string; category: WorkflowStateCategory; archivedAt: Date | null }): StateRef {
    return s;
}

/**
 * Move an item to another state of its team. Audit inside the transaction;
 * after the COMMIT, the automation event and the watcher fan-out.
 */
export async function setWorkItemState(ctx: RequestContext, id: string, input: { stateId: string }, expectedVersion?: number) {
    assertCanEditWorkItems(ctx);
    const outcome = await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const item = await loadWritableItem(db, ctx, v, id);
        const [from, to] = await Promise.all([TeamRepository.getState(db, ctx, item.stateId), TeamRepository.getState(db, ctx, input.stateId)]);
        if (!to) throw notFound('Workflow state not found');
        const err = checkWorkflowStateTransition(toStateRef(from!), toStateRef(to));
        if (err) throw badRequest(formatStateTransitionError(err), { reason: err.kind });
        const effects = stateTransitionEffects(from!.category, to.category, item);
        const count = await WorkItemRepository.updateVersioned(db, ctx, v, id, expectedVersion, {
            stateId: to.id,
            stateCategory: to.category,
            ...effects,
        });
        if (count === 0) await throwWriteConflict(db, ctx, v, id);
        await applyStateAudit(db, ctx, item, from!, to);
        return { item, from: from!, to };
    });

    // After the COMMIT.
    await afterStateCommit(ctx, [outcome]);
    return getWorkItem(ctx, id);
}

/** The state change's audit entry (inside the transaction). */
async function applyStateAudit(
    db: PrismaTx,
    ctx: RequestContext,
    item: { id: string; number: number; project: { keyPrefix: string } },
    from: { id: string; name: string; category: WorkflowStateCategory },
    to: { id: string; name: string; category: WorkflowStateCategory },
) {
    await logEvent(db, ctx, {
        action: 'WORK_ITEM_STATE_CHANGED',
        entityType: 'WorkItem',
        entityId: item.id,
        details: `Changed the state of ${keyOf(item)}: ${from.name} → ${to.name}`,
        detailsJson: {
            category: 'custom',
            event: 'state_changed',
            fromStateId: from.id,
            toStateId: to.id,
            fromCategory: from.category,
            toCategory: to.category,
        },
        metadata: { fromStateId: from.id, toStateId: to.id },
    });
}

/** After the COMMIT of one or more state changes: automation, then watchers. */
async function afterStateCommit(
    ctx: RequestContext,
    changes: ReadonlyArray<{
        item: { id: string; number: number; teamId: string; projectId: string; project: { keyPrefix: string } };
        from: { id: string; name: string; category: WorkflowStateCategory };
        to: { id: string; name: string; category: WorkflowStateCategory };
    }>,
) {
    for (const c of changes) {
        await emitAutomationEvent(ctx, {
            event: 'WORK_ITEM_STATE_CHANGED',
            entityType: 'WorkItem',
            entityId: c.item.id,
            actorUserId: ctx.userId,
            stableKey: `${c.item.id}:${c.from.id}->${c.to.id}`,
            data: {
                key: keyOf(c.item),
                fromStateId: c.from.id,
                toStateId: c.to.id,
                fromCategory: c.from.category,
                toCategory: c.to.category,
                teamId: c.item.teamId,
                projectId: c.item.projectId,
            },
        });
    }
    await emitWatcherActivity(
        ctx,
        changes.map((c) => ({
            workItemId: c.item.id,
            kind: 'state_changed' as const,
            discriminator: `${c.from.id}->${c.to.id}`,
            detail: `state ${c.from.name} → ${c.to.name}`,
        })),
    );
}

export { applyStateAudit, afterStateCommit };

// ─── Assign ───────────────────────────────────────────────────────────────

/**
 * Assign the item to one ACTIVE member, or clear the assignee. Changing the
 * assignee does not touch the delegate (6.3, ADR 0003).
 */
export async function assignWorkItem(ctx: RequestContext, id: string, input: { assigneeId: string | null }, expectedVersion?: number) {
    assertCanAssignWorkItems(ctx);
    const outcome = await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const item = await loadWritableItem(db, ctx, v, id);
        if (item.assigneeId === input.assigneeId) return { item, changed: false, typeName: null as string | null };
        if (input.assigneeId) await assertActiveMember(db, ctx, input.assigneeId);
        const count = await WorkItemRepository.updateVersioned(db, ctx, v, id, expectedVersion, { assigneeId: input.assigneeId });
        if (count === 0) await throwWriteConflict(db, ctx, v, id);
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_ASSIGNED',
            entityType: 'WorkItem',
            entityId: id,
            details: `Assigned work item ${keyOf(item)}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItem', operation: 'updated', changedFields: ['assigneeId'] },
            metadata: { fromAssigneeId: item.assigneeId, toAssigneeId: input.assigneeId },
        });
        const type = await WorkItemTypeRepository.getById(db, ctx, item.typeId);
        if (input.assigneeId) {
            await enqueueAssignedEmail(db, ctx, input.assigneeId, [{ id, title: item.title, key: keyOf(item), typeName: type?.name ?? null }]);
        }
        return { item, changed: true, typeName: type?.name ?? null };
    });

    const after = await getWorkItem(ctx, id);
    if (outcome.changed) {
        if (input.assigneeId) {
            await emitDueBell(ctx, { ...after, dueDate: parseDateOnly(after.dueDate) });
            await emitAssignedBells(ctx, input.assigneeId, [{ id, title: after.title, key: after.key }]);
        }
        await emitWatcherActivity(ctx, [
            {
                workItemId: id,
                kind: 'assigned',
                discriminator: input.assigneeId ?? 'unassigned',
                detail: input.assigneeId ? 'assignee changed' : 'assignee cleared',
            },
        ]);
    }
    return after;
}

// ─── Delete / restore ─────────────────────────────────────────────────────

/**
 * Soft-delete items with their live sub-items, all under ONE new
 * `deletionId`, so a restore brings back exactly what was deleted together
 * (ADR 0002 §8). Never a hard delete: rows, numbers, relations and comments
 * stay until the purge.
 */
async function softDeleteSubtrees(db: PrismaTx, ctx: RequestContext, rootIds: readonly string[]) {
    const subtree = await WorkItemRepository.liveSubtree(db, ctx, rootIds);
    const deletionId = randomUUID();
    const count = await WorkItemRepository.softDelete(db, ctx, subtree.map((r) => r.id), deletionId, new Date());
    return { deletionId, count };
}

export async function deleteWorkItem(ctx: RequestContext, id: string) {
    assertCanDeleteWorkItems(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const item = await loadWritableItem(db, ctx, v, id);
        const { deletionId, count } = await softDeleteSubtrees(db, ctx, [id]);
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_DELETED',
            entityType: 'WorkItem',
            entityId: id,
            details: `Deleted work item ${keyOf(item)}: ${item.title}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItem', operation: 'deleted' },
            metadata: { key: keyOf(item), typeId: item.typeId, deletionId, subtreeCount: count },
        });
        return { deleted: true, deletionId, count };
    });
}

export async function bulkDeleteWorkItems(ctx: RequestContext, workItemIds: readonly string[]) {
    assertCanDeleteWorkItems(ctx);
    const ids = uniqueIds(workItemIds);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const items = await WorkItemRepository.listByIds(db, ctx, v, ids);
        for (const item of items) assertProjectWritable(item.project);
        const { deletionId, count } = await softDeleteSubtrees(db, ctx, items.map((i) => i.id));
        for (const item of items) {
            await logEvent(db, ctx, {
                action: 'WORK_ITEM_DELETED',
                entityType: 'WorkItem',
                entityId: item.id,
                details: `Deleted work item ${keyOf(item)}: ${item.title}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItem', operation: 'deleted' },
                metadata: { key: keyOf(item), typeId: item.typeId, deletionId, bulk: true },
            });
        }
        return { ...bulkResults(ids, new Set(items.map((i) => i.id))), deletionId, deletedRows: count };
    });
}

/**
 * Restore every row deleted together with this item. Refused while the
 * project is deleted (restore the project), while it is archived, and while
 * a parent of the group is deleted under another deletion (restore the
 * parent first). Numbers never collide: they are never reused.
 */
export async function restoreWorkItem(ctx: RequestContext, id: string) {
    assertCanDeleteWorkItems(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const item = await WorkItemRepository.findDeletedForRestore(db, ctx, v, id);
        if (!item || !item.deletionId) throw notFound('Deleted work item not found');
        if (item.project.deletedAt) {
            throw new ConflictError('The project is deleted; restore the project first.', { reason: 'PROJECT_DELETED' });
        }
        assertProjectWritable(item.project);
        const group = await WorkItemRepository.idsOfDeletion(db, ctx, item.deletionId);
        const inGroup = new Set(group.map((r) => r.id));
        const outsideParents = [...new Set(group.map((r) => r.parentId).filter((p): p is string => !!p && !inGroup.has(p)))];
        const blocked = await WorkItemRepository.deletedOutside(db, ctx, outsideParents, item.deletionId);
        if (blocked.length > 0) {
            throw new ConflictError('A parent of this work item is deleted; restore the parent first.', { reason: 'PARENT_DELETED' });
        }
        const count = await WorkItemRepository.restoreDeletion(db, ctx, item.deletionId);
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_RESTORED',
            entityType: 'WorkItem',
            entityId: id,
            details: `Restored work item ${keyOf(item)}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItem', operation: 'restored' },
            metadata: { deletionId: item.deletionId, restoredCount: count },
        });
        return { restored: true, count };
    });
}

// ─── Bulk verbs ───────────────────────────────────────────────────────────

/** Assign many items to one member (or clear them): one mail for everything newly handed over. */
export async function bulkAssignWorkItems(ctx: RequestContext, input: { workItemIds: readonly string[]; assigneeId: string | null }) {
    assertCanAssignWorkItems(ctx);
    const ids = uniqueIds(input.workItemIds);
    const outcome = await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const items = await WorkItemRepository.listByIds(db, ctx, v, ids);
        for (const item of items) assertProjectWritable(item.project);
        if (input.assigneeId) await assertActiveMember(db, ctx, input.assigneeId);
        const changed = items.filter((i) => i.assigneeId !== input.assigneeId);
        await WorkItemRepository.bulkUpdate(db, ctx, v, changed.map((i) => i.id), { assigneeId: input.assigneeId });
        for (const item of changed) {
            await logEvent(db, ctx, {
                action: 'WORK_ITEM_ASSIGNED',
                entityType: 'WorkItem',
                entityId: item.id,
                details: `Assigned work item ${keyOf(item)}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItem', operation: 'updated', changedFields: ['assigneeId'] },
                metadata: { fromAssigneeId: item.assigneeId, toAssigneeId: input.assigneeId, bulk: true },
            });
        }
        const newly = changed.map((i) => ({ id: i.id, title: i.title, key: keyOf(i), typeName: i.type.name }));
        if (input.assigneeId) await enqueueAssignedEmail(db, ctx, input.assigneeId, newly);
        return { items, newly };
    });

    if (input.assigneeId && outcome.newly.length > 0) {
        await emitAssignedBells(ctx, input.assigneeId, outcome.newly);
    }
    await emitWatcherActivity(
        ctx,
        outcome.newly.map((i) => ({
            workItemId: i.id,
            kind: 'assigned' as const,
            discriminator: input.assigneeId ?? 'unassigned',
            detail: input.assigneeId ? 'assignee changed' : 'assignee cleared',
        })),
    );
    return bulkResults(ids, new Set(outcome.items.map((i) => i.id)));
}

/**
 * Set the state of many items: a `stateId` (every item must be of that
 * state's team) or a `stateCategory`, mapped per team to that team's default
 * state of the category. All or nothing: one refusal names its item and
 * refuses the action. No-ops are skipped.
 */
export async function bulkSetWorkItemState(
    ctx: RequestContext,
    input: { workItemIds: readonly string[]; stateId?: string; stateCategory?: WorkflowStateCategory },
) {
    assertCanEditWorkItems(ctx);
    if (!input.stateId === !input.stateCategory) throw badRequest('Give either stateId or stateCategory.');
    const ids = uniqueIds(input.workItemIds);
    const changes = await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const items = await WorkItemRepository.listByIds(db, ctx, v, ids);
        for (const item of items) assertProjectWritable(item.project);
        const teamIds = [...new Set(items.map((i) => i.teamId))];
        const states = await TeamRepository.liveStatesOfTeams(db, ctx, teamIds);
        const byId = new Map(states.map((s) => [s.id, s]));
        let fixedTarget: (typeof states)[number] | undefined;
        if (input.stateId) {
            fixedTarget = byId.get(input.stateId) ?? (await TeamRepository.getState(db, ctx, input.stateId)) ?? undefined;
            if (!fixedTarget) throw notFound('Workflow state not found');
        }
        const planned: Array<{ item: (typeof items)[number]; from: (typeof states)[number]; to: (typeof states)[number] }> = [];
        for (const item of items) {
            // guardrail-allow: n+1 — only an item in an ARCHIVED state misses the batch read of live states.
            const from = byId.get(item.stateId) ?? (await TeamRepository.getState(db, ctx, item.stateId));
            let to = fixedTarget;
            if (!to) {
                const ofCategory = states.filter((s) => s.teamId === item.teamId && s.category === input.stateCategory);
                to = ofCategory.find((s) => s.isDefault) ?? ofCategory[0];
                if (!to) throw badRequest(`${bulkStateRefusalPrefix(item)}its team has no live ${input.stateCategory} state.`);
            }
            const err = checkWorkflowStateTransition(toStateRef(from!), toStateRef(to));
            if (err?.kind === 'no_op') continue;
            if (err) throw badRequest(bulkStateRefusalPrefix(item) + formatStateTransitionError(err), { reason: err.kind, workItemId: item.id });
            planned.push({ item, from: from!, to });
        }
        const now = new Date();
        for (const p of planned) {
            const effects = stateTransitionEffects(p.from.category, p.to.category, p.item, now);
            await WorkItemRepository.bulkUpdate(db, ctx, v, [p.item.id], { stateId: p.to.id, stateCategory: p.to.category, ...effects });
            await applyStateAudit(db, ctx, p.item, p.from, p.to);
        }
        return { items, planned };
    });

    await afterStateCommit(ctx, changes.planned);
    return bulkResults(ids, new Set(changes.items.map((i) => i.id)));
}

export async function bulkSetWorkItemDueDate(ctx: RequestContext, input: { workItemIds: readonly string[]; dueDate: string | null }) {
    assertCanEditWorkItems(ctx);
    const ids = uniqueIds(input.workItemIds);
    const dueDate = parseDateOnly(input.dueDate);
    const outcome = await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const items = await WorkItemRepository.listByIds(db, ctx, v, ids);
        for (const item of items) assertProjectWritable(item.project);
        await WorkItemRepository.bulkUpdate(db, ctx, v, items.map((i) => i.id), { dueDate });
        for (const item of items) {
            await logEvent(db, ctx, {
                action: 'WORK_ITEM_UPDATED',
                entityType: 'WorkItem',
                entityId: item.id,
                details: `Changed the due date of ${keyOf(item)}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItem', operation: 'updated', changedFields: ['dueDate'] },
                metadata: { changedFields: ['dueDate'], bulk: true },
            });
        }
        return items;
    });
    await emitWatcherActivity(
        ctx,
        outcome.map((i) => ({
            workItemId: i.id,
            kind: 'updated' as const,
            discriminator: `due:${input.dueDate ?? 'none'}`,
            detail: input.dueDate ? `due date ${input.dueDate}` : 'due date cleared',
        })),
    );
    for (const i of outcome) {
        await emitDueBell(ctx, { id: i.id, title: i.title, key: keyOf(i), dueDate, assigneeId: i.assigneeId, stateCategory: i.stateCategory });
    }
    return bulkResults(ids, new Set(outcome.map((i) => i.id)));
}

// ─── Metrics, activity, sub-items ─────────────────────────────────────────

/**
 * Counts by category, overdue (a due date before today in the reminder zone
 * on an open item) and unassigned open items, over visible projects only:
 * deleted projects never, archived ones only when asked.
 */
export async function getWorkItemMetrics(ctx: RequestContext, filters: WorkItemFilters = {}) {
    assertCanReadWorkItems(ctx);
    return runInTenantContext(ctx, async (db) =>
        WorkItemRepository.metrics(db, ctx, await visibleProjects(ctx, db), filters, todayInTz(new Date(), notificationsTz())),
    );
}

export interface ActivityEntry {
    kind: 'change' | 'comment';
    id: string;
    createdAt: Date;
    actorUserId: string | null;
    action?: string;
    detailsJson?: unknown;
    comment?: { id: string; body: string; editedAt: Date | null };
}

/**
 * An item's Activity: its audit entries (`WORK_ITEM_*`) and its live
 * comments, merged newest first, one keyset page over `(createdAt, id)`.
 * The item is checked first, so an unknown, deleted or invisible id is a 404
 * rather than an empty list.
 */
export async function getWorkItemActivity(ctx: RequestContext, id: string, query: { limit?: number; cursor?: string } = {}) {
    assertCanReadWorkItems(ctx);
    const limit = clampLimit(query.limit);
    const cursor = cursorOf(query.cursor, ACTIVITY_ORDER);
    return runInTenantContext(ctx, async (db) => {
        await loadVisibleItem(db, ctx, await visibleProjects(ctx, db), id);
        const [changes, comments] = await Promise.all([
            ActivityRepository.listForWorkItem(db, ctx, id, { limit, cursor }),
            CommentRepository.list(db, ctx, id, { limit, cursor }),
        ]);
        const merged: ActivityEntry[] = [
            ...changes.map((c) => ({
                kind: 'change' as const,
                id: c.id,
                createdAt: c.createdAt,
                actorUserId: c.userId,
                action: c.action,
                detailsJson: c.detailsJson,
            })),
            ...comments.map((c) => ({
                kind: 'comment' as const,
                id: c.id,
                createdAt: c.createdAt,
                actorUserId: c.authorUserId,
                comment: { id: c.id, body: c.body, editedAt: c.editedAt },
            })),
        ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
        return computeKeysetPage(merged, limit, ACTIVITY_ORDER);
    });
}

/** A page of an item's live sub-items in manual order; `progress` adds done/total per sub-item. */
export async function listSubItems(ctx: RequestContext, parentId: string, query: { limit?: number; cursor?: string; progress?: boolean } = {}) {
    assertCanReadWorkItems(ctx);
    const limit = clampLimit(query.limit);
    const cursor = cursorOf(query.cursor, LIST_ORDERS.manual);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        await loadVisibleItem(db, ctx, v, parentId);
        const rows = await WorkItemRepository.listSubItems(db, ctx, v, parentId, { limit, cursor });
        const page = computeKeysetPage(rows, limit, LIST_ORDERS.manual);
        const progress = query.progress ? await WorkItemRepository.subItemProgress(db, ctx, page.items.map((i) => i.id)) : null;
        return {
            items: page.items.map((r) => ({
                ...toWorkItemDto(r),
                ...(progress ? { progress: progress.get(r.id) ?? { total: 0, done: 0 } } : {}),
            })),
            pageInfo: page.pageInfo,
        };
    });
}
