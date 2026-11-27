/**
 * Capacity: the workspace's default and a member's hours a week from a Monday
 * (sub-phase 3.5a; docs/porting/maps/3.5.md, "Capacity (3.5a)"; ADR 0013 §1;
 * owner decisions 284, 285 and 298). The only module that writes
 * `TenantWorkloadSettings` and `MemberCapacity`.
 *
 *   - **The default** (`workload.manage` to write, `workload.view` to read):
 *     0 to 6,000 minutes a week, 2,400 when no row is saved; `If-Match` names
 *     the version; audited `WORKLOAD_SETTINGS_SET` (before and after).
 *   - **A member's capacity** (`workload.manage`): from a Monday (400
 *     `NOT_A_MONDAY`), 0 to 6,000 minutes, on the workspace's calendar or a
 *     named team's (400 `TEAM_NOT_FOUND`); replaces that Monday's row (its
 *     version checked, 409 `VERSION_CONFLICT`) or adds one; audited
 *     `MEMBER_CAPACITY_SET` with the person, the Monday, the minutes and the
 *     calendar before and after.
 *   - **Removing a change** is only for a row whose Monday is after the
 *     current week (409 `CAPACITY_IN_EFFECT`): past and current rows are
 *     history. Audited `MEMBER_CAPACITY_REMOVED`.
 *   - **A person only** (ADR 0003 §4): never an API key, an agent or a job.
 *     Every write locks the person's membership `FOR KEY SHARE` first and
 *     refuses one who is gone (400 `NOT_A_MEMBER`); the membership's cascade
 *     takes their rows with it on removal.
 *
 * Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import { assertCanViewWorkload, mayManageWorkload } from '../policies/workload.policies';
import { WorkloadRepository, type MemberCapacityRow } from '../repositories/WorkloadRepository';
import type { RequestContext } from '../types';
import { fromEpochDay, isoWeekday, toEpochDay } from '../domain/schedule/calendar';
import { assertWritesAsPerson, lockActivePerson, weekKey, workspaceToday } from './workload-shared';
import { runInTenantContext, runInTenantReadContext } from '@/lib/db-context';
import { AppError, ConflictError, badRequest, forbidden, notFound } from '@/lib/errors/types';
import { dateKeyOf, dateOnlyValue } from '@/lib/time/week';
import { WORKLOAD_LIMITS } from '@/lib/workload/time-off';
import type { MemberCapacityData, MemberCapacityHistory, WorkloadMembersData, WorkloadSettingsData } from '@/lib/workload/types';

/** The workspace's default weekly capacity when no settings row is saved (40 hours). */
export const DEFAULT_WEEKLY_MINUTES = 2_400;

/** The most capacity rows Settings → Workload reads for its members (a few per person). */
const MEMBER_ROWS_TAKE = 20_000;
const TEAMS_TAKE = 500;

function assertCanManage(ctx: RequestContext): void {
    if (!mayManageWorkload(ctx)) throw forbidden('You do not have permission to manage workload.');
}

function toCapacityData(row: MemberCapacityRow): MemberCapacityData {
    return {
        id: row.id,
        userId: row.userId,
        effectiveFrom: dateKeyOf(row.effectiveFrom),
        weeklyMinutes: row.weeklyMinutes,
        calendarTeamId: row.calendarTeamId,
        version: row.version,
        createdAt: row.createdAt.toISOString(),
    };
}

function versionConflict(current: unknown): ConflictError {
    return new ConflictError('This changed since you read it.', { reason: 'VERSION_CONFLICT', current });
}

// ─── The workspace default ─────────────────────────────────────────

export async function getWorkloadSettings(ctx: RequestContext): Promise<WorkloadSettingsData> {
    assertCanViewWorkload(ctx);
    const row = await runInTenantReadContext(ctx, (db) => WorkloadRepository.getSettings(db, ctx));
    return row ?? { defaultWeeklyMinutes: DEFAULT_WEEKLY_MINUTES, version: 0 };
}

