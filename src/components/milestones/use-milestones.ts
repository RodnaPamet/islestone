'use client';

/**
 * The milestone pages' reads and writes (sub-phase 2.5b): a project's
 * milestones with their progress, read through `use-tenant-swr.ts` at the
 * route's own path; writes through `apiSend`, then the list is read again.
 * Deleting a milestone goes through the undo toast
 * (`tests/guards/undo-toast-coverage.test.ts`): it leaves the list at once
 * and the DELETE is sent when the window closes.
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
import type { MilestoneData } from '@/lib/work-items/types';

export const MILESTONE_PATHS = {
    list: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/milestones`,
    one: (projectId: string, id: string) => `/projects/${encodeURIComponent(projectId)}/milestones/${encodeURIComponent(id)}`,
} as const;

export const useMilestones = (projectId: string, fallback?: MilestoneData[]) =>
    useTenantSWR<MilestoneData[]>(MILESTONE_PATHS.list(projectId), fallback ? { fallbackData: fallback } : {});

/** The refusal a person reads: the server's sentence, or `fallback`. */
export function milestoneRefusal(err: unknown, fallback: string): string {
    return err instanceof ApiClientError && err.reason ? err.reason : fallback;
}

export interface MilestoneFormInput {
    name: string;
    dueDate: string | null;
}

export function useMilestoneWrites(projectId: string) {
    const apiUrl = useTenantApiUrl();
    const { mutate } = useSWRConfig();
    const triggerUndo = useToastWithUndo();
    const toast = useToast();
    const t = useTranslations('milestones');
    const listUrl = apiUrl(MILESTONE_PATHS.list(projectId));

    const revalidate = useCallback(() => mutate(listUrl), [listUrl, mutate]);

    const remove = useCallback(
        (milestone: MilestoneData, shown?: MilestoneData[]) => {
            let before: MilestoneData[] | undefined;
            void mutate<MilestoneData[]>(
                listUrl,
                (current) => {
                    // Before the first read the page shows the server's list (`shown`).
                    before = current ?? shown;
                    return before?.filter((m) => m.id !== milestone.id);
                },
                { revalidate: false },
            );
            const putBack = () => mutate<MilestoneData[]>(listUrl, () => before, { revalidate: false });
            triggerUndo({
                message: t('deleted'),
                undoMessage: t('undo'),
                action: () => apiSend('DELETE', apiUrl(MILESTONE_PATHS.one(projectId, milestone.id))),
                undoAction: () => {
                    void putBack();
                },
                onCommit: () => {
                    void revalidate();
                },
                onError: (err) => {
                    void putBack().then(() => revalidate());
                    toast.error(milestoneRefusal(err, t('failed')));
                },
            });
        },
        [apiUrl, listUrl, mutate, projectId, triggerUndo, toast, t, revalidate],
    );

    return useMemo(
        () => ({
            create: async (input: MilestoneFormInput) => {
                const created = await apiSend<MilestoneData>('POST', listUrl, input);
                await revalidate();
                return created;
            },
            update: async (id: string, input: Partial<MilestoneFormInput>) => {
                const saved = await apiSend<MilestoneData>('PATCH', apiUrl(MILESTONE_PATHS.one(projectId, id)), input);
                await revalidate();
                return saved;
            },
            /** Place `id` right after or right before another milestone of the project. */
            move: async (id: string, position: { afterId: string } | { beforeId: string }) => {
                try {
                    await apiSend<MilestoneData>('PATCH', apiUrl(MILESTONE_PATHS.one(projectId, id)), { position });
                } catch (err) {
                    toast.error(milestoneRefusal(err, t('failed')));
                }
                await revalidate();
            },
            remove,
        }),
        [apiUrl, listUrl, projectId, revalidate, remove, toast, t],
    );
}
