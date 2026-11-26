'use client';

/**
 * Goals (sub-phase 3.2b; docs/porting/maps/3.2.md, "The pages and
 * navigation"; owner decisions 205, 212 and 222): the goal tree as indented
 * rows (title, status, lead, due date, health, progress with "12 of 40
 * done", "Late"), filtered by status, health, lead and archived through the
 * shared filter system, and a Deleted view with Restore. A viewer the server
 * offers `manage` creates goals ("Goal", the noun beside the plus).
 *
 * The rows are the server's list (`GET /goals`), already in status, due date
 * and title order; the page nests each row under its nearest shown ancestor
 * and keeps that order among siblings.
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { BoxArchive, CirclePercentage, CircleDotted, Plus, UserCheck } from '@inflect/ui/components/ui/icons/nucleo';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { FilterProvider, createFilterDefs, useFilterContext, useFilters } from '@/components/ui/filter';
import { createColumns } from '@/components/ui/table';
import { memberLabel, useMembers } from '@/components/work-items/data/use-work-config';
import type { GoalSummary, RoadmapAffordances, ViewGoal } from '@/lib/goals/types';
import { useTenantHref } from '@/lib/tenant-context-provider';

import { GoalDialog } from './GoalDialogs';
import { HEALTH_OPTIONS, HealthText, ProgressCell, RoadmapTabs, STATUS_OPTIONS } from './goal-parts';
import { listQuery, useGoalList, useGoalWrites } from './use-goals';

type Row = GoalSummary & { depth: number };

/**
 * Each row under its nearest shown ancestor, siblings in the server's order.
 * `knownParents` (the live goals' parents) lets a row skip an ancestor the
 * filters left out.
 */
export function nestRows<T extends { id: string; parentId: string | null }>(rows: readonly T[], knownParents: ReadonlyMap<string, string | null> = new Map()): Array<T & { depth: number }> {
    const shown = new Map(rows.map((r) => [r.id, r]));
    const parentOf = (id: string): string | null => shown.get(id)?.parentId ?? knownParents.get(id) ?? null;
    const nearest = (r: T): string | null => {
        let p = r.parentId;
        for (let i = 0; p && i < 8; i++) {
            if (shown.has(p)) return p;
            p = parentOf(p);
        }
        return null;
    };
    const children = new Map<string | null, T[]>();
    for (const r of rows) {
        const key = nearest(r);
        children.set(key, [...(children.get(key) ?? []), r]);
    }
    const out: Array<T & { depth: number }> = [];
    const seen = new Set<string>();
    const walk = (key: string | null, depth: number) => {
        for (const r of children.get(key) ?? []) {
            if (seen.has(r.id)) continue;
            seen.add(r.id);
            out.push({ ...r, depth });
            walk(r.id, depth + 1);
        }
    };
    walk(null, 0);
    // A row in a parent loop (never written: the tree is checked) still shows.
    for (const r of rows) if (!seen.has(r.id)) out.push({ ...r, depth: 0 });
    return out;
}

function useGoalFilterDefs() {
    const tDefs = useTranslations('roadmap');
    const { members } = useMembers();
    return useMemo(
        () =>
            createFilterDefs({
                status: { label: tDefs('filters.status'), icon: CircleDotted, multiple: true, options: STATUS_OPTIONS.map((s) => ({ value: s, label: tDefs(`status.${s}`) })) },
                health: { label: tDefs('filters.health'), icon: CirclePercentage, multiple: true, options: HEALTH_OPTIONS.map((h) => ({ value: h, label: tDefs(`health.${h}`) })) },
                leadUserId: { label: tDefs('filters.lead'), icon: UserCheck, options: members.map((m) => ({ value: m.id, label: memberLabel(m) ?? m.id })) },
                archived: { label: tDefs('filters.archived'), icon: BoxArchive, options: [{ value: 'true', label: tDefs('filters.showArchived') }] },
            }),
        [members, tDefs],
    );
}

/** The list's query from the filter state (comma-joined values; the API reads the same keys). */
export function useRoadmapListQuery(): string {
    const { state } = useFilters();
    return listQuery({
        status: state.status?.join(','),
        health: state.health?.join(','),
        leadUserId: state.leadUserId?.[0],
        archived: state.archived?.includes('true') ? 'true' : undefined,
    });
}

export function GoalsView(props: { initialGoals: GoalSummary[]; goalOptions: ViewGoal[]; affordances: RoadmapAffordances }) {
    const defs = useGoalFilterDefs();
    const filterCtx = useFilterContext(defs.filters, defs.filterKeys, { syncUrl: true });
    const [deletedView, setDeletedView] = useState(false);
    return (
        <FilterProvider value={filterCtx}>
            {deletedView ? <DeletedGoals affordances={props.affordances} onBack={() => setDeletedView(false)} /> : <GoalsList {...props} filterDefs={defs.filters} onDeleted={() => setDeletedView(true)} />}
        </FilterProvider>
    );
}