/** Change the default (`workload.manage`, a person). `expectedVersion` 0 names "no row saved yet". */
export async function setWorkloadSettings(ctx: RequestContext, input: { defaultWeeklyMinutes: number }, expectedVersion?: number): Promise<WorkloadSettingsData> {
    assertCanManage(ctx);
    await assertWritesAsPerson(ctx, 'TenantWorkloadSettings', 'set_settings');
    return runInTenantContext(ctx, async (db) => {
        await WorkloadRepository.lockSettings(db, ctx);
        const before = await WorkloadRepository.getSettings(db, ctx);
        const beforeData = before ?? { defaultWeeklyMinutes: DEFAULT_WEEKLY_MINUTES, version: 0 };
        if (expectedVersion !== undefined && expectedVersion !== beforeData.version) throw versionConflict(beforeData);
        let after: WorkloadSettingsData;
        if (!before) {
            after = await WorkloadRepository.createSettings(db, ctx, input.defaultWeeklyMinutes);
        } else {
            const count = await WorkloadRepository.updateSettingsVersioned(db, ctx, before.version, input.defaultWeeklyMinutes);
            if (count !== 1) throw versionConflict(beforeData);
            after = { defaultWeeklyMinutes: input.defaultWeeklyMinutes, version: before.version + 1 };
        }
        await logEvent(db, ctx, {
            action: 'WORKLOAD_SETTINGS_SET',
            entityType: 'TenantWorkloadSettings',
            entityId: ctx.tenantId,
            details: `Default capacity set to ${input.defaultWeeklyMinutes} minutes a week`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'TenantWorkloadSettings', operation: before ? 'updated' : 'created', changedFields: ['defaultWeeklyMinutes'] },
            metadata: { before: { defaultWeeklyMinutes: beforeData.defaultWeeklyMinutes }, after: { defaultWeeklyMinutes: after.defaultWeeklyMinutes } },
        });
        return after;
    });
}

// ─── A member's capacity ───────────────────────────────────────────

/** One person's capacity rows, newest first (`workload.view`). */
export async function getMemberCapacity(ctx: RequestContext, userId: string): Promise<MemberCapacityHistory> {
    assertCanViewWorkload(ctx);
    return runInTenantReadContext(ctx, async (db) => {
        const person = await WorkloadRepository.personOf(db, ctx, userId);
        if (!person) throw notFound('Member not found');
        const settings = await WorkloadRepository.getSettings(db, ctx);
        const rows = await WorkloadRepository.historyOf(db, ctx, userId);
        const { currentWeek } = await workspaceToday(db, ctx);
        return {
            userId,
            defaultWeeklyMinutes: settings?.defaultWeeklyMinutes ?? DEFAULT_WEEKLY_MINUTES,
            currentWeek: weekKey(currentWeek),
            rows: rows.map(toCapacityData),
        };
    });
}

export interface SetMemberCapacityInput {
    effectiveFrom: string;
    weeklyMinutes: number;
    calendarTeamId: string | null;
}

/** Set a member's capacity from a Monday (`workload.manage`, a person); `expectedVersion` names that Monday's row when one exists. */
export async function setMemberCapacity(ctx: RequestContext, userId: string, input: SetMemberCapacityInput, expectedVersion?: number): Promise<MemberCapacityData> {
    assertCanManage(ctx);
    await assertWritesAsPerson(ctx, 'MemberCapacity', 'set_capacity');
    if (isoWeekday(toEpochDay(input.effectiveFrom)) !== 1) throw badRequest('Capacity changes from a Monday.', { reason: 'NOT_A_MONDAY' });
    if (input.weeklyMinutes < 0 || input.weeklyMinutes > WORKLOAD_LIMITS.weeklyMinutesMax) throw badRequest('A week holds 0 to 100 hours.', { reason: 'CAPACITY_RANGE' });
    return runInTenantContext(ctx, async (db) => {
        await lockActivePerson(db, ctx, userId);
        if (input.calendarTeamId && !(await WorkloadRepository.teamExists(db, ctx, input.calendarTeamId))) {
            throw badRequest('That team is not in this workspace.', { reason: 'TEAM_NOT_FOUND' });
        }
        const effectiveFrom = dateOnlyValue(input.effectiveFrom);
        const before = await WorkloadRepository.findForMonday(db, ctx, userId, effectiveFrom);
        let row: MemberCapacityRow;
        if (before) {
            if (expectedVersion !== undefined && expectedVersion !== before.version) throw versionConflict(toCapacityData(before));
            const count = await WorkloadRepository.updateVersioned(db, ctx, before.id, before.version, { weeklyMinutes: input.weeklyMinutes, calendarTeamId: input.calendarTeamId });
            if (count !== 1) throw versionConflict(toCapacityData(before));
            row = { ...before, weeklyMinutes: input.weeklyMinutes, calendarTeamId: input.calendarTeamId, version: before.version + 1 };
        } else {
            row = await WorkloadRepository.create(db, ctx, { userId, effectiveFrom, weeklyMinutes: input.weeklyMinutes, calendarTeamId: input.calendarTeamId, createdByUserId: ctx.userId });
        }
        await logEvent(db, ctx, {
            action: 'MEMBER_CAPACITY_SET',
            entityType: 'MemberCapacity',
            entityId: row.id,
            details: `Capacity from ${input.effectiveFrom} set to ${input.weeklyMinutes} minutes a week`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'MemberCapacity', operation: before ? 'updated' : 'created', changedFields: ['weeklyMinutes', 'calendarTeamId'] },
            metadata: {
                userId,
                effectiveFrom: input.effectiveFrom,
                before: before ? { weeklyMinutes: before.weeklyMinutes, calendarTeamId: before.calendarTeamId } : null,
                after: { weeklyMinutes: input.weeklyMinutes, calendarTeamId: input.calendarTeamId },
            },
        });
        return toCapacityData(row);
    });
}

