'use client';

/**
 * My Work's one line of the person's load (sub-phase 3.5b; docs/porting/maps/
 * 3.5.md, "My Work"; owner decision 300): "This week 34h of 40h · next week
 * over by 6h", linking to the Workload page filtered to them, read through
 * the workload route for the caller's two weeks. Hidden when they have no
 * counted work in either week. Offered only to a holder of `workload.view`,
 * which the server decides.
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { useTenantHref } from '@/lib/tenant-context-provider';

import { useWorkload } from './data/use-workload';
import { hoursText, workloadLine, workloadRows } from './workload-model';

const MINE = { userId: 'me' } as const;

export function MyWorkloadLine({ userId }: { userId: string }) {
    const t = useTranslations('workload.myWork');
    const href = useTenantHref();
    const { data } = useWorkload(null, 2, MINE);
    const row = data ? workloadRows(data, { unnamed: '', unassigned: '' }).find((r) => r.userId === userId) : undefined;
    const line = row ? workloadLine(row.cells) : null;
    if (!line) return null;
    const parts = line.map((w) =>
        w.week === 'this'
            ? w.over > 0
                ? t('thisWeekOver', { over: hoursText(w.over) })
                : t('thisWeek', { allocated: hoursText(w.allocated), capacity: hoursText(w.capacity) })
            : w.over > 0
              ? t('nextWeekOver', { over: hoursText(w.over) })
              : t('nextWeek', { allocated: hoursText(w.allocated), capacity: hoursText(w.capacity) }),
    );
    return (
        <p className="text-sm text-content-default" data-testid="my-workload-line">
            <span className="sr-only">{t('label')}: </span>
            <span className={line.some((w) => w.over > 0) ? 'text-content-error' : undefined}>{parts.join(' · ')}</span>{' '}
            <Link className="text-content-info underline-offset-2 hover:underline" href={href(`/workload?userId=${encodeURIComponent(userId)}`)}>
                {t('open')}
            </Link>
        </p>
    );
}
