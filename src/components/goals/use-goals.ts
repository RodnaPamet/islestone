'use client';

/**
 * The Roadmap entry's reads and writes (sub-phase 3.2b): the goals and
 * initiatives lists, one goal's and one initiative's page, read through
 * `use-tenant-swr.ts` at the routes' own paths; writes through `apiSend`
 * (every versioned write names the version it read as `If-Match`), then
 * every goals and initiatives read is read again. Deleting a goal or an
 * initiative and taking a project off an initiative go through the undo
 * toast (`tests/guards/undo-toast-coverage.test.ts`): the row leaves at once
 * and the request is sent when the window closes.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { useSWRConfig } from 'swr';

import { useToast, useToastWithUndo } from '@/components/ui/hooks';
import { ApiClientError, apiSend } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import type { GoalData, GoalDetail, GoalStatusValue, GoalSummary, HealthValue, InitiativeData, InitiativeDetail, InitiativeSummary } from '@/lib/goals/types';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';

export const GOAL_PATHS = {
    goals: (query = '') => `/goals${query}`,
    goal: (id: string) => `/goals/${encodeURIComponent(id)}`,
    initiatives: (query = '') => `/initiatives${query}`,
    initiative: (id: string) => `/initiatives/${encodeURIComponent(id)}`,
    projectInitiative: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/initiative`,
    roadmap: (query = '') => `/roadmap${query}`,
} as const;

/** A list query from the filter state: comma-joined values, empty keys left out. */
export function listQuery(params: Record<string, string | undefined>): string {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `?${s}` : '';
}

export const useGoalList = (query: string, fallback?: { goals: GoalSummary[] }) =>
    useTenantSWR<{ goals: GoalSummary[] }>(GOAL_PATHS.goals(query), fallback ? { fallbackData: fallback } : {});
export const useInitiativeList = (query: string, fallback?: { initiatives: InitiativeSummary[] }) =>
    useTenantSWR<{ initiatives: InitiativeSummary[] }>(GOAL_PATHS.initiatives(query), fallback ? { fallbackData: fallback } : {});
export const useGoalDetail = (id: string, fallback?: GoalDetail) => useTenantSWR<GoalDetail>(GOAL_PATHS.goal(id), fallback ? { fallbackData: fallback } : {});
export const useInitiativeDetail = (id: string, fallback?: InitiativeDetail) =>
    useTenantSWR<InitiativeDetail>(GOAL_PATHS.initiative(id), fallback ? { fallbackData: fallback } : {});

/** The refusal a person reads: the server's sentence, or `fallback`. */
export function goalRefusal(err: unknown, fallback: string): string {
    return err instanceof ApiClientError && err.reason ? err.reason : fallback;
}

export interface GoalFormInput {
    title: string;
    description: string | null;
    status: GoalStatusValue;
    dueDate: string | null;
    leadUserId: string | null;
    parentId: string | null;
}

export interface InitiativeFormInput {
    name: string;
    description: string | null;
    status: GoalStatusValue;
    dueDate: string | null;
    leadUserId: string | null;
    goalId: string | null;
}

type Kind = 'goal' | 'initiative';

