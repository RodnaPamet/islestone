/**
 * Intake requests (sub-phase 2.6a; docs/porting/maps/2.6.md "Triage"; owner
 * decisions 85, 90, 92, 95 and 96): a member sends one through an internal
 * form; a person who may triage accepts, declines, merges, snoozes, moves or
 * reopens it.
 *
 * - An intake request is not a work item (ADR 0002 "Consequences"). Accept
 *   creates the item through `createWorkItemInTx`, the create path's own
 *   core, in the same transaction as the request's claim, so the create's
 *   rules, audit, automation event and assignment email keep their order
 *   (tests/unit/usecases/work-item-sequence-order.test.ts holds it).
 * - Every triage write locks the request row, checks the status
 *   (`checkTriage`) and the `If-Match` version, then claims it with one
 *   `updateMany` naming the statuses it starts from and that version: two
 *   people deciding at once make one decision, and the other gets a 409.
 * - Free text (title, body, text answers, the explanation and the remark) is
 *   sanitised before it is stored; the body, the answers and both remarks are
 *   encrypted by the manifest. Audit entries name ids, the channel and codes,
 *   never a title, text or answer.
 * - A new request rings the project's notify list after the commit. A member
 *   who sent one is made a watcher of the item it becomes. A public form's
 *   requester who confirmed their address (2.6b, owner decision 89) is
 *   emailed "accepted", "declined" (never for spam) or "merged", from inside
 *   the deciding transaction (`enqueueRequesterNotices`); the email names the
 *   form and the reference, never the request's own text.
 *
 * Written fresh for Islestone.
 */
import type { IntakeDeclineReason, IntakeRequestStatus, WorkItemPriority } from '@prisma/client';

import { emitAutomationEvent } from '../automation';
import { logEvent } from '../events/audit';
import { CustomFieldRepository } from '../repositories/CustomFieldRepository';
import {
    INTAKE_LIST_ORDER,
    IntakeRepository,
    type IntakeListFilter,
    type IntakeRequestDetailRow,
    type IntakeRequestListRow,
    type IntakeTriagePatch,
} from '../repositories/IntakeRepository';
import { IntakeEmailRepository } from '../repositories/IntakeEmailRepository';
import { MembershipRepository } from '../repositories/MembershipRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { TeamRepository } from '../repositories/TeamRepository';
import { WorkItemRepository, WorkItemWatcherRepository } from '../repositories/WorkItemRepository';
import {
    assertCanAcceptIntake,
    assertCanManageIntake,
    assertCanReadIntake,
    assertCanSendInternalRequests,
    assertCanTriageIntake,
    mayReadIntake,
} from '../policies/intake.policies';
import { visibleProjects, type ProjectVisibility } from '../policies/project-visibility';
import {
    acceptedDescription,
    checkTriage,
    planAcceptedFields,
    snoozeDateIsFuture,
    TRIAGE_FROM,
    TRIAGE_TO,
    type AcceptFieldTarget,
    type StoredAnswer,
    type TriageAction,
} from '../domain/intake';
import { formatKey } from '../domain/work-item-key';
import { enqueueEmail } from '../notifications/enqueue';
import { createIntakeNotifications } from '../notifications/intake';
import { dayKeyInTz } from '../notifications/work-item-due';
import { blockSenderInTx } from './intake-blocked-senders';
import { formIsOpen } from './intake-form';
import { createWorkItemInTx, emitCreatedItemBells } from './work-item';
import { notificationsTz } from './work-item-shared';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { AppError, ConflictError, badRequest, notFound } from '@/lib/errors/types';
import {
    compactAnswers,
    compileIntakeRequestSchema,
    readDefinition,
    type IntakeAnswer,
    type IntakeFormDefinition,
} from '@/lib/intake/form-definition';
import { intakeReference } from '@/lib/intake/reference';
import type { IntakeRequestDetail, IntakeRequestPage, IntakeRequestRow, IntakeView } from '@/lib/intake/types';
import { logger } from '@/lib/observability/logger';
import { permissionsForMembership } from '@/lib/permissions';
import { clampLimit, computeKeysetPage, decodeCursor, InvalidCursorError, type CursorPayload } from '@/lib/pagination';
import { sanitizePlainText } from '@/lib/security/sanitize';

// ─── Shapes ───────────────────────────────────────────────────────────────

function dayOnly(d: Date | null): string | null {
    return d ? d.toISOString().slice(0, 10) : null;
}

