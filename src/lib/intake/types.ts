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
    /** A public request's requester as they gave it (2.6b): personal data, shown to people who triage. */
    requesterName: string | null;
    requesterEmail: string | null;
    /** Whether a public requester asked for email updates and confirmed their address. */
    requesterUpdates: 'NONE' | 'ASKED' | 'CONFIRMED';
    /** An emailed request's sender check (2.6c, decision 123); null on the form channels. */
    senderCheck: 'VERIFIED' | 'FAILED' | 'NONE' | null;
    /** Attachments the email carried, counted and not stored (2.6c). */
    attachmentsDropped: number;
    /** Later emails on the request, oldest first (2.6c). */
    followUps: IntakeFollowUpView[];
    /** The request has a requester address a spam decline can block (2.6c). */
    senderBlockable: boolean;
}

/** A later email on an emailed request (2.6c), as people who triage see it. */
export interface IntakeFollowUpView {
    id: string;
    body: string;
    attachmentsDropped: number;
    createdAt: string;
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
    /** A public form's link id (`/f/<publicId>`, 2.6b); `null` for a members' form. */
    publicId: string | null;
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
    /** Whether the project's email address takes mail (2.6c). */
    emailEnabled: boolean;
    /** The project's intake address, once it has one (2.6c). */
    emailAddress: string | null;
}

/**
 * An address a project, or the whole workspace (`projectId` null), takes no
 * intake from (2.6c), for Settings. The address itself is never stored (ADR
 * 0006 "Blocked sender"), so the row shows where and when it was blocked.
 */
export interface IntakeBlockedSenderView {
    id: string;
    projectId: string | null;
    createdByUserId: string;
    createdAt: string;
}
