'use client';

/**
 * The calendar's read (roadmap 3.3a): `GET /work-items/calendar` with the
 * list's filters and the month grid's window, in the one SWR cache. It reads
 * the whole window at once (at most 2,000 items), so it does not page
 * through `useWorkItemList`. It registers with `work-item-cache.ts`: a write
 * in any view places the changed row here (`placeRowInCalendar`, with the
 * list's own `rowBelongs`); a row the calendar does not hold that may now be
 * due in its window re-reads it, and so does every list re-read.
 *
 * A 422 `CALENDAR_TOO_LARGE` is not an error to retry: `tooLarge` carries the
 * count, and the page asks to narrow the filter.
 *
 * Written fresh for Islestone.
 */
import { useEffect, useMemo, useRef } from 'react';

import { ApiClientError } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import { CALENDAR_TOO_LARGE, type CalendarResponse, type CalendarTooLargeDetails } from '@/lib/work-items/calendar';

import { listQueryString, normaliseFilters, type WorkItemListFilters } from './list-filters';
import { registerWorkItemCalendar } from './work-item-cache';

export interface WorkItemCalendarResult {
    data: CalendarResponse | undefined;
    isLoading: boolean;
    error: Error | undefined;
    /** The window holds more items than the calendar shows: the count. */
    tooLarge: CalendarTooLargeDetails | null;
    revalidate: () => void;
}

/** The calendar's tenant-relative path for a set of list filters and a window (the order does not apply). */
export function calendarPath(filters: WorkItemListFilters, range: { from: string; to: string }): string {
    const { order: _order, dir: _dir, ...rest } = normaliseFilters(filters);
    void _order;
    void _dir;
    const query = listQueryString(rest);
    return `/work-items/calendar?${query ? `${query}&` : ''}from=${range.from}&to=${range.to}`;
}

function tooLargeOf(error: unknown): CalendarTooLargeDetails | null {
    if (!(error instanceof ApiClientError) || error.code !== CALENDAR_TOO_LARGE) return null;
    const d = error.details as Partial<CalendarTooLargeDetails> | undefined;
    if (!d || typeof d.count !== 'number' || typeof d.limit !== 'number') return null;
    return { reason: CALENDAR_TOO_LARGE, count: d.count, limit: d.limit };
}

export function useWorkItemCalendar(filters: WorkItemListFilters, range: { from: string; to: string }, options: { enabled?: boolean } = {}): WorkItemCalendarResult {
    const { enabled = true } = options;
    const path = useMemo(() => calendarPath(filters, range), [filters, range]);
    const { data, error, isLoading, mutate } = useTenantSWR<CalendarResponse>(enabled ? path : null, {
        // A new month's or filter's failure must never show the previous one's items.
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
        return registerWorkItemCalendar({
            filters,
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
    }, [enabled, path, filters]);

    const tooLarge = tooLargeOf(error);
    return {
        data,
        isLoading,
        error: error && !tooLarge ? error : undefined,
        tooLarge,
        revalidate: () => void mutate(),
    };
}
