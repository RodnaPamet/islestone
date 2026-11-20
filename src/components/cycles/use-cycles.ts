'use client';

/**
 * The cycle pages' reads and writes (sub-phase 2.5a): every team's cycles,
 * one cycle, its burn-up and a team's cycle schedule, read through
 * `use-tenant-swr.ts` at the routes' own paths; writes through `apiSend`,
 * then the lists are read again. Deleting an upcoming cycle goes through the
 * undo toast (`tests/guards/undo-toast-coverage.test.ts`): it leaves the list
 * at once and the DELETE is sent when the window closes.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { useSWRConfig } from 'swr';

import { useToast, useToastWithUndo } from '@/components/ui/hooks';
import { ApiClientError, apiSend } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import type { BurnUpData, CycleData, CycleScheduleData } from '@/lib/work-items/types';

export const CYCLE_PATHS = {
    list: '/cycles',
    one: (id: string) => `/cycles/${encodeURIComponent(id)}`,
    burnUp: (id: string) => `/cycles/${encodeURIComponent(id)}/burn-up`,
    schedule: (teamId: string) => `/teams/${encodeURIComponent(teamId)}/cycle-schedule`,
} as const;

export const useCycles = (fallback?: CycleData[]) => useTenantSWR<CycleData[]>(CYCLE_PATHS.list, fallback ? { fallbackData: fallback } : {});
export const useCycle = (id: string, fallback?: CycleData) => useTenantSWR<CycleData>(CYCLE_PATHS.one(id), fallback ? { fallbackData: fallback } : {});
export const useBurnUp = (id: string) => useTenantSWR<BurnUpData>(CYCLE_PATHS.burnUp(id));
export const useCycleSchedule = (teamId: string | null) => useTenantSWR<CycleScheduleData>(teamId ? CYCLE_PATHS.schedule(teamId) : null);

/** The refusal a person reads: the server's sentence, or `fallback`. */
export function cycleRefusal(err: unknown, fallback: string): string {
    return err instanceof ApiClientError && err.reason ? err.reason : fallback;
}

export interface CycleFormInput {
    name?: string | null;
    startsOn: string;
    endsOn: string;
}

export function useCycleWrites() {
    const apiUrl = useTenantApiUrl();
    const { mutate } = useSWRConfig();
    const triggerUndo = useToastWithUndo();
    const toast = useToast();
    const t = useTranslations('cycles');

    const revalidate = useCallback(
        (...paths: string[]) => Promise.all([CYCLE_PATHS.list, ...paths].map((p) => mutate(apiUrl(p)))),
        [apiUrl, mutate],
    );

    const remove = useCallback(
        (cycle: CycleData, shown?: CycleData[]) => {
            let before: CycleData[] | undefined;
            void mutate<CycleData[]>(
                apiUrl(CYCLE_PATHS.list),
                (current) => {
                    // Before the first read the page shows the server's list (`shown`).
                    before = current ?? shown;
                    return before?.filter((c) => c.id !== cycle.id);
                },
                { revalidate: false },
            );
            const putBack = () => mutate<CycleData[]>(apiUrl(CYCLE_PATHS.list), () => before, { revalidate: false });
            triggerUndo({
                message: t('deleted'),
                undoMessage: t('undo'),
                action: () => apiSend('DELETE', apiUrl(CYCLE_PATHS.one(cycle.id))),
                undoAction: () => {
                    void putBack();
                },
                onCommit: () => {
                    void revalidate();
                },
                onError: (err) => {
                    void putBack().then(() => revalidate());
                    toast.error(cycleRefusal(err, t('failed')));
                },
            });
        },
        [apiUrl, mutate, triggerUndo, toast, t, revalidate],
    );

    return useMemo(
        () => ({
            create: async (teamId: string, input: CycleFormInput) => {
                const created = await apiSend<CycleData>('POST', apiUrl(CYCLE_PATHS.list), { teamId, ...input });
                await revalidate();
                return created;
            },
            update: async (id: string, input: Partial<CycleFormInput>) => {
                const saved = await apiSend<CycleData>('PATCH', apiUrl(CYCLE_PATHS.one(id)), input);
                await revalidate(CYCLE_PATHS.one(id), CYCLE_PATHS.burnUp(id));
                return saved;
            },
            saveSchedule: async (teamId: string, input: Omit<CycleScheduleData, 'teamId' | 'saved'>) => {
                const saved = await apiSend<CycleScheduleData>('PUT', apiUrl(CYCLE_PATHS.schedule(teamId)), input);
                await revalidate(CYCLE_PATHS.schedule(teamId));
                return saved;
            },
            remove,
        }),
        [apiUrl, revalidate, remove],
    );
}
