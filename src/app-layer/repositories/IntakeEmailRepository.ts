/**
 * Inbound email intake's rows (sub-phase 2.6c): the inbound deliveries, the
 * follow-ups, the blocked senders, and a project's email address. Every query
 * is filtered by `tenantId` and runs in the caller's tenant transaction; the
 * pre-tenant address resolution is the usecase's, under its named bypass.
 *
 * Written fresh for Islestone.
 */
import type { IntakeInboundStatus, Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId'>;

/** A project's blocked senders shown in Settings, newest first. */
export const BLOCKED_SENDER_TAKE = 500;
/** A request's follow-ups shown on the Intake page, in order. */
export const FOLLOW_UP_TAKE = 200;

export const inboundSelect = {
    id: true,
    projectId: true,
    svixId: true,
    emailId: true,
    status: true,
    outcome: true,
    senderHash: true,
    replyToken: true,
    attempts: true,
    requestId: true,
    followUpId: true,
    createdAt: true,
} satisfies Prisma.IntakeInboundEmailSelect;

const blockedSelect = { id: true, projectId: true, createdByUserId: true, createdAt: true } satisfies Prisma.IntakeBlockedSenderSelect;

export type InboundRow = Prisma.IntakeInboundEmailGetPayload<{ select: typeof inboundSelect }>;

export class IntakeEmailRepository {
    // ─── Inbound deliveries ─────────────────────────────────────────────

    /** The delivery already recorded for this webhook delivery or this email, if any. */
    /**
     * Lock a project's intake row for the rest of the transaction: an inbound
     * delivery's repeat check, throttles and insert run under it, one at a
     * time per address (H2f).
     */
    static async lockProjectIntake(db: PrismaTx, ctx: Ctx, projectId: string): Promise<void> {
        await db.$queryRaw`SELECT "projectId" FROM "ProjectIntake" WHERE "projectId" = ${projectId} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
    }

    static async findInbound(db: PrismaTx, ctx: Ctx, svixId: string, emailId: string) {
        return db.intakeInboundEmail.findFirst({
            where: { tenantId: ctx.tenantId, OR: [{ svixId }, { emailId }] },
            select: inboundSelect,
        });
    }

    static async getInbound(db: PrismaTx, ctx: Ctx, id: string) {
        return db.intakeInboundEmail.findFirst({ where: { id, tenantId: ctx.tenantId }, select: inboundSelect });
    }

    /** Deliveries to a project's address since `since` (from one sender, when given): the throttle. */
    static async countInboundSince(db: PrismaTx, ctx: Ctx, projectId: string, since: Date, senderHash?: string): Promise<number> {
        return db.intakeInboundEmail.count({
            where: { tenantId: ctx.tenantId, projectId, createdAt: { gte: since }, ...(senderHash ? { senderHash } : {}) },
        });
    }

    static async createInbound(
        db: PrismaTx,
        ctx: Ctx,
        data: { projectId: string; svixId: string; emailId: string; senderHash: string | null; replyToken: string | null; status: IntakeInboundStatus; outcome: string | null },
    ) {
        return db.intakeInboundEmail.create({ data: { tenantId: ctx.tenantId, ...data, processedAt: data.status === 'PENDING' ? null : new Date() }, select: inboundSelect });
    }

    /** Claim a pending delivery for one attempt: 0 when it is not pending, or another attempt holds it. */
    static async claimInbound(db: PrismaTx, ctx: Ctx, id: string, attempts: number): Promise<number> {
        const r = await db.intakeInboundEmail.updateMany({
            where: { id, tenantId: ctx.tenantId, status: 'PENDING', attempts },
            data: { attempts: { increment: 1 } },
        });
        return r.count;
    }

    /** Settle a pending delivery. */
    static async finishInbound(
        db: PrismaTx,
        ctx: Ctx,
        id: string,
        data: { status: Exclude<IntakeInboundStatus, 'PENDING'>; outcome: string | null; requestId?: string | null; followUpId?: string | null },
    ): Promise<number> {
        const r = await db.intakeInboundEmail.updateMany({
            where: { id, tenantId: ctx.tenantId, status: 'PENDING' },
            data: { ...data, processedAt: new Date() },
        });
        return r.count;
    }

    /** Remove deliveries older than `before` (the purge; they hold a sender hash and nothing else). */
    static async purgeInbound(db: PrismaTx, ctx: Ctx, before: Date): Promise<number> {
        const r = await db.intakeInboundEmail.deleteMany({ where: { tenantId: ctx.tenantId, createdAt: { lt: before }, status: { not: 'PENDING' } } });
        return r.count;
    }

    // ─── Requests and follow-ups ────────────────────────────────────────

    static async findRequestByReplyToken(db: PrismaTx, ctx: Ctx, projectId: string, replyToken: string) {
        return db.intakeRequest.findFirst({
            where: { tenantId: ctx.tenantId, projectId, replyToken },
            select: { id: true, status: true, version: true, requesterEmailHash: true },
        });
    }

    static async requestByDedupeHash(db: PrismaTx, ctx: Ctx, hash: string) {
        return db.intakeRequest.findFirst({ where: { tenantId: ctx.tenantId, sourceDedupeHash: hash }, select: { id: true } });
    }

    static async followUpByDedupeHash(db: PrismaTx, ctx: Ctx, hash: string) {
        return db.intakeFollowUp.findFirst({ where: { tenantId: ctx.tenantId, sourceDedupeHash: hash }, select: { id: true } });
    }

    static async createFollowUp(db: PrismaTx, ctx: Ctx, data: { requestId: string; body: string; sourceDedupeHash: string; attachmentsDropped: number }) {
        return db.intakeFollowUp.create({ data: { tenantId: ctx.tenantId, ...data }, select: { id: true, createdAt: true } });
    }

    static async listFollowUps(db: PrismaTx, ctx: Ctx, requestId: string) {
        return db.intakeFollowUp.findMany({
            where: { tenantId: ctx.tenantId, requestId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: FOLLOW_UP_TAKE,
            select: { id: true, body: true, attachmentsDropped: true, createdAt: true },
        });
    }

    /** The ACTIVE member whose sign-in address hashes to `emailHash`, if any (decision 99). */
    static async activeMemberByEmailHash(db: PrismaTx, ctx: Ctx, emailHash: string) {
        return db.tenantMembership.findFirst({
            where: { tenantId: ctx.tenantId, status: 'ACTIVE', user: { emailHash } },
            select: { userId: true },
        });
    }

    // ─── Blocked senders ────────────────────────────────────────────────
    // Kept only as the address's lookup hash (ADR 0006 "Blocked sender"); a
    // NULL project is the whole workspace.

    /** Whether the address is blocked on the project or across the workspace. */
    static async isBlocked(db: PrismaTx, ctx: Ctx, projectId: string, emailHash: string): Promise<boolean> {
        const row = await db.intakeBlockedSender.findFirst({
            where: { tenantId: ctx.tenantId, emailHash, OR: [{ projectId }, { projectId: null }] },
            select: { id: true },
        });
        return row !== null;
    }

    /** The workspace's blocks and those of the given projects, newest first; one address's when `emailHash` is given. */
    static async listBlocked(db: PrismaTx, ctx: Ctx, projectIds: readonly string[], emailHash?: string) {
        return db.intakeBlockedSender.findMany({
            where: {
                tenantId: ctx.tenantId,
                OR: [{ projectId: null }, ...(projectIds.length > 0 ? [{ projectId: { in: [...projectIds] } }] : [])],
                ...(emailHash ? { emailHash } : {}),
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: BLOCKED_SENDER_TAKE,
            select: blockedSelect,
        });
    }

    static async getBlocked(db: PrismaTx, ctx: Ctx, id: string) {
        return db.intakeBlockedSender.findFirst({ where: { id, tenantId: ctx.tenantId }, select: blockedSelect });
    }

    /** Block an address on a project (or the workspace); the existing row when it already is. */
    static async block(db: PrismaTx, ctx: Ctx, data: { projectId: string | null; emailHash: string; createdByUserId: string }) {
        const existing = await db.intakeBlockedSender.findFirst({
            where: { tenantId: ctx.tenantId, projectId: data.projectId, emailHash: data.emailHash },
            select: blockedSelect,
        });
        if (existing) return { row: existing, created: false };
        const row = await db.intakeBlockedSender.create({ data: { tenantId: ctx.tenantId, ...data }, select: blockedSelect });
        return { row, created: true };
    }

    static async unblock(db: PrismaTx, ctx: Ctx, id: string): Promise<number> {
        const r = await db.intakeBlockedSender.deleteMany({ where: { id, tenantId: ctx.tenantId } });
        return r.count;
    }

    // ─── A project's address ────────────────────────────────────────────

    static async getProjectEmail(db: PrismaTx, ctx: Ctx, projectId: string) {
        return db.projectIntake.findFirst({
            where: { tenantId: ctx.tenantId, projectId },
            select: { projectId: true, enabled: true, emailEnabled: true, emailToken: true, emailTokenRotatedAt: true, project: { select: { keyPrefix: true } } },
        });
    }

    static async listProjectEmails(db: PrismaTx, ctx: Ctx, projectIds: readonly string[]) {
        if (projectIds.length === 0) return [];
        return db.projectIntake.findMany({
            where: { tenantId: ctx.tenantId, projectId: { in: [...projectIds] } },
            take: projectIds.length,
            select: { projectId: true, emailEnabled: true, emailToken: true },
        });
    }

    static async setProjectEmail(db: PrismaTx, ctx: Ctx, projectId: string, data: { emailEnabled?: boolean; emailToken?: string; emailTokenRotatedAt?: Date }) {
        return db.projectIntake.update({
            where: { projectId_tenantId: { projectId, tenantId: ctx.tenantId } },
            data,
            select: { projectId: true, enabled: true, emailEnabled: true, emailToken: true },
        });
    }
}
