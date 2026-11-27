/**
 * Cycles and cycle schedules (sub-phase 2.5a; docs/porting/maps/2.5.md;
 * owner decisions 62 to 75; ADR 0006 "Cycle", "Cycle schedule", "Burn-up").
 *
 * - A cycle belongs to one team and never overlaps another of the team (the
 *   `Cycle_no_overlap` exclusion constraint, and the same check here under
 *   the team's cycle lock so a person gets a 409, not a database error).
 * - A team's cycle schedule makes cycles: saving it fills the current window
 *   and `upcomingCount` more, replacing the schedule's own upcoming cycles
 *   that hold no items; the nightly `cycle-rollover` job keeps it filled.
 * - Status is derived (`cycleStatus`): "today" is the date in
 *   `NOTIFICATIONS_TZ`, as for the due reminders.
 * - Counts and the burn-up read only items in projects the caller can see.
 * - Putting an item in a cycle is a single-field change (ADR 0002 §9):
 *   `If-Match` optional, the version increases, a completed cycle refuses.
 *
 * Every write is audited (`logEvent`, with the transaction client). Written
 * fresh for Islestone.
 */
import type { CycleRollover, EstimateUnit, WorkflowStateCategory } from '@prisma/client';

import { logEvent } from '../events/audit';
import { assertFieldWrite } from './field-set';
import { CycleRepository, type CycleRow, type CycleScheduleRow } from '../repositories/CycleRepository';
import { BURN_UP_ITEM_CAP, WorkItemTransitionRepository } from '../repositories/WorkItemTransitionRepository';
import { resolveWorkingCalendars } from './working-calendar';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { TeamRepository } from '../repositories/TeamRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import { assertCanManageCycles, assertCanReadCycles, mayReadCycles } from '../policies/cycle.policies';
import { assertCanEditWorkItems } from '../policies/work-item.policies';
import { visibleProjects, type ProjectVisibility } from '../policies/project-visibility';
import { burnUp, type BurnUpMeasure } from '../domain/burn-up';
import {
    CYCLE_LENGTH_WEEKS,
    CYCLE_MAX_DAYS,
    CYCLE_UPCOMING_COUNT,
    cycleLabel,
    cycleStatus,
    dayKey,
    daysBetween,
    daysLeft,
    fromDayKey,
    planScheduledCycles,
    type CycleStatus,
} from '../domain/cycle';
import { todayInTz } from '../notifications/work-item-due';
import { getWorkItem } from './work-item';
import { emitWatcherActivity, keyOf, loadWritableItem, notificationsTz, throwWriteConflict } from './work-item-shared';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { ConflictError, badRequest, notFound } from '@/lib/errors/types';
import { sanitizePlainText } from '@/lib/security/sanitize';
import type { BurnUpData, CycleCounts, CycleData, CycleScheduleData, ViewCycle } from '@/lib/work-items/types';
import { todayClock } from '@/lib/clock';

/** The most items one cycle delete clears (an upcoming cycle; far above a real one). */
export const CYCLE_CLEAR_CAP = 5_000;

function today(): Date {
    return todayInTz(todayClock(notificationsTz()), notificationsTz());
}

export function toViewCycle(c: CycleRow, on: Date): ViewCycle {
    return {
        id: c.id,
        teamId: c.teamId,
        number: c.number,
        name: c.name,
        startsOn: dayKey(c.startsOn),
        endsOn: dayKey(c.endsOn),
        status: cycleStatus(c, on),
    };
}

function emptyCounts(): CycleCounts {
    return { scope: 0, started: 0, completed: 0 };
}

/** Group-by rows (cycle × category) into the burn-up's three numbers per cycle. */
function countsOf(rows: ReadonlyArray<{ cycleId: string | null; stateCategory: WorkflowStateCategory; _count: { _all: number } }>) {
    const out = new Map<string, CycleCounts>();
    for (const r of rows) {
        if (!r.cycleId || r.stateCategory === 'CANCELLED') continue;
        const c = out.get(r.cycleId) ?? emptyCounts();
        c.scope += r._count._all;
        if (r.stateCategory === 'STARTED' || r.stateCategory === 'DONE') c.started += r._count._all;
        if (r.stateCategory === 'DONE') c.completed += r._count._all;
        out.set(r.cycleId, c);
    }
    return out;
}

