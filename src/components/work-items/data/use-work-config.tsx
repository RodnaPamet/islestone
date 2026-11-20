'use client';

/**
 * The view configuration (projects, teams, workflow states, types, labels)
 * the server page read once, and the member roster the pickers read. Small
 * sets, so filter options and lane headers never depend on which rows a
 * cursor page happened to load.
 *
 * Written fresh for Islestone (sub-phase 2.3).
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import type { Member, ViewCycle, ViewState, WorkItemViewConfig, WorkflowStateCategory } from '@/lib/work-items/types';
import { WORKFLOW_STATE_CATEGORIES } from '@/app-layer/domain/workflow-state';

export interface WorkConfigIndex extends WorkItemViewConfig {
    projectById: Map<string, WorkItemViewConfig['projects'][number]>;
    stateById: Map<string, ViewState>;
    typeById: Map<string, WorkItemViewConfig['types'][number]>;
    labelById: Map<string, WorkItemViewConfig['labels'][number]>;
    cycleById: Map<string, ViewCycle>;
    /** A team's cycles that take items (not completed), oldest first (2.5a). */
    openCyclesOfTeam: (teamId: string) => ViewCycle[];
    statesOfTeam: (teamId: string) => ViewState[];
    /** A team's default state of a category (the first of it when none is marked). */
    defaultStateOf: (teamId: string, category: WorkflowStateCategory) => ViewState | undefined;
}

const EMPTY: WorkItemViewConfig = { projects: [], teams: [], states: [], types: [], labels: [], customFields: [], cycles: [] };

export function indexConfig(config: WorkItemViewConfig): WorkConfigIndex {
    const byTeam = new Map<string, ViewState[]>();
    for (const s of config.states) {
        const list = byTeam.get(s.teamId) ?? [];
        list.push(s);
        byTeam.set(s.teamId, list);
    }
    // Group each team's states by category, in the category order, keeping
    // the workflow's own order inside a category.
    const rank = new Map<string, number>(WORKFLOW_STATE_CATEGORIES.map((c, i) => [c, i]));
    for (const [team, list] of byTeam) {
        byTeam.set(
            team,
            list
                .map((s, i) => ({ s, i }))
                .sort((a, b) => (rank.get(a.s.category) ?? 0) - (rank.get(b.s.category) ?? 0) || a.i - b.i)
                .map((x) => x.s),
        );
    }
    return {
        ...config,
        projectById: new Map(config.projects.map((p) => [p.id, p])),
        stateById: new Map(config.states.map((s) => [s.id, s])),
        typeById: new Map(config.types.map((t) => [t.id, t])),
        labelById: new Map(config.labels.map((l) => [l.id, l])),
        cycleById: new Map((config.cycles ?? []).map((c) => [c.id, c])),
        openCyclesOfTeam: (teamId) =>
            (config.cycles ?? [])
                .filter((c) => c.teamId === teamId && c.status !== 'completed')
                .sort((a, b) => (a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : 0)),
        statesOfTeam: (teamId) => byTeam.get(teamId) ?? [],
        defaultStateOf: (teamId, category) => {
            const ofCategory = (byTeam.get(teamId) ?? []).filter((s) => s.category === category);
            return ofCategory.find((s) => s.isDefault) ?? ofCategory[0];
        },
    };
}

const ConfigContext = createContext<WorkConfigIndex | null>(null);

export function WorkConfigProvider({ config, children }: { config: WorkItemViewConfig; children: ReactNode }) {
    const value = useMemo(() => indexConfig(config), [config]);
    return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useWorkConfig(): WorkConfigIndex {
    const ctx = useContext(ConfigContext);
    return useMemo(() => ctx ?? indexConfig(EMPTY), [ctx]);
}

/** The active members a picker offers (`GET /users/assignable`). */
export function useMembers() {
    const { data, error, isLoading } = useTenantSWR<Member[]>('/users/assignable');
    const members = useMemo(() => data ?? [], [data]);
    const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
    return { members, byId, error, isLoading };
}

/** A member's display name: the name, else the email, never a ciphertext envelope. */
export function memberLabel(member: Pick<Member, 'name' | 'email'> | undefined): string | null {
    if (!member) return null;
    const name = member.name?.trim();
    if (name && !/^v[12]:/.test(name)) return name;
    return /^v[12]:/.test(member.email) ? null : member.email;
}
