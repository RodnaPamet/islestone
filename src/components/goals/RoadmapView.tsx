'use client';

/**
 * The roadmap (sub-phase 3.2c; docs/porting/maps/3.2.md, "The client"; owner
 * decisions 203, 215, 216 and 217): one read (`useRoadmap`), one view model
 * (`buildRoadmapModel`), shown as the chart or the table ("Chart / Table",
 * remembered per viewer), with the "No dates" list beside the chart and the
 * zoom (month or quarter, quarter by default, remembered per viewer).
 *
 *   - **Read-only.** The chart is SVAR through 3.1's one adapter, never
 *     editable: the roadmap changes no date (decision 217).
 *   - **A bar opens the timeline** (decision 217): a project's its own page in
 *     the Timeline layout; an initiative's or a goal's the Work items page in
 *     the Timeline layout filtered by `initiativeId` or `goalId` (decision
 *     220's filters, which the timeline route reads). The table's "Open
 *     timeline" does the same by keyboard.
 *   - **Plans, said so.** Every bar is the span of stored dates, labelled
 *     "Planned dates"; the pass runs on the timeline, not here.
 *
 * Used on the Roadmap page (with its filters and the grouping) and on an
 * initiative's page (its slice, `filters.initiativeId` fixed).
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { useLocalStorage } from '@/components/ui/hooks';
import { InlineNotice } from '@/components/ui/inline-notice';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { DataTable, createColumns } from '@/components/ui/table';
import { TimelineChart } from '@/components/work-items/timeline/TimelineChart';
import { formatDay } from '@/components/work-items/timeline/TimelineScheduleTable';
import {
    DEFAULT_ROADMAP_ZOOM,
    ROADMAP_ZOOMS,
    buildRoadmapModel,
    timelinePathOf,
    type RoadmapFlag,
    type RoadmapTableRow,
    type RoadmapTarget,
    type RoadmapZoom,
} from '@/components/work-items/timeline/roadmap-model';
import type { ChartTask } from '@/components/work-items/timeline/timeline-model';
import type { GridColumn } from '@/components/work-items/timeline/svar-adapter';
import type { RoadmapFilters, RoadmapGroupBy } from '@/lib/goals/roadmap';
import type { ProgressData } from '@/lib/goals/types';
import { uiStorageKey } from '@/lib/ui-storage';
import { useTenantHref } from '@/lib/tenant-context-provider';

import { HealthText, ProgressCell } from './goal-parts';
import { useRoadmap } from './use-roadmap';

export type RoadmapMode = 'chart' | 'table';

const NO_DAYS: ReadonlySet<number> = new Set();

const progressText = (p: ProgressData | null, none: string) => (p === null ? '' : p.scope === 0 ? none : `${p.done}/${p.scope}`);

export interface RoadmapViewProps {
    filters: RoadmapFilters;
    /** Offer "Group by: Initiative / Goal" (the Roadmap page; an initiative's slice has nothing to group). */
    groupBy?: { value: RoadmapGroupBy; onChange: (value: RoadmapGroupBy) => void };
    /** Distinct ids when the view is on a page twice (the chart's region, the headings). */
    idPrefix?: string;
    /** The id of a heading the page already gives the view (an initiative's "Roadmap" section): no heading of its own then. */
    labelledBy?: string;
}

