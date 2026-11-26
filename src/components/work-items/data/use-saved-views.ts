'use client';

/**
 * Saved views (sub-phase 2.4): the views a page offers (`GET /views`, one
 * scope: a project, or the workspace's Work items page), and their writes.
 * A delete goes through the undo toast: the view leaves the menu at once and
 * the DELETE is sent from inside the toast's action
 * (`tests/guards/undo-toast-coverage.test.ts`).
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
import type { SavedViewData } from '@/lib/work-items/types';

export interface SavedViewsList {
    views: SavedViewData[];
    truncated: boolean;
}

/** `projectId` for a project's views; `null` for the workspace page's; `undefined` for every scope (the Views page). */
export function savedViewsPath(projectId: string | null | undefined): string {
    if (projectId === undefined) return '/views';
    return projectId ? `/views?projectId=${encodeURIComponent(projectId)}` : '/views?scope=workspace';
}

export interface SavedViewInput {
    name: string;
    visibility: 'PERSONAL' | 'SHARED';
    layout: 'LIST' | 'BOARD' | 'TIMELINE' | 'CALENDAR';
    config: SavedViewData['config'];
}

export function useSavedViews(projectId: string | null | undefined) {
    const path = savedViewsPath(projectId);
    const { data, error, isLoading, mutate } = useTenantSWR<SavedViewsList>(path);
    const { mutate: mutateKey } = useSWRConfig();
    const apiUrl = useTenantApiUrl();
    const toast = useToast();
    const triggerUndo = useToastWithUndo();
    const t = useTranslations('views');

    const refusal = useCallback((err: unknown) => (err instanceof ApiClientError && err.reason ? err.reason : t('failed')), [t]);
    const revalidateAll = useCallback(() => {
        void mutate();
        // The Views page lists every scope.
        void mutateKey(apiUrl('/views'));
    }, [mutate, mutateKey, apiUrl]);

    const create = useCallback(
        async (input: SavedViewInput): Promise<SavedViewData | null> => {
            try {
                const saved = await apiSend<SavedViewData>('POST', apiUrl('/views'), { ...input, projectId: projectId ?? null });
                revalidateAll();
                return saved;
            } catch (err) {
                toast.error(refusal(err));
                return null;
            }
        },
        [apiUrl, projectId, revalidateAll, toast, refusal],
    );

    const update = useCallback(
        async (id: string, input: Partial<SavedViewInput>): Promise<SavedViewData | null> => {
            try {
                const saved = await apiSend<SavedViewData>('PATCH', apiUrl(`/views/${id}`), input);
                revalidateAll();
                return saved;
            } catch (err) {
                toast.error(refusal(err));
                return null;
            }
        },
        [apiUrl, revalidateAll, toast, refusal],
    );

    const remove = useCallback(
        (view: SavedViewData) => {
            let before: SavedViewsList | undefined;
            void mutate(
                (current) => {
                    before = current;
                    return current ? { ...current, views: current.views.filter((v) => v.id !== view.id) } : current;
                },
                { revalidate: false },
            );
            triggerUndo({
                message: t('deleted', { name: view.name }),
                undoMessage: t('undo'),
                action: () => apiSend('DELETE', apiUrl(`/views/${view.id}`)),
                undoAction: () => {
                    void mutate(before, { revalidate: false });
                },
                onCommit: () => revalidateAll(),
                onError: (err) => {
                    void mutate(before, { revalidate: true });
                    toast.error(refusal(err));
                },
            });
        },
        [mutate, triggerUndo, t, apiUrl, revalidateAll, toast, refusal],
    );

    return useMemo(
        () => ({ views: data?.views ?? [], truncated: data?.truncated ?? false, error, isLoading, create, update, remove }),
        [data, error, isLoading, create, update, remove],
    );
}

/** One saved view by id (the `?view=` deep link); `null` skips the read. */
export function useSavedView(id: string | null) {
    return useTenantSWR<SavedViewData>(id ? `/views/${encodeURIComponent(id)}` : null);
}
