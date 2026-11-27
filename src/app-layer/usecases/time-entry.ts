/**
 * Time entries and timers (sub-phase 3.4b; docs/porting/maps/3.4.md, "Time
 * entries and timers (3.4b)"; ADR 0012 §2; owner decisions 260 to 267, 277
 * and 278; docs/time-tracking.md). The only module that writes `TimeEntry`
 * (`tests/guards/time-entry-write-seam.test.ts`; 3.4c's `timesheet.ts` joins
 * it).
 *
 *   - **A person's own statement** (decisions 267 and 278): every write is
 *     the signed-in person's, for themselves, never an API key, an agent, a
 *     job or the system user (refused with an audited 403, `NOT_A_PERSON`),
 *     and never on another person's entry (404: it is not theirs to see as
 *     an entry to change). The CHECK `TimeEntry_own_time` holds the author.
 *   - **Always one work item** (decision 260): live, in a live project the
 *     person can see; closed items are allowed, an archived project is 409
 *     `PROJECT_ARCHIVED` (decision 261). `projectId` is the item's project
 *     when the entry is written and stays when the item moves.
 *   - **To the minute** (decision 264): 1 to 1,440 minutes, and a person's
 *     day at most 1,440 (409 `DAY_FULL`, checked under the week's lock).
 *   - **One timer per person per workspace** (decision 262): starting one
 *     stops and records the one that was on; the partial unique answers a
 *     race (409 `TIMER_ON`). A timer counts on the day it started in the
 *     browser's zone and at most 12 hours, with no job (decision 263); Stop
 *     records the whole minutes since it started, or fewer if the person
 *     says so; under 30 seconds it is discarded.
 *   - **Deletes are for good** (decision 277), the audit keeping the date and
 *     the minutes. Every audit entry names numbers, dates and ids, never the
 *     description.
 *   - **Who sees what** (decision 266): an item's entries to a `time.view`
 *     holder, only one's own to a caller with `time.track` alone; another
 *     member's week only with `time.approve`.
 *
 * Every write takes the per-person timer lock (timer acts) and the week's
 * advisory lock (`timesheet:<tenant>:<person>:<Monday>`, both weeks in date
 * order for a move) before it reads a total or a timer, so 3.4c's submit and
 * approval, which take the same lock, see a settled week. A write into a
 * submitted or approved week is refused by the trigger
 * `time_entry_week_frozen` (3.4c, decision 270), answered 409
 * `TIMESHEET_FROZEN` (`frozenRefusal`).
 *
 * Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import { TimeEntryRepository, WEEK_ENTRIES_TAKE, ITEM_TIME_ORDER, type TimeEntryPatch, type TimeEntryRow } from '../repositories/TimeEntryRepository';
import { WorkItemRepository, type WorkItemGateRow } from '../repositories/WorkItemRepository';
import { NOT_A_PERSON } from '../policies/person-only.policies';
import { visibleProjects, type ProjectVisibility } from '../policies/project-visibility';
import { assertCanTrackTime, mayApproveTime, mayTrackTime, mayViewTime, recordsTimeAsPerson } from '../policies/time.policies';
import { assertCanReadWorkItems } from '../policies/work-item.policies';
import { assertProjectWritable, keyOf } from './work-item-shared';
import type { RequestContext } from '../types';
import { isKnownTimeZone } from '../domain/schedule/calendar';
import { dayKeyInTz } from '../notifications/work-item-due';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { appendAuditEntryOrQueue } from '@/lib/audit';
import { todayClock } from '@/lib/clock';
import { AppError, ConflictError, badRequest, forbidden, notFound } from '@/lib/errors/types';
import { recordTimeEntryRecorded } from '@/lib/observability/business-metrics';
import { computeKeysetPage, decodeCursor, InvalidCursorError } from '@/lib/pagination';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { TIME_LIMITS, timerMinutes, timerStoppedCounting, type RunningTimerData, type TimeEntryData, type TimeEntryItem, type TimeWeekData, type WorkItemTimeData } from '@/lib/time/entries';
import { addDays, dateKeyOf, dateOnlyValue, weekStartOf } from '@/lib/time/week';
import { formatDuration } from '@/lib/work-items/estimate';

// ─── Refusals ───────────────────────────────────────────────────────

/** 409 `DAY_FULL`: the person's day would hold more than 24 hours. */
function dayFull(date: string, remainingMinutes: number): ConflictError {
    return new ConflictError(
        remainingMinutes > 0
            ? `${date} holds only ${formatDuration(remainingMinutes)} more: a day holds at most 24 hours.`
            : `${date} already holds 24 hours of time.`,
        { reason: 'DAY_FULL', date, remainingMinutes },
    );
}