function toRow(r: IntakeRequestListRow): IntakeRequestRow {
    return {
        id: r.id,
        projectId: r.projectId,
        channel: r.channel,
        formId: r.formId,
        formName: r.form?.name ?? null,
        status: r.status,
        title: r.title,
        requesterUserId: r.requesterUserId,
        snoozedUntil: dayOnly(r.snoozedUntil),
        decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
        declineReason: r.declineReason,
        workItemId: r.workItemId,
        mergedIntoWorkItemId: r.mergedIntoWorkItemId,
        mergedIntoRequestId: r.mergedIntoRequestId,
        version: r.version,
        createdAt: r.createdAt.toISOString(),
    };
}

/** The stored answers, read back; anything unreadable reads as none (never thrown at a page). */
export function readStoredAnswers(raw: string | null): StoredAnswer[] {
    if (!raw) return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (a): a is StoredAnswer => typeof a === 'object' && a !== null && typeof (a as StoredAnswer).fieldId === 'string' && typeof (a as StoredAnswer).label === 'string',
        );
    } catch {
        return [];
    }
}

function today(): string {
    return dayKeyInTz(new Date(), notificationsTz());
}

function triagePreconditionRequired(): AppError {
    return new AppError('Send the version you read in an If-Match header: a decision on a request must name it.', 'PRECONDITION_REQUIRED', 428);
}

export function cleanTitle(raw: string): string {
    const title = sanitizePlainText(raw).replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!title) throw badRequest('A request needs a title.');
    return title.slice(0, 200);
}

export function cleanText(raw: string | null | undefined): string | null {
    if (raw === undefined || raw === null) return null;
    const text = sanitizePlainText(raw).trim();
    return text.length > 0 ? text : null;
}

// ─── The internal form's send ─────────────────────────────────────────────

/**
 * Send a request through an internal form (any member who sees the
 * project). A form that is not open now is a 404, whatever the reason.
 */
