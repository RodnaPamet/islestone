/**
 * Time off (sub-phase 3.5a; docs/porting/maps/3.5.md, "Time off (3.5a)", "The
 * type, held apart" and "Who records it"; ADR 0013 §2 and §3; owner decisions
 * 286 to 289, 298, 300 and 303). The only module that writes `TimeOff`.
 *
 *   - **One row per person and date** (decision 286): hours off (1 to 1,439
 *     minutes) or the whole day (NULL), with a type, VACATION, SICK or OTHER.
 *     A range typed in the browser arrives as its dates; each date may then be
 *     changed or removed on its own. A date already holding time off is
 *     replaced, naming the version the browser read.
 *   - **Who** (decision 288): the person (`workload.time_off`), or a holder of
 *     `workload.manage` for anyone (refused past the route's key with an
 *     audited 403 `WORKLOAD_MANAGE_REQUIRED`). Nobody approves it. A signed-in
 *     person only, never an API key, an agent or a job (`NOT_A_PERSON`).
 *   - **The type is held apart** (decision 287): read only for the person and
 *     holders of `workload.manage` (`mayReadTimeOffType`; the key is absent for
 *     everyone else), never audited, logged or notified: `TIME_OFF_SET` and
 *     `TIME_OFF_REMOVED` carry dates and hours only, and the bell names who and
 *     the dates.
 *   - **Locks.** Every write takes the person's advisory lock
 *     (`time-off:<workspace>:<person>`) FIRST, then the membership `FOR KEY
 *     SHARE` (decision 280's order; a person who is gone is a 400), then reads
 *     the dates it names; every date it changes carries the version the
 *     browser read (none for a new date), and one mismatch refuses the whole
 *     write, 409 `VERSION_CONFLICT` naming the dates.
 *   - **Kept for the workspace's life** (decision 289): no job deletes time
 *     off; a removed member's goes with the membership (its cascading key).
 *   - **The bell** (decision 300): after the commit, when the writer is not the
 *     person, one `TIME_OFF_CHANGED_BY_OTHER`.
 *
 * Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import { createTimeOffChangedNotification } from '../notifications/time-off';
import { resolveTenantSlugForLinks, tenantPageLink } from '../notifications/tenant-link';
import { assertCanViewWorkload, mayManageWorkload, mayReadTimeOffType, mayRecordOwnTimeOff } from '../policies/workload.policies';
import { MembershipRepository } from '../repositories/MembershipRepository';
import { TimeOffRepository, type TimeOffDayRow, type TimeOffDayRowWithType } from '../repositories/TimeOffRepository';
import { WorkloadRepository } from '../repositories/WorkloadRepository';
import type { RequestContext } from '../types';
import { fromEpochDay, isoWeekday, isWorkingDay, toEpochDay, type IsoWeekday } from '../domain/schedule/calendar';
import { rowInForce } from '../domain/workload/capacity';
import { resolveWorkingCalendars, type WorkingCalendarSet } from './working-calendar';
import { assertWritesAsPerson, lockActivePerson, refuseManageRequired, todayOfCalendars } from './workload-shared';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext, runInTenantReadContext } from '@/lib/db-context';
import { AppError, ConflictError, badRequest, forbidden, notFound } from '@/lib/errors/types';
import { logger } from '@/lib/observability/logger';
import { dateKeyOf, dateOnlyValue } from '@/lib/time/week';
import { WORKLOAD_LIMITS, type TimeOffType } from '@/lib/workload/time-off';
import type { TimeOffData, TimeOffDayData, TimeOffWriteResult } from '@/lib/workload/types';

export interface TimeOffDayInput {
    day: string;
    minutes: number | null;
    type: TimeOffType;
    version?: number;
}

function toDayData(row: TimeOffDayRow | TimeOffDayRowWithType, withType: boolean): TimeOffDayData {
    const data: TimeOffDayData = {
        userId: row.userId,
        day: dateKeyOf(row.day),
        minutes: row.minutes,
        version: row.version,
        updatedByUserId: row.updatedByUserId,
    };
    // The key is ABSENT for a caller who may not see the type (decision 287), never null.
    if (withType && 'type' in row) data.type = row.type;
    return data;
}

/** The dates a refused write names, with what is stored now (hours and versions, never a type). */
function versionConflict(days: string[], current: readonly TimeOffDayRow[]): ConflictError {
    return new ConflictError(`Time off changed since you read it: ${days.join(', ')}.`, {
        reason: 'VERSION_CONFLICT',
        days,
        current: current.map((r) => toDayData(r, false)),
    });
}

