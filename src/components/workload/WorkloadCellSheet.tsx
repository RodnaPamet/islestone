'use client';

/**
 * A week of one person's workload (sub-phase 3.5b; docs/porting/maps/3.5.md,
 * "The page"; decisions 292 to 296): the week's capacity, allocation and
 * time-off dates with their hours (never a type), then the items that fill
 * it in the shared `DataTable` (key, title, hours this week, dates, why),
 * most minutes first, each opening the item's sheet. The items are listed
 * only for a reader of work items, which the server decides (`itemsShown`).
 * 3.5c adds "Ways to rebalance" under the table.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { Sheet } from '@/components/ui/sheet';
import { DataTable, createColumns } from '@/components/ui/table';
import { formatDay } from '@/components/time/time-format';
import type { WorkloadCellItem } from '@/lib/workload/types';

import { useWorkloadCell } from './data/use-workload';
import { hoursText } from './workload-model';

export interface WorkloadCellSheetProps {
    /** The open cell (`userId` may be `unassigned`), with the row's name for the title; `null` closes the sheet. */
    cell: { userId: string; week: string; name: string; unassigned: boolean } | null;
    onClose: () => void;
    /** Open an item's sheet; absent when the page cannot show one. */
    onOpenItem?: (id: string) => void;
}

function datesText(item: WorkloadCellItem, none: string): string {
    if (item.startDate && item.dueDate) return `${formatDay(item.startDate, 'date')} – ${formatDay(item.dueDate, 'date')}`;
    if (item.dueDate) return formatDay(item.dueDate, 'date');
    if (item.startDate) return formatDay(item.startDate, 'date');
    return none;
}

export function WorkloadCellSheet({ cell, onClose, onOpenItem }: WorkloadCellSheetProps) {
    const tCell = useTranslations('workload.cell');
    const { data, error, isLoading } = useWorkloadCell(cell ? { userId: cell.userId, week: cell.week } : null);

    const columns = useMemo(
        () =>
            createColumns<WorkloadCellItem>([
                { id: 'key', header: tCell('col.key'), cell: ({ row }) => <span className="font-mono text-xs">{row.original.key}</span> },
                { id: 'title', header: tCell('col.title'), cell: ({ row }) => row.original.title },
                {
                    id: 'hours',
                    header: tCell('col.hours'),
                    cell: ({ row }) => (
                        <span className="tabular-nums">
                            {hoursText(row.original.minutes)}
                            <span className="block text-xs text-content-muted">{tCell('remaining', { remaining: hoursText(row.original.remainingMinutes), estimate: hoursText(row.original.estimateMinutes) })}</span>
                        </span>
                    ),
                },
                { id: 'dates', header: tCell('col.dates'), cell: ({ row }) => datesText(row.original, tCell('noDate')) },
                {
                    id: 'why',
                    header: tCell('col.why'),
                    cell: ({ row }) => {
                        const item = row.original;
                        if (item.reason === 'OVERDUE') return tCell('why.OVERDUE');
                        if (item.reason === 'ONE_DAY') return tCell('why.ONE_DAY', { date: formatDay(item.from, 'date') });
                        return tCell('why.SPREAD', { count: item.workingDays, from: formatDay(item.from, 'date'), to: formatDay(item.to, 'date') });
                    },
                },
            ]),
        [tCell],
    );

    const week = cell ? formatDay(cell.week, 'dateYear') : '';
    const title = cell ? (cell.unassigned ? tCell('titleUnassigned', { week }) : tCell('title', { name: cell.name, week })) : '';

    return (
        <Sheet
            open={cell !== null}
            onOpenChange={(open: boolean) => {
                if (!open) onClose();
            }}
            title={title}
            size="lg"
        >
            <Sheet.Header title={title} />
            <Sheet.Body>
                <div className="space-y-default" data-testid="workload-cell-sheet">
                    {error && (
                        <p role="alert" className="text-sm text-content-error">
                            {tCell('loadFailed')}
                        </p>
                    )}
                    {isLoading && !data && <p className="text-sm text-content-muted">{tCell('loading')}</p>}
                    {data && (
                        <>
                            <div className="space-y-tight text-sm">
                                <p className="font-medium text-content-emphasis" data-testid="workload-cell-summary">
                                    {data.capacityMinutes === null
                                        ? tCell('summaryUnassigned', { allocated: hoursText(data.allocatedMinutes) })
                                        : data.overMinutes > 0
                                          ? tCell('summaryOver', { allocated: hoursText(data.allocatedMinutes), capacity: hoursText(data.capacityMinutes), over: hoursText(data.overMinutes) })
                                          : tCell('summary', { allocated: hoursText(data.allocatedMinutes), capacity: hoursText(data.capacityMinutes) })}
                                </p>
                                {!data.active && <p className="text-content-muted">{tCell('inactive')}</p>}
                                {data.timeOff.length > 0 && (
                                    <p className="text-content-muted">
                                        {tCell('timeOff', {
                                            dates: data.timeOff
                                                .map((d) => tCell('timeOffDay', { date: formatDay(d.day, 'date'), value: d.minutes === null ? tCell('wholeDay') : hoursText(d.minutes) }))
                                                .join(', '),
                                        })}
                                    </p>
                                )}
                            </div>
                            <h3 className="text-sm font-semibold text-content-emphasis">{tCell('itemsHeading')}</h3>
                            {data.itemsShown ? (
                                <>
                                    <DataTable<WorkloadCellItem>
                                        data={data.items}
                                        columns={columns}
                                        getRowId={(r) => r.id}
                                        onRowClick={onOpenItem ? (row) => onOpenItem(row.original.id) : undefined}
                                        selectionEnabled={false}
                                        emptyState={tCell('empty')}
                                        resourceName={(plural) => (plural ? tCell('resourcePlural') : tCell('resource'))}
                                        data-testid="workload-cell-table"
                                    />
                                    {data.moreItems > 0 && <p className="text-xs text-content-muted">{tCell('moreItems', { count: data.moreItems })}</p>}
                                </>
                            ) : (
                                <p className="text-sm text-content-muted">{tCell('itemsHidden')}</p>
                            )}
                        </>
                    )}
                </div>
            </Sheet.Body>
        </Sheet>
    );
}