export function RoadmapView({ filters, groupBy, idPrefix = 'roadmap', labelledBy }: RoadmapViewProps) {
    const t = useTranslations('roadmap.view');
    const tRoadmap = useTranslations('roadmap');
    const tenantHref = useTenantHref();
    const router = useRouter();
    const roadmap = useRoadmap(filters);
    const [storedMode, setMode] = useLocalStorage<RoadmapMode>(uiStorageKey('roadmap', 'mode'), 'chart');
    const [storedZoom, setZoom] = useLocalStorage<RoadmapZoom>(uiStorageKey('roadmap', 'zoom'), DEFAULT_ROADMAP_ZOOM);
    const mode: RoadmapMode = storedMode === 'table' ? 'table' : 'chart';
    const zoom: RoadmapZoom = ROADMAP_ZOOMS.includes(storedZoom) ? storedZoom : DEFAULT_ROADMAP_ZOOM;

    const built = useMemo(() => (roadmap.data ? buildRoadmapModel(roadmap.data, { unlinked: t('unlinked'), noGoal: t('noGoal') }) : null), [roadmap.data, t]);
    const rowsById = useMemo(() => new Map((built?.model.table ?? []).map((r) => [r.id, r])), [built]);
    const hrefOf = useCallback((target: RoadmapTarget) => tenantHref(timelinePathOf(target)), [tenantHref]);
    const openTask = useCallback(
        (id: string) => {
            const target = rowsById.get(id)?.target;
            if (target) router.push(hrefOf(target));
        },
        [rowsById, router, hrefOf],
    );

    const gridColumns = useMemo<GridColumn[]>(() => {
        const cells = built?.cells;
        return [
            { id: 'progress', header: t('col.progress'), width: 80, cell: (task: ChartTask) => progressText(cells?.get(task.id)?.progress ?? null, t('noItemsShort')) },
            {
                id: 'health',
                header: t('col.health'),
                width: 100,
                cell: (task: ChartTask) => {
                    const h = cells?.get(task.id)?.health;
                    return h === undefined ? '' : tRoadmap(`health.${h ?? 'none'}`);
                },
            },
        ];
    }, [built, t, tRoadmap]);
    const labels = useMemo(() => ({ key: '', title: t('col.name'), float: '', contextGroup: '' }), [t]);
    const noFloat = useCallback(() => '', []);
    const noOpen = useCallback(() => undefined, []);

    const zoomOptions: ComboboxOption[] = ROADMAP_ZOOMS.map((z) => ({ value: z, label: t(`zoom.${z}`) }));
    const controls = (
        <div className="flex flex-wrap items-center gap-default" data-testid={`${idPrefix}-controls`}>
            <ToggleGroup
                ariaLabel={t('view')}
                options={[
                    { value: 'chart', label: t('chart'), id: `${idPrefix}-mode-chart` },
                    { value: 'table', label: t('table'), id: `${idPrefix}-mode-table` },
                ]}
                selected={mode}
                selectAction={(v) => setMode(v === 'table' ? 'table' : 'chart')}
            />
            {mode === 'chart' && (
                <Combobox
                    selected={zoomOptions.find((o) => o.value === zoom) ?? null}
                    setSelected={(o) => o && setZoom(o.value === 'month' ? 'month' : 'quarter')}
                    options={zoomOptions}
                    hideSearch
                    caret
                    buttonProps={{ 'aria-label': t('zoomLabel') }}
                />
            )}
            {groupBy && (
                <ToggleGroup
                    ariaLabel={t('groupBy')}
                    options={[
                        { value: 'initiative', label: t('groupByInitiative'), id: `${idPrefix}-group-initiative` },
                        { value: 'goal', label: t('groupByGoal'), id: `${idPrefix}-group-goal` },
                    ]}
                    selected={groupBy.value}
                    selectAction={(v) => groupBy.onChange(v === 'goal' ? 'goal' : 'initiative')}
                />
            )}
        </div>
    );

    let body: React.ReactNode;
    if (roadmap.tooLarge) {
        body = (
            <InlineNotice variant="warning">
                <span data-testid={`${idPrefix}-too-large`}>{t(`tooLarge.${roadmap.tooLarge.what}`, { count: roadmap.tooLarge.count, limit: roadmap.tooLarge.limit })}</span>
            </InlineNotice>
        );
    } else if (roadmap.error) {
        body = (
            <InlineNotice variant="error">
                {t('loadFailed')} <Button variant="secondary" size="sm" text={t('retry')} onClick={roadmap.revalidate} />
            </InlineNotice>
        );
    } else if (!built) {
        body = <RoadmapTable rows={[]} hrefOf={hrefOf} loading idPrefix={idPrefix} />;
    } else if (built.model.table.length === 0) {
        body = <p className="text-sm text-content-muted" data-testid={`${idPrefix}-empty`}>{t('empty')}</p>;
    } else if (mode === 'table') {
        body = <RoadmapTable rows={built.model.table} hrefOf={hrefOf} idPrefix={idPrefix} />;
    } else {
        const m = built.model;
        body = (
            <div className="flex h-full min-h-0 flex-col md:flex-row">
                <div className="min-h-0 min-w-0 flex-1">
                    <TimelineChart
                        tasks={m.tasks}
                        links={[]}
                        criticalLinkIds={[]}
                        range={m.range}
                        zoom={zoom}
                        asOf={m.asOf}
                        nonWorking={NO_DAYS}
                        labels={labels}
                        floatLabel={noFloat}
                        onOpen={noOpen}
                        onSelect={openTask}
                        gridColumns={gridColumns}
                        region={{ id: `${idPrefix}-chart`, label: t('chartLabel'), description: t('chartDescription') }}
                        fallback={
                            <InlineNotice variant="error">
                                {t('loadFailed')} <Button variant="secondary" size="sm" text={t('table')} onClick={() => setMode('table')} />
                            </InlineNotice>
                        }
                    />
                </div>
                <NoDatesList rows={m.noDates} hrefOf={hrefOf} idPrefix={idPrefix} />
            </div>
        );
    }

    return (
        <section aria-labelledby={labelledBy ?? `${idPrefix}-heading`} className="flex h-full min-h-0 flex-col gap-compact" data-testid={`${idPrefix}-view`}>
            {!labelledBy && (
                <h2 id={`${idPrefix}-heading`} className="sr-only">
                    {t('heading')}
                </h2>
            )}
            {controls}
            <p className="text-sm text-content-muted" data-testid={`${idPrefix}-summary`}>
                {t('plannedDates')}
            </p>
            {mode === 'chart' && built && built.model.table.length > 0 && (
                <ul aria-label={t('legend.label')} className="flex flex-wrap gap-default text-xs text-content-muted">
                    <li className="flex items-center gap-tight">
                        <span aria-hidden className="inline-block h-3 w-5 rounded-sm bg-[var(--brand-default)]" />
                        {t('legend.bar')}
                    </li>
                    <li className="flex items-center gap-tight">
                        <span aria-hidden className="inline-block size-2.5 rotate-45 bg-[var(--accent-default)]" />
                        {t('legend.due')}
                    </li>
                    <li className="flex items-center gap-tight">
                        <span aria-hidden className="inline-block h-3 w-5 rounded-sm bg-[repeating-linear-gradient(135deg,transparent_0_3px,var(--border-error)_3px_5px)]" />
                        {t('legend.late')}
                    </li>
                    <li className="flex items-center gap-tight">
                        <span aria-hidden className="inline-block h-3 w-1 bg-[var(--brand-default)]" />
                        {t('legend.today')}
                    </li>
                </ul>
            )}
            <div className="min-h-0 flex-1">{body}</div>
        </section>
    );
}