/** Remove a future change (`workload.manage`, a person; sent from the undo toast). */
export async function removeMemberCapacity(ctx: RequestContext, userId: string, capacityId: string, expectedVersion?: number): Promise<void> {
    assertCanManage(ctx);
    await assertWritesAsPerson(ctx, 'MemberCapacity', 'remove_capacity');
    await runInTenantContext(ctx, async (db) => {
        const row = await WorkloadRepository.findById(db, ctx, userId, capacityId);
        if (!row) throw notFound('Capacity change not found');
        const { currentWeek } = await workspaceToday(db, ctx);
        if (toEpochDay(row.effectiveFrom) <= currentWeek) {
            throw new ConflictError('This capacity is in effect or past; set a new one from a later Monday instead.', { reason: 'CAPACITY_IN_EFFECT' });
        }
        const version = expectedVersion ?? row.version;
        const count = await WorkloadRepository.deleteVersioned(db, ctx, row.id, version);
        if (count !== 1) throw versionConflict(toCapacityData(row));
        await logEvent(db, ctx, {
            action: 'MEMBER_CAPACITY_REMOVED',
            entityType: 'MemberCapacity',
            entityId: row.id,
            details: `Capacity change from ${dateKeyOf(row.effectiveFrom)} removed`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'MemberCapacity', operation: 'deleted' },
            metadata: { userId, effectiveFrom: dateKeyOf(row.effectiveFrom), weeklyMinutes: row.weeklyMinutes, calendarTeamId: row.calendarTeamId },
        });
    });
}

// ─── Settings → Workload's members ──────────────────────────────────

/**
 * Every active member with the capacity in force this week and the next
 * change (`workload.manage`: the table is where capacity is changed). At most
 * `WORKLOAD_LIMITS.personLimit`, read one past and refused above (422).
 */
export async function listWorkloadMembers(ctx: RequestContext): Promise<WorkloadMembersData> {
    assertCanManage(ctx);
    return runInTenantReadContext(ctx, async (db) => {
        const people = await WorkloadRepository.activePeople(db, ctx, WORKLOAD_LIMITS.personLimit + 1);
        if (people.length > WORKLOAD_LIMITS.personLimit) {
            throw new AppError(`This workspace has more than ${WORKLOAD_LIMITS.personLimit} members.`, 'WORKLOAD_TOO_LARGE', 422, true, { reason: 'WORKLOAD_TOO_LARGE', limit: WORKLOAD_LIMITS.personLimit });
        }
        const settings = await WorkloadRepository.getSettings(db, ctx);
        const rows = await WorkloadRepository.rowsOf(db, ctx, people.map((p) => p.userId), MEMBER_ROWS_TAKE);
        const { currentWeek } = await workspaceToday(db, ctx);
        const teams = await WorkloadRepository.teams(db, ctx, TEAMS_TAKE);
        const byPerson = new Map<string, MemberCapacityRow[]>();
        for (const r of rows) byPerson.set(r.userId, [...(byPerson.get(r.userId) ?? []), r]);
        return {
            defaultWeeklyMinutes: settings?.defaultWeeklyMinutes ?? DEFAULT_WEEKLY_MINUTES,
            currentWeek: fromEpochDay(currentWeek),
            teams,
            members: people.map((p) => {
                const own = byPerson.get(p.userId) ?? [];
                const past = own.filter((r) => toEpochDay(r.effectiveFrom) <= currentWeek);
                const future = own.filter((r) => toEpochDay(r.effectiveFrom) > currentWeek);
                const inForce = past.length > 0 ? past[past.length - 1]! : null;
                return { userId: p.userId, name: p.name, active: p.active, inForce: inForce ? toCapacityData(inForce) : null, next: future[0] ? toCapacityData(future[0]) : null };
            }),
        };
    });
}
