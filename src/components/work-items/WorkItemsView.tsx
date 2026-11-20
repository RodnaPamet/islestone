'use client';

/**
 * The work-item view (sub-phase 2.3): the list on `EntityListPage` or the
 * board, over ONE set of filters (the shared filter system, synced to the
 * URL), the create modal, the bulk actions, the Deleted view with restore,
 * and the detail sheet. Used by the workspace list (`/work-items`), a
 * project (`/projects/<key>`, where the board's columns are the team's
 * states). My Work has its own sections (`MyWorkView`) over the same query.
 *
 * The list, every board column and the detail read the same hooks over the
 * one SWR cache, so a change in one is in the others at once; every mutation
 * is optimistic with rollback (`useWorkItemMutations`).
 *
 * Copied in structure from inflect-compliance
 * `src/app/t/[tenantSlug]/(app)/tasks/TasksClient.tsx` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e and rewritten per the 2.3 map:
 * on `EntityListPage` (the source hand-rolls `ListPageShell`); server order
 * and cursor pages instead of a 5,000-row in-memory sort; the bulk state
 * offers the scope's states, or the categories across teams; the Deleted
 * view, the role-gated bulk actions and the bulk delete with undo kept; the
 * severity, type, source and control columns, "Awaiting my review", the KPI
 * sparklines and the client-side sort cut.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Plus } from '@inflect/ui/components/ui/icons/nucleo';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FilterProvider, useFilters } from '@/components/ui/filter';
import { useLocalStorage } from '@/components/ui/hooks';
import { BatchActionButton, createColumns, type TableInstance } from '@/components/ui/table';
import { useColumnsDropdown } from '@/components/ui/table/use-columns-dropdown';
import type { ColumnVisibilityState } from '@/components/ui/table/types';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import { usePermissions, useTenantContext } from '@/lib/tenant-context-provider';
import { uiStorageKey } from '@/lib/ui-storage';
import { CUSTOM_FIELD_TYPE_SPECS, fieldIdOfOrder } from '@/lib/work-items/custom-fields';
import { LIST_SORTS } from '@/lib/work-items/list-sorts';
import type { SavedViewAffordances, SavedViewData, WorkItemRow, WorkflowStateCategory } from '@/lib/work-items/types';
import { WORKFLOW_STATE_CATEGORIES } from '@/app-layer/domain/workflow-state';

import { LANE_BY_VALUES, categoryColumns, isLaneableField, laneFieldId, stateColumns, type LaneBy } from './board/board-model';
import { WorkItemBoard } from './board/WorkItemBoard';
import { publishListOrder } from './data/list-order';
import type { WorkItemListFilters } from './data/list-filters';
import { useWorkConfig } from './data/use-work-config';
import { useWorkItemList } from './data/use-work-item-list';
import { useWorkItemMutations } from './data/use-work-item-mutations';
import { useSavedView } from './data/use-saved-views';
import { CustomFieldsManager } from './fields/CustomFieldsManager';
import { SavedViewsMenu } from './SavedViewsMenu';
import type { buildWorkItemFilterDefs } from './filter-defs';
import { LayoutToggle, type WorkItemLayout } from './LayoutToggle';
import { NewWorkItemModal } from './NewWorkItemModal';
import { AssigneePicker } from './pickers';
import { useWorkItemColumnChoices, useWorkItemColumns } from './use-work-item-columns';
import { useListFiltersFromContext, useWorkItemFilterContext } from './use-work-item-filter-context';
import { WorkItemSheet } from './WorkItemSheet';

export interface WorkItemsViewProps {
    /**
     * The view's fixed scope: a project (and its team), one cycle (and its
     * team, 2.5a), one milestone (and its project, 2.5b), or none (every
     * visible item).
     */
    scope: { projectId?: string; teamId?: string; cycleId?: string; milestoneId?: string };
    /** Shown above the filters (a cycle's stats and burn-up, 2.5a; a milestone's progress, 2.5b). */
    summary?: React.ReactNode;
    title: string;
    description?: string;
    /** Per-view key for the remembered layout and lanes. */
    viewKey: string;
    /** What the views menu offers (2.4), asked on the server. */
    savedViews?: SavedViewAffordances;
    /** The project's fields may be defined here (2.4, `manageCustomFields`, asked on the server). */
    manageCustomFields?: boolean;
}

const NO_SAVED_VIEWS: SavedViewAffordances = { savePersonal: false, saveShared: false, moderate: false };

