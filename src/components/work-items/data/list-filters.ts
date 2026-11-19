/**
 * The work-item list's filters as the views hold them, the query string they
 * become (`GET /work-items`, `WorkItemQuerySchema`), and the optimistic
 * placement rule: whether a row a mutation just changed still belongs in a
 * loaded list.
 *
 * The server owns filtering: a list is always what the API answered for its
 * query. `rowBelongs` only decides where an optimistic row goes until the
 * server's answer replaces it, and answers `unknown` for the facets it cannot
 * decide on the client (free text, due windows), in which case the row keeps
 * its place and the next revalidation settles it.
 *
 * Written fresh for Islestone (sub-phase 2.3).
 */
import type { WorkItemRow } from '@/lib/work-items/types';

/** Comma-separated values, as the filter system and the API both spell them. */
export interface WorkItemListFilters {
    projectId?: string;
    teamId?: string;
    stateId?: string;
    stateCategory?: string;
    typeId?: string;
    priority?: string;
    labelId?: string;
    assigneeId?: string;
    parentId?: string;
    due?: string;
    q?: string;
    order?: 'manual' | 'updated';
}

export const LIST_FILTER_KEYS = [
    'projectId',
    'teamId',
    'stateId',
    'stateCategory',
    'typeId',
    'priority',
    'labelId',
    'assigneeId',
    'parentId',
    'due',
    'q',
    'order',
] as const satisfies ReadonlyArray<keyof WorkItemListFilters>;

/** Drop empty values, so `{ q: '' }` and `{}` are one cache key. */
export function normaliseFilters(filters: WorkItemListFilters): WorkItemListFilters {
    const out: WorkItemListFilters = {};
    for (const key of LIST_FILTER_KEYS) {
        const value = filters[key];
        if (typeof value === 'string' && value.trim() !== '') (out as Record<string, string>)[key] = value.trim();
    }
    return out;
}

/** The query string, keys in a fixed order so equal filters are equal keys. */
export function listQueryString(filters: WorkItemListFilters, extra: Record<string, string | undefined> = {}): string {
    const params = new URLSearchParams();
    const f = normaliseFilters(filters);
    for (const key of LIST_FILTER_KEYS) {
        const value = f[key];
        if (value) params.set(key, value);
    }
    for (const [key, value] of Object.entries(extra)) {
        if (value) params.set(key, value);
    }
    return params.toString();
}

function inList(raw: string | undefined, value: string | null): boolean | undefined {
    if (!raw) return undefined;
    const values = raw.split(',').filter(Boolean);
    if (value === null) return values.includes('none');
    return values.includes(value);
}

/**
 * Does `row` belong in a list loaded with `filters`? `unknown` when a facet
 * the client cannot evaluate is set.
 */
export function rowBelongs(filters: WorkItemListFilters, row: WorkItemRow): 'yes' | 'no' | 'unknown' {
    const f = normaliseFilters(filters);
    const checks: Array<boolean | undefined> = [
        inList(f.projectId, row.projectId),
        inList(f.teamId, row.teamId),
        inList(f.stateId, row.stateId),
        inList(f.stateCategory, row.stateCategory),
        inList(f.typeId, row.typeId),
        inList(f.priority, row.priority),
        inList(f.assigneeId, row.assigneeId),
        inList(f.parentId, row.parentId),
        f.labelId ? f.labelId.split(',').some((id) => row.labelIds.includes(id)) : undefined,
    ];
    if (checks.some((c) => c === false)) return 'no';
    if (f.q || f.due) return 'unknown';
    return 'yes';
}

/** Byte-wise key order (`COLLATE "C"`, ADR 0002 §5): never `localeCompare`. */
export function compareSortKeys(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** Where a row sits in a list of the given order. */
export function compareRows(order: 'manual' | 'updated' | undefined, a: WorkItemRow, b: WorkItemRow): number {
    if (order === 'updated') {
        return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : compareSortKeys(b.id, a.id);
    }
    return compareSortKeys(a.sortKey, b.sortKey) || compareSortKeys(a.id, b.id);
}