function timerOn(): ConflictError {
    return new ConflictError('Your timer is on; stop it first.', { reason: 'TIMER_ON' });
}

function entryNotFound(): never {
    throw notFound('Time entry not found');
}

/**
 * The freeze (3.4c, decision 270): the trigger `time_entry_week_frozen`
 * refuses any write to a SUBMITTED or APPROVED week's entries, raising
 * `TIMESHEET_FROZEN:`. The usecases read no timesheet before a write (the
 * trigger is the one rule); its refusal becomes a 409 here.
 */
export function frozenRefusal(err: unknown): ConflictError | null {
    const message = err instanceof Error ? err.message : '';
    if (!message.includes('TIMESHEET_FROZEN:')) return null;
    return new ConflictError('This week is submitted or approved: its time changes once it is taken back or returned.', { reason: 'TIMESHEET_FROZEN' });
}

/** Run a write, turning the freeze trigger's refusal into a 409 `TIMESHEET_FROZEN`. */
async function freezeAware<T>(write: Promise<T>): Promise<T> {
    try {
        return await write;
    } catch (err) {
        throw frozenRefusal(err) ?? err;
    }
}

function isUniqueViolation(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

/**
 * A write by anything but a signed-in person (decision 278): the same
 * hash-chained `AUTHZ_DENIED` entry a `requirePermission` denial writes, then
 * a 403 `NOT_A_PERSON`.
 */
export async function refuseNotAPerson(ctx: RequestContext, verb: string): Promise<never> {
    await appendAuditEntryOrQueue({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        actorType: ctx.apiKeyId ? 'API_KEY' : (ctx.actorType ?? 'USER'),
        entity: 'TimeEntry',
        entityId: ctx.userId,
        action: 'AUTHZ_DENIED',
        details: 'Time refused: not a person',
        detailsJson: { category: 'access', event: 'authz_denied', reason: NOT_A_PERSON, role: ctx.role },
        requestId: ctx.requestId,
        metadataJson: { role: ctx.role, verb, reason: NOT_A_PERSON },
    });
    throw forbidden('Time is recorded by the signed-in person, never by an API key, an agent or a job.', { reason: NOT_A_PERSON });
}

/** The gate of every write: `time.track`, then a person (decisions 265 and 278). */
export async function assertRecordsTime(ctx: RequestContext, verb: string): Promise<void> {
    assertCanTrackTime(ctx);
    if (!recordsTimeAsPerson(ctx)) await refuseNotAPerson(ctx, verb);
}

/** A refusal past the route's key: the caller asked for another member's week without `time.approve`. */
export async function refuseOthersWeek(ctx: RequestContext, userId: string): Promise<never> {
    await appendAuditEntryOrQueue({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        actorType: ctx.apiKeyId ? 'API_KEY' : (ctx.actorType ?? 'USER'),
        entity: 'TimeEntry',
        entityId: userId,
        action: 'AUTHZ_DENIED',
        details: "Another member's week refused: time.approve not held",
        detailsJson: { category: 'access', event: 'authz_denied', reason: 'TIME_APPROVE_REQUIRED', role: ctx.role },
        requestId: ctx.requestId,
        metadataJson: { role: ctx.role, verb: 'read_week', reason: 'TIME_APPROVE_REQUIRED' },
    });
    throw forbidden("Another member's week is read by whoever approves weeks (time.approve).", { reason: 'TIME_APPROVE_REQUIRED' });
}

// ─── Locks ──────────────────────────────────────────────────────────

/** The week's lock key: 3.4c's submit and approval take the same one. */
export function timeWeekLockKey(tenantId: string, userId: string, weekStart: string): string {
    return `timesheet:${tenantId}:${userId}:${weekStart}`;
}

/** Lock the weeks holding `dates` for `userId`, each once, in date order. */
export async function lockWeeks(db: PrismaTx, ctx: RequestContext, userId: string, dates: readonly string[]): Promise<void> {
    const weeks = [...new Set(dates.map(weekStartOf))].sort();
    for (const week of weeks) {
        // guardrail-allow: n+1 — at most two weeks (an entry moved from one to another), in date order.
        await db.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, timeWeekLockKey(ctx.tenantId, userId, week));
    }
}