function toCycleData(c: CycleRow, on: Date, counts: CycleCounts | undefined): CycleData {
    return {
        ...toViewCycle(c, on),
        fromSchedule: c.fromSchedule,
        completedAt: c.completedAt ? c.completedAt.toISOString() : null,
        daysLeft: c.completedAt ? 0 : daysLeft(c, on),
        counts: counts ?? emptyCounts(),
    };
}

async function cycleDataList(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, cycles: readonly CycleRow[], on: Date) {
    const counts = countsOf(await WorkItemRepository.countsByCycle(db, ctx, v, cycles.map((c) => c.id)));
    return cycles.map((c) => toCycleData(c, on, counts.get(c.id)));
}

/** The cycles the views name (pickers, filters, lanes); `[]` for a viewer without `cycles.view`. */
export async function viewCyclesInTx(db: PrismaTx, ctx: RequestContext): Promise<ViewCycle[]> {
    if (!mayReadCycles(ctx)) return [];
    const on = today();
    return (await CycleRepository.list(db, ctx)).map((c) => toViewCycle(c, on));
}

/** The ids of the cycles current today (the list filter's `current`). */
export async function currentCycleIdsInTx(db: PrismaTx, ctx: RequestContext): Promise<string[]> {
    const on = today();
    return (await CycleRepository.list(db, ctx)).filter((c) => cycleStatus(c, on) === 'current').map((c) => c.id);
}

// ─── Reads ────────────────────────────────────────────────────────────────

export async function listCycles(ctx: RequestContext, query: { teamId?: string; status?: CycleStatus } = {}): Promise<CycleData[]> {
    assertCanReadCycles(ctx);
    return runInTenantContext(ctx, async (db) => {
        const on = today();
        const v = await visibleProjects(ctx, db);
        const cycles = (await CycleRepository.list(db, ctx, { teamId: query.teamId })).filter(
            (c) => !query.status || cycleStatus(c, on) === query.status,
        );
        return cycleDataList(db, ctx, v, cycles, on);
    });
}

export async function getCycle(ctx: RequestContext, id: string): Promise<CycleData & { team: { id: string; name: string } }> {
    assertCanReadCycles(ctx);
    return runInTenantContext(ctx, async (db) => {
        const cycle = await CycleRepository.getById(db, ctx, id);
        if (!cycle) throw notFound('Cycle not found');
        const team = await TeamRepository.getById(db, ctx, cycle.teamId);
        if (!team) throw notFound('Cycle not found');
        const [data] = await cycleDataList(db, ctx, await visibleProjects(ctx, db), [cycle], today());
        return { ...data!, team: { id: team.id, name: team.name } };
    });
}

/**
 * The measures a cycle's burn-up offers (3.4a, decision 259): items always;
 * points or hours while the cycle's team estimates in them.
 */
export function burnUpMeasuresFor(unit: EstimateUnit | null | undefined): BurnUpMeasure[] {
    if (unit === 'POINTS') return ['items', 'points'];
    if (unit === 'HOURS') return ['items', 'hours'];
    return ['items'];
}

/**
 * The burn-up (owner decisions 65 and 66), over the items the caller can see;
 * days cut in the team's working calendar's zone (3.6a, decision 316).
 */
