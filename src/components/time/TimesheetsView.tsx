'use client';

/**
 * Timesheets (sub-phase 3.4c; docs/porting/maps/3.4.md, "Acts"; owner
 * decisions 256, 266, 269 and 270): the weeks waiting for a decision, oldest
 * first, and those decided in the last 12 weeks, for whoever approves weeks.
 *
 *   - A row opens the week in a sheet, read-only: the same item-by-day
 *     table as My time, the day totals, and Approve, Return or Reopen as
 *     the server offers them (`viewer`, asked by `GET /timesheets/:id`).
 *   - Return and Reopen ask for an explanation first (`ExplanationDialog`);
 *     the person sees it, nobody else is told it.
 *   - Nothing here asks a role or a key: the page is offered by the server
 *     (`timeAffordances().approve`), and each button by the week's `viewer`.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { useToast } from '@/components/ui/hooks';
import { Sheet } from '@/components/ui/sheet';
import { DataTable, createColumns } from '@/components/ui/table';
import { ApiClientError } from '@/lib/data/api-client';
import type { TimeEntryData, TimeEntryItem } from '@/lib/time/entries';
import type { TimesheetDetailData, TimesheetListRow } from '@/lib/time/timesheets';
import { addDays } from '@/lib/time/week';
import { formatDuration } from '@/lib/work-items/estimate';

import { ExplanationDialog } from './ExplanationDialog';
import { TimeTabs } from './TimeTabs';
import { useTimesheet, useTimesheetList, useTimesheetWrites } from './data/use-timesheets';
import { formatDay } from './time-format';
import { buildWeekGrid, type WeekRow } from './week-grid-model';

type View = 'SUBMITTED' | 'DECIDED';

export function TimesheetsView({ title }: { title: string }) {
    const t = useTranslations('time.timesheets');
    const [view, setView] = useState<View>('SUBMITTED');
    const list = useTimesheetList(view);
    const [openId, setOpenId] = useState<string | null>(null);

    const weekRange = (weekStart: string) => `${formatDay(weekStart, 'date')} – ${formatDay(addDays(weekStart, 6), 'dateYear')}`;
    const statusText = (r: TimesheetListRow) =>
        r.status === 'APPROVED' ? t('status.APPROVED', { name: r.decidedByName ?? t('anApprover') }) : r.status === 'RETURNED' ? t('status.RETURNED', { name: r.decidedByName ?? t('anApprover') }) : t(`status.${r.status}`);

    const columns = useMemo(
        () =>
            createColumns<TimesheetListRow>([
                { id: 'person', header: t('col.person'), cell: ({ row }) => row.original.personName ?? t('unknownPerson') },
                { id: 'week', header: t('col.week'), cell: ({ row }) => weekRange(row.original.weekStart) },
                { id: 'total', header: t('col.total'), cell: ({ row }) => formatDuration(row.original.sums.minutes) },
                { id: 'billable', header: t('col.billable'), cell: ({ row }) => formatDuration(row.original.sums.billableMinutes) },
                { id: 'submitted', header: t('col.submitted'), cell: ({ row }) => formatDay(row.original.submittedAt.slice(0, 10), 'date') },
                { id: 'status', header: t('col.status'), cell: ({ row }) => statusText(row.original) },
            ]),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t],
    );

    return (
        <EntityListPage<TimesheetListRow>
            header={{
                title,
                description: view === 'SUBMITTED' ? t('descriptionPending') : t('descriptionDecided'),
                actions: (
                    <div className="flex gap-tight" role="group" aria-label={t('viewLabel')}>
                        <Button variant={view === 'SUBMITTED' ? 'primary' : 'secondary'} size="sm" text={t('pending')} aria-pressed={view === 'SUBMITTED'} onClick={() => setView('SUBMITTED')} />
                        <Button variant={view === 'DECIDED' ? 'primary' : 'secondary'} size="sm" text={t('decided')} aria-pressed={view === 'DECIDED'} onClick={() => setView('DECIDED')} />
                    </div>
                ),
            }}
            kpis={<TimeTabs approve />}
            table={{
                data: list.rows,
                columns,
                loading: list.isLoading,
                error: list.error ? t('loadFailed') : undefined,
                getRowId: (r) => r.id,
                selectionEnabled: false,
                onRowClick: (row) => setOpenId(row.original.id),
                emptyState: view === 'SUBMITTED' ? t('emptyPending') : t('emptyDecided'),
                resourceName: (plural: boolean) => (plural ? t('resourcePlural') : t('resource')),
                'data-testid': 'timesheets-table',
            }}
        >
            {list.hasNextPage && (
                <div className="px-4 py-2">
                    <Button variant="secondary" size="sm" text={t('loadMore')} loading={list.loadingMore} onClick={() => void list.loadMore()} />
                </div>
            )}
            <TimesheetSheet id={openId} onClose={() => setOpenId(null)} weekRange={weekRange} />
        </EntityListPage>
    );
}

function itemLabel(item: TimeEntryItem, deleted: string, hidden: string): string {
    return item.kind === 'visible' ? `${item.key} ${item.title}` : item.kind === 'deleted' ? deleted : hidden;
}

function TimesheetSheet({ id, onClose, weekRange }: { id: string | null; onClose: () => void; weekRange: (weekStart: string) => string }) {
    const tSheet = useTranslations('time.timesheets');
    const tDays = useTranslations('time.myTime');
    const { data, error } = useTimesheet(id);
    const writes = useTimesheetWrites();
    const toast = useToast();
    const [ask, setAsk] = useState<'return' | 'reopen' | null>(null);
    const [busy, setBusy] = useState(false);

    const grid = useMemo(() => (data ? buildWeekGrid({ weekStart: data.timesheet.weekStart, entries: data.entries }) : null), [data]);
    const columns = useMemo(
        () =>
            grid
                ? createColumns<WeekRow>([
                      { id: 'item', header: tDays('item'), cell: ({ row }) => itemLabel(row.original.item, tDays('deletedItem'), tDays('hiddenItem')) },
                      ...grid.days.map((d, i) => ({
                          id: d,
                          header: formatDay(d, 'short'),
                          cell: ({ row }: { row: { original: WeekRow } }) => (row.original.cells[i]!.minutes > 0 ? formatDuration(row.original.cells[i]!.minutes) : '–'),
                      })),
                      { id: 'total', header: tDays('total'), cell: ({ row }) => formatDuration(row.original.total) },
                  ])
                : [],
        [grid, tDays],
    );

    const approve = async (detail: TimesheetDetailData) => {
        setBusy(true);
        const out = await writes.approve(detail.timesheet);
        setBusy(false);
        if (out instanceof ApiClientError) toast.error(out.message || tSheet('failed'));
        else onClose();
    };
    const explain = async (detail: TimesheetDetailData, explanation: string): Promise<string | null> => {
        const out = ask === 'reopen' ? await writes.reopen(detail.timesheet, explanation) : await writes.returnWeek(detail.timesheet, explanation);
        if (out instanceof ApiClientError) return out.message || tSheet('failed');
        onClose();
        return null;
    };

    return (
        <Sheet open={id !== null} onOpenChange={(o: boolean) => !o && onClose()} title={tSheet('sheetTitle')}>
            <Sheet.Header title={data ? tSheet('sheetTitleOf', { person: data.personName ?? tSheet('unknownPerson'), week: weekRange(data.timesheet.weekStart) }) : tSheet('sheetTitle')} />
            <Sheet.Body>
                {error && (
                    <p role="alert" className="text-sm text-content-error">
                        {tSheet('loadFailed')}
                    </p>
                )}
                {data && grid && (
                    <div className="space-y-default" data-testid="timesheet-detail">
                        <p className="text-sm text-content-muted">
                            {tSheet('sums', { total: formatDuration(data.sums.minutes), billable: formatDuration(data.sums.billableMinutes), entries: data.sums.entries })}
                        </p>
                        {data.timesheet.status === 'RETURNED' && data.timesheet.returnExplanation && (
                            <p className="whitespace-pre-wrap text-sm">{tSheet('returnedBecause', { explanation: data.timesheet.returnExplanation })}</p>
                        )}
                        <DataTable<WeekRow> data={grid.rows} columns={columns} getRowId={(r) => r.key} selectionEnabled={false} emptyState={tSheet('noEntries')} resourceName={(p: boolean) => (p ? tSheet('rowPlural') : tSheet('row'))} data-testid="timesheet-week-table" />
                        <EntryNotes entries={data.entries} />
                        <div className="flex flex-wrap gap-tight">
                            {data.viewer.approve && <Button id="timesheet-approve" variant="primary" text={tSheet('approve')} loading={busy} onClick={() => void approve(data)} />}
                            {data.viewer.return && <Button id="timesheet-return" variant="secondary" text={tSheet('return')} onClick={() => setAsk('return')} />}
                            {data.viewer.reopen && <Button id="timesheet-reopen" variant="secondary" text={tSheet('reopen')} onClick={() => setAsk('reopen')} />}
                        </div>
                        {ask && (
                            <ExplanationDialog
                                open
                                title={ask === 'reopen' ? tSheet('reopenTitle') : tSheet('returnTitle')}
                                description={ask === 'reopen' ? tSheet('reopenBody') : tSheet('returnBody')}
                                confirmText={ask === 'reopen' ? tSheet('reopen') : tSheet('return')}
                                onOpenChange={(o) => !o && setAsk(null)}
                                onConfirm={(text) => explain(data, text)}
                            />
                        )}
                    </div>
                )}
            </Sheet.Body>
        </Sheet>
    );
}

/** The week's described entries, by day: what the person said they did. */
function EntryNotes({ entries }: { entries: Array<TimeEntryData & { item: TimeEntryItem }> }) {
    const tNotes = useTranslations('time.timesheets');
    const described = entries.filter((e) => e.description && e.minutes !== null);
    if (described.length === 0) return null;
    return (
        <section aria-labelledby="timesheet-notes-heading" className="space-y-tight">
            <h3 id="timesheet-notes-heading" className="text-sm font-semibold text-content-emphasis">
                {tNotes('described')}
            </h3>
            <ul className="divide-y divide-border-subtle text-sm">
                {described.map((e) => (
                    <li key={e.id} className="py-1">
                        <span className="text-content-muted">
                            {formatDay(e.workDate, 'date')} · {formatDuration(e.minutes ?? 0)}
                            {e.item.kind === 'visible' ? ` · ${e.item.key}` : ''}
                        </span>
                        <span className="block whitespace-pre-wrap">{e.description}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