/** The person's timer lock: two starts on two devices queue here (decision 262); the partial unique is the backstop. */
async function lockTimer(db: PrismaTx, ctx: RequestContext, userId: string): Promise<void> {
    await db.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `time-timer:${ctx.tenantId}:${userId}`);
}

// ─── Shapes ─────────────────────────────────────────────────────────

export function toEntryData(row: TimeEntryRow): TimeEntryData {
    return {
        id: row.id,
        userId: row.userId,
        workItemId: row.workItemId,
        projectId: row.projectId,
        workDate: dateKeyOf(row.workDate),
        minutes: row.minutes,
        source: row.source,
        billable: row.billable,
        description: row.description,
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

export function itemOf(row: Pick<WorkItemGateRow, 'id' | 'number' | 'title' | 'projectId' | 'stateCategory' | 'project'>): TimeEntryItem {
    return {
        kind: 'visible',
        id: row.id,
        key: keyOf(row),
        title: row.title,
        projectId: row.projectId,
        closed: row.stateCategory === 'DONE' || row.stateCategory === 'CANCELLED',
        billableByDefault: row.project.timeBillableByDefault,
    };
}

/** What an entry's item reads as: visible, or deleted (purged or soft-deleted), or out of the reader's sight. */
export function itemFor(workItemId: string | null, items: ReadonlyMap<string, TimeEntryItem>, v: ProjectVisibility): TimeEntryItem {
    if (!workItemId) return { kind: 'deleted' };
    return items.get(workItemId) ?? (v.kind === 'ALL' ? { kind: 'deleted' } : { kind: 'hidden' });
}

// ─── Inputs ─────────────────────────────────────────────────────────

/** The stored description: sanitised, trimmed, NULL when empty; the plaintext at most 2,000 characters. */
function descriptionOf(raw: string | null | undefined): string | null {
    if (raw === undefined || raw === null) return null;
    const clean = sanitizePlainText(raw).trim();
    if (clean.length > TIME_LIMITS.descriptionMax) {
        throw badRequest(`A description is at most ${TIME_LIMITS.descriptionMax} characters.`, { reason: 'TIME_DESCRIPTION_LENGTH' });
    }
    return clean.length > 0 ? clean : null;
}

/** The item time may be recorded on: live, visible, in an unarchived project (decision 261); closed items too. */
async function loadTrackableItem(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, workItemId: string): Promise<WorkItemGateRow> {
    const item = await WorkItemRepository.findVisible(db, ctx, v, workItemId);
    if (!item) throw notFound('Work item not found');
    assertProjectWritable(item.project);
    return item;
}

/** Refuse a day that would hold more than 24 hours with `minutes` added. */
async function assertDayHolds(db: PrismaTx, ctx: RequestContext, userId: string, date: string, minutes: number, exceptId?: string): Promise<void> {
    const used = await TimeEntryRepository.dayTotal(db, ctx, userId, dateOnlyValue(date), exceptId);
    if (used + minutes > TIME_LIMITS.minutesMax) throw dayFull(date, Math.max(0, TIME_LIMITS.minutesMax - used));
}

async function auditEntry(
    db: PrismaTx,
    ctx: RequestContext,
    action: 'TIME_ENTRY_CREATED' | 'TIME_ENTRY_UPDATED' | 'TIME_ENTRY_DELETED',
    row: Pick<TimeEntryRow, 'id' | 'workItemId' | 'projectId' | 'workDate' | 'minutes' | 'billable' | 'source'>,
    details: string,
    extra: { changedFields?: string[]; metadata?: Record<string, unknown> } = {},
): Promise<void> {
    const operation = action === 'TIME_ENTRY_CREATED' ? 'created' : action === 'TIME_ENTRY_UPDATED' ? 'updated' : 'deleted';
    await logEvent(db, ctx, {
        action,
        entityType: 'TimeEntry',
        entityId: row.id,
        details,
        detailsJson: {
            category: 'entity_lifecycle',
            entityName: 'TimeEntry',
            operation,
            ...(extra.changedFields ? { changedFields: extra.changedFields } : {}),
        },
        // Numbers, dates and ids: never the description (docs/porting/maps/3.4.md, "Privacy, audit and encryption").
        metadata: {
            workItemId: row.workItemId,
            projectId: row.projectId,
            workDate: dateKeyOf(row.workDate),
            minutes: row.minutes,
            billable: row.billable,
            timer: row.source === 'TIMER',
            ...extra.metadata,
        },
    });
}

// ─── Add, change, delete ────────────────────────────────────────────

export interface AddTimeEntryInput {
    workItemId: string;
    workDate: string;
    minutes: number;
    billable?: boolean;
    description?: string | null;
}

/** Add time to an item by hand (`time.track`, a person). */
export async function addTimeEntry(ctx: RequestContext, input: AddTimeEntryInput): Promise<TimeEntryData> {
    await assertRecordsTime(ctx, 'add');
    const description = descriptionOf(input.description);
    const row = await freezeAware(runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        await lockWeeks(db, ctx, ctx.userId, [input.workDate]);
        const item = await loadTrackableItem(db, ctx, v, input.workItemId);
        await assertDayHolds(db, ctx, ctx.userId, input.workDate, input.minutes);
        const created = await TimeEntryRepository.create(db, ctx, {
            userId: ctx.userId,
            workItemId: item.id,
            projectId: item.projectId,
            workDate: dateOnlyValue(input.workDate),
            minutes: input.minutes,
            timerStartedAt: null,
            source: 'MANUAL',
            // The project's default (3.4d, decision 271) unless the person says otherwise.
            billable: input.billable ?? item.project.timeBillableByDefault,
            description,
        });
        await auditEntry(db, ctx, 'TIME_ENTRY_CREATED', created, `Added ${formatDuration(input.minutes)} on ${keyOf(item)} for ${input.workDate}`);
        return created;
    }));
    recordTimeEntryRecorded({ source: 'manual' });
    return toEntryData(row);
}