interface DeletedRow extends WorkItemRow {
    deletedAt: string;
}

function BulkBar({
    table,
    teamId,
}: {
    table: TableInstance<WorkItemRow>;
    teamId: string | undefined;
}) {
    const tBulk = useTranslations('workItems');
    const perms = usePermissions().work_items;
    const config = useWorkConfig();
    const mutations = useWorkItemMutations();
    const rows = table.getSelectedRowModel().rows.map((r) => r.original);
    const done = () => table.resetRowSelection();

    // The scope's states for one team; across teams, the five categories
    // (each item goes to its own team's default state of that category, 2.2).
    const stateOptions: ComboboxOption[] = teamId
        ? config.statesOfTeam(teamId).map((s) => ({ value: `state:${s.id}`, label: s.name }))
        : WORKFLOW_STATE_CATEGORIES.map((c) => ({ value: `category:${c}`, label: tBulk(`category.${c}`) }));

    return (
        <>
            {perms.edit && (
                <Combobox
                    selected={null}
                    setSelected={(o) => {
                        if (!o) return;
                        const [kind, value] = o.value.split(':') as [string, string];
                        void mutations.bulkState(rows, kind === 'state' ? { stateId: value } : { stateCategory: value as WorkflowStateCategory });
                        done();
                    }}
                    options={stateOptions}
                    hideSearch
                    trigger={<BatchActionButton>{tBulk('bulk.setState')}</BatchActionButton>}
                />
            )}
            {perms.assign && (
                <AssigneePicker
                    label={tBulk('bulk.assign')}
                    value={null}
                    onChange={(assigneeId) => {
                        void mutations.bulkAssign(rows, assigneeId);
                        done();
                    }}
                />
            )}
            {perms.delete && (
                <BatchActionButton
                    variant="danger"
                    onClick={(e) => {
                        e.stopPropagation();
                        mutations.bulkRemove(rows);
                        done();
                    }}
                >
                    {tBulk('bulk.delete')}
                </BatchActionButton>
            )}
        </>
    );
}

function DeletedView({ onBack }: { onBack: () => void }) {
    const tDeleted = useTranslations('workItems');
    const mutations = useWorkItemMutations();
    const { data, error, isLoading } = useTenantSWR<{ rows: DeletedRow[]; truncated: boolean }>('/work-items/deleted');
    const columns = useMemo(
        () =>
            createColumns<DeletedRow>([
                { id: 'key', header: tDeleted('col.key'), cell: ({ row }) => <span className="font-mono text-xs">{row.original.key}</span> },
                { id: 'title', header: tDeleted('col.title'), cell: ({ row }) => row.original.title },
                {
                    id: 'restore',
                    header: '',
                    cell: ({ row }) => (
                        <Button
                            variant="secondary"
                            size="sm"
                            text={tDeleted('deleted.restore')}
                            aria-label={tDeleted('deleted.restoreItem', { key: row.original.key })}
                            onClick={() => void mutations.restore(row.original)}
                        />
                    ),
                },
            ]),
        [tDeleted, mutations],
    );
    return (
        <EntityListPage<DeletedRow>
            header={{
                title: tDeleted('deleted.title'),
                description: data?.truncated ? tDeleted('deleted.truncated') : tDeleted('deleted.description'),
                actions: <Button variant="secondary" text={tDeleted('deleted.back')} onClick={onBack} />,
            }}
            table={{
                data: data?.rows ?? [],
                columns,
                loading: isLoading,
                error: error ? tDeleted('list.loadFailed') : undefined,
                getRowId: (r) => r.id,
                selectionEnabled: false,
                emptyState: tDeleted('deleted.empty'),
                'data-testid': 'work-items-deleted-table',
            }}
        />
    );
}

export function WorkItemsView(props: WorkItemsViewProps) {
    const filterScope = useMemo(
        () => ({
            projectId: props.scope.projectId,
            teamId: props.scope.teamId,
            fixedCycle: props.scope.cycleId !== undefined,
            fixedMilestone: props.scope.milestoneId !== undefined,
        }),
        [props.scope.projectId, props.scope.teamId, props.scope.cycleId, props.scope.milestoneId],
    );
    const { filterCtx, filterDefs } = useWorkItemFilterContext(filterScope);
    return (
        <FilterProvider value={filterCtx}>
            <WorkItemsViewBody {...props} filterDefs={filterDefs} />
        </FilterProvider>
    );
}