export async function sendIntakeRequest(ctx: RequestContext, formId: string, raw: unknown): Promise<IntakeRequestRow> {
    assertCanSendInternalRequests(ctx);
    const created = await runInTenantContext(ctx, async (db) => {
        const form = await IntakeRepository.getForm(db, ctx, formId);
        if (!form) throw notFound('Form not found');
        const v = await visibleProjects(ctx, db);
        const project = await ProjectRepository.getVisible(db, ctx, v, form.projectId);
        const intake = project ? await IntakeRepository.getProjectIntake(db, ctx, project.id) : null;
        if (!project || !formIsOpen(form, project, intake?.enabled === true)) throw notFound('Form not found');

        const definition = readDefinition(form.definitionJson);
        const parsed = compileIntakeRequestSchema(definition).safeParse(raw);
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            throw badRequest(issue?.message ?? 'The request is not valid.', { issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) });
        }
        const stored = storedAnswersOf(definition, parsed.data.answers as Partial<Record<string, IntakeAnswer>>);

        const row = await IntakeRepository.createRequest(db, ctx, {
            projectId: project.id,
            channel: 'INTERNAL_FORM',
            formId: form.id,
            formDefinitionVersion: form.definitionVersion,
            title: cleanTitle(parsed.data.title),
            body: cleanText(parsed.data.body),
            answersJson: stored.length > 0 ? JSON.stringify(stored) : null,
            requesterUserId: ctx.userId,
        });
        await logEvent(db, ctx, {
            action: 'INTAKE_REQUEST_RECEIVED',
            entityType: 'IntakeRequest',
            entityId: row.id,
            details: `Request received in project ${project.keyPrefix} through form ${form.id}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'IntakeRequest', operation: 'created', summary: 'INTAKE_REQUEST_RECEIVED' },
            metadata: { projectId: project.id, channel: 'INTERNAL_FORM', formId: form.id, formDefinitionVersion: form.definitionVersion },
        });
        await emitAutomationEvent(ctx, {
            event: 'INTAKE_REQUEST_RECEIVED',
            entityType: 'IntakeRequest',
            entityId: row.id,
            actorUserId: ctx.userId,
            stableKey: row.id,
            data: { projectId: project.id, channel: 'INTERNAL_FORM', status: 'PENDING', formId: form.id, workItemId: null, declineReason: null },
        });
        return { row, keyPrefix: project.keyPrefix };
    });
    await notifyIntakeReceived(ctx, created.row, created.keyPrefix);
    return toRow(created.row);
}

/**
 * A request's answers as stored: a snapshot of each answered field (so a
 * later edit of the form never changes what an old request shows), every
 * text sanitised. Shared by the internal and the public send.
 */
export function storedAnswersOf(definition: IntakeFormDefinition, raw: Partial<Record<string, IntakeAnswer>>): StoredAnswer[] {
    const answers = compactAnswers(definition, raw);
    return definition.fields
        .filter((f) => answers[f.id] !== undefined)
        .map((f) => {
            const v0 = answers[f.id]!;
            const value = typeof v0 === 'string' ? sanitizePlainText(v0).trim() : Array.isArray(v0) ? v0.map((x) => sanitizePlainText(x)) : v0;
            return { fieldId: f.id, label: f.label, kind: f.kind, customFieldId: f.customFieldId ?? null, value };
        });
}

/** Of `userIds`, the ACTIVE members whose permissions hold `intake.view` now. */
export async function intakeReaders(db: PrismaTx, ctx: RequestContext, userIds: readonly string[]): Promise<Set<string>> {
    const memberships = await MembershipRepository.activeMembershipsWithRoles(db, ctx, userIds);
    return new Set(memberships.filter((m) => permissionsForMembership(m).intake.view === true).map((m) => m.userId));
}

/** After the commit: a bell to each member on the notify list who may read intake, never the sender. */
export async function notifyIntakeReceived(ctx: RequestContext, row: IntakeRequestListRow, keyPrefix: string): Promise<void> {
    if (!ctx.tenantSlug) return;
    const tenantSlug = ctx.tenantSlug;
    try {
        await runInTenantContext(ctx, async (db) => {
            const listed = (await IntakeRepository.listNotifyMembers(db, ctx, [row.projectId])).map((n) => n.userId).filter((id) => id !== ctx.userId);
            if (listed.length === 0) return;
            const readers = await intakeReaders(db, ctx, listed);
            await createIntakeNotifications(db, ctx.tenantId, tenantSlug, 'INTAKE_REQUEST_RECEIVED', [
                { requestId: row.id, projectKeyPrefix: keyPrefix, title: row.title, recipientUserIds: listed.filter((id) => readers.has(id)) },
            ]);
        });
    } catch (err) {
        logger.warn('failed to ring the intake notify list', {
            component: 'notifications',
            requestId: row.id,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

// ─── Reads ────────────────────────────────────────────────────────────────

const VIEW_FILTER: Record<IntakeView, Omit<IntakeListFilter, 'projectId' | 'channel' | 'formId'>> = {
    new: { statuses: ['PENDING'] },
    snoozed: { statuses: ['SNOOZED'] },
    spam: { statuses: ['DECLINED'], declineReason: { is: 'SPAM' } },
    decided: { statuses: ['ACCEPTED', 'DECLINED', 'MERGED'], declineReason: { not: 'SPAM' } },
};

export interface ListIntakeQuery {
    view?: IntakeView;
    projectId?: string;
    formId?: string;
    cursor?: string;
    limit?: number;
}

export async function listIntakeRequests(ctx: RequestContext, query: ListIntakeQuery = {}): Promise<IntakeRequestPage> {
    assertCanReadIntake(ctx);
    const limit = clampLimit(query.limit);
    let cursor: CursorPayload | undefined;
    if (query.cursor) {
        try {
            cursor = decodeCursor(query.cursor, INTAKE_LIST_ORDER);
        } catch (err) {
            if (err instanceof InvalidCursorError) throw badRequest('Invalid cursor.');
            throw err;
        }
    }
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const rows = await IntakeRepository.listRequests(
            db,
            ctx,
            v,
            { ...VIEW_FILTER[query.view ?? 'new'], projectId: query.projectId, formId: query.formId },
            { limit, cursor },
        );
        const page = computeKeysetPage(rows, limit, INTAKE_LIST_ORDER);
        return { items: page.items.map(toRow), pageInfo: page.pageInfo };
    });
}

/** New requests per visible project the caller may read (the sidebar badge); `{}` without `intake.view`. */
export async function countPendingIntake(ctx: RequestContext): Promise<{ total: number; byProject: Record<string, number> }> {
    if (!mayReadIntake(ctx)) return { total: 0, byProject: {} };
    return runInTenantContext(ctx, async (db) => {
        const rows = await IntakeRepository.countPendingByProject(db, ctx, await visibleProjects(ctx, db));
        const byProject = Object.fromEntries(rows.map((r) => [r.projectId, r._count._all]));
        return { total: rows.reduce((n, r) => n + r._count._all, 0), byProject };
    });
}

async function detailOf(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, r: IntakeRequestDetailRow): Promise<IntakeRequestDetail> {
    const itemIds = [r.workItemId, r.mergedIntoWorkItemId].filter((x): x is string => !!x);
    const items = itemIds.length > 0 ? await WorkItemRepository.listByIds(db, ctx, v, itemIds) : [];
    const keyFor = (id: string | null) => {
        const it = id ? items.find((i) => i.id === id) : undefined;
        return it ? formatKey(it.project.keyPrefix, it.number) : null;
    };
    return {
        ...toRow(r),
        body: r.body,
        answers: readStoredAnswers(r.answersJson).map((a) => ({ fieldId: a.fieldId, label: a.label, kind: a.kind, value: a.value })),
        snoozedByUserId: r.snoozedByUserId,
        decidedByUserId: r.decidedByUserId,
        declineExplanation: r.declineExplanation,
        internalRemark: r.internalRemark,
        workItemKey: keyFor(r.workItemId),
        mergedIntoWorkItemKey: keyFor(r.mergedIntoWorkItemId),
        mergedRequestCount: await IntakeRepository.countMergedInto(db, ctx, r.id),
        requesterName: r.requesterName,
        requesterEmail: r.requesterEmail,
        requesterUpdates: r.updatesConfirmedAt ? 'CONFIRMED' : r.updatesRequested ? 'ASKED' : 'NONE',
        senderCheck: r.senderCheck,
        attachmentsDropped: r.attachmentsDropped,
        followUps: r.channel === 'EMAIL'
            ? (await IntakeEmailRepository.listFollowUps(db, ctx, r.id)).map((f) => ({ id: f.id, body: f.body, attachmentsDropped: f.attachmentsDropped, createdAt: f.createdAt.toISOString() }))
            : [],
        senderBlockable: r.requesterEmailHash !== null,
    };
}

export async function getIntakeRequest(ctx: RequestContext, id: string): Promise<IntakeRequestDetail> {
    assertCanReadIntake(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const r = await IntakeRepository.getRequest(db, ctx, v, id);
        if (!r) throw notFound('Request not found');
        return detailOf(db, ctx, v, r);
    });
}

// ─── Triage ───────────────────────────────────────────────────────────────

/**
 * The gate of every triage write: lock the visible request, refuse a status
 * the action cannot start from (409, the reason named), refuse a stale
 * version (409 `VERSION_CONFLICT` with the current request).
 */
async function lockForTriage(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, id: string, action: TriageAction, version: number) {
    const before = await IntakeRepository.getRequest(db, ctx, v, id);
    if (!before) throw notFound('Request not found');
    await IntakeRepository.lockRequest(db, ctx, id);
    const r = (await IntakeRepository.getRequest(db, ctx, v, id))!;
    if (r.version !== version) {
        throw new ConflictError('The request changed since you read it.', { reason: 'VERSION_CONFLICT', version: r.version, request: await detailOf(db, ctx, v, r) });
    }
    const refusal = checkTriage(action, r.status);
    if (refusal) throw new ConflictError(refusal.message, { reason: refusal.reason });
    return r;
}

async function claim(db: PrismaTx, ctx: RequestContext, r: IntakeRequestDetailRow, action: TriageAction, patch: IntakeTriagePatch): Promise<void> {
    const to = TRIAGE_TO[action];
    const n = await IntakeRepository.claimAndUpdate(db, ctx, r.id, TRIAGE_FROM[action], r.version, { ...(to ? { status: to } : {}), ...patch });
    // The row is locked: a miss here means the gate and the claim disagree.
    if (n === 0) throw new ConflictError('The request changed since you read it.', { reason: 'VERSION_CONFLICT' });
}

const ACTION_AUDIT: Record<TriageAction, string> = {
    accept: 'INTAKE_REQUEST_ACCEPTED',
    decline: 'INTAKE_REQUEST_DECLINED',
    merge: 'INTAKE_REQUEST_MERGED',
    snooze: 'INTAKE_REQUEST_SNOOZED',
    move: 'INTAKE_REQUEST_MOVED',
    edit: 'INTAKE_REQUEST_UPDATED',
    reopen: 'INTAKE_REQUEST_REOPENED',
};

async function auditTriage(
    db: PrismaTx,
    ctx: RequestContext,
    r: IntakeRequestDetailRow,
    action: TriageAction,
    metadata: Record<string, unknown>,
    reason?: string,
) {
    const toStatus: IntakeRequestStatus = TRIAGE_TO[action] ?? r.status;
    await logEvent(db, ctx, {
        action: ACTION_AUDIT[action],
        entityType: 'IntakeRequest',
        entityId: r.id,
        details: `${ACTION_AUDIT[action]} for request ${r.id}`,
        detailsJson: { category: 'status_change', entityName: 'IntakeRequest', fromStatus: r.status, toStatus, ...(reason ? { reason } : {}) },
        metadata: { projectId: r.projectId, channel: r.channel, ...metadata },
    });
}

/** The reason a declined request names in its email (spam is never sent). */
const DECLINE_REASON_LABEL: Record<Exclude<IntakeDeclineReason, 'SPAM'>, string> = {
    NOT_PLANNED: 'Not planned',
    OUT_OF_SCOPE: 'Out of scope',
    OTHER: 'Other',
};

/**
 * Inside a decision's transaction: email each of `ids` that is a public
 * request whose requester asked for updates and confirmed their address
 * (2.6b, owner decision 89). One outbox row per request (its id is the
 * dedupe entity); the workspace's email switch is honoured by `enqueueEmail`.
 * The email names the form and the reference, never the request's text.
 */
export async function enqueueRequesterNotices(
    db: PrismaTx,
    ctx: RequestContext,
    ids: readonly string[],
    notice: { kind: 'ACCEPTED' | 'MERGED' } | { kind: 'DECLINED'; reason: Exclude<IntakeDeclineReason, 'SPAM'>; explanation: string | null },
): Promise<number> {
    const rows = await IntakeRepository.listConfirmedRequesters(db, ctx, ids);
    let sent = 0;
    for (const row of rows) {
        if (!row.requesterEmail) continue;
        const base = { tenantId: ctx.tenantId, toEmail: row.requesterEmail, entityId: row.id };
        const payload = { formName: row.form?.name ?? null, reference: intakeReference(row.id) };
        const queued =
            notice.kind === 'DECLINED'
                ? await enqueueEmail(db, {
                      ...base,
                      type: 'INTAKE_DECLINED',
                      payload: { ...payload, reasonLabel: DECLINE_REASON_LABEL[notice.reason], explanation: notice.explanation },
                  })
                : await enqueueEmail(db, { ...base, type: notice.kind === 'ACCEPTED' ? 'INTAKE_ACCEPTED' : 'INTAKE_MERGED', payload });
        if (queued) sent++;
    }
    return sent;
}

async function afterDecision(ctx: RequestContext, r: IntakeRequestDetailRow, status: 'ACCEPTED' | 'DECLINED' | 'MERGED', extra: { workItemId?: string | null; declineReason?: string | null }) {
    await emitAutomationEvent(ctx, {
        event: 'INTAKE_REQUEST_DECIDED',
        entityType: 'IntakeRequest',
        entityId: r.id,
        actorUserId: ctx.userId,
        stableKey: `${r.id}:${status}`,
        data: {
            projectId: r.projectId,
            channel: r.channel,
            status,
            formId: r.formId,
            workItemId: extra.workItemId ?? null,
            declineReason: extra.declineReason ?? null,
        },
    });
}

export interface AcceptIntakeInput {
    /** Another project to create the item in (needs `work_items.create` there; its custom fields are not filled). */
    projectId?: string;
    typeId: string;
    /** A Backlog or Unstarted state of the target project's team; the team's default when absent. */
    stateId?: string;
    priority?: WorkItemPriority;
    assigneeId?: string | null;
    labelIds?: string[];
    cycleId?: string | null;
    /** Fields a type's field set may require (2.4b-b): a milestone of the target project, who it waits on, dates. */
    milestoneId?: string | null;
    waitingOnUserId?: string | null;
    startDate?: string | null;
    dueDate?: string | null;
    /** Overrides the request's title or text for the item. */
    title?: string;
    description?: string | null;
}

/**
 * Accept: create the work item and mark the request, in one transaction.
 * The requester (and the requesters of requests merged into this one) become
 * watchers of the item while they are active members.
 */
export async function acceptIntakeRequest(ctx: RequestContext, id: string, input: AcceptIntakeInput, expectedVersion?: number): Promise<IntakeRequestDetail> {
    assertCanAcceptIntake(ctx);
    if (expectedVersion === undefined) throw triagePreconditionRequired();
    const result = await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const r = await lockForTriage(db, ctx, v, id, 'accept', expectedVersion);
        const targetProjectId = input.projectId ?? r.projectId;
        const project = await ProjectRepository.getVisible(db, ctx, v, targetProjectId);
        if (!project) throw notFound('Project not found');
        if (input.stateId) {
            const state = await TeamRepository.getState(db, ctx, input.stateId);
            if (state && state.category !== 'BACKLOG' && state.category !== 'UNSTARTED') {
                throw badRequest('An accepted request starts in a Backlog or Unstarted state.');
            }
        }

        // The answers fill the target project's custom fields when they can,
        // and the rest are appended to the description.
        const answers = readStoredAnswers(r.answersJson);
        const targets = new Map<string, AcceptFieldTarget>(
            targetProjectId === r.projectId && answers.some((a) => a.customFieldId)
                ? (await CustomFieldRepository.listFields(db, ctx, targetProjectId)).map((f) => [f.id, f])
                : [],
        );
        const plan = planAcceptedFields(answers, targets);
        const created = await createWorkItemInTx(
            db,
            ctx,
            {
                projectId: targetProjectId,
                typeId: input.typeId,
                title: input.title ?? r.title,
                description: acceptedDescription(input.description !== undefined ? input.description : r.body, plan.lines),
                stateId: input.stateId,
                priority: input.priority,
                assigneeId: input.assigneeId ?? null,
                labelIds: input.labelIds,
                cycleId: input.cycleId ?? null,
                milestoneId: input.milestoneId ?? null,
                waitingOnUserId: input.waitingOnUserId ?? null,
                startDate: input.startDate ?? null,
                dueDate: input.dueDate ?? null,
                customFields: plan.customFields,
            },
            // The answers mapped to fields were the requester's, not the triager's:
            // a hidden one is skipped and named rather than refused (2.4b-b, decision 111).
            { metadata: { intakeRequestId: r.id, intakeChannel: r.channel }, projected: 'customFields' },
        );

        await claim(db, ctx, r, 'accept', { decidedAt: new Date(), decidedByUserId: ctx.userId, workItemId: created.id, snoozedUntil: null, snoozedByUserId: null });
        const merged = await IntakeRepository.listMergedInto(db, ctx, r.id);
        // A public requester who confirmed, and those merged into this request, are told (2.6b).
        await enqueueRequesterNotices(db, ctx, [r.id, ...merged.map((m) => m.id)], { kind: 'ACCEPTED' });
        const requesters = [r.requesterUserId, ...merged.map((m) => m.requesterUserId)].filter((x): x is string => !!x);
        const active = requesters.length > 0 ? await MembershipRepository.listActiveUserIds(db, ctx, requesters) : new Set<string>();
        for (const userId of active) {
            // guardrail-allow: n+1 — one watcher row per requester, bounded by the merged requests of one request.
            await WorkItemWatcherRepository.add(db, ctx, created.id, userId);
        }
        await auditTriage(db, ctx, r, 'accept', { workItemId: created.id, targetProjectId, mergedRequests: merged.length });
        const after = (await IntakeRepository.getRequest(db, ctx, v, id))!;
        return { created, after, detail: await detailOf(db, ctx, v, after) };
    });
    // After the commit: the create path's bells, then the decision's event.
    await emitCreatedItemBells(ctx, result.created);
    await afterDecision(ctx, result.after, 'ACCEPTED', { workItemId: result.created.id });
    return result.detail;
}

export interface DeclineIntakeInput {
    reason: IntakeDeclineReason;
    /** For the requester (sent from 2.6b to an outside requester who confirmed their address). */
    explanation?: string | null;
    /** Never sent. */
    remark?: string | null;
    /** With SPAM: block the requester's address on the request's project (2.6c; `intake.manage`). */
    blockSender?: boolean;
}

export async function declineIntakeRequest(ctx: RequestContext, id: string, input: DeclineIntakeInput, expectedVersion?: number): Promise<IntakeRequestDetail> {
    assertCanTriageIntake(ctx);
    if (input.blockSender) {
        if (input.reason !== 'SPAM') throw badRequest('Only a spam decline blocks the sender.');
        // Blocked senders are managed under `intake.manage` (decision 92), also from triage.
        assertCanManageIntake(ctx);
    }
    if (expectedVersion === undefined) throw triagePreconditionRequired();
    const out = await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const r = await lockForTriage(db, ctx, v, id, 'decline', expectedVersion);
        if (input.blockSender && !r.requesterEmailHash) {
            throw new ConflictError('The request has no sender address to block.', { reason: 'NO_SENDER_ADDRESS' });
        }
        await claim(db, ctx, r, 'decline', {
            decidedAt: new Date(),
            decidedByUserId: ctx.userId,
            declineReason: input.reason,
            // A spam decline sends nothing, so it keeps no explanation.
            declineExplanation: input.reason === 'SPAM' ? null : cleanText(input.explanation),
            internalRemark: cleanText(input.remark),
            snoozedUntil: null,
            snoozedByUserId: null,
        });
        const explanation = input.reason === 'SPAM' ? null : cleanText(input.explanation);
        if (input.reason !== 'SPAM') {
            // A confirmed public requester is told, with the explanation (2.6b); spam sends nothing.
            await enqueueRequesterNotices(db, ctx, [r.id], { kind: 'DECLINED', reason: input.reason, explanation });
        }
        await auditTriage(db, ctx, r, 'decline', { declineReason: input.reason }, input.reason);
        if (input.blockSender && r.requesterEmailHash) {
            await blockSenderInTx(db, ctx, { projectId: r.projectId, emailHash: r.requesterEmailHash, via: 'SPAM_DECLINE' });
        }
        const after = (await IntakeRepository.getRequest(db, ctx, v, id))!;
        return { after, detail: await detailOf(db, ctx, v, after) };
    });
    await afterDecision(ctx, out.after, 'DECLINED', { declineReason: input.reason });
    return out.detail;
}

export type MergeIntakeInput = { workItemId: string; requestId?: undefined } | { requestId: string; workItemId?: undefined };

/**
 * Merge into a live work item the caller can see, or into another open
 * request (never a merged one, never itself). Requests merged into this one
 * follow it to the new target, so no chain forms. Both requests are locked
 * in id order, so two crossing merges cannot deadlock.
 */
export async function mergeIntakeRequest(ctx: RequestContext, id: string, input: MergeIntakeInput, expectedVersion?: number): Promise<IntakeRequestDetail> {
    assertCanTriageIntake(ctx);
    if (expectedVersion === undefined) throw triagePreconditionRequired();
    const out = await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        if (input.requestId) {
            if (input.requestId === id) throw badRequest('A request cannot be merged into itself.');
            for (const lockId of [id, input.requestId].sort()) {
                // guardrail-allow: n+1 — two row locks, in id order.
                await IntakeRepository.lockRequest(db, ctx, lockId);
            }
        }
        const r = await lockForTriage(db, ctx, v, id, 'merge', expectedVersion);
        const patch: IntakeTriagePatch = { decidedAt: new Date(), decidedByUserId: ctx.userId, snoozedUntil: null, snoozedByUserId: null };
        if (input.workItemId) {
            const item = await WorkItemRepository.findVisible(db, ctx, v, input.workItemId);
            if (!item || item.deletedAt) throw notFound('Work item not found');
            patch.mergedIntoWorkItemId = item.id;
        } else {
            const target = await IntakeRepository.getRequest(db, ctx, v, input.requestId!);
            if (!target) throw notFound('Request not found');
            if (target.status !== 'PENDING' && target.status !== 'SNOOZED') {
                throw new ConflictError('A request can be merged only into a new or snoozed request.', { reason: 'MERGE_TARGET_NOT_OPEN' });
            }
            patch.mergedIntoRequestId = target.id;
        }
        await claim(db, ctx, r, 'merge', patch);
        // A confirmed public requester is told their request is handled with another (2.6b).
        await enqueueRequesterNotices(db, ctx, [r.id], { kind: 'MERGED' });
        // Requests merged into this one now follow its target.
        await IntakeRepository.repointMerged(db, ctx, r.id, patch.mergedIntoWorkItemId ? { workItemId: patch.mergedIntoWorkItemId } : { requestId: patch.mergedIntoRequestId! });
        await auditTriage(db, ctx, r, 'merge', {
            ...(patch.mergedIntoWorkItemId ? { mergedIntoWorkItemId: patch.mergedIntoWorkItemId } : { mergedIntoRequestId: patch.mergedIntoRequestId }),
        });
        const after = (await IntakeRepository.getRequest(db, ctx, v, id))!;
        return { after, detail: await detailOf(db, ctx, v, after) };
    });
    await afterDecision(ctx, out.after, 'MERGED', {});
    return out.detail;
}

/** Snooze until a date after today (date-only, `NOTIFICATIONS_TZ`). */
export async function snoozeIntakeRequest(ctx: RequestContext, id: string, input: { until: string }, expectedVersion?: number): Promise<IntakeRequestDetail> {
    assertCanTriageIntake(ctx);
    if (expectedVersion === undefined) throw triagePreconditionRequired();
    if (!snoozeDateIsFuture(input.until, today())) throw badRequest('Snooze a request until a day after today.');
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const r = await lockForTriage(db, ctx, v, id, 'snooze', expectedVersion);
        await claim(db, ctx, r, 'snooze', { snoozedUntil: new Date(`${input.until}T00:00:00Z`), snoozedByUserId: ctx.userId });
        await auditTriage(db, ctx, r, 'snooze', { snoozedUntil: input.until });
        return detailOf(db, ctx, v, (await IntakeRepository.getRequest(db, ctx, v, id))!);
    });
}

/** Move to another visible, live project whose intake is on. */
export async function moveIntakeRequest(ctx: RequestContext, id: string, input: { projectId: string }, expectedVersion?: number): Promise<IntakeRequestDetail> {
    assertCanTriageIntake(ctx);
    if (expectedVersion === undefined) throw triagePreconditionRequired();
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const r = await lockForTriage(db, ctx, v, id, 'move', expectedVersion);
        if (input.projectId === r.projectId) return detailOf(db, ctx, v, r);
        const project = await ProjectRepository.getVisible(db, ctx, v, input.projectId);
        if (!project) throw notFound('Project not found');
        const intake = await IntakeRepository.getProjectIntake(db, ctx, project.id);
        if (project.archivedAt || intake?.enabled !== true) {
            throw new ConflictError(`${project.name} does not take requests.`, { reason: 'INTAKE_OFF' });
        }
        await claim(db, ctx, r, 'move', { projectId: project.id });
        await auditTriage(db, ctx, r, 'move', { fromProjectId: r.projectId, toProjectId: project.id });
        return detailOf(db, ctx, v, (await IntakeRepository.getRequest(db, ctx, v, id))!);
    });
}

/** Change a new or snoozed request's title or text. */
export async function editIntakeRequest(
    ctx: RequestContext,
    id: string,
    input: { title?: string; body?: string | null },
    expectedVersion?: number,
): Promise<IntakeRequestDetail> {
    assertCanTriageIntake(ctx);
    if (expectedVersion === undefined) throw triagePreconditionRequired();
    const patch: IntakeTriagePatch = {};
    const changed: string[] = [];
    if (input.title !== undefined) {
        patch.title = cleanTitle(input.title);
        changed.push('title');
    }
    if (input.body !== undefined) {
        patch.body = cleanText(input.body);
        changed.push('body');
    }
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const r = await lockForTriage(db, ctx, v, id, 'edit', expectedVersion);
        if (changed.length === 0) return detailOf(db, ctx, v, r);
        await claim(db, ctx, r, 'edit', patch);
        await auditTriage(db, ctx, r, 'edit', { changedFields: changed });
        return detailOf(db, ctx, v, (await IntakeRepository.getRequest(db, ctx, v, id))!);
    });
}

/** Back to new: a snoozed, declined or merged request, while it is kept. */
export async function reopenIntakeRequest(ctx: RequestContext, id: string, expectedVersion?: number): Promise<IntakeRequestDetail> {
    assertCanTriageIntake(ctx);
    if (expectedVersion === undefined) throw triagePreconditionRequired();
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const r = await lockForTriage(db, ctx, v, id, 'reopen', expectedVersion);
        await claim(db, ctx, r, 'reopen', {
            decidedAt: null,
            decidedByUserId: null,
            declineReason: null,
            declineExplanation: null,
            mergedIntoWorkItemId: null,
            mergedIntoRequestId: null,
            snoozedUntil: null,
            snoozedByUserId: null,
        });
        await auditTriage(db, ctx, r, 'reopen', {});
        return detailOf(db, ctx, v, (await IntakeRepository.getRequest(db, ctx, v, id))!);
    });
}
