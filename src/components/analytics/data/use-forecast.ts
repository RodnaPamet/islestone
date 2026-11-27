'use client';

/**
 * The forecast's read (sub-phase 3.6c; docs/porting/maps/3.6.md, "Where
 * analytics appear"): `GET /analytics/forecast` with the list's filters (its
 * order does not apply) and the forecast's own choices. A refusal is an
 * answer (a 200 with `refused`); a 422 `ANALYTICS_TOO_LARGE` is never
 * retried, and `tooLarge` carries the count.
 *
 * Written fresh for Islestone.
 */
import { listQueryString, normaliseFilters, type WorkItemListFilters } from '@/components/work-items/data/list-filters';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import type { ForecastBasedOn, ForecastResponse } from '@/lib/analytics/types';

import { tooLargeOf, type AnalyticsRead } from './use-analytics';

/** What a person may change about a forecast (decisions 318, 321 and 322); unset is the server's default. */
export interface ForecastChoices {
    historyWeeks?: 4 | 8 | 12 | 26;
    share?: 25 | 50 | 75 | 100;
    basedOn?: ForecastBasedOn;
    /** With `basedOn: 'projects'`: a subset of the scope's projects. */
    historyProjectIds?: readonly string[];
}

/** The forecast's tenant-relative path. */
export function forecastPath(filters: WorkItemListFilters, choices: ForecastChoices = {}): string {
    const { order: _order, dir: _dir, ...rest } = normaliseFilters(filters);
    void _order;
    void _dir;
    return `/analytics/forecast?${listQueryString(rest, {
        historyWeeks: choices.historyWeeks ? String(choices.historyWeeks) : undefined,
        share: choices.share ? String(choices.share) : undefined,
        basedOn: choices.basedOn,
        historyProjectIds: choices.historyProjectIds && choices.historyProjectIds.length > 0 ? [...choices.historyProjectIds].sort().join(',') : undefined,
    })}`;
}

export function useForecast(filters: WorkItemListFilters, choices: ForecastChoices = {}, enabled = true): AnalyticsRead<ForecastResponse> {
    const { data, error, isLoading } = useTenantSWR<ForecastResponse>(enabled ? forecastPath(filters, choices) : null, {
        keepPreviousData: false,
        shouldRetryOnError: (err: unknown) => tooLargeOf(err) === null,
    });
    const tooLarge = tooLargeOf(error);
    return { data: tooLarge ? undefined : data, isLoading, error: tooLarge ? undefined : (error as Error | undefined), tooLarge };
}
