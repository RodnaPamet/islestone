/**
 * Work items, and their comments, watchers and links (sub-phases 2.1–2.2).
 *
 * Copied from inflect-compliance `src/app-layer/repositories/TaskRepository.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e and rewritten for the work-item
 * model (docs/porting/maps/2.1-2.2.md, "WorkItemRepository.ts edits"):
 *
 *   - `parseListFilter` and `_buildWhere` kept, over the new enums and
 *     filters; `q` matches the title or an exact key;
 *   - every read and write carries `deletedAt` and the caller's project
 *     visibility EXPLICITLY. inflect relied on a soft-delete extension that
 *     rewrote `Task` reads and turned deletes into updates; Islestone ports no
 *     such extension, so a site without the predicate would see deleted items
 *     (docs/porting/maps/2.1-2.2.md, "Explicit predicates";
 *     tests/unit/repositories/work-item-repository-predicates.test.ts);
 *   - the version check is the `WHERE` of one `updateMany` (ADR 0002 §9), never
 *     a read then an update;
 *   - the list is cursor-only over `(sortKey, id)` or `(updatedAt, id)`;
 *   - the compliance links, checklist, control counts, reviewer and source
 *     handling are cut.
 *
 * `CommentRepository`, `WorkItemWatcherRepository` and `WorkItemLinkRepository`
 * are the source's `TaskCommentRepository`, `TaskWatcherRepository` and
 * `TaskLinkRepository`, renamed (ADR 0006: no aliases).
 */
import { Prisma, type CustomFieldType, type WorkflowStateCategory, type WorkItemPriority } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import { badRequest } from '@/lib/errors/types';
import { WORK_ITEM_DELETED_LIST_CAP } from '@/lib/list-backfill-cap';
import {
    buildKeysetWhere,
    buildSortWhere,
    keysetOrderBy,
    sortOrderBy,
    sortValuesOf,
    type CursorPayload,
    type KeysetOrder,
    type SortColumn,
    type SortCursor,
    type SortSpec,
} from '@/lib/pagination';
import { CUSTOM_FIELD_LIMITS, CUSTOM_FIELD_TYPE_SPECS } from '@/lib/work-items/custom-fields';
import { DEFAULT_SORT_DIRECTION, type ListSort, type SortDirection } from '@/lib/work-items/list-sorts';
import { SEARCH_ROW_CAP, containsPattern, escapeLike, prefixPattern } from '@/lib/search/query';
import { SEARCH_MATCH_CAP } from './SearchVectorRepository';
import type { CustomFieldCondition } from '../domain/custom-field';
import { parseEnumListFilter, parseIdListFilter } from '../domain/list-filter';
import { DUE_FILTERS, DUE_SOON_DAYS, type DueFilter } from '../domain/work-item-due';
import { OPEN_CATEGORY_FILTER, WORKFLOW_STATE_CATEGORIES } from '../domain/workflow-state';
import {
    JOB_PROJECT_VISIBILITY_WHERE,
    projectVisibilityArgs,
    projectVisibilityWhere,
    type ProjectVisibility,
} from '../policies/project-visibility';
import type { RequestContext } from '../types';
import { isLocked, mintLockedWorkItemIds, type LockedWorkItemIds } from './work-item-locks';

const PRIORITIES: readonly WorkItemPriority[] = ['NONE', 'URGENT', 'HIGH', 'MEDIUM', 'LOW'];

/** Nested reads on the detail view are bounded; `_count` gives the totals. */
export const DETAIL_RELATION_TAKE = 50;

/**
 * Parse a comma-joinable enum filter. Invalid members fail loudly with a 400
 * rather than silently matching zero rows.
 */
export function parseListFilter<T extends string>(raw: string | undefined, valid: readonly T[], label: string) {
    return parseEnumListFilter<T>(raw, valid, label);
}

export interface WorkItemFilters {
    projectId?: string;
    teamId?: string;
    typeId?: string;
    stateId?: string;
    /** Comma-joinable categories. */
    stateCategory?: string;
    /** Comma-joinable priorities. */
    priority?: string;
    labelId?: string;
    /** An item id, or `none` for top-level items only. */
    parentId?: string;
    /** A member's user id, or `none` for unassigned. */
    assigneeId?: string;
    /** The creator's user id (comma-joinable), as `assigneeId` takes one. */
    createdById?: string;
    /** Member user ids (comma-joinable) an item waits on, with `none` for items waiting on nobody (2.4b) and `me` for the caller (2.7a). */
    waitingOnId?: string;
    /** Cycle ids (comma-joinable), with `none` for items in no cycle (2.5a; the usecase resolves `current`). */
    cycleId?: string;
    /** Milestone ids (comma-joinable), with `none` for items in no milestone (2.5b). */
    milestoneId?: string;
    /**
     * Goal ids (comma-joinable; 3.2a, decision 220). Never read here: the list
     * usecase resolves it (`resolveListFiltersInTx`) into `goalScope`, and a
     * where built with it unresolved is refused.
     */
    goalId?: string;
    /** Initiative ids (comma-joinable; 3.2a). Resolved into `initiativeProjectIds` by the usecase, like `goalId`. */
    initiativeId?: string;
    /**
     * INTERNAL, never from a request: the `goalId` filter resolved (3.2a,
     * decisions 211 and 220): an item matches when its project is under one of
     * the goals' live initiatives (`projectIds`) OR it names one of the goals'
     * live subtree directly (`goalIds`).
     */
    goalScope?: { projectIds: readonly string[]; goalIds: readonly string[] };
    /** INTERNAL, never from a request: the `initiativeId` filter resolved to the initiatives' projects. */
    initiativeProjectIds?: readonly string[];
    /** `me`: the items the CALLER watches, read from the request context, never a user id from the client. */
    watching?: 'me';
    /**
     * Member user ids (comma-joinable), or `me` for the caller (2.8a,
     * decision 152): items whose open review step still asks that person, read
     * from the reviewer rows (the item waits on them while its round is open).
     */
    reviewerId?: string;
    /** `overdue`, `next7d` (today to seven days on) or `soon` (overdue or due within `DUE_SOON_DAYS`); open items only. */
    due?: DueFilter;
    /** Title text; an exact key hit is passed as `keyHit`. */
    q?: string;
    /**
     * INTERNAL, never from a request: the items whose title (stemmed), description
     * or a live comment matches `q` in full text (2.7f; `titleFullTextIds`,
     * `SearchVectorRepository.matchItems`), set by the list usecase. Widens
     * the `q` match; ignored without `q`.
     */
    fullTextMatchIds?: readonly string[];
    /**
     * INTERNAL, never from a request: the live, visible items whose title holds
     * `q` (`titleSubstringIds`, owner decision 245), set by the list usecase
     * when fewer than the cap matched. When set, the `q` filter matches these
     * ids instead of `title ILIKE '%q%'`, which row-level security keeps from
     * using the trigram index; when not set (a broad `q`, or a caller that did
     * not resolve it), the filter keeps the `ILIKE` itself.
     */
    titleSubstringMatchIds?: readonly string[];
    /** Include archived projects' items (default: excluded). */
    includeArchived?: boolean;
    /** Custom-field conditions (2.4), each already parsed against its field's type. */
    customFields?: ReadonlyArray<{ field: { id: string; type: CustomFieldType }; condition: CustomFieldCondition }>;
}

/** One search row (`WorkItemRepository.findSearchRows`, after `searchTitleIds` or `SearchVectorRepository.matchItems`). */
export interface WorkItemSearchRow {
    id: string;
    title: string;
    number: number;
    keyPrefix: string;
}

/** A `q` that parsed as a key and resolved to a project and number. */
export interface KeyHit {
    projectId: string;
    number: number;
}

/** The list orders: manual (`sortKey`) and recently changed (`updatedAt`, desc). */
export const LIST_ORDERS = {
    manual: { column: 'sortKey', direction: 'asc', kind: 'string' },
    updated: { column: 'updatedAt', direction: 'desc', kind: 'date' },
} as const satisfies Record<string, KeysetOrder>;
export type ListOrderName = keyof typeof LIST_ORDERS;

/**
 * The columns of each named list sort (sub-phase 2.4, docs/pagination.md):
 * nulls last; `manual` has one direction; `key` is the project's prefix,
 * then the number. Each is backed by a `[tenantId, projectId, <column>, id]`
 * index (ADR 0002 §13).
 */
export function listSortSpec(sort: ListSort, direction?: SortDirection): SortSpec {
    const dir = sort === 'manual' ? 'asc' : (direction ?? DEFAULT_SORT_DIRECTION[sort]);
    const one = (path: string[], kind: SortColumn['kind'], nullable = false): SortSpec => ({
        columns: [{ path, direction: dir, kind, nullable }],
    });
    switch (sort) {
        case 'manual':
            return one(['sortKey'], 'string');
        case 'updated':
            return one(['updatedAt'], 'date');
        case 'created':
            return one(['createdAt'], 'date');
        case 'due':
            return one(['dueDate'], 'date', true);
        case 'priority':
            return one(['priorityRank'], 'number');
        case 'key':
            return {
                columns: [
                    { path: ['project', 'keyPrefix'], direction: dir, kind: 'string' },
                    { path: ['number'], direction: dir, kind: 'number' },
                ],
            };
    }
}

/** The sort of a custom field's value rows (phase 0 of `listByCustomField`). */
export function customFieldValueSortSpec(type: CustomFieldType, direction: SortDirection): SortSpec {
    const column = CUSTOM_FIELD_TYPE_SPECS[type].column;
    // A checkbox's rows are all `true`: the constant type column carries the
    // direction, and the row id orders them.
    if (type === 'CHECKBOX') return { columns: [{ path: ['fieldType'], direction, kind: 'string' }] };
    if (column === 'optionId') return { columns: [{ path: ['option', 'sortKey'], direction, kind: 'string' }] };
    return { columns: [{ path: [column], direction, kind: column === 'dateValue' ? 'date' : 'string' }] };
}

/** One value as a list row carries it: what `toWorkItemDto` folds into `customFields`. */
const customFieldValueSelect = {
    fieldId: true,
    fieldType: true,
    textValue: true,
    numberValue: true,
    dateValue: true,
    boolValue: true,
    optionId: true,
    userId: true,
} satisfies Prisma.CustomFieldValueSelect;

/** Values on one list row: every field of a project, and a multi-select's options. */
export const ROW_CUSTOM_VALUES_TAKE = CUSTOM_FIELD_LIMITS.fieldsPerProject * 4;

export const workItemListSelect = {
    id: true,
    number: true,
    title: true,
    projectId: true,
    teamId: true,
    typeId: true,
    stateId: true,
    stateCategory: true,
    priority: true,
    /** The priority sort's cursor reads it (2.4); `toWorkItemDto` drops it. */
    priorityRank: true,
    assigneeId: true,
    waitingOnUserId: true,
    answerCommentId: true,
    createdByUserId: true,
    parentId: true,
    cycleId: true,
    milestoneId: true,
    goalId: true,
    /** The two estimate columns (3.4a); the client shows the one its team's unit counts. */
    estimatePoints: true,
    estimateMinutes: true,
    recurrenceId: true,
    occurrenceOn: true,
    recurrenceRule: { select: { id: true } },
    sortKey: true,
    startDate: true,
    dueDate: true,
    startedAt: true,
    completedAt: true,
    cancelledAt: true,
    version: true,
    createdAt: true,
    updatedAt: true,
    project: { select: { keyPrefix: true } },
    labels: { select: { labelId: true }, take: 20, orderBy: { labelId: 'asc' } },
    customFieldValues: { select: customFieldValueSelect, take: ROW_CUSTOM_VALUES_TAKE, orderBy: { id: 'asc' } },
    /**
     * The review at a glance (2.8b, `reviewSummaryOf`): the two newest rounds,
     * each with its step count and its OPEN step (at most one per round) and
     * that step's pending reviewers, counted.
     */
    reviewRounds: {
        select: {
            number: true,
            status: true,
            _count: { select: { steps: true } },
            steps: {
                where: { status: 'OPEN' },
                take: 1,
                select: { name: true, dueOn: true, _count: { select: { reviewers: { where: { outcome: null, withdrawnAt: null } } } } },
            },
        },
        orderBy: { number: 'desc' },
        take: 2,
    },
} satisfies Prisma.WorkItemSelect;

export type WorkItemListRow = Prisma.WorkItemGetPayload<{ select: typeof workItemListSelect }>;

/**
 * What the timeline reads per item (roadmap 3.1b): never a description, a
 * comment or a custom-field value (titles are plaintext, ADR 0002 §11).
 */
export const workItemTimelineSelect = {
    id: true,
    number: true,
    title: true,
    projectId: true,
    teamId: true,
    typeId: true,
    stateCategory: true,
    assigneeId: true,
    parentId: true,
    sortKey: true,
    startDate: true,
    dueDate: true,
    startedAt: true,
    completedAt: true,
    milestoneId: true,
    version: true,
    project: { select: { keyPrefix: true, name: true, dueDate: true, archivedAt: true } },
} satisfies Prisma.WorkItemSelect;

export type WorkItemTimelineRow = Prisma.WorkItemGetPayload<{ select: typeof workItemTimelineSelect }>;

/**
 * What the calendar view reads per item (roadmap 3.3a): never a description,
 * a comment or a custom-field value (titles are plaintext, ADR 0002 §11).
 */