function WorkItemsViewBody({
    scope,
    title,
    description,
    viewKey,
    filterDefs,
    savedViews = NO_SAVED_VIEWS,
    manageCustomFields = false,
    summary,
}: WorkItemsViewProps & { filterDefs: ReturnType<typeof buildWorkItemFilterDefs>['filters'] }) {
    const tBody = useTranslations('workItems');
    const searchParams = useSearchParams();
    const router = useRouter();
    const { tenantSlug } = useTenantContext();
    const perms = usePermissions().work_items;
    const config = useWorkConfig();
    const filterApi = useFilters();
    const [layout, setLayout] = useLocalStorage<WorkItemLayout>(uiStorageKey('work-items', 'layout', viewKey), 'list');
    const [storedLaneBy, setLaneBy] = useLocalStorage<LaneBy>(uiStorageKey('work-items', 'lanes', viewKey), 'none');
    const [storedSort, setSort] = useLocalStorage<string>(uiStorageKey('work-items', 'sort', viewKey), 'manual');
    const [sheetId, setSheetId] = useState<string | null>(null);
    const [creating, setCreating] = useState<{ stateId?: string } | null>(null);
    const [showDeleted, setShowDeleted] = useState(false);
    const [activeViewId, setActiveViewId] = useState<string | null>(searchParams?.get('view') ?? null);
    const [fieldsOpen, setFieldsOpen] = useState(false);

    // Sub-phase 2.4: the page's live fields decide which field sorts and
    // lanes exist; a remembered one whose field is gone falls back.
    const liveFields = useMemo(() => (config.customFields ?? []).filter((f) => !f.archived), [config]);
    const sortableFields = useMemo(() => liveFields.filter((f) => CUSTOM_FIELD_TYPE_SPECS[f.type].sortable), [liveFields]);
    const laneFields = useMemo(() => liveFields.filter((f) => isLaneableField(f.type)), [liveFields]);
    const sortFieldId = fieldIdOfOrder(storedSort);
    const sort = sortFieldId
        ? sortableFields.some((f) => f.id === sortFieldId)
            ? storedSort
            : 'manual'
        : (LIST_SORTS as readonly string[]).includes(storedSort)
          ? storedSort
          : 'manual';
    const laneId = laneFieldId(storedLaneBy);
    const laneBy: LaneBy = laneId && !laneFields.some((f) => f.id === laneId) ? 'none' : storedLaneBy;

    const columnChoices = useWorkItemColumnChoices();
    const columnsGear = useColumnsDropdown({ storageKey: uiStorageKey('col-vis', `work-items:${viewKey}`), columns: columnChoices });

    const snapshot = useCallback(
        () => ({
            layout: layout === 'board' ? ('BOARD' as const) : ('LIST' as const),
            config: {
                filters: Object.fromEntries(Object.entries(filterApi.state).filter(([, v]) => v.length > 0)),
                ...(filterApi.search ? { q: filterApi.search } : {}),
                sort,
                laneBy,
                columns: columnChoices.filter((c) => columnsGear.columnVisibility[c.id] !== false).map((c) => c.id),
            },
        }),
        [layout, filterApi.state, filterApi.search, sort, laneBy, columnChoices, columnsGear.columnVisibility],
    );

    const applyView = useCallback(
        (view: SavedViewData) => {
            filterApi.clearAll();
            for (const [key, values] of Object.entries(view.config.filters ?? {})) if (values.length) filterApi.add(key, values);
            filterApi.setSearch(view.config.q ?? '');
            setLayout(view.layout === 'BOARD' ? 'board' : 'list');
            setLaneBy((view.config.laneBy as LaneBy) || 'none');
            setSort(view.config.sort || 'manual');
            if (view.config.columns) {
                const visible = new Set(view.config.columns);
                const map: ColumnVisibilityState = {};
                for (const c of columnChoices) map[c.id] = c.alwaysVisible === true || visible.has(c.id);
                columnsGear.setColumnVisibility(map);
            }
        },
        [filterApi, setLayout, setLaneBy, setSort, columnChoices, columnsGear],
    );

    // `?view=<id>` (the Views page's links) applies that view once.
    const deepLinkId = searchParams?.get('view') ?? null;
    const { data: deepLinked } = useSavedView(deepLinkId);
    const [appliedDeepLink, setAppliedDeepLink] = useState<string | null>(null);
    useEffect(() => {
        if (!deepLinked || appliedDeepLink === deepLinked.id) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- apply the linked view once it has loaded
        setAppliedDeepLink(deepLinked.id);
        setActiveViewId(deepLinked.id);
        applyView(deepLinked);
    }, [deepLinked, appliedDeepLink, applyView]);

    // `?create=1` opens the create dialog (the "new" deep link).
    useEffect(() => {
        if (searchParams?.get('create') === '1' && perms.create) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- open once from the deep link
            setCreating({});
        }
    }, [searchParams, perms.create]);

    return (
        <FiltersBound
            scope={scope}
            sort={sort}
            render={(filters, toolbar) => {
                const header = { title, description };
                const createButton = perms.create ? (
                    <Button id="new-work-item-btn" variant="primary" icon={<Plus />} text={tBody('list.create')} onClick={() => setCreating({})} />
                ) : null;
                const laneOptions: ComboboxOption[] = [
                    ...LANE_BY_VALUES.map((v) => ({ value: v, label: tBody(`lanes.${v}`) })),
                    ...laneFields.map((f) => ({ value: `cf:${f.id}`, label: f.name })),
                ];
                const sortOptions: ComboboxOption[] = [
                    ...LIST_SORTS.map((v) => ({ value: v, label: tBody(`sort.${v}`) })),
                    ...sortableFields.map((f) => ({ value: `cf:${f.id}`, label: f.name })),
                ];
                const actions = (
                    <div className="flex flex-wrap items-center gap-tight">
                        {/* A cycle's or a milestone's page has no saved views: a view's scope is the workspace or a project. */}
                        {!scope.cycleId && !scope.milestoneId && (
                            <SavedViewsMenu
                                projectId={scope.projectId ?? null}
                                affordances={savedViews}
                                snapshot={snapshot}
                                onApply={applyView}
                                activeViewId={activeViewId}
                                onActiveChange={setActiveViewId}
                            />
                        )}
                        <LayoutToggle value={layout} onChange={setLayout} />
                        {layout === 'list' && (
                            <Combobox
                                selected={sortOptions.find((o) => o.value === sort) ?? null}
                                setSelected={(o) => o && setSort(o.value)}
                                options={sortOptions}
                                hideSearch
                                caret
                                buttonProps={{ 'aria-label': tBody('sort.choose') }}
                            />
                        )}
                        {layout === 'list' && columnsGear.dropdown}
                        {manageCustomFields && scope.projectId && (
                            <Button id="custom-fields-btn" variant="secondary" text={tBody('customFields.manage')} onClick={() => setFieldsOpen(true)} />
                        )}
                        {layout === 'board' && (
                            <Combobox
                                selected={laneOptions.find((o) => o.value === laneBy) ?? null}
                                setSelected={(o) => o && setLaneBy(o.value as LaneBy)}
                                options={laneOptions}
                                hideSearch
                                caret
                                buttonProps={{ 'aria-label': tBody('lanes.choose') }}
                            />
                        )}
                        {perms.delete && layout === 'list' && (
                            <Button variant="ghost" text={tBody('deleted.open')} onClick={() => setShowDeleted(true)} />
                        )}
                    </div>
                );
                const openRow = (row: { id: string }) => setSheetId(row.id);
                const sheet = (
                    <>
                        <WorkItemSheet workItemId={sheetId} onClose={() => setSheetId(null)} onOpenItem={(r) => setSheetId(r.id)} />
                        <NewWorkItemModal
                            open={creating !== null}
                            onOpenChange={(open) => {
                                if (!open) setCreating(null);
                            }}
                            initial={{ projectId: scope.projectId, stateId: creating?.stateId, cycleId: scope.cycleId, milestoneId: scope.milestoneId }}
                            onCreated={(item) => setSheetId(item.id)}
                        />
                        {manageCustomFields && scope.projectId && (
                            <CustomFieldsManager
                                projectId={scope.projectId}
                                projectName={title}
                                open={fieldsOpen}
                                onOpenChange={(open) => {
                                    setFieldsOpen(open);
                                    // The views render with the server page's fields: read them again.
                                    if (!open) router.refresh();
                                }}
                            />
                        )}
                    </>
                );
                if (showDeleted) return <DeletedView onBack={() => setShowDeleted(false)} />;
                if (layout === 'board') {
                    const columns = scope.teamId ? stateColumns(config.statesOfTeam(scope.teamId)) : categoryColumns();
                    return (
                        <ListPageShell>
                            <ListPageShell.Header>
                                <PageHeader title={header.title} description={header.description} actions={actions} />
                            </ListPageShell.Header>
                            <ListPageShell.Filters className="space-y-section">
                                {summary}
                                {toolbar(createButton)}
                            </ListPageShell.Filters>
                            <ListPageShell.Body>
                                <WorkItemBoard
                                    scope={{ ...filters, order: 'manual', dir: undefined }}
                                    columns={columns}
                                    laneBy={laneBy}
                                    onOpen={openRow}
                                    onCreate={perms.create ? (stateId) => setCreating({ stateId }) : undefined}
                                    canEdit={perms.edit}
                                    canAssign={perms.assign}
                                />
                            </ListPageShell.Body>
                            {sheet}
                        </ListPageShell>
                    );
                }
                return (
                    <ListLayout
                        filters={filters}
                        columnVisibility={columnsGear.columnVisibility}
                        orderColumns={columnsGear.orderColumns}
                        header={{ ...header, actions }}
                        createButton={createButton}
                        filterDefs={filterDefs}
                        onOpen={openRow}
                        teamId={scope.teamId}
                        summary={summary}
                        onPublish={(keys) => publishListOrder(tenantSlug, keys)}
                    >
                        {sheet}
                    </ListLayout>
                );
            }}
        />
    );
}

