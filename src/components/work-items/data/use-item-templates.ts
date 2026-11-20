'use client';

/**
 * A project's live item templates (sub-phase 2.5c), for the create dialog's
 * template picker, read through `use-tenant-swr.ts` at the route's own path.
 * The item-templates manager (`src/components/templates/`) revalidates the
 * same key after each write, so the picker sees its changes.
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
import type { WorkItemTemplateData } from '@/lib/work-items/types';

export const itemTemplatesPath = (projectId: string, opts: { includeArchived?: boolean } = {}) =>
    `/projects/${encodeURIComponent(projectId)}/work-item-templates${opts.includeArchived ? '?includeArchived=1' : ''}`;

export const useItemTemplates = (projectId: string | null) => useTenantSWR<WorkItemTemplateData[]>(projectId ? itemTemplatesPath(projectId) : null);

/**
 * The item-templates manager's reads and writes (2.5c): every template of the
 * project, archived ones included; writes through `apiSend`, then both the
 * manager's list and the picker's are read again. A delete goes through the
 * undo toast (`tests/guards/undo-toast-coverage.test.ts`).
 */
export function useItemTemplateManager(projectId: string, enabled = true) {
    const path = enabled ? itemTemplatesPath(projectId, { includeArchived: true }) : null;
    const { data, error, isLoading, mutate } = useTenantSWR<WorkItemTemplateData[]>(path);
    const apiUrl = useTenantApiUrl();
    const { mutate: mutateKey } = useSWRConfig();
    const toast = useToast();
    const triggerUndo = useToastWithUndo();
    const t = useTranslations('workItems.templates');

    const refresh = useCallback(async () => {
        await Promise.all([mutate(), mutateKey(apiUrl(itemTemplatesPath(projectId)))]);
    }, [mutate, mutateKey, apiUrl, projectId]);

    const run = useCallback(
        async <T,>(method: 'POST' | 'PATCH', sub: string, body: unknown): Promise<T | ApiClientError> => {
            try {
                const out = await apiSend<T>(method, apiUrl(`${itemTemplatesPath(projectId)}${sub}`), body);
                await refresh();
                return out;
            } catch (err) {
                if (err instanceof ApiClientError) return err;
                throw err;
            }
        },
        [apiUrl, projectId, refresh],
    );

    const remove = useCallback(
        (template: WorkItemTemplateData) => {
            let before: WorkItemTemplateData[] | undefined;
            void mutate(
                (current) => {
                    before = current;
                    return current?.filter((x) => x.id !== template.id);
                },
                { revalidate: false },
            );
            triggerUndo({
                message: t('deleted', { name: template.name }),
                undoMessage: t('undo'),
                action: () => apiSend('DELETE', apiUrl(`${itemTemplatesPath(projectId)}/${encodeURIComponent(template.id)}`)),
                undoAction: () => {
                    void mutate(before, { revalidate: false });
                },
                onCommit: () => {
                    void refresh();
                },
                onError: (err) => {
                    void mutate(before, { revalidate: true });
                    toast.error(err instanceof ApiClientError && err.reason ? err.reason : t('failed'));
                },
            });
        },
        [mutate, triggerUndo, t, apiUrl, projectId, refresh, toast],
    );

    return useMemo(
        () => ({
            templates: data ?? [],
            error,
            isLoading,
            create: (input: Record<string, unknown>) => run<WorkItemTemplateData>('POST', '', input),
            update: (id: string, input: Record<string, unknown>) => run<WorkItemTemplateData>('PATCH', `/${encodeURIComponent(id)}`, input),
            remove,
        }),
        [data, error, isLoading, run, remove],
    );
}
