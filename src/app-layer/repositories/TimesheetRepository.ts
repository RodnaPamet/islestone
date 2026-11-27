/**
 * Timesheets and the time tracking settings (sub-phase 3.4c;
 * docs/porting/maps/3.4.md, "Timesheets and approval (3.4c)"; ADR 0012 §5).
 * Every query filters by `tenantId` (RLS also scopes it). The only caller
 * that writes is `usecases/timesheet.ts`.
 *
 *   - A person's week is the unique `(tenantId, userId, weekStart)`.
 *   - The weeks waiting for a decision and the decided ones read
 *     `Timesheet_tenantId_status_weekStart_idx`.
 *   - Every act locks its row (`FOR UPDATE`) under the week's advisory lock,
 *     then claims it with one conditional update naming the statuses it
 *     starts from and the version it read.
 *
 * Written fresh for Islestone.
 */
import type { Prisma, TimesheetStatus } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import { buildKeysetWhere, keysetOrderBy, type CursorPayload, type KeysetOrder } from '@/lib/pagination';
import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId'>;

/** Weeks waiting for a decision, oldest first. */
export const PENDING_TIMESHEET_ORDER: KeysetOrder<'weekStart'> = { column: 'weekStart', direction: 'asc', kind: 'date' };
/** Decided weeks, newest first. */
export const DECIDED_TIMESHEET_ORDER: KeysetOrder<'weekStart'> = { column: 'weekStart', direction: 'desc', kind: 'date' };

export const timesheetSelect = {
    id: true,
    userId: true,
    weekStart: true,
    status: true,
    submittedAt: true,
    decidedAt: true,
    decidedByUserId: true,
    returnExplanation: true,
    version: true,
} satisfies Prisma.TimesheetSelect;

export type TimesheetRow = Prisma.TimesheetGetPayload<{ select: typeof timesheetSelect }>;

export interface TimesheetClaim {
    status: TimesheetStatus;
    submittedAt?: Date;
    decidedAt: Date | null;
    decidedByUserId: string | null;
    returnExplanation: string | null;
}

export class TimesheetRepository {
    // ── Settings ─────────────────────────────────────────────────────

    /** The workspace's settings row, or null (the defaults). */
    static async settings(db: PrismaTx, ctx: Ctx) {
        return db.tenantTimeSettings.findUnique({
            where: { tenantId: ctx.tenantId },
            select: { approvalRequired: true, approvalRecipientListId: true, version: true },
        });
    }

    /** Write the settings at `expectedVersion` (when given); 0 rows when it moved. Creates the row the first time. */
    static async writeSettings(
        db: PrismaTx,
        ctx: Ctx,
        data: { approvalRequired: boolean; approvalRecipientListId: string | null },
        expectedVersion: number | undefined,
        exists: boolean,
    ): Promise<number> {
        if (!exists) {
            await db.tenantTimeSettings.create({ data: { tenantId: ctx.tenantId, ...data } });
            return 1;
        }
        const result = await db.tenantTimeSettings.updateMany({
            where: { tenantId: ctx.tenantId, ...(expectedVersion !== undefined ? { version: expectedVersion } : {}) },
            data: { ...data, version: { increment: 1 } },
        });
        return result.count;
    }

    /** Lock the settings row (when there is one) for the rest of the transaction. */
    static async lockSettings(db: PrismaTx, ctx: Ctx): Promise<void> {
        await db.$queryRaw`SELECT "tenantId" FROM "TenantTimeSettings" WHERE "tenantId" = ${ctx.tenantId} FOR UPDATE`;
    }

    /** Whether `listId` is a live recipient list of the workspace itself (not a project's). */
    static async isLiveWorkspaceList(db: PrismaTx, ctx: Ctx, listId: string): Promise<boolean> {
        const row = await db.recipientList.findFirst({ where: { id: listId, tenantId: ctx.tenantId, projectId: null, archivedAt: null }, select: { id: true } });
        return row !== null;
    }

    // ── Weeks ────────────────────────────────────────────────────────

    /** The person's row for the week starting `weekStart`, or null. */
    static async forWeek(db: PrismaTx, ctx: Ctx, userId: string, weekStart: Date): Promise<TimesheetRow | null> {
        return db.timesheet.findUnique({
            where: { tenantId_userId_weekStart: { tenantId: ctx.tenantId, userId, weekStart } },
            select: timesheetSelect,
        });
    }

    /** One row of the workspace, or null. */
    static async get(db: PrismaTx, ctx: Ctx, id: string): Promise<TimesheetRow | null> {
        return db.timesheet.findFirst({ where: { id, tenantId: ctx.tenantId }, select: timesheetSelect });
    }

    /** Lock one row for the rest of the transaction; false when there is none. */
    static async lock(db: PrismaTx, ctx: Ctx, id: string): Promise<boolean> {
        const rows = await db.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "Timesheet" WHERE "id" = ${id} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
        return rows.length === 1;
    }

    /** Insert the person's week as SUBMITTED (no row yet). */
    static async createSubmitted(db: PrismaTx, ctx: Ctx, userId: string, weekStart: Date, submittedAt: Date): Promise<TimesheetRow> {
        return db.timesheet.create({
            data: { tenantId: ctx.tenantId, userId, weekStart, status: 'SUBMITTED', submittedAt },
            select: timesheetSelect,
        });
    }

    /**
     * Move a row from one of `from` at `version` to `to`; the version
     * increases. 0 when its status or version moved (or it is another
     * workspace's).
     */
    static async claim(db: PrismaTx, ctx: Ctx, id: string, from: readonly TimesheetStatus[], version: number, to: TimesheetClaim): Promise<number> {
        const result = await db.timesheet.updateMany({
            where: { id, tenantId: ctx.tenantId, status: { in: [...from] }, version },
            data: { ...to, version: { increment: 1 } },
        });
        return result.count;
    }

    /**
     * One page of weeks: waiting for a decision (oldest first), or decided
     * (APPROVED or RETURNED) since `decidedSince` (newest first); `limit + 1`
     * rows after the cursor, each with its person's name.
     */
    static async page(
        db: PrismaTx,
        ctx: Ctx,
        view: { kind: 'SUBMITTED' } | { kind: 'DECIDED'; since: Date },
        page: { limit: number; cursor?: CursorPayload },
    ) {
        const order = view.kind === 'SUBMITTED' ? PENDING_TIMESHEET_ORDER : DECIDED_TIMESHEET_ORDER;
        return db.timesheet.findMany({
            where: {
                tenantId: ctx.tenantId,
                ...(view.kind === 'SUBMITTED' ? { status: 'SUBMITTED' } : { status: { in: ['APPROVED', 'RETURNED'] }, weekStart: { gte: view.since } }),
                ...(page.cursor ? buildKeysetWhere(order, page.cursor) : {}),
            },
            orderBy: keysetOrderBy(order),
            take: page.limit + 1,
            select: { ...timesheetSelect, user: { select: { name: true } } },
        });
    }

    /** The given people's SUBMITTED or APPROVED weeks starting `weekStart` (the reminder skips them). */
    static async submittedFor(db: PrismaTx, ctx: Ctx, weekStart: Date, userIds: readonly string[]): Promise<Set<string>> {
        if (userIds.length === 0) return new Set();
        const rows = await db.timesheet.findMany({
            where: { tenantId: ctx.tenantId, weekStart, userId: { in: [...userIds] }, status: { in: ['SUBMITTED', 'APPROVED'] } },
            take: userIds.length,
            select: { userId: true },
        });
        return new Set(rows.map((r) => r.userId));
    }
}
