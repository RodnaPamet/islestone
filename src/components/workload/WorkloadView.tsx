'use client';

/**
 * The Workload page (sub-phases 3.5a and 3.5b; docs/porting/maps/3.5.md, "The
 * page"; owner decisions 284 to 298): "My capacity and time off" for the
 * signed-in person (their capacity in force and their time off as a month of
 * dates, with "Add time off"), then everyone's work by week against what they
 * can work: allocated hours, over-capacity weeks flagged, what could not be
 * placed at each row's end, and the work assigned to nobody as its own row.
 * The filters narrow the people (decision 297); a cell opens the week's items
 * in a sheet, each opening the item's own sheet.
 *
 * What it offers is `workloadAffordances` and the options the server read;
 * nothing here asks a role or a key. Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { CircleWarning, Folder, UserCheck, Users, UsersSettings } from '@inflect/ui/components/ui/icons/nucleo';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { PageHeader } from '@/components/layout/PageHeader';
import { formatDay } from '@/components/time/time-format';
import { FilterProvider, createFilterDefs, useFilterContext, useFilters } from '@/components/ui/filter';
import { memberLabel } from '@/components/work-items/data/use-work-config';
import { WorkItemSheet } from '@/components/work-items/WorkItemSheet';
import { ApiClientError } from '@/lib/data/api-client';
import { addDays } from '@/lib/time/week';
import { WORKLOAD_LIMITS } from '@/lib/workload/time-off';
import type { WorkloadAffordances } from '@/lib/workload/types';

import { TimeOffCalendar } from './TimeOffCalendar';
import { WorkloadCellSheet } from './WorkloadCellSheet';
import { WorkloadGrid } from './WorkloadGrid';
import { useMemberCapacity, useWorkload, useWorkloadPeople, type WorkloadFilters } from './data/use-workload';
import { hoursText, workloadRows, type WorkloadCell, type WorkloadRow } from './workload-model';

/** The filters' options, read on the server. */
export interface WorkloadPageOptions {
    projects: ReadonlyArray<{ id: string; name: string }>;
    teams: ReadonlyArray<{ id: string; name: string }>;
    recipientLists: ReadonlyArray<{ id: string; name: string }>;
    /** Whether the caller reads work items: the item sheet, and the people, project and team filters. */
    readsItems: boolean;
}

const NO_OPTIONS: WorkloadPageOptions = { projects: [], teams: [], recipientLists: [], readsItems: false };

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

function useWorkloadFilterDefs(options: WorkloadPageOptions) {
    const tFilters = useTranslations('workload.filters');
    const people = useWorkloadPeople(options.readsItems);
    return useMemo(() => {
        return createFilterDefs({
            ...(options.readsItems
                ? { userId: { label: tFilters('people'), icon: UserCheck, multiple: true, options: people.map((m) => ({ value: m.id, label: memberLabel(m) ?? m.id })) } }
                : {}),
            ...(options.projects.length > 0 ? { projectId: { label: tFilters('project'), icon: Folder, options: options.projects.map((p) => ({ value: p.id, label: p.name })) } } : {}),
            ...(options.teams.length > 0 ? { teamId: { label: tFilters('team'), icon: Users, options: options.teams.map((t) => ({ value: t.id, label: t.name })) } } : {}),
            ...(options.recipientLists.length > 0
                ? { recipientListId: { label: tFilters('recipientList'), icon: UsersSettings, options: options.recipientLists.map((l) => ({ value: l.id, label: l.name })) } }
                : {}),
            over: { label: tFilters('over'), icon: CircleWarning, options: [{ value: 'true', label: tFilters('overOnly') }] },
        });
    }, [options, people, tFilters]);
}

export function WorkloadView({ affordances, userId, today, options = NO_OPTIONS }: { affordances: WorkloadAffordances; userId: string; today: string; options?: WorkloadPageOptions }) {
    const defs = useWorkloadFilterDefs(options);
    const filterCtx = useFilterContext(defs.filters, defs.filterKeys, { syncUrl: true });
    return (
        <FilterProvider value={filterCtx}>
            <WorkloadBody affordances={affordances} userId={userId} today={today} options={options} filterDefs={defs.filters} />
        </FilterProvider>
    );
}

function WorkloadBody({
    affordances,
    userId,
    today,
    options,
    filterDefs,
}: {
    affordances: WorkloadAffordances;
    userId: string;
    today: string;
    options: WorkloadPageOptions;
    filterDefs: ReturnType<typeof createFilterDefs>['filters'];
}) {
    const t = useTranslations('workload');
    const { state } = useFilters();
    const filters = useMemo<WorkloadFilters>(
        () => ({
            userId: state.userId?.slice(0, WORKLOAD_LIMITS.peopleFilterMax).join(',') || undefined,
            projectId: state.projectId?.[0],
            teamId: state.teamId?.[0],
            recipientListId: state.recipientListId?.[0],
            over: state.over?.includes('true') ?? false,
        }),
        [state],
    );
    const [from, setFrom] = useState<string | null>(null);
    const weeks = WORKLOAD_LIMITS.weeksDefault;
    const { data, error, isLoading } = useWorkload(from, weeks, filters);
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
    const rows = useMemo(() => (data ? workloadRows(data, { unnamed: t('grid.unnamed'), unassigned: t('grid.unassigned') }) : []), [data, t]);
    const shareScope = filters.projectId
        ? (options.projects.find((p) => p.id === filters.projectId)?.name ?? null)
        : filters.teamId
          ? (options.teams.find((x) => x.id === filters.teamId)?.name ?? null)
          : null;
    const filtered = Boolean(filters.userId || filters.projectId || filters.teamId || filters.recipientListId || filters.over);
    const tooLarge = error instanceof ApiClientError && error.status === 422;

    const [cell, setCell] = useState<{ userId: string; week: string; name: string; unassigned: boolean } | null>(null);
    const [itemId, setItemId] = useState<string | null>(null);
    const openCell = (row: WorkloadRow, c: WorkloadCell) => setCell({ userId: row.userId, week: c.week, name: row.name, unassigned: row.unassigned });

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
                <FilterToolbar filters={filterDefs} />
                {error && (
                    <p role="alert" className="text-sm text-content-error">
                        {tooLarge ? t('grid.tooLarge') : t('grid.loadFailed')}
                    </p>
                )}
                {isLoading && !data && <p className="text-sm text-content-muted">{t('grid.loading')}</p>}
                {data && !data.timeSpentCounted && <p className="text-xs text-content-muted">{t('grid.timeSpentNotCounted')}</p>}
                {data && filtered && rows.length === 0 && <p className="text-sm text-content-muted">{t('grid.filteredEmpty')}</p>}
                {data && (!filtered || rows.length > 0) && <WorkloadGrid weeks={data.weeks} rows={rows} rangeLabel={rangeLabel} shareScope={shareScope} onOpenCell={openCell} />}
            </section>

            <WorkloadCellSheet cell={cell} onClose={() => setCell(null)} onOpenItem={options.readsItems ? (id) => setItemId(id) : undefined} />
            {options.readsItems && <WorkItemSheet workItemId={itemId} onClose={() => setItemId(null)} onOpenItem={(r) => setItemId(r.id)} />}
        </div>
    );
}