export const workItemCalendarSelect = {
    id: true,
    number: true,
    title: true,
    projectId: true,
    teamId: true,
    typeId: true,
    stateCategory: true,
    assigneeId: true,
    parentId: true,
    cycleId: true,
    milestoneId: true,
    startDate: true,
    dueDate: true,
    version: true,
    project: { select: { keyPrefix: true, name: true, dueDate: true, archivedAt: true } },
} satisfies Prisma.WorkItemSelect;

export type WorkItemCalendarRow = Prisma.WorkItemGetPayload<{ select: typeof workItemCalendarSelect }>;

/** The fields every gated write reads first. */
export const workItemGateSelect = {
    id: true,
    number: true,
    title: true,
    projectId: true,
    teamId: true,
    typeId: true,
    stateId: true,
    stateCategory: true,
    assigneeId: true,
    waitingOnUserId: true,
    answerCommentId: true,
    parentId: true,
    cycleId: true,
    milestoneId: true,
    goalId: true,
    estimatePoints: true,
    estimateMinutes: true,
    sortKey: true,
    startedAt: true,
    startDate: true,
    dueDate: true,
    version: true,
    deletedAt: true,
    deletionId: true,
    project: { select: { keyPrefix: true, archivedAt: true, deletedAt: true } },
} satisfies Prisma.WorkItemSelect;

export type WorkItemGateRow = Prisma.WorkItemGetPayload<{ select: typeof workItemGateSelect }>;

/** A write that changes what the item shows (version increases with it). */
export type WorkItemPatch = Partial<{
    title: string;
    description: string | null;
    priority: WorkItemPriority;
    startDate: Date | null;
    dueDate: Date | null;
    typeId: string;
    assigneeId: string | null;
    waitingOnUserId: string | null;
    answerCommentId: string | null;
    stateId: string;
    stateCategory: WorkflowStateCategory;
    startedAt: Date | null;
    completedAt: Date | null;
    cancelledAt: Date | null;
    parentId: string | null;
    cycleId: string | null;
    milestoneId: string | null;
    goalId: string | null;
    estimatePoints: number | null;
    estimateMinutes: number | null;
}>;

/**
 * A custom-field condition as a relation filter over `CustomFieldValue`
 * (sub-phase 2.4). `empty` and every "not" read `none` (no value row), so a
 * negative condition includes empty values (Teable's rule, kept explicit;
 * docs/porting/oss/teable.md §5.6). Each is served by the value table's
 * `[tenantId, fieldId, <column>]` index.
 */
export function customFieldWhere(
    ctx: Pick<RequestContext, 'tenantId'>,
    field: { id: string; type: CustomFieldType },
    condition: CustomFieldCondition,
): Prisma.WorkItemWhereInput {
    const base = { tenantId: ctx.tenantId, fieldId: field.id };
    const has = (extra: Prisma.CustomFieldValueWhereInput): Prisma.WorkItemWhereInput => ({ customFieldValues: { some: { ...base, ...extra } } });
    const none: Prisma.WorkItemWhereInput = { customFieldValues: { none: base } };
    const column = CUSTOM_FIELD_TYPE_SPECS[field.type].column;
    switch (condition.op) {
        case 'empty':
            return none;
        case 'set':
            return has({});
        case 'is':
            return condition.checked ? has({}) : none;
        case 'any': {
            const or: Prisma.WorkItemWhereInput[] = [];
            if (condition.ids.length) or.push(has({ [column]: { in: condition.ids } }));
            if (condition.orEmpty) or.push(none);
            return { OR: or };
        }
        default:
            break;
    }
    if ('number' in condition) {
        return has({ numberValue: condition.op === 'eq' ? condition.number : { [condition.op]: condition.number } });
    }
    if ('date' in condition) {
        const d = new Date(`${condition.date}T00:00:00.000Z`);
        const ops = { eq: 'equals', before: 'lt', after: 'gt', onOrBefore: 'lte', onOrAfter: 'gte' } as const;
        return has({ dateValue: { [ops[condition.op]]: d } });
    }
    return has({ textValue: condition.op === 'contains' ? { contains: condition.text, mode: 'insensitive' } : condition.text });
}

/** One row of `WorkItemRepository.ancestry`: a level of an item's ancestry. */
/** One group of the roadmap's aggregate (`roadmapAggregate`, 3.2c). */
export interface RoadmapAggregateRow {
    /** `p`: the project path (per project, milestone, category); `g`: the direct path (per goal, project, team, category). */
    path: 'p' | 'g';
    projectId: string;
    goalId: string | null;
    milestoneId: string | null;
    teamId: string | null;
    stateCategory: WorkflowStateCategory;
    count: number;
    minStart: Date | null;
    minDueOnly: Date | null;
    maxDue: Date | null;
    maxStartOnly: Date | null;
}

export interface AncestryRow {
    kind: 'item' | 'project' | 'initiative' | 'goal' | 'direct_goal';
    id: string;
    /** 0 for the item, its project, its initiative and the nearest goal of each chain; up from there. */
    depth: number;
    label: string;
    /** An item's number. */
    num: number | null;
    /** A project's key prefix, or a goal's or an initiative's status. */
    code: string | null;
    archived: boolean;
}

/** ADR 0002 §2's caps: five levels of sub-items above the item, three of goals. */
export const ANCESTRY_ITEM_DEPTH = 5;
export const ANCESTRY_GOAL_DEPTH = 2;

export class WorkItemRepository {
    /**
     * The `where` of a list read. `deletedAt: null` is explicit, and the
     * visibility fragment is ANDed so a filter can never overwrite it.
     */
    static _buildWhere(
        ctx: RequestContext,
        v: ProjectVisibility,
        filters: WorkItemFilters = {},
        keyHit: KeyHit | null = null,
        today: Date = new Date(),
    ): Prisma.WorkItemWhereInput {
        const and: Prisma.WorkItemWhereInput[] = [projectVisibilityWhere(v, { includeArchived: filters.includeArchived })];
        const where: Prisma.WorkItemWhereInput = { tenantId: ctx.tenantId, deletedAt: null };

        if (filters.projectId) and.push({ projectId: parseIdListFilter(filters.projectId) });
        if (filters.teamId) and.push({ teamId: parseIdListFilter(filters.teamId) });
        if (filters.typeId) and.push({ typeId: parseIdListFilter(filters.typeId) });
        if (filters.stateId) and.push({ stateId: parseIdListFilter(filters.stateId) });
        const category = parseListFilter<WorkflowStateCategory>(filters.stateCategory, WORKFLOW_STATE_CATEGORIES, 'state category');
        if (category) and.push({ stateCategory: category });
        const priority = parseListFilter<WorkItemPriority>(filters.priority, PRIORITIES, 'priority');
        if (priority) and.push({ priority });
        if (filters.labelId) {
            const labelIds = parseIdListFilter(filters.labelId);
            and.push({ labels: { some: { labelId: labelIds } } });
        }
        if (filters.parentId === 'none') and.push({ parentId: null });
        else if (filters.parentId) and.push({ parentId: parseIdListFilter(filters.parentId) });
        if (filters.assigneeId === 'none') and.push({ assigneeId: null });
        else if (filters.assigneeId) and.push({ assigneeId: parseIdListFilter(filters.assigneeId) });
        if (filters.createdById) and.push({ createdByUserId: parseIdListFilter(filters.createdById) });
        if (filters.waitingOnId) {
            // `me` is the caller, read from the request context (My Work's "Waiting on me", 2.7a),
            // as `watching=me` is: the client never has to send its own id.
            const members = [
                ...new Set(
                    filters.waitingOnId
                        .split(',')
                        .map((m) => m.trim())
                        .filter(Boolean)
                        .map((m) => (m === 'me' ? ctx.userId : m)),
                ),
            ];
            const ids = members.filter((m) => m !== 'none');
            const none = members.length !== ids.length;
            if (none && ids.length > 0) and.push({ OR: [{ waitingOnUserId: null }, { waitingOnUserId: { in: ids } }] });
            else if (none) and.push({ waitingOnUserId: null });
            else and.push({ waitingOnUserId: { in: ids } });
        }
        if (filters.cycleId !== undefined) {
            const members = [...new Set(filters.cycleId.split(',').map((m) => m.trim()).filter(Boolean))];
            const ids = members.filter((m) => m !== 'none');
            const none = members.length !== ids.length;
            // An empty list (no current cycle) matches nothing rather than everything.
            if (none && ids.length > 0) and.push({ OR: [{ cycleId: null }, { cycleId: { in: ids } }] });
            else if (none) and.push({ cycleId: null });
            else and.push({ cycleId: { in: ids } });
        }
        if (filters.milestoneId) {
            const members = [...new Set(filters.milestoneId.split(',').map((m) => m.trim()).filter(Boolean))];
            const ids = members.filter((m) => m !== 'none');
            const none = members.length !== ids.length;
            if (none && ids.length > 0) and.push({ OR: [{ milestoneId: null }, { milestoneId: { in: ids } }] });
            else if (none) and.push({ milestoneId: null });
            else and.push({ milestoneId: { in: ids } });
        }
        // Goals and initiatives (3.2a): only their resolved forms are read.
        if ((filters.goalId && !filters.goalScope) || (filters.initiativeId && !filters.initiativeProjectIds)) {
            throw new Error('The goalId and initiativeId filters are resolved by the list usecase before the where is built.');
        }
        if (filters.initiativeProjectIds) and.push({ projectId: { in: [...filters.initiativeProjectIds] } });
        if (filters.goalScope) {
            and.push({ OR: [{ projectId: { in: [...filters.goalScope.projectIds] } }, { goalId: { in: [...filters.goalScope.goalIds] } }] });
        }
        if (filters.reviewerId) {
            const people = [
                ...new Set(
                    filters.reviewerId
                        .split(',')
                        .map((m) => m.trim())
                        .filter(Boolean)
                        .map((m) => (m === 'me' ? ctx.userId : m)),
                ),
            ];
            // An OPEN step is only ever in an OPEN round (the engine ends steps before rounds).
            and.push({ reviewers: { some: { tenantId: ctx.tenantId, userId: { in: people }, outcome: null, withdrawnAt: null, step: { status: 'OPEN' } } } });
        }
        if (filters.watching !== undefined) {
            if (filters.watching !== 'me') throw badRequest('Invalid watching filter. Must be: me.');
            and.push({ watchers: { some: { tenantId: ctx.tenantId, userId: ctx.userId } } });
        }

        if (filters.due) {
            const day = utcDay(today);
            if (filters.due === 'overdue') {
                and.push({ dueDate: { lt: day }, stateCategory: OPEN_CATEGORY_FILTER });
            } else if (filters.due === 'next7d') {
                and.push({ dueDate: { gte: day, lte: new Date(day.getTime() + 7 * 86_400_000) }, stateCategory: OPEN_CATEGORY_FILTER });
            } else if (filters.due === 'soon') {
                and.push({ dueDate: { lte: new Date(day.getTime() + DUE_SOON_DAYS * 86_400_000) }, stateCategory: OPEN_CATEGORY_FILTER });
            } else {
                throw badRequest(`Invalid due filter. Must be one of: ${DUE_FILTERS.join(', ')}.`);
            }
        }

        for (const { field, condition } of filters.customFields ?? []) and.push(customFieldWhere(ctx, field, condition));

        if (filters.q) {
            // The title substring (2.7b, docs/search.md, "The list's q filter"):
            // the ids `search_work_item_title_substring` found on the trigram
            // index when the usecase resolved them (decision 245), else
            // `title ILIKE '%q%'` here, which under row-level security is a
            // filter: cheap when `q` is broad (a page of matches is found
            // quickly in the list's own order), and correct for any caller.
            // Prisma passes `contains` into the pattern unescaped, so a typed
            // `%` or `_` was a wildcard; `escapeLike` makes it match itself.
            const or: Prisma.WorkItemWhereInput[] = filters.titleSubstringMatchIds
                ? [{ id: { in: [...filters.titleSubstringMatchIds] } }]
                : [{ title: { contains: escapeLike(filters.q), mode: 'insensitive' } }];
            if (keyHit) or.push({ projectId: keyHit.projectId, number: keyHit.number });
            // Full text (2.7f): stemmed titles, descriptions and comments, the
            // matched ids already filtered by the same visibility and liveness.
            if (filters.fullTextMatchIds && filters.fullTextMatchIds.length > 0) or.push({ id: { in: [...filters.fullTextMatchIds] } });
            and.push({ OR: or });
        }

        where.AND = and;
        return where;
    }

    /** One page of the live list; returns `limit + 1` rows for `computeSortPage`. */
    static async list(
        db: PrismaTx,
        ctx: RequestContext,
        v: ProjectVisibility,
        filters: WorkItemFilters,
        page: { limit: number; sort: SortSpec; cursor?: SortCursor; keyHit?: KeyHit | null; today?: Date },
    ): Promise<WorkItemListRow[]> {
        const where = WorkItemRepository._buildWhere(ctx, v, filters, page.keyHit ?? null, page.today);
        if (page.cursor) (where.AND as Prisma.WorkItemWhereInput[]).push(buildSortWhere(page.sort, page.cursor) as Prisma.WorkItemWhereInput);
        return db.workItem.findMany({
            where,
            orderBy: sortOrderBy(page.sort) as Prisma.WorkItemOrderByWithRelationInput[],
            take: page.limit + 1,
            select: workItemListSelect,
        });
    }