export interface UpdateTimeEntryInput {
    workItemId?: string;
    workDate?: string;
    minutes?: number;
    billable?: boolean;
    description?: string | null;
}

/** Change one's own finished entry (`If-Match` optional; 409 `VERSION_CONFLICT`). */
export async function updateTimeEntry(ctx: RequestContext, id: string, input: UpdateTimeEntryInput, expectedVersion?: number): Promise<TimeEntryData> {
    await assertRecordsTime(ctx, 'change');
    const description = input.description === undefined ? undefined : descriptionOf(input.description);
    return freezeAware(runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const before = await TimeEntryRepository.get(db, ctx, id);
        // Another person's entry is not the caller's to change (decision 267): the same 404 as a missing one.
        if (!before || before.userId !== ctx.userId) entryNotFound();
        if (before.minutes === null) throw timerOn();
        const fromDate = dateKeyOf(before.workDate);
        const toDate = input.workDate ?? fromDate;
        await lockWeeks(db, ctx, ctx.userId, [fromDate, toDate]);
        // The entry's current item must still take time (decision 261), and so must a new one.
        const targetItemId = input.workItemId ?? before.workItemId;
        if (!targetItemId) throw new ConflictError('This entry\'s item was deleted; it can be deleted, not changed.', { reason: 'ITEM_DELETED' });
        const item = await loadTrackableItem(db, ctx, v, targetItemId);
        const minutes = input.minutes ?? before.minutes;
        if (input.minutes !== undefined || input.workDate !== undefined) await assertDayHolds(db, ctx, ctx.userId, toDate, minutes, before.id);
        const patch: TimeEntryPatch = {};
        const changed: string[] = [];
        if (input.workItemId !== undefined && input.workItemId !== before.workItemId) {
            patch.workItemId = item.id;
            // The project the time is recorded in follows a NEW item (decision 261 keeps it on a move, not on a re-pick).
            patch.projectId = item.projectId;
            changed.push('workItemId');
            if (item.projectId !== before.projectId) changed.push('projectId');
        }
        if (input.workDate !== undefined && input.workDate !== fromDate) {
            patch.workDate = dateOnlyValue(input.workDate);
            changed.push('workDate');
        }
        if (input.minutes !== undefined && input.minutes !== before.minutes) {
            patch.minutes = input.minutes;
            changed.push('minutes');
        }
        if (input.billable !== undefined && input.billable !== before.billable) {
            patch.billable = input.billable;
            changed.push('billable');
        }
        if (description !== undefined && description !== before.description) {
            patch.description = description;
            changed.push('description');
        }
        if (changed.length === 0) {
            if (expectedVersion !== undefined && expectedVersion !== before.version) throw versionConflict(before);
            return toEntryData(before);
        }
        const count = await TimeEntryRepository.updateVersioned(db, ctx, id, ctx.userId, expectedVersion, patch);
        if (count === 0) {
            const current = await TimeEntryRepository.get(db, ctx, id);
            if (!current || current.userId !== ctx.userId) entryNotFound();
            throw versionConflict(current);
        }
        const after = (await TimeEntryRepository.get(db, ctx, id))!;
        await auditEntry(db, ctx, 'TIME_ENTRY_UPDATED', after, `Changed a time entry on ${keyOf(item)}`, {
            changedFields: changed,
            metadata: { fromWorkDate: fromDate, fromMinutes: before.minutes },
        });
        return toEntryData(after);
    }));
}

