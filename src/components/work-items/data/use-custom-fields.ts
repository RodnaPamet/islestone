'use client';

/**
 * A project's custom-field definitions for the field manager (sub-phase
 * 2.4): `GET /projects/:id/custom-fields?includeArchived=1` and the writes,
 * each followed by a fresh read. The views render with the server page's
 * configuration, so a change here asks the page to refresh (`router.refresh`)
 * when the manager closes.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';

import { useToast, useToastWithUndo } from '@/components/ui/hooks';
import { ApiClientError, apiSend } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import type { CustomFieldType } from '@/lib/work-items/custom-fields';
import type { ViewCustomField } from '@/lib/work-items/types';

export interface ManagedOption {
    id: string;
    name: string;
    color: string | null;
    sortKey: string;
    archived: boolean;
}

export interface ManagedField {
    id: string;
    projectId: string;
    name: string;
    type: CustomFieldType;
    sortKey: string;
    archived: boolean;
    options: ManagedOption[];
}

export function useCustomFields(projectId: string, enabled = true) {
    const path = enabled ? `/projects/${projectId}/custom-fields?includeArchived=1` : null;
    const { data, error, isLoading, mutate } = useTenantSWR<ManagedField[]>(path);
    const apiUrl = useTenantApiUrl();
    const toast = useToast();
    const triggerUndo = useToastWithUndo();
    const t = useTranslations('workItems.customFields');

    const run = useCallback(
        async <T,>(method: 'POST' | 'PATCH' | 'DELETE', sub: string, body?: unknown): Promise<T | null> => {
            try {
                const out = await apiSend<T>(method, apiUrl(`/projects/${projectId}/custom-fields${sub}`), body);
                await mutate();
                return out;
            } catch (err) {
                toast.error(err instanceof ApiClientError && err.reason ? err.reason : t('failed'));
                return null;
            }
        },
        [apiUrl, projectId, mutate, toast, t],
    );

    const removeOption = useCallback(
        (field: ManagedField, option: ManagedOption) => {
            let before: ManagedField[] | undefined;
            void mutate(
                (current) => {
                    before = current;
                    return current?.map((f) => (f.id === field.id ? { ...f, options: f.options.filter((o) => o.id !== option.id) } : f));
                },
                { revalidate: false },
            );
            triggerUndo({
                message: t('optionDeleted', { name: option.name }),
                undoMessage: t('undo'),
                action: () => apiSend('DELETE', apiUrl(`/projects/${projectId}/custom-fields/${field.id}/options/${option.id}`)),
                undoAction: () => {
                    void mutate(before, { revalidate: false });
                },
                onCommit: () => {
                    void mutate();
                },
                onError: (err) => {
                    void mutate(before, { revalidate: true });
                    toast.error(err instanceof ApiClientError && err.reason ? err.reason : t('failed'));
                },
            });
        },
        [mutate, triggerUndo, t, apiUrl, projectId, toast],
    );

    return useMemo(
        () => ({
            fields: data ?? [],
            error,
            isLoading,
            createField: (input: { name: string; type: CustomFieldType; options?: Array<{ name: string }> }) => run<ManagedField>('POST', '', input),
            updateField: (fieldId: string, input: { name?: string; archived?: boolean; position?: { afterId?: string; beforeId?: string } }) =>
                run<ManagedField>('PATCH', `/${fieldId}`, input),
            addOption: (fieldId: string, name: string) => run<ManagedField>('POST', `/${fieldId}/options`, { name }),
            updateOption: (fieldId: string, optionId: string, input: { name?: string; archived?: boolean }) =>
                run<ManagedField>('PATCH', `/${fieldId}/options/${optionId}`, input),
            removeOption,
        }),
        [data, error, isLoading, run, removeOption],
    );
}

/**
 * A project's live fields for the detail (page and sheet), read from the API
 * so the detail shows them wherever it is opened, the workspace-wide list
 * included (whose page configuration carries no fields).
 */
export function useProjectCustomFields(projectId: string | undefined): ViewCustomField[] {
    const { data } = useTenantSWR<ManagedField[]>(projectId ? `/projects/${projectId}/custom-fields` : null);
    return useMemo(
        () =>
            (data ?? []).map((f) => ({
                id: f.id,
                projectId: f.projectId,
                name: f.name,
                type: f.type,
                archived: f.archived,
                options: f.options.map((o) => ({ id: o.id, name: o.name, color: o.color, archived: o.archived })),
            })),
        [data],
    );
}
