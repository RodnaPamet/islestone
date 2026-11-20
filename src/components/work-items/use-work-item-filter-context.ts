'use client';

/**
 * The work-item views' filter context: the filter definitions for a scope
 * (every option from the server's configuration or the roster), the shared
 * filter system synced to the URL, and the guard against a no-op URL write.
 * The list and board view (`WorkItemsView`) and My Work (`MyWorkView`) both
 * mount it, so the two pages filter alike.
 *
 * Written fresh for Islestone (sub-phase 2.3; shared with My Work by owner
 * decision 54).
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { useFilterContext, useFilters, type FilterContextValue } from '@/components/ui/filter';

import type { WorkItemListFilters } from './data/list-filters';
import { useMembers, useWorkConfig } from './data/use-work-config';
import { buildWorkItemFilterDefs, type FilterScope } from './filter-defs';

export function useWorkItemFilterContext(scope: FilterScope): {
    filterCtx: FilterContextValue;
    filterDefs: ReturnType<typeof buildWorkItemFilterDefs>['filters'];
} {
    const tFilterCtx = useTranslations('workItems');
    const config = useWorkConfig();
    const { members } = useMembers();
    const defs = useMemo(
        () => buildWorkItemFilterDefs(config, members, scope, (k, v) => tFilterCtx(k, v)),
        [config, members, scope, tFilterCtx],
    );
    const raw = useFilterContext(defs.filters, defs.filterKeys, { syncUrl: true });
    // The mirrored filter select reports its (empty) search on mount and the
    // toolbar debounces it into `setSearch`, which writes the URL with
    // `router.replace`. That no-op replace, 250 ms after the page mounts,
    // cancelled a navigation the person had just started (the palette's
    // "Go to Inbox" left them on this page). A search that does not change
    // writes nothing.
    const filterCtx = useMemo(
        () => ({
            ...raw,
            setSearch: (q: string) => {
                if (q !== raw.search) raw.setSearch(q);
            },
        }),
        [raw],
    );
    return { filterCtx, filterDefs: defs.filters };
}

/** The filter system's state as list filters (comma-joined values and the search), inside a `FilterProvider`. */
export function useListFiltersFromContext(): WorkItemListFilters {
    const { state, search } = useFilters();
    return useMemo<WorkItemListFilters>(() => {
        const joined: Record<string, string> = {};
        for (const [key, values] of Object.entries(state)) if (values.length) joined[key] = values.join(',');
        return { ...joined, q: search };
    }, [state, search]);
}