export function useGoalWrites() {
    const apiUrl = useTenantApiUrl();
    const { mutate } = useSWRConfig();
    const triggerUndo = useToastWithUndo();
    const toast = useToast();
    const t = useTranslations('roadmap');
    const tGoals = useTranslations('goals');
    const tInitiatives = useTranslations('initiatives');
    const goalsUrl = apiUrl(GOAL_PATHS.goals());
    const initiativesUrl = apiUrl(GOAL_PATHS.initiatives());
    const roadmapUrl = apiUrl(GOAL_PATHS.roadmap());

    /** Every goals and initiatives read (lists, pages, the roadmap) again: progress and links move together. */
    const revalidate = useCallback(
        () => mutate((key) => typeof key === 'string' && (key.startsWith(goalsUrl) || key.startsWith(initiativesUrl) || key.startsWith(roadmapUrl))),
        [goalsUrl, initiativesUrl, roadmapUrl, mutate],
    );

    const pathOf = useCallback((kind: Kind, id: string) => apiUrl(kind === 'goal' ? GOAL_PATHS.goal(id) : GOAL_PATHS.initiative(id)), [apiUrl]);

    /**
     * Delete through the undo toast: `onLeave` hides the row (or leaves the
     * page) at once; `onUndo` puts it back. The DELETE is sent when the window
     * closes.
     */
    const remove = useCallback(
        (kind: Kind, id: string, hooks: { onLeave?: () => void; onUndo?: () => void } = {}) => {
            hooks.onLeave?.();
            triggerUndo({
                message: kind === 'goal' ? tGoals('deletedToast') : tInitiatives('deletedToast'),
                undoMessage: t('undo'),
                action: () => apiSend('DELETE', pathOf(kind, id)),
                undoAction: () => hooks.onUndo?.(),
                onCommit: () => {
                    void revalidate();
                },
                onError: (err) => {
                    hooks.onUndo?.();
                    void revalidate();
                    toast.error(goalRefusal(err, t('failed')));
                },
            });
        },
        [pathOf, revalidate, t, tGoals, tInitiatives, toast, triggerUndo],
    );

    /** Take a project off an initiative through the undo toast; the PUT is sent when the window closes. */
    const unlinkProject = useCallback(
        (project: { id: string; name: string }, hooks: { onLeave?: () => void; onUndo?: () => void } = {}) => {
            hooks.onLeave?.();
            triggerUndo({
                message: tInitiatives('detail.unlinked', { project: project.name }),
                undoMessage: t('undo'),
                action: () => apiSend('PUT', apiUrl(GOAL_PATHS.projectInitiative(project.id)), { initiativeId: null }),
                undoAction: () => hooks.onUndo?.(),
                onCommit: () => {
                    void revalidate();
                },
                onError: (err) => {
                    hooks.onUndo?.();
                    void revalidate();
                    toast.error(goalRefusal(err, t('failed')));
                },
            });
        },
        [apiUrl, revalidate, t, tInitiatives, toast, triggerUndo],
    );

    return useMemo(
        () => ({
            revalidate,
            createGoal: async (input: GoalFormInput) => {
                const created = await apiSend<GoalData>('POST', goalsUrl, input);
                await revalidate();
                return created;
            },
            updateGoal: async (id: string, version: number, input: Partial<GoalFormInput>) => {
                const saved = await apiSend<GoalData>('PATCH', pathOf('goal', id), input, { ifMatch: version });
                await revalidate();
                return saved;
            },
            createInitiative: async (input: InitiativeFormInput) => {
                const created = await apiSend<InitiativeData>('POST', initiativesUrl, input);
                await revalidate();
                return created;
            },
            updateInitiative: async (id: string, version: number, input: Partial<InitiativeFormInput>) => {
                const saved = await apiSend<InitiativeData>('PATCH', pathOf('initiative', id), input, { ifMatch: version });
                await revalidate();
                return saved;
            },
            setArchived: async (kind: Kind, id: string, archived: boolean) => {
                try {
                    await apiSend('POST', `${pathOf(kind, id)}/archive`, { archived });
                } catch (err) {
                    toast.error(goalRefusal(err, t('failed')));
                }
                await revalidate();
            },
            /** Health is a person's act (decision 214); the version read is named as `If-Match`. */
            setHealth: async (kind: Kind, id: string, version: number, health: HealthValue | null) => {
                try {
                    await apiSend('PUT', `${pathOf(kind, id)}/health`, { health }, { ifMatch: version });
                    toast.success(t('healthControl.saved', { health: t(`health.${health ?? 'none'}`) }));
                } catch (err) {
                    toast.error(goalRefusal(err, t('failed')));
                }
                await revalidate();
            },
            restore: async (kind: Kind, id: string, name: string) => {
                try {
                    await apiSend('POST', `${pathOf(kind, id)}/restore`);
                    toast.success(t('restored', { name }));
                } catch (err) {
                    toast.error(goalRefusal(err, t('failed')));
                }
                await revalidate();
            },
            linkProject: async (projectId: string, initiativeId: string) => {
                await apiSend('PUT', apiUrl(GOAL_PATHS.projectInitiative(projectId)), { initiativeId });
                await revalidate();
            },
            remove,
            unlinkProject,
        }),
        [apiUrl, goalsUrl, initiativesUrl, pathOf, remove, revalidate, t, toast, unlinkProject],
    );
}
