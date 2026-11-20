'use client';

/**
 * The one place a work-item change reaches every view that shows the item:
 * the list's loaded pages, each board column's pages, the sub-items table,
 * and the detail (page or sheet). Every view reads through the same hooks
 * (`useWorkItemList`, `useWorkItem`), which keep their data in the one SWR
 * cache; this module is how a mutation writes into it.
 *
 *   - `applyRow(row)` puts a row where it belongs in every loaded list: out of
 *     the lists it no longer matches (a board column it left), into the ones
 *     it now matches at its order (the column it entered), in place where the
 *     client cannot tell (free text, due windows). The server's answer then
 *     replaces the optimistic row, so the server's `sortKey` and `version`
 *     win.
 *   - `removeRow(id)` takes it out of every list (an optimistic delete).
 *   - `revalidateLists()` / `revalidateItem(id)` re-read after a rollback or a
 *     bulk change, so what is on screen is what the server holds.
 *
 * `useSWRInfinite` keeps its pages under a `$inf$` key that SWR's
 * filter-`mutate` skips, so each list registers its own `mutate` here while
 * it is mounted. Registration happens in an effect: nothing runs on the
 * server.
 *
 * Written fresh for Islestone (sub-phase 2.3); it hoists what
 * inflect-compliance's tasks client (`invalidateAllTasks`) and task detail
 * page (`invalidateTaskLists`) each did for their own surface, which the
 * source itself said should be one hook.
 */
import { useMemo } from 'react';
import { useSWRConfig } from 'swr';

import type { WorkItemDetailData, WorkItemPage, WorkItemRow } from '@/lib/work-items/types';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';

import { compareRows, rowBelongs, type WorkItemListFilters } from './list-filters';

export interface RegisteredList {
    filters: WorkItemListFilters;
    /** Apply a change to the list's pages without a refetch. */
    update: (fn: (pages: WorkItemPage[]) => WorkItemPage[]) => void;
    /** Refetch the list's loaded pages. */
    revalidate: () => void;
}

const lists = new Set<RegisteredList>();

/** Register a mounted list; returns the unregister function. */
export function registerWorkItemList(list: RegisteredList): () => void {
    lists.add(list);
    return () => {
        lists.delete(list);
    };
}

/** The lists mounted now (tests read it). */
export function registeredWorkItemListCount(): number {
    return lists.size;
}

function withoutRow(pages: WorkItemPage[], id: string): { pages: WorkItemPage[]; at: { page: number; index: number } | null } {
    let at: { page: number; index: number } | null = null;
    const next = pages.map((page, p) => {
        const index = page.items.findIndex((r) => r.id === id);
        if (index === -1) return page;
        at = { page: p, index };
        return { ...page, items: page.items.filter((r) => r.id !== id) };
    });
    return { pages: next, at };
}

/**
 * Place `row` in a list's pages (pure). A row that sorts after everything
 * loaded while more pages exist is left for the next page to bring.
 */
export function placeRow(pages: WorkItemPage[], filters: WorkItemListFilters, row: WorkItemRow): WorkItemPage[] {
    const { pages: removed, at } = withoutRow(pages, row.id);
    const belongs = rowBelongs(filters, row);
    if (belongs === 'no') return removed;
    // A sort the client cannot evaluate (2.4: due, priority, key, a field…)
    // keeps the row where it was; the next revalidation settles it.
    const clientOrdered = !filters.order || filters.order === 'manual' || filters.order === 'updated';
    if (belongs === 'unknown' || !clientOrdered) {
        if (!at) return removed;
        const { page, index } = at;
        return removed.map((p, i) => (i === page ? { ...p, items: [...p.items.slice(0, index), row, ...p.items.slice(index)] } : p));
    }
    for (let p = 0; p < removed.length; p++) {
        const page = removed[p]!;
        const index = page.items.findIndex((r) => compareRows(filters.order, row, r) < 0);
        if (index !== -1) {
            return removed.map((pg, i) => (i === p ? { ...pg, items: [...pg.items.slice(0, index), row, ...pg.items.slice(index)] } : pg));
        }
    }
    const last = removed[removed.length - 1];
    if (!last) return [{ items: [row], pageInfo: { hasNextPage: false } }];
    if (last.pageInfo.hasNextPage) return removed;
    return removed.map((pg, i) => (i === removed.length - 1 ? { ...pg, items: [...pg.items, row] } : pg));
}

export function removeRowFromPages(pages: WorkItemPage[], id: string): WorkItemPage[] {
    return withoutRow(pages, id).pages;
}

/** The detail's SWR path for an item (tenant-relative). */
export function workItemDetailPath(id: string): string {
    return `/work-items/${encodeURIComponent(id)}`;
}

export interface WorkItemCache {
    applyRow: (row: WorkItemRow, detail?: Partial<WorkItemDetailData>) => void;
    removeRow: (id: string) => void;
    /** Re-read every mounted list, or only those whose filters `match`. */
    revalidateLists: (match?: (filters: WorkItemListFilters) => boolean) => void;
    revalidateItem: (id: string) => Promise<unknown>;
    /** Revalidate one of the item's own reads (comments, watchers, …). */
    revalidatePath: (path: string) => Promise<unknown>;
    /** Write a tenant-relative key directly (the detail's sub-resources). */
    setPath: <T>(path: string, fn: (current: T | undefined) => T | undefined) => Promise<unknown>;
}

export function useWorkItemCache(): WorkItemCache {
    const { mutate, cache } = useSWRConfig();
    const apiUrl = useTenantApiUrl();
    return useMemo<WorkItemCache>(
        () => ({
            applyRow(row, detail) {
                for (const list of lists) list.update((pages) => placeRow(pages, list.filters, row));
                // Only a detail that is loaded: SWR drops an in-flight fetch's
                // answer when its key is mutated after the fetch began, so a
                // write landing while a sheet was still loading left it
                // loading for good.
                const key = apiUrl(workItemDetailPath(row.id));
                if (cache.get(key)?.data === undefined) return;
                void mutate<WorkItemDetailData>(key, (current) => (current ? { ...current, ...row, ...detail } : current), {
                    revalidate: false,
                });
            },
            removeRow(id) {
                for (const list of lists) list.update((pages) => removeRowFromPages(pages, id));
            },
            revalidateLists(match) {
                for (const list of lists) if (!match || match(list.filters)) list.revalidate();
            },
            revalidateItem(id) {
                return mutate(apiUrl(workItemDetailPath(id)));
            },
            revalidatePath(path) {
                return mutate(apiUrl(path));
            },
            setPath<T>(path: string, fn: (current: T | undefined) => T | undefined) {
                // As above: never mark a key whose first read is still in flight.
                if (cache.get(apiUrl(path))?.data === undefined) return Promise.resolve(undefined);
                return mutate<T>(apiUrl(path), fn, { revalidate: false });
            },
        }),
        [mutate, cache, apiUrl],
    );
}
