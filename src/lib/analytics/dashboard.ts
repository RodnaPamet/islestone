/**
 * Dashboards' shapes, bounds and the pure rules the page and the usecases
 * share (sub-phase 3.6d; docs/porting/maps/3.6.md, "Dashboards (3.6d)"; ADR
 * 0014 §6; owner decisions 326 to 328). Client-safe: no server module.
 *
 * Written fresh for Islestone.
 */
import type { WorkItemListFilters } from '@/components/work-items/data/list-filters';

import { ANALYTICS_SET_ASIDE_FILTERS } from './types';

const SET_ASIDE: readonly string[] = ANALYTICS_SET_ASIDE_FILTERS;

/** The bounds a dashboard holds (the map's: 24 widgets, 50 dashboards a person). */
export const DASHBOARD_LIMITS = {
    /** Widgets on one dashboard (400 `DASHBOARD_TOO_LARGE` above). */
    widgets: 24,
    /** Dashboards one person has created, personal and shared (409 `DASHBOARD_LIMIT` at it). */
    perPerson: 50,
    nameLength: 80,
    titleLength: 120,
} as const;

export const DASHBOARD_TOO_LARGE = 'DASHBOARD_TOO_LARGE';
export const DASHBOARD_LIMIT = 'DASHBOARD_LIMIT';

/** Every widget type, in the picker's order (decision 327). */
export const DASHBOARD_WIDGET_TYPES = ['COUNTS', 'THROUGHPUT', 'CYCLE_TIME', 'LEAD_TIME', 'CUMULATIVE_FLOW', 'BURN_UP', 'FORECAST', 'TIME_WAITING'] as const;
export type DashboardWidgetTypeName = (typeof DASHBOARD_WIDGET_TYPES)[number];

export type DashboardVisibilityName = 'PERSONAL' | 'SHARED';

/** A widget's scope: its own copy of the list's filters (decision 328). */
export interface WidgetScope {
    filters: Record<string, string[]>;
    q?: string;
}

export type WidgetWindow = { kind: 'weeks'; weeks: 4 | 8 | 12 | 26 | 52 } | { kind: 'cycle'; teamId: string };

/** A widget's type and configuration (the schema's union, written out so the client needs no Zod inference). */
export type WidgetShape =
    | { type: 'COUNTS' | 'CYCLE_TIME' | 'LEAD_TIME' | 'CUMULATIVE_FLOW' | 'TIME_WAITING'; config: { scope: WidgetScope; window: WidgetWindow } }
    | { type: 'THROUGHPUT'; config: { scope: WidgetScope; window: WidgetWindow; bin: 'day' | 'week' } }
    | { type: 'BURN_UP'; config: { scope: WidgetScope; window: WidgetWindow; measure: 'items' | 'points' | 'hours' } }
    | {
          type: 'FORECAST';
          config: { scope: WidgetScope; historyWeeks?: 4 | 8 | 12 | 26; share?: 25 | 50 | 75 | 100; basedOn?: 'projects' | 'team' | 'workspace' };
      };

/**
 * A widget as the API returns it. The grid's own shape (`position`, `size`)
 * so the page hands rows straight to `DashboardGrid`. `shape` is null when a
 * stored configuration no longer parses: the widget says so, the rest of the
 * dashboard shows.
 */
export interface DashboardWidgetData {
    id: string;
    type: DashboardWidgetTypeName;
    title: string | null;
    shape: WidgetShape | null;
    position: { x: number; y: number };
    size: { w: number; h: number };
}

/** What the viewer may do with one dashboard, decided on the server (`dashboardAffordances`). */
export interface DashboardViewerAffordances {
    /** Rename, re-share, change the widgets: its creator only (decision 326). */
    change: boolean;
    /** Delete: the creator, or an Owner or Admin moderating a shared one (`DASHBOARD_MODERATED`). */
    delete: boolean;
    /** Make or keep it shared: `analytics.share`. */
    share: boolean;
}

export interface DashboardSummary {
    id: string;
    name: string;
    visibility: DashboardVisibilityName;
    version: number;
    mine: boolean;
    /** A shared dashboard whose creator is no longer a member ("Created by a former member"). */
    createdByFormerMember: boolean;
    updatedAt: string;
}

export interface DashboardData extends DashboardSummary {
    widgets: DashboardWidgetData[];
    viewer: DashboardViewerAffordances;
}

/** The default composition, described (no row; decision 326). */
export interface DefaultDashboardData {
    id: 'default';
    widgets: DashboardWidgetData[];
}

export interface DashboardListResponse {
    dashboards: DashboardSummary[];
    /** More dashboards than one list returns. */
    truncated: boolean;
    default: DefaultDashboardData;
}

/** What the Analytics page offers about dashboards, asked on the server. */
export interface DashboardPageAffordances {
    /** Save personal dashboards (every `analytics.view` holder, decision 326). */
    createPersonal: boolean;
    /** Save, or switch to, shared ones (`analytics.share`). */
    createShared: boolean;
}

/**
 * A widget's scope as the list's filters, the shape every analytics read
 * takes: each facet's values comma-joined, the search kept.
 */
export function scopeAsListFilters(scope: WidgetScope): WorkItemListFilters {
    const out: Record<string, string> = {};
    for (const [key, values] of Object.entries(scope.filters)) {
        if (key.startsWith('cf.') || values.length === 0) continue;
        out[key] = values.join(',');
    }
    if (scope.q && scope.q.trim()) out.q = scope.q.trim();
    return out as WorkItemListFilters;
}

/**
 * A saved view's filters as a widget scope (decision 328: "Start from a
 * view" copies them once): the built-in facets and the search; custom-field
 * conditions and the status filters every analytics read sets aside are left
 * out and named.
 */
export function scopeFromView(config: { filters: Record<string, string[]>; q?: string }): { scope: WidgetScope; leftOut: string[] } {
    const filters: Record<string, string[]> = {};
    const leftOut: string[] = [];
    for (const [key, values] of Object.entries(config.filters)) {
        if (key.startsWith('cf.') || SET_ASIDE.includes(key)) {
            leftOut.push(key);
            continue;
        }
        if (values.length > 0) filters[key] = [...values];
    }
    return { scope: config.q ? { filters, q: config.q } : { filters }, leftOut };
}

export interface CycleWindowSource {
    id: string;
    teamId: string;
    startsOn: string;
    endsOn: string;
    status: string;
}

/**
 * The dates a widget's window reads: the last N weeks ending today, or the
 * team's current cycle from its first day to the earlier of its last day and
 * today. `null` when the team has no current cycle.
 */
export function resolveWidgetWindow(window: WidgetWindow, today: string, cycles: readonly CycleWindowSource[]): { from: string; to: string; cycleId?: string } | null {
    if (window.kind === 'weeks') return { from: addIsoDays(today, -7 * window.weeks + 1), to: today };
    const current = cycles.find((c) => c.teamId === window.teamId && c.startsOn <= today && today <= c.endsOn);
    if (!current) return null;
    return { from: current.startsOn, to: current.endsOn < today ? current.endsOn : today, cycleId: current.id };
}

function addIsoDays(day: string, n: number): string {
    const t = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) + n * 86_400_000;
    return new Date(t).toISOString().slice(0, 10);
}
