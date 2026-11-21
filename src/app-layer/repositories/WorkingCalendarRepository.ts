/**
 * Working calendars and their holidays (roadmap 3.1a; ADR 0010 §5; owner
 * decisions 189 to 193). Every query filters by `tenantId` (RLS also scopes
 * it).
 *
 * What the database holds besides (migration `20261212120000_working_calendars`):
 * one workspace calendar and one calendar per team (partial uniques), the
 * weekdays a non-empty ascending set of 1 to 7, the names' lengths. Changes
 * to a workspace's calendars serialise on one advisory lock
 * (`lockWorkspaceCalendars`), so a first save and a holiday added at once
 * cannot both create the row.
 *
 * Written fresh for Islestone.
 */
import type { Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import { WORKING_CALENDAR_LIMITS } from '@/lib/scheduling/working-calendar';
import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId'>;

/** Calendars a workspace holds: its own and one per team, far above any workspace's teams. */
const CALENDARS_TAKE = 1000;

export const workingCalendarSelect = {
    id: true,
    teamId: true,
    name: true,
    timeZone: true,
    workingWeekdays: true,
    version: true,
    holidays: {
        select: { id: true, day: true, name: true },
        orderBy: [{ day: 'asc' }, { id: 'asc' }],
        take: WORKING_CALENDAR_LIMITS.holidaysPerCalendar,
    },
} satisfies Prisma.WorkingCalendarSelect;

export type WorkingCalendarRow = Prisma.WorkingCalendarGetPayload<{ select: typeof workingCalendarSelect }>;

export class WorkingCalendarRepository {
    /** Serialise every change to this workspace's calendars (taken first in each write). */
    static async lockWorkspaceCalendars(db: PrismaTx, ctx: Ctx): Promise<void> {
        await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`working-calendar:${ctx.tenantId}`}))`;
    }

    /** Every calendar of the workspace with its holidays (the workspace's has `teamId` NULL). */
    static async listAll(db: PrismaTx, ctx: Ctx): Promise<WorkingCalendarRow[]> {
        return db.workingCalendar.findMany({
            where: { tenantId: ctx.tenantId },
            orderBy: [{ teamId: 'asc' }, { id: 'asc' }],
            take: CALENDARS_TAKE,
            select: workingCalendarSelect,
        });
    }

    /** The workspace's calendar and the named teams' (each with its holidays). */
    static async listForTeams(db: PrismaTx, ctx: Ctx, teamIds: readonly string[]): Promise<WorkingCalendarRow[]> {
        return db.workingCalendar.findMany({
            where: { tenantId: ctx.tenantId, OR: [{ teamId: null }, ...(teamIds.length > 0 ? [{ teamId: { in: [...teamIds] } }] : [])] },
            orderBy: [{ teamId: 'asc' }, { id: 'asc' }],
            take: CALENDARS_TAKE,
            select: workingCalendarSelect,
        });
    }

    /** The workspace's calendar (`teamId` null) or a team's. */
    static async get(db: PrismaTx, ctx: Ctx, teamId: string | null): Promise<WorkingCalendarRow | null> {
        return db.workingCalendar.findFirst({ where: { tenantId: ctx.tenantId, teamId }, select: workingCalendarSelect });
    }

    /** Which teams have their own calendar. */
    static async teamCalendarIds(db: PrismaTx, ctx: Ctx): Promise<Array<{ id: string; teamId: string | null }>> {
        return db.workingCalendar.findMany({
            where: { tenantId: ctx.tenantId, teamId: { not: null } },
            orderBy: { id: 'asc' },
            take: CALENDARS_TAKE,
            select: { id: true, teamId: true },
        });
    }

    static async create(
        db: PrismaTx,
        ctx: Ctx,
        data: { teamId: string | null; name: string; timeZone: string; workingWeekdays: number[] },
    ): Promise<WorkingCalendarRow> {
        return db.workingCalendar.create({ data: { tenantId: ctx.tenantId, ...data }, select: workingCalendarSelect });
    }

    static async update(db: PrismaTx, ctx: Ctx, id: string, data: { name?: string; timeZone?: string; workingWeekdays?: number[] }): Promise<number> {
        const r = await db.workingCalendar.updateMany({ where: { id, tenantId: ctx.tenantId }, data: { ...data, version: { increment: 1 } } });
        return r.count;
    }

    /** A holiday change is a change of the calendar: its version moves. */
    static async touch(db: PrismaTx, ctx: Ctx, id: string): Promise<void> {
        await db.workingCalendar.updateMany({ where: { id, tenantId: ctx.tenantId }, data: { version: { increment: 1 } } });
    }

    static async remove(db: PrismaTx, ctx: Ctx, id: string): Promise<number> {
        const r = await db.workingCalendar.deleteMany({ where: { id, tenantId: ctx.tenantId } });
        return r.count;
    }

    /** Add holidays; a date the calendar already has is skipped (the unique `(calendarId, day)`). */
    static async addHolidays(db: PrismaTx, ctx: Ctx, calendarId: string, holidays: ReadonlyArray<{ day: Date; name: string }>): Promise<number> {
        const r = await db.workingCalendarHoliday.createMany({
            data: holidays.map((h) => ({ tenantId: ctx.tenantId, calendarId, day: h.day, name: h.name })),
            skipDuplicates: true,
        });
        return r.count;
    }

    static async getHoliday(db: PrismaTx, ctx: Ctx, calendarId: string, holidayId: string) {
        return db.workingCalendarHoliday.findFirst({ where: { id: holidayId, calendarId, tenantId: ctx.tenantId }, select: { id: true, day: true, name: true } });
    }

    static async removeHoliday(db: PrismaTx, ctx: Ctx, calendarId: string, holidayId: string): Promise<number> {
        const r = await db.workingCalendarHoliday.deleteMany({ where: { id: holidayId, calendarId, tenantId: ctx.tenantId } });
        return r.count;
    }

    /** True when the database knows the IANA zone too (a calendar's zone is read back by both). */
    static async isKnownTimeZone(db: PrismaTx, timeZone: string): Promise<boolean> {
        const rows = await db.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok FROM pg_timezone_names WHERE "name" = ${timeZone} LIMIT 1`;
        return rows.length > 0;
    }
}
