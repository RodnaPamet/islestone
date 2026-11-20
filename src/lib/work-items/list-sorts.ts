/**
 * The work-item list's sorts (sub-phase 2.4; `docs/pagination.md`). Each has
 * a default direction; `manual` has none (the order is the board's and the
 * list's one `sortKey`). A custom field's sort is `cf:<fieldId>`
 * (`customFieldOrder`). Client-safe.
 *
 * Written fresh for Islestone.
 */
export const LIST_SORTS = ['manual', 'updated', 'created', 'due', 'priority', 'key'] as const;
export type ListSort = (typeof LIST_SORTS)[number];

export type SortDirection = 'asc' | 'desc';

/** The direction each sort reads in when none is given. */
export const DEFAULT_SORT_DIRECTION: Record<ListSort, SortDirection> = {
    manual: 'asc',
    updated: 'desc',
    created: 'desc',
    due: 'asc',
    priority: 'asc',
    key: 'asc',
};

/** A list order as the query takes it: a named sort or `cf:<fieldId>`. */
export type ListOrder = ListSort | `cf:${string}`;

export function isListOrder(value: string): value is ListOrder {
    return (LIST_SORTS as readonly string[]).includes(value) || /^cf:[A-Za-z0-9_-]{1,64}$/.test(value);
}

/**
 * The board's swimlane groupings (2.3; cycle 2.5a, milestone 2.5b), plus a
 * custom field's (`cf:<fieldId>`, 2.4). The board's lane chooser and the
 * saved-view schema both read this one list.
 */
export const BUILT_IN_LANES = ['none', 'assignee', 'priority', 'type', 'label', 'project', 'cycle', 'milestone'] as const;