    /**
     * The timeline's scope (roadmap 3.1b): the list's own `where`, so a
     * timeline and a list with the same filters hold the same items, in
     * manual order, at most `take` rows (the caller asks one past its limit
     * to know it is over it, never to cut).
     */
    static async listForTimeline(
        db: PrismaTx,
        ctx: RequestContext,
        v: ProjectVisibility,
        filters: WorkItemFilters,
        page: { take: number; keyHit?: KeyHit | null; today?: Date },
    ): Promise<WorkItemTimelineRow[]> {
        return db.workItem.findMany({
            where: WorkItemRepository._buildWhere(ctx, v, filters, page.keyHit ?? null, page.today),
            orderBy: [{ sortKey: 'asc' }, { id: 'asc' }],
            take: page.take,
            select: workItemTimelineSelect,
        });
    }

    /** How many items the list's `where` holds: the count a too-large timeline answers with. */
    static async countForTimeline(
        db: PrismaTx,
        ctx: RequestContext,
        v: ProjectVisibility,
        filters: WorkItemFilters,
        page: { keyHit?: KeyHit | null; today?: Date },
    ): Promise<number> {
        return db.workItem.count({ where: WorkItemRepository._buildWhere(ctx, v, filters, page.keyHit ?? null, page.today) });
    }

    /**
     * The timeline's context rows (3.1b): live items among `ids` in a project
     * the caller sees (archived ones included, shown read-only), in id order,
     * at most `take`.
     */
    static async timelineContextRows(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, ids: readonly string[], take: number): Promise<WorkItemTimelineRow[]> {
        if (ids.length === 0 || take <= 0) return [];
        return db.workItem.findMany({
            where: { tenantId: ctx.tenantId, id: { in: [...ids] }, deletedAt: null, AND: [projectVisibilityWhere(v, { includeArchived: true })] },
            orderBy: { id: 'asc' },
            take,
            select: workItemTimelineSelect,
        });
    }

    /** The list's `where` with one more condition (the calendar's window, its undated items). */
    private static _withCondition(base: Prisma.WorkItemWhereInput, extra: Prisma.WorkItemWhereInput): Prisma.WorkItemWhereInput {
        const and = base.AND === undefined ? [] : Array.isArray(base.AND) ? base.AND : [base.AND];
        return { ...base, AND: [...and, extra] };
    }

    /**
     * The calendar's items (3.3a): the list's `where` and a due date in
     * `[from, to]` (both date-only, inclusive), by due date, then manual
     * order, at most `take` (the caller reads one past its limit).
     */
    static async listForCalendar(
        db: PrismaTx,
        ctx: RequestContext,
        v: ProjectVisibility,
        filters: WorkItemFilters,
        page: { from: Date; to: Date; take: number; keyHit?: KeyHit | null; today?: Date },
    ): Promise<WorkItemCalendarRow[]> {
        return db.workItem.findMany({
            where: WorkItemRepository._withCondition(WorkItemRepository._buildWhere(ctx, v, filters, page.keyHit ?? null, page.today), { dueDate: { gte: page.from, lte: page.to } }),
            orderBy: [{ dueDate: 'asc' }, { sortKey: 'asc' }, { id: 'asc' }],
            take: page.take,
            select: workItemCalendarSelect,
        });
    }

    /**
     * A member's open items assigned to them with a due date in `[from, to]`,
     * in live, visible, unarchived projects (calendar sync, roadmap 3.3b,
     * decision 226): the desired set of their calendar. Earliest due first,
     * then id; at most `take`. Title, key and due date only: nothing else of
     * an item leaves (decision 229).
     */
    static async listAssignedForCalendarSync(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, userId: string, page: { from: Date; to: Date; take: number }) {
        return db.workItem.findMany({
            where: {
                tenantId: ctx.tenantId,
                assigneeId: userId,
                deletedAt: null,
                stateCategory: OPEN_CATEGORY_FILTER,
                dueDate: { gte: page.from, lte: page.to },
                AND: [projectVisibilityWhere(v)],
            },
            orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
            take: page.take,
            select: { id: true, title: true, number: true, dueDate: true, project: { select: { keyPrefix: true } } },
        });
    }

    /** How many items {@link listAssignedForCalendarSync} would hold without its bound: "1,000 of 1,240". */
    static async countAssignedForCalendarSync(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, userId: string, page: { from: Date; to: Date }): Promise<number> {
        return db.workItem.count({
            where: {
                tenantId: ctx.tenantId,
                assigneeId: userId,
                deletedAt: null,
                stateCategory: OPEN_CATEGORY_FILTER,
                dueDate: { gte: page.from, lte: page.to },
                AND: [projectVisibilityWhere(v)],
            },
        });
    }

    /**
     * The live, visible, unarchived projects in which a member has at least
     * one open item assigned to them, dated or not (calendar sync, decision
     * 227: whose milestones reach their calendar). At most `take`.
     */
    static async projectsWithOpenAssigned(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, userId: string, take: number): Promise<string[]> {
        const rows = await db.workItem.groupBy({
            by: ['projectId'],
            where: {
                tenantId: ctx.tenantId,
                assigneeId: userId,
                deletedAt: null,
                stateCategory: OPEN_CATEGORY_FILTER,
                AND: [projectVisibilityWhere(v)],
            },
            orderBy: { projectId: 'asc' },
            take,
        });
        return rows.map((r) => r.projectId);
    }

    /** How many items the calendar's window holds: the count a too-large calendar answers with. */
    static async countForCalendar(
        db: PrismaTx,
        ctx: RequestContext,
        v: ProjectVisibility,
        filters: WorkItemFilters,
        page: { from: Date; to: Date; keyHit?: KeyHit | null; today?: Date },
    ): Promise<number> {
        return db.workItem.count({
            where: WorkItemRepository._withCondition(WorkItemRepository._buildWhere(ctx, v, filters, page.keyHit ?? null, page.today), { dueDate: { gte: page.from, lte: page.to } }),
        });
    }

    /** The scope's items with no due date (3.3a): counted on the calendar's summary line, never drawn. */
    static async countWithoutDueDate(
        db: PrismaTx,
        ctx: RequestContext,
        v: ProjectVisibility,
        filters: WorkItemFilters,
        page: { keyHit?: KeyHit | null; today?: Date },
    ): Promise<number> {
        return db.workItem.count({
            where: WorkItemRepository._withCondition(WorkItemRepository._buildWhere(ctx, v, filters, page.keyHit ?? null, page.today), { dueDate: null }),
        });
    }

    /**
     * One page of the live list sorted by a custom field (sub-phase 2.4):
     * phase 0 reads the field's VALUE rows in value order (a select by its
     * option's order), the items' filters applied as a relation filter;
     * when it runs out, phase 1 reads the items with NO value, by id. Empty
     * values come last in both directions. The cursor is
     * `{ v: [phase, value], id }`, where `id` is the value row's in phase 0
     * and the item's in phase 1. The rows are then read once by id and put
     * in order: three bounded reads, none in a loop. Returns at most
     * `limit + 1` rows, and the cursor of the row at `limit` when there is
     * one more.
     */
    static async listByCustomField(
        db: PrismaTx,
        ctx: RequestContext,
        v: ProjectVisibility,
        filters: WorkItemFilters,
        page: {
            limit: number;
            field: { id: string; type: CustomFieldType };
            direction: SortDirection;
            cursor?: SortCursor;
            keyHit?: KeyHit | null;
            today?: Date;
        },
    ): Promise<{ rows: WorkItemListRow[]; next: SortCursor | null }> {
        const itemWhere = WorkItemRepository._buildWhere(ctx, v, filters, page.keyHit ?? null, page.today);
        const spec = customFieldValueSortSpec(page.field.type, page.direction);
        const phase = page.cursor ? page.cursor.v[0] : 0;
        const want = page.limit + 1;
        const picked: Array<{ itemId: string; cursor: SortCursor }> = [];

        if (phase === 0) {
            const where: Prisma.CustomFieldValueWhereInput = {
                tenantId: ctx.tenantId,
                fieldId: page.field.id,
                workItem: itemWhere,
                AND: page.cursor ? [buildSortWhere(spec, { v: page.cursor.v.slice(1, 1 + spec.columns.length), id: page.cursor.id }) as Prisma.CustomFieldValueWhereInput] : [],
            };
            const values = await db.customFieldValue.findMany({
                where,
                orderBy: sortOrderBy(spec) as Prisma.CustomFieldValueOrderByWithRelationInput[],
                take: want,
                select: { id: true, workItemId: true, fieldType: true, textValue: true, numberValue: true, dateValue: true, option: { select: { sortKey: true } } },
            });
            for (const row of values) {
                picked.push({ itemId: row.workItemId, cursor: { v: [0, ...sortValuesOf(spec, row)], id: row.id } });
            }
        }
        if (picked.length < want) {
            const idOp = page.direction === 'asc' ? 'gt' : 'lt';
            const empties = await db.workItem.findMany({
                where: {
                    ...itemWhere,
                    AND: [
                        ...(itemWhere.AND as Prisma.WorkItemWhereInput[]),
                        { customFieldValues: { none: { tenantId: ctx.tenantId, fieldId: page.field.id } } },
                        ...(phase === 1 && page.cursor ? [{ id: idOp === 'gt' ? { gt: page.cursor.id } : { lt: page.cursor.id } }] : []),
                    ],
                },
                orderBy: [{ id: page.direction }],
                take: want - picked.length,
                select: { id: true },
            });
            for (const row of empties) picked.push({ itemId: row.id, cursor: { v: [1, null], id: row.id } });
        }

        const kept = picked.slice(0, want);
        const ids = kept.map((p) => p.itemId);
        const rows = ids.length
            ? await db.workItem.findMany({
                  where: { tenantId: ctx.tenantId, id: { in: ids }, deletedAt: null, AND: [projectVisibilityWhere(v, { includeArchived: true })] },
                  take: ids.length,
                  select: workItemListSelect,
              })
            : [];
        const byId = new Map(rows.map((r) => [r.id, r]));
        const ordered = ids.map((id) => byId.get(id)).filter((r): r is WorkItemListRow => r !== undefined);
        const next = kept.length > page.limit ? kept[page.limit - 1]!.cursor : null;
        return { rows: ordered, next };
    }

    /**
     * The Deleted view: the most recently deleted visible items, one past the
     * cap so truncation is a fact the caller holds. An item deleted in a
     * deleted project stays hidden with its project.
     */
    static async listDeleted(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, cap: number = WORK_ITEM_DELETED_LIST_CAP) {
        return db.workItem.findMany({
            where: {
                tenantId: ctx.tenantId,
                deletedAt: { not: null },
                AND: [projectVisibilityWhere(v, { includeArchived: true })],
            },
            orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
            take: cap + 1,
            select: { ...workItemListSelect, deletedAt: true, deletedByUserId: true, deletionId: true },
        });
    }

    /** The detail read: the item, its state, type, project, labels and parent, bounded. */
    static async getById(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, id: string) {
        return db.workItem.findFirst({
            where: { id, tenantId: ctx.tenantId, deletedAt: null, AND: [projectVisibilityWhere(v, { includeArchived: true })] },
            select: {
                ...workItemListSelect,
                description: true,
                createdByUserId: true,
                project: { select: { id: true, name: true, keyPrefix: true, archivedAt: true } },
                state: { select: { id: true, name: true, category: true } },
                type: { select: { id: true, name: true, icon: true, color: true } },
                parent: {
                    select: { id: true, number: true, title: true, deletedAt: true, project: { select: { keyPrefix: true } } },
                },
                labels: {
                    select: { labelId: true, label: { select: { id: true, name: true, color: true } } },
                    take: DETAIL_RELATION_TAKE,
                    orderBy: { labelId: 'asc' },
                },
                // Nested reads ignore soft delete unless told (inflect #5305):
                // each says `deletedAt: null` itself.
                _count: {
                    select: {
                        subItems: { where: { deletedAt: null } },
                        comments: { where: { deletedAt: null } },
                        watchers: true,
                    },
                },
            },
        });
    }

    /**
     * The gate every write reads first: the live, visible item. Archived
     * projects' items are returned so the caller can refuse them with
     * `PROJECT_ARCHIVED` rather than a 404.
     */
    static async findVisible(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, id: string): Promise<WorkItemGateRow | null> {
        return db.workItem.findFirst({
            where: { id, tenantId: ctx.tenantId, deletedAt: null, AND: [projectVisibilityWhere(v, { includeArchived: true })] },
            select: workItemGateSelect,
        });
    }

    /**
     * A DELETED item whatever its project's state, for restore, which must
     * tell "the project is deleted" (409) from "no such item" (404). A guest
     * still reaches only granted projects.
     */
    static async findDeletedForRestore(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, id: string): Promise<WorkItemGateRow | null> {
        return db.workItem.findFirst({
            where: {
                id,
                tenantId: ctx.tenantId,
                deletedAt: { not: null },
                ...(v.kind === 'GRANTED' ? { projectId: { in: [...v.projectIds] } } : {}),
            },
            select: workItemGateSelect,
        });
    }

    // ── Row locks for multi-item writes (decision 173; `work-item-locks.ts`) ──

    /**
     * Lock the rows of `ids` that exist in the workspace, deleted or not,
     * `FOR UPDATE` in id order, in ONE statement, so every multi-item writer
     * takes overlapping rows in the same order. Call it before reading the
     * rows a write plans from; the read after it sees the latest committed
     * values. Visibility and `deletedAt` are the read's and the write's to
     * apply: locking a row the caller then leaves alone costs nothing.
     */
    /**
     * Read a new item's parent `FOR KEY SHARE` before the create names any
     * person (issue #113): the insert's own key check would take the same
     * lock later, after the people's memberships, and a member's removal
     * holding the parent while it waits on one of those memberships would be
     * a deadlock. Taken after the project's sequence row, the order across
     * kinds.
     */
    static async lockParentForKeyShare(db: PrismaTx, ctx: RequestContext, id: string): Promise<void> {
        await db.$queryRaw`SELECT "id" FROM "WorkItem" WHERE "tenantId" = ${ctx.tenantId} AND "id" = ${id} FOR KEY SHARE`;
    }