function versionConflict(current: TimeEntryRow): ConflictError {
    return new ConflictError('The entry changed since you read it.', { reason: 'VERSION_CONFLICT', version: current.version, entry: toEntryData(current) });
}

/**
 * Delete one's own entry for good (decision 277): the audit keeps its date
 * and minutes. A running timer deleted this way is discarded.
 */
export async function deleteTimeEntry(ctx: RequestContext, id: string): Promise<void> {
    await assertRecordsTime(ctx, 'delete');
    await freezeAware(runInTenantContext(ctx, async (db) => {
        const before = await TimeEntryRepository.get(db, ctx, id);
        if (!before || before.userId !== ctx.userId) entryNotFound();
        if (before.minutes === null) await lockTimer(db, ctx, ctx.userId);
        await lockWeeks(db, ctx, ctx.userId, [dateKeyOf(before.workDate)]);
        const count = await TimeEntryRepository.delete(db, ctx, id, ctx.userId);
        if (count === 0) entryNotFound();
        await auditEntry(db, ctx, 'TIME_ENTRY_DELETED', before, before.minutes === null ? 'Discarded a timer' : `Deleted ${formatDuration(before.minutes)} of time for ${dateKeyOf(before.workDate)}`, {
            metadata: before.minutes === null ? { discarded: true } : {},
        });
    }));
}

// ─── The timer ──────────────────────────────────────────────────────

/**
 * Stop `running` in `db` with `stated` minutes or the minutes it counted:
 * record it (within the day's 24 hours), or discard it when it ran under 30
 * seconds. The caller holds the timer lock. Returns the finished row, or null
 * when discarded.
 */