/** Turns the filter context into the list query and hands the toolbar to the layout. */
function FiltersBound({
    scope,
    sort,
    render,
}: {
    scope: WorkItemsViewProps['scope'];
    /** The list's order (2.4): a named sort or `cf:<fieldId>`. */
    sort: string;
    render: (filters: WorkItemListFilters, toolbar: (leading: React.ReactNode) => React.ReactNode) => React.ReactNode;
}) {
    const tFilters = useTranslations('workItems');
    const { filters: defs } = useFilters();
    const fromContext = useListFiltersFromContext();
    const filters = useMemo<WorkItemListFilters>(
        () => ({
            ...fromContext,
            ...(scope.projectId ? { projectId: scope.projectId } : {}),
            ...(scope.cycleId ? { cycleId: scope.cycleId } : {}),
            ...(scope.milestoneId ? { milestoneId: scope.milestoneId } : {}),
            order: sort,
        }),
        [fromContext, scope.projectId, scope.cycleId, scope.milestoneId, sort],
    );
    const toolbar = useCallback(
        (leading: React.ReactNode) => (
            <FilterToolbar filters={defs} searchId="work-items-search" searchPlaceholder={tFilters('list.searchPlaceholder')} leading={leading} />
        ),
        [defs, tFilters],
    );
    return <>{render(filters, toolbar)}</>;
}