    static async lockForWrite(db: PrismaTx, ctx: RequestContext, ids: readonly string[]): Promise<LockedWorkItemIds> {
        const unique = [...new Set(ids)];
        if (unique.length === 0) return mintLockedWorkItemIds([]);
        const rows = await db.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "WorkItem"
             WHERE "tenantId" = ${ctx.tenantId} AND "id" = ANY(${unique}::text[])
             ORDER BY "id"
               FOR UPDATE`;
        return mintLockedWorkItemIds(rows.map((r) => r.id));
    }

    /**
     * Lock every row a member's removal writes (ADR 0003 §1, 2.4, 2.4b, 2.8a),
     * deleted rows included, in id order and one statement: items assigned
     * to them, waiting on them or holding a person value naming them, and
     * `alsoIds`: the items their pending reviewer rows are on, which the caller
     * reads through `ReviewRepository` (the reviewer table's one seam).
     *
     * The candidates are a UNION of one indexed read per reason, never one
     * `OR` over the table: an `OR` across columns could use no index and read
     * every item of the workspace (Hardening H2a, docs/performance.md,
     * "Findings"); each branch is served by its own tenant-leading index.
     */
    static async lockItemsOfPerson(db: PrismaTx, ctx: RequestContext, userId: string, alsoIds: readonly string[]): Promise<LockedWorkItemIds> {
        const rows = await db.$queryRaw<Array<{ id: string }>>`
            SELECT w."id" FROM "WorkItem" w
             WHERE w."tenantId" = ${ctx.tenantId}
               AND w."id" IN (
                   SELECT a."id" FROM "WorkItem" a WHERE a."tenantId" = ${ctx.tenantId} AND a."assigneeId" = ${userId}
                   UNION
                   SELECT b."id" FROM "WorkItem" b WHERE b."tenantId" = ${ctx.tenantId} AND b."waitingOnUserId" = ${userId}
                   UNION
                   SELECT v."workItemId" FROM "CustomFieldValue" v WHERE v."tenantId" = ${ctx.tenantId} AND v."userId" = ${userId}
                   UNION
                   SELECT unnest(${[...new Set(alsoIds)]}::text[]))
             ORDER BY w."id"
               FOR UPDATE OF w`;
        return mintLockedWorkItemIds(rows.map((r) => r.id));
    }

    /** Lock every row in a workflow state, deleted rows included (a state's delete moves them all). */
    static async lockInState(db: PrismaTx, ctx: RequestContext, stateId: string): Promise<LockedWorkItemIds> {
        const rows = await db.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "WorkItem"
             WHERE "tenantId" = ${ctx.tenantId} AND "stateId" = ${stateId}
             ORDER BY "id"
               FOR UPDATE`;
        return mintLockedWorkItemIds(rows.map((r) => r.id));
    }

    /**
     * Lock a purge batch and every row still pointing at one of its items as
     * a parent (the purge detaches those first), in id order and one statement.
     */
    static async lockPurgeBatch(db: PrismaTx, ctx: RequestContext, ids: readonly string[]): Promise<LockedWorkItemIds> {
        const unique = [...new Set(ids)];
        if (unique.length === 0) return mintLockedWorkItemIds([]);
        const rows = await db.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "WorkItem"
             WHERE "tenantId" = ${ctx.tenantId}
               AND ("id" = ANY(${unique}::text[]) OR "parentId" = ANY(${unique}::text[]))
             ORDER BY "id"
               FOR UPDATE`;
        return mintLockedWorkItemIds(rows.map((r) => r.id));
    }

    /** The visible live items among `ids` (the bulk verbs act only on these). */
    static async listByIds(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, ids: readonly string[]) {
        return db.workItem.findMany({
            where: { tenantId: ctx.tenantId, id: { in: [...ids] }, deletedAt: null, AND: [projectVisibilityWhere(v, { includeArchived: true })] },
            take: ids.length,
            select: { ...workItemGateSelect, type: { select: { name: true } } },
        });
    }

    /** The last `sortKey` among a project's live items, for an append. */
    static async lastSortKey(db: PrismaTx, ctx: RequestContext, projectId: string): Promise<string | null> {
        const last = await db.workItem.findFirst({
            where: { tenantId: ctx.tenantId, projectId, deletedAt: null },
            orderBy: [{ sortKey: 'desc' }, { id: 'desc' }],
            select: { sortKey: true },
        });
        return last?.sortKey ?? null;
    }

    /**
     * Of `sortKeys`, the ones a live item of the project holds (issue #110: a
     * restored row whose kept key a placement minted again while it was
     * deleted). Read under the project's sequence row.
     */
    static async liveSortKeysAmong(db: PrismaTx, ctx: RequestContext, projectId: string, sortKeys: readonly string[]): Promise<Set<string>> {
        const keys = [...new Set(sortKeys)];
        if (keys.length === 0) return new Set();
        const rows = await db.workItem.findMany({
            where: { tenantId: ctx.tenantId, projectId, deletedAt: null, sortKey: { in: keys } },
            distinct: ['sortKey'],
            take: keys.length,
            select: { sortKey: true },
        });
        return new Set(rows.map((r) => r.sortKey));
    }

    /** The sort keys of the given live items of one project (reorder neighbours). */
    static async sortKeysOf(db: PrismaTx, ctx: RequestContext, projectId: string, ids: readonly string[]) {
        return db.workItem.findMany({
            where: { tenantId: ctx.tenantId, projectId, deletedAt: null, id: { in: [...ids] } },
            take: ids.length,
            select: { id: true, sortKey: true },
        });
    }

    /** The live item placed right after `sortKey` in its project, for "after X". */
    static async nextSortKeyAfter(
        db: PrismaTx,
        ctx: RequestContext,
        projectId: string,
        after: { sortKey: string; id: string },
        exceptId?: string,
    ) {
        return db.workItem.findFirst({
            where: {
                tenantId: ctx.tenantId,
                projectId,
                deletedAt: null,
                ...(exceptId ? { NOT: { id: exceptId } } : {}),
                OR: [{ sortKey: { gt: after.sortKey } }, { sortKey: after.sortKey, id: { gt: after.id } }],
            },
            orderBy: [{ sortKey: 'asc' }, { id: 'asc' }],
            select: { id: true, sortKey: true },
        });
    }

    /** The live item placed right before `sortKey`, for "before Y". */
    static async prevSortKeyBefore(
        db: PrismaTx,
        ctx: RequestContext,
        projectId: string,
        before: { sortKey: string; id: string },
        exceptId?: string,
    ) {
        return db.workItem.findFirst({
            where: {
                tenantId: ctx.tenantId,
                projectId,
                deletedAt: null,
                ...(exceptId ? { NOT: { id: exceptId } } : {}),
                OR: [{ sortKey: { lt: before.sortKey } }, { sortKey: before.sortKey, id: { lt: before.id } }],
            },
            orderBy: [{ sortKey: 'desc' }, { id: 'desc' }],
            select: { id: true, sortKey: true },
        });
    }

    static async create(
        db: PrismaTx,
        ctx: RequestContext,
        data: {
            projectId: string;
            teamId: string;
            number: number;
            typeId: string;
            title: string;
            description: string | null;
            stateId: string;
            stateCategory: WorkflowStateCategory;
            priority: WorkItemPriority;
            assigneeId: string | null;
            waitingOnUserId?: string | null;
            parentId: string | null;
            cycleId?: string | null;
            milestoneId?: string | null;
            goalId?: string | null;
            estimatePoints?: number | null;
            estimateMinutes?: number | null;
            recurrenceId?: string | null;
            occurrenceOn?: Date | null;
            sortKey: string;
            startDate: Date | null;
            dueDate: Date | null;
            startedAt: Date | null;
            completedAt: Date | null;
            cancelledAt: Date | null;
        },
    ) {
        return db.workItem.create({
            data: { tenantId: ctx.tenantId, createdByUserId: ctx.userId, ...data },
            select: workItemListSelect,
        });
    }

    /**
     * The versioned write (ADR 0002 §9): ONE `updateMany` whose `WHERE` carries
     * the live, visible, writable item and, when given, the expected version.
     * `count === 0` is answered by the caller with a re-read (404 versus 409).
     * Every such write increases `version`.
     */
    static async updateVersioned(
        db: PrismaTx,
        ctx: RequestContext,
        v: ProjectVisibility,
        id: string,
        expectedVersion: number | undefined,
        patch: WorkItemPatch,
    ): Promise<number> {
        const result = await db.workItem.updateMany({
            where: {
                id,
                tenantId: ctx.tenantId,
                deletedAt: null,
                ...(expectedVersion !== undefined ? { version: expectedVersion } : {}),
                AND: [projectVisibilityWhere(v)],
            },
            data: { ...patch, version: { increment: 1 } },
        });
        return result.count;
    }

    /** Bump the version alone of one item (a label attached or detached, ADR 0002 §9). */
    static async bumpVersionOf(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, id: string) {
        const result = await db.workItem.updateMany({
            where: { id, tenantId: ctx.tenantId, AND: [projectVisibilityWhere(v, { includeArchived: true })] },
            data: { version: { increment: 1 } },
        });
        return result.count;
    }

    /** Bump the version alone of many locked items (a label deleted, a person value cleared). */
    static async bumpVersion(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, ids: LockedWorkItemIds) {
        if (ids.length === 0) return 0;
        const result = await db.workItem.updateMany({
            where: { id: { in: [...ids] }, tenantId: ctx.tenantId, AND: [projectVisibilityWhere(v, { includeArchived: true })] },
            data: { version: { increment: 1 } },
        });
        return result.count;
    }

    /**
     * A change of dates across several locked items (roadmap 3.1c, decision
     * 194, `rescheduleWorkItems`): each row gets its own start and due date
     * and its version increases once. Every row must be one the caller locked
     * ({@link lockForWrite}, decision 173) and still at the version it read,
     * so the count answers whether every write landed. `sortKey` is never
     * touched.
     */
    static async setDatesOfLocked(
        db: PrismaTx,
        ctx: RequestContext,
        v: ProjectVisibility,
        locked: LockedWorkItemIds,
        changes: ReadonlyArray<{ id: string; version: number; startDate: Date | null; dueDate: Date | null }>,
    ): Promise<number> {
        if (!changes.every((c) => isLocked(locked, c.id))) throw new Error('setDatesOfLocked: a row is not locked');
        let count = 0;
        for (const c of changes) {
            const result = await db.workItem.updateMany({
                where: { id: c.id, tenantId: ctx.tenantId, deletedAt: null, version: c.version, AND: [projectVisibilityWhere(v)] },
                data: { startDate: c.startDate, dueDate: c.dueDate, version: { increment: 1 } },
            });
            count += result.count;
        }
        return count;
    }

    /** A `sortKey` write: no version bump (ADR 0002 §5). */
    static async setSortKey(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, id: string, sortKey: string) {
        const result = await db.workItem.updateMany({
            where: { id, tenantId: ctx.tenantId, deletedAt: null, AND: [projectVisibilityWhere(v)] },
            data: { sortKey },
        });
        return result.count;
    }

    /**
     * A bulk single-field write over rows the caller locked first
     * ({@link lockForWrite}, decision 173). `deletedAt: null` and visibility
     * are in the write as well as in `listByIds`.
     */
    static async bulkUpdate(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, ids: LockedWorkItemIds, patch: WorkItemPatch) {
        if (ids.length === 0) return 0;
        const result = await db.workItem.updateMany({
            where: { id: { in: [...ids] }, tenantId: ctx.tenantId, deletedAt: null, AND: [projectVisibilityWhere(v)] },
            data: { ...patch, version: { increment: 1 } },
        });
        return result.count;
    }

    // ── The tree ─────────────────────────────────────────────────────

    /**
     * The ids of `rootIds` and every LIVE descendant, with each row's depth
     * below its root (0 for the roots). A recursive `UNION` over `parentId`.
     */
    static async liveSubtree(db: PrismaTx, ctx: RequestContext, rootIds: readonly string[]) {
        if (rootIds.length === 0) return [] as Array<{ id: string; depth: number }>;
        return db.$queryRaw<Array<{ id: string; depth: number }>>`
            WITH RECURSIVE sub AS (
                SELECT "id", 0 AS depth FROM "WorkItem"
                 WHERE "tenantId" = ${ctx.tenantId} AND "id" = ANY(${[...rootIds]}::text[]) AND "deletedAt" IS NULL
                UNION
                SELECT w."id", sub.depth + 1 FROM "WorkItem" w
                  JOIN sub ON w."parentId" = sub."id"
                 WHERE w."tenantId" = ${ctx.tenantId} AND w."deletedAt" IS NULL
            )
            SELECT "id", depth::int AS depth FROM sub`;
    }

    /**
     * The height of the subtree under `id`, deleted rows included (0 for a
     * leaf). Deleted rows count so a later restore cannot exceed the cap.
     */
    static async subtreeHeight(db: PrismaTx, ctx: RequestContext, id: string): Promise<number> {
        const rows = await db.$queryRaw<Array<{ height: number | null }>>`
            WITH RECURSIVE sub AS (
                SELECT "id", 0 AS depth FROM "WorkItem" WHERE "tenantId" = ${ctx.tenantId} AND "id" = ${id}
                UNION
                SELECT w."id", sub.depth + 1 FROM "WorkItem" w
                  JOIN sub ON w."parentId" = sub."id"
                 WHERE w."tenantId" = ${ctx.tenantId}
            )
            SELECT MAX(depth)::int AS height FROM sub`;
        return rows[0]?.height ?? 0;
    }

    /**
     * The ancestors of `id` (nearest first), deleted rows included. Its length
     * is the item's depth; containing a node means that node is an ancestor.
     */
    static async ancestors(db: PrismaTx, ctx: RequestContext, id: string): Promise<string[]> {
        const rows = await db.$queryRaw<Array<{ id: string; d: number }>>`
            WITH RECURSIVE anc AS (
                SELECT "parentId" AS id, 1 AS d FROM "WorkItem"
                 WHERE "tenantId" = ${ctx.tenantId} AND "id" = ${id} AND "parentId" IS NOT NULL
                UNION
                SELECT w."parentId", anc.d + 1 FROM "WorkItem" w
                  JOIN anc ON w."id" = anc.id
                 WHERE w."tenantId" = ${ctx.tenantId} AND w."parentId" IS NOT NULL AND anc.d < 64
            )
            SELECT id, d::int AS d FROM anc ORDER BY d`;
        return rows.map((r) => r.id);
    }

    /**
     * An item's ancestry in ONE statement (3.2a; docs/porting/maps/3.2.md,
     * "The ancestry query"; decisions 211 and 220): up `parentId` (at most 5
     * levels), the project, its live initiative and up that initiative's goal
     * (at most 3), and from the item's OWN `goalId` up again (at most 3; a
     * parent's direct goal is not the sub-item's). Each term is depth-capped
     * and path-guarded (Paperclip's shape, pattern only), and carries
     * `tenantId` and `deletedAt` (the item's, each parent's, each goal's and
     * the initiative's) and the caller's project visibility in its own
     * `WHERE`. Never a description. Empty when the item is missing, deleted or
     * invisible.
     */
    static async ancestry(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, id: string): Promise<AncestryRow[]> {
        const all = v.kind === 'ALL';
        const granted = v.kind === 'GRANTED' ? [...v.projectIds] : [];
        const t = ctx.tenantId;
        const rows = await db.$queryRaw<AncestryRow[]>(Prisma.sql`
            WITH RECURSIVE item_up AS (
                SELECT w."id", w."parentId", w."projectId", w."goalId", w."number", w."title", 0 AS depth, ARRAY[w."id"] AS path
                  FROM "WorkItem" w
                  JOIN "Project" vp ON vp."id" = w."projectId" AND vp."tenantId" = ${t} AND vp."deletedAt" IS NULL
                 WHERE w."tenantId" = ${t} AND w."id" = ${id} AND w."deletedAt" IS NULL
                   AND (${all}::boolean OR w."projectId" = ANY(${granted}::text[]))
                UNION ALL
                SELECT p."id", p."parentId", p."projectId", p."goalId", p."number", p."title", u.depth + 1, u.path || p."id"
                  FROM "WorkItem" p JOIN item_up u ON p."id" = u."parentId"
                 WHERE p."tenantId" = ${t} AND p."deletedAt" IS NULL AND u.depth < ${ANCESTRY_ITEM_DEPTH} AND NOT p."id" = ANY(u.path)
            ),
            goal_up AS (
                SELECT g."id", g."parentId", 0 AS depth, ARRAY[g."id"] AS path
                  FROM item_up u
                  JOIN "Project" pr ON pr."id" = u."projectId" AND pr."tenantId" = ${t} AND u.depth = 0
                  JOIN "Initiative" i ON i."id" = pr."initiativeId" AND i."tenantId" = ${t} AND i."deletedAt" IS NULL
                  JOIN "Goal" g ON g."id" = i."goalId" AND g."tenantId" = ${t} AND g."deletedAt" IS NULL
                UNION ALL
                SELECT g."id", g."parentId", gu.depth + 1, gu.path || g."id"
                  FROM "Goal" g JOIN goal_up gu ON g."id" = gu."parentId"
                 WHERE g."tenantId" = ${t} AND g."deletedAt" IS NULL AND gu.depth < ${ANCESTRY_GOAL_DEPTH} AND NOT g."id" = ANY(gu.path)
            ),
            direct_goal_up AS (
                SELECT g."id", g."parentId", 0 AS depth, ARRAY[g."id"] AS path
                  FROM item_up u
                  JOIN "Goal" g ON g."id" = u."goalId" AND g."tenantId" = ${t} AND g."deletedAt" IS NULL AND u.depth = 0
                UNION ALL
                SELECT g."id", g."parentId", d.depth + 1, d.path || g."id"
                  FROM "Goal" g JOIN direct_goal_up d ON g."id" = d."parentId"
                 WHERE g."tenantId" = ${t} AND g."deletedAt" IS NULL AND d.depth < ${ANCESTRY_GOAL_DEPTH} AND NOT g."id" = ANY(d.path)
            )
            SELECT 'item' AS kind, u."id", u.depth, u."title" AS label, u."number" AS num, NULL::text AS code, false AS archived
              FROM item_up u
            UNION ALL
            SELECT 'project', pr."id", 0, pr."name", NULL::int, pr."keyPrefix", pr."archivedAt" IS NOT NULL
              FROM item_up u JOIN "Project" pr ON pr."id" = u."projectId" AND pr."tenantId" = ${t}
             WHERE u.depth = 0
            UNION ALL
            SELECT 'initiative', i."id", 0, i."name", NULL::int, i."status"::text, i."archivedAt" IS NOT NULL
              FROM item_up u
              JOIN "Project" pr ON pr."id" = u."projectId" AND pr."tenantId" = ${t}
              JOIN "Initiative" i ON i."id" = pr."initiativeId" AND i."tenantId" = ${t} AND i."deletedAt" IS NULL
             WHERE u.depth = 0
            UNION ALL
            SELECT 'goal', g."id", gu.depth, g."title", NULL::int, g."status"::text, g."archivedAt" IS NOT NULL
              FROM goal_up gu JOIN "Goal" g ON g."id" = gu."id" AND g."tenantId" = ${t}
            UNION ALL
            SELECT 'direct_goal', g."id", d.depth, g."title", NULL::int, g."status"::text, g."archivedAt" IS NOT NULL
              FROM direct_goal_up d JOIN "Goal" g ON g."id" = d."id" AND g."tenantId" = ${t}`);
        return rows.map((r) => ({ ...r, depth: Number(r.depth), num: r.num === null ? null : Number(r.num) }));
    }

    /**
     * The items, deleted ones included, that name any of `goalIds` directly,
     * locked in id order (decision 173) before a purge deletes the goals and
     * the database clears their `goalId` (decision 219): what the purge
     * unlinks, counted.
     */
    static async lockItemsNamingGoals(db: PrismaTx, ctx: RequestContext, goalIds: readonly string[]): Promise<LockedWorkItemIds> {
        if (goalIds.length === 0) return mintLockedWorkItemIds([]);
        const rows = await db.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "WorkItem"
             WHERE "tenantId" = ${ctx.tenantId} AND "goalId" = ANY(${[...goalIds]}::text[])
             ORDER BY "id"
             FOR UPDATE`;
        return mintLockedWorkItemIds(rows.map((r) => r.id));
    }

