'use client';

/**
 * "Ways to rebalance" under an over-capacity week's items (sub-phase 3.5c;
 * docs/porting/maps/3.5.md, "Ways to rebalance (3.5c)"; owner decisions 283
 * and 299). Read-only: each line is named by its act ("Assign to Ana",
 * "Move dates to …") and opens an existing confirmation, the assign picker or
 * 3.1c's "Change dates"; nothing is written until the person confirms there.
 * What is offered is the server's (`rebalance.offered`, the options it worked
 * out); nothing here asks a role or a key.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';

import { Button } from '@inflect/ui/components/ui/button';
import { formatDay } from '@/components/time/time-format';
import type { WorkloadRebalance, WorkloadRebalanceItem } from '@/lib/workload/types';

import { hoursText } from './workload-model';

/** "14–18 Dec", or one date. */
export function datesRangeText(startDate: string | null, dueDate: string | null): string {
    if (startDate && dueDate && startDate !== dueDate) return `${formatDay(startDate, 'date')} – ${formatDay(dueDate, 'date')}`;
    return formatDay((dueDate ?? startDate)!, 'date');
}

export interface RebalanceWaysProps {
    rebalance: WorkloadRebalance;
    /** The person whose week it is, for "a day Ana is off"; NULL when unnamed. */
    personName: string | null;
    onAssign: (item: WorkloadRebalanceItem, userId: string) => void;
    onMoveDates: (item: WorkloadRebalanceItem) => void;
}

export function RebalanceWays({ rebalance, personName, onAssign, onMoveDates }: RebalanceWaysProps) {
    const tWays = useTranslations('workload.rebalance');
    const who = personName ?? tWays('someone');
    return (
        <section aria-labelledby="workload-rebalance-heading" className="space-y-default" data-testid="workload-rebalance">
            <div className="space-y-tight">
                <h3 id="workload-rebalance-heading" className="text-sm font-semibold text-content-emphasis">
                    {tWays('heading')}
                </h3>
                <p className="text-xs text-content-muted">{tWays('intro')}</p>
                {rebalance.assignUnavailable && <p className="text-xs text-content-muted">{tWays('assignUnavailable')}</p>}
            </div>
            <ul className="space-y-default">
                {rebalance.items.map((item) => (
                    <li key={item.id} className="space-y-tight rounded-md border border-border-subtle p-3" data-testid="workload-rebalance-item">
                        <p className="text-sm">
                            <span className="font-mono text-xs">{item.key}</span> <span className="text-content-emphasis">{item.title}</span>{' '}
                            <span className="text-content-muted">{tWays('thisWeek', { hours: hoursText(item.minutes) })}</span>
                        </p>
                        <div className="flex flex-wrap items-center gap-tight">
                            {rebalance.offered.assign &&
                                item.assignTo.map((a) => (
                                    <span key={a.userId} className="inline-flex items-center gap-tight">
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            text={tWays('assignTo', { name: a.name ?? tWays('someone') })}
                                            onClick={() => onAssign(item, a.userId)}
                                        />
                                        <span className="text-xs text-content-muted">{tWays('free', { hours: hoursText(a.freeMinutes) })}</span>
                                    </span>
                                ))}
                            {rebalance.offered.moveDates && item.moveTo && (
                                <Button variant="secondary" size="sm" text={tWays('moveDates', { dates: datesRangeText(item.moveTo.startDate, item.moveTo.dueDate) })} onClick={() => onMoveDates(item)} />
                            )}
                        </div>
                        {rebalance.offered.assign && !rebalance.assignUnavailable && item.assignTo.length === 0 && <p className="text-xs text-content-muted">{tWays('noAssign')}</p>}
                        {rebalance.offered.moveDates && !item.moveTo && <p className="text-xs text-content-muted">{tWays('noMove', { weeks: rebalance.searchWeeks })}</p>}
                    </li>
                ))}
            </ul>
            {rebalance.dueDuringTimeOff.length > 0 && (
                <div className="space-y-tight">
                    <h4 className="text-sm font-semibold text-content-emphasis">{tWays('dueDuringTimeOff')}</h4>
                    <ul className="space-y-tight text-sm" data-testid="workload-rebalance-time-off">
                        {rebalance.dueDuringTimeOff.map((d) => (
                            <li key={d.id}>
                                <span className="font-mono text-xs">{d.key}</span> {tWays('dueOnDayOff', { title: d.title, date: formatDay(d.dueDate, 'date'), name: who })}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    );
}
