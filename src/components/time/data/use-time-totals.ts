'use client';

/**
 * Time totals, the export and billable rates in the browser (sub-phase 3.4d;
 * owner decisions 271 to 275): the one place the Time totals page, Settings
 * → Time tracking and a project's rates read and write them.
 *
 *   - Reads through `use-tenant-swr.ts` at the routes' own paths: the totals
 *     (`/time-totals?…`), every rate (`/billable-rates`, `time.rates` only).
 *   - The export is a download (`apiGetFile`): a refusal (too many rows) comes
 *     back as an error to show, never a downloaded error page.
 *   - Writes through `apiSend`, then every rate and totals read is read again.
 *     Removing a future rate is sent from inside the undo toast's action
 *     (`removeRate`; `tests/guards/undo-toast-coverage.test.ts`).
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { useSWRConfig } from 'swr';

import { useToast, useToastWithUndo } from '@/components/ui/hooks';
import { ApiClientError, apiGetFile, apiSend } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import type { BillableRateData, BillableRatesData, TimeExportFormat, TimeTotalsData, TimeTotalsFilter, TimeTotalsGroupBy } from '@/lib/time/totals';

import { isTimeKey } from './use-time';
import { isTimesheetKey } from './use-timesheets';

export const BILLABLE_RATES_PATH = '/billable-rates';

function filterQuery(filter: TimeTotalsFilter): string {
    const q = new URLSearchParams({ from: filter.from, to: filter.to });
    if (filter.projectId) q.set('projectId', filter.projectId);
    if (filter.userId) q.set('userId', filter.userId);
    if (filter.billable !== undefined) q.set('billable', String(filter.billable));
    return q.toString();
}

export const TIME_TOTALS_PATH = (filter: TimeTotalsFilter, groupBy: TimeTotalsGroupBy) => `/time-totals?${filterQuery(filter)}&groupBy=${groupBy}`;
export const TIME_EXPORT_PATH = (filter: TimeTotalsFilter, format: TimeExportFormat) => `/time-totals/export?${filterQuery(filter)}&format=${format}`;

/** Time totals for a filter and a grouping. */
export function useTimeTotals(filter: TimeTotalsFilter, groupBy: TimeTotalsGroupBy) {
    return useTenantSWR<TimeTotalsData>(TIME_TOTALS_PATH(filter, groupBy));
}

/** Every rate of the workspace (`time.rates` only); `enabled` false reads nothing. */
export function useBillableRates(enabled = true) {
    return useTenantSWR<BillableRatesData>(enabled ? BILLABLE_RATES_PATH : null);
}

/** Whether an SWR key is a rates or totals read. */
export function isRatesKey(key: unknown): boolean {
    return typeof key === 'string' && (key.includes('/billable-rates') || key.includes('/time-totals') || key.includes('/projects'));
}

/** Save `blob` as a file the browser downloads. */
function saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

export function useTimeTotalsActions() {
    const apiUrl = useTenantApiUrl();
    const { mutate } = useSWRConfig();
    const triggerUndo = useToastWithUndo();
    const toast = useToast();
    const t = useTranslations('time.rates');
    const revalidate = useCallback(() => mutate((key) => isRatesKey(key) || isTimeKey(key) || isTimesheetKey(key)), [mutate]);

    const send = useCallback(
        async <T,>(write: () => Promise<T>): Promise<T | ApiClientError> => {
            try {
                const out = await write();
                await revalidate();
                return out;
            } catch (err) {
                if (err instanceof ApiClientError) return err;
                throw err;
            }
        },
        [revalidate],
    );

    /** Download the export; resolves to a refusal to show, or null. */
    const exportEntries = useCallback(
        async (filter: TimeTotalsFilter, format: TimeExportFormat): Promise<ApiClientError | null> => {
            try {
                const { blob, filename } = await apiGetFile(apiUrl(TIME_EXPORT_PATH(filter, format)));
                saveBlob(blob, filename ?? `time-entries.${format}`);
                return null;
            } catch (err) {
                if (err instanceof ApiClientError) return err;
                throw err;
            }
        },
        [apiUrl],
    );

    /** Set a rate for a date at a level: the workspace's, a project's or a member's. */
    const setRate = useCallback(
        (scope: { level: 'WORKSPACE' } | { level: 'PROJECT'; projectId: string } | { level: 'MEMBER'; userId: string }, input: { effectiveFrom: string; hourlyRateMinor: number | null }) => {
            const path =
                scope.level === 'WORKSPACE'
                    ? '/billable-rates/workspace'
                    : scope.level === 'PROJECT'
                      ? `/projects/${encodeURIComponent(scope.projectId)}/billable-rates`
                      : `/members/${encodeURIComponent(scope.userId)}/billable-rates`;
            return send(() => apiSend<BillableRateData>('PUT', apiUrl(path), input));
        },
        [apiUrl, send],
    );

    /** Remove a future rate, sent from inside the undo toast's action: nothing leaves until the undo window closes. */
    const removeRate = useCallback(
        (rate: Pick<BillableRateData, 'id'>) => {
            triggerUndo({
                message: t('removed'),
                undoMessage: t('undo'),
                action: () => apiSend('DELETE', apiUrl(`/billable-rates/${encodeURIComponent(rate.id)}`)),
                undoAction: () => {
                    void revalidate();
                },
                onCommit: () => {
                    void revalidate();
                },
                onError: (err) => {
                    void revalidate();
                    toast.error(err instanceof ApiClientError ? (err.reason ?? t('failed')) : t('failed'));
                },
            });
        },
        [triggerUndo, t, apiUrl, revalidate, toast],
    );

    /** Whether new entries on a project are billable by default (the project's version as `If-Match`). */
    const setBillableDefault = useCallback(
        (project: { id: string; version: number }, billableByDefault: boolean) =>
            send(() => apiSend<{ id: string; timeBillableByDefault: boolean; version: number }>('PUT', apiUrl(`/projects/${encodeURIComponent(project.id)}/billable-default`), { billableByDefault }, { ifMatch: project.version })),
        [apiUrl, send],
    );

    return useMemo(() => ({ exportEntries, setRate, removeRate, setBillableDefault, revalidate }), [exportEntries, setRate, removeRate, setBillableDefault, revalidate]);
}

/** One project's row as `GET /projects/:id` answers it (its version and billable default, 3.4d); `null` reads nothing. */
export function useProjectForTime(projectId: string | null) {
    return useTenantSWR<{ id: string; name: string; keyPrefix: string; version: number; timeBillableByDefault: boolean }>(projectId ? `/projects/${encodeURIComponent(projectId)}` : null);
}
