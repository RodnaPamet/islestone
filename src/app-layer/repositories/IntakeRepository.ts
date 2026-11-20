/**
 * Intake (sub-phase 2.6a; docs/porting/maps/2.6.md): a project's intake, its
 * notify list, its forms and its requests. Every query filters by `tenantId`
 * (RLS also scopes it), and every request read carries the caller's project
 * visibility explicitly, as the work-item reads do. The status claim of a
 * triage write is the `WHERE` of one `updateMany`, never a read then a write.
 *
 * Written fresh for Islestone.
 */
import type { IntakeChannel, IntakeDeclineReason, IntakeFormAccess, IntakeRequestStatus, Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import { buildKeysetWhere, keysetOrderBy, type CursorPayload, type KeysetOrder } from '@/lib/pagination';
import { projectRowVisibilityWhere, type ProjectVisibility } from '../policies/project-visibility';
import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId'>;

/** The forms one list returns: far beyond a project's real number. */
export const INTAKE_FORM_LIST_TAKE = 200;
/** The project intakes Settings reads. */
export const PROJECT_INTAKE_TAKE = 500;
/** The notify list of one project (the roster's size bounds it). */
export const NOTIFY_LIST_TAKE = 500;
/** The rows one job batch touches. */
export const INTAKE_JOB_BATCH = 500;

export const INTAKE_LIST_ORDER: KeysetOrder<'createdAt'> = { column: 'createdAt', direction: 'desc', kind: 'date' };

/** The `IntakeRequest` fragment: its project is visible and not deleted (archived ones stay readable). */
export function intakeVisibilityWhere(v: ProjectVisibility): Prisma.IntakeRequestWhereInput {
    return { project: projectRowVisibilityWhere(v, { includeArchived: true }) };
}

export const intakeFormSelect = {
    id: true,
    projectId: true,
    name: true,
    access: true,
    publicId: true,
    publishedAt: true,
    archivedAt: true,
    definitionJson: true,
    definitionVersion: true,
    version: true,
    dailyCap: true,
    createdByUserId: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.IntakeFormSelect;

export type IntakeFormRow = Prisma.IntakeFormGetPayload<{ select: typeof intakeFormSelect }>;

export const intakeRequestListSelect = {
    id: true,
    projectId: true,
    channel: true,
    formId: true,
    status: true,
    title: true,
    requesterUserId: true,
    snoozedUntil: true,
    decidedAt: true,
    declineReason: true,
    workItemId: true,
    mergedIntoWorkItemId: true,
    mergedIntoRequestId: true,
    version: true,
    createdAt: true,
    form: { select: { name: true } },
} satisfies Prisma.IntakeRequestSelect;

export type IntakeRequestListRow = Prisma.IntakeRequestGetPayload<{ select: typeof intakeRequestListSelect }>;

export const intakeRequestDetailSelect = {
    ...intakeRequestListSelect,
    body: true,
    answersJson: true,
    formDefinitionVersion: true,
    snoozedByUserId: true,
    decidedByUserId: true,
    declineExplanation: true,
    internalRemark: true,
    /** A public request's requester (2.6b), decrypted by the PII extension. */
    requesterName: true,
    requesterEmail: true,
    updatesRequested: true,
    updatesConfirmedAt: true,
    form: { select: { name: true, definitionJson: true, definitionVersion: true } },
} satisfies Prisma.IntakeRequestSelect;

export type IntakeRequestDetailRow = Prisma.IntakeRequestGetPayload<{ select: typeof intakeRequestDetailSelect }>;

export interface IntakeListFilter {
    projectId?: string;
    statuses: readonly IntakeRequestStatus[];
    /** Only DECLINED rows of this reason, or none of it. */
    declineReason?: { is?: IntakeDeclineReason; not?: IntakeDeclineReason };
    channel?: IntakeChannel;
    formId?: string;
}

export interface IntakeTriagePatch {
    status?: IntakeRequestStatus;
    projectId?: string;
    title?: string;
    body?: string | null;
    snoozedUntil?: Date | null;
    snoozedByUserId?: string | null;
    decidedAt?: Date | null;
    decidedByUserId?: string | null;
    declineReason?: IntakeDeclineReason | null;
    declineExplanation?: string | null;
    internalRemark?: string | null;
    workItemId?: string | null;
    mergedIntoWorkItemId?: string | null;
    mergedIntoRequestId?: string | null;
}

export class IntakeRepository {
    // ─── Project intake and the notify list ─────────────────────────────

    static async listProjectIntakes(db: PrismaTx, ctx: Ctx, projectIds: readonly string[]) {
        return db.projectIntake.findMany({
            where: { tenantId: ctx.tenantId, projectId: { in: [...projectIds] } },
            take: PROJECT_INTAKE_TAKE,
            select: { projectId: true, enabled: true },
        });
    }

    static async getProjectIntake(db: PrismaTx, ctx: Ctx, projectId: string) {
        return db.projectIntake.findFirst({ where: { tenantId: ctx.tenantId, projectId }, select: { projectId: true, enabled: true } });
    }

    static async upsertProjectIntake(db: PrismaTx, ctx: Ctx, projectId: string, enabled: boolean) {
        return db.projectIntake.upsert({
            where: { projectId_tenantId: { projectId, tenantId: ctx.tenantId } },
            create: { tenantId: ctx.tenantId, projectId, enabled },
            update: { enabled },
            select: { projectId: true, enabled: true },
        });
    }

    static async listNotifyMembers(db: PrismaTx, ctx: Ctx, projectIds: readonly string[]) {
        return db.intakeNotifyMember.findMany({
            where: { tenantId: ctx.tenantId, projectId: { in: [...projectIds] } },
            orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
            take: NOTIFY_LIST_TAKE * Math.max(1, projectIds.length),
            select: { projectId: true, userId: true },
        });
    }

    static async replaceNotifyMembers(db: PrismaTx, ctx: Ctx, projectId: string, userIds: readonly string[]) {
        await db.intakeNotifyMember.deleteMany({ where: { tenantId: ctx.tenantId, projectId, userId: { notIn: [...userIds] } } });
        if (userIds.length > 0) {
            await db.intakeNotifyMember.createMany({
                data: userIds.map((userId) => ({ tenantId: ctx.tenantId, projectId, userId })),
                skipDuplicates: true,
            });
        }
    }

    // ─── Forms ──────────────────────────────────────────────────────────

    static async listForms(db: PrismaTx, ctx: Ctx, filter: { projectIds: readonly string[]; includeArchived?: boolean }) {
        return db.intakeForm.findMany({
            where: {
                tenantId: ctx.tenantId,
                projectId: { in: [...filter.projectIds] },
                ...(filter.includeArchived ? {} : { archivedAt: null }),
            },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            take: INTAKE_FORM_LIST_TAKE,
            select: intakeFormSelect,
        });
    }

    static async getForm(db: PrismaTx, ctx: Ctx, id: string) {
        return db.intakeForm.findFirst({ where: { id, tenantId: ctx.tenantId }, select: intakeFormSelect });
    }

    static async formNameTaken(db: PrismaTx, ctx: Ctx, projectId: string, name: string, exceptId?: string): Promise<boolean> {
        const row = await db.intakeForm.findFirst({
            where: { tenantId: ctx.tenantId, projectId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
            select: { id: true },
        });
        return row !== null;
    }

    static async createForm(
        db: PrismaTx,
        ctx: Ctx,
        data: {
            projectId: string;
            name: string;
            publicId: string;
            definitionJson: Prisma.InputJsonValue;
            createdByUserId: string;
            publishedAt: Date | null;
            access?: IntakeFormAccess;
        },
    ) {
        return db.intakeForm.create({ data: { tenantId: ctx.tenantId, access: 'MEMBERS', ...data }, select: intakeFormSelect });
    }

    /** One versioned update; 0 when the form moved on (or is gone). */
    static async updateFormVersioned(
        db: PrismaTx,
        ctx: Ctx,
        id: string,
        version: number,
        data: {
            name?: string;
            definitionJson?: Prisma.InputJsonValue;
            bumpDefinition?: boolean;
            publishedAt?: Date | null;
            archivedAt?: Date | null;
            access?: IntakeFormAccess;
        },
    ): Promise<number> {
        const { bumpDefinition, ...rest } = data;
        const r = await db.intakeForm.updateMany({
            where: { id, tenantId: ctx.tenantId, version },
            data: { ...rest, version: { increment: 1 }, ...(bumpDefinition ? { definitionVersion: { increment: 1 } } : {}) },
        });
        return r.count;
    }

    // ─── Requests ───────────────────────────────────────────────────────

    static async createRequest(
        db: PrismaTx,
        ctx: Ctx,
        data: {
            projectId: string;
            channel: IntakeChannel;
            formId: string | null;
            formDefinitionVersion: number | null;
            title: string;
            body: string | null;
            answersJson: string | null;
            requesterUserId: string | null;
            /** A public request's requester (2.6b); the PII extension encrypts both and hashes the address. */
            requesterName?: string | null;
            requesterEmail?: string | null;
            updatesRequested?: boolean;
            updatesConfirmedAt?: Date | null;
            confirmTokenHash?: string | null;
            formTokenNonce?: string | null;
        },
    ) {
        return db.intakeRequest.create({ data: { tenantId: ctx.tenantId, ...data }, select: intakeRequestListSelect });
    }

    // ─── Public forms (2.6b) ────────────────────────────────────────────

    /**
     * Lock a form's row for the rest of the transaction, so two public
     * submits count its daily cap one after the other (`FOR UPDATE`).
     */
    static async lockForm(db: PrismaTx, ctx: Ctx, formId: string): Promise<boolean> {
        const rows = await db.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "IntakeForm" WHERE "id" = ${formId} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
        return rows.length === 1;
    }

    /** Requests a form took since `since` (its daily cap, decision 88). */
    static async countFormRequestsSince(db: PrismaTx, ctx: Ctx, formId: string, since: Date): Promise<number> {
        return db.intakeRequest.count({ where: { tenantId: ctx.tenantId, formId, createdAt: { gte: since } } });
    }

    /** Requests of one channel the workspace took since `since` (the workspace's daily cap on public requests). */
    static async countChannelSince(db: PrismaTx, ctx: Ctx, channel: IntakeChannel, since: Date): Promise<number> {
        return db.intakeRequest.count({ where: { tenantId: ctx.tenantId, channel, createdAt: { gte: since } } });
    }

    /** Whether an address already confirmed updates on this form (an address is confirmed once per form). */
    static async addressConfirmedOnForm(db: PrismaTx, ctx: Ctx, formId: string, emailHash: string): Promise<boolean> {
        const row = await db.intakeRequest.findFirst({
            where: { tenantId: ctx.tenantId, formId, requesterEmailHash: emailHash, updatesConfirmedAt: { not: null } },
            select: { id: true },
        });
        return row !== null;
    }

    /** The request a confirmation token names, in this workspace (its token hash is global and unique). */
    static async getByConfirmToken(db: PrismaTx, ctx: Ctx, tokenHash: string) {
        return db.intakeRequest.findFirst({
            where: { tenantId: ctx.tenantId, confirmTokenHash: tokenHash },
            select: { id: true, formId: true, requesterEmailHash: true, updatesConfirmedAt: true, createdAt: true },
        });
    }

    /**
     * Confirm an address on a form: every request of the workspace sent
     * through `formId` from that address with updates asked for and not yet
     * confirmed, the one whose link was used included. Each spends its link.
     * Returns the ids confirmed.
     */
    static async confirmAddressOnForm(db: PrismaTx, ctx: Ctx, formId: string, emailHash: string, at: Date): Promise<string[]> {
        const rows = await db.intakeRequest.findMany({
            where: { tenantId: ctx.tenantId, formId, requesterEmailHash: emailHash, updatesRequested: true, updatesConfirmedAt: null },
            orderBy: { id: 'asc' },
            take: INTAKE_JOB_BATCH,
            select: { id: true },
        });
        if (rows.length === 0) return [];
        const ids = rows.map((r) => r.id);
        await db.intakeRequest.updateMany({
            where: { tenantId: ctx.tenantId, id: { in: ids }, updatesConfirmedAt: null },
            data: { updatesConfirmedAt: at, confirmTokenHash: null },
        });
        return ids;
    }

    /** Of `ids`, the decided ones, with what a late notice needs (an address confirmed after the decision). */
    static async listDecidedForNotice(db: PrismaTx, ctx: Ctx, ids: readonly string[]) {
        if (ids.length === 0) return [];
        return db.intakeRequest.findMany({
            where: { tenantId: ctx.tenantId, id: { in: [...ids] }, status: { in: ['ACCEPTED', 'DECLINED', 'MERGED'] } },
            orderBy: { id: 'asc' },
            take: INTAKE_JOB_BATCH,
            select: { id: true, status: true, declineReason: true, declineExplanation: true },
        });
    }

    /**
     * The public requests that should hear about a decision: `ids` that asked
     * for updates and confirmed their address, with the address (decrypted)
     * and the form's name.
     */
    static async listConfirmedRequesters(db: PrismaTx, ctx: Ctx, ids: readonly string[]) {
        if (ids.length === 0) return [];
        return db.intakeRequest.findMany({
            where: { tenantId: ctx.tenantId, id: { in: [...ids] }, channel: 'PUBLIC_FORM', updatesRequested: true, updatesConfirmedAt: { not: null } },
            orderBy: { id: 'asc' },
            take: INTAKE_JOB_BATCH,
            select: { id: true, requesterEmail: true, form: { select: { name: true } } },
        });
    }

    static async listRequests(
        db: PrismaTx,
        ctx: Ctx,
        v: ProjectVisibility,
        filter: IntakeListFilter,
        page: { limit: number; cursor?: CursorPayload },
    ): Promise<IntakeRequestListRow[]> {
        return db.intakeRequest.findMany({
            where: {
                tenantId: ctx.tenantId,
                status: { in: [...filter.statuses] },
                ...(filter.projectId ? { projectId: filter.projectId } : {}),
                ...(filter.channel ? { channel: filter.channel } : {}),
                ...(filter.formId ? { formId: filter.formId } : {}),
                AND: [
                    intakeVisibilityWhere(v),
                    ...(filter.declineReason?.is ? [{ declineReason: filter.declineReason.is }] : []),
                    ...(filter.declineReason?.not ? [{ OR: [{ declineReason: null }, { declineReason: { not: filter.declineReason.not } }] }] : []),
                    ...(page.cursor ? [buildKeysetWhere(INTAKE_LIST_ORDER, page.cursor)] : []),
                ],
            },
            orderBy: keysetOrderBy(INTAKE_LIST_ORDER),
            take: page.limit + 1,
            select: intakeRequestListSelect,
        });
    }

    static async getRequest(db: PrismaTx, ctx: Ctx, v: ProjectVisibility, id: string) {
        return db.intakeRequest.findFirst({
            where: { id, tenantId: ctx.tenantId, AND: [intakeVisibilityWhere(v)] },
            select: intakeRequestDetailSelect,
        });
    }

    /** Lock one visible request row for the rest of the transaction (a merge target). */
    static async lockRequest(db: PrismaTx, ctx: Ctx, id: string): Promise<boolean> {
        const rows = await db.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "IntakeRequest" WHERE "id" = ${id} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
        return rows.length === 1;
    }

    /**
     * The claim of every triage write: one `updateMany` whose `WHERE` names
     * the statuses the action starts from and the version the caller read.
     * 0 when somebody else moved the request first.
     */
    static async claimAndUpdate(
        db: PrismaTx,
        ctx: Ctx,
        id: string,
        from: readonly IntakeRequestStatus[],
        version: number,
        patch: IntakeTriagePatch,
    ): Promise<number> {
        const r = await db.intakeRequest.updateMany({
            where: { id, tenantId: ctx.tenantId, status: { in: [...from] }, version },
            data: { ...patch, version: { increment: 1 } },
        });
        return r.count;
    }

    /** Pending (new) requests per project, for the sidebar and Settings. */
    static async countPendingByProject(db: PrismaTx, ctx: Ctx, v: ProjectVisibility, projectIds?: readonly string[]) {
        return db.intakeRequest.groupBy({
            by: ['projectId'],
            where: {
                tenantId: ctx.tenantId,
                status: 'PENDING',
                ...(projectIds ? { projectId: { in: [...projectIds] } } : {}),
                AND: [intakeVisibilityWhere(v)],
            },
            orderBy: { projectId: 'asc' },
            take: PROJECT_INTAKE_TAKE,
            _count: { _all: true },
        });
    }

    static async countMergedInto(db: PrismaTx, ctx: Ctx, requestId: string): Promise<number> {
        return db.intakeRequest.count({ where: { tenantId: ctx.tenantId, mergedIntoRequestId: requestId, status: 'MERGED' } });
    }

    /** The requests merged into a request (to follow it when it is accepted). */
    static async listMergedInto(db: PrismaTx, ctx: Ctx, requestId: string) {
        return db.intakeRequest.findMany({
            where: { tenantId: ctx.tenantId, mergedIntoRequestId: requestId, status: 'MERGED' },
            orderBy: { id: 'asc' },
            take: INTAKE_JOB_BATCH,
            select: { id: true, requesterUserId: true },
        });
    }

    /** Re-point the requests merged into `fromRequestId` at its new target (no chains). */
    static async repointMerged(db: PrismaTx, ctx: Ctx, fromRequestId: string, to: { workItemId: string } | { requestId: string }): Promise<number> {
        const r = await db.intakeRequest.updateMany({
            where: { tenantId: ctx.tenantId, mergedIntoRequestId: fromRequestId, status: 'MERGED' },
            data:
                'workItemId' in to
                    ? { mergedIntoRequestId: null, mergedIntoWorkItemId: to.workItemId, version: { increment: 1 } }
                    : { mergedIntoRequestId: to.requestId, version: { increment: 1 } },
        });
        return r.count;
    }

    // ─── Jobs ───────────────────────────────────────────────────────────

    /** Snoozed requests whose day has come, one batch. */
    static async listDueSnoozed(db: PrismaTx, ctx: Ctx, today: Date) {
        return db.intakeRequest.findMany({
            where: { tenantId: ctx.tenantId, status: 'SNOOZED', snoozedUntil: { lte: today } },
            orderBy: [{ snoozedUntil: 'asc' }, { id: 'asc' }],
            take: INTAKE_JOB_BATCH,
            select: { id: true, projectId: true, title: true, snoozedByUserId: true, snoozedUntil: true },
        });
    }

    /** Wake the given requests if they are still snoozed until today or earlier. */
    static async wake(db: PrismaTx, ctx: Ctx, ids: readonly string[], today: Date): Promise<string[]> {
        const rows = await db.$queryRaw<{ id: string }[]>`
            UPDATE "IntakeRequest"
               SET "status" = 'PENDING', "snoozedUntil" = NULL, "version" = "version" + 1, "updatedAt" = now()
             WHERE "tenantId" = ${ctx.tenantId} AND "id" = ANY(${[...ids]}::text[])
               AND "status" = 'SNOOZED' AND "snoozedUntil" <= ${today}::date
         RETURNING "id"`;
        return rows.map((r) => r.id);
    }

    /** Hard-delete one batch of decided requests decided before the cutoff. */
    static async purgeDecided(
        db: PrismaTx,
        ctx: Ctx,
        where: { statuses: readonly IntakeRequestStatus[]; before: Date; spam?: boolean },
    ): Promise<number> {
        const ids = await db.intakeRequest.findMany({
            where: {
                tenantId: ctx.tenantId,
                status: { in: [...where.statuses] },
                decidedAt: { lt: where.before },
                ...(where.spam === true ? { declineReason: 'SPAM' } : {}),
                ...(where.spam === false ? { OR: [{ declineReason: null }, { declineReason: { not: 'SPAM' } }] } : {}),
            },
            orderBy: { id: 'asc' },
            take: INTAKE_JOB_BATCH,
            select: { id: true },
        });
        if (ids.length === 0) return 0;
        const r = await db.intakeRequest.deleteMany({ where: { tenantId: ctx.tenantId, id: { in: ids.map((x) => x.id) } } });
        return r.count;
    }
}