async function stopRunningInTx(
    db: PrismaTx,
    ctx: RequestContext,
    running: TimeEntryRow,
    opts: { stated?: number; now: Date; reason: 'stopped' | 'replaced' | 'member_removed' },
): Promise<TimeEntryRow | null> {
    const workDate = dateKeyOf(running.workDate);
    await lockWeeks(db, ctx, running.userId, [workDate]);
    const counted = timerMinutes(running.timerStartedAt!, opts.now);
    if (opts.stated !== undefined && opts.stated > counted) {
        throw badRequest(`The timer counted ${counted === 0 ? 'under a minute' : formatDuration(counted)}; state that or less.`, { reason: 'TIMER_MINUTES', countedMinutes: counted });
    }
    let minutes = opts.stated ?? counted;
    if (opts.reason === 'member_removed') {
        // The removal must not fail on a full day: what the day still holds is recorded, or nothing.
        const used = await TimeEntryRepository.dayTotal(db, ctx, running.userId, running.workDate, running.id);
        minutes = Math.min(minutes, Math.max(0, TIME_LIMITS.minutesMax - used));
    }
    if (minutes === 0) {
        await TimeEntryRepository.delete(db, ctx, running.id, running.userId);
        await auditEntry(db, ctx, 'TIME_ENTRY_DELETED', running, 'Discarded a timer that ran under 30 seconds', { metadata: { discarded: true, reason: opts.reason } });
        return null;
    }
    if (opts.reason !== 'member_removed') await assertDayHolds(db, ctx, running.userId, workDate, minutes, running.id);
    const count = await TimeEntryRepository.finishTimer(db, ctx, running.id, running.userId, minutes);
    if (count === 0) throw new ConflictError('The timer was stopped elsewhere.', { reason: 'TIMER_OFF' });
    const finished = (await TimeEntryRepository.get(db, ctx, running.id))!;
    await auditEntry(db, ctx, 'TIME_ENTRY_UPDATED', finished, `Stopped a timer at ${formatDuration(minutes)}`, {
        changedFields: ['minutes'],
        metadata: { countedMinutes: counted, reason: opts.reason },
    });
    return finished;
}

/**
 * Start a timer on an item (decision 262): in one transaction, stop and
 * record the person's timer if one is on, then start a new one dated today in
 * the browser's zone (decision 263).
 */
export async function startTimer(ctx: RequestContext, input: { workItemId: string; timeZone: string }): Promise<RunningTimerData> {
    await assertRecordsTime(ctx, 'start_timer');
    const zone = input.timeZone.trim();
    if (!isKnownTimeZone(zone)) {
        throw badRequest(`${zone || 'That'} is not a time zone (an IANA name such as Europe/Sofia).`, { reason: 'TIME_ZONE_UNKNOWN' });
    }
    const now = new Date();
    const today = dayKeyInTz(todayClock(zone, now), zone);
    let replaced = false;
    const result = await freezeAware(runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        await lockTimer(db, ctx, ctx.userId);
        const item = await loadTrackableItem(db, ctx, v, input.workItemId);
        const running = await TimeEntryRepository.running(db, ctx, ctx.userId);
        // Both weeks (the running timer's and today's) in date order before either is touched.
        await lockWeeks(db, ctx, ctx.userId, running ? [dateKeyOf(running.workDate), today] : [today]);
        if (running) {
            await stopRunningInTx(db, ctx, running, { now, reason: 'replaced' });
            replaced = true;
        }
        let created: TimeEntryRow;
        try {
            created = await TimeEntryRepository.create(db, ctx, {
                userId: ctx.userId,
                workItemId: item.id,
                projectId: item.projectId,
                workDate: dateOnlyValue(today),
                minutes: null,
                timerStartedAt: now,
                source: 'TIMER',
                // The project's default (3.4d, decision 271); changed on the entry once it is stopped.
                billable: item.project.timeBillableByDefault,
                description: null,
            });
        } catch (err) {
            if (isUniqueViolation(err)) throw timerOn();
            throw err;
        }
        await auditEntry(db, ctx, 'TIME_ENTRY_CREATED', created, `Started a timer on ${keyOf(item)}`);
        return { created, item };
    }));
    if (replaced) recordTimeEntryRecorded({ source: 'timer' });
    return runningData(result.created, itemOf(result.item), now);
}

