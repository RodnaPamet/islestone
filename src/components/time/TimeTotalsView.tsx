'use client';

/**
 * Time totals (sub-phase 3.4d; docs/porting/maps/3.4.md, "Time totals";
 * owner decisions 266, 274 and 275): the sums of finished time over a window
 * of dates, grouped by project, person, item or week, with an export of the
 * entries behind the filter as CSV or Excel.
 *
 *   - Filters: the window (at most 366 days), a project, a person, billable
 *     or not; the grouping is a toggle. The table is the shared `DataTable`;
 *     the total line sits under it.
 *   - Money only where the server sends it (`viewer.rates`, `time.rates`):
 *     an amount column and, for a group with billable time and no rate, "No
 *     rate". Nothing here asks a role or a key.
 *   - A deleted project, a tombstone (whose team is gone, issue #120) and a
 *     deleted item keep their own label.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { useToast } from '@/components/ui/hooks';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { createColumns } from '@/components/ui/table';
import { memberLabel, useMembers } from '@/components/work-items/data/use-work-config';
import { formatMoney } from '@/lib/time/money';
import { TIME_TOTALS_GROUPS, type TimeTotalsFilter, type TimeTotalsGroup, type TimeTotalsGroupBy } from '@/lib/time/totals';
import type { TimeAffordances } from '@/lib/time/types';
import { addDays } from '@/lib/time/week';
import { formatDuration } from '@/lib/work-items/estimate';

import { TimeTabs } from './TimeTabs';
import { useTimeTotals, useTimeTotalsActions } from './data/use-time-totals';
import { formatDay } from './time-format';

export interface TimeTotalsProject {
    id: string;
    name: string;
    keyPrefix: string;
}

const ALL = '__all__';

/** The first day of `today`'s month. */
function monthStart(today: string): string {
    return `${today.slice(0, 8)}01`;
}

