'use client';

/**
 * Capacity and the workload read in the browser (sub-phases 3.5a and 3.5b;
 * owner decisions 284, 285, 297 and 298): the one place the Workload page,
 * My Work's line and Settings → Workload read the grid, a week's items, the
 * default and members' capacity, and change them.
 *
 *   - A work-item write anywhere re-reads every mounted workload read
 *     (`registerWorkload` in `work-item-cache.ts`): allocation is computed by
 *     the server, never placed in the cache.
 *   - Reads through `use-tenant-swr.ts` at the routes' own paths.
 *   - Writes through `apiSend`; a change names the version read (`If-Match`).
 *     Removing a future capacity change goes through the undo toast and is
 *     sent from inside its action (`tests/guards/undo-toast-coverage.test.ts`).
 *     After any write every mounted workload read is read again.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSWRConfig } from 'swr';

import { useToast, useToastWithUndo } from '@/components/ui/hooks';
import { ApiClientError, apiSend } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { registerWorkload } from '@/components/work-items/data/work-item-cache';
import type { Member } from '@/lib/work-items/types';
import type { MemberCapacityData, MemberCapacityHistory, WorkloadCellData, WorkloadData, WorkloadMembersData, WorkloadSettingsData } from '@/lib/workload/types';

/** The people a workload read narrows to (3.5b): never the figures of those shown. */
export interface WorkloadFilters {
    userId?: string;
    projectId?: string;
    teamId?: string;
    recipientListId?: string;
    over?: boolean;
}

export const WORKLOAD_PATH = (from: string | null, weeks: number, filters: WorkloadFilters = {}) => {
    const q = new URLSearchParams({ weeks: String(weeks) });
    if (from) q.set('from', from);
    if (filters.userId) q.set('userId', filters.userId);
    if (filters.projectId) q.set('projectId', filters.projectId);
    if (filters.teamId) q.set('teamId', filters.teamId);
    if (filters.recipientListId) q.set('recipientListId', filters.recipientListId);
    if (filters.over) q.set('over', 'true');
    return `/workload?${q.toString()}`;
};
export const WORKLOAD_CELL_PATH = (userId: string, week: string) => `/workload/cell?userId=${encodeURIComponent(userId)}&week=${encodeURIComponent(week)}`;
export const WORKLOAD_SETTINGS_PATH = '/workload-settings';
export const WORKLOAD_MEMBERS_PATH = '/workload/members';
export const MEMBER_CAPACITY_PATH = (userId: string) => `/members/${encodeURIComponent(userId)}/capacity`;

/** Whether an SWR key is one of the workload reads (time off included). */
export function isWorkloadKey(key: unknown): boolean {
    if (typeof key !== 'string') return false;
    return key.includes('/workload') || key.includes('/time-off') || /\/members\/[^/?]+\/capacity/.test(key);
}

/** A work-item write re-reads `mutate`, coalesced so a burst of writes costs one read. */
function useReReadOnWorkItemWrites(mutate: () => unknown) {
    const latest = useRef(mutate);
    useEffect(() => {
        latest.current = mutate;
    }, [mutate]);
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const unregister = registerWorkload({
            revalidate: () => {
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => {
                    timer = null;
                    void latest.current();
                }, 300);
            },
        });
        return () => {
            if (timer) clearTimeout(timer);
            unregister();
        };
    }, []);
}

export function useWorkload(from: string | null, weeks: number, filters: WorkloadFilters = {}) {
    const swr = useTenantSWR<WorkloadData>(WORKLOAD_PATH(from, weeks, filters));
    useReReadOnWorkItemWrites(swr.mutate);
    return swr;
}

/**
 * The people filter's options (3.5b): the roster the pickers read (`GET
 * /users/assignable`, the same key, so one read serves both), read only for a
 * caller who reads work items (`enabled`), so nobody else is refused by it.
 */
export function useWorkloadPeople(enabled: boolean): Member[] {
    const { data } = useTenantSWR<Member[]>(enabled ? '/users/assignable' : null);
    return useMemo(() => data ?? [], [data]);
}

/** The items that fill one person's week (3.5b); `null` reads nothing. */
export function useWorkloadCell(cell: { userId: string; week: string } | null) {
    const swr = useTenantSWR<WorkloadCellData>(cell ? WORKLOAD_CELL_PATH(cell.userId, cell.week) : null);
    useReReadOnWorkItemWrites(swr.mutate);
    return swr;
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
