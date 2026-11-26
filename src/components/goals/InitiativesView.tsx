'use client';

/**
 * Initiatives (sub-phase 3.2b; docs/porting/maps/3.2.md, "The pages and
 * navigation"; owner decisions 212 and 222): every initiative with the goal
 * it serves, its status, lead, due date, health and progress, filtered as
 * the goals list is (and by goal), and its own Deleted view with Restore. A
 * viewer the server offers `manage` creates initiatives.
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { BoxArchive, CirclePercentage, CircleDotted, MarketingTarget, Plus, UserCheck } from '@inflect/ui/components/ui/icons/nucleo';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { FilterProvider, createFilterDefs, useFilterContext, useFilters } from '@/components/ui/filter';
import { createColumns } from '@/components/ui/table';
import { memberLabel, useMembers } from '@/components/work-items/data/use-work-config';
import type { InitiativeSummary, RoadmapAffordances, ViewGoal } from '@/lib/goals/types';
import { useTenantHref } from '@/lib/tenant-context-provider';

import { InitiativeDialog } from './GoalDialogs';
import { HEALTH_OPTIONS, HealthText, ProgressCell, RoadmapTabs, STATUS_OPTIONS } from './goal-parts';
import { listQuery, useGoalWrites, useInitiativeList } from './use-goals';

function useInitiativeFilterDefs(goals: readonly ViewGoal[]) {
    const tDefs = useTranslations('roadmap');
    const { members } = useMembers();
    return useMemo(
        () =>
            createFilterDefs({
                goalId: { label: tDefs('filters.goal'), icon: MarketingTarget, options: goals.map((g) => ({ value: g.id, label: g.title })) },
                status: { label: tDefs('filters.status'), icon: CircleDotted, multiple: true, options: STATUS_OPTIONS.map((s) => ({ value: s, label: tDefs(`status.${s}`) })) },
                health: { label: tDefs('filters.health'), icon: CirclePercentage, multiple: true, options: HEALTH_OPTIONS.map((h) => ({ value: h, label: tDefs(`health.${h}`) })) },
                leadUserId: { label: tDefs('filters.lead'), icon: UserCheck, options: members.map((m) => ({ value: m.id, label: memberLabel(m) ?? m.id })) },
                archived: { label: tDefs('filters.archived'), icon: BoxArchive, options: [{ value: 'true', label: tDefs('filters.showArchived') }] },
            }),
        [goals, members, tDefs],
    );
}

function useInitiativeListQuery(): string {
    const { state } = useFilters();
    return listQuery({
        goalId: state.goalId?.[0],
        status: state.status?.join(','),
        health: state.health?.join(','),
        leadUserId: state.leadUserId?.[0],
        archived: state.archived?.includes('true') ? 'true' : undefined,
    });
}

export function InitiativesView(props: { initialInitiatives: InitiativeSummary[]; goalOptions: ViewGoal[]; affordances: RoadmapAffordances }) {
    const defs = useInitiativeFilterDefs(props.goalOptions);
    const filterCtx = useFilterContext(defs.filters, defs.filterKeys, { syncUrl: true });
    const [deletedView, setDeletedView] = useState(false);
    return (
        <FilterProvider value={filterCtx}>
            {deletedView ? (
                <DeletedInitiatives affordances={props.affordances} onBack={() => setDeletedView(false)} />
            ) : (
                <InitiativesList {...props} filterDefs={defs.filters} onDeleted={() => setDeletedView(true)} />
            )}
        </FilterProvider>
    );
}

function InitiativesList({
    initialInitiatives,
    goalOptions,
    affordances,
    filterDefs,
    onDeleted,
}: {
    initialInitiatives: InitiativeSummary[];
    goalOptions: ViewGoal[];
    affordances: RoadmapAffordances;
    filterDefs: ReturnType<typeof createFilterDefs>['filters'];
    onDeleted: () => void;
}) {
    const t = useTranslations('initiatives');
    const tRoadmap = useTranslations('roadmap');
    const router = useRouter();
    const tenantHref = useTenantHref();
    const { byId: members } = useMembers();
    const query = useInitiativeListQuery();
    const { data, error, isLoading } = useInitiativeList(query, query ? undefined : { initiatives: initialInitiatives });
    const [creating, setCreating] = useState(false);
    const goalTitle = useMemo(() => new Map(goalOptions.map((g) => [g.id, g.title])), [goalOptions]);
    const hrefOf = useCallback((id: string) => tenantHref(`/roadmap/initiatives/${encodeURIComponent(id)}`), [tenantHref]);
    const columns = useMemo(
        () =>
            createColumns<InitiativeSummary>([
                {
                    id: 'name',
                    header: t('col.name'),
                    cell: ({ row }) => (
                        <span className="flex items-center gap-tight">
                            <Link href={hrefOf(row.original.id)} className="text-content-emphasis hover:underline">
                                {row.original.name}
                            </Link>
                            {row.original.archived && <span className="text-xs text-content-muted">{tRoadmap('archived')}</span>}
                            {row.original.late && <span className="text-xs font-medium text-content-error">{tRoadmap('late')}</span>}
                        </span>
                    ),
                },
                {
                    id: 'goal',
                    header: t('col.goal'),
                    cell: ({ row }) =>
                        row.original.goalId && goalTitle.has(row.original.goalId) ? (
                            <Link href={tenantHref(`/roadmap/goals/${encodeURIComponent(row.original.goalId)}`)} className="hover:underline">
                                {goalTitle.get(row.original.goalId)}
                            </Link>
                        ) : (
                            <span className="text-content-muted">{t('noGoal')}</span>
                        ),
                },
                { id: 'status', header: t('col.status'), cell: ({ row }) => tRoadmap(`status.${row.original.status}`) },
                {
                    id: 'lead',
                    header: t('col.lead'),
                    cell: ({ row }) => (row.original.leadUserId ? (memberLabel(members.get(row.original.leadUserId)) ?? '') : <span className="text-content-muted">{tRoadmap('noLead')}</span>),
                },
                { id: 'dueDate', header: t('col.dueDate'), cell: ({ row }) => <span className="tabular-nums">{row.original.dueDate ?? ''}</span> },
                { id: 'health', header: t('col.health'), cell: ({ row }) => <HealthText health={row.original.health} /> },
                { id: 'progress', header: t('col.progress'), cell: ({ row }) => <ProgressCell name={row.original.name} summary={row.original} /> },
            ]),
        [t, tRoadmap, members, hrefOf, goalTitle, tenantHref],
    );
    return (
        <EntityListPage<InitiativeSummary>
            header={{
                title: t('title'),
                description: t('description'),
                actions: (
                    <>
                        <Button variant="secondary" text={tRoadmap('deletedView')} onClick={onDeleted} />
                        {affordances.manage && <Button id="new-initiative-btn" variant="primary" icon={<Plus />} text={t('new')} onClick={() => setCreating(true)} />}
                    </>
                ),
            }}
            kpis={<RoadmapTabs />}
            filters={{ defs: filterDefs }}
            table={{
                data: data?.initiatives ?? [],
                columns,
                loading: isLoading && !data,
                error: error ? t('loadFailed') : undefined,
                getRowId: (r) => r.id,
                onRowClick: (row) => router.push(hrefOf(row.original.id)),
                selectionEnabled: false,
                emptyState: t('empty'),
                'data-testid': 'initiatives-table',
            }}
        >
            {affordances.manage && <InitiativeDialog open={creating} onOpenChange={setCreating} goals={goalOptions} />}
        </EntityListPage>
    );
}

function DeletedInitiatives({ affordances, onBack }: { affordances: RoadmapAffordances; onBack: () => void }) {
    const tDel = useTranslations('initiatives');
    const tDelRoadmap = useTranslations('roadmap');
    const writes = useGoalWrites();
    const { data, error, isLoading } = useInitiativeList('?deleted=true');
    const columns = useMemo(
        () =>
            createColumns<InitiativeSummary>([
                { id: 'name', header: tDel('col.name'), cell: ({ row }) => row.original.name },
                { id: 'deletedAt', header: tDel('deleted.deletedAt'), cell: ({ row }) => <span className="tabular-nums">{row.original.deletedAt ? String(row.original.deletedAt).slice(0, 10) : ''}</span> },
                {
                    id: 'restore',
                    header: tDelRoadmap('actions'),
                    cell: ({ row }) =>
                        affordances.manage ? (
                            <Button variant="secondary" size="sm" text={tDelRoadmap('restore')} onClick={() => void writes.restore('initiative', row.original.id, row.original.name)} />
                        ) : null,
                },
            ]),
        [affordances.manage, tDel, tDelRoadmap, writes],
    );
    return (
        <EntityListPage<InitiativeSummary>
            header={{ title: tDel('deleted.title'), description: tDel('deleted.description'), actions: <Button variant="secondary" text={tDel('deleted.back')} onClick={onBack} /> }}
            kpis={<RoadmapTabs />}
            table={{
                data: data?.initiatives ?? [],
                columns,
                loading: isLoading,
                error: error ? tDel('loadFailed') : undefined,
                getRowId: (r) => r.id,
                selectionEnabled: false,
                emptyState: tDel('deleted.empty'),
                'data-testid': 'initiatives-deleted-table',
            }}
        />
    );
}