    /** Soft-delete the given rows together under one `deletionId` (ADR 0002 §8). */
    static async softDelete(db: PrismaTx, ctx: RequestContext, ids: LockedWorkItemIds, deletionId: string, now: Date) {
        if (ids.length === 0) return 0;
        const result = await db.workItem.updateMany({
            where: { id: { in: [...ids] }, tenantId: ctx.tenantId, deletedAt: null },
            data: { deletedAt: now, deletedByUserId: ctx.userId, deletionId },
        });
        return result.count;
    }

    /** Rows deleted together with `deletionId`, with the project and key each kept (a restore places them again). */
    static async idsOfDeletion(db: PrismaTx, ctx: RequestContext, deletionId: string) {
        return db.workItem.findMany({
            where: { tenantId: ctx.tenantId, deletionId, deletedAt: { not: null } },
            // A deletion is one subtree; the cap is far beyond any real one.
            take: 10_000,
            select: { id: true, parentId: true, projectId: true, sortKey: true },
        });
    }

    /** Whether any of `ids` is deleted under ANOTHER deletion (restore its parent first). */
    static async deletedOutside(db: PrismaTx, ctx: RequestContext, ids: readonly string[], deletionId: string) {
        if (ids.length === 0) return [];
        return db.workItem.findMany({
            where: { tenantId: ctx.tenantId, id: { in: [...ids] }, deletedAt: { not: null }, NOT: { deletionId } },
            take: ids.length,
            select: { id: true },
        });
    }

    /** Restore a deletion's rows, which the caller locked ({@link lockForWrite} over {@link idsOfDeletion}). */
    static async restoreDeletion(db: PrismaTx, ctx: RequestContext, deletionId: string, ids: LockedWorkItemIds) {
        if (ids.length === 0) return 0;
        const result = await db.workItem.updateMany({
            where: { id: { in: [...ids] }, tenantId: ctx.tenantId, deletionId, deletedAt: { not: null } },
            data: { deletedAt: null, deletedByUserId: null, deletionId: null, version: { increment: 1 } },
        });
        return result.count;
    }

    /**
     * Clear waiting on wherever it names a member who is being removed (2.4b,
     * ADR 0002 §14): the FK is RESTRICT, as the assignee's is. Deleted items
     * too, or the FK refuses the delete; each item's version increases.
     */
    static async clearWaitingOnAll(db: PrismaTx, ctx: RequestContext, userId: string, _locked: LockedWorkItemIds) {
        // The predicate, not the locked ids: the lock ({@link lockItemsOfPerson})
        // came first, and this statement's fresh snapshot also catches a row a
        // writer we waited on committed meanwhile, which the FK would refuse.
        const result = await db.workItem.updateMany({
            where: { tenantId: ctx.tenantId, waitingOnUserId: userId },
            data: { waitingOnUserId: null, version: { increment: 1 } },
        });
        return result.count;
    }

    /** Unassign every item of a member who is being removed (ADR 0003 §1, step 2); the rows locked by {@link lockItemsOfPerson}. */
    static async unassignAll(db: PrismaTx, ctx: RequestContext, userId: string, _locked: LockedWorkItemIds) {
        // The predicate, not the locked ids (see {@link clearWaitingOnAll}).
        const result = await db.workItem.updateMany({
            where: { tenantId: ctx.tenantId, assigneeId: userId },
            data: { assigneeId: null, version: { increment: 1 } },
        });
        return result.count;
    }

    // ── Sub-items ────────────────────────────────────────────────────

    static async listSubItems(
        db: PrismaTx,
        ctx: RequestContext,
        v: ProjectVisibility,
        parentId: string,
        page: { limit: number; cursor?: CursorPayload },
    ) {
        const order = LIST_ORDERS.manual;
        const and: Prisma.WorkItemWhereInput[] = [projectVisibilityWhere(v, { includeArchived: true })];
        if (page.cursor) and.push(buildKeysetWhere(order, page.cursor) as Prisma.WorkItemWhereInput);
        return db.workItem.findMany({
            where: { tenantId: ctx.tenantId, parentId, deletedAt: null, AND: and },
            orderBy: keysetOrderBy(order) as Prisma.WorkItemOrderByWithRelationInput[],
            take: page.limit + 1,
            select: workItemListSelect,
        });
    }

    /**
     * Sub-item progress for a page of parents in ONE grouped read: the live
     * sub-items and how many are DONE (Kaneo `get-subtask-counts.ts` at
     * fb890b4974e6dd6c232f1de6a6b70a591dfca0a3; pattern only).
     */
    static async subItemProgress(db: PrismaTx, ctx: RequestContext, parentIds: readonly string[]) {
        if (parentIds.length === 0) return new Map<string, { total: number; done: number }>();
        const rows = await db.workItem.groupBy({
            by: ['parentId', 'stateCategory'],
            where: { tenantId: ctx.tenantId, parentId: { in: [...parentIds] }, deletedAt: null },
            _count: { _all: true },
        });
        const out = new Map<string, { total: number; done: number }>();
        for (const r of rows) {
            if (!r.parentId) continue;
            const entry = out.get(r.parentId) ?? { total: 0, done: 0 };
            entry.total += r._count._all;
            if (r.stateCategory === 'DONE') entry.done += r._count._all;
            out.set(r.parentId, entry);
        }
        return out;
    }

    // ── Metrics ──────────────────────────────────────────────────────

    static async metrics(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, filters: WorkItemFilters, today: Date) {
        const where = WorkItemRepository._buildWhere(ctx, v, { ...filters, due: undefined, q: undefined }, null, today);
        const [byCategory, overdue, unassignedOpen] = await Promise.all([
            db.workItem.groupBy({ by: ['stateCategory'], where, _count: { _all: true } }),
            db.workItem.count({
                where: { AND: [where, { dueDate: { lt: utcDay(today) }, stateCategory: OPEN_CATEGORY_FILTER }] },
            }),
            db.workItem.count({ where: { AND: [where, { assigneeId: null, stateCategory: OPEN_CATEGORY_FILTER }] } }),
        ]);
        const counts = Object.fromEntries(WORKFLOW_STATE_CATEGORIES.map((c) => [c, 0])) as Record<WorkflowStateCategory, number>;
        let total = 0;
        for (const row of byCategory) {
            counts[row.stateCategory] = row._count._all;
            total += row._count._all;
        }
        return { total, byCategory: counts, overdue, unassignedOpen };
    }

