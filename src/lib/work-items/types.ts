/**
 * The shapes the work-item views read from the API (sub-phase 2.3). Client-safe
 * on purpose: the list, the board and the detail import these, and so does
 * the server usecase that builds the view configuration, so the two cannot
 * drift. The row shape mirrors `toWorkItemDto` in
 * `src/app-layer/usecases/work-item-shared.ts` after JSON: dates are strings,
 * due and start dates are `YYYY-MM-DD` (date-only, never shifted by a time
 * zone).
 *
 * Written fresh for Islestone.
 */
import type { CustomFieldType, WorkflowStateCategory, WorkItemPriority } from '@prisma/client';

import type { CustomFieldValueData } from './custom-fields';

export type { CustomFieldType, WorkflowStateCategory, WorkItemPriority };

/** One work item as the list, the board and the sub-items table read it. */
export interface WorkItemRow {
    id: string;
    key: string;
    number: number;
    title: string;
    projectId: string;
    teamId: string;
    typeId: string;
    stateId: string;
    stateCategory: WorkflowStateCategory;
    priority: WorkItemPriority;
    assigneeId: string | null;
    /** Who created the item (My Work's "Created by me"). */
    createdByUserId: string;
    parentId: string | null;
    sortKey: string;
    startDate: string | null;
    dueDate: string | null;
    version: number;
    labelIds: string[];
    /** Custom-field values (2.4): field id → value (`toWorkItemDto`). */
    customFields: Record<string, CustomFieldValueData>;
    createdAt: string;
    updatedAt: string;
}

/** A page of the cursor list (`docs/pagination.md`). */
export interface WorkItemPage {
    items: WorkItemRow[];
    pageInfo: { nextCursor?: string; hasNextPage: boolean };
}

/** The detail read (`GET /work-items/:id`). */
export interface WorkItemDetailData extends WorkItemRow {
    description: string | null;
    project: { id?: string; keyPrefix: string; name?: string; archivedAt?: string | null };
    state: { id: string; name: string; category: WorkflowStateCategory; archivedAt?: string | null };
    type: { id: string; name: string } | null;
    parent: { id: string; key: string; title: string } | null;
    labels: Array<{ id: string; name: string; color: string | null }>;
    counts: { subItems: number; comments: number; watchers: number };
}

export interface ViewProject {
    id: string;
    teamId: string;
    name: string;
    keyPrefix: string;
    archived: boolean;
}

export interface ViewState {
    id: string;
    teamId: string;
    name: string;
    category: WorkflowStateCategory;
    isDefault: boolean;
}

export interface ViewType {
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
}

export interface ViewLabel {
    id: string;
    teamId: string | null;
    name: string;
    color: string | null;
}

export interface ViewCustomFieldOption {
    id: string;
    name: string;
    color: string | null;
    archived: boolean;
}

/** A project's custom field as the views render it (2.4). */
export interface ViewCustomField {
    id: string;
    projectId: string;
    name: string;
    type: CustomFieldType;
    archived: boolean;
    /** In option order, archived ones included (they stay on the items that hold them). */
    options: ViewCustomFieldOption[];
}

/** What every work-item view renders with: small sets, read once on the server. */
export interface WorkItemViewConfig {
    projects: ViewProject[];
    teams: Array<{ id: string; name: string }>;
    /** Every team's live states, in each team's workflow order. */
    states: ViewState[];
    types: ViewType[];
    labels: ViewLabel[];
    /** The live custom fields of the page's project (none on a workspace-wide page; 2.4). */
    customFields: ViewCustomField[];
}

/** What the views menu offers its viewer (2.4), asked on the server. */
export interface SavedViewAffordances {
    savePersonal: boolean;
    saveShared: boolean;
    /** Delete someone else's shared view (an admin, for moderation). */
    moderate: boolean;
}

/** A saved view as the API returns it (`GET /views`). */
export interface SavedViewData {
    id: string;
    name: string;
    visibility: 'PERSONAL' | 'SHARED';
    projectId: string | null;
    project: { keyPrefix: string; name: string } | null;
    layout: 'LIST' | 'BOARD' | 'TIMELINE' | 'CALENDAR';
    config: {
        filters: Record<string, string[]>;
        q?: string;
        sort: string;
        direction?: 'asc' | 'desc';
        laneBy: string;
        columns?: string[];
    };
    createdByUserId: string;
    mine: boolean;
    createdAt: string;
    updatedAt: string;
}

/**
 * The work-configuration writes a Settings page offers its viewer, asked on
 * the server by `workConfigAffordances` (`work-config.policies.ts`), which
 * reads the same predicates the usecases assert.
 */
export interface WorkConfigAffordances {
    /** Create, change and delete teams, workflow states, types and labels. */
    manageWorkConfig: boolean;
    createProject: boolean;
    /** Rename a project. */
    editProject: boolean;
    /** Archive and unarchive a project. */
    archiveProject: boolean;
    /** Define a project's custom fields and options (2.4). */
    manageCustomFields: boolean;
}

/** A member a picker offers (`GET /users/assignable`). */
export interface Member {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
}

export interface CommentRow {
    id: string;
    workItemId: string;
    authorUserId: string;
    body: string;
    editedAt: string | null;
    createdAt: string;
}

export interface ActivityEntryRow {
    kind: 'change' | 'comment';
    id: string;
    createdAt: string;
    actorUserId: string | null;
    action?: string;
    detailsJson?: unknown;
    comment?: { id: string; body: string; editedAt: string | null };
}

export interface RelationEnd {
    id: string;
    hidden: boolean;
    key?: string;
    title?: string;
    stateCategory?: WorkflowStateCategory;
}

export interface RelationRow {
    id: string;
    type: 'BLOCKS' | 'RELATES' | 'DUPLICATES';
    createdAt: string;
    item: RelationEnd;
}

export interface LinkRow {
    id: string;
    type: string;
    location: string;
    title: string | null;
    createdByUserId: string;
    createdAt: string;
}

export interface WatcherRow {
    userId: string;
    createdAt: string;
}
