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

import type { ReviewOutcomeValue, ReviewRoundStatusValue, ReviewStepModeValue, ReviewSummary } from '@/app-layer/domain/review-steps';

import type { ViewGoal, ViewInitiative } from '@/lib/goals/types';

import type { CustomFieldValueData } from './custom-fields';
import type { FieldSetEntry } from './field-sets';

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
    /** Who must act next (2.4b): an active member; never accountable. Cleared when the item closes. */
    waitingOnUserId?: string | null;
    /** The marked answer's comment id (2.4b-c, ADR 0002 §15). */
    answerCommentId?: string | null;
    /** Who created the item (My Work's "Created by me"). */
    createdByUserId: string;
    parentId: string | null;
    /** The team's cycle the item is planned in (2.5a). */
    cycleId: string | null;
    /** The project's milestone the item is aimed at (2.5b). */
    milestoneId: string | null;
    /** The goal the item names directly (3.2a, decision 211); never inherited. */
    goalId?: string | null;
    /** The repeat this item is an occurrence of, and the occurrence's date (2.5d). */
    recurrenceId?: string | null;
    occurrenceOn?: string | null;
    /** A repeat is set on this item (2.5d). */
    repeats?: boolean;
    /** Where the item's review stands (2.8b, `reviewSummaryOf`): the list column and the card's mark. */
    review?: ReviewSummary | null;
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
    /**
     * The people the description mentions (2.7d): the only `<@userId>` tokens
     * the renderer shows as chips (`Mention` rows are the authority).
     */
    descriptionMentions?: string[];
    /** The marked answer, pinned on the detail (2.4b-c), with the people it mentions (2.7d). */
    answer?: { id: string; authorUserId: string; body: string; editedAt: string | null; createdAt: string; mentions?: string[] } | null;
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
    /** The project's due date, `YYYY-MM-DD` (roadmap 3.1, decision 188). */
    dueDate?: string | null;
    /** The initiative the project serves (3.2a). */
    initiativeId?: string | null;
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

export type CycleStatusName = 'upcoming' | 'current' | 'ended' | 'completed';

/** A cycle as the views name it (2.5a): pickers, filters, lanes and the column. */
export interface ViewCycle {
    id: string;
    teamId: string;
    number: number;
    name: string | null;
    /** `YYYY-MM-DD`, inclusive. */
    startsOn: string;
    endsOn: string;
    status: CycleStatusName;
}

