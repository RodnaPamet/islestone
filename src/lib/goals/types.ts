/**
 * The shapes goals, initiatives and an item's ancestry take in the API
 * (sub-phase 3.2a; docs/porting/maps/3.2.md). Client-safe: the pages, the
 * pickers and the usecases import these, so the two sides cannot drift. Due
 * dates are `YYYY-MM-DD` (date-only); timestamps are ISO strings after JSON.
 *
 * Written fresh for Islestone.
 */

export type GoalStatusValue = 'PLANNED' | 'STARTED' | 'COMPLETED' | 'CANCELLED';
export type InitiativeStatusValue = GoalStatusValue;
/** A person's judgement (decision 205); `null` is "No health set". */
export type HealthValue = 'ON_TRACK' | 'AT_RISK' | 'OFF_TRACK' | 'COMPLETED';

/** A goal as the API returns it. Never carries anything but its own row's fields. */
export interface GoalData {
    id: string;
    parentId: string | null;
    title: string;
    description: string | null;
    status: GoalStatusValue;
    dueDate: string | null;
    leadUserId: string | null;
    health: HealthValue | null;
    healthSetAt: string | Date | null;
    healthSetByUserId: string | null;
    version: number;
    archived: boolean;
    archivedAt: string | Date | null;
    deletedAt: string | Date | null;
    deletionId: string | null;
    createdByUserId: string;
    createdAt: string | Date;
    updatedAt: string | Date;
}

/** An initiative as the API returns it. */
export interface InitiativeData {
    id: string;
    goalId: string | null;
    name: string;
    description: string | null;
    status: InitiativeStatusValue;
    dueDate: string | null;
    leadUserId: string | null;
    health: HealthValue | null;
    healthSetAt: string | Date | null;
    healthSetByUserId: string | null;
    version: number;
    archived: boolean;
    archivedAt: string | Date | null;
    deletedAt: string | Date | null;
    deletionId: string | null;
    createdByUserId: string;
    createdAt: string | Date;
    updatedAt: string | Date;
}

/** A goal as a picker or a filter names it: live and unarchived. */
export interface ViewGoal {
    id: string;
    parentId: string | null;
    title: string;
}

/** An initiative as a picker or a filter names it: live and unarchived. */
export interface ViewInitiative {
    id: string;
    goalId: string | null;
    name: string;
}

/** One step of an item's ancestry (`WorkItemAncestry`). Never a description. */
export interface AncestryGoal {
    id: string;
    title: string;
    status: GoalStatusValue;
    archived: boolean;
}

export interface AncestryItem {
    id: string;
    key: string;
    title: string;
}

/**
 * An item's ancestry (decision 220): its parents root-first, its project,
 * the project's live initiative, the initiative's goals root-first, and the
 * item's own direct goal's chain root-first (decision 211), `null` when it
 * names none. Without `goals.view` the initiative and every goal are left
 * out and counted in `hiddenLevels`, never named.
 */
export interface WorkItemAncestry {
    item: AncestryItem;
    parents: AncestryItem[];
    project: { id: string; name: string; keyPrefix: string; archived: boolean };
    initiative: { id: string; name: string; status: InitiativeStatusValue; archived: boolean } | null;
    goals: AncestryGoal[];
    directGoals: AncestryGoal[] | null;
    hiddenLevels: number;
}

/**
 * Progress (3.2b, decision 212): live, visible items not cancelled (`scope`),
 * the Done ones (`done`) and the Started ones (`started`). Derived on every
 * read, never stored. A scope of 0 is "No items", never complete.
 */
export interface ProgressData {
    scope: number;
    done: number;
    started: number;
}

/** What a goal's or an initiative's progress reads say beside its own row (3.2b). */
export interface ProgressSummary {
    /** `null` while the record is deleted, or when its scope is refused (`tooManyProjects`). */
    progress: ProgressData | null;
    /** A passed due date (today in the workspace calendar's zone) with open items. */
    late: boolean;
    /** More projects than progress counts (`GOAL_PROGRESS_PROJECT_CAP`): their number, never a cut count. */
    tooManyProjects: number | null;
}

export type GoalSummary = GoalData & ProgressSummary;
export type InitiativeSummary = InitiativeData & ProgressSummary;

/** One health change, read from the audit trail (decision 207): values only, no written update. */
export interface HealthHistoryEntry {
    id: string;
    health: HealthValue | null;
    previous: HealthValue | null;
    setByUserId: string | null;
    setAt: string | Date;
}

/** `GET /goals/:id` (3.2b): the goal with its progress, ancestors, children, initiatives and health history. */
export interface GoalDetail {
    goal: GoalSummary;
    /** Live ancestors, root first (the walk stops at a deleted one). */
    ancestors: GoalData[];
    children: GoalSummary[];
    initiatives: InitiativeSummary[];
    /** The goal's level, 1 for a root (deleted ancestors counted, as the tree rules count them). */
    depth: number;
    /** Whether a child goal fits under it (three levels at most, decision 24). */
    childFits: boolean;
    /** Live, visible, non-cancelled items naming exactly this goal (decision 211). */
    directItems: number;
    healthHistory: HealthHistoryEntry[];
}

/** One row of an initiative's projects table (3.2b, decision 221). */
export interface InitiativeProjectRow {
    id: string;
    name: string;
    keyPrefix: string;
    teamId: string;
    archived: boolean;
    dueDate: string | null;
    progress: ProgressData;
    /** The project's due date has passed (the workspace calendar's today) with open items. */
    late: boolean;
    /** Its milestones that are late (2.5b's rule). */
    lateMilestones: number;
}

/** `GET /initiatives/:id` (3.2b): the initiative's page, the roadmap's "portfolio page" (decision 221). */
export interface InitiativeDetail {
    initiative: InitiativeSummary;
    /** Its goal, live, or `null`. */
    goal: { id: string; title: string; status: GoalStatusValue; archived: boolean } | null;
    /** The goal's live ancestors and the goal, root first (the breadcrumb). */
    goals: Array<{ id: string; title: string }>;
    projects: InitiativeProjectRow[];
    healthHistory: HealthHistoryEntry[];
}

/** What a page offers its viewer (`goalAffordances`), asked on the server. */
export interface GoalAffordances {
    /** Read goals and initiatives. */
    view: boolean;
    /** Create, change, archive, delete and restore goals and initiatives. */
    manage: boolean;
    /** Set health (3.2b): a person holding `goals.manage`. */
    setHealth: boolean;
    /** Name a project's initiative: `projects.edit` and `goals.view`. */
    linkProject: boolean;
    /** Name an item's goal: `work_items.edit` and `goals.view`. */
    setItemGoal: boolean;
}

/** What the Roadmap entry's pages offer (3.2b), asked on the server. */
export interface RoadmapAffordances extends GoalAffordances {
    /** Create a project already in an initiative (the initiative page; decision 57's one dialog): `projects.create` and `goals.view`. */
    createProject: boolean;
}
