'use client';

/**
 * Intake's reads and writes (sub-phase 2.6a). Reads go through the tenant
 * SWR cache (`use-tenant-swr.ts`) at the routes' own paths; writes go through
 * `apiSend` and then revalidate the reads they change. Every triage write
 * sends the version the person read in `If-Match`. Nothing here decides who
 * may write: the pages receive `IntakeAffordances`, asked on the server.
 *
 * Written fresh for Islestone.
 */
import { useCallback } from 'react';
import { useSWRConfig } from 'swr';

import { ApiClientError, apiSend } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import type {
    IntakeBlockedSenderView,
    IntakeFormData,
    IntakeRequestDetail,
    IntakeRequestPage,
    IntakeView,
    OpenIntakeForm,
    ProjectIntakeSettings,
} from '@/lib/intake/types';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';

export const INTAKE_PATHS = {
    requests: (view: IntakeView, projectId?: string) =>
        `/intake/requests?view=${view}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}&limit=100`,
    request: (id: string) => `/intake/requests/${encodeURIComponent(id)}`,
    count: '/intake/requests/count',
    forms: '/intake/forms?includeArchived=1',
    openForms: '/intake/open-forms',
    projects: '/intake/projects',
    blockedSenders: '/intake/blocked-senders',
} as const;

export const useIntakeRequests = (view: IntakeView, projectId?: string) => useTenantSWR<IntakeRequestPage>(INTAKE_PATHS.requests(view, projectId));
export const useIntakeRequest = (id: string | null) => useTenantSWR<IntakeRequestDetail>(id ? INTAKE_PATHS.request(id) : null);
export const useIntakeForms = (enabled = true) => useTenantSWR<IntakeFormData[]>(enabled ? INTAKE_PATHS.forms : null);
export const useOpenIntakeForms = () => useTenantSWR<OpenIntakeForm[]>(INTAKE_PATHS.openForms);
export const useProjectIntakes = (enabled = true) => useTenantSWR<ProjectIntakeSettings[]>(enabled ? INTAKE_PATHS.projects : null);
export const useBlockedSenders = (enabled = true) => useTenantSWR<IntakeBlockedSenderView[]>(enabled ? INTAKE_PATHS.blockedSenders : null);
export const usePendingIntakeCount = (enabled: boolean) =>
    useTenantSWR<{ total: number; byProject: Record<string, number> }>(enabled ? INTAKE_PATHS.count : null, { refreshInterval: 60_000 });

/** The refusal a person reads: the server's sentence, or `fallback`. */
export function intakeRefusal(err: unknown, fallback: string): string {
    return err instanceof ApiClientError && err.reason ? err.reason : fallback;
}

/**
 * The writes, each followed by a revalidation of every intake read (lists,
 * counts, the request's detail), so the page and the sidebar agree.
 */
export function useIntakeApi() {
    const apiUrl = useTenantApiUrl();
    const { mutate } = useSWRConfig();
    const prefix = apiUrl('/intake/');
    const revalidateIntake = useCallback(() => mutate((key) => typeof key === 'string' && key.startsWith(prefix)), [mutate, prefix]);
    const send = useCallback(
        async <T = unknown>(method: 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown, ifMatch?: number): Promise<T> => {
            const result = await apiSend<T>(method, apiUrl(path), body, ifMatch !== undefined ? { ifMatch } : {});
            await revalidateIntake();
            return result;
        },
        [apiUrl, revalidateIntake],
    );
    return { send, revalidateIntake };
}
