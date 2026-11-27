'use client';

/**
 * Time entries and the timer in the browser (sub-phase 3.4b; owner decisions
 * 262, 263 and 277): the one place the Time pages, the item's Time panel and
 * the top chrome read and write time.
 *
 *   - Reads through `use-tenant-swr.ts` at the routes' own paths: a week
 *     (`/time-entries?week=`), the running timer (`/time-entries/timer`, read
 *     again on window focus, so a timer started on another device shows
 *     within one focus). An item's time is `useWorkItemTime` in the
 *     work-item data folder.
 *   - Writes through `apiSend`; a change sends the entry's version as
 *     `If-Match`. A delete (and discarding a running timer) goes through the
 *     undo toast and is sent from inside its action
 *     (`tests/guards/undo-toast-coverage.test.ts`). After any write, every
 *     mounted time read is read again (`revalidateTime`): a week, the timer
 *     and an item's time all move together.
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
import type { RunningTimerData, TimeEntryData, TimeWeekData } from '@/lib/time/entries';

export const TIME_WEEK_PATH = (week: string) => `/time-entries?week=${encodeURIComponent(week)}`;
export const TIMER_PATH = '/time-entries/timer';
export const WORK_ITEM_TIME_PATH = (itemId: string) => `/work-items/${encodeURIComponent(itemId)}/time`;

/** Whether an SWR key is one of the time reads. */
export function isTimeKey(key: unknown): boolean {
    if (typeof key !== 'string') return false;
    return key.includes('/time-entries') || /\/work-items\/[^/?]+\/time(?:\?|$)/.test(key);
}

/** One person's week (one's own unless `userId`). */
export function useTimeWeek(week: string | null, userId?: string) {
    const path = week ? `${TIME_WEEK_PATH(week)}${userId ? `&userId=${encodeURIComponent(userId)}` : ''}` : null;
    return useTenantSWR<TimeWeekData>(path);
}

/** The caller's running timer, read again whenever the window gains focus; `enabled` false reads nothing. */
export function useRunningTimer(enabled: boolean) {
    return useTenantSWR<{ timer: RunningTimerData | null }>(enabled ? TIMER_PATH : null, { revalidateOnFocus: true, dedupingInterval: 2_000 });
}

export interface AddTimeInput {
    workItemId: string;
    workDate: string;
    minutes: number;
    billable?: boolean;
    description?: string | null;
}

export interface ChangeTimeInput {
    workItemId?: string;
    workDate?: string;
    minutes?: number;
    billable?: boolean;
    description?: string | null;
}

/** The refusal's reason, or a fallback. */
function reasonOf(err: unknown): string | undefined {
    return err instanceof ApiClientError ? (err.refusalReason ?? err.reason) : undefined;
}

export function useTimeWrites() {
    const apiUrl = useTenantApiUrl();
    const { mutate } = useSWRConfig();
    const toast = useToast();
    const triggerUndo = useToastWithUndo();
    const t = useTranslations('time.writes');

    const revalidateTime = useCallback(() => mutate((key) => isTimeKey(key)), [mutate]);

    const add = useCallback(
        async (input: AddTimeInput): Promise<TimeEntryData | ApiClientError> => {
            try {
                const entry = await apiSend<TimeEntryData>('POST', apiUrl('/time-entries'), input);
                await revalidateTime();
                return entry;
            } catch (err) {
                if (err instanceof ApiClientError) return err;
                throw err;
            }
        },
        [apiUrl, revalidateTime],
    );

    const change = useCallback(
        async (entry: Pick<TimeEntryData, 'id' | 'version'>, input: ChangeTimeInput): Promise<TimeEntryData | ApiClientError> => {
            try {
                const next = await apiSend<TimeEntryData>('PATCH', apiUrl(`/time-entries/${encodeURIComponent(entry.id)}`), input, { ifMatch: entry.version });
                await revalidateTime();
                return next;
            } catch (err) {
                if (err instanceof ApiClientError) {
                    // Someone (another tab) changed it: show the server's state.
                    if (err.status === 409) await revalidateTime();
                    return err;
                }
                throw err;
            }
        },
        [apiUrl, revalidateTime],
    );

    /** Delete one's own entry (decision 277), or discard a running timer, held behind the undo toast. */
    const remove = useCallback(
        (entry: Pick<TimeEntryData, 'id'>, message?: string) => {
            triggerUndo({
                message: message ?? t('deleted'),
                undoMessage: t('undo'),
                action: () => apiSend('DELETE', apiUrl(`/time-entries/${encodeURIComponent(entry.id)}`)),
                undoAction: () => {
                    void revalidateTime();
                },
                onCommit: () => {
                    void revalidateTime();
                },
                onError: (err) => {
                    void revalidateTime();
                    toast.error(reasonOf(err) ?? t('failed'));
                },
            });
        },
        [triggerUndo, t, apiUrl, revalidateTime, toast],
    );

    const startTimer = useCallback(
        async (workItemId: string): Promise<RunningTimerData | ApiClientError> => {
            try {
                const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                const timer = await apiSend<RunningTimerData>('POST', apiUrl(TIMER_PATH), { workItemId, timeZone });
                await revalidateTime();
                return timer;
            } catch (err) {
                if (err instanceof ApiClientError) return err;
                throw err;
            }
        },
        [apiUrl, revalidateTime],
    );

    const stopTimer = useCallback(
        async (minutes?: number): Promise<{ entry: TimeEntryData | null; discarded: boolean } | ApiClientError> => {
            try {
                const out = await apiSend<{ entry: TimeEntryData | null; discarded: boolean }>('POST', apiUrl(`${TIMER_PATH}/stop`), minutes === undefined ? {} : { minutes });
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
        [apiUrl, revalidateTime],
    );

    return useMemo(() => ({ add, change, remove, startTimer, stopTimer, revalidateTime }), [add, change, remove, startTimer, stopTimer, revalidateTime]);
}
