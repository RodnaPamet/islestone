'use client';

/**
 * THE work-item list query (sub-phase 2.3). The list layout, each board
 * column and the sub-items table all read through it: cursor pages of
 * `GET /work-items` (`docs/pagination.md`) in the one SWR cache, registered
 * with `work-item-cache.ts` so a mutation in any view reaches every loaded
 * list. The detail reads `useWorkItem`, whose rows the same cache writes.
 *
 * `keepPreviousData` is OFF here: a failed fetch for new filters shows the
 * error, never the previous filters' rows.
 *
 * A change that reaches the list before its first read has answered is held
 * and applied to that answer (issue #41). Writing it at once would lose the
 * list: SWR discards the answer of a read that a mutation overlapped, and a
 * change to pages that do not exist yet writes no pages, so the list stayed
 * empty for good and a card dropped into a column still loading appeared in
 * no column. Each held change places or removes one row by id, so applying
 * it to an answer that already reflects it changes nothing.
 *
 * Written fresh for Islestone on SWR's `useSWRInfinite` (ADR 0005 §3, one
 * client cache).
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSWRConfig } from 'swr';
import useSWRInfinite, { unstable_serialize } from 'swr/infinite';

import { apiGet, type ApiClientError } from '@/lib/data/api-client';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import type { WorkItemPage, WorkItemRow } from '@/lib/work-items/types';

import { listQueryString, normaliseFilters, type WorkItemListFilters } from './list-filters';
import { registerWorkItemList } from './work-item-cache';

export interface UseWorkItemListOptions {
    /** Page size (the API caps it at 100). */
    limit?: number;
    /** `false` skips the fetch (the SWR null-key idiom). */
    enabled?: boolean;
    /** The base path; the sub-items table reads `/work-items/<id>/sub-items`. */
    path?: string;
}

export interface WorkItemListResult {
    items: WorkItemRow[];
    isLoading: boolean;
    isLoadingMore: boolean;
    error: ApiClientError | Error | undefined;
    hasMore: boolean;
    loadMore: () => void;
    revalidate: () => void;
}

export function useWorkItemList(filters: WorkItemListFilters, options: UseWorkItemListOptions = {}): WorkItemListResult {
    const { limit = 50, enabled = true, path = '/work-items' } = options;
    const apiUrl = useTenantApiUrl();
    const normalised = useMemo(() => normaliseFilters(filters), [filters]);
    const query = listQueryString(normalised, { limit: String(limit) });

    const getKey = useCallback(
        (index: number, previous: WorkItemPage | null) => {
            if (!enabled) return null;
            if (previous && !previous.pageInfo.hasNextPage) return null;
            const cursor = index === 0 ? '' : `&cursor=${encodeURIComponent(previous?.pageInfo.nextCursor ?? '')}`;
            return apiUrl(`${path}?${query}${cursor}`);
        },
        [apiUrl, enabled, path, query],
    );

    const { data, error, isLoading, isValidating, size, setSize, mutate } = useSWRInfinite<WorkItemPage, ApiClientError | Error>(
        getKey,
        (url: string) => apiGet<WorkItemPage>(url),
        {
            revalidateFirstPage: false,
            revalidateOnFocus: true,
            dedupingInterval: 5_000,
            errorRetryCount: 2,
            errorRetryInterval: 2_000,
        },
    );

    // Register with the cache while mounted. `mutate` is stable per key; the
    // filters travel with the registration so placement asks the right list.
    const mutateRef = useRef(mutate);
    useEffect(() => {
        mutateRef.current = mutate;
    }, [mutate]);
    const { cache } = useSWRConfig();
    const infiniteKey = enabled ? unstable_serialize(getKey) : null;
    /** Changes that arrived before the list's first answer, oldest first. */
    const held = useRef<Array<(pages: WorkItemPage[]) => WorkItemPage[]>>([]);
    const apply = useCallback(
        (fn?: (pages: WorkItemPage[]) => WorkItemPage[]) => {
            if (!infiniteKey || cache.get(infiniteKey)?.data === undefined) {
                if (fn) held.current.push(fn);
                return;
            }
            const fns = held.current.splice(0);
            if (fn) fns.push(fn);
            if (fns.length === 0) return;
            void mutateRef.current((pages) => (pages ? fns.reduce((acc, f) => f(acc), pages) : pages), { revalidate: false });
        },
        [cache, infiniteKey],
    );
    useEffect(() => {
        held.current = [];
        if (!enabled) return undefined;
        return registerWorkItemList({
            filters: normalised,
            update: (fn) => apply(fn),
            revalidate: () => {
                void mutateRef.current();
            },
        });
    }, [enabled, normalised, apply]);
    // The first answer is in: apply what was held for it.
    useEffect(() => {
        if (data !== undefined && held.current.length > 0) apply();
    }, [data, apply]);

    const items = useMemo(() => {
        const seen = new Set<string>();
        const out: WorkItemRow[] = [];
        for (const page of data ?? []) {
            for (const row of page.items) {
                if (seen.has(row.id)) continue;
                seen.add(row.id);
                out.push(row);
            }
        }
        return out;
    }, [data]);

    const last = data?.[data.length - 1];
    const hasMore = !!last?.pageInfo.hasNextPage;
    const isLoadingMore = isValidating && !!data && size > data.length;

    return {
        items,
        isLoading: enabled && isLoading,
        isLoadingMore,
        error,
        hasMore,
        loadMore: () => {
            if (hasMore && !isLoadingMore) void setSize(size + 1);
        },
        revalidate: () => {
            void mutate();
        },
    };
}
