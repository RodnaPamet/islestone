'use client';

/**
 * An item's place in a series (sub-phase 2.5d): the repeat set on it and the
 * series it is an occurrence of, read through `use-tenant-swr.ts` at the
 * route's own path. Setting, changing, holding and resuming go through
 * `apiSend`, then the read is refreshed; stopping goes through the undo toast
 * (`tests/guards/undo-toast-coverage.test.ts`): the DELETE is sent when the
 * window closes. A repeat row carries no version, so no `If-Match`.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';

import { useToast, useToastWithUndo } from '@/components/ui/hooks';
import { ApiClientError, apiSend } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import type { RecurrenceData, RecurrenceFrequencyName, WorkItemSeriesData } from '@/lib/work-items/types';

export interface RepeatInput {
    frequency: RecurrenceFrequencyName;
    interval: number;
    weekdays: number[];
    endsOn: string | null;
    maxOccurrences: number | null;
    leadDays: number;
    onHold?: boolean;
}

const seriesPath = (itemId: string) => `/work-items/${encodeURIComponent(itemId)}/recurrence`;

export function useWorkItemSeries(itemId: string) {
    const path = seriesPath(itemId);
    const { data, error, isLoading, mutate } = useTenantSWR<WorkItemSeriesData>(path);
    const apiUrl = useTenantApiUrl();
    const toast = useToast();
    const triggerUndo = useToastWithUndo();
    const t = useTranslations('workItems.repeat');

    const save = useCallback(
        async (input: RepeatInput): Promise<RecurrenceData | ApiClientError> => {
            try {
                const rule = await apiSend<RecurrenceData>('PUT', apiUrl(path), input);
                await mutate();
                return rule;
            } catch (err) {
                if (err instanceof ApiClientError) return err;
                throw err;
            }
        },
        [apiUrl, path, mutate],
    );

    const stop = useCallback(() => {
        let before: WorkItemSeriesData | undefined;
        void mutate(
            (current) => {
                before = current;
                return current ? { ...current, rule: null } : current;
            },
            { revalidate: false },
        );
        triggerUndo({
            message: t('stopped'),
            undoMessage: t('undo'),
            action: () => apiSend('DELETE', apiUrl(path)),
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
    }, [mutate, triggerUndo, t, apiUrl, path, toast]);

    return useMemo(() => ({ series: data, error, isLoading, save, stop }), [data, error, isLoading, save, stop]);
}
