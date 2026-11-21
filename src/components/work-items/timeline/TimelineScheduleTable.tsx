'use client';

/**
 * The schedule table (roadmap 3.1b, owner decision 203): the same rows and
 * the same engine numbers as the chart, in the shared `DataTable`, so the
 * timeline can be read with a keyboard and a screen reader. It is the
 * timeline's accessible view, not a fallback. Read-only in 3.1b (3.1c adds
 * the date pickers that open "Change dates").
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { DataTable, createColumns } from '@/components/ui/table';

import type { ScheduleTableRow } from './timeline-model';

/** A date-only value as the reader's locale shows it, never shifted by a zone. */
export function formatDay(day: string | null): string {
    if (!day) return '';
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function TimelineScheduleTable({
    rows,
    onOpen,
    loading,
}: {
    rows: readonly ScheduleTableRow[];
    onOpen: (id: string) => void;
    loading?: boolean;
}) {
    const tTable = useTranslations('workItems.timeline');
    const columns = useMemo(
        () =>
            createColumns<ScheduleTableRow>([
                { id: 'key', header: tTable('col.key'), cell: ({ row }) => <span className="font-mono text-xs">{row.original.key}</span> },
                {
                    id: 'title',
                    header: tTable('col.title'),
                    cell: ({ row }) => (
                        <span className={row.original.cancelled || row.original.context ? 'text-content-muted' : undefined}>
                            {row.original.title}
                            {row.original.cancelled && <span className="ml-tight text-xs text-content-muted">({tTable('cancelled')})</span>}
                            {row.original.context && <span className="ml-tight text-xs text-content-muted">({tTable('outside')})</span>}
                            {row.original.summary && <span className="ml-tight text-xs text-content-muted">({tTable('summaryRow')})</span>}
                        </span>
                    ),
                },
                { id: 'start', header: tTable('col.start'), cell: ({ row }) => formatDay(row.original.startDate) },
                { id: 'due', header: tTable('col.due'), cell: ({ row }) => formatDay(row.original.dueDate) },
                { id: 'earliestStart', header: tTable('col.earliestStart'), cell: ({ row }) => formatDay(row.original.earliestStart) },
                { id: 'latestFinish', header: tTable('col.latestFinish'), cell: ({ row }) => formatDay(row.original.latestFinish) },
                {
                    id: 'float',
                    header: tTable('col.float'),
                    cell: ({ row }) => {
                        const r = row.original;
                        if (r.lateDays > 0) return <span className="text-content-error">{tTable('float.late', { days: r.lateDays })}</span>;
                        if (r.totalFloat === null) return tTable('float.none');
                        return tTable('float.days', { days: Math.max(0, r.totalFloat) });
                    },
                },
                { id: 'critical', header: tTable('col.critical'), cell: ({ row }) => (row.original.critical ? tTable('criticalYes') : '') },
                {
                    id: 'conflicts',
                    header: tTable('col.conflicts'),
                    cell: ({ row }) => row.original.conflicts.map((c) => tTable(`conflict.${c}`)).join('; '),
                },
            ]),
        [tTable],
    );
    return (
        <DataTable<ScheduleTableRow>
            fillBody
            data={rows as ScheduleTableRow[]}
            columns={columns}
            loading={loading}
            getRowId={(r) => r.id}
            onRowClick={(row) => onOpen(row.original.id)}
            selectionEnabled={false}
            emptyState={tTable('tableEmpty')}
            resourceName={(plural) => (plural ? tTable('resourcePlural') : tTable('resource'))}
            data-testid="timeline-schedule-table"
        />
    );
}
