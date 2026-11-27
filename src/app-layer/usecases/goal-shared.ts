/**
 * What the goal and initiative usecases share (sub-phase 3.2a;
 * docs/porting/maps/3.2.md): the DTOs, date-only parsing, the lead check, the
 * list's order and query parsing, and the refusals both raise.
 *
 * Written fresh for Islestone.
 */
import type { GoalStatus, Health, InitiativeStatus } from '@prisma/client';

import { MembershipRepository } from '../repositories/MembershipRepository';
import type { GoalRow } from '../repositories/GoalRepository';
import type { InitiativeRow } from '../repositories/InitiativeRepository';
import { fromEpochDay, toEpochDay } from '../domain/schedule/calendar';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { ConflictError, badRequest, notFound } from '@/lib/errors/types';
import { GOAL_STATUSES, HEALTH_VALUES } from '@/lib/schemas/goal';
import type { GoalData, InitiativeData } from '@/lib/goals/types';

/** A date-only column as `YYYY-MM-DD` (never through a time zone). */
export function dayOf(d: Date | null): string | null {
    return d ? fromEpochDay(toEpochDay(d)) : null;
}

/** A request's `YYYY-MM-DD` as the date-only column's value. */
export function parseDueDate(raw: string | null | undefined): Date | null | undefined {
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    try {
        return new Date(toEpochDay(raw) * 86_400_000);
    } catch {
        throw badRequest(`${raw} is not a date.`, { reason: 'DUE_DATE_INVALID' });
    }
}

export function toGoalDto(row: GoalRow): GoalData {
    return {
        id: row.id,
        parentId: row.parentId,
        title: row.title,
        description: row.description,
        status: row.status,
        dueDate: dayOf(row.dueDate),
        leadUserId: row.leadUserId,
        health: row.health,
        healthSetAt: row.healthSetAt,
        healthSetByUserId: row.healthSetByUserId,
        version: row.version,
        archived: row.archivedAt !== null,
        archivedAt: row.archivedAt,
        deletedAt: row.deletedAt,
        deletionId: row.deletionId,
        createdByUserId: row.createdByUserId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

export function toInitiativeDto(row: InitiativeRow): InitiativeData {
    return {
        id: row.id,
        goalId: row.goalId,
        name: row.name,
        description: row.description,
        status: row.status,
        dueDate: dayOf(row.dueDate),
        leadUserId: row.leadUserId,
        health: row.health,
        healthSetAt: row.healthSetAt,
        healthSetByUserId: row.healthSetByUserId,
        version: row.version,
        archived: row.archivedAt !== null,
        archivedAt: row.archivedAt,
        deletedAt: row.deletedAt,
        deletionId: row.deletionId,
        createdByUserId: row.createdByUserId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

/** Lists order by status (Started, Planned, Completed, Cancelled), then due date, then title (no `sortKey`). */
const STATUS_ORDER: Record<GoalStatus | InitiativeStatus, number> = { STARTED: 0, PLANNED: 1, COMPLETED: 2, CANCELLED: 3 };

export function byStatusDueTitle<T extends { status: GoalStatus | InitiativeStatus; dueDate: Date | null; id: string }>(label: (row: T) => string) {
    return (a: T, b: T): number =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        (a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY) - (b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY) ||
        (label(a) < label(b) ? -1 : label(a) > label(b) ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** A comma-joined status filter; an unknown value is a 400, never a silent miss. */
export function parseStatuses(raw: string | undefined): GoalStatus[] | undefined {
    if (!raw) return undefined;
    const values = raw.split(',').map((s) => s.trim()).filter(Boolean);
    for (const v of values) if (!(GOAL_STATUSES as readonly string[]).includes(v)) throw badRequest(`Invalid status. Must be one of: ${GOAL_STATUSES.join(', ')}.`);
    return values as GoalStatus[];
}

/** A comma-joined health filter; `none` is "No health set". */
export function parseHealth(raw: string | undefined): Array<Health | null> | undefined {
    if (!raw) return undefined;
    const values = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return values.map((v) => {
        if (v === 'none') return null;
        if (!(HEALTH_VALUES as readonly string[]).includes(v)) throw badRequest(`Invalid health. Must be one of: ${HEALTH_VALUES.join(', ')}, none.`);
        return v as Health;
    });
}

/** A title or name, already sanitised by the caller (`sanitizePlainText`): one line, within its length. */
export function checkedLabel(sanitised: string, max: number, what: string): string {
    const value = sanitised.replace(/[\r\n\t]+/g, ' ').trim();
    if (!value) throw badRequest(`${what} needs ${what === 'A goal' ? 'a title' : 'a name'}.`);
    if (value.length > max) throw badRequest(`${what === 'A goal' ? 'A title' : 'A name'} is at most ${max} characters.`);
    return value;
}

/** A description, already sanitised by the caller before it is encrypted; empty is none. */
export function checkedDescription(sanitised: string | null | undefined): string | null | undefined {
    if (sanitised === undefined) return undefined;
    if (sanitised === null) return null;
    const value = sanitised.trim();
    return value ? value : null;
}

/**
 * A Lead (decision 209): one ACTIVE member, any role but GUEST (a Viewer may
 * lead). Never an agent: agents are not members. Their membership is read
 * `FOR KEY SHARE` (issue #113, owner decision 280), after the goal's or
 * initiative's own row when it exists: a member's removal past its
 * membership lock is waited for and the Lead refused, never the key
 * refusing the removal.
 */
export async function assertLeadMember(db: PrismaTx, ctx: RequestContext, userId: string): Promise<void> {
    const locked = await MembershipRepository.lockActiveUserIds(db, ctx, [userId]);
    const [m] = locked.has(userId) ? await MembershipRepository.activeMembershipsWithRoles(db, ctx, [userId]) : [];
    if (!m || m.role === 'GUEST') throw badRequest('The lead must be an active member of this workspace.', { reason: 'LEAD_NOT_MEMBER' });
}

export function goalNotFound(): never {
    throw notFound('Goal not found', { reason: 'GOAL_NOT_FOUND' });
}

export function initiativeNotFound(): never {
    throw notFound('Initiative not found', { reason: 'INITIATIVE_NOT_FOUND' });
}

/** Archived: its own fields, status and health are read-only until it is unarchived (decision 218). */
export function refuseArchived(what: 'goal' | 'initiative'): never {
    throw new ConflictError(`This ${what} is archived. Unarchive it to change it.`, { reason: 'ARCHIVED' });
}

/** An archived goal or initiative cannot be named by a new link (decision 218). */
export function refuseArchivedLink(what: 'goal' | 'initiative', label: string): never {
    throw new ConflictError(`The ${what} ${label} is archived and takes no new links.`, { reason: what === 'goal' ? 'GOAL_ARCHIVED' : 'INITIATIVE_ARCHIVED' });
}