/**
 * Whose time off a write is, and whether the caller may write it: one's own
 * under `workload.time_off`, another member's only with `workload.manage`
 * (audited past the route's key), always a signed-in person.
 */
async function writableTarget(ctx: RequestContext, userId: string | undefined, verb: string): Promise<string> {
    const target = userId ?? ctx.userId;
    if (target !== ctx.userId) {
        if (!mayManageWorkload(ctx)) await refuseManageRequired(ctx, target, verb);
    } else if (!mayRecordOwnTimeOff(ctx)) {
        throw forbidden('You do not have permission to record time off.');
    }
    await assertWritesAsPerson(ctx, 'TimeOff', verb);
    return target;
}

function assertDistinct(days: readonly string[]): void {
    if (new Set(days).size !== days.length) throw badRequest('Name each date once.', { reason: 'DUPLICATE_DAY' });
}

/** After the commit: the bell when someone else wrote the person's time off (decision 300). Never throws. */
async function ringIfOther(ctx: RequestContext, userId: string, change: 'set' | 'removed', days: readonly string[]): Promise<void> {
    if (userId === ctx.userId || days.length === 0) return;
    try {
        await runInTenantContext(ctx, async (db) => {
            const [actor] = await MembershipRepository.contactsOf(db, [ctx.userId]);
            const slug = await resolveTenantSlugForLinks(db, ctx);
            await createTimeOffChangedNotification(db, {
                tenantId: ctx.tenantId,
                userId,
                actorName: actor?.name?.trim() || 'Someone',
                change,
                days: [...days].sort(),
                linkUrl: tenantPageLink(slug, '/workload'),
                requestId: ctx.requestId,
            });
        });
    } catch (err) {
        // Ids and the error only: never a date list, an hour count or a type (Cal.diy study §7 row 14).
        logger.warn('failed to create time-off notification', { component: 'notifications', error: err instanceof Error ? err.message : String(err) });
    }
}

// ─── Reads ─────────────────────────────────────────────────────────

/** The person's calendar in force at `day`: the team named by their capacity row, else the workspace's. */
async function personCalendar(db: PrismaTx, ctx: RequestContext, calendars: WorkingCalendarSet, userId: string, day: number) {
    const rows = await WorkloadRepository.historyOf(db, ctx, userId);
    const row = rowInForce(
        rows.map((r) => ({ effectiveFrom: toEpochDay(r.effectiveFrom), weeklyMinutes: r.weeklyMinutes, calendarTeamId: r.calendarTeamId })),
        day,
    );
    return calendars.forTeam(row?.calendarTeamId ?? null);
}

export interface TimeOffWindowData extends TimeOffData {
    /** The person's working weekdays and the holidays in the window, for the dialog's preview of working days. */
    calendar: { workingWeekdays: IsoWeekday[]; holidays: string[] };
}

