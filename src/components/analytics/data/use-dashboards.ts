'use client';

/**
 * Dashboards' reads and writes (sub-phase 3.6d; docs/porting/maps/3.6.md,
 * "Editing"; owner decisions 326 to 328). Reads through `use-tenant-swr.ts`
 * at the routes' own paths; every write through `apiSend`, the layout's with
 * the dashboard's version as `If-Match`. A dashboard's delete is sent from
 * inside the undo toast (`SITE_CONTRACTS`); so is a widget's removal, which
 * is a layout write without it.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { useSWRConfig } from 'swr';

import { useToast, useToastWithUndo } from '@/components/ui/hooks';
import { ApiClientError, apiSend } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import type { DashboardData, DashboardListResponse, DashboardVisibilityName, DashboardWidgetData } from '@/lib/analytics/dashboard';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';

export const DASHBOARD_PATHS = {
    list: () => '/dashboards',
    one: (id: string) => `/dashboards/${encodeURIComponent(id)}`,
    widgets: (id: string) => `/dashboards/${encodeURIComponent(id)}/widgets`,
};

export function useDashboardList() {
    return useTenantSWR<DashboardListResponse>(DASHBOARD_PATHS.list());
}

export function useDashboard(id: string | null) {
    return useTenantSWR<DashboardData>(id ? DASHBOARD_PATHS.one(id) : null);
}

/** A widget as a layout write sends it: what it is, its title and its place (its id when it is already on the dashboard). */
export function widgetInputOf(w: DashboardWidgetData, keepId = true) {
    if (!w.shape) return null;
    return { ...(keepId ? { id: w.id } : {}), type: w.shape.type, config: w.shape.config, title: w.title, position: w.position, size: w.size };
}

/** The server's dashboard a version conflict carries, or null. */
export function conflictDashboard(err: unknown): DashboardData | null {
    if (!(err instanceof ApiClientError) || err.status !== 409 || err.refusalReason !== 'VERSION_CONFLICT') return null;
    const d = (err.details as { dashboard?: DashboardData } | undefined)?.dashboard;
    return d ?? null;
}

export function useDashboardWrites() {
    const apiUrl = useTenantApiUrl();
    const { mutate } = useSWRConfig();
    const triggerUndo = useToastWithUndo();
    const toast = useToast();
    const t = useTranslations('analytics.dashboards');
    const listUrl = apiUrl(DASHBOARD_PATHS.list());

    const placeDashboard = useCallback(
        async (d: DashboardData) => {
            await mutate(apiUrl(DASHBOARD_PATHS.one(d.id)), d, { revalidate: false });
            await mutate(listUrl);
        },
        [apiUrl, listUrl, mutate],
    );

    /** Save a dashboard (personal or shared), with widgets when copying one ("Customise", "Duplicate"). */
    const create = useCallback(
        async (input: { name: string; visibility: DashboardVisibilityName; widgets?: DashboardWidgetData[] }) => {
            const widgets = (input.widgets ?? []).map((w) => widgetInputOf(w, false)).filter((w): w is NonNullable<typeof w> => w !== null);
            const created = await apiSend<DashboardData>('POST', listUrl, { name: input.name, visibility: input.visibility, widgets });
            await placeDashboard(created);
            return created;
        },
        [listUrl, placeDashboard],
    );

    /** Rename, share or unshare, on the version read. */
    const update = useCallback(
        async (d: DashboardData, change: { name?: string; visibility?: DashboardVisibilityName }) => {
            const next = await apiSend<DashboardData>('PATCH', apiUrl(DASHBOARD_PATHS.one(d.id)), change, { ifMatch: d.version });
            await placeDashboard(next);
            return next;
        },
        [apiUrl, placeDashboard],
    );

    /** Replace the widgets on the version read; a conflict throws, carrying the server's dashboard (`conflictDashboard`). */
    const setWidgets = useCallback(
        async (id: string, version: number, widgets: readonly DashboardWidgetData[]) => {
            const body = { widgets: widgets.map((w) => widgetInputOf(w)).filter((w): w is NonNullable<typeof w> => w !== null) };
            const next = await apiSend<DashboardData>('PUT', apiUrl(DASHBOARD_PATHS.widgets(id)), body, { ifMatch: version });
            await mutate(apiUrl(DASHBOARD_PATHS.one(id)), next, { revalidate: false });
            return next;
        },
        [apiUrl, mutate],
    );

    /** Delete a dashboard through the undo toast; the DELETE is sent when the window closes. */
    const remove = useCallback(
        (d: { id: string; name: string }, hooks: { onLeave?: () => void; onUndo?: () => void } = {}) => {
            hooks.onLeave?.();
            triggerUndo({
                message: t('deletedToast', { name: d.name }),
                undoMessage: t('undo'),
                action: () => apiSend('DELETE', apiUrl(DASHBOARD_PATHS.one(d.id))),
                undoAction: () => hooks.onUndo?.(),
                onCommit: () => {
                    void mutate(listUrl);
                },
                onError: () => {
                    hooks.onUndo?.();
                    void mutate(listUrl);
                    toast.error(t('failed'));
                },
            });
        },
        [apiUrl, listUrl, mutate, t, toast, triggerUndo],
    );

    /**
     * Remove a widget through the undo toast: it leaves the grid at once
     * (`onLeave`), and the layout write without it (`commit`, which reads the
     * page's current widgets) is sent when the window closes; Undo puts it back.
     */
    const removeWidget = useCallback(
        (title: string, hooks: { onLeave: () => void; onUndo: () => void; commit: () => Promise<unknown> }) => {
            hooks.onLeave();
            triggerUndo({
                message: t('widgetRemoved', { name: title }),
                undoMessage: t('undo'),
                action: () => hooks.commit(),
                undoAction: () => hooks.onUndo(),
                onError: () => {
                    hooks.onUndo();
                    toast.error(t('failed'));
                },
            });
        },
        [t, toast, triggerUndo],
    );

    return useMemo(() => ({ create, update, setWidgets, remove, removeWidget }), [create, update, setWidgets, remove, removeWidget]);
}
