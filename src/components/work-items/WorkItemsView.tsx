'use client';

/**
 * The work-item view (sub-phase 2.3): the list on `EntityListPage` or the
 * board, over ONE set of filters (the shared filter system, synced to the
 * URL), the create modal, the bulk actions, the Deleted view with restore,
 * and the detail sheet. Used by the workspace list (`/work-items`), a
 * project (`/projects/<key>`, where the board's columns are the team's
 * states) and My Work (the person's assigned items).
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
import { FilterProvider, useFilterContext, useFilters } from '@/components/ui/filter';
import { useLocalStorage } from '@/components/ui/hooks';
import { BatchActionButton, createColumns, type TableInstance } from '@/components/ui/table';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import { usePermissions, useTenantContext, useTenantHref } from '@/lib/tenant-context-provider';
import { uiStorageKey } from '@/lib/ui-storage';
import { workItemPath } from '@/lib/work-item-paths';
import type { WorkItemRow, WorkflowStateCategory } from '@/lib/work-items/types';
import { WORKFLOW_STATE_CATEGORIES } from '@/app-layer/domain/workflow-state';

import { PriorityBadge, StateBadge } from './badges';
import { LANE_BY_VALUES, categoryColumns, stateColumns, type LaneBy } from './board/board-model';
import { WorkItemBoard } from './board/WorkItemBoard';
import { publishListOrder } from './data/list-order';
import type { WorkItemListFilters } from './data/list-filters';
import { memberLabel, useMembers, useWorkConfig } from './data/use-work-config';
import { useWorkItemList } from './data/use-work-item-list';
import { useWorkItemMutations } from './data/use-work-item-mutations';
import { buildWorkItemFilterDefs } from './filter-defs';
import { LayoutToggle, type WorkItemLayout } from './LayoutToggle';
import { NewWorkItemModal } from './NewWorkItemModal';
import { AssigneePicker } from './pickers';
import { WorkItemSheet } from './WorkItemSheet';

export interface WorkItemsViewProps {
    /** The view's fixed scope: a project (and its team), or an assignee (My Work). */
    scope: { projectId?: string; teamId?: string; assigneeId?: string };
    title: string;
    description?: string;
    /** Per-view key for the remembered layout and lanes. */
    viewKey: string;
}

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
    const tView = useTranslations('workItems');
    const config = useWorkConfig();
    const { members } = useMembers();
    const defs = useMemo(
        () =>
            buildWorkItemFilterDefs(
                config,
                members,
                { projectId: props.scope.projectId, teamId: props.scope.teamId, fixedAssignee: !!props.scope.assigneeId },
                (k, v) => tView(k, v),
            ),
        [config, members, props.scope, tView],
    );
    const filterCtx = useFilterContext(defs.filters, defs.filterKeys, { syncUrl: true });
    return (
        <FilterProvider value={filterCtx}>
            <WorkItemsViewBody {...props} filterDefs={defs.filters} />
        </FilterProvider>
    );
}