export async function getCycleBurnUp(ctx: RequestContext, id: string, now: Date = new Date(), measure: BurnUpMeasure = 'items'): Promise<BurnUpData> {
    assertCanReadCycles(ctx);
    return runInTenantContext(ctx, async (db) => {
        const cycle = await CycleRepository.getById(db, ctx, id);
        if (!cycle) throw notFound('Cycle not found');
        // 3.6a (owner decision 316): the day boundary is the team's working
        // calendar's zone (the workspace's, else NOTIFICATIONS_TZ), so this
        // chart and an Analytics burn-up of the same cycle agree.
        const tz = (await resolveWorkingCalendars(db, ctx, [cycle.teamId])).forTeam(cycle.teamId).timeZone;
        // The team's CURRENT unit decides what may be counted (3.4a): the
        // other column is kept on the items, hidden and uncounted.
        const measures = burnUpMeasuresFor(await TeamRepository.estimateUnitOf(db, ctx, cycle.teamId));
        if (!measures.includes(measure)) {
            throw badRequest(`This cycle's team does not estimate in ${measure}; its burn-up counts ${measures.join(' or ')}.`, { reason: 'MEASURE_UNAVAILABLE', measures });
        }
        const on = todayInTz(todayClock(tz, now), tz);
        if (on.getTime() < cycle.startsOn.getTime()) return { points: [], truncated: false, measure, measures };
        const ids = await WorkItemTransitionRepository.itemIdsEverInCycle(db, ctx, cycle.id);
        const truncated = ids.length > BURN_UP_ITEM_CAP;
        const rows = await WorkItemTransitionRepository.transitionsOf(db, ctx, ids.slice(0, BURN_UP_ITEM_CAP), now);
        // Only items in projects the caller can see count, live and
        // unarchived, as the counts read them: a deleted or archived project's
        // items leave the chart as they leave the metrics.
        const visible = new Set((await ProjectRepository.list(db, ctx, await visibleProjects(ctx, db))).map((p) => p.id));
        const points = burnUp({
            cycleId: cycle.id,
            startsOn: cycle.startsOn,
            endsOn: cycle.endsOn,
            today: on,
            now,
            tz,
            measure,
            transitions: rows
                .filter((r) => visible.has(r.projectId))
                .map((r) => ({
                    workItemId: r.workItemId,
                    cycleId: r.cycleId,
                    stateCategory: r.stateCategory,
                    deleted: r.deleted,
                    at: r.at,
                    seq: Number(r.id),
                    estimatePoints: r.estimatePoints,
                    estimateMinutes: r.estimateMinutes,
                })),
        });
        return { points, truncated, measure, measures };
    });
}

// ─── Cycle writes ─────────────────────────────────────────────────────────

function cleanName(name: string | null | undefined): string | null {
    if (name === undefined || name === null) return null;
    const clean = sanitizePlainText(name).trim();
    return clean || null;
}

function assertSpan(startsOn: Date, endsOn: Date) {
    const span = daysBetween(startsOn, endsOn);
    if (span < 0) throw badRequest('A cycle ends on or after the day it starts.');
    if (span + 1 > CYCLE_MAX_DAYS) throw badRequest(`A cycle lasts at most ${CYCLE_MAX_DAYS} days.`);
}

async function assertNoOverlap(db: PrismaTx, ctx: RequestContext, teamId: string, startsOn: Date, endsOn: Date, exceptId?: string) {
    const clash = await CycleRepository.overlapping(db, ctx, teamId, startsOn, endsOn, exceptId);
    if (clash.length > 0) {
        throw new ConflictError(`These dates overlap ${cycleLabel(clash[0]!)} (${dayKey(clash[0]!.startsOn)} to ${dayKey(clash[0]!.endsOn)}).`, {
            reason: 'CYCLE_OVERLAP',
            cycleId: clash[0]!.id,
        });
    }
}

async function auditCycle(db: PrismaTx, ctx: RequestContext, action: string, c: CycleRow, operation: 'created' | 'updated' | 'deleted', extra: Record<string, unknown> = {}) {
    await logEvent(db, ctx, {
        action,
        entityType: 'Cycle',
        entityId: c.id,
        details: `${operation === 'created' ? 'Created' : operation === 'deleted' ? 'Deleted' : 'Changed'} ${cycleLabel(c)} (${dayKey(c.startsOn)} to ${dayKey(c.endsOn)})`,
        detailsJson: { category: 'entity_lifecycle', entityName: 'Cycle', operation, summary: action },
        metadata: { teamId: c.teamId, number: c.number, startsOn: dayKey(c.startsOn), endsOn: dayKey(c.endsOn), ...extra },
    });
}