/** One person's time off in `[from, to]` (`workload.view`); the type only for the person and `workload.manage`. */
export async function listTimeOff(ctx: RequestContext, input: { from: string; to: string; userId?: string }): Promise<TimeOffWindowData> {
    assertCanViewWorkload(ctx);
    const userId = input.userId ?? ctx.userId;
    const from = toEpochDay(input.from);
    const to = toEpochDay(input.to);
    if (to < from || to - from + 1 > WORKLOAD_LIMITS.timeOffReadDays) {
        throw badRequest(`A time-off window is 1 to ${WORKLOAD_LIMITS.timeOffReadDays} days.`, { reason: 'TIME_OFF_RANGE' });
    }
    const withType = mayReadTimeOffType(ctx, userId);
    return runInTenantReadContext(ctx, async (db) => {
        const person = await WorkloadRepository.isPerson(db, ctx, userId);
        if (!person) throw notFound('Member not found');
        const take = WORKLOAD_LIMITS.timeOffReadRows + 1;
        const rows = withType
            ? await TimeOffRepository.listDays(db, ctx, userId, dateOnlyValue(input.from), dateOnlyValue(input.to), take, true)
            : await TimeOffRepository.listDays(db, ctx, userId, dateOnlyValue(input.from), dateOnlyValue(input.to), take, false);
        if (rows.length > WORKLOAD_LIMITS.timeOffReadRows) {
            throw new AppError(`This window holds more than ${WORKLOAD_LIMITS.timeOffReadRows} dates of time off.`, 'TIME_OFF_TOO_LARGE', 422, true, {
                reason: 'TIME_OFF_TOO_LARGE',
                limit: WORKLOAD_LIMITS.timeOffReadRows,
            });
        }
        // Every calendar of the workspace in one read (bounded): today's zone and the person's calendar.
        const calendars = await resolveWorkingCalendars(db, ctx);
        const { today } = todayOfCalendars(calendars);
        const cal = await personCalendar(db, ctx, calendars, userId, Math.max(today, from));
        const holidays: string[] = [];
        for (let d = from; d <= to; d += 1) if (cal.compiled.mask[isoWeekday(d)] === true && !isWorkingDay(cal.compiled, d)) holidays.push(fromEpochDay(d));
        return {
            userId,
            from: input.from,
            to: input.to,
            typeShown: withType,
            days: rows.map((r) => toDayData(r, withType)),
            calendar: { workingWeekdays: [...cal.spec.workingWeekdays], holidays },
        };
    });
}

// ─── Writes ────────────────────────────────────────────────────────