function FlagsText({ row }: { row: RoadmapTableRow }) {
    const tFlags = useTranslations('roadmap.view.flags');
    if (row.flags.length === 0) return null;
    return (
        <span className="text-xs text-content-error">
            {row.flags.map((f: RoadmapFlag) => (f === 'lateMilestones' ? tFlags('lateMilestones', { count: row.lateMilestones }) : tFlags(f))).join('; ')}
        </span>
    );
}

function NoDatesList({ rows, hrefOf, idPrefix }: { rows: readonly RoadmapTableRow[]; hrefOf: (t: RoadmapTarget) => string; idPrefix: string }) {
    const tNoDates = useTranslations('roadmap.view.noDates');
    return (
        <aside aria-labelledby={`${idPrefix}-no-dates-heading`} className="flex w-full flex-col gap-compact overflow-y-auto border-border-subtle p-compact md:w-64 md:border-l" data-testid={`${idPrefix}-no-dates`}>
            <h3 id={`${idPrefix}-no-dates-heading`} className="text-sm font-semibold text-content-emphasis">
                {tNoDates('heading')} <span className="font-normal text-content-muted">({tNoDates('count', { count: rows.length })})</span>
            </h3>
            <p className="text-xs text-content-muted">{tNoDates('description')}</p>
            {rows.length === 0 ? (
                <p className="text-xs text-content-muted">{tNoDates('empty')}</p>
            ) : (
                <ul className="space-y-tight">
                    {rows.map((r) => (
                        <li key={r.id} className="text-sm">
                            <span className="mr-tight text-xs text-content-muted">{tNoDates(`kind.${r.kind}`)}</span>
                            {r.target ? (
                                <Link href={hrefOf(r.target)} className="hover:underline" aria-label={tNoDates('openLabel', { name: r.name })}>
                                    {r.name}
                                </Link>
                            ) : (
                                r.name
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </aside>
    );
}

/** The accessible equivalent (decision 203's rule, applied again): the same rows and numbers as the chart. */
export function RoadmapTable({ rows, hrefOf, loading, idPrefix }: { rows: readonly RoadmapTableRow[]; hrefOf: (t: RoadmapTarget) => string; loading?: boolean; idPrefix: string }) {
    const tTable = useTranslations('roadmap.view');
    const tStatus = useTranslations('roadmap');
    const columns = useMemo(
        () =>
            createColumns<RoadmapTableRow>([
                {
                    id: 'goal',
                    header: tTable('col.goal'),
                    cell: ({ row }) => (row.original.kind === 'goal' ? <span className="font-medium" style={{ paddingLeft: `${row.original.depth}rem` }}>{row.original.goal}</span> : row.original.goal ?? ''),
                },
                {
                    id: 'initiative',
                    header: tTable('col.initiative'),
                    cell: ({ row }) =>
                        row.original.kind === 'initiative' || row.original.kind === 'unlinked' || row.original.kind === 'no-goal' ? (
                            <span className="font-medium">{row.original.name}</span>
                        ) : (
                            (row.original.initiative ?? '')
                        ),
                },
                {
                    id: 'project',
                    header: tTable('col.project'),
                    cell: ({ row }) => (
                        <span className={row.original.archived ? 'text-content-muted' : undefined}>
                            {row.original.project ?? ''}
                            {row.original.archived && <span className="ml-tight text-xs text-content-muted">({tStatus('archived')})</span>}
                        </span>
                    ),
                },
                { id: 'start', header: tTable('col.start'), cell: ({ row }) => <span className="tabular-nums">{formatDay(row.original.start)}</span> },
                { id: 'finish', header: tTable('col.finish'), cell: ({ row }) => <span className="tabular-nums">{formatDay(row.original.finish)}</span> },
                { id: 'dueDate', header: tTable('col.dueDate'), cell: ({ row }) => <span className="tabular-nums">{formatDay(row.original.dueDate)}</span> },
                {
                    id: 'progress',
                    header: tTable('col.progress'),
                    cell: ({ row }) => (row.original.progress ? <ProgressCell name={row.original.name} summary={{ progress: row.original.progress, late: false, tooManyProjects: null }} /> : null),
                },
                { id: 'health', header: tTable('col.health'), cell: ({ row }) => (row.original.health === undefined ? null : <HealthText health={row.original.health} />) },
                { id: 'flags', header: tTable('col.flags'), cell: ({ row }) => <FlagsText row={row.original} /> },
                {
                    id: 'open',
                    header: tTable('col.open'),
                    cell: ({ row }) =>
                        row.original.target ? (
                            <Link href={hrefOf(row.original.target)} className="text-sm text-content-emphasis hover:underline" aria-label={tTable('openLabel', { name: row.original.name })}>
                                {tTable('open')}
                            </Link>
                        ) : null,
                },
            ]),
        [tTable, tStatus, hrefOf],
    );
    return (
        <DataTable<RoadmapTableRow>
            fillBody
            data={rows as RoadmapTableRow[]}
            columns={columns}
            loading={loading}
            getRowId={(r) => r.id}
            selectionEnabled={false}
            emptyState={tTable('empty')}
            resourceName={(plural) => (plural ? tTable('resourcePlural') : tTable('resource'))}
            data-testid={`${idPrefix}-table`}
        />
    );
}