function WorkItemsViewBody({
    scope,
    title,
    description,
    viewKey,
    filterDefs,
}: WorkItemsViewProps & { filterDefs: ReturnType<typeof buildWorkItemFilterDefs>['filters'] }) {
    const tBody = useTranslations('workItems');
    const router = useRouter();
    const searchParams = useSearchParams();
    const tenantHref = useTenantHref();
    const { tenantSlug } = useTenantContext();
    const perms = usePermissions().work_items;
    const config = useWorkConfig();
    const { byId: memberById } = useMembers();
    const [layout, setLayout] = useLocalStorage<WorkItemLayout>(uiStorageKey('work-items', 'layout', viewKey), 'list');
    const [laneBy, setLaneBy] = useLocalStorage<LaneBy>(uiStorageKey('work-items', 'lanes', viewKey), 'none');
    const [sheetId, setSheetId] = useState<string | null>(null);
    const [creating, setCreating] = useState<{ stateId?: string } | null>(null);
    const [showDeleted, setShowDeleted] = useState(false);

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
            render={(filters, toolbar) => {
                const header = { title, description };
                const createButton = perms.create ? (
                    <Button id="new-work-item-btn" variant="primary" icon={<Plus />} text={tBody('list.create')} onClick={() => setCreating({})} />
                ) : null;
                const laneOptions: ComboboxOption[] = LANE_BY_VALUES.map((v) => ({ value: v, label: tBody(`lanes.${v}`) }));
                const actions = (
                    <div className="flex flex-wrap items-center gap-tight">
                        <LayoutToggle value={layout} onChange={setLayout} />
                        {layout === 'board' && (
                            <Combobox
                                selected={laneOptions.find((o) => o.value === laneBy) ?? null}
                                setSelected={(o) => o && setLaneBy(o.value as LaneBy)}
                                options={laneOptions}
                                hideSearch
                                caret
                                buttonProps={{ 'aria-label': tBody('lanes.label') }}
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
                            initial={{ projectId: scope.projectId, stateId: creating?.stateId }}
                            onCreated={(item) => setSheetId(item.id)}
                        />
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
                            <ListPageShell.Filters>{toolbar(createButton)}</ListPageShell.Filters>
                            <ListPageShell.Body>
                                <WorkItemBoard
                                    scope={filters}
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
                        header={{ ...header, actions }}
                        createButton={createButton}
                        filterDefs={filterDefs}
                        onOpen={openRow}
                        teamId={scope.teamId}
                        memberName={(id) => (id ? memberLabel(memberById.get(id)) : null)}
                        onPublish={(keys) => publishListOrder(tenantSlug, keys)}
                        openPage={(row) => router.push(tenantHref(workItemPath(row.key)))}
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
    render,
}: {
    scope: WorkItemsViewProps['scope'];
    render: (filters: WorkItemListFilters, toolbar: (leading: React.ReactNode) => React.ReactNode) => React.ReactNode;
}) {
    const tFilters = useTranslations('workItems');
    const { state, search, filters: defs } = useFilters();
    const filters = useMemo<WorkItemListFilters>(() => {
        const joined: Record<string, string> = {};
        for (const [key, values] of Object.entries(state)) if (values.length) joined[key] = values.join(',');
        return {
            ...joined,
            ...(scope.projectId ? { projectId: scope.projectId } : {}),
            ...(scope.assigneeId ? { assigneeId: scope.assigneeId } : {}),
            q: search,
            order: 'manual',
        };
    }, [state, search, scope.projectId, scope.assigneeId]);
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
    header,
    createButton,
    filterDefs,
    onOpen,
    teamId,
    memberName,
    onPublish,
    openPage,
    children,
}: {
    filters: WorkItemListFilters;
    header: { title: string; description?: string; actions: React.ReactNode };
    createButton: React.ReactNode;
    filterDefs: ReturnType<typeof buildWorkItemFilterDefs>['filters'];
    onOpen: (row: WorkItemRow) => void;
    teamId: string | undefined;
    memberName: (id: string | null) => string | null;
    onPublish: (keys: string[]) => void;
    openPage: (row: WorkItemRow) => void;
    children: React.ReactNode;
}) {
    const tList = useTranslations('workItems');
    const config = useWorkConfig();
    const tenantHref = useTenantHref();
    const list = useWorkItemList(filters);

    useEffect(() => {
        onPublish(list.items.map((i) => i.key));
        // Publish when the displayed order changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [list.items]);

    const columns = useMemo(
        () =>
            createColumns<WorkItemRow>([
                { id: 'key', header: tList('col.key'), cell: ({ row }) => <span className="font-mono text-xs text-content-muted">{row.original.key}</span> },
                {
                    id: 'title',
                    header: tList('col.title'),
                    cell: ({ row }) => (
                        <a
                            href={tenantHref(workItemPath(row.original.key))}
                            className="text-content-emphasis hover:underline"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                openPage(row.original);
                            }}
                        >
                            {row.original.title}
                        </a>
                    ),
                },
                {
                    id: 'state',
                    header: tList('col.state'),
                    cell: ({ row }) => <StateBadge name={config.stateById.get(row.original.stateId)?.name} category={row.original.stateCategory} />,
                },
                { id: 'priority', header: tList('col.priority'), cell: ({ row }) => <PriorityBadge priority={row.original.priority} /> },
                {
                    id: 'assignee',
                    header: tList('col.assignee'),
                    cell: ({ row }) => memberName(row.original.assigneeId) ?? <span className="text-content-muted">{tList('detail.unassigned')}</span>,
                },
                { id: 'due', header: tList('col.dueDate'), cell: ({ row }) => row.original.dueDate ?? '' },
            ]),
        [tList, config, tenantHref, memberName, openPage],
    );

    return (
        <EntityListPage<WorkItemRow>
            header={header}
            filters={{ defs: filterDefs, searchId: 'work-items-search', searchPlaceholder: tList('list.searchPlaceholder'), toolbarLeading: createButton }}
            table={{
                data: list.items,
                columns,
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
