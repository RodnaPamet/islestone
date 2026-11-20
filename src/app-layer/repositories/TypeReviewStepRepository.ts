/**
 * A work item type's default review steps and its Done check (sub-phase
 * 2.8c; ADR 0009 §14 and §15; owner decisions 149 and 159). Every query
 * filters by `tenantId` (RLS also scopes it).
 *
 * What the database holds besides (migration `20261209120000_type_review_steps`):
 * a step's name and days are CHECKed, and a default reviewer names exactly
 * one of a member or a list. A type's defaults are replaced as a whole.
 *
 * Written fresh for Islestone.
 */
import type { Prisma, ReviewStepMode } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import { REVIEW_LIMITS } from '../domain/review-steps';
import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId' | 'userId'>;

/** Whom one default step may name: members and lists together, far above the request schema's bounds. */
const STEP_TARGETS_TAKE = (REVIEW_LIMITS.maxMembersPerStep + REVIEW_LIMITS.maxListsPerStep) * 2;

const defaultStepSelect = {
    id: true,
    position: true,
    name: true,
    mode: true,
    dueInWorkingDays: true,
    reviewers: {
        select: { userId: true, recipientListId: true, list: { select: { id: true, name: true, projectId: true, archivedAt: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: STEP_TARGETS_TAKE,
    },
} satisfies Prisma.WorkItemTypeReviewStepSelect;

export type TypeReviewStepRow = Prisma.WorkItemTypeReviewStepGetPayload<{ select: typeof defaultStepSelect }>;

export interface NewDefaultStep {
    name: string;
    mode: ReviewStepMode;
    dueInWorkingDays: number;
    memberIds: readonly string[];
    recipientListIds: readonly string[];
}

export class TypeReviewStepRepository {
    /**
     * Lock the type's row: two replacements of its defaults serialise (the
     * positions are unique per type, so an interleaved pair would collide).
     */
    static async lockType(db: PrismaTx, ctx: Ctx, typeId: string): Promise<void> {
        await db.$queryRaw`SELECT "id" FROM "WorkItemType" WHERE "id" = ${typeId} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
    }

    /** A type's default steps, in order, with whom each names. */
    static async list(db: PrismaTx, ctx: Ctx, typeId: string): Promise<TypeReviewStepRow[]> {
        return db.workItemTypeReviewStep.findMany({
            where: { tenantId: ctx.tenantId, typeId },
            orderBy: { position: 'asc' },
            take: REVIEW_LIMITS.maxSteps * 2,
            select: defaultStepSelect,
        });
    }

    /** Replace a type's default steps as a whole (the caller holds `lockType`). */
    static async replace(db: PrismaTx, ctx: Ctx, typeId: string, steps: readonly NewDefaultStep[]): Promise<void> {
        await db.workItemTypeReviewStep.deleteMany({ where: { tenantId: ctx.tenantId, typeId } });
        let position = 0;
        for (const s of steps) {
            position += 1;
            // guardrail-allow: n+1 — at most REVIEW_LIMITS.maxSteps steps, each a create that needs its own id.
            const step = await db.workItemTypeReviewStep.create({
                data: { tenantId: ctx.tenantId, typeId, position, name: s.name, mode: s.mode, dueInWorkingDays: s.dueInWorkingDays },
                select: { id: true },
            });
            const rows = [
                ...s.memberIds.map((userId) => ({ tenantId: ctx.tenantId, stepId: step.id, userId, recipientListId: null })),
                ...s.recipientListIds.map((recipientListId) => ({ tenantId: ctx.tenantId, stepId: step.id, userId: null, recipientListId })),
            ];
            if (rows.length > 0) await db.workItemTypeReviewStepReviewer.createMany({ data: rows });
        }
    }

    static async setRequiredForDone(db: PrismaTx, ctx: Ctx, typeId: string, value: boolean): Promise<void> {
        await db.workItemType.updateMany({ where: { id: typeId, tenantId: ctx.tenantId }, data: { reviewRequiredForDone: value } });
    }

    /** Of these types, the ones whose review must finish before Done (decision 149). */
    static async requiringReview(db: PrismaTx, ctx: Ctx, typeIds: readonly string[]): Promise<Set<string>> {
        const ids = [...new Set(typeIds)];
        if (ids.length === 0) return new Set();
        const rows = await db.workItemType.findMany({
            where: { tenantId: ctx.tenantId, id: { in: ids }, reviewRequiredForDone: true },
            take: ids.length,
            select: { id: true },
        });
        return new Set(rows.map((r) => r.id));
    }
}
