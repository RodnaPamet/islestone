'use client';

/**
 * Tenant-aware SWR read hook: the one client cache (ADR 0005 §3) every
 * workspace page reads through. The path is tenant-RELATIVE (`/work-items`);
 * the hook builds `/api/t/<slug>/work-items` with `useTenantApiUrl`, so the
 * same path read from two components is one cache entry, and a mutation that
 * names that key (`mutate(useTenantApiUrl()('/work-items/<id>'))`) reaches
 * every reader.
 *
 * Copied from inflect-compliance `src/lib/hooks/use-tenant-swr.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 2.3) and edited: the
 * module lives in `src/lib/data/` (outside the mirrored `src/lib/hooks`); the
 * dev-only Zod `schema` option is cut with the api-client's `validateIfDev`;
 * the docblocks name work items, not the compliance pages. The session-expiry
 * seam is reached through `apiGet`, which marks the store on a 401 (the
 * second writer `src/app/providers.tsx` names).
 */
import { useCallback, useMemo } from 'react';
import useSWR, { preload, type SWRConfiguration, type SWRResponse } from 'swr';

import { apiGet, type ApiClientError } from '@/lib/data/api-client';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';

/**
 * Defaults, each chosen on purpose:
 *
 *   - `revalidateOnFocus` and `revalidateOnReconnect`: ON, so a tab left
 *     open does not show stale work.
 *   - `keepPreviousData`: ON for single resources (a detail re-fetch keeps
 *     the item on screen). The list hook does NOT keep previous data: a
 *     failed fetch for a new filter must never show the previous filter's
 *     rows (inflect-compliance's `tasks-list-failed-filter-shows-error`).
 *   - `dedupingInterval`: 5 s, so the list, the board and the detail
 *     mounting the same key make one request.
 *   - `errorRetryCount` 2 at 2 s: a blip resolves in under 5 s without
 *     spamming.
 */
export const DEFAULT_SWR_CONFIG: SWRConfiguration = {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    keepPreviousData: true,
    dedupingInterval: 5_000,
    errorRetryCount: 2,
    errorRetryInterval: 2_000,
};

export type UseTenantSWROptions<T> = Omit<SWRConfiguration<T, ApiClientError | Error>, 'fetcher'>;

export type UseTenantSWRResult<T> = SWRResponse<T, ApiClientError | Error>;

/**
 * @param path Tenant-relative path (leading `/` optional); `null` skips the
 *             fetch (the SWR null-key idiom).
 */
export function useTenantSWR<T>(path: string | null | undefined, options: UseTenantSWROptions<T> = {}): UseTenantSWRResult<T> {
    const buildApiUrl = useTenantApiUrl();
    const key = path == null ? null : buildApiUrl(path);
    const fetcher = useCallback((url: string) => apiGet<T>(url), []);
    const overridesKey = JSON.stringify(options);
    const config = useMemo<SWRConfiguration<T, ApiClientError | Error>>(
        () => ({ ...DEFAULT_SWR_CONFIG, ...options }),
        // The overrides are compared by value: callers pass object literals.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [overridesKey],
    );
    return useSWR<T, ApiClientError | Error>(key, fetcher, config);
}

/** Warm a tenant-relative key (row hover, link prefetch). */
export function usePrefetchTenant() {
    const buildApiUrl = useTenantApiUrl();
    return useCallback(
        (path: string | null | undefined) => {
            if (!path) return;
            void preload(buildApiUrl(path), (url: string) => apiGet(url));
        },
        [buildApiUrl],
    );
}