export interface CreateCycleInput {
    teamId: string;
    name?: string | null;
    startsOn: string;
    endsOn: string;
}

/** A one-off cycle (owner decision 63): any dates that end today or later and overlap no cycle of the team. */
export async function createCycle(ctx: RequestContext, input: CreateCycleInput): Promise<CycleData> {
    assertCanManageCycles(ctx);
    const startsOn = fromDayKey(input.startsOn);
    const endsOn = fromDayKey(input.endsOn);
    assertSpan(startsOn, endsOn);
    const on = today();
    if (endsOn.getTime() < on.getTime()) throw badRequest('A new cycle must end today or later.');
    const name = cleanName(input.name);
    return runInTenantContext(ctx, async (db) => {
        await CycleRepository.lockTeamCycles(db, input.teamId);
        const team = await TeamRepository.getById(db, ctx, input.teamId);
        if (!team) throw notFound('Team not found');
        await assertNoOverlap(db, ctx, team.id, startsOn, endsOn);
        const number = await CycleRepository.nextNumber(db, ctx, team.id);
        const cycle = await CycleRepository.create(db, ctx, { teamId: team.id, number, name, startsOn, endsOn, fromSchedule: false });
        await auditCycle(db, ctx, 'CYCLE_CREATED', cycle, 'created', { fromSchedule: false });
        return toCycleData(cycle, on, undefined);
    });
}

export interface UpdateCycleInput {
    name?: string | null;
    startsOn?: string;
    endsOn?: string;
}

/**
 * Rename a cycle, move a future cycle's dates, or move the end of a current
 * one (not before today). A completed cycle is read-only (409); a started one
 * keeps its start (409). A schedule's cycle whose dates a person moved is no
 * longer the schedule's to replace.
 */
export async function updateCycle(ctx: RequestContext, id: string, input: UpdateCycleInput): Promise<CycleData> {
    assertCanManageCycles(ctx);
    const on = today();
    return runInTenantContext(ctx, async (db) => {
        const existing = await CycleRepository.getById(db, ctx, id);
        if (!existing) throw notFound('Cycle not found');
        await CycleRepository.lockTeamCycles(db, existing.teamId);
        const cycle = await CycleRepository.getById(db, ctx, id);
        if (!cycle) throw notFound('Cycle not found');
        const status = cycleStatus(cycle, on);
        if (status === 'completed') throw new ConflictError('A completed cycle cannot be changed.', { reason: 'CYCLE_COMPLETED' });

        const data: { name?: string | null; startsOn?: Date; endsOn?: Date; fromSchedule?: boolean } = {};
        const changed: string[] = [];
        if (input.name !== undefined) {
            data.name = cleanName(input.name);
            changed.push('name');
        }
        const startsOn = input.startsOn !== undefined ? fromDayKey(input.startsOn) : cycle.startsOn;
        const endsOn = input.endsOn !== undefined ? fromDayKey(input.endsOn) : cycle.endsOn;
        const datesMoved = startsOn.getTime() !== cycle.startsOn.getTime() || endsOn.getTime() !== cycle.endsOn.getTime();
        if (datesMoved) {
            if (startsOn.getTime() !== cycle.startsOn.getTime() && status !== 'upcoming') {
                throw new ConflictError('A cycle that has started keeps its start date.', { reason: 'CYCLE_STARTED' });
            }
            if (status === 'upcoming' && startsOn.getTime() < on.getTime()) throw badRequest('An upcoming cycle cannot start in the past.');
            if (endsOn.getTime() < on.getTime()) throw badRequest('A cycle cannot end before today.');
            assertSpan(startsOn, endsOn);
            await assertNoOverlap(db, ctx, cycle.teamId, startsOn, endsOn, cycle.id);
            data.startsOn = startsOn;
            data.endsOn = endsOn;
            data.fromSchedule = false;
            changed.push('dates');
        }
        if (changed.length === 0) return (await cycleDataList(db, ctx, await visibleProjects(ctx, db), [cycle], on))[0]!;
        if ((await CycleRepository.update(db, ctx, id, data)) === 0) throw notFound('Cycle not found');
        const after = (await CycleRepository.getById(db, ctx, id))!;
        await auditCycle(db, ctx, 'CYCLE_UPDATED', after, 'updated', {
            changedFields: changed,
            ...(datesMoved ? { fromStartsOn: dayKey(cycle.startsOn), fromEndsOn: dayKey(cycle.endsOn) } : {}),
        });
        return (await cycleDataList(db, ctx, await visibleProjects(ctx, db), [after], on))[0]!;
    });
}

