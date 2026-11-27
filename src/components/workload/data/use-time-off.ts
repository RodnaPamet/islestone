'use client';

/**
 * Time off in the browser (sub-phase 3.5a; owner decisions 286 to 289 and
 * 303): the one place the Workload page's "My capacity and time off" and
 * Settings → Workload read and write a person's dates.
 *
 *   - Reads `/time-off?from&to&userId` through `use-tenant-swr.ts`. The type is
 *     on a date only when the server sent it (the person, or a holder of
 *     `workload.manage`); nothing here decides that.
 *   - Writes are batches that carry each date's version in the body (none for
 *     a new date); a 409 re-reads and names the dates. Removing dates goes
 *     through the undo toast and is sent from inside its action.
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
import type { TimeOffType } from '@/lib/workload/time-off';
import type { TimeOffData, TimeOffWriteResult } from '@/lib/workload/types';

import { isWorkloadKey } from './use-workload';

export interface TimeOffWindow extends TimeOffData {
    calendar: { workingWeekdays: number[]; holidays: string[] };
}

export const TIME_OFF_PATH = (from: string, to: string, userId?: string) =>
    `/time-off?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${userId ? `&userId=${encodeURIComponent(userId)}` : ''}`;

export function useTimeOff(from: string, to: string, userId?: string) {
    return useTenantSWR<TimeOffWindow>(TIME_OFF_PATH(from, to, userId));
}

export interface TimeOffDayWrite {
    day: string;
    minutes: number | null;
    type: TimeOffType;
    /** The version read; absent for a date with no time off yet. */
    version?: number;
}

function reasonOf(err: unknown): string | undefined {
    return err instanceof ApiClientError ? (err.refusalReason ?? err.reason) : undefined;
}

export function useTimeOffWrites(userId?: string) {
    const apiUrl = useTenantApiUrl();
    const { mutate } = useSWRConfig();
    const toast = useToast();
    const triggerUndo = useToastWithUndo();
    const t = useTranslations('workload.writes');

    const revalidate = useCallback(() => mutate((key) => isWorkloadKey(key)), [mutate]);

    /** Record or replace dates in one batch (all or nothing). */
    const setDays = useCallback(
        async (rows: readonly TimeOffDayWrite[]): Promise<TimeOffWriteResult | ApiClientError> => {
            try {
                const out = await apiSend<TimeOffWriteResult>('PUT', apiUrl('/time-off/days'), {
                    ...(userId ? { userId } : {}),
                    days: rows.map((d) => ({ day: d.day, minutes: d.minutes, type: d.type, ...(d.version !== undefined ? { version: d.version } : {}) })),
                });
                await revalidate();
                return out;
            } catch (err) {
                if (err instanceof ApiClientError) {
                    if (err.status === 409) await revalidate();
                    return err;
                }
                throw err;
            }
        },
        [apiUrl, revalidate, userId],
    );

    /** Remove dates for good, held behind the undo toast. */
    const removeDays = useCallback(
        (rows: readonly { day: string; version: number }[]) => {
            if (rows.length === 0) return;
            triggerUndo({
                message: t('timeOffRemoved', { count: rows.length }),
                undoMessage: t('undo'),
                action: () =>
                    apiSend('POST', apiUrl('/time-off/days/remove'), {
                        ...(userId ? { userId } : {}),
                        days: rows.map((d) => ({ day: d.day, version: d.version })),
                    }),
                undoAction: () => {
                    void revalidate();
                },
                onCommit: () => {
                    void revalidate();
                },
                onError: (err) => {
                    void revalidate();
                    toast.error(reasonOf(err) ?? t('failed'));
                },
            });
        },
        [triggerUndo, t, apiUrl, revalidate, toast, userId],
    );

    return useMemo(() => ({ setDays, removeDays, revalidate }), [setDays, removeDays, revalidate]);
}