    // ── Cycles (sub-phase 2.5a) ──────────────────────────────────────

    /**
     * Live, visible items per cycle and category: the cycle list's and the
     * cycle page's counts. Archived projects' items drop out, as they drop out
     * of the metrics.
     */
    static async countsByCycle(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, cycleIds: readonly string[]) {
        if (cycleIds.length === 0) return [];
        return db.workItem.groupBy({
            by: ['cycleId', 'stateCategory'],
            where: { tenantId: ctx.tenantId, deletedAt: null, cycleId: { in: [...cycleIds] }, AND: [projectVisibilityWhere(v)] },
            _count: { _all: true },
        });
    }

    /**
     * The rollover's page of a closed cycle's unfinished items: live, open,
     * in a live and unarchived project (the job form of visibility; an
     * archived project's items stay behind, as their writes are refused).
     */
    static async rolloverCandidates(db: PrismaTx, ctx: RequestContext, cycleId: string, take: number) {
        return db.workItem.findMany({
            where: {
                tenantId: ctx.tenantId,
                cycleId,
                deletedAt: null,
                stateCategory: OPEN_CATEGORY_FILTER,
                AND: [JOB_PROJECT_VISIBILITY_WHERE],
            },
            orderBy: { id: 'asc' },
            take,
            select: { id: true, number: true, project: { select: { keyPrefix: true } } },
        });
    }

    /**
     * Move a page of items from one cycle to another (or out of cycles). The
     * `cycleId: from` predicate makes a repeat a no-op; the version increases
     * (a cycle is part of what the item shows, ADR 0002 §9).
     */
    static async moveCycle(db: PrismaTx, ctx: RequestContext, ids: LockedWorkItemIds, from: string, to: string | null) {
        if (ids.length === 0) return 0;
        const result = await db.workItem.updateMany({
            where: { id: { in: [...ids] }, tenantId: ctx.tenantId, cycleId: from, deletedAt: null, AND: [JOB_PROJECT_VISIBILITY_WHERE] },
            data: { cycleId: to, version: { increment: 1 } },
        });
        return result.count;
    }

    /**
     * Every item that names a cycle, deleted ones and those in hidden
     * projects included: deleting an upcoming cycle must clear them all, or
     * the RESTRICT foreign key refuses the delete. Deliberately not narrowed
     * by `deletedAt` or visibility (the usecase is authorised to delete the
     * cycle, and a hidden item only loses its cycle).
     */
    static async idsInCycleIncludingDeleted(db: PrismaTx, ctx: RequestContext, cycleId: string, take: number) {
        return db.workItem.findMany({
            where: { tenantId: ctx.tenantId, cycleId },
            orderBy: { id: 'asc' },
            take,
            select: { id: true, number: true, deletedAt: true, project: { select: { keyPrefix: true } } },
        });
    }

    /** Which of the cycles any item names, deleted items included (the schedule's replace check). */
    static async cycleIdsInUse(db: PrismaTx, ctx: RequestContext, cycleIds: readonly string[]): Promise<string[]> {
        if (cycleIds.length === 0) return [];
        const rows = await db.workItem.groupBy({ by: ['cycleId'], where: { tenantId: ctx.tenantId, cycleId: { in: [...cycleIds] } } });
        return rows.flatMap((r) => (r.cycleId ? [r.cycleId] : []));
    }

    /** Clear the cycle from the given items (see {@link idsInCycleIncludingDeleted}). */
    static async clearCycleIncludingDeleted(db: PrismaTx, ctx: RequestContext, ids: LockedWorkItemIds, cycleId: string) {
        if (ids.length === 0) return 0;
        const result = await db.workItem.updateMany({
            where: { id: { in: [...ids] }, tenantId: ctx.tenantId, cycleId },
            data: { cycleId: null, version: { increment: 1 } },
        });
        return result.count;
    }

    // ── Repeats (sub-phase 2.5d) ─────────────────────────────────────

    /**
     * A repeat's source as the job finds it: visible to the rule's owner,
     * deleted or not (a deleted source holds the rule, `SOURCE_DELETED`, so
     * the read must see it), its project's archive state with it.
     */
    static async recurrenceSource(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, id: string) {
        return db.workItem.findFirst({
            // Deliberately not narrowed by `deletedAt`: a deleted source is a finding (it holds the rule).
            where: { id, tenantId: ctx.tenantId, AND: [projectVisibilityWhere(v, { includeArchived: true })] },
            select: { id: true, projectId: true, teamId: true, deletedAt: true, project: { select: { keyPrefix: true, archivedAt: true } } },
        });
    }

    /**
     * Is there already an item for this occurrence (a copy made before a
     * hold and a resume)? Deleted ones count: the occurrence unique covers
     * them, and a deleted copy is not made again.
     */
    static async occurrenceExists(db: PrismaTx, ctx: RequestContext, recurrenceId: string, occurrenceOn: Date): Promise<boolean> {
        // Deliberately not narrowed by `deletedAt` or visibility: the unique index is not.
        const hit = await db.workItem.findFirst({ where: { tenantId: ctx.tenantId, recurrenceId, occurrenceOn }, select: { id: true } });
        return hit !== null;
    }

    // ── Templates (sub-phase 2.5c) ───────────────────────────────────

    /**
     * A project's open items for "Save as template": live, visible, not Done
     * or Cancelled, in the project's order. `parentIds` null reads the
     * top-level items, otherwise the sub-items of those parents.
     */
    static async openItemsForTemplate(
        db: PrismaTx,
        ctx: RequestContext,
        v: ProjectVisibility,
        projectId: string,
        parentIds: readonly string[] | null,
        take: number,
    ) {
        return db.workItem.findMany({
            where: {
                tenantId: ctx.tenantId,
                projectId,
                deletedAt: null,
                stateCategory: { notIn: ['DONE', 'CANCELLED'] },
                ...(parentIds === null ? { parentId: null } : { parentId: { in: [...parentIds] } }),
                AND: [projectVisibilityWhere(v, { includeArchived: true })],
            },
            orderBy: [{ sortKey: 'asc' }, { id: 'asc' }],
            take,
            select: {
                id: true,
                parentId: true,
                title: true,
                description: true,
                typeId: true,
                priority: true,
                dueDate: true,
                milestoneId: true,
                estimatePoints: true,
                estimateMinutes: true,
                labels: { select: { labelId: true } },
            },
        });
    }

    // ── Milestones (sub-phase 2.5b) ──────────────────────────────────

    // ── Goals and initiatives (sub-phase 3.2b, decisions 211 and 212) ──

    /**
     * Live, visible, non-cancelled items per project and category: the
     * project path of an initiative's and a goal's progress (3.2b, decision
     * 212). Archived projects count (finished projects are usually archived);
     * deleted projects do not. Cancelled items never count towards progress,
     * so the read leaves them out.
     *
     * Raw SQL so the predicate is the literal the partial
     * `WorkItem_progress_project_path` is declared with: Prisma binds an enum
     * as a cast of a text parameter, which the planner cannot prove implies
     * the index's predicate. `tenantId`, `deletedAt` (the item's and the
     * project's) and the caller's visibility are in its own `WHERE`, as the
     * ancestry's are.
     */
    static async countsByProjects(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, projectIds: readonly string[]) {
        if (projectIds.length === 0) return [];
        const all = v.kind === 'ALL';
        const granted = v.kind === 'GRANTED' ? [...v.projectIds] : [];
        const t = ctx.tenantId;
        const rows = await db.$queryRaw<Array<{ projectId: string; stateCategory: WorkflowStateCategory; count: number }>>(Prisma.sql`
            SELECT w."projectId", w."stateCategory", count(*)::int AS "count"
              FROM "WorkItem" w
              JOIN "Project" p ON p."id" = w."projectId" AND p."tenantId" = ${t} AND p."deletedAt" IS NULL
             WHERE w."tenantId" = ${t}
               AND w."projectId" = ANY(${[...projectIds]}::text[])
               AND w."deletedAt" IS NULL
               AND w."stateCategory" <> 'CANCELLED'
               AND (${all}::boolean OR w."projectId" = ANY(${granted}::text[]))
             GROUP BY w."projectId", w."stateCategory"`);
        return rows.map((r) => ({ projectId: r.projectId, stateCategory: r.stateCategory, count: Number(r.count) }));
    }

    /**
     * The roadmap's one aggregate (3.2c; docs/porting/maps/3.2.md, "The read",
     * step 3; owner decision 215): live, visible, non-cancelled items, grouped
     * so the caller can derive every bar and count without loading an item.
     *
     *   - **The project path** (`path = 'p'`): per project, milestone and
     *     category, the count and the four boundary dates `spanFromBounds`
     *     needs (the earliest start of an item whose start is its first day,
     *     the earliest due date of an item with no start or a start after its
     *     due date, the latest due date, the latest start of an item with no
     *     due date; `domain/schedule/span.ts`, `boundsOf`). Projects' bars,
     *     progress, "latest open item due after it" and their milestones'
     *     progress all come from these rows.
     *   - **The direct path** (`path = 'g'`, only when `goalIds` is given): the
     *     same per direct goal, project, team and category (decision 211), for
     *     a goal's bar and its progress counted once (`goalProgress`).
     *
     * Raw SQL so the project path names the literal `'CANCELLED'` the partial
     * `WorkItem_progress_project_path` is declared with (3.2b). `tenantId`,
     * `deletedAt` (the item's and the project's) and the caller's visibility
     * are in each branch's own `WHERE`; archived projects count. No title,
     * description or field value is read.
     */
    static async roadmapAggregate(
        db: PrismaTx,
        ctx: RequestContext,
        v: ProjectVisibility,
        scope: { projectIds: readonly string[]; goalIds: readonly string[]; teamId?: string },
    ): Promise<RoadmapAggregateRow[]> {
        if (scope.projectIds.length === 0 && scope.goalIds.length === 0) return [];
        const all = v.kind === 'ALL';
        const granted = v.kind === 'GRANTED' ? [...v.projectIds] : [];
        const t = ctx.tenantId;
        const team = scope.teamId ?? null;
        const bounds = Prisma.sql`count(*)::int AS "count",
                   min(w."startDate") FILTER (WHERE w."startDate" IS NOT NULL AND (w."dueDate" IS NULL OR w."startDate" <= w."dueDate")) AS "minStart",
                   min(w."dueDate") FILTER (WHERE w."dueDate" IS NOT NULL AND (w."startDate" IS NULL OR w."startDate" > w."dueDate")) AS "minDueOnly",
                   max(w."dueDate") AS "maxDue",
                   max(w."startDate") FILTER (WHERE w."dueDate" IS NULL) AS "maxStartOnly"`;
        const projectPath = Prisma.sql`
            SELECT 'p'::text AS "path", w."projectId", NULL::text AS "goalId", w."milestoneId", NULL::text AS "teamId", w."stateCategory", ${bounds}
              FROM "WorkItem" w
              JOIN "Project" p ON p."id" = w."projectId" AND p."tenantId" = ${t} AND p."deletedAt" IS NULL
             WHERE w."tenantId" = ${t}
               AND w."projectId" = ANY(${[...scope.projectIds]}::text[])
               AND w."deletedAt" IS NULL
               AND w."stateCategory" <> 'CANCELLED'
               AND (${all}::boolean OR w."projectId" = ANY(${granted}::text[]))
             GROUP BY w."projectId", w."milestoneId", w."stateCategory"`;
        const directPath = Prisma.sql`
            SELECT 'g'::text AS "path", w."projectId", w."goalId", NULL::text AS "milestoneId", w."teamId", w."stateCategory", ${bounds}
              FROM "WorkItem" w
              JOIN "Project" p ON p."id" = w."projectId" AND p."tenantId" = ${t} AND p."deletedAt" IS NULL
             WHERE w."tenantId" = ${t}
               AND w."goalId" = ANY(${[...scope.goalIds]}::text[])
               AND w."deletedAt" IS NULL
               AND w."stateCategory" <> 'CANCELLED'
               AND (${all}::boolean OR w."projectId" = ANY(${granted}::text[]))
               AND (${team}::text IS NULL OR w."teamId" = ${team}::text)
             GROUP BY w."goalId", w."projectId", w."teamId", w."stateCategory"`;
        const sql =
            scope.projectIds.length === 0 ? directPath : scope.goalIds.length === 0 ? projectPath : Prisma.sql`${projectPath} UNION ALL ${directPath}`;
        const rows = await db.$queryRaw<Array<Omit<RoadmapAggregateRow, 'count'> & { count: number | bigint }>>(sql);
        return rows.map((r) => ({ ...r, count: Number(r.count) }));
    }

    /**
     * Live, visible, non-cancelled items naming one of `goalIds` directly,
     * per goal, project and category (decision 211): the direct path of a
     * goal's progress. The project lets the caller count an item reached both
     * ways once (`goalProgress` in `domain/progress.ts`). Served by
     * `[tenantId, goalId, stateCategory]`.
     */
    static async countsByGoals(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, goalIds: readonly string[]) {
        if (goalIds.length === 0) return [];
        return db.workItem.groupBy({
            by: ['goalId', 'projectId', 'stateCategory'],
            where: {
                tenantId: ctx.tenantId,
                goalId: { in: [...goalIds] },
                deletedAt: null,
                stateCategory: { not: 'CANCELLED' },
                AND: [projectVisibilityWhere(v, { includeArchived: true })],
            },
            _count: { _all: true },
        });
    }

