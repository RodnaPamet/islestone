'use client';

/**
 * The Workload page (sub-phase 3.5a; docs/porting/maps/3.5.md, "The page";
 * owner decisions 284 to 288, 297 and 298): "My capacity and time off" for the
 * signed-in person (their capacity in force and their time off as a month of
 * dates, with "Add time off"), then everyone's capacity by week. 3.5b adds the
 * allocation, the over-capacity flags and the row figures to the grid.
 *
 * What it offers is `workloadAffordances`, asked on the server. Written fresh
 * for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { PageHeader } from '@/components/layout/PageHeader';
import { formatDay } from '@/components/time/time-format';
import { addDays } from '@/lib/time/week';
import { WORKLOAD_LIMITS } from '@/lib/workload/time-off';
import type { WorkloadAffordances } from '@/lib/workload/types';

import { TimeOffCalendar } from './TimeOffCalendar';
import { WorkloadGrid } from './WorkloadGrid';
import { useMemberCapacity, useWorkload } from './data/use-workload';
import { capacityRows, hoursText } from './workload-model';

function MyCapacity({ userId }: { userId: string }) {
    const tMine = useTranslations('workload.mine');
    const { data } = useMemberCapacity(userId);
    if (!data) return null;
    const inForce = data.rows.find((r) => r.effectiveFrom <= data.currentWeek) ?? null;
    const next = [...data.rows].reverse().find((r) => r.effectiveFrom > data.currentWeek) ?? null;
    return (
        <div className="space-y-tight text-sm" data-testid="my-capacity">
            <p>
                {inForce
                    ? tMine('capacity', { hours: hoursText(inForce.weeklyMinutes), calendar: inForce.calendarTeamId ? tMine('calendarTeam') : tMine('calendarWorkspace') })
                    : tMine('capacityDefault', { hours: hoursText(data.defaultWeeklyMinutes) })}
            </p>
            {next && <p className="text-content-muted">{tMine('next', { hours: hoursText(next.weeklyMinutes), date: formatDay(next.effectiveFrom, 'dateYear') })}</p>}
        </div>
    );
}

export function WorkloadView({ affordances, userId, today }: { affordances: WorkloadAffordances; userId: string; today: string }) {
    const t = useTranslations('workload');
    const [from, setFrom] = useState<string | null>(null);
    const weeks = WORKLOAD_LIMITS.weeksDefault;
    const { data, error, isLoading } = useWorkload(from, weeks);
    const first = data?.weeks[0] ?? null;
    // The current week is the first week of the read with no `from` (today in the workspace calendar's zone).
    const [thisWeek, setThisWeek] = useState<string | null>(null);
    if (from === null && first && first !== thisWeek) setThisWeek(first);
    const atStart = from === null;
    const previous = () => {
        if (!first) return;
        const target = addDays(first, -7 * weeks);
        setFrom(thisWeek && target > thisWeek ? target : null);
    };
    const rangeLabel = data && data.weeks.length > 0 ? `${formatDay(data.weeks[0]!, 'date')} – ${formatDay(addDays(data.weeks[data.weeks.length - 1]!, 6), 'dateYear')}` : '';

    return (
        <div className="space-y-section p-4 md:h-full md:overflow-auto" data-testid="workload">
            <PageHeader title={t('title')} description={t('description')} />

            <section aria-labelledby="workload-mine-heading" className="space-y-default">
                <h2 id="workload-mine-heading" className="text-base font-semibold text-content-emphasis">
                    {t('mine.heading')}
                </h2>
                <MyCapacity userId={userId} />
                <TimeOffCalendar personId={userId} today={today} canWrite={affordances.recordOwnTimeOff} idPrefix="my-time-off" />
            </section>

            <section aria-labelledby="workload-grid-heading" className="space-y-default">
                <div className="flex flex-wrap items-center gap-tight">
                    <h2 id="workload-grid-heading" className="mr-auto text-base font-semibold text-content-emphasis">
                        {t('grid.heading')}
                    </h2>
                    <Button variant="secondary" size="sm" text={t('grid.previous')} disabled={atStart || !first} onClick={previous} />
                    <Button variant="secondary" size="sm" text={t('grid.thisWeek')} disabled={atStart} onClick={() => setFrom(null)} />
                    <Button variant="secondary" size="sm" text={t('grid.next')} disabled={!first} onClick={() => first && setFrom(addDays(first, 7 * weeks))} />
                </div>
                {error && (
                    <p role="alert" className="text-sm text-content-error">
                        {t('grid.loadFailed')}
                    </p>
                )}
                {isLoading && !data && <p className="text-sm text-content-muted">{t('grid.loading')}</p>}
                {data && <WorkloadGrid weeks={data.weeks} rows={capacityRows(data, t('grid.unnamed'))} rangeLabel={rangeLabel} />}
            </section>
        </div>
    );
}
