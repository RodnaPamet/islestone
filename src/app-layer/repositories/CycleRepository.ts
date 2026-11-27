/**
 * Cycles and cycle schedules (sub-phase 2.5a,
 * docs/porting/maps/2.5.md). Every query filters by `tenantId` (RLS also
 * scopes it). The `WorkItem` reads and writes cycles need live in
 * `WorkItemRepository`, beside its other predicates.
 *
 * Written fresh for Islestone.
 */
import type { CycleRollover, Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId'>;

/** The cycles one read returns: far beyond a team's real history on one page. */
export const CYCLE_LIST_TAKE = 500;
/** The teams the rollover reads per workspace. */
export const ROLLOVER_TEAMS_TAKE = 500;

export const cycleSelect = {
    id: true,
    teamId: true,
    number: true,
    name: true,
    startsOn: true,
    endsOn: true,
    fromSchedule: true,
    completedAt: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.CycleSelect;

export type CycleRow = Prisma.CycleGetPayload<{ select: typeof cycleSelect }>;

export const scheduleSelect = {
    id: true,
    teamId: true,
    enabled: true,
    lengthWeeks: true,
    firstStartsOn: true,
    upcomingCount: true,
    rollover: true,
    updatedAt: true,
} satisfies Prisma.CycleScheduleSelect;

export type CycleScheduleRow = Prisma.CycleScheduleGetPayload<{ select: typeof scheduleSelect }>;


export class CycleRepository {
    /**
     * Serialise every write to one team's cycles (numbering, the overlap
     * check, the schedule's fill, a rollover). Taken first in the transaction.
     */
    static async lockTeamCycles(db: PrismaTx, teamId: string): Promise<void> {
        await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cycle-team:${teamId}`}))`;
    }

    static async list(db: PrismaTx, ctx: Ctx, filter: { teamId?: string } = {}): Promise<CycleRow[]> {
        return db.cycle.findMany({
            where: { tenantId: ctx.tenantId, ...(filter.teamId ? { teamId: filter.teamId } : {}) },
            orderBy: [{ startsOn: 'desc' }, { id: 'asc' }],
            take: CYCLE_LIST_TAKE,
            select: cycleSelect,
        });
    }

    static async getById(db: PrismaTx, ctx: Ctx, id: string): Promise<CycleRow | null> {
        return db.cycle.findFirst({ where: { id, tenantId: ctx.tenantId }, select: cycleSelect });
    }

    /** A team's cycles that are not completed, in date order (the rollover's and the schedule's view). */
    static async openForTeam(db: PrismaTx, ctx: Ctx, teamId: string): Promise<CycleRow[]> {
        return db.cycle.findMany({
            where: { tenantId: ctx.tenantId, teamId, completedAt: null },
            orderBy: [{ startsOn: 'asc' }, { id: 'asc' }],
            take: CYCLE_LIST_TAKE,
            select: cycleSelect,
        });
    }

    /** Every cycle of a team that ends on or after `from` (the overlap check's candidates). */
    static async endingOnOrAfter(db: PrismaTx, ctx: Ctx, teamId: string, from: Date): Promise<CycleRow[]> {
        return db.cycle.findMany({
            where: { tenantId: ctx.tenantId, teamId, endsOn: { gte: from } },
            orderBy: [{ startsOn: 'asc' }, { id: 'asc' }],
            take: CYCLE_LIST_TAKE,
            select: cycleSelect,
        });
    }

    /** Cycles that overlap `[startsOn, endsOn]`, other than `exceptId`. */
    static async overlapping(db: PrismaTx, ctx: Ctx, teamId: string, startsOn: Date, endsOn: Date, exceptId?: string): Promise<CycleRow[]> {
        return db.cycle.findMany({
            where: {
                tenantId: ctx.tenantId,
                teamId,
                startsOn: { lte: endsOn },
                endsOn: { gte: startsOn },
                ...(exceptId ? { id: { not: exceptId } } : {}),
            },
            orderBy: [{ startsOn: 'asc' }, { id: 'asc' }],
            take: 10,
            select: cycleSelect,
        });
    }

    /**
     * The cycles overlapping `[from, to]` (the calendar's bands, 3.3a): of the
     * named teams, or the named cycles; by start, then id; at most `take`.
     */
    static async inWindow(db: PrismaTx, ctx: Ctx, scope: { teamIds?: readonly string[]; ids?: readonly string[] }, from: Date, to: Date, take: number): Promise<CycleRow[]> {
        const byScope: Prisma.CycleWhereInput = scope.ids ? { id: { in: [...scope.ids] } } : { teamId: { in: [...(scope.teamIds ?? [])] } };
        if ((scope.ids ?? scope.teamIds ?? []).length === 0) return [];
        return db.cycle.findMany({
            where: { tenantId: ctx.tenantId, ...byScope, startsOn: { lte: to }, endsOn: { gte: from } },
            orderBy: [{ startsOn: 'asc' }, { id: 'asc' }],
            take,
            select: cycleSelect,
        });
    }

    static async nextNumber(db: PrismaTx, ctx: Ctx, teamId: string): Promise<number> {
        const top = await db.cycle.findFirst({
            where: { tenantId: ctx.tenantId, teamId },
            orderBy: { number: 'desc' },
            select: { number: true },
        });
        return (top?.number ?? 0) + 1;
    }

    static async create(
        db: PrismaTx,
        ctx: Ctx,
        data: { teamId: string; number: number; name: string | null; startsOn: Date; endsOn: Date; fromSchedule: boolean },
    ): Promise<CycleRow> {
        return db.cycle.create({ data: { tenantId: ctx.tenantId, ...data }, select: cycleSelect });
    }

    static async update(
        db: PrismaTx,
        ctx: Ctx,
        id: string,
        data: Partial<{ name: string | null; startsOn: Date; endsOn: Date; fromSchedule: boolean }>,
    ): Promise<number> {
        const r = await db.cycle.updateMany({ where: { id, tenantId: ctx.tenantId, completedAt: null }, data });
        return r.count;
    }

    static async delete(db: PrismaTx, ctx: Ctx, id: string): Promise<number> {
        const r = await db.cycle.deleteMany({ where: { id, tenantId: ctx.tenantId, completedAt: null } });
        return r.count;
    }

    /**
     * Close a cycle, once: the conditional update is the rollover's claim, so
     * a second run (or a concurrent one) finds nothing to close.
     */
    static async claimClose(db: PrismaTx, ctx: Ctx, id: string, at: Date): Promise<boolean> {
        const r = await db.cycle.updateMany({ where: { id, tenantId: ctx.tenantId, completedAt: null }, data: { completedAt: at } });
        return r.count === 1;
    }

    /** Open cycles of the workspace whose last day is before `today`, oldest first. */
    static async endedOpen(db: PrismaTx, ctx: Ctx, today: Date): Promise<CycleRow[]> {
        return db.cycle.findMany({
            where: { tenantId: ctx.tenantId, completedAt: null, endsOn: { lt: today } },
            orderBy: [{ endsOn: 'asc' }, { id: 'asc' }],
            take: CYCLE_LIST_TAKE,
            select: cycleSelect,
        });
    }

    // ── Schedules ────────────────────────────────────────────────────

    static async getSchedule(db: PrismaTx, ctx: Ctx, teamId: string): Promise<CycleScheduleRow | null> {
        return db.cycleSchedule.findFirst({ where: { tenantId: ctx.tenantId, teamId }, select: scheduleSelect });
    }

    static async listSchedules(db: PrismaTx, ctx: Ctx): Promise<CycleScheduleRow[]> {
        return db.cycleSchedule.findMany({
            where: { tenantId: ctx.tenantId },
            orderBy: { teamId: 'asc' },
            take: ROLLOVER_TEAMS_TAKE,
            select: scheduleSelect,
        });
    }

    static async upsertSchedule(
        db: PrismaTx,
        ctx: Ctx,
        teamId: string,
        data: { enabled: boolean; lengthWeeks: number; firstStartsOn: Date; upcomingCount: number; rollover: CycleRollover },
    ): Promise<CycleScheduleRow> {
        return db.cycleSchedule.upsert({
            where: { teamId_tenantId: { teamId, tenantId: ctx.tenantId } },
            create: { tenantId: ctx.tenantId, teamId, ...data },
            update: data,
            select: scheduleSelect,
        });
    }
}