    /**
     * Live, visible items per milestone and category: the milestones page's
     * progress. An archived project's milestones keep their progress (the
     * project page still reads its items), so archived projects count here.
     */
    static async countsByMilestone(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, milestoneIds: readonly string[]) {
        if (milestoneIds.length === 0) return [];
        return db.workItem.groupBy({
            by: ['milestoneId', 'stateCategory'],
            where: {
                tenantId: ctx.tenantId,
                deletedAt: null,
                milestoneId: { in: [...milestoneIds] },
                AND: [projectVisibilityWhere(v, { includeArchived: true })],
            },
            _count: { _all: true },
        });
    }

    /**
     * Every item that names a milestone, deleted ones and those in hidden
     * projects included: deleting a milestone must clear them all, or its
     * foreign key refuses the delete. Deliberately not narrowed by
     * `deletedAt` or visibility (the caller may change the project, and an
     * item only loses its milestone).
     */
    static async idsInMilestoneIncludingDeleted(db: PrismaTx, ctx: RequestContext, milestoneId: string, take: number) {
        return db.workItem.findMany({
            where: { tenantId: ctx.tenantId, milestoneId },
            orderBy: { id: 'asc' },
            take,
            select: { id: true, number: true, deletedAt: true, project: { select: { keyPrefix: true } } },
        });
    }

    /** Clear the milestone from the given items (see {@link idsInMilestoneIncludingDeleted}). */
    static async clearMilestoneIncludingDeleted(db: PrismaTx, ctx: RequestContext, ids: LockedWorkItemIds, milestoneId: string) {
        if (ids.length === 0) return 0;
        const result = await db.workItem.updateMany({
            where: { id: { in: [...ids] }, tenantId: ctx.tenantId, milestoneId },
            data: { milestoneId: null, version: { increment: 1 } },
        });
        return result.count;
    }

    // ── Fan-out ──────────────────────────────────────────────────────

    /**
     * The items a watcher bell is about, read for a fan-out after the write
     * commits: live, in a live and unarchived project (the job form of the
     * visibility predicate).
     */
    static async listForFanOut(db: PrismaTx, ctx: RequestContext, ids: readonly string[]) {
        if (ids.length === 0) return [];
        return db.workItem.findMany({
            where: {
                tenantId: ctx.tenantId,
                id: { in: [...ids] },
                deletedAt: null,
                project: { deletedAt: null, archivedAt: null },
            },
            take: ids.length,
            select: { id: true, number: true, title: true, project: { select: { keyPrefix: true } } },
        });
    }

    // ── Search (sub-phase 2.7b, docs/search.md) ─────────────────────

    /**
     * Live, visible items of unarchived projects whose title holds the
     * query (substring, `WorkItem_search_title_trgm`) or all of its words
     * (full text through `islestone_bg_en`, stemmed, 2.7f; `WorkItem_search_title_fts`), plus the item a
     * typed key resolved to (`keyHitId`), as ids in candidate order (the key
     * hit, an exact title, a title prefix, the full-text rank, the trigram
     * similarity, then the id); the usecase reads their rows by id
     * (`findSearchRows`) and ranks them (`computeRankScore`). Bounded by
     * `limit` (at most {@link SEARCH_ROW_CAP}, which the function also caps).
     *
     * The read is the SECURITY DEFINER function `search_work_item_titles`
     * (owner decision 245, migration `20261214120000_search_definer_functions`,
     * docs/search.md): it reads the workspace from `app.tenant_id` itself and
     * filters it, `deletedAt`, the archived filter and project visibility in
     * its own `WHERE`, so its GIN indexes are searched with their operators
     * under row-level security. The query and the patterns are bind
     * parameters, never interpolated.
     */
    static async searchTitleIds(
        db: PrismaTx,
        _ctx: RequestContext,
        v: ProjectVisibility,
        query: string,
        opts: { limit: number; keyHitId?: string | null },
    ): Promise<Array<{ id: string; ordinal: number }>> {
        const limit = Math.min(Math.max(1, Math.floor(opts.limit)), SEARCH_ROW_CAP);
        const rows = await db.$queryRaw<Array<{ id: string; ordinal: number }>>(Prisma.sql`
            SELECT t."id", t."ordinal"
              FROM search_work_item_titles(${query}::text, ${containsPattern(query)}::text, ${prefixPattern(query)}::text, ${opts.keyHitId ?? null}::text,
                                           ${projectVisibilityArgs(v)}, ${limit}::integer) t
             ORDER BY t."ordinal"`);
        return rows.map((r) => ({ id: r.id, ordinal: Number(r.ordinal) }));
    }

    /**
     * Live, visible items whose title matches the query in full text through
     * `islestone_bg_en` (stems in either language, `websearch_to_tsquery`
     * syntax), for the list's `q` (2.7f); `WorkItem_search_title_fts` serves
     * it, inside the definer function `search_work_item_title_words`
     * (decision 245). At most `cap` (at most `SEARCH_MATCH_CAP`) ids.
     */
    static async titleFullTextIds(db: PrismaTx, _ctx: RequestContext, v: ProjectVisibility, query: string, cap: number): Promise<string[]> {
        const limit = Math.min(Math.max(1, Math.floor(cap)), SEARCH_MATCH_CAP);
        const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT t."id" FROM search_work_item_title_words(${query}::text, ${projectVisibilityArgs(v)}, ${limit}::integer) t`);
        return rows.map((r) => r.id);
    }

    /**
     * Live, visible items whose title holds `q` as a substring (`ILIKE`,
     * `%` and `_` matched as text), for the list's `q` (decision 245):
     * `WorkItem_search_title_trgm`, inside the definer function
     * `search_work_item_title_substring`. A set of at most `cap` (at most
     * `SEARCH_MATCH_CAP`) ids, in no order: a result of `cap` ids means there
     * may be more, and the caller then filters by the pattern itself.
     */
    static async titleSubstringIds(db: PrismaTx, _ctx: RequestContext, v: ProjectVisibility, q: string, cap: number): Promise<string[]> {
        const limit = Math.min(Math.max(1, Math.floor(cap)), SEARCH_MATCH_CAP);
        const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT t."id" FROM search_work_item_title_substring(${containsPattern(q)}::text, ${projectVisibilityArgs(v)}, ${limit}::integer) t`);
        return rows.map((r) => r.id);
    }

    /**
     * The search rows of items found by their description or a comment
     * (2.7f): live, visible, unarchived, by id; at most `SEARCH_MATCH_CAP`.
     */
    static async findSearchRows(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, ids: readonly string[]): Promise<WorkItemSearchRow[]> {
        if (ids.length === 0) return [];
        const rows = await db.workItem.findMany({
            where: { tenantId: ctx.tenantId, id: { in: [...ids] }, deletedAt: null, AND: [projectVisibilityWhere(v)] },
            take: SEARCH_MATCH_CAP,
            select: { id: true, title: true, number: true, project: { select: { keyPrefix: true } } },
        });
        return rows.map((r) => ({ id: r.id, title: r.title, number: r.number, keyPrefix: r.project.keyPrefix }));
    }

    /**
     * The texts a search shows its snippets from (2.7f): the descriptions of
     * live, visible items and the bodies of live comments on them, decrypted
     * by the client's extension. At most `SEARCH_ROW_CAP` of each.
     */
    static async searchSnippetSources(
        db: PrismaTx,
        ctx: RequestContext,
        v: ProjectVisibility,
        ids: { descriptionItemIds: readonly string[]; commentIds: readonly string[] },
    ): Promise<{ descriptions: Map<string, string>; comments: Map<string, string> }> {
        const visible = projectVisibilityWhere(v);
        const [items, comments] = await Promise.all([
            ids.descriptionItemIds.length === 0
                ? Promise.resolve([])
                : db.workItem.findMany({
                      where: { tenantId: ctx.tenantId, id: { in: [...ids.descriptionItemIds] }, deletedAt: null, AND: [visible] },
                      take: SEARCH_ROW_CAP,
                      select: { id: true, description: true },
                  }),
            ids.commentIds.length === 0
                ? Promise.resolve([])
                : db.comment.findMany({
                      where: {
                          tenantId: ctx.tenantId,
                          id: { in: [...ids.commentIds] },
                          deletedAt: null,
                          workItem: { deletedAt: null, AND: [visible] },
                      },
                      take: SEARCH_ROW_CAP,
                      select: { id: true, body: true },
                  }),
        ]);
        return {
            descriptions: new Map(items.flatMap((i) => (i.description ? [[i.id, i.description] as const] : []))),
            comments: new Map(comments.map((c) => [c.id, c.body] as const)),
        };
    }

    // ── Keys ─────────────────────────────────────────────────────────

    /** The live visible item with this number in this project. */
    static async findByNumber(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, projectId: string, number: number) {
        return db.workItem.findFirst({
            where: { tenantId: ctx.tenantId, projectId, number, deletedAt: null, AND: [projectVisibilityWhere(v, { includeArchived: true })] },
            select: { id: true },
        });
    }

    static async findAlias(db: PrismaTx, ctx: RequestContext, projectId: string, number: number) {
        return db.workItemKeyAlias.findUnique({
            where: { tenantId_projectId_number: { tenantId: ctx.tenantId, projectId, number } },
            select: { workItemId: true },
        });
    }

    static async createAliases(db: PrismaTx, ctx: RequestContext, rows: ReadonlyArray<{ projectId: string; number: number; workItemId: string }>) {
        if (rows.length === 0) return { count: 0 };
        return db.workItemKeyAlias.createMany({ data: rows.map((r) => ({ tenantId: ctx.tenantId, ...r })) });
    }

    /**
     * Move one row to another project in place: the conditional `WHERE
     * projectId = <source>` refuses a concurrent move (count 0). Team, state
     * and category change in the same UPDATE (the composite FKs check them
     * together); the parent link is deferred to commit.
     */
    static async moveRow(
        db: PrismaTx,
        ctx: RequestContext,
        locked: LockedWorkItemIds,
        id: string,
        fromProjectId: string,
        data: {
            projectId: string;
            teamId: string;
            number: number;
            stateId: string;
            stateCategory: WorkflowStateCategory;
            sortKey?: string;
            parentId?: string | null;
            assigneeId?: string | null;
            /** Cleared on a move to another team's project (a cycle is a team's). */
            cycleId?: string | null;
            /** Cleared on every move to another project (a milestone is a project's). */
            milestoneId?: string | null;
            completedAt?: Date | null;
            cancelledAt?: Date | null;
            startedAt?: Date | null;
        },
    ) {
        // One row of a subtree the caller locked whole (decision 173).
        if (!isLocked(locked, id)) throw new Error('moveRow: the row is not in the locked subtree');
        const result = await db.workItem.updateMany({
            where: { id, tenantId: ctx.tenantId, projectId: fromProjectId, deletedAt: null },
            data: { ...data, version: { increment: 1 } },
        });
        return result.count;
    }

    // ── Purge ────────────────────────────────────────────────────────

    /** Items past the window in one workspace, a batch at a time. */
    static async purgeableIds(db: PrismaTx, ctx: RequestContext, before: Date, take: number) {
        const rows = await db.workItem.findMany({
            where: { tenantId: ctx.tenantId, deletedAt: { lt: before } },
            orderBy: { id: 'asc' },
            take,
            select: { id: true },
        });
        return rows.map((r) => r.id);
    }

    /**
     * Hard-delete a batch, children of the batch first so the deferred parent
     * check never sees a live child of a removed parent. Relations, labels,
     * comments, watchers and links cascade from `WorkItem`.
     */
    static async hardDelete(db: PrismaTx, ctx: RequestContext, locked: LockedWorkItemIds, ids: readonly string[]) {
        if (ids.length === 0) return 0;
        // The batch and the rows pointing at it, locked by {@link lockPurgeBatch}.
        if (!ids.every((id) => isLocked(locked, id))) throw new Error('hardDelete: the batch is not locked');
        // Detach any surviving row still pointing at a purged parent: a
        // child deleted under another deletion with a later timestamp.
        await db.workItem.updateMany({
            where: { tenantId: ctx.tenantId, id: { in: [...locked] }, parentId: { in: [...ids] }, NOT: { id: { in: [...ids] } } },
            data: { parentId: null },
        });
        const result = await db.workItem.deleteMany({ where: { tenantId: ctx.tenantId, id: { in: [...ids] } } });
        return result.count;
    }

    /**
     * Projects of the workspace deleted before `before` and not yet purged, a
     * batch at a time. A tombstone (`purgedAt`, issue #117) is never picked
     * again: it is what the purge leaves of a project time entries name.
     */
    static async purgeableProjectIds(db: PrismaTx, ctx: RequestContext, before: Date, take: number) {
        const rows = await db.project.findMany({
            where: { tenantId: ctx.tenantId, deletedAt: { lt: before }, purgedAt: null },
            orderBy: { id: 'asc' },
            take,
            select: { id: true },
        });
        return rows.map((r) => r.id);
    }

    /** Hard-delete a project whose items are gone (key bookkeeping survives: no FK). */
    static async hardDeleteProject(db: PrismaTx, ctx: RequestContext, projectId: string) {
        const result = await db.project.deleteMany({ where: { id: projectId, tenantId: ctx.tenantId, purgedAt: null } });
        return result.count;
    }

    /**
     * Leave a tombstone of a deleted project whose items are gone but which
     * time entries name (issue #117, owner decision 281). In the caller's
     * transaction: the time entries' link is deferred, the row is deleted, so
     * every child goes by the cascades the database declares (as for a project
     * with no time), and the row is inserted again under the same id with
     * only its key, name and deletion kept, marked `purgedAt`; at the commit
     * the deferred check finds it. Its team is cleared (issue #120, owner
     * decision 305), so the team can be deleted. Raw SQL: the purge's one
     * counts-only audit entry records it, not a per-row create.
     */
    static async tombstoneProject(db: PrismaTx, ctx: RequestContext, projectId: string, now: Date): Promise<number> {
        await db.$executeRawUnsafe(`SET CONSTRAINTS "TimeEntry_projectId_tenantId_fkey" DEFERRED`);
        const kept = await db.$queryRaw<
            Array<{ id: string; name: string; keyPrefix: string; version: number; archivedAt: Date | null; deletedAt: Date; deletedByUserId: string | null; createdAt: Date }>
        >`DELETE FROM "Project"
           WHERE "id" = ${projectId} AND "tenantId" = ${ctx.tenantId} AND "deletedAt" IS NOT NULL AND "purgedAt" IS NULL
          RETURNING "id", "name", "keyPrefix", "version", "archivedAt", "deletedAt", "deletedByUserId", "createdAt"`;
        const row = kept[0];
        if (!row) return 0;
        await db.$executeRaw`
            INSERT INTO "Project" ("id", "tenantId", "teamId", "name", "keyPrefix", "version", "archivedAt", "deletedAt", "deletedByUserId", "purgedAt", "createdAt", "updatedAt")
            VALUES (${row.id}, ${ctx.tenantId}, NULL, ${row.name}, ${row.keyPrefix}, ${row.version + 1}, ${row.archivedAt}, ${row.deletedAt}, ${row.deletedByUserId}, ${now}, ${row.createdAt}, ${now})`;
        return 1;
    }

    /** Rewrite one item's `sortKey` (rebalance; no version bump), one row of a page the job locked. */
    static async rewriteSortKey(db: PrismaTx, ctx: RequestContext, locked: LockedWorkItemIds, id: string, sortKey: string) {
        if (!isLocked(locked, id)) throw new Error('rewriteSortKey: the row is not in the locked page');
        return db.workItem.updateMany({ where: { id, tenantId: ctx.tenantId }, data: { sortKey } });
    }

    /** Live items in a project. */
    static async countLiveInProject(db: PrismaTx, ctx: RequestContext, projectId: string) {
        return db.workItem.count({ where: { tenantId: ctx.tenantId, projectId, deletedAt: null } });
    }

    /** One batch of a purged project's items. */
    static async projectItemIds(db: PrismaTx, ctx: RequestContext, projectId: string, take: number) {
        const rows = await db.workItem.findMany({
            where: { tenantId: ctx.tenantId, projectId },
            orderBy: { id: 'asc' },
            take,
            select: { id: true },
        });
        return rows.map((r) => r.id);
    }

    // ── Due reminders ────────────────────────────────────────────────

    /**
     * One page of a workspace's items due on one of `dueDates`: open, live,
     * assigned to an ACTIVE member, in a live and unarchived project (the job
     * form of the visibility predicate). Keyset on `(dueDate, id)`, served by
     * `[tenantId, stateCategory, dueDate]`.
     */
    static async dueCandidates(
        db: PrismaTx,
        tenantId: string,
        dueDates: readonly Date[],
        after: { dueDate: Date; id: string } | null,
        take: number,
    ) {
        return db.workItem.findMany({
            where: {
                tenantId,
                deletedAt: null,
                stateCategory: OPEN_CATEGORY_FILTER,
                dueDate: { in: [...dueDates] },
                project: { deletedAt: null, archivedAt: null },
                AND: [
                    // Someone to remind: an ACTIVE assignee, or an ACTIVE member it waits on (decision 137).
                    { OR: [{ assignee: { status: 'ACTIVE' } }, { waitingOn: { status: 'ACTIVE' } }] },
                    ...(after ? [{ OR: [{ dueDate: { gt: after.dueDate } }, { dueDate: after.dueDate, id: { gt: after.id } }] }] : []),
                ],
            },
            orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
            take,
            select: {
                id: true,
                title: true,
                number: true,
                dueDate: true,
                assigneeId: true,
                waitingOnUserId: true,
                assignee: { select: { status: true } },
                waitingOn: { select: { status: true } },
                project: { select: { keyPrefix: true } },
            },
        });
    }

    /**
     * The daily digest's due items (2.7c, owner decision 133): open, live
     * items in live, unarchived projects (the job form; the job then narrows
     * each member to their own project visibility) assigned to, or waiting
     * on, one of `userIds`, due on or before `dueOnOrBefore` (overdue
     * included), earliest first.
     */
    static async digestDueItems(db: PrismaTx, tenantId: string, userIds: readonly string[], dueOnOrBefore: Date, take: number) {
        if (userIds.length === 0) return [];
        return db.workItem.findMany({
            where: {
                tenantId,
                deletedAt: null,
                stateCategory: OPEN_CATEGORY_FILTER,
                dueDate: { lte: dueOnOrBefore },
                ...JOB_PROJECT_VISIBILITY_WHERE,
                OR: [{ assigneeId: { in: [...userIds] } }, { waitingOnUserId: { in: [...userIds] } }],
            },
            orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
            take,
            select: {
                id: true,
                title: true,
                number: true,
                dueDate: true,
                projectId: true,
                assigneeId: true,
                waitingOnUserId: true,
                project: { select: { keyPrefix: true } },
            },
        });
    }

    /**
     * Of `ids`, the live items in live, unarchived projects, with their
     * project (the digest's re-check of a bell row's item, 2.7c; the job form,
     * narrowed per member by the caller).
     */
    static async liveForDigest(db: PrismaTx, tenantId: string, ids: readonly string[]) {
        if (ids.length === 0) return [];
        return db.workItem.findMany({
            where: { tenantId, id: { in: [...ids] }, deletedAt: null, ...JOB_PROJECT_VISIBILITY_WHERE },
            take: ids.length,
            select: { id: true, projectId: true },
        });
    }

    // ── Rebalance ────────────────────────────────────────────────────

    /**
     * Projects whose items carry a key past the bound, deleted items included:
     * the rebalance rewrites those too, so a project is selected until one run
     * has rewritten it (issue #110).
     */
    static async projectsNeedingRebalance(db: PrismaTx, ctx: RequestContext, bound: number) {
        const rows = await db.$queryRaw<Array<{ projectId: string }>>`
            SELECT DISTINCT "projectId" FROM "WorkItem"
             WHERE "tenantId" = ${ctx.tenantId} AND length("sortKey") > ${bound}
             LIMIT 100`;
        return rows.map((r) => r.projectId);
    }

    /**
     * Every item of a project in order, deleted ones included, a page at a
     * time (the rebalance rewrites deleted rows too, so a restored item comes
     * back in its place among the rewritten keys; issue #110).
     */
    static async orderedPageIncludingDeleted(db: PrismaTx, ctx: RequestContext, projectId: string, after: CursorPayload | undefined, take: number) {
        const order = LIST_ORDERS.manual;
        return db.workItem.findMany({
            where: {
                tenantId: ctx.tenantId,
                projectId,
                ...(after ? (buildKeysetWhere(order, after) as Prisma.WorkItemWhereInput) : {}),
            },
            orderBy: keysetOrderBy(order) as Prisma.WorkItemOrderByWithRelationInput[],
            take,
            select: { id: true, sortKey: true },
        });
    }
}

