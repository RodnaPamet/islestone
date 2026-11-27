'use client';

/**
 * The counts (sub-phase 3.6a; owner decision 311): open and started items
 * now, and the items done and created in the window, as figures. A dashboard
 * widget since 3.6d. Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';

import type { CountsResponse } from '@/lib/analytics/types';

import type { AnalyticsRead } from '../data/use-analytics';

export function CountsFigures({ read }: { read: AnalyticsRead<CountsResponse> }) {
    const tCounts = useTranslations('analytics.counts');
    const tChart = useTranslations('analytics.chart');
    const { data } = read;
    if (read.tooLarge) {
        return (
            <p role="status" className="text-sm text-content-muted" data-testid="analytics-counts-too-large">
                {tChart(`tooLarge.${read.tooLarge.what}`, { count: read.tooLarge.count, limit: read.tooLarge.limit })}
            </p>
        );
    }
    if (read.error) {
        return (
            <p role="alert" className="text-sm text-content-error">
                {tChart('failed')}
            </p>
        );
    }
    const figures = [
        ['open', data?.open],
        ['started', data?.started],
        ['done', data?.doneInWindow],
        ['created', data?.createdInWindow],
    ] as const;
    return (
        <dl className="grid grid-cols-2 gap-default md:grid-cols-4" data-testid="analytics-counts">
            {figures.map(([key, value]) => (
                <div key={key} className="rounded-lg border border-border-subtle p-3">
                    <dt className="text-xs text-content-muted">{tCounts(key)}</dt>
                    <dd className="text-2xl font-semibold tabular-nums text-content-emphasis" data-testid={`analytics-count-${key}`}>
                        {value ?? '–'}
                    </dd>
                </div>
            ))}
        </dl>
    );
}