function GoalsList({
    initialGoals,
    goalOptions,
    affordances,
    filterDefs,
    onDeleted,
}: {
    initialGoals: GoalSummary[];
    goalOptions: ViewGoal[];
    affordances: RoadmapAffordances;
    filterDefs: ReturnType<typeof createFilterDefs>['filters'];
    onDeleted: () => void;
}) {
    const t = useTranslations('goals');
    const tRoadmap = useTranslations('roadmap');
    const router = useRouter();
    const tenantHref = useTenantHref();
    const { byId: members } = useMembers();
    const query = useRoadmapListQuery();
    // The server's first page is the unfiltered list; a filtered read starts empty.
    const { data, error, isLoading } = useGoalList(query, query ? undefined : { goals: initialGoals });
    const [creating, setCreating] = useState(false);
    const knownParents = useMemo(() => new Map(goalOptions.map((g) => [g.id, g.parentId])), [goalOptions]);
    const rows = useMemo<Row[]>(() => nestRows(data?.goals ?? [], knownParents), [data, knownParents]);
    const hrefOf = useCallback((id: string) => tenantHref(`/roadmap/goals/${encodeURIComponent(id)}`), [tenantHref]);
    const columns = useMemo(
        () =>
            createColumns<Row>([
                {
                    id: 'title',
                    header: t('col.title'),
                    cell: ({ row }) => (
                        <span className="flex items-center gap-tight" style={{ paddingLeft: `${row.original.depth * 1.25}rem` }}>
                            <Link href={hrefOf(row.original.id)} className="text-content-emphasis hover:underline">
                                {row.original.title}
                            </Link>
                            {row.original.archived && <span className="text-xs text-content-muted">{tRoadmap('archived')}</span>}
                            {row.original.late && <span className="text-xs font-medium text-content-error">{tRoadmap('late')}</span>}
                        </span>
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
                { id: 'progress', header: t('col.progress'), cell: ({ row }) => <ProgressCell name={row.original.title} summary={row.original} /> },
            ]),
        [t, tRoadmap, members, hrefOf],
    );
    return (
        <EntityListPage<Row>
            header={{
                title: t('title'),
                description: t('description'),
                actions: (
                    <>
                        <Button variant="secondary" text={tRoadmap('deletedView')} onClick={onDeleted} />
                        {affordances.manage && <Button id="new-goal-btn" variant="primary" icon={<Plus />} text={t('new')} onClick={() => setCreating(true)} />}
                    </>
                ),
            }}
            kpis={<RoadmapTabs />}
            filters={{ defs: filterDefs }}
            table={{
                data: rows,
                columns,
                loading: isLoading && !data,
                error: error ? t('loadFailed') : undefined,
                getRowId: (r) => r.id,
                onRowClick: (row) => router.push(hrefOf(row.original.id)),
                selectionEnabled: false,
                emptyState: t('empty'),
                'data-testid': 'goals-table',
            }}
        >
            {affordances.manage && <GoalDialog open={creating} onOpenChange={setCreating} goals={goalOptions} />}
        </EntityListPage>
    );
}

function DeletedGoals({ affordances, onBack }: { affordances: RoadmapAffordances; onBack: () => void }) {
    const tDel = useTranslations('goals');
    const tDelRoadmap = useTranslations('roadmap');
    const writes = useGoalWrites();
    const { data, error, isLoading } = useGoalList('?deleted=true');
    const columns = useMemo(
        () =>
            createColumns<GoalSummary>([
                { id: 'title', header: tDel('col.title'), cell: ({ row }) => row.original.title },
                { id: 'deletedAt', header: tDel('deleted.deletedAt'), cell: ({ row }) => <span className="tabular-nums">{row.original.deletedAt ? String(row.original.deletedAt).slice(0, 10) : ''}</span> },
                {
                    id: 'restore',
                    header: tDelRoadmap('actions'),
                    cell: ({ row }) =>
                        affordances.manage ? (
                            <Button variant="secondary" size="sm" text={tDelRoadmap('restore')} onClick={() => void writes.restore('goal', row.original.id, row.original.title)} />
                        ) : null,
                },
            ]),
        [affordances.manage, tDel, tDelRoadmap, writes],
    );
    return (
        <EntityListPage<GoalSummary>
            header={{ title: tDel('deleted.title'), description: tDel('deleted.description'), actions: <Button variant="secondary" text={tDel('deleted.back')} onClick={onBack} /> }}
            kpis={<RoadmapTabs />}
            table={{
                data: data?.goals ?? [],
                columns,
                loading: isLoading,
                error: error ? tDel('loadFailed') : undefined,
                getRowId: (r) => r.id,
                selectionEnabled: false,
                emptyState: tDel('deleted.empty'),
                'data-testid': 'goals-deleted-table',
            }}
        />
    );
}