/** UTC midnight of `d`'s UTC date: how a `@db.Date` column reads back. */
export function utcDay(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ── Comments ───────────────────────────────────────────────────────────

export class CommentRepository {
    /** A page of an item's live comments, newest first (the caller checks the item). */
    static async list(db: PrismaTx, ctx: RequestContext, workItemId: string, page: { limit: number; cursor?: CursorPayload }) {
        const order: KeysetOrder = { column: 'createdAt', direction: 'desc', kind: 'date' };
        return db.comment.findMany({
            where: {
                tenantId: ctx.tenantId,
                workItemId,
                deletedAt: null,
                ...(page.cursor ? (buildKeysetWhere(order, page.cursor) as Prisma.CommentWhereInput) : {}),
            },
            orderBy: keysetOrderBy(order) as Prisma.CommentOrderByWithRelationInput[],
            take: page.limit + 1,
            select: { id: true, workItemId: true, authorUserId: true, body: true, editedAt: true, createdAt: true },
        });
    }

    static async get(db: PrismaTx, ctx: RequestContext, workItemId: string, id: string) {
        return db.comment.findFirst({
            where: { id, workItemId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true, workItemId: true, authorUserId: true, createdAt: true },
        });
    }

    /** One live comment with its text: the item's marked answer, pinned on the detail (2.4b-c). */
    static async getWithBody(db: PrismaTx, ctx: RequestContext, workItemId: string, id: string) {
        return db.comment.findFirst({
            where: { id, workItemId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true, workItemId: true, authorUserId: true, body: true, editedAt: true, createdAt: true },
        });
    }

    static async create(db: PrismaTx, ctx: RequestContext, workItemId: string, body: string) {
        return db.comment.create({
            data: { tenantId: ctx.tenantId, workItemId, authorUserId: ctx.userId, body },
            select: { id: true, workItemId: true, authorUserId: true, body: true, editedAt: true, createdAt: true },
        });
    }

    static async edit(db: PrismaTx, ctx: RequestContext, id: string, body: string) {
        return db.comment.updateMany({
            where: { id, tenantId: ctx.tenantId, deletedAt: null },
            data: { body, editedAt: new Date() },
        });
    }

    static async softDelete(db: PrismaTx, ctx: RequestContext, id: string) {
        return db.comment.updateMany({ where: { id, tenantId: ctx.tenantId, deletedAt: null }, data: { deletedAt: new Date() } });
    }
}

// ── Watchers ───────────────────────────────────────────────────────────

export class WorkItemWatcherRepository {
    static async list(db: PrismaTx, ctx: RequestContext, workItemId: string) {
        return db.workItemWatcher.findMany({
            where: { tenantId: ctx.tenantId, workItemId },
            orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
            take: DETAIL_RELATION_TAKE,
            select: { userId: true, createdAt: true },
        });
    }

    static async add(db: PrismaTx, ctx: RequestContext, workItemId: string, userId: string) {
        return db.workItemWatcher.createMany({ data: [{ tenantId: ctx.tenantId, workItemId, userId }], skipDuplicates: true });
    }

    /**
     * Add several watchers at once and say which of them were not watching
     * before (2.7d: the people a mention adds), for one audit entry each.
     */
    static async addMany(db: PrismaTx, ctx: RequestContext, workItemId: string, userIds: readonly string[]): Promise<string[]> {
        const ids = [...new Set(userIds)];
        if (ids.length === 0) return [];
        const already = await db.workItemWatcher.findMany({
            where: { tenantId: ctx.tenantId, workItemId, userId: { in: ids } },
            take: ids.length,
            select: { userId: true },
        });
        const watching = new Set(already.map((w) => w.userId));
        const added = ids.filter((id) => !watching.has(id));
        if (added.length > 0) {
            await db.workItemWatcher.createMany({ data: added.map((userId) => ({ tenantId: ctx.tenantId, workItemId, userId })), skipDuplicates: true });
        }
        return added;
    }

    static async remove(db: PrismaTx, ctx: RequestContext, workItemId: string, userId: string) {
        return db.workItemWatcher.deleteMany({ where: { tenantId: ctx.tenantId, workItemId, userId } });
    }

    /** Every watcher of a page of items, for the fan-out (one read). */
    static async listByWorkItemIds(db: PrismaTx, ctx: RequestContext, workItemIds: readonly string[]) {
        if (workItemIds.length === 0) return [];
        return db.workItemWatcher.findMany({
            where: { tenantId: ctx.tenantId, workItemId: { in: [...workItemIds] }, member: { status: 'ACTIVE' } },
            // Bounded by the page of items times a generous watcher count.
            take: workItemIds.length * 200,
            select: { workItemId: true, userId: true },
        });
    }
}

// ── Links ──────────────────────────────────────────────────────────────

export class WorkItemLinkRepository {
    static async listByWorkItem(db: PrismaTx, ctx: RequestContext, workItemId: string) {
        return db.workItemLink.findMany({
            where: { tenantId: ctx.tenantId, workItemId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: DETAIL_RELATION_TAKE,
            select: { id: true, type: true, location: true, title: true, createdByUserId: true, createdAt: true },
        });
    }

    static async link(db: PrismaTx, ctx: RequestContext, workItemId: string, data: { type: string; location: string; title: string | null }) {
        return db.workItemLink.create({
            data: { tenantId: ctx.tenantId, workItemId, createdByUserId: ctx.userId, ...data },
            select: { id: true, type: true, location: true, title: true, createdByUserId: true, createdAt: true },
        });
    }

    /** Delete a link scoped to the item that owns it (the source's fix). */
    static async unlink(db: PrismaTx, ctx: RequestContext, workItemId: string, linkId: string) {
        const link = await db.workItemLink.findFirst({
            where: { id: linkId, workItemId, tenantId: ctx.tenantId },
            select: { id: true, type: true },
        });
        if (!link) return null;
        await db.workItemLink.deleteMany({ where: { id: linkId, workItemId, tenantId: ctx.tenantId } });
        return link;
    }
}

