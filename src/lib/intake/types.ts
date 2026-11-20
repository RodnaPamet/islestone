/**
 * Client-safe shapes of intake (sub-phase 2.6a): what the routes answer and
 * what the pages receive. No Prisma import beyond types.
 *
 * Written fresh for Islestone.
 */
import type { IntakeFormDefinition, IntakeAnswers } from './form-definition';

export type IntakeRequestStatus = 'PENDING' | 'SNOOZED' | 'ACCEPTED' | 'DECLINED' | 'MERGED';
export type IntakeChannel = 'INTERNAL_FORM' | 'PUBLIC_FORM' | 'EMAIL';
export type IntakeDeclineReason = 'NOT_PLANNED' | 'OUT_OF_SCOPE' | 'SPAM' | 'OTHER';
export type IntakeFormAccess = 'MEMBERS' | 'PUBLIC';

export const INTAKE_DECLINE_REASONS: readonly IntakeDeclineReason[] = ['NOT_PLANNED', 'OUT_OF_SCOPE', 'SPAM', 'OTHER'];

/** The Intake page's tabs: New is PENDING, Decided is ACCEPTED, DECLINED (not spam) and MERGED. */
export const INTAKE_VIEWS = ['new', 'snoozed', 'spam', 'decided'] as const;
export type IntakeView = (typeof INTAKE_VIEWS)[number];

/** The writes a page offers, asked on the server (`intakeAffordances`). */
export interface IntakeAffordances {
    /** Read requests (`intake.view`). */
    view: boolean;
    /** Accept, decline, merge, snooze, move, reopen (`intake.triage`). */
    triage: boolean;
    /** Accepting also creates a work item (`work_items.create`). */
    createItems: boolean;
    /** Turn intake on, build forms, set the notify list (`intake.manage`). */
    manage: boolean;
}

export interface IntakeRequestRow {
    id: string;
    projectId: string;
    channel: IntakeChannel;
    formId: string | null;
    formName: string | null;
    status: IntakeRequestStatus;
    title: string;
    requesterUserId: string | null;
    snoozedUntil: string | null;
    decidedAt: string | null;
    declineReason: IntakeDeclineReason | null;
    workItemId: string | null;
    mergedIntoWorkItemId: string | null;
    mergedIntoRequestId: string | null;
    version: number;
    createdAt: string;
}

export interface IntakeAnswerView {
    fieldId: string;
    label: string;
    kind: string;
    value: IntakeAnswers[string];
}

/** One request with its text, answers and decision. */
export interface IntakeRequestDetail extends IntakeRequestRow {
    body: string | null;
    answers: IntakeAnswerView[];
    snoozedByUserId: string | null;
    decidedByUserId: string | null;
    declineExplanation: string | null;
    internalRemark: string | null;
    /** The accepted item's or the merge target's key, when it is visible. */
    workItemKey: string | null;
    mergedIntoWorkItemKey: string | null;
    /** Requests merged into this one. */
    mergedRequestCount: number;
}

export interface IntakeRequestPage {
    items: IntakeRequestRow[];
    pageInfo: { nextCursor?: string; hasNextPage: boolean };
}

export interface IntakeFormSummary {
    id: string;
    projectId: string;
    name: string;
    access: IntakeFormAccess;
    published: boolean;
    archived: boolean;
    definitionVersion: number;
    version: number;
    updatedAt: string;
}

export interface IntakeFormData extends IntakeFormSummary {
    definition: IntakeFormDefinition;
}

/** A form a member may send a request through, with what it needs to render. */
export interface OpenIntakeForm {
    id: string;
    projectId: string;
    projectName: string;
    projectKeyPrefix: string;
    name: string;
    definition: IntakeFormDefinition;
    definitionVersion: number;
}

/** One project's intake, for Settings → Intake. */
export interface ProjectIntakeSettings {
    projectId: string;
    projectName: string;
    keyPrefix: string;
    enabled: boolean;
    notifyUserIds: string[];
    pendingCount: number;
}