/** Record or replace dates of time off (one batch, all or nothing). */
export async function setTimeOffDays(ctx: RequestContext, input: { userId?: string; days: readonly TimeOffDayInput[] }): Promise<TimeOffWriteResult> {
    const userId = await writableTarget(ctx, input.userId, 'set_time_off');
    if (input.days.length === 0 || input.days.length > WORKLOAD_LIMITS.timeOffDaysPerWrite) {
        throw badRequest(`Set 1 to ${WORKLOAD_LIMITS.timeOffDaysPerWrite} dates at a time.`, { reason: 'TIME_OFF_RANGE' });
    }
    assertDistinct(input.days.map((d) => d.day));
    const result = await runInTenantContext(ctx, async (db) => {
        await TimeOffRepository.lockPerson(db, ctx, userId);
        await lockActivePerson(db, ctx, userId);
        const existing = await TimeOffRepository.daysOf(db, ctx, userId, input.days.map((d) => dateOnlyValue(d.day)));
        const byDay = new Map(existing.map((r) => [dateKeyOf(r.day), r] as const));
        const mismatched = input.days.filter((d) => {
            const row = byDay.get(d.day);
            return row ? d.version !== row.version : d.version !== undefined;
        });
        if (mismatched.length > 0) throw versionConflict(mismatched.map((d) => d.day).sort(), existing);

        const inserts = input.days.filter((d) => !byDay.has(d.day));
        await TimeOffRepository.insertMany(
            db,
            ctx,
            inserts.map((d) => ({ userId, day: dateOnlyValue(d.day), minutes: d.minutes, type: d.type, actorUserId: ctx.userId })),
        );
        for (const d of input.days) {
            const row = byDay.get(d.day);
            if (!row) continue;
            // guardrail-allow: n+1 — at most 366 dates of one person, each a versioned write under the person's lock.
            const count = await TimeOffRepository.replaceDay(db, ctx, row.id, row.version, { minutes: d.minutes, type: d.type, actorUserId: ctx.userId });
            if (count !== 1) throw versionConflict([d.day], existing);
        }
        const days = [...input.days].sort((a, b) => (a.day < b.day ? -1 : 1));
        await logEvent(db, ctx, {
            action: 'TIME_OFF_SET',
            entityType: 'TimeOff',
            entityId: userId,
            details: `Time off set on ${days.length} date${days.length === 1 ? '' : 's'}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'TimeOff', operation: inserts.length === days.length ? 'created' : 'updated', changedFields: ['minutes'] },
            // Dates and hours, NEVER a type (decision 287): minutes NULL is the whole day.
            metadata: {
                userId,
                actorIsPerson: userId === ctx.userId,
                days: days.map((d) => {
                    const before = byDay.get(d.day);
                    return { day: d.day, existed: before !== undefined, minutesBefore: before ? before.minutes : null, minutesAfter: d.minutes };
                }),
            },
        });
        const stored = await TimeOffRepository.listDays(db, ctx, userId, dateOnlyValue(days[0]!.day), dateOnlyValue(days[days.length - 1]!.day), WORKLOAD_LIMITS.timeOffReadRows, true);
        const named = new Set(days.map((d) => d.day));
        return { userId, days: stored.filter((r) => named.has(dateKeyOf(r.day))).map((r) => toDayData(r, true)), removed: [] };
    });
    await ringIfOther(ctx, userId, 'set', result.days.map((d) => d.day));
    return result;
}

/** Remove dates of time off for good (one batch, all or nothing; sent from the undo toast). */
export async function removeTimeOffDays(ctx: RequestContext, input: { userId?: string; days: readonly { day: string; version: number }[] }): Promise<TimeOffWriteResult> {
    const userId = await writableTarget(ctx, input.userId, 'remove_time_off');
    if (input.days.length === 0 || input.days.length > WORKLOAD_LIMITS.timeOffDaysPerWrite) {
        throw badRequest(`Remove 1 to ${WORKLOAD_LIMITS.timeOffDaysPerWrite} dates at a time.`, { reason: 'TIME_OFF_RANGE' });
    }
    assertDistinct(input.days.map((d) => d.day));
    const result = await runInTenantContext(ctx, async (db) => {
        await TimeOffRepository.lockPerson(db, ctx, userId);
        await lockActivePerson(db, ctx, userId);
        const existing = await TimeOffRepository.daysOf(db, ctx, userId, input.days.map((d) => dateOnlyValue(d.day)));
        const byDay = new Map(existing.map((r) => [dateKeyOf(r.day), r] as const));
        const mismatched = input.days.filter((d) => byDay.get(d.day)?.version !== d.version);
        if (mismatched.length > 0) throw versionConflict(mismatched.map((d) => d.day).sort(), existing);
        for (const d of input.days) {
            const row = byDay.get(d.day)!;
            // guardrail-allow: n+1 — at most 366 dates of one person, each a versioned delete under the person's lock.
            const count = await TimeOffRepository.deleteDay(db, ctx, row.id, row.version);
            if (count !== 1) throw versionConflict([d.day], existing);
        }
        const removed = input.days.map((d) => d.day).sort();
        await logEvent(db, ctx, {
            action: 'TIME_OFF_REMOVED',
            entityType: 'TimeOff',
            entityId: userId,
            details: `Time off removed on ${removed.length} date${removed.length === 1 ? '' : 's'}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'TimeOff', operation: 'deleted' },
            // Dates and hours, NEVER a type (decision 287).
            metadata: { userId, actorIsPerson: userId === ctx.userId, days: removed.map((day) => ({ day, minutes: byDay.get(day)!.minutes })) },
        });
        return { userId, days: [], removed };
    });
    await ringIfOther(ctx, userId, 'removed', result.removed);
    return result;
}
