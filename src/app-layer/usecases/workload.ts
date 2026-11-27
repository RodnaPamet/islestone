/**
 * The Workload page's read (sub-phase 3.5a: capacity only; docs/porting/maps/
 * 3.5.md, "The read" and "Split"; ADR 0013 §1; owner decisions 284 to 286,
 * 297 and 298). 3.5b adds allocation, the over-capacity flags and the row
 * figures to the same route.
 *
 * `GET /workload?from&weeks&userId` (`workload.view`): `from` a Monday not
 * before the current week (400 `WORKLOAD_RANGE`), the current week when
 * absent; at most 26 weeks; the people are the ACTIVE members of every role
 * but GUEST (decision 204), or the one named (`me` the caller), at most 500,
 * read one past and refused 422 `WORKLOAD_TOO_LARGE`, never cut. Per person and
 * week: the capacity, the weekly hours in force, the minutes time off removed
 * and the dates carrying time off. Never a type (the time-off read selects
 * none), never stored, audited or logged per person.
 *
 * Capacity is computed by the pure `domain/workload/capacity.ts` over the
 * calendars `resolveWorkingCalendars` gives (ADR 0010: the one read of
 * calendars for arithmetic).
 *
 * Written fresh for Islestone.
 */
import { assertCanViewWorkload } from '../policies/workload.policies';
import { TimeOffRepository } from '../repositories/TimeOffRepository';
import { WorkloadRepository } from '../repositories/WorkloadRepository';
import type { RequestContext } from '../types';
import { fromEpochDay, isoWeekday, toEpochDay } from '../domain/schedule/calendar';
import { capacityByWeek, type CapacityRowSpec, type TimeOffDaySpec } from '../domain/workload/capacity';
import { DEFAULT_WEEKLY_MINUTES } from './workload-capacity';
import { workspaceToday } from './workload-shared';
import { resolveWorkingCalendars } from './working-calendar';
import { runInTenantReadContext } from '@/lib/db-context';
import { AppError, badRequest } from '@/lib/errors/types';
import { dateOnlyValue } from '@/lib/time/week';
import { WORKLOAD_LIMITS } from '@/lib/workload/time-off';
import type { WorkloadData } from '@/lib/workload/types';

/** The most capacity rows and time-off dates one read takes (500 people, 26 weeks). */
const CAPACITY_ROWS_TAKE = 20_000;
const TIME_OFF_ROWS_TAKE = 100_000;

export interface WorkloadQuery {
    from?: string;
    weeks?: number;
    userId?: string;
}

export async function getWorkload(ctx: RequestContext, query: WorkloadQuery): Promise<WorkloadData> {
    assertCanViewWorkload(ctx);
    const weekCount = query.weeks ?? WORKLOAD_LIMITS.weeksDefault;
    if (weekCount < 1 || weekCount > WORKLOAD_LIMITS.weeksMax) throw badRequest(`A workload read covers 1 to ${WORKLOAD_LIMITS.weeksMax} weeks.`, { reason: 'WORKLOAD_RANGE' });
    const only = query.userId === 'me' ? ctx.userId : query.userId;

    return runInTenantReadContext(ctx, async (db) => {
        const { today, currentWeek, timeZone } = await workspaceToday(db, ctx);
        const from = query.from ? toEpochDay(query.from) : currentWeek;
        if (isoWeekday(from) !== 1 || from < currentWeek) {
            throw badRequest('A workload read starts on a Monday, from the current week on.', { reason: 'WORKLOAD_RANGE' });
        }
        const weeks = Array.from({ length: weekCount }, (_, i) => from + 7 * i);
        const lastDay = from + 7 * weekCount - 1;

        const people = await WorkloadRepository.activePeople(db, ctx, WORKLOAD_LIMITS.personLimit + 1, only ? [only] : undefined);
        if (people.length > WORKLOAD_LIMITS.personLimit) {
            throw new AppError(`Workload shows at most ${WORKLOAD_LIMITS.personLimit} people; narrow it.`, 'WORKLOAD_TOO_LARGE', 422, true, {
                reason: 'WORKLOAD_TOO_LARGE',
                limit: WORKLOAD_LIMITS.personLimit,
            });
        }
        const ids = people.map((p) => p.userId);
        const settings = await WorkloadRepository.getSettings(db, ctx);
        const rows = await WorkloadRepository.rowsOf(db, ctx, ids, CAPACITY_ROWS_TAKE);
        const offRows = await TimeOffRepository.daysForPeople(db, ctx, ids, dateOnlyValue(fromEpochDay(from)), dateOnlyValue(fromEpochDay(lastDay)), TIME_OFF_ROWS_TAKE);
        const teamIds = [...new Set(rows.map((r) => r.calendarTeamId).filter((t): t is string => t !== null))];
        const calendars = await resolveWorkingCalendars(db, ctx, teamIds);

        const rowsBy = new Map<string, CapacityRowSpec[]>();
        for (const r of rows) {
            const list = rowsBy.get(r.userId) ?? [];
            list.push({ effectiveFrom: toEpochDay(r.effectiveFrom), weeklyMinutes: r.weeklyMinutes, calendarTeamId: r.calendarTeamId });
            rowsBy.set(r.userId, list);
        }
        const offBy = new Map<string, TimeOffDaySpec[]>();
        for (const r of offRows) {
            const list = offBy.get(r.userId) ?? [];
            list.push({ day: toEpochDay(r.day), minutes: r.minutes });
            offBy.set(r.userId, list);
        }
        const capacityCtx = {
            defaultWeeklyMinutes: settings?.defaultWeeklyMinutes ?? DEFAULT_WEEKLY_MINUTES,
            calendarFor: (teamId: string | null) => calendars.forTeam(teamId).compiled,
        };

        return {
            weeks: weeks.map(fromEpochDay),
            today: fromEpochDay(today),
            timeZone,
            people: people.map((p) => {
                const byWeek = capacityByWeek({ active: p.active, rows: rowsBy.get(p.userId) ?? [], timeOff: offBy.get(p.userId) ?? [] }, weeks, capacityCtx);
                return {
                    userId: p.userId,
                    name: p.name,
                    active: p.active,
                    capacity: byWeek.map((w) => w.capacityMinutes),
                    weeklyMinutes: byWeek.map((w) => w.weeklyMinutes),
                    timeOffMinutes: byWeek.map((w) => w.timeOffMinutes),
                    timeOffDays: byWeek.map((w) => w.timeOffDays.map(fromEpochDay)),
                };
            }),
        };
    });
}

/** Today in the workspace calendar's zone (`workload.view`): the date the Workload page opens on. */
export async function getWorkloadToday(ctx: RequestContext): Promise<string> {
    assertCanViewWorkload(ctx);
    return runInTenantReadContext(ctx, async (db) => fromEpochDay((await workspaceToday(db, ctx)).today));
}