function ListLayout({
    filters,
    columnVisibility,
    orderColumns,
    header,
    createButton,
    filterDefs,
    onOpen,
    teamId,
    summary,
    onPublish,
    children,
}: {
    summary?: React.ReactNode;
    filters: WorkItemListFilters;
    columnVisibility: ColumnVisibilityState;
    orderColumns: <T extends object>(columns: ReadonlyArray<T>) => T[];
    header: { title: string; description?: string; actions: React.ReactNode };
    createButton: React.ReactNode;
    filterDefs: ReturnType<typeof buildWorkItemFilterDefs>['filters'];
    onOpen: (row: WorkItemRow) => void;
    teamId: string | undefined;
    onPublish: (keys: string[]) => void;
    children: React.ReactNode;
}) {
    const tList = useTranslations('workItems');
    const list = useWorkItemList(filters);

    useEffect(() => {
        onPublish(list.items.map((i) => i.key));
        // Publish when the displayed order changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [list.items]);

    const baseColumns = useWorkItemColumns(true);
    const columns = useMemo(() => orderColumns(baseColumns), [orderColumns, baseColumns]);

    return (
        <EntityListPage<WorkItemRow>
            header={header}
            kpis={summary}
            filters={{ defs: filterDefs, searchId: 'work-items-search', searchPlaceholder: tList('list.searchPlaceholder'), toolbarLeading: createButton }}
            table={{
                data: list.items,
                columns,
                columnVisibility,
                loading: list.isLoading,
                error: list.error ? tList('list.loadFailed') : undefined,
                getRowId: (r) => r.id,
                onRowClick: (row) => onOpen(row.original),
                onReachEnd: list.hasMore ? list.loadMore : undefined,
                selectionControls: (table) => <BulkBar table={table} teamId={teamId} />,
                emptyState: tList('list.empty'),
                resourceName: (plural) => (plural ? tList('list.resourcePlural') : tList('list.resource')),
                'data-testid': 'work-items-table',
            }}
        >
            {children}
        </EntityListPage>
    );
}