/** A milestone as the views name it (2.5b): pickers, filters, lanes and the column. */
export interface ViewMilestone {
    id: string;
    projectId: string;
    name: string;
    /** `YYYY-MM-DD`, or `null` for a milestone without a date. */
    dueDate: string | null;
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
    /** Every team's cycles, newest first (2.5a); empty for a viewer without `cycles.view`. */
    cycles: ViewCycle[];
    /** The visible projects' milestones, in each project's order (2.5b). */
    milestones: ViewMilestone[];
    /**
     * Field-set rules (2.4b-b): every type's built-in rules, and the page's
     * project's custom-field rules (none on a workspace-wide page). Evaluate
     * them with `src/lib/work-items/field-sets.ts`, never by hand.
     */
    fieldSetEntries: FieldSetEntry[];
    /** Live, unarchived goals (3.2a): the Goal picker and filter; empty without `goals.view`. */
    goals?: ViewGoal[];
    /** Live, unarchived initiatives (3.2a): the Initiative filter; empty without `goals.view`. */
    initiatives?: ViewInitiative[];
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
        /** The timeline's settings (3.1b). */
        timeline?: { zoom: 'day' | 'week' | 'month' | 'quarter'; showCriticalPath: boolean; showNoDates: boolean };
        /** The calendar's settings (3.3a). */
        calendar?: { showCycles: boolean; showMilestones: boolean };
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
    /** The people this comment mentions (2.7d): the renderer's authority for its chips. */
    mentions?: string[];
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

/** What the cycle pages offer their viewer (2.5a), asked on the server. */
export interface CycleAffordances {
    /** Create, change and delete cycles and change a team's cycle schedule (`cycles.manage`). */
    manageCycles: boolean;
    /** Put an item in a cycle or take it out (`work_items.edit`). */
    planItems: boolean;
}

/** Live, visible items of a cycle by what the burn-up counts. */
export interface CycleCounts {
    scope: number;
    started: number;
    completed: number;
}

/** A cycle as `GET /cycles` and `GET /cycles/:id` return it. */
export interface CycleData extends ViewCycle {
    fromSchedule: boolean;
    completedAt: string | null;
    daysLeft: number;
    counts: CycleCounts;
}

/** A team's cycle settings (`GET /teams/:id/cycle-schedule`); `null` fields mean never saved. */
export interface CycleScheduleData {
    teamId: string;
    saved: boolean;
    enabled: boolean;
    lengthWeeks: number;
    firstStartsOn: string;
    upcomingCount: number;
    rollover: 'NEXT_CYCLE' | 'NO_CYCLE';
}

export interface BurnUpPointData {
    date: string;
    scope: number;
    started: number;
    completed: number;
}

/** `GET /cycles/:id/burn-up`. */
export interface BurnUpData {
    points: BurnUpPointData[];
    /** More items than the burn-up reads: the chart counts the first ones only. */
    truncated: boolean;
}

/** Live, visible items of a milestone (2.5b): scope leaves out cancelled ones. */
export interface MilestoneProgress {
    scope: number;
    done: number;
}

/** A milestone as `GET /projects/:id/milestones` returns it (2.5b). */
export interface MilestoneData extends ViewMilestone {
    progress: MilestoneProgress;
    /** The due date has passed (today in `NOTIFICATIONS_TZ`) and open items remain. */
    late: boolean;
}

/** What the milestone pages offer their viewer (2.5b), asked on the server. */
export interface MilestoneAffordances {
    /** Create, rename, re-date, reorder and delete milestones (`projects.edit`). */
    manageMilestones: boolean;
    /** Aim an item at a milestone or clear it (`work_items.edit`). */
    planItems: boolean;
}

/** What the template surfaces offer their viewer (2.5c), asked on the server. */
export interface TemplateAffordances {
    /** Create, change, archive and delete a project's item templates (`projects.edit`). */
    manageItemTemplates: boolean;
    /** List project templates and make a project from one (`projects.create`). */
    useProjectTemplates: boolean;
    /** Save a project as a template, rename, archive and delete one (`admin.manage`). */
    manageProjectTemplates: boolean;
}

/** An item template as `GET /projects/:id/work-item-templates` returns it (2.5c). */
export interface WorkItemTemplateData {
    id: string;
    projectId: string;
    name: string;
    title: string;
    description: string | null;
    typeId: string | null;
    priority: WorkItemPriority;
    labelIds: string[];
    assigneeId: string | null;
    dueInDays: number | null;
    customFields: Record<string, unknown>;
    subItems: Array<{ title: string }>;
    archived: boolean;
}

/** A project template as `GET /project-templates` lists it (2.5c): never its content. */
export interface ProjectTemplateSummary {
    id: string;
    name: string;
    archived: boolean;
    createdAt: string;
    /** What the content holds, counted when it is read for an admin's list. */
    counts?: { customFields: number; milestones: number; itemTemplates: number; items: number };
}

export type RecurrenceFrequencyName = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type RecurrenceHoldName = 'OWNER_NOT_ACTIVE' | 'OWNER_NOT_PERMITTED' | 'SOURCE_DELETED' | 'PROJECT_ARCHIVED' | 'ENDED' | 'HELD_BY_MEMBER' | 'FIELD_SET_UNMET';

/** A repeat as `GET /work-items/:id/recurrence` returns it (2.5d). Dates are `YYYY-MM-DD`. */
export interface RecurrenceData {
    id: string;
    frequency: RecurrenceFrequencyName;
    interval: number;
    weekdays: number[];
    firstOn: string;
    endsOn: string | null;
    maxOccurrences: number | null;
    leadDays: number;
    nextOccurrenceOn: string | null;
    occurrenceCount: number;
    ownerUserId: string;
    heldAt: string | null;
    heldReason: RecurrenceHoldName | null;
}

/** An item's place in a series (2.5d): the repeat set on it, and the series it is an occurrence of. */
export interface WorkItemSeriesData {
    rule: RecurrenceData | null;
    occurrenceOf: { id: string; key: string; occurrenceOn: string | null } | null;
}

// ─── Review steps (sub-phase 2.8a's API; read by 2.8b's detail) ───────────

export type { ReviewOutcomeValue, ReviewRoundStatusValue, ReviewStepModeValue, ReviewSummary };

export type ReviewStepStatusValue = 'PENDING' | 'OPEN' | 'COMPLETED' | 'RETURNED' | 'SKIPPED' | 'WITHDRAWN';

/** One reviewer row of a step, as `GET /work-items/:id/review` returns it. */
export interface ReviewerData {
    userId: string;
    /** The recipient list the person was asked through (decision 154), or null when named directly. */
    viaRecipientListId: string | null;
    outcome: ReviewOutcomeValue | null;
    respondedAt: string | null;
    /** Decrypted for readers of the item (decision 157). */
    responseText: string | null;
    /** The item's version when they responded (decision 163). */
    itemVersionAt: number | null;
    withdrawnAt: string | null;
    withdrawnReason: string | null;
}

export interface ReviewStepData {
    id: string;
    position: number;
    name: string;
    mode: ReviewStepModeValue;
    dueInWorkingDays: number;
    status: ReviewStepStatusValue;
    openedAt: string | null;
    /** `YYYY-MM-DD`, set once when the step opens (decision 151). */
    dueOn: string | null;
    endedAt: string | null;
    skippedByUserId: string | null;
    skipReason: string | null;
    lists: Array<{ id: string; name: string; archived: boolean }>;
    reviewers: ReviewerData[];
    pendingUserIds: string[];
    /** Open with nobody still asked: flagged, never completed. */
    noReviewersLeft: boolean;
}

export interface ReviewRoundData {
    id: string;
    number: number;
    status: ReviewRoundStatusValue;
    version: number;
    startedAt: string | null;
    startedByUserId: string | null;
    endedAt: string | null;
    endedByUserId: string | null;
    endReason: string | null;
    steps: ReviewStepData[];
}

/** What the review section offers the viewer, decided on the server (`reviewAffordances`). */
export interface ReviewViewerAffordances {
    editSteps: boolean;
    send: boolean;
    withdraw: boolean;
    skip: boolean;
    respondStepId: string | null;
}

/** `GET /work-items/:id/review`, and the answer of every review write. */
export interface WorkItemReviewData {
    workItemId: string;
    itemVersion: number;
    /** Newest first; the live round, when there is one, is first. */
    rounds: ReviewRoundData[];
    /** While a round is open, the open step's pending reviewers (decision 152). */
    waitingOnReviewerIds: string[];
    viewer: ReviewViewerAffordances;
}

/** One default review step of a type (2.8c, decision 159): whom it names, members and workspace lists. */
export interface TypeReviewStepData {
    id: string;
    position: number;
    name: string;
    mode: ReviewStepModeValue;
    dueInWorkingDays: number;
    memberIds: string[];
    recipientListIds: string[];
    /** The lists it names, with their names (an archived one is not copied onto a new item). */
    lists: Array<{ id: string; name: string; archived: boolean }>;
}

/** `GET`/`PUT /work-item-types/:typeId/review-steps` (2.8c; decisions 149 and 159). */
export interface TypeReviewStepsData {
    typeId: string;
    /** Review must finish before an item of this type moves to Done; cancelling is never held. */
    reviewRequiredForDone: boolean;
    steps: TypeReviewStepData[];
}