/**
 * Delete an upcoming cycle. Its items leave it first (their versions
 * increase, each audited), deleted items and items in hidden projects
 * included, or the RESTRICT foreign key would refuse the delete.
 */
export async function deleteCycle(ctx: RequestContext, id: string): Promise<{ deleted: true; clearedItems: number }> {
    assertCanManageCycles(ctx);
    const on = today();
    return runInTenantContext(ctx, async (db) => {
        const existing = await CycleRepository.getById(db, ctx, id);
        if (!existing) throw notFound('Cycle not found');
        await CycleRepository.lockTeamCycles(db, existing.teamId);
        const cycle = await CycleRepository.getById(db, ctx, id);
        if (!cycle) throw notFound('Cycle not found');
        if (cycleStatus(cycle, on) !== 'upcoming') {
            throw new ConflictError('Only an upcoming cycle can be deleted.', { reason: 'CYCLE_NOT_UPCOMING' });
        }
        const cleared = await clearCycleItemsInTx(db, ctx, cycle, 'cycle_deleted');
        await CycleRepository.delete(db, ctx, cycle.id);
        await auditCycle(db, ctx, 'CYCLE_DELETED', cycle, 'deleted', { clearedItems: cleared });
        return { deleted: true as const, clearedItems: cleared };
    });
}

/** Take every item out of a cycle (see `idsInCycleIncludingDeleted`), each change audited. */
async function clearCycleItemsInTx(db: PrismaTx, ctx: RequestContext, cycle: CycleRow, reason: 'cycle_deleted' | 'schedule_replaced'): Promise<number> {
    const rows = await WorkItemRepository.idsInCycleIncludingDeleted(db, ctx, cycle.id, CYCLE_CLEAR_CAP + 1);
    if (rows.length > CYCLE_CLEAR_CAP) {
        throw new ConflictError('This cycle holds too many work items to delete in one step. Move some to another cycle first.', {
            reason: 'CYCLE_TOO_LARGE',
        });
    }
    // Locked in id order before the write (decision 173).
    const locked = await WorkItemRepository.lockForWrite(db, ctx, rows.map((r) => r.id));
    const count = await WorkItemRepository.clearCycleIncludingDeleted(db, ctx, locked, cycle.id);
    for (const r of rows) {
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_CYCLE_CHANGED',
            entityType: 'WorkItem',
            entityId: r.id,
            details: `Took ${keyOf(r)} out of ${cycleLabel(cycle)}`,
            detailsJson: { category: 'custom', event: 'cycle_changed', fromCycleId: cycle.id, toCycleId: null, reason },
            metadata: { fromCycleId: cycle.id, toCycleId: null, reason },
        });
    }
    return count;
}

// ─── Schedules ────────────────────────────────────────────────────────────