function runningData(row: TimeEntryRow, item: TimeEntryItem, now: Date): RunningTimerData {
    return {
        entry: toEntryData(row),
        timerStartedAt: row.timerStartedAt!.toISOString(),
        item,
        serverNow: now.toISOString(),
        stoppedCounting: timerStoppedCounting(row.timerStartedAt!, now),
    };
}

/**
 * Stop the person's timer (decision 263): record the whole minutes it
 * counted (at most 12 hours), or `minutes` when the person states fewer; a
 * timer under 30 seconds is discarded (`{ entry: null }`).
 */
export async function stopTimer(ctx: RequestContext, input: { minutes?: number } = {}): Promise<{ entry: TimeEntryData | null; discarded: boolean }> {
    await assertRecordsTime(ctx, 'stop_timer');
    const now = new Date();
    const finished = await freezeAware(runInTenantContext(ctx, async (db) => {
        await lockTimer(db, ctx, ctx.userId);
        const running = await TimeEntryRepository.running(db, ctx, ctx.userId);
        if (!running) throw new ConflictError('Your timer is not on.', { reason: 'TIMER_OFF' });
        return stopRunningInTx(db, ctx, running, { stated: input.minutes, now, reason: 'stopped' });
    }));
    if (finished) recordTimeEntryRecorded({ source: 'timer' });
    return { entry: finished ? toEntryData(finished) : null, discarded: finished === null };
}

/** The caller's running timer, if any, with its item (the top chrome reads it on focus). */
export async function getRunningTimer(ctx: RequestContext): Promise<{ timer: RunningTimerData | null }> {
    assertCanTrackTime(ctx);
    const now = new Date();
    return runInTenantContext(ctx, async (db) => {
        const running = await TimeEntryRepository.running(db, ctx, ctx.userId);
        if (!running) return { timer: null };
        const v = await visibleProjects(ctx, db);
        const [item] = running.workItemId ? await WorkItemRepository.listByIds(db, ctx, v, [running.workItemId]) : [];
        return { timer: runningData(running, item ? itemOf(item) : itemFor(running.workItemId, new Map(), v), now) };
    });
}

/**
 * Member removal (`removeTenantMember`, in its transaction): the member's
 * timer stops and is recorded, as the map says, within what its day still
 * holds; their entries stay (decision 277). Returns whether one was on.
 */
export async function stopTimerOfRemovedMemberInTx(db: PrismaTx, ctx: RequestContext, userId: string): Promise<boolean> {
    await lockTimer(db, ctx, userId);
    const running = await TimeEntryRepository.running(db, ctx, userId);
    if (!running) return false;
    await stopRunningInTx(db, ctx, running, { now: new Date(), reason: 'member_removed' });
    return true;
}

// ─── Reads ──────────────────────────────────────────────────────────

/**
 * A person's week (Monday to Sunday holding `week`): their entries with the
 * items' keys and titles, the day totals and the week's total (finished
 * entries only; a running timer is listed with no minutes). One's own with
 * `time.track`; another member's with `time.approve` (decision 266).
 */
