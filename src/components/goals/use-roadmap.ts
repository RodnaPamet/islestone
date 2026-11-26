'use client';

/**
 * The roadmap's read (sub-phase 3.2c): `GET /roadmap` with its filters,
 * through `use-tenant-swr.ts` at the route's own path, so a goal or
 * initiative write (`useGoalWrites`, which re-reads every `/roadmap` key)
 * keeps it current. A 422 `ROADMAP_TOO_LARGE` is an answer, not a blip:
 * `tooLarge` carries the count and the page asks to narrow the filter.
 *
 * Written fresh for Islestone.
 */
import { ApiClientError } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import { ROADMAP_TOO_LARGE, roadmapQuery, type RoadmapFilters, type RoadmapResponse, type RoadmapTooLargeDetails } from '@/lib/goals/roadmap';

import { GOAL_PATHS } from './use-goals';

const WHATS: ReadonlyArray<RoadmapTooLargeDetails['what']> = ['projects', 'milestones', 'goals', 'initiatives'];

export function roadmapTooLargeOf(error: unknown): RoadmapTooLargeDetails | null {
    if (!(error instanceof ApiClientError) || error.code !== ROADMAP_TOO_LARGE) return null;
    const d = error.details as Partial<RoadmapTooLargeDetails> | undefined;
    if (!d || typeof d.count !== 'number' || typeof d.limit !== 'number') return null;
    return { reason: ROADMAP_TOO_LARGE, count: d.count, limit: d.limit, what: WHATS.includes(d.what as RoadmapTooLargeDetails['what']) ? (d.what as RoadmapTooLargeDetails['what']) : 'projects' };
}

export function useRoadmap(filters: RoadmapFilters, options: { enabled?: boolean } = {}) {
    const { enabled = true } = options;
    const { data, error, isLoading, mutate } = useTenantSWR<RoadmapResponse>(enabled ? GOAL_PATHS.roadmap(roadmapQuery(filters)) : null, {
        // A new filter's failure must never show the previous filter's rows.
        keepPreviousData: false,
        shouldRetryOnError: (err: unknown) => roadmapTooLargeOf(err) === null,
    });
    const tooLarge = roadmapTooLargeOf(error);
    return { data, isLoading, error: tooLarge ? undefined : (error as Error | undefined), tooLarge, revalidate: () => void mutate() };
}