function toScheduleData(teamId: string, s: CycleScheduleRow | null, on: Date): CycleScheduleData {
    if (!s) {
        return {
            teamId,
            saved: false,
            enabled: false,
            lengthWeeks: CYCLE_LENGTH_WEEKS.default,
            firstStartsOn: dayKey(on),
            upcomingCount: CYCLE_UPCOMING_COUNT.default,
            rollover: 'NEXT_CYCLE',
        };
    }
    return {
        teamId,
        saved: true,
        enabled: s.enabled,
        lengthWeeks: s.lengthWeeks,
        firstStartsOn: dayKey(s.firstStartsOn),
        upcomingCount: s.upcomingCount,
        rollover: s.rollover,
    };
}

export async function getCycleSchedule(ctx: RequestContext, teamId: string): Promise<CycleScheduleData> {
    assertCanReadCycles(ctx);
    return runInTenantContext(ctx, async (db) => {
        const team = await TeamRepository.getById(db, ctx, teamId);
        if (!team) throw notFound('Team not found');
        return toScheduleData(team.id, await CycleRepository.getSchedule(db, ctx, team.id), today());
    });
}

export interface SetCycleScheduleInput {
    enabled: boolean;
    lengthWeeks: number;
    firstStartsOn: string;
    upcomingCount: number;
    rollover: CycleRollover;
}

/**
 * Save a team's cycle settings. While enabled, the schedule's own upcoming
 * cycles that hold no items are replaced and the windows refilled, in this
 * request; a disabled schedule keeps every cycle and still says where
 * unfinished items go at rollover.
 */
