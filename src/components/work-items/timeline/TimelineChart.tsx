'use client';

/**
 * The chart region (roadmap 3.1b; the roadmap's too, 3.2c, with its own
 * `region` label): the widget's adapter loaded with
 * `next/dynamic` and `ssr: false`, so its code ships only on a timeline, and
 * held behind an error boundary that points to the schedule table, which
 * shows the same rows (decision 203). The region is labelled and described
 * for assistive technology: the widget's own rows are not exposed to it.
 *
 * Written fresh for Islestone.
 */
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Component, type ReactNode } from 'react';

import { Skeleton } from '@inflect/ui/components/ui/skeleton';

import type { TimelineAdapterProps } from './svar-adapter';

const Adapter = dynamic(() => import('./svar-adapter'), {
    ssr: false,
    loading: () => <Skeleton className="h-full min-h-96 w-full" />,
});

class ChartBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
    override state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    override render() {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}

export function TimelineChart(props: TimelineAdapterProps & { fallback: ReactNode; region?: { label: string; description: string; id: string } }) {
    const tChart = useTranslations('workItems.timeline');
    const { fallback, region, ...adapter } = props;
    const id = region?.id ?? 'timeline-chart';
    return (
        <div role="region" aria-label={region?.label ?? tChart('chartLabel')} aria-describedby={`${id}-description`} className="h-full min-h-0" data-testid={id}>
            <p id={`${id}-description`} className="sr-only">
                {region?.description ?? tChart('chartDescription')}
            </p>
            <ChartBoundary fallback={fallback}>
                <Adapter {...adapter} />
            </ChartBoundary>
        </div>
    );
}
