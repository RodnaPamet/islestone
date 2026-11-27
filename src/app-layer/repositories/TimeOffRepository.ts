/**
 * Time off (sub-phase 3.5a; docs/porting/maps/3.5.md, "Time off (3.5a)" and
 * "The type, held apart"; ADR 0013 §2 and §3; owner decisions 286, 287 and
 * 303). Every query filters by `tenantId` (RLS also scopes it) and reads
 * `TimeOff_tenantId_userId_day_key`. The only caller that writes is
 * `usecases/time-off.ts`.
 *
 * The type is held apart: it is selected ONLY by `listDays` when its caller
 * says the reader may see it (`withType`), so every other read never decrypts
 * it (`tests/unit/repositories/time-off-repository-predicates.test.ts` holds
 * the select lists). A write pads the code to one width before the encryption
 * extension sees it (`padTimeOffType`); a read trims it (`unpadTimeOffType`).
 *
 * Written fresh for Islestone.
 */
import type { Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import { padTimeOffType, unpadTimeOffType, type TimeOffType } from '@/lib/workload/time-off';
import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId'>;

/** Every column a time-off read may return, BUT the type. */
export const timeOffDaySelect = {
    id: true,
    userId: true,
    day: true,
    minutes: true,
    version: true,
    updatedByUserId: true,
} satisfies Prisma.TimeOffSelect;

export type TimeOffDayRow = Prisma.TimeOffGetPayload<{ select: typeof timeOffDaySelect }>;
export type TimeOffDayRowWithType = TimeOffDayRow & { type: TimeOffType };

/** A date's hours for capacity: the workload read selects these and nothing more. */
export const timeOffHoursSelect = { userId: true, day: true, minutes: true } satisfies Prisma.TimeOffSelect;
export type TimeOffHoursRow = Prisma.TimeOffGetPayload<{ select: typeof timeOffHoursSelect }>;

export class TimeOffRepository {
    /** The advisory lock every write of one person's time off takes FIRST. */
    static async lockPerson(db: PrismaTx, ctx: Ctx, userId: string): Promise<void> {
        await db.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `time-off:${ctx.tenantId}:${userId}`);
    }

    /**
     * One person's dates in `[from, to]`, ascending, at most `take`. The type
     * is selected and decrypted only when `withType` (the reader is the person
     * or a holder of `workload.manage`).
     */
    static async listDays(db: PrismaTx, ctx: Ctx, userId: string, from: Date, to: Date, take: number, withType: true): Promise<TimeOffDayRowWithType[]>;
    static async listDays(db: PrismaTx, ctx: Ctx, userId: string, from: Date, to: Date, take: number, withType: false): Promise<TimeOffDayRow[]>;
    static async listDays(db: PrismaTx, ctx: Ctx, userId: string, from: Date, to: Date, take: number, withType: boolean): Promise<TimeOffDayRow[] | TimeOffDayRowWithType[]> {
        const where = { tenantId: ctx.tenantId, userId, day: { gte: from, lte: to } };
        if (!withType) return db.timeOff.findMany({ where, orderBy: { day: 'asc' }, take, select: timeOffDaySelect });
        const rows = await db.timeOff.findMany({ where, orderBy: { day: 'asc' }, take, select: { ...timeOffDaySelect, type: true } });
        return rows.map((r) => ({ ...r, type: unpadTimeOffType(r.type) }));
    }

    /** The dates a write names, with their versions; never the type. */
    static async daysOf(db: PrismaTx, ctx: Ctx, userId: string, days: readonly Date[]): Promise<TimeOffDayRow[]> {
        if (days.length === 0) return [];
        return db.timeOff.findMany({
            where: { tenantId: ctx.tenantId, userId, day: { in: [...days] } },
            orderBy: { day: 'asc' },
            take: days.length,
            select: timeOffDaySelect,
        });
    }

    /** The hours off of several people in `[from, to]` (capacity), at most `take`; never the type. */
    static async daysForPeople(db: PrismaTx, ctx: Ctx, userIds: readonly string[], from: Date, to: Date, take: number): Promise<TimeOffHoursRow[]> {
        if (userIds.length === 0) return [];
        return db.timeOff.findMany({
            where: { tenantId: ctx.tenantId, userId: { in: [...userIds] }, day: { gte: from, lte: to } },
            orderBy: [{ userId: 'asc' }, { day: 'asc' }],
            take,
            select: timeOffHoursSelect,
        });
    }

    static async insertMany(
        db: PrismaTx,
        ctx: Ctx,
        rows: readonly { userId: string; day: Date; minutes: number | null; type: TimeOffType; actorUserId: string }[],
    ): Promise<void> {
        if (rows.length === 0) return;
        await db.timeOff.createMany({
            data: rows.map((r) => ({
                tenantId: ctx.tenantId,
                userId: r.userId,
                day: r.day,
                minutes: r.minutes,
                type: padTimeOffType(r.type),
                createdByUserId: r.actorUserId,
                updatedByUserId: r.actorUserId,
            })),
        });
    }

    /** Replace one date's hours and type, naming the version read: 0 rows when it moved. */
    static async replaceDay(db: PrismaTx, ctx: Ctx, id: string, version: number, data: { minutes: number | null; type: TimeOffType; actorUserId: string }): Promise<number> {
        const r = await db.timeOff.updateMany({
            where: { tenantId: ctx.tenantId, id, version },
            data: { minutes: data.minutes, type: padTimeOffType(data.type), updatedByUserId: data.actorUserId, version: { increment: 1 } },
        });
        return r.count;
    }

    static async deleteDay(db: PrismaTx, ctx: Ctx, id: string, version: number): Promise<number> {
        const r = await db.timeOff.deleteMany({ where: { tenantId: ctx.tenantId, id, version } });
        return r.count;
    }
}
