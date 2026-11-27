'use client';

/**
 * The two dashboard pages' client halves (sub-phase 3.6d; owner decision
 * 326): the Analytics page shows the default composition, or sends the
 * viewer to the last dashboard they opened while they can still see it; a
 * dashboard's page reads it and shows it, or says it cannot be found
 * (another person's personal dashboard, or one deleted).
 *
 * Written fresh for Islestone.
 */
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useLocalStorage } from '@/components/ui/hooks';
import { ApiClientError } from '@/lib/data/api-client';
import type { DashboardPageAffordances } from '@/lib/analytics/dashboard';
import { useTenantHref } from '@/lib/tenant-context-provider';

import { useDashboard, useDashboardList } from '../data/use-dashboards';
import { DEFAULT_ID, DashboardView, LAST_DASHBOARD_KEY } from './DashboardView';

export function AnalyticsDashboardPage({ affordances, today }: { affordances: DashboardPageAffordances; today: string }) {
    const router = useRouter();
    const href = useTenantHref();
    const [last] = useLocalStorage<string>(LAST_DASHBOARD_KEY, DEFAULT_ID);
    const list = useDashboardList();
    const remembered = last !== DEFAULT_ID && list.data?.dashboards.some((d) => d.id === last) ? last : null;
    useEffect(() => {
        if (remembered) router.replace(href(`/analytics/dashboards/${remembered}`));
    }, [remembered, router, href]);
    return <DashboardView dashboard={null} affordances={affordances} today={today} />;
}

export function SavedDashboardPage({ id, affordances, today, startEditing }: { id: string; affordances: DashboardPageAffordances; today: string; startEditing: boolean }) {
    const t = useTranslations('analytics.dashboards');
    const { data, error } = useDashboard(id);
    if (error) {
        const gone = error instanceof ApiClientError && error.status === 404;
        return (
            <DashboardLayout header={{ title: t('notFoundTitle'), back: { smart: true } }} data-testid="analytics-page">
                <p role={gone ? 'status' : 'alert'} className="text-sm text-content-muted">
                    {gone ? t('notFound') : t('failed')}
                </p>
            </DashboardLayout>
        );
    }
    if (!data) {
        return (
            <DashboardLayout header={{ title: t('loadingTitle'), back: { smart: true } }} data-testid="analytics-page">
                <p className="text-sm text-content-muted">{t('loading')}</p>
            </DashboardLayout>
        );
    }
    return <DashboardView key={data.id} dashboard={data} affordances={affordances} today={today} startEditing={startEditing} />;
}
