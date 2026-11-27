'use client';

/**
 * The Analytics page's reads (sub-phase 3.6a; docs/porting/maps/3.6.md,
 * "Where analytics appear"): one SWR key per chart (`GET /analytics/<read>`
 * with the list's filters and the window), so one slow chart never holds the
 * others. A 422 `ANALYTICS_TOO_LARGE` is an answer, not a blip: it is never
 * retried, and `tooLarge` carries what was over and the count.
 *
 * Written fresh for Islestone.
 */
import { listQueryString, normaliseFilters, type WorkItemListFilters } from '@/components/work-items/data/list-filters';
import { ApiClientError } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import {
    ANALYTICS_TOO_LARGE,
    type AnalyticsTooLargeDetails,
    type CountsResponse,
    type DurationsResponse,
    type FlowResponse,
    type ThroughputResponse,
    type WaitingResponse,
} from '@/lib/analytics/types';

export interface AnalyticsWindow {
    from: string;
    to: string;
}

type Reads = { counts: CountsResponse; throughput: ThroughputResponse; durations: DurationsResponse; flow: FlowResponse; waiting: WaitingResponse };

/** An analytics read's tenant-relative path: the list's filters (its order does not apply), the window and the read's own parameters. */
export function analyticsPath(read: keyof Reads, filters: WorkItemListFilters, window: AnalyticsWindow, extra: Record<string, string | undefined> = {}): string {
    const { order: _order, dir: _dir, ...rest } = normaliseFilters(filters);
    void _order;
    void _dir;
    const query = listQueryString(rest, { from: window.from, to: window.to, ...extra });
    return `/analytics/${read}?${query}`;
}

export function tooLargeOf(error: unknown): AnalyticsTooLargeDetails | null {
    if (!(error instanceof ApiClientError) || error.code !== ANALYTICS_TOO_LARGE) return null;
    const d = error.details as Partial<AnalyticsTooLargeDetails> | undefined;
    if (!d || typeof d.count !== 'number' || typeof d.limit !== 'number') return null;
    return { reason: ANALYTICS_TOO_LARGE, what: d.what ?? 'items', count: d.count, limit: d.limit };
}

export interface AnalyticsRead<T> {
    data: T | undefined;
    isLoading: boolean;
    error: Error | undefined;
    tooLarge: AnalyticsTooLargeDetails | null;
}

export function useAnalytics<K extends keyof Reads>(read: K, filters: WorkItemListFilters, window: AnalyticsWindow, extra: Record<string, string | undefined> = {}): AnalyticsRead<Reads[K]> {
    // A string key: equal filters and windows are one read.
    const path = analyticsPath(read, filters, window, extra);
    const { data, error, isLoading } = useTenantSWR<Reads[K]>(path, {
        // A new filter's failure must never show the previous filter's chart.
        keepPreviousData: false,
        shouldRetryOnError: (err: unknown) => tooLargeOf(err) === null,
    });
    const tooLarge = tooLargeOf(error);
    return { data: tooLarge ? undefined : data, isLoading, error: tooLarge ? undefined : (error as Error | undefined), tooLarge };
}
