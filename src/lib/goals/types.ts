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
