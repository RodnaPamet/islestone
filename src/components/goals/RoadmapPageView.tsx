'use client';

/**
 * The Roadmap page (sub-phase 3.2c; docs/porting/maps/3.2.md, "Where it
 * appears"; owner decisions 216, 217 and 222): the Roadmap entry's landing
 * page, beside Goals and Initiatives (the tab bar). The filters (goal,
 * initiative, team, lead, health, status, archived) go through the shared
 * filter system, synced to the URL; "Group by: Initiative / Goal" is a
 * control of the view, remembered per viewer. The chart, the table and the
 * "No dates" list are `RoadmapView`'s.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { BoxArchive, CircleDotted, CirclePercentage, MarketingTarget, StackY3, UserCheck, Users } from '@inflect/ui/components/ui/icons/nucleo';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { ListPageShell } from '@/components/layout/ListPageShell';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterProvider, createFilterDefs, useFilterContext, useFilters } from '@/components/ui/filter';
import { useLocalStorage } from '@/components/ui/hooks';
import { memberLabel, useMembers } from '@/components/work-items/data/use-work-config';
import type { RoadmapFilters, RoadmapGroupBy } from '@/lib/goals/roadmap';
import type { ViewGoal, ViewInitiative } from '@/lib/goals/types';
import { uiStorageKey } from '@/lib/ui-storage';

import { HEALTH_OPTIONS, RoadmapTabs, STATUS_OPTIONS } from './goal-parts';
import { RoadmapView } from './RoadmapView';

export interface RoadmapPageOptions {
    goals: ViewGoal[];
    initiatives: ViewInitiative[];
    teams: Array<{ id: string; name: string }>;
}

function useRoadmapFilterDefs(options: RoadmapPageOptions) {
    const tDefs = useTranslations('roadmap');
    const { members } = useMembers();
    return useMemo(
        () =>
            createFilterDefs({
                goalId: { label: tDefs('filters.goal'), icon: MarketingTarget, options: options.goals.map((g) => ({ value: g.id, label: g.title })) },
                initiativeId: { label: tDefs('filters.initiative'), icon: StackY3, options: options.initiatives.map((i) => ({ value: i.id, label: i.name })) },
                teamId: { label: tDefs('filters.team'), icon: Users, options: options.teams.map((t) => ({ value: t.id, label: t.name })) },
                leadUserId: { label: tDefs('filters.lead'), icon: UserCheck, options: members.map((m) => ({ value: m.id, label: memberLabel(m) ?? m.id })) },
                health: { label: tDefs('filters.health'), icon: CirclePercentage, multiple: true, options: HEALTH_OPTIONS.map((h) => ({ value: h, label: tDefs(`health.${h}`) })) },
                status: { label: tDefs('filters.status'), icon: CircleDotted, multiple: true, options: STATUS_OPTIONS.map((s) => ({ value: s, label: tDefs(`status.${s}`) })) },
                archived: { label: tDefs('filters.archived'), icon: BoxArchive, options: [{ value: 'true', label: tDefs('filters.showArchived') }] },
            }),
        [members, options, tDefs],
    );
}

export function RoadmapPageView({ options }: { options: RoadmapPageOptions }) {
    const defs = useRoadmapFilterDefs(options);
    const filterCtx = useFilterContext(defs.filters, defs.filterKeys, { syncUrl: true });
    return (
        <FilterProvider value={filterCtx}>
            <RoadmapPageBody filterDefs={defs.filters} />
        </FilterProvider>
    );
}

function RoadmapPageBody({ filterDefs }: { filterDefs: ReturnType<typeof createFilterDefs>['filters'] }) {
    const t = useTranslations('roadmap.page');
    const { state } = useFilters();
    const [storedGroupBy, setGroupBy] = useLocalStorage<RoadmapGroupBy>(uiStorageKey('roadmap', 'group-by'), 'initiative');
    const groupBy: RoadmapGroupBy = storedGroupBy === 'goal' ? 'goal' : 'initiative';
    const filters = useMemo<RoadmapFilters>(
        () => ({
            goalId: state.goalId?.[0],
            initiativeId: state.initiativeId?.[0],
            teamId: state.teamId?.[0],
            leadUserId: state.leadUserId?.[0],
            health: state.health?.join(',') || undefined,
            status: state.status?.join(',') || undefined,
            archived: state.archived?.includes('true') ? 'true' : undefined,
            groupBy: groupBy === 'goal' ? 'goal' : undefined,
        }),
        [state, groupBy],
    );
    return (
        <ListPageShell>
            <ListPageShell.Header>
                <PageHeader title={t('title')} description={t('description')} />
            </ListPageShell.Header>
            <ListPageShell.Filters className="space-y-section">
                <RoadmapTabs />
                <FilterToolbar filters={filterDefs} />
            </ListPageShell.Filters>
            <ListPageShell.Body>
                <RoadmapView filters={filters} groupBy={{ value: groupBy, onChange: setGroupBy }} />
            </ListPageShell.Body>
        </ListPageShell>
    );
}
