'use client';

/**
 * Capacity and the workload read in the browser (sub-phase 3.5a; owner
 * decisions 284, 285 and 298): the one place the Workload page and Settings →
 * Workload read the grid, the default and members' capacity, and change them.
 *
 *   - Reads through `use-tenant-swr.ts` at the routes' own paths.
 *   - Writes through `apiSend`; a change names the version read (`If-Match`).
 *     Removing a future capacity change goes through the undo toast and is
 *     sent from inside its action (`tests/guards/undo-toast-coverage.test.ts`).
 *     After any write every mounted workload read is read again.
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
import type { MemberCapacityData, MemberCapacityHistory, WorkloadData, WorkloadMembersData, WorkloadSettingsData } from '@/lib/workload/types';

export const WORKLOAD_PATH = (from: string | null, weeks: number, userId?: string) =>
    `/workload?weeks=${weeks}${from ? `&from=${encodeURIComponent(from)}` : ''}${userId ? `&userId=${encodeURIComponent(userId)}` : ''}`;
export const WORKLOAD_SETTINGS_PATH = '/workload-settings';
export const WORKLOAD_MEMBERS_PATH = '/workload/members';
export const MEMBER_CAPACITY_PATH = (userId: string) => `/members/${encodeURIComponent(userId)}/capacity`;

/** Whether an SWR key is one of the workload reads (time off included). */
export function isWorkloadKey(key: unknown): boolean {
    if (typeof key !== 'string') return false;
    return key.includes('/workload') || key.includes('/time-off') || /\/members\/[^/?]+\/capacity/.test(key);
}

export function useWorkload(from: string | null, weeks: number, userId?: string) {
    return useTenantSWR<WorkloadData>(WORKLOAD_PATH(from, weeks, userId));
}

export function useWorkloadSettings() {
    return useTenantSWR<WorkloadSettingsData>(WORKLOAD_SETTINGS_PATH);
}

/** Settings → Workload's members (`workload.manage`); `enabled` false reads nothing. */
export function useWorkloadMembers(enabled: boolean) {
    return useTenantSWR<WorkloadMembersData>(enabled ? WORKLOAD_MEMBERS_PATH : null);
}

export function useMemberCapacity(userId: string | null) {
    return useTenantSWR<MemberCapacityHistory>(userId ? MEMBER_CAPACITY_PATH(userId) : null);
}

function reasonOf(err: unknown): string | undefined {
    return err instanceof ApiClientError ? (err.refusalReason ?? err.reason) : undefined;
}

export interface CapacityInput {
    effectiveFrom: string;
    weeklyMinutes: number;
    calendarTeamId: string | null;
}

export function useWorkloadWrites() {
    const apiUrl = useTenantApiUrl();
    const { mutate } = useSWRConfig();
    const toast = useToast();
    const triggerUndo = useToastWithUndo();
    const t = useTranslations('workload.writes');

    const revalidate = useCallback(() => mutate((key) => isWorkloadKey(key)), [mutate]);

    /** The default weekly capacity; `version` 0 (no row yet) sends no If-Match. */
    const setDefault = useCallback(
        async (defaultWeeklyMinutes: number, version: number): Promise<WorkloadSettingsData | ApiClientError> => {
            try {
                const out = await apiSend<WorkloadSettingsData>('PUT', apiUrl(WORKLOAD_SETTINGS_PATH), { defaultWeeklyMinutes }, { ifMatch: version > 0 ? version : undefined });
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
        [apiUrl, revalidate],
    );

    /** A member's capacity from a Monday; `version` names that Monday's row when one exists. */
    const setCapacity = useCallback(
        async (userId: string, input: CapacityInput, version?: number): Promise<MemberCapacityData | ApiClientError> => {
            try {
                const out = await apiSend<MemberCapacityData>('PUT', apiUrl(`/members/${encodeURIComponent(userId)}/capacity`), input, { ifMatch: version });
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
        [apiUrl, revalidate],
    );

    /** Remove a future capacity change, held behind the undo toast. */
    const removeCapacity = useCallback(
        (row: Pick<MemberCapacityData, 'id' | 'userId' | 'version'>) => {
            triggerUndo({
                message: t('capacityRemoved'),
                undoMessage: t('undo'),
                action: () => apiSend('DELETE', apiUrl(`/members/${encodeURIComponent(row.userId)}/capacity/${encodeURIComponent(row.id)}`), undefined, { ifMatch: row.version }),
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
        [triggerUndo, t, apiUrl, revalidate, toast],
    );

    return useMemo(() => ({ setDefault, setCapacity, removeCapacity, revalidate }), [setDefault, setCapacity, removeCapacity, revalidate]);
}
