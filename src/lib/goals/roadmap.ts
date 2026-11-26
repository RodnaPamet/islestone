/**
 * The roadmap's read, as the API returns it (sub-phase 3.2c;
 * docs/porting/maps/3.2.md, "The roadmap"; owner decisions 210, 215, 216 and
 * 217). Client-safe: plain shapes and constants, no server import.
 *
 * Every bar is derived, never stored (decision 215): a project's span is the
 * engine's span of its live, non-cancelled items' stored start and due dates
 * on its team's working calendar (`plannedSpanOf`, decision 185's one-date
 * rule), an initiative's the span of its projects, a goal's the span of its
 * initiatives' projects and of the items naming it directly. A span is
 * `null` when nothing under it has a date ("No dates"). Stored due dates of
 * goals, initiatives, projects and milestones are diamonds (decision 210),
 * never engine deadlines.
 *
 * Written fresh for Islestone.
 */
import type { GoalStatusValue, HealthValue, InitiativeStatusValue, ProgressData } from './types';

/** The most projects one roadmap shows (archived ones it counts included); above it 422 `ROADMAP_TOO_LARGE`, never a cut list. */
export const ROADMAP_PROJECT_LIMIT = 500;
/** The most dated milestones of those projects it reads; above it 422 `ROADMAP_TOO_LARGE`. */
export const ROADMAP_MILESTONE_LIMIT = 2_000;
/** The live goals or initiatives it reads at most (the lists' own cap). */
export const ROADMAP_RECORD_LIMIT = 2_000;
export const ROADMAP_TOO_LARGE = 'ROADMAP_TOO_LARGE';

export interface RoadmapTooLargeDetails {
    reason: typeof ROADMAP_TOO_LARGE;
    count: number;
    limit: number;
    what: 'projects' | 'milestones' | 'goals' | 'initiatives';
}

export type RoadmapGroupBy = 'initiative' | 'goal';

/** A bar's days, `YYYY-MM-DD`, both ends inclusive. */
export interface RoadmapSpan {
    start: string;
    end: string;
}

interface RoadmapRecord {
    id: string;
    dueDate: string | null;
    health: HealthValue | null;
    leadUserId: string | null;
    archived: boolean;
    span: RoadmapSpan | null;
    progress: ProgressData;
    /** The due date has passed (today in the workspace calendar's zone) with open items. */
    late: boolean;
    /** A project under it finishes after its due date (decision 210: flagged, nothing else). */
    finishesAfterDue: boolean;
}

export interface RoadmapGoal extends RoadmapRecord {
    parentId: string | null;
    title: string;
    status: GoalStatusValue;
}

export interface RoadmapInitiative extends RoadmapRecord {
    goalId: string | null;
    name: string;
    status: InitiativeStatusValue;
}

export interface RoadmapProject {
    id: string;
    name: string;
    keyPrefix: string;
    teamId: string;
    /** `null` under "No initiative" (none, or its initiative is deleted). */
    initiativeId: string | null;
    dueDate: string | null;
    archived: boolean;
    span: RoadmapSpan | null;
    progress: ProgressData;
    /** Its due date has passed with open items. */
    overdue: boolean;
    /** Its latest open item is due after its due date. */
    itemDueAfter: boolean;
    /** Its milestones that are late (2.5b's rule). */
    lateMilestones: number;
    /** Any of the three. */
    late: boolean;
    finishesAfterInitiativeDue: boolean;
    finishesAfterGoalDue: boolean;
}

export interface RoadmapMilestone {
    id: string;
    projectId: string;
    name: string;
    /** Only dated milestones are read: an undated one has no diamond and is never late. */
    dueDate: string;
    late: boolean;
}

export interface RoadmapResponse {
    /** Today in the workspace calendar's zone, `YYYY-MM-DD`. */
    asOf: string;
    groupBy: RoadmapGroupBy;
    /**
     * Grouped by goal: the goals shown, each with its bar and progress.
     * Grouped by initiative: the goals the initiatives shown serve, for
     * their names only (no bar: `span` null, empty progress).
     */
    goals: RoadmapGoal[];
    initiatives: RoadmapInitiative[];
    /** The projects shown, by name (archived ones only when asked; they count towards their initiative's bar and progress either way). */
    projects: RoadmapProject[];
    milestones: RoadmapMilestone[];
    /** The "No initiative" row: shown when no filter narrows to initiatives or goals. */
    unlinked: { shown: boolean; span: RoadmapSpan | null; progress: ProgressData };
}

/** The roadmap's filters, as the page sends them (each optional). */
export interface RoadmapFilters {
    goalId?: string;
    initiativeId?: string;
    teamId?: string;
    leadUserId?: string;
    /** Comma-joined; `none` is "No health set". */
    health?: string;
    /** Comma-joined. */
    status?: string;
    archived?: 'true';
    groupBy?: RoadmapGroupBy;
}

export const ROADMAP_FILTER_KEYS = ['goalId', 'initiativeId', 'teamId', 'leadUserId', 'health', 'status', 'archived', 'groupBy'] as const;

/** The query string the page sends for `filters` (keys in a fixed order, empty ones left out). */
export function roadmapQuery(filters: RoadmapFilters): string {
    const params = new URLSearchParams();
    for (const key of ROADMAP_FILTER_KEYS) {
        const value = filters[key];
        if (value) params.set(key, value);
    }
    const s = params.toString();
    return s ? `?${s}` : '';
}
