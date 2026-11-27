'use client';

/**
 * Timesheets in the browser (sub-phase 3.4c; owner decisions 256, 268 to
 * 270): the one place My time's status line, the Timesheets page and
 * Settings → Time tracking read and write timesheets and the settings.
 *
 *   - Reads through `use-tenant-swr.ts` at the routes' own paths: a week's
 *     status (`/timesheets/week?week=`), the weeks waiting for a decision or
 *     decided (`/timesheets?status=`, a page and "Load more"), one week with
 *     its entries (`/timesheets/:id`), the settings (`/time-settings`).
 *   - Writes through `apiSend`; every act on a week sends its version as
 *     `If-Match` (`tests/guards/work-item-views-shared-query.test.ts`). After
 *     any write every mounted time and timesheet read is read again
 *     (`revalidateTime`): a week's cells, its status and the lists move
 *     together. None of these acts deletes anything, so none goes through the
 *     undo toast; a return and a reopening ask for their explanation first.
 *
 * Written fresh for Islestone.
 */
import { useCallback, useMemo, useState } from 'react';
import { useSWRConfig } from 'swr';

import { ApiClientError, apiGet, apiSend } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import type { TimeSettingsData, TimesheetData, TimesheetDetailData, TimesheetListData, TimesheetListRow, TimesheetWeekData } from '@/lib/time/timesheets';

import { isTimeKey } from './use-time';

export const TIMESHEET_WEEK_PATH = (week: string, userId?: string) =>
    `/timesheets/week?week=${encodeURIComponent(week)}${userId ? `&userId=${encodeURIComponent(userId)}` : ''}`;
export const TIMESHEETS_PATH = (status: 'SUBMITTED' | 'DECIDED') => `/timesheets?status=${status}`;
export const TIMESHEET_PATH = (id: string) => `/timesheets/${encodeURIComponent(id)}`;
export const TIME_SETTINGS_PATH = '/time-settings';

/** A week's status line (one's own unless `userId`); `null` reads nothing. */
export function useTimesheetWeek(week: string | null, userId?: string) {
    return useTenantSWR<TimesheetWeekData>(week ? TIMESHEET_WEEK_PATH(week, userId) : null);
}

/** One submitted or decided week with its entries (an approver's read); `null` reads nothing. */
export function useTimesheet(id: string | null) {
    return useTenantSWR<TimesheetDetailData>(id ? TIMESHEET_PATH(id) : null);
}

/** The workspace's time tracking settings. */
export function useTimeSettings(enabled = true) {
    return useTenantSWR<TimeSettingsData>(enabled ? TIME_SETTINGS_PATH : null);
}

/**
 * The weeks waiting for a decision, or decided: the first page through the
 * cache, later pages appended by "Load more" (`loadMore`), read with the
 * page's cursor.
 */
export function useTimesheetList(status: 'SUBMITTED' | 'DECIDED') {
    const apiUrl = useTenantApiUrl();
    const first = useTenantSWR<TimesheetListData>(TIMESHEETS_PATH(status));
    const [more, setMore] = useState<{ status: string; rows: TimesheetListRow[]; nextCursor?: string; hasNextPage: boolean } | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const current = more?.status === status ? more : null;
    const rows = useMemo(() => [...(first.data?.rows ?? []), ...(current?.rows ?? [])], [first.data, current]);
    const hasNextPage = current ? current.hasNextPage : (first.data?.pageInfo.hasNextPage ?? false);
    const nextCursor = current ? current.nextCursor : first.data?.pageInfo.nextCursor;
    const loadMore = useCallback(async () => {
        if (!nextCursor) return;
        setLoadingMore(true);
        try {
            const page = await apiGet<TimesheetListData>(apiUrl(`${TIMESHEETS_PATH(status)}&cursor=${encodeURIComponent(nextCursor)}`));
            setMore({ status, rows: [...(current?.rows ?? []), ...page.rows], nextCursor: page.pageInfo.nextCursor, hasNextPage: page.pageInfo.hasNextPage });
        } finally {
            setLoadingMore(false);
        }
    }, [apiUrl, current, nextCursor, status]);
    const reset = useCallback(() => setMore(null), []);
    return { rows, error: first.error, isLoading: first.isLoading, hasNextPage, loadMore, loadingMore, reset };
}

/** Whether an SWR key is one of the timesheet reads. */
export function isTimesheetKey(key: unknown): boolean {
    return typeof key === 'string' && (key.includes('/timesheets') || key.includes('/time-settings'));
}

export function useTimesheetWrites() {
    const apiUrl = useTenantApiUrl();
    const { mutate } = useSWRConfig();

    const revalidateTime = useCallback(() => mutate((key) => isTimeKey(key) || isTimesheetKey(key)), [mutate]);

    /** Run a write; a refusal comes back as the error (its reason shown by the caller), and every time read is read again. */
    const send = useCallback(
        async <T,>(write: () => Promise<T>): Promise<T | ApiClientError> => {
            try {
                const out = await write();
                await revalidateTime();
                return out;
            } catch (err) {
                if (err instanceof ApiClientError) {
                    await revalidateTime();
                    return err;
                }
                throw err;
            }
        },
        [revalidateTime],
    );

    const submit = useCallback((week: string) => send(() => apiSend<TimesheetWeekData>('POST', apiUrl('/timesheets'), { week })), [apiUrl, send]);
    const withdraw = useCallback(
        (sheet: Pick<TimesheetData, 'id' | 'version'>) => send(() => apiSend<TimesheetData>('POST', apiUrl(`/timesheets/${encodeURIComponent(sheet.id)}/withdraw`), undefined, { ifMatch: sheet.version })),
        [apiUrl, send],
    );
    const approve = useCallback(
        (sheet: Pick<TimesheetData, 'id' | 'version'>) => send(() => apiSend<TimesheetData>('POST', apiUrl(`/timesheets/${encodeURIComponent(sheet.id)}/approve`), undefined, { ifMatch: sheet.version })),
        [apiUrl, send],
    );
    const returnWeek = useCallback(
        (sheet: Pick<TimesheetData, 'id' | 'version'>, explanation: string) =>
            send(() => apiSend<TimesheetData>('POST', apiUrl(`/timesheets/${encodeURIComponent(sheet.id)}/return`), { explanation }, { ifMatch: sheet.version })),
        [apiUrl, send],
    );
    const reopen = useCallback(
        (sheet: Pick<TimesheetData, 'id' | 'version'>, explanation: string) =>
            send(() => apiSend<TimesheetData>('POST', apiUrl(`/timesheets/${encodeURIComponent(sheet.id)}/reopen`), { explanation }, { ifMatch: sheet.version })),
        [apiUrl, send],
    );
    const saveSettings = useCallback(
        (input: { approvalRequired?: boolean; approvalRecipientListId?: string | null; currency?: string | null }, version: number) =>
            send(() => apiSend<TimeSettingsData>('PUT', apiUrl(TIME_SETTINGS_PATH), input, version > 0 ? { ifMatch: version } : undefined)),
        [apiUrl, send],
    );

    return useMemo(() => ({ submit, withdraw, approve, returnWeek, reopen, saveSettings, revalidateTime }), [submit, withdraw, approve, returnWeek, reopen, saveSettings, revalidateTime]);
}
