'use client';

/**
 * The timeline's read (roadmap 3.1b): `GET /work-items/timeline` with the
 * list's filters, in the one SWR cache. It reads the whole scope at once (at
 * most 5,000 items, decision 196), so it does not page through
 * `useWorkItemList`. It registers with `work-item-cache.ts`: a write in any
 * view places the changed row here and re-runs the scheduling engine over
 * the cached data (`placeRowInTimeline`, the module the server runs); a row
 * the timeline does not hold re-reads it.
 *
 * A 422 `TIMELINE_TOO_LARGE` is not an error to retry: `tooLarge` carries
 * the count, and the page asks to narrow the filter.
 *
 * Written fresh for Islestone.
 */
import { useEffect, useMemo, useRef } from 'react';

import { ApiClientError } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import { TIMELINE_TOO_LARGE, type TimelineResponse, type TimelineTooLargeDetails } from '@/lib/work-items/timeline';

import { listQueryString, normaliseFilters, type WorkItemListFilters } from './list-filters';
import { registerWorkItemTimeline } from './work-item-cache';

export interface WorkItemTimelineResult {
    data: TimelineResponse | undefined;
    isLoading: boolean;
    error: Error | undefined;
    /** The scope holds more than the timeline shows: the count, and what was counted. */
    tooLarge: TimelineTooLargeDetails | null;
    revalidate: () => void;
}

/** The timeline's tenant-relative path for a set of list filters (the order does not apply). */
export function timelinePath(filters: WorkItemListFilters): string {
    const { order: _order, dir: _dir, ...rest } = normaliseFilters(filters);
    void _order;
    void _dir;
    const query = listQueryString(rest);
    return query ? `/work-items/timeline?${query}` : '/work-items/timeline';
}

function tooLargeOf(error: unknown): TimelineTooLargeDetails | null {
    if (!(error instanceof ApiClientError) || error.code !== TIMELINE_TOO_LARGE) return null;
    const d = error.details as Partial<TimelineTooLargeDetails> | undefined;
    if (!d || typeof d.count !== 'number' || typeof d.limit !== 'number') return null;
    return { reason: TIMELINE_TOO_LARGE, count: d.count, limit: d.limit, what: d.what === 'relations' ? 'relations' : 'items' };
}

export function useWorkItemTimeline(filters: WorkItemListFilters, options: { enabled?: boolean } = {}): WorkItemTimelineResult {
    const { enabled = true } = options;
    const path = useMemo(() => timelinePath(filters), [filters]);
    const { data, error, isLoading, mutate } = useTenantSWR<TimelineResponse>(enabled ? path : null, {
        // A new filter's failure must never show the previous filter's rows.
        keepPreviousData: false,
        // A refusal for size is an answer, not a blip.
        shouldRetryOnError: (err: unknown) => tooLargeOf(err) === null,
    });

    const mutateRef = useRef(mutate);
    useEffect(() => {
        mutateRef.current = mutate;
    }, [mutate]);
    useEffect(() => {
        if (!enabled) return undefined;
        return registerWorkItemTimeline({
            update: (fn) => {
                let missed = false;
                void mutateRef.current(
                    (current) => {
                        if (!current) return current;
                        const next = fn(current);
                        if (next === null) {
                            missed = true;
                            return current;
                        }
                        return next;
                    },
                    { revalidate: false },
                ).then(() => {
                    if (missed) void mutateRef.current();
                });
            },
            revalidate: () => {
                void mutateRef.current();
            },
        });
    }, [enabled, path]);

    const tooLarge = tooLargeOf(error);
    return {
        data,
        isLoading,
        error: error && !tooLarge ? error : undefined,
        tooLarge,
        revalidate: () => void mutate(),
    };
}
