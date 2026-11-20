'use client';

/**
 * The Settings pages' reads and writes (decision 55). Reads go through the
 * tenant SWR cache (`use-tenant-swr.ts`) at the 2.2 routes' own paths, so a
 * write revalidates exactly the lists that show it; writes go through
 * `apiSend` (`src/lib/data/api-client.ts`). Nothing here decides who may
 * write: the pages receive `WorkConfigAffordances`, asked on the server.
 *
 * Written fresh for Islestone.
 */
import { useCallback } from 'react';
import { useSWRConfig } from 'swr';

import { ApiClientError, apiSend } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import type { WorkflowStateCategory } from '@/lib/work-items/types';

export interface SettingsTeam {
    id: string;
    name: string;
}

export interface SettingsState {
    id: string;
    teamId: string;
    name: string;
    category: WorkflowStateCategory;
    sortKey: string;
    isDefault: boolean;
    archivedAt: string | null;
}

export interface SettingsTeamDetail extends SettingsTeam {
    workflowStates: SettingsState[];
}

export interface SettingsType {
    id: string;
    name: string;
    archivedAt: string | null;
}

export interface SettingsLabel {
    id: string;
    teamId: string | null;
    name: string;
}

export interface SettingsProject {
    id: string;
    teamId: string;
    name: string;
    keyPrefix: string;
    archivedAt: string | null;
}

/** The tenant-relative paths each list is read from (and revalidated by). */
export const SETTINGS_PATHS = {
    teams: '/teams',
    team: (teamId: string) => `/teams/${encodeURIComponent(teamId)}`,
    types: '/work-item-types?includeArchived=1',
    labels: '/labels',
    projects: '/projects?includeArchived=1',
} as const;

export const useTeams = () => useTenantSWR<SettingsTeam[]>(SETTINGS_PATHS.teams);
export const useTeam = (teamId: string) => useTenantSWR<SettingsTeamDetail>(SETTINGS_PATHS.team(teamId));
export const useWorkItemTypes = () => useTenantSWR<SettingsType[]>(SETTINGS_PATHS.types);
export const useLabels = () => useTenantSWR<SettingsLabel[]>(SETTINGS_PATHS.labels);
export const useProjects = () => useTenantSWR<SettingsProject[]>(SETTINGS_PATHS.projects);

/** The refusal a person reads: the server's sentence, or `fallback`. */
export function refusalText(err: unknown, fallback: string): string {
    return err instanceof ApiClientError && err.reason ? err.reason : fallback;
}

/**
 * `send(method, path, body)` against the tenant's API, and `revalidate(...paths)`
 * for the lists a write changed. A refusal throws `ApiClientError`.
 */
export function useSettingsApi() {
    const apiUrl = useTenantApiUrl();
    const { mutate } = useSWRConfig();
    const send = useCallback(
        <T = unknown>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) => apiSend<T>(method, apiUrl(path), body),
        [apiUrl],
    );
    const revalidate = useCallback((...paths: string[]) => Promise.all(paths.map((p) => mutate(apiUrl(p)))), [apiUrl, mutate]);
    /** Rewrite a cache entry without a request (an optimistic step). */
    const setPath = useCallback(
        <T,>(path: string, update: (current: T | undefined) => T | undefined) =>
            mutate<T>(apiUrl(path), (current) => update(current), { revalidate: false }),
        [apiUrl, mutate],
    );
    return { send, revalidate, setPath };
}