export async function getTimeWeek(ctx: RequestContext, input: { week: string; userId?: string }): Promise<TimeWeekData> {
    const userId = input.userId ?? ctx.userId;
    const own = userId === ctx.userId;
    if (own) assertCanTrackTime(ctx);
    else if (!mayApproveTime(ctx)) await refuseOthersWeek(ctx, userId);
    const weekStart = weekStartOf(input.week);
    const weekEnd = addDays(weekStart, 6);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const rows = await TimeEntryRepository.listForPerson(db, ctx, userId, dateOnlyValue(weekStart), dateOnlyValue(weekEnd));
        if (rows.length > WEEK_ENTRIES_TAKE) {
            throw new AppError(`This week holds more than ${WEEK_ENTRIES_TAKE} entries.`, 'TIME_WEEK_TOO_LARGE', 422, true, { reason: 'TIME_WEEK_TOO_LARGE', limit: WEEK_ENTRIES_TAKE });
        }
        const itemIds = [...new Set(rows.map((r) => r.workItemId).filter((id): id is string => id !== null))];
        const items = new Map<string, TimeEntryItem>((itemIds.length > 0 ? await WorkItemRepository.listByIds(db, ctx, v, itemIds) : []).map((i) => [i.id, itemOf(i)]));
        const totals = new Map<string, number>();
        for (const r of rows) {
            if (r.minutes !== null) totals.set(dateKeyOf(r.workDate), (totals.get(dateKeyOf(r.workDate)) ?? 0) + r.minutes);
        }
        const dayTotals = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((date) => ({ date, minutes: totals.get(date) ?? 0 }));
        return {
            userId,
            weekStart,
            entries: rows.map((r) => ({ ...toEntryData(r), item: itemFor(r.workItemId, items, v) })),
            dayTotals,
            totalMinutes: dayTotals.reduce((s, d) => s + d.minutes, 0),
            // Whether the week is frozen (3.4c) is the timesheet read's (`GET /timesheets/week`):
            // this read stays the statements it was, and the trigger refuses a write regardless.
            viewer: { edit: own && mayTrackTime(ctx) && recordsTimeAsPerson(ctx) },
        };
    });
}

/**
 * An item's time (decision 266): its total and the caller's own, and its
 * finished entries newest first, a page of 50. A `time.view` holder sees
 * everyone's entries and the total; a caller with `time.track` alone sees
 * only their own entries and total. Amounts never (3.4d).
 */
export async function getWorkItemTime(ctx: RequestContext, workItemId: string, input: { cursor?: string } = {}): Promise<WorkItemTimeData> {
    assertCanReadWorkItems(ctx);
    const viewAll = mayViewTime(ctx);
    const track = mayTrackTime(ctx);
    if (!viewAll && !track) {
        await appendAuditEntryOrQueue({
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            actorType: ctx.apiKeyId ? 'API_KEY' : (ctx.actorType ?? 'USER'),
            entity: 'WorkItem',
            entityId: workItemId,
            action: 'AUTHZ_DENIED',
            details: "An item's time refused: neither time.view nor time.track held",
            detailsJson: { category: 'access', event: 'authz_denied', reason: 'TIME_VIEW_REQUIRED', role: ctx.role },
            requestId: ctx.requestId,
            metadataJson: { role: ctx.role, verb: 'read_item_time', reason: 'TIME_VIEW_REQUIRED' },
        });
        throw forbidden('You do not have permission to see time.', { reason: 'TIME_VIEW_REQUIRED' });
    }
    let cursor;
    try {
        cursor = input.cursor ? decodeCursor(input.cursor, ITEM_TIME_ORDER) : undefined;
    } catch (err) {
        if (err instanceof InvalidCursorError) throw badRequest('That page cursor is not valid.', { reason: 'INVALID_CURSOR' });
        throw err;
    }
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const item = await WorkItemRepository.findVisible(db, ctx, v, workItemId);
        if (!item) throw notFound('Work item not found');
        // One transaction client: the two reads run one after the other.
        const totals = await TimeEntryRepository.itemTotals(db, ctx, workItemId, ctx.userId);
        const rows = await TimeEntryRepository.itemPage(db, ctx, workItemId, { limit: TIME_LIMITS.itemPage, cursor, ...(viewAll ? {} : { onlyUserId: ctx.userId }) });
        const page = computeKeysetPage(rows, TIME_LIMITS.itemPage, ITEM_TIME_ORDER);
        return {
            workItemId,
            totalMinutes: viewAll ? totals.total : null,
            ownMinutes: totals.own,
            entries: page.items.map((r) => ({ ...toEntryData(r), personName: r.user.name })),
            pageInfo: page.pageInfo,
            billableByDefault: item.project.timeBillableByDefault,
            viewer: { track: track && recordsTimeAsPerson(ctx) && !item.project.archivedAt, viewAll },
        };
    });
}
