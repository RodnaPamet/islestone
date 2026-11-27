/**
 * What the capacity, time-off and workload usecases share (sub-phase 3.5a;
 * docs/porting/maps/3.5.md; ADR 0013): the person-only refusal, the refusal
 * of another person's time off without `workload.manage`, the current week in
 * the workspace calendar's zone, and the lock on the person a write names.
 *
 * Written fresh for Islestone.
 */
import { NOT_A_PERSON } from '../policies/person-only.policies';
import { actsOnWorkloadAsPerson } from '../policies/workload.policies';
import { MembershipRepository } from '../repositories/MembershipRepository';
import type { RequestContext } from '../types';
import { fromEpochDay, todayIn, type EpochDay } from '../domain/schedule/calendar';
import { mondayOf } from '../domain/workload/capacity';
import { resolveWorkingCalendars, type WorkingCalendarSet } from './working-calendar';
import type { PrismaTx } from '@/lib/db-context';
import { appendAuditEntryOrQueue } from '@/lib/audit';
import { todayClock } from '@/lib/clock';
import { badRequest, forbidden } from '@/lib/errors/types';

/** 403 reason: another person's capacity or time off without `workload.manage`. */
export const WORKLOAD_MANAGE_REQUIRED = 'WORKLOAD_MANAGE_REQUIRED' as const;

async function auditRefusal(ctx: RequestContext, entity: string, entityId: string, details: string, reason: string, verb: string): Promise<void> {
    await appendAuditEntryOrQueue({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        actorType: ctx.apiKeyId ? 'API_KEY' : (ctx.actorType ?? 'USER'),
        entity,
        entityId,
        action: 'AUTHZ_DENIED',
        details,
        detailsJson: { category: 'access', event: 'authz_denied', reason, role: ctx.role },
        requestId: ctx.requestId,
        metadataJson: { role: ctx.role, verb, reason },
    });
}

/**
 * A write by anything but a signed-in person (ADR 0003 §4, ADR 0013 §9): the
 * same hash-chained `AUTHZ_DENIED` entry a `requirePermission` denial writes,
 * then a 403 `NOT_A_PERSON`.
 */
export async function assertWritesAsPerson(ctx: RequestContext, entity: string, verb: string): Promise<void> {
    if (actsOnWorkloadAsPerson(ctx)) return;
    await auditRefusal(ctx, entity, ctx.userId, 'Workload write refused: not a person', NOT_A_PERSON, verb);
    throw forbidden('Capacity and time off are written by the signed-in person, never by an API key, an agent or a job.', { reason: NOT_A_PERSON });
}

/** A refusal past the route's key: another person's time off without `workload.manage` (audited). */
export async function refuseManageRequired(ctx: RequestContext, userId: string, verb: string): Promise<never> {
    await auditRefusal(ctx, 'TimeOff', userId, "Another member's time off refused: workload.manage not held", WORKLOAD_MANAGE_REQUIRED, verb);
    throw forbidden("Another member's time off is recorded by whoever manages workload (workload.manage).", { reason: WORKLOAD_MANAGE_REQUIRED });
}

/** Today and the current week's Monday in the zone of a set's workspace calendar. */
export function todayOfCalendars(calendars: WorkingCalendarSet): { today: EpochDay; currentWeek: EpochDay; timeZone: string } {
    const timeZone = calendars.workspace.timeZone;
    const today = todayIn(timeZone, todayClock(timeZone));
    return { today, currentWeek: mondayOf(today), timeZone };
}

/** Today and the current week's Monday in the workspace calendar's zone (the workspace's "today"). */
export async function workspaceToday(db: PrismaTx, ctx: RequestContext): Promise<{ today: EpochDay; currentWeek: EpochDay; timeZone: string }> {
    return todayOfCalendars(await resolveWorkingCalendars(db, ctx, []));
}

/** `YYYY-MM-DD` of the current week's Monday. */
export function weekKey(d: EpochDay): string {
    return fromEpochDay(d);
}

/**
 * Lock the person a write names `FOR KEY SHARE` (CLAUDE.md, "A row that names
 * a member"; decision 280's order): a removal in flight is waited for, and a
 * person who is gone or not ACTIVE is a 400.
 */
export async function lockActivePerson(db: PrismaTx, ctx: RequestContext, userId: string): Promise<void> {
    const active = await MembershipRepository.lockActiveUserIds(db, ctx, [userId]);
    if (!active.has(userId)) throw badRequest('That person is not an active member of this workspace.', { reason: 'NOT_A_MEMBER' });
}
