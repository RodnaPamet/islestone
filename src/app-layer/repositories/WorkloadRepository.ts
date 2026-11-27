/**
 * Capacity, the workspace's workload settings and the people of the Workload
 * page (sub-phase 3.5a; docs/porting/maps/3.5.md, "Capacity (3.5a)"; ADR 0013
 * §1). Every query filters by `tenantId` (RLS also scopes it). The only callers
 * that write are `usecases/workload-capacity.ts` (capacity and settings).
 *
 *   - A person's rows read `MemberCapacity_tenantId_userId_effectiveFrom_key`.
 *   - The settings row is keyed by the workspace.
 *
 * Written fresh for Islestone.
 */
import { Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId'>;

/** The most capacity rows one person's history returns (history grows a few rows a year). */
export const CAPACITY_HISTORY_TAKE = 200;

export const memberCapacitySelect = {
    id: true,
    userId: true,
    effectiveFrom: true,
    weeklyMinutes: true,
    calendarTeamId: true,
    version: true,
    createdAt: true,
} satisfies Prisma.MemberCapacitySelect;

export type MemberCapacityRow = Prisma.MemberCapacityGetPayload<{ select: typeof memberCapacitySelect }>;

/** What `capacityInputs` returns: dates as `YYYY-MM-DD`; `defaultWeeklyMinutes` NULL while no settings row is saved. */
export interface CapacityInputs {
    defaultWeeklyMinutes: number | null;
    rows: Array<{ userId: string; effectiveFrom: string; weeklyMinutes: number; calendarTeamId: string | null }>;
    timeOff: Array<{ userId: string; day: string; minutes: number | null }>;
}

export interface WorkloadPersonRecord {
    userId: string;
    name: string | null;
    active: boolean;
}

export class WorkloadRepository {
    // ─── Settings ───────────────────────────────────────────────────

    static async getSettings(db: PrismaTx, ctx: Ctx): Promise<{ defaultWeeklyMinutes: number; version: number } | null> {
        return db.tenantWorkloadSettings.findUnique({
            where: { tenantId: ctx.tenantId },
            select: { defaultWeeklyMinutes: true, version: true },
        });
    }

    /** Lock the settings row, when there is one, for a versioned change. */
    static async lockSettings(db: PrismaTx, ctx: Ctx): Promise<void> {
        await db.$queryRaw`SELECT "tenantId" FROM "TenantWorkloadSettings" WHERE "tenantId" = ${ctx.tenantId} FOR UPDATE`;
    }

    static async createSettings(db: PrismaTx, ctx: Ctx, defaultWeeklyMinutes: number) {
        return db.tenantWorkloadSettings.create({
            data: { tenantId: ctx.tenantId, defaultWeeklyMinutes },
            select: { defaultWeeklyMinutes: true, version: true },
        });
    }

    /** One `updateMany` naming the version read: 0 rows when it moved. */
    static async updateSettingsVersioned(db: PrismaTx, ctx: Ctx, version: number, defaultWeeklyMinutes: number): Promise<number> {
        const r = await db.tenantWorkloadSettings.updateMany({
            where: { tenantId: ctx.tenantId, version },
            data: { defaultWeeklyMinutes, version: { increment: 1 } },
        });
        return r.count;
    }

    // ─── Capacity rows ──────────────────────────────────────────────

    /** One person's rows, newest first. */
    static async historyOf(db: PrismaTx, ctx: Ctx, userId: string): Promise<MemberCapacityRow[]> {
        return db.memberCapacity.findMany({
            where: { tenantId: ctx.tenantId, userId },
            orderBy: { effectiveFrom: 'desc' },
            take: CAPACITY_HISTORY_TAKE,
            select: memberCapacitySelect,
        });
    }

    /** The rows of several people (the Workload page and Settings → Workload), at most `take`. */
    static async rowsOf(db: PrismaTx, ctx: Ctx, userIds: readonly string[], take: number): Promise<MemberCapacityRow[]> {
        if (userIds.length === 0) return [];
        return db.memberCapacity.findMany({
            where: { tenantId: ctx.tenantId, userId: { in: [...userIds] } },
            orderBy: [{ userId: 'asc' }, { effectiveFrom: 'asc' }],
            take,
            select: memberCapacitySelect,
        });
    }

    static async findForMonday(db: PrismaTx, ctx: Ctx, userId: string, effectiveFrom: Date): Promise<MemberCapacityRow | null> {
        return db.memberCapacity.findUnique({
            where: { tenantId_userId_effectiveFrom: { tenantId: ctx.tenantId, userId, effectiveFrom } },
            select: memberCapacitySelect,
        });
    }

    static async findById(db: PrismaTx, ctx: Ctx, userId: string, id: string): Promise<MemberCapacityRow | null> {
        return db.memberCapacity.findFirst({ where: { tenantId: ctx.tenantId, userId, id }, select: memberCapacitySelect });
    }

    static async create(
        db: PrismaTx,
        ctx: Ctx,
        data: { userId: string; effectiveFrom: Date; weeklyMinutes: number; calendarTeamId: string | null; createdByUserId: string },
    ): Promise<MemberCapacityRow> {
        return db.memberCapacity.create({ data: { tenantId: ctx.tenantId, ...data }, select: memberCapacitySelect });
    }

    /** Replace one row's hours and calendar, naming the version read: 0 rows when it moved. */
    static async updateVersioned(db: PrismaTx, ctx: Ctx, id: string, version: number, data: { weeklyMinutes: number; calendarTeamId: string | null }): Promise<number> {
        const r = await db.memberCapacity.updateMany({
            where: { tenantId: ctx.tenantId, id, version },
            data: { ...data, version: { increment: 1 } },
        });
        return r.count;
    }

    static async deleteVersioned(db: PrismaTx, ctx: Ctx, id: string, version: number): Promise<number> {
        const r = await db.memberCapacity.deleteMany({ where: { tenantId: ctx.tenantId, id, version } });
        return r.count;
    }

    // ─── People ─────────────────────────────────────────────────────

    /**
     * The people of the Workload page (3.5a): ACTIVE members of every role but
     * GUEST (decision 204), oldest membership first, at most `take` (the caller
     * reads one past its limit and refuses above). `userIds` narrows them.
     */
    static async activePeople(db: PrismaTx, ctx: Ctx, take: number, userIds?: readonly string[]): Promise<WorkloadPersonRecord[]> {
        const rows = await db.tenantMembership.findMany({
            where: { tenantId: ctx.tenantId, status: 'ACTIVE', role: { not: 'GUEST' }, ...(userIds ? { userId: { in: [...userIds] } } : {}) },
            orderBy: { createdAt: 'asc' },
            take,
            select: { userId: true, user: { select: { name: true } } },
        });
        return rows.map((r) => ({ userId: r.userId, name: r.user.name, active: true }));
    }

    /**
     * The people of the Workload page in one read (3.5b): the ACTIVE members of
     * every role but GUEST (decision 204), narrowed to `userIds` when given,
     * and the DEACTIVATED members among `holders` (those who still hold open
     * work: rows with no capacity, so their work shows as over and can be
     * handed on, ADR 0003 §1). Oldest membership first, at most `take` (the
     * caller reads one past its limit of active people and refuses above).
     */
    static async people(db: PrismaTx, ctx: Ctx, query: { take: number; userIds?: readonly string[]; holders: readonly string[] }): Promise<WorkloadPersonRecord[]> {
        const active: Prisma.TenantMembershipWhereInput = { status: 'ACTIVE', ...(query.userIds ? { userId: { in: [...query.userIds] } } : {}) };
        const rows = await db.tenantMembership.findMany({
            where: {
                tenantId: ctx.tenantId,
                role: { not: 'GUEST' },
                OR: query.holders.length > 0 ? [active, { status: 'DEACTIVATED', userId: { in: [...query.holders] } }] : [active],
            },
            orderBy: { createdAt: 'asc' },
            take: query.take,
            select: { userId: true, status: true, user: { select: { name: true } } },
        });
        return rows.map((r) => ({ userId: r.userId, name: r.user.name, active: r.status === 'ACTIVE' }));
    }

    /**
     * Everything capacity is read from for several people, in ONE statement
     * (3.5b): the workspace's default, the people's capacity rows, and their
     * time-off dates in `[from, to]` with the hours off (never a type: the
     * column is not read). Each part bounded by its own `LIMIT`.
     */
    static async capacityInputs(
        db: PrismaTx,
        ctx: Ctx,
        query: { userIds: readonly string[]; from: string; to: string; rowsTake: number; timeOffTake: number },
    ): Promise<CapacityInputs> {
        const t = ctx.tenantId;
        const ids = [...query.userIds];
        const rows = await db.$queryRaw<Array<{ part: string; userId: string | null; day: string | null; minutes: number | null; teamId: string | null }>>(Prisma.sql`
            (SELECT 's' AS "part", NULL::text AS "userId", NULL::text AS "day", s."defaultWeeklyMinutes" AS "minutes", NULL::text AS "teamId"
               FROM "TenantWorkloadSettings" s WHERE s."tenantId" = ${t})
            UNION ALL
            (SELECT 'c', c."userId", to_char(c."effectiveFrom", 'YYYY-MM-DD'), c."weeklyMinutes", c."calendarTeamId"
               FROM "MemberCapacity" c
              WHERE c."tenantId" = ${t} AND c."userId" = ANY(${ids}::text[])
              ORDER BY c."userId", c."effectiveFrom"
              LIMIT ${query.rowsTake})
            UNION ALL
            (SELECT 'o', o."userId", to_char(o."day", 'YYYY-MM-DD'), o."minutes", NULL::text
               FROM "TimeOff" o
              WHERE o."tenantId" = ${t} AND o."userId" = ANY(${ids}::text[]) AND o."day" BETWEEN ${query.from}::date AND ${query.to}::date
              ORDER BY o."userId", o."day"
              LIMIT ${query.timeOffTake})`);
        const out: CapacityInputs = { defaultWeeklyMinutes: null, rows: [], timeOff: [] };
        for (const r of rows) {
            if (r.part === 's') out.defaultWeeklyMinutes = r.minutes;
            else if (r.part === 'c') out.rows.push({ userId: r.userId!, effectiveFrom: r.day!, weeklyMinutes: r.minutes!, calendarTeamId: r.teamId });
            else out.timeOff.push({ userId: r.userId!, day: r.day!, minutes: r.minutes });
        }
        return out;
    }

    /** One person's membership in the workspace (any status but GUEST's is a person of the page). */
    static async personOf(db: PrismaTx, ctx: Ctx, userId: string): Promise<WorkloadPersonRecord | null> {
        const m = await db.tenantMembership.findUnique({
            where: { tenantId_userId: { tenantId: ctx.tenantId, userId } },
            select: { userId: true, status: true, role: true, user: { select: { name: true } } },
        });
        if (!m || m.role === 'GUEST') return null;
        return { userId: m.userId, name: m.user.name, active: m.status === 'ACTIVE' };
    }

    /** Whether `userId` holds a membership of the workspace that is not a GUEST's (any status). */
    static async isPerson(db: PrismaTx, ctx: Ctx, userId: string): Promise<boolean> {
        const m = await db.tenantMembership.findUnique({ where: { tenantId_userId: { tenantId: ctx.tenantId, userId } }, select: { role: true } });
        return m !== null && m.role !== 'GUEST';
    }

    /** Whether `teamId` is a team of the workspace (a capacity's calendar). */
    static async teamExists(db: PrismaTx, ctx: Ctx, teamId: string): Promise<boolean> {
        const t = await db.team.findFirst({ where: { tenantId: ctx.tenantId, id: teamId }, select: { id: true } });
        return t !== null;
    }

    /** The workspace's teams by name, for the capacity dialog's calendar picker (bounded). */
    static async teams(db: PrismaTx, ctx: Ctx, take: number): Promise<{ id: string; name: string }[]> {
        return db.team.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' }, take, select: { id: true, name: true } });
    }
}