export function TimeTotalsView({ affordances, today, projects }: { affordances: TimeAffordances; today: string; projects: TimeTotalsProject[] }) {
    const t = useTranslations('time.totals');
    const toast = useToast();
    const actions = useTimeTotalsActions();
    const { members } = useMembers();
    const [from, setFrom] = useState(monthStart(today));
    const [to, setTo] = useState(today);
    const [projectId, setProjectId] = useState<string>(ALL);
    const [userId, setUserId] = useState<string>(ALL);
    const [billable, setBillable] = useState<'all' | 'billable' | 'nonBillable'>('all');
    const [groupBy, setGroupBy] = useState<TimeTotalsGroupBy>('project');
    const [exporting, setExporting] = useState(false);

    const filter: TimeTotalsFilter = useMemo(
        () => ({
            from,
            to,
            ...(projectId !== ALL ? { projectId } : {}),
            ...(userId !== ALL ? { userId } : {}),
            ...(billable !== 'all' ? { billable: billable === 'billable' } : {}),
        }),
        [from, to, projectId, userId, billable],
    );
    const { data, error, isLoading } = useTimeTotals(filter, groupBy);
    const rates = data?.viewer.rates === true;
    const currency = data?.currency ?? null;

    const money = (minor: number | null) => (minor === null || currency === null ? '' : formatMoney(minor, currency));

    const label = (g: TimeTotalsGroup): string => {
        const s = g.subject;
        switch (s.kind) {
            case 'project':
                return s.deleted ? t('deletedProject', { name: `${s.keyPrefix} ${s.name}` }) : `${s.keyPrefix} ${s.name}`;
            case 'person':
                return s.name ?? t('unknownPerson');
            case 'item':
                return s.item.kind === 'visible' ? `${s.item.key} ${s.item.title}` : s.item.kind === 'deleted' ? t('deletedItem') : t('hiddenItem');
            case 'week':
                return t('weekOf', { date: `${formatDay(s.weekStart, 'date')} – ${formatDay(addDays(s.weekStart, 6), 'dateYear')}` });
        }
    };

    const columns = useMemo(
        () =>
            createColumns<TimeTotalsGroup>([
                { id: 'group', header: t(`col.${groupBy}`), cell: ({ row }) => label(row.original) },
                { id: 'minutes', header: t('col.time'), cell: ({ row }) => formatDuration(row.original.minutes) },
                { id: 'billable', header: t('col.billable'), cell: ({ row }) => formatDuration(row.original.billableMinutes) },
                { id: 'entries', header: t('col.entries'), cell: ({ row }) => String(row.original.entries) },
                ...(rates
                    ? [
                          {
                              id: 'amount',
                              header: currency ? t('col.amountIn', { currency }) : t('col.amount'),
                              cell: ({ row }: { row: { original: TimeTotalsGroup } }) => (
                                  <span>
                                      {money(row.original.amountMinor)}
                                      {(row.original.noRateMinutes ?? 0) > 0 && (
                                          <span className="ml-tight text-xs text-content-muted">{t('noRatePart', { time: formatDuration(row.original.noRateMinutes ?? 0) })}</span>
                                      )}
                                  </span>
                              ),
                          },
                      ]
                    : []),
            ]),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t, groupBy, rates, currency],
    );

    const download = async (format: 'csv' | 'xlsx') => {
        setExporting(true);
        const refusal = await actions.exportEntries(filter, format);
        setExporting(false);
        if (refusal) toast.error(refusal.reason ?? t('exportFailed'));
    };

    const projectOptions: ComboboxOption[] = [{ value: ALL, label: t('allProjects') }, ...projects.map((p) => ({ value: p.id, label: `${p.keyPrefix} ${p.name}` }))];
    const memberOptions: ComboboxOption[] = [{ value: ALL, label: t('everyone') }, ...members.map((m) => ({ value: m.id, label: memberLabel(m) ?? m.id }))];
    const billableOptions: ComboboxOption[] = (['all', 'billable', 'nonBillable'] as const).map((v) => ({ value: v, label: t(`billable.${v}`) }));
    const refusal = error && typeof error === 'object' && 'reason' in error ? (error as { reason?: string }).reason : undefined;

    const filters = (
        <div className="space-y-default">
            <TimeTabs approve={affordances.approve} totals myTime={affordances.track || affordances.approve} />
            <div className="flex flex-wrap items-end gap-default" data-testid="time-totals-filters">
                <label className="flex flex-col gap-tight text-xs text-content-muted" htmlFor="time-totals-from">
                    {t('from')}
                    <DatePicker id="time-totals-from" value={parseYMD(from)} onChange={(d) => d && setFrom(toYMD(d) ?? from)} />
                </label>
                <label className="flex flex-col gap-tight text-xs text-content-muted" htmlFor="time-totals-to">
                    {t('to')}
                    <DatePicker id="time-totals-to" value={parseYMD(to)} onChange={(d) => d && setTo(toYMD(d) ?? to)} />
                </label>
                <Combobox
                    selected={projectOptions.find((o) => o.value === projectId) ?? null}
                    setSelected={(o) => setProjectId(o?.value ?? ALL)}
                    options={projectOptions}
                    caret
                    buttonProps={{ 'aria-label': t('project'), id: 'time-totals-project' }}
                />
                <Combobox
                    selected={memberOptions.find((o) => o.value === userId) ?? null}
                    setSelected={(o) => setUserId(o?.value ?? ALL)}
                    options={memberOptions}
                    caret
                    buttonProps={{ 'aria-label': t('person'), id: 'time-totals-person' }}
                />
                <Combobox
                    selected={billableOptions.find((o) => o.value === billable) ?? null}
                    setSelected={(o) => setBillable(o?.value === 'billable' ? 'billable' : o?.value === 'nonBillable' ? 'nonBillable' : 'all')}
                    options={billableOptions}
                    hideSearch
                    caret
                    buttonProps={{ 'aria-label': t('billableLabel'), id: 'time-totals-billable' }}
                />
                <ToggleGroup
                    ariaLabel={t('groupBy')}
                    options={TIME_TOTALS_GROUPS.map((g) => ({ value: g, label: t(`groupByOption.${g}`), id: `time-totals-group-${g}` }))}
                    selected={groupBy}
                    selectAction={(v) => setGroupBy((TIME_TOTALS_GROUPS as readonly string[]).includes(v) ? (v as TimeTotalsGroupBy) : 'project')}
                />
            </div>
        </div>
    );

    const total = data?.total;
    return (
        <EntityListPage<TimeTotalsGroup>
            header={{
                title: t('title'),
                description: t('description'),
                actions: (
                    <div className="flex items-center gap-tight" role="group" aria-label={t('export')}>
                        <Button id="time-totals-export-csv" variant="secondary" size="sm" text={t('exportCsv')} loading={exporting} onClick={() => void download('csv')} />
                        <Button id="time-totals-export-xlsx" variant="secondary" size="sm" text={t('exportXlsx')} loading={exporting} onClick={() => void download('xlsx')} />
                    </div>
                ),
            }}
            kpis={filters}
            table={{
                data: data?.groups ?? [],
                columns,
                loading: isLoading,
                error: error ? (refusal ?? t('loadFailed')) : undefined,
                getRowId: (g) => g.key,
                selectionEnabled: false,
                emptyState: t('empty'),
                resourceName: (plural: boolean) => (plural ? t('resourcePlural') : t('resource')),
                'data-testid': 'time-totals-table',
            }}
            tableFooter={
                total ? (
                    <p className="px-4 py-2 text-sm text-content-default" data-testid="time-totals-total" role="status">
                        {t('total', { time: formatDuration(total.minutes), billable: formatDuration(total.billableMinutes), entries: total.entries })}
                        {rates && currency && <span> · {t('totalAmount', { amount: money(total.amountMinor) })}</span>}
                        {rates && (total.noRateMinutes ?? 0) > 0 && <span className="text-content-muted"> · {t('noRateTotal', { time: formatDuration(total.noRateMinutes ?? 0) })}</span>}
                        {rates && !currency && <span className="text-content-muted"> · {t('noCurrency')}</span>}
                    </p>
                ) : null
            }
        />
    );
}