export async function setCycleSchedule(ctx: RequestContext, teamId: string, input: SetCycleScheduleInput): Promise<CycleScheduleData & { created: number; replaced: number }> {
    assertCanManageCycles(ctx);
    const on = today();
    return runInTenantContext(ctx, async (db) => {
        await CycleRepository.lockTeamCycles(db, teamId);
        const team = await TeamRepository.getById(db, ctx, teamId);
        if (!team) throw notFound('Team not found');
        const schedule = await CycleRepository.upsertSchedule(db, ctx, team.id, {
            enabled: input.enabled,
            lengthWeeks: input.lengthWeeks,
            firstStartsOn: fromDayKey(input.firstStartsOn),
            upcomingCount: input.upcomingCount,
            rollover: input.rollover,
        });
        let replaced = 0;
        let created = 0;
        if (schedule.enabled) {
            replaced = await replaceEmptyScheduledCyclesInTx(db, ctx, team.id, on);
            created = await fillScheduleInTx(db, ctx, schedule, on);
        }
        await logEvent(db, ctx, {
            action: 'CYCLE_SCHEDULE_SET',
            entityType: 'CycleSchedule',
            entityId: schedule.id,
            details: `Saved the cycle schedule of ${team.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'CycleSchedule', operation: 'updated', summary: 'CYCLE_SCHEDULE_SET' },
            metadata: {
                teamId: team.id,
                enabled: schedule.enabled,
                lengthWeeks: schedule.lengthWeeks,
                firstStartsOn: dayKey(schedule.firstStartsOn),
                upcomingCount: schedule.upcomingCount,
                rollover: schedule.rollover,
                created,
                replaced,
            },
        });
        return { ...toScheduleData(team.id, schedule, on), created, replaced };
    });
}

/** Delete the schedule's upcoming cycles that hold no items at all (deleted items count). */
async function replaceEmptyScheduledCyclesInTx(db: PrismaTx, ctx: RequestContext, teamId: string, on: Date): Promise<number> {
    const candidates = (await CycleRepository.openForTeam(db, ctx, teamId)).filter(
        (c) => c.fromSchedule && cycleStatus(c, on) === 'upcoming',
    );
    if (candidates.length === 0) return 0;
    const used = new Set(await WorkItemRepository.cycleIdsInUse(db, ctx, candidates.map((c) => c.id)));
    let removed = 0;
    for (const c of candidates) {
        if (used.has(c.id)) continue;
        removed += await CycleRepository.delete(db, ctx, c.id);
        await auditCycle(db, ctx, 'CYCLE_DELETED', c, 'deleted', { reason: 'schedule_replaced' });
    }
    return removed;
}

/**
 * Make the schedule's missing windows (`planScheduledCycles`), each a new
 * cycle numbered after the team's last, audited as the caller (a person
 * saving the schedule, or the rollover job's system user). The caller holds
 * the team's cycle lock.
 */
export async function fillScheduleInTx(
    db: PrismaTx,
    ctx: RequestContext,
    schedule: Pick<CycleScheduleRow, 'teamId' | 'lengthWeeks' | 'firstStartsOn' | 'upcomingCount' | 'enabled'>,
    on: Date,
): Promise<number> {
    if (!schedule.enabled) return 0;
    const existing = await CycleRepository.endingOnOrAfter(db, ctx, schedule.teamId, on);
    const plan = planScheduledCycles(schedule, existing, on);
    let number = plan.length > 0 ? await CycleRepository.nextNumber(db, ctx, schedule.teamId) : 0;
    for (const w of plan) {
        const cycle = await CycleRepository.create(db, ctx, {
            teamId: schedule.teamId,
            number,
            name: null,
            startsOn: w.startsOn,
            endsOn: w.endsOn,
            fromSchedule: true,
        });
        await auditCycle(db, ctx, 'CYCLE_CREATED', cycle, 'created', { fromSchedule: true });
        number += 1;
    }
    return plan.length;
}

// ─── An item's cycle ──────────────────────────────────────────────────────

/**
 * The cycle an item of `teamId` may join: the team's own (400 otherwise; the
 * composite FK would refuse it too) and not completed (409 `CYCLE_COMPLETED`).
 */
export async function assertCycleTakesItems(db: PrismaTx, ctx: RequestContext, cycleId: string, teamId: string): Promise<CycleRow> {
    const cycle = await CycleRepository.getById(db, ctx, cycleId);
    if (!cycle) throw notFound('Cycle not found');
    if (cycle.teamId !== teamId) throw badRequest(`${cycleLabel(cycle)} belongs to another team.`);
    if (cycle.completedAt) throw new ConflictError(`${cycleLabel(cycle)} is completed and takes no work items.`, { reason: 'CYCLE_COMPLETED' });
    return cycle;
}

/**
 * Put an item in a cycle of its own team, or take it out (`null`). A
 * single-field change: `If-Match` optional, the version increases. A
 * completed cycle takes no items (409 `CYCLE_COMPLETED`); another team's
 * cycle is a 400 (the composite FK would refuse it too).
 */
export async function setWorkItemCycle(ctx: RequestContext, id: string, input: { cycleId: string | null }, expectedVersion?: number) {
    assertCanEditWorkItems(ctx);
    const result = await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const item = await loadWritableItem(db, ctx, v, id);
        if (item.cycleId === input.cycleId) return { changed: false as const };
        await assertFieldWrite(db, ctx, item, { cycleId: input.cycleId });
        const to = input.cycleId ? await assertCycleTakesItems(db, ctx, input.cycleId, item.teamId) : null;
        const count = await WorkItemRepository.updateVersioned(db, ctx, v, id, expectedVersion, { cycleId: to?.id ?? null });
        if (count === 0) await throwWriteConflict(db, ctx, v, id);
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_CYCLE_CHANGED',
            entityType: 'WorkItem',
            entityId: id,
            details: to ? `Put ${keyOf(item)} in ${cycleLabel(to)}` : `Took ${keyOf(item)} out of its cycle`,
            detailsJson: { category: 'custom', event: 'cycle_changed', fromCycleId: item.cycleId, toCycleId: to?.id ?? null },
            metadata: { fromCycleId: item.cycleId, toCycleId: to?.id ?? null },
        });
        return { changed: true as const, detail: to ? `cycle ${cycleLabel(to)}` : 'cycle cleared' };
    });
    const after = await getWorkItem(ctx, id);
    if (result.changed) {
        await emitWatcherActivity(ctx, [{ workItemId: id, kind: 'updated', discriminator: `v${after.version}`, detail: result.detail }]);
    }
    return after;
}
