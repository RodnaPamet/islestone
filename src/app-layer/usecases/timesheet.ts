/**
 * Timesheets and their approval (sub-phase 3.4c; docs/porting/maps/3.4.md,
 * "Timesheets and approval (3.4c)"; ADR 0012 §5; owner decisions 256, 268 to
 * 270, 276 and 278; docs/time-tracking.md). The only writer of `Timesheet`
 * and `TenantTimeSettings`.
 *
 *   - **Off by default** (decision 268): an Owner or Admin (`admin.manage`)
 *     turns on "Timesheets need approval". Turning it off leaves submitted
 *     weeks as they are: they can still be decided, and taken back.
 *   - **A week** is Monday to Sunday by each entry's date; its row names the
 *     Monday. No row is a week not submitted.
 *   - **Submit, Approve, Return** (decision 256). A person submits their own
 *     week (`time.track`), not one that starts after today and not while one
 *     of its timers is on; anyone holding `time.approve` approves or returns
 *     it, never their own (decision 269: audited 403 `OWN_TIMESHEET`). The
 *     person takes a submitted week back until it is decided (WITHDRAWN); an
 *     approver reopens an approved week with an explanation (RETURNED again).
 *   - **The freeze** (decision 270) is the trigger `time_entry_week_frozen`:
 *     SUBMITTED and APPROVED weeks' entries do not change. Every act here
 *     takes the week's advisory lock first (`timeWeekLockKey`, the key 3.4b's
 *     entry writes take), then the row `FOR UPDATE`, and claims the row with
 *     one conditional update naming the statuses it starts from and the
 *     version it read.
 *   - **A person's act only** (decision 278): never an API key, an agent, a
 *     job or the system user (audited 403 `NOT_A_PERSON`).
 *   - **Notifications** (decision 276) are rung after the commit
 *     (`emitTimesheetNotices`): whoever approves on a submit, the person on a
 *     return (with an immediate email), a reopening and an approval. Audit
 *     entries and notices carry numbers, dates and ids, never the
 *     explanation's text.
 *
 * Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import { resolveRate } from '../domain/billable-rate';
import { enqueueEmail } from '../notifications/enqueue';
import { resolveListRecipients } from '../notifications/recipient-list';
import { memberDeliveries } from '../notifications/settings';
import { createTimesheetNotifications, weekLabel, type TimesheetNotice } from '../notifications/timesheet';
import { visibleProjects } from '../policies/project-visibility';
import { mayApproveTime, mayManageRates, mayTrackTime, mayViewTime, recordsTimeAsPerson } from '../policies/time.policies';
import { mayManageWorkConfig } from '../policies/work-config.policies';
import { BillableRateRepository } from '../repositories/BillableRateRepository';
import { MembershipRepository } from '../repositories/MembershipRepository';
import { TimeEntryRepository, WEEK_ENTRIES_TAKE } from '../repositories/TimeEntryRepository';
import { DECIDED_TIMESHEET_ORDER, PENDING_TIMESHEET_ORDER, TimesheetRepository, type TimesheetRow } from '../repositories/TimesheetRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import type { RequestContext } from '../types';
import { dayKeyInTz } from '../notifications/work-item-due';
import { loadWeekRateBookInTx } from './billable-rate';
import { assertRecordsTime, itemFor, itemOf, refuseNotAPerson, refuseOthersWeek, timeWeekLockKey, toEntryData } from './time-entry';
import { notificationsTz } from './work-item-shared';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { appendAuditEntryOrQueue } from '@/lib/audit';
import { todayClock } from '@/lib/clock';
import { AppError, ConflictError, badRequest, forbidden, notFound } from '@/lib/errors/types';
import { logger } from '@/lib/observability/logger';
import { recordTimesheetDecided } from '@/lib/observability/business-metrics';
import { computeKeysetPage, decodeCursor, InvalidCursorError } from '@/lib/pagination';
import { permissionsForMembership } from '@/lib/permissions';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { isCurrencyCode } from '@/lib/time/money';
import type { TimeEntryItem } from '@/lib/time/entries';
import {
    TIMESHEET_LIMITS,
    isFrozenStatus,
    type TimeSettingsData,
    type TimesheetData,
    type TimesheetDetailData,
    type TimesheetListData,
    type TimesheetWeekData,
    type WeekSums,
} from '@/lib/time/timesheets';
import { addDays, dateKeyOf, dateOnlyValue, weekStartOf } from '@/lib/time/week';

/** The memberships read to find who approves weeks when no recipient list is set (the most senior first). */
const APPROVER_SCAN = 1_000;

// ─── Shapes and refusals ────────────────────────────────────────────

function toTimesheetData(row: TimesheetRow, names: ReadonlyMap<string, string | null> = new Map()): TimesheetData {
    return {
        id: row.id,
        userId: row.userId,
        weekStart: dateKeyOf(row.weekStart),
        status: row.status,
        submittedAt: row.submittedAt.toISOString(),
        decidedAt: row.decidedAt?.toISOString() ?? null,
        decidedByUserId: row.decidedByUserId,
        decidedByName: row.decidedByUserId ? (names.get(row.decidedByUserId) ?? null) : null,
        returnExplanation: row.returnExplanation,
        version: row.version,
    };
}

function versionConflict(current: TimesheetRow): ConflictError {
    return new ConflictError('The timesheet changed since you read it.', { reason: 'VERSION_CONFLICT', version: current.version, timesheet: toTimesheetData(current) });
}

function timesheetNotFound(): never {
    throw notFound('Timesheet not found');
}

/** Today in `NOTIFICATIONS_TZ` through the clock seam: a week starting after it is not submitted. */
function today(): string {
    const zone = notificationsTz();
    return dayKeyInTz(todayClock(zone), zone);
}

/** The explanation stored: sanitised, trimmed, 1 to 2,000 characters of plaintext. */
function explanationOf(raw: string): string {
    const clean = sanitizePlainText(raw).trim();
    if (clean.length === 0) throw badRequest('Say why: an explanation is required.', { reason: 'TIMESHEET_EXPLANATION_REQUIRED' });
    if (clean.length > TIMESHEET_LIMITS.explanationMax) {
        throw badRequest(`An explanation is at most ${TIMESHEET_LIMITS.explanationMax} characters.`, { reason: 'TIMESHEET_EXPLANATION_LENGTH' });
    }
    return clean;
}

/** The gate of a decision: `time.approve`, then a person (decisions 269 and 278). */
async function assertDecidesTime(ctx: RequestContext, verb: string): Promise<void> {
    if (!mayApproveTime(ctx)) throw forbidden('You do not have permission to decide timesheets.');
    if (!recordsTimeAsPerson(ctx)) await refuseNotAPerson(ctx, verb);
}

/** A decision on one's own week (decision 269): an audited 403, as a `requirePermission` denial. */
async function refuseOwnWeek(ctx: RequestContext, timesheetId: string, verb: string): Promise<never> {
    await appendAuditEntryOrQueue({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        actorType: ctx.apiKeyId ? 'API_KEY' : (ctx.actorType ?? 'USER'),
        entity: 'Timesheet',
        entityId: timesheetId,
        action: 'AUTHZ_DENIED',
        details: 'Timesheet decision refused: own week',
        detailsJson: { category: 'access', event: 'authz_denied', reason: 'OWN_TIMESHEET', role: ctx.role },
        requestId: ctx.requestId,
        metadataJson: { role: ctx.role, verb, reason: 'OWN_TIMESHEET' },
    });
    throw forbidden('Nobody decides their own timesheet; another approver does.', { reason: 'OWN_TIMESHEET' });
}

async function lockWeek(db: PrismaTx, ctx: RequestContext, userId: string, weekStart: string): Promise<void> {
    await db.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, timeWeekLockKey(ctx.tenantId, userId, weekStart));
}

async function auditDecision(
    db: PrismaTx,
    ctx: RequestContext,
    action: 'TIMESHEET_SUBMITTED' | 'TIMESHEET_WITHDRAWN' | 'TIMESHEET_APPROVED' | 'TIMESHEET_RETURNED' | 'TIMESHEET_REOPENED',
    row: Pick<TimesheetRow, 'id' | 'userId' | 'weekStart'>,
    fromStatus: string | null,
    toStatus: string,
    details: string,
    metadata: Record<string, unknown> = {},
): Promise<void> {
    await logEvent(db, ctx, {
        action,
        entityType: 'Timesheet',
        entityId: row.id,
        details,
        detailsJson: { category: 'status_change', entityName: 'Timesheet', fromStatus, toStatus },
        // The week, the person and numbers: never an explanation (docs/porting/maps/3.4.md, "Privacy, audit and encryption").
        metadata: { userId: row.userId, weekStart: dateKeyOf(row.weekStart), ...metadata },
    });
}

// ─── Settings ───────────────────────────────────────────────────────

/** The workspace's time tracking settings (read under `time.view`, or by whoever may change them). */
export async function getTimeSettings(ctx: RequestContext): Promise<TimeSettingsData> {
    const manage = mayManageWorkConfig(ctx);
    if (!mayViewTime(ctx) && !manage && !mayManageRates(ctx)) throw forbidden('You do not have permission to see the time tracking settings.');
    return runInTenantContext(ctx, async (db) => settingsData(ctx, await TimesheetRepository.settings(db, ctx)));
}

function settingsData(
    ctx: RequestContext,
    row: { approvalRequired: boolean; approvalRecipientListId: string | null; currency: string | null; version: number } | null,
): TimeSettingsData {
    const manage = mayManageWorkConfig(ctx);
    return {
        approvalRequired: row?.approvalRequired ?? false,
        approvalRecipientListId: row?.approvalRecipientListId ?? null,
        currency: row?.currency ?? null,
        version: row?.version ?? 0,
        viewer: { manage, currency: manage && mayManageRates(ctx) },
    };
}

/**
 * Change the settings (`admin.manage`; decision 268: an Owner or Admin turns
 * approval on). `If-Match` optional; a list must be a live list of the
 * workspace itself. The currency (3.4d, decision 273) also asks `time.rates`,
 * must be an ISO 4217 code, and is not changed while any rate exists (409
 * `CURRENCY_IN_USE`). Audited `TIME_SETTINGS_SET` naming the fields.
 */
export async function setTimeSettings(
    ctx: RequestContext,
    input: { approvalRequired?: boolean; approvalRecipientListId?: string | null; currency?: string | null },
    expectedVersion?: number,
): Promise<TimeSettingsData> {
    if (!mayManageWorkConfig(ctx)) throw forbidden('You do not have permission to change the time tracking settings.');
    return runInTenantContext(ctx, async (db) => {
        await TimesheetRepository.lockSettings(db, ctx);
        const before = await TimesheetRepository.settings(db, ctx);
        const current = {
            approvalRequired: before?.approvalRequired ?? false,
            approvalRecipientListId: before?.approvalRecipientListId ?? null,
            currency: before?.currency ?? null,
        };
        const currentVersion = before?.version ?? 0;
        if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
            throw new ConflictError('The settings changed since you read them.', { reason: 'VERSION_CONFLICT', version: currentVersion });
        }
        const next = {
            approvalRequired: input.approvalRequired ?? current.approvalRequired,
            approvalRecipientListId: input.approvalRecipientListId === undefined ? current.approvalRecipientListId : input.approvalRecipientListId,
            currency: input.currency === undefined ? current.currency : input.currency,
        };
        if (next.approvalRecipientListId && next.approvalRecipientListId !== current.approvalRecipientListId) {
            if (!(await TimesheetRepository.isLiveWorkspaceList(db, ctx, next.approvalRecipientListId))) {
                throw badRequest('Name a live recipient list of the workspace.', { reason: 'RECIPIENT_LIST_UNKNOWN' });
            }
        }
        if (next.currency !== current.currency) {
            // Money is the rate holders' (decision 274), and one currency per workspace (decision 273).
            if (!mayManageRates(ctx)) throw forbidden('You do not have permission to set the currency.', { reason: 'TIME_RATES_REQUIRED' });
            if (next.currency !== null && !isCurrencyCode(next.currency)) throw badRequest('Name an ISO 4217 currency, such as EUR.', { reason: 'CURRENCY_UNKNOWN' });
            if (await BillableRateRepository.any(db, ctx)) {
                throw new ConflictError('The currency is not changed while rates exist in it.', { reason: 'CURRENCY_IN_USE' });
            }
        }
        const changed = (Object.keys(next) as Array<keyof typeof next>).filter((k) => next[k] !== current[k]);
        if (changed.length > 0) {
            const count = await TimesheetRepository.writeSettings(db, ctx, next, before ? currentVersion : undefined, before !== null);
            if (count === 0) throw new ConflictError('The settings changed since you read them.', { reason: 'VERSION_CONFLICT' });
            await logEvent(db, ctx, {
                action: 'TIME_SETTINGS_SET',
                entityType: 'TenantTimeSettings',
                entityId: ctx.tenantId,
                details: `Changed the time tracking settings (${changed.join(', ')})`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'TenantTimeSettings', operation: 'updated', changedFields: changed },
                metadata: { approvalRequired: next.approvalRequired, approvalRecipientListId: next.approvalRecipientListId, currency: next.currency },
            });
        }
        return settingsData(ctx, await TimesheetRepository.settings(db, ctx));
    });
}

// ─── The person's acts ──────────────────────────────────────────────

/**
 * Submit one's own week (decisions 256, 268): approval on (409
 * `APPROVAL_OFF`), the week not starting after today (400 `WEEK_IN_FUTURE`),
 * no timer of it on (409 `TIMER_ON_IN_WEEK`), not already submitted or
 * approved; from no row, RETURNED or WITHDRAWN. An empty week is allowed.
 */
export async function submitTimesheet(ctx: RequestContext, input: { week: string }): Promise<TimesheetWeekData> {
    await assertRecordsTime(ctx, 'submit_timesheet');
    const weekStart = weekStartOf(input.week);
    if (weekStart > today()) throw badRequest('A week is submitted once it has begun.', { reason: 'WEEK_IN_FUTURE' });
    const now = new Date();
    const out = await runInTenantContext(ctx, async (db) => {
        const settings = await TimesheetRepository.settings(db, ctx);
        if (!settings?.approvalRequired) throw new ConflictError('Timesheets are not approved in this workspace.', { reason: 'APPROVAL_OFF' });
        await lockWeek(db, ctx, ctx.userId, weekStart);
        const existing = await TimesheetRepository.forWeek(db, ctx, ctx.userId, dateOnlyValue(weekStart));
        if (existing) await TimesheetRepository.lock(db, ctx, existing.id);
        if (existing?.status === 'SUBMITTED') throw new ConflictError('This week is already submitted.', { reason: 'TIMESHEET_SUBMITTED' });
        if (existing?.status === 'APPROVED') throw new ConflictError('This week is approved.', { reason: 'TIMESHEET_APPROVED' });
        const sums = await TimeEntryRepository.weekSums(db, ctx, ctx.userId, dateOnlyValue(weekStart), dateOnlyValue(addDays(weekStart, 6)));
        if (sums.timerOn) throw new ConflictError('Stop the timer counting in this week before you submit it.', { reason: 'TIMER_ON_IN_WEEK' });
        let row: TimesheetRow;
        if (existing) {
            const count = await TimesheetRepository.claim(db, ctx, existing.id, ['RETURNED', 'WITHDRAWN'], existing.version, {
                status: 'SUBMITTED',
                submittedAt: now,
                decidedAt: null,
                decidedByUserId: null,
                returnExplanation: null,
            });
            if (count === 0) throw versionConflict((await TimesheetRepository.get(db, ctx, existing.id))!);
            row = (await TimesheetRepository.get(db, ctx, existing.id))!;
        } else {
            row = await TimesheetRepository.createSubmitted(db, ctx, ctx.userId, dateOnlyValue(weekStart), now);
        }
        await auditDecision(db, ctx, 'TIMESHEET_SUBMITTED', row, existing?.status ?? null, 'SUBMITTED', `Submitted the timesheet for the week of ${weekStart}`, {
            minutes: sums.minutes,
            billableMinutes: sums.billableMinutes,
            entries: sums.entries,
        });
        const sumsOut: WeekSums = { minutes: sums.minutes, billableMinutes: sums.billableMinutes, entries: sums.entries };
        return {
            userId: ctx.userId,
            weekStart,
            approvalRequired: true,
            timesheet: toTimesheetData(row),
            frozen: true,
            timerOn: false,
            sums: sumsOut,
            viewer: { submit: false, withdraw: true, edit: false },
        } satisfies TimesheetWeekData;
    });
    await emitTimesheetNotices(ctx, [{ kind: 'submitted', timesheetId: out.timesheet!.id, version: out.timesheet!.version, weekStart, personUserId: ctx.userId }]);
    return out;
}

/** Take one's own submitted week back before it is decided (WITHDRAWN). `If-Match` optional. */
export async function withdrawTimesheet(ctx: RequestContext, id: string, expectedVersion?: number): Promise<TimesheetData> {
    await assertRecordsTime(ctx, 'withdraw_timesheet');
    return runInTenantContext(ctx, async (db) => {
        const found = await TimesheetRepository.get(db, ctx, id);
        // Another person's week is not the caller's to take back: the same 404 as a missing one.
        if (!found || found.userId !== ctx.userId) timesheetNotFound();
        await lockWeek(db, ctx, found.userId, dateKeyOf(found.weekStart));
        await TimesheetRepository.lock(db, ctx, id);
        const current = (await TimesheetRepository.get(db, ctx, id))!;
        if (current.status !== 'SUBMITTED') throw new ConflictError('Only a submitted week that is not yet decided is taken back.', { reason: 'TIMESHEET_NOT_SUBMITTED', status: current.status });
        if (expectedVersion !== undefined && expectedVersion !== current.version) throw versionConflict(current);
        const count = await TimesheetRepository.claim(db, ctx, id, ['SUBMITTED'], current.version, { status: 'WITHDRAWN', decidedAt: null, decidedByUserId: null, returnExplanation: null });
        if (count === 0) throw versionConflict((await TimesheetRepository.get(db, ctx, id))!);
        const after = (await TimesheetRepository.get(db, ctx, id))!;
        await auditDecision(db, ctx, 'TIMESHEET_WITHDRAWN', after, 'SUBMITTED', 'WITHDRAWN', `Took back the timesheet for the week of ${dateKeyOf(after.weekStart)}`);
        return toTimesheetData(after);
    });
}

// ─── The approver's acts ────────────────────────────────────────────

/**
 * Freeze the rates of a week being approved (3.4d, decision 273): each
 * billable finished entry takes the rate the cascade resolves on its date
 * now, stamped on it; an entry with no rate stays unstamped, and reads "No
 * rate" for as long as the week stays approved. Returns how many were stamped.
 */
async function stampWeekRates(db: PrismaTx, ctx: RequestContext, userId: string, from: Date, to: Date): Promise<number> {
    const entries = (await TimeEntryRepository.listForPerson(db, ctx, userId, from, to)).filter((e) => e.billable && e.minutes !== null);
    if (entries.length === 0) return 0;
    const book = await loadWeekRateBookInTx(db, ctx, userId, [...new Set(entries.map((e) => e.projectId))], to);
    const stamps = entries.flatMap((e) => {
        const rate = resolveRate(book, { projectId: e.projectId, userId, workDate: dateKeyOf(e.workDate) });
        return rate ? [{ id: e.id, hourlyRateMinor: rate.hourlyRateMinor, level: rate.level }] : [];
    });
    return TimeEntryRepository.stampFrozenRates(db, ctx, userId, from, to, stamps);
}

type Decision = { verb: 'approve' } | { verb: 'return'; explanation: string } | { verb: 'reopen'; explanation: string };

const DECISION_RULES = {
    approve: { from: 'SUBMITTED', to: 'APPROVED', action: 'TIMESHEET_APPROVED', notFrom: 'TIMESHEET_NOT_SUBMITTED', said: 'Approved' },
    return: { from: 'SUBMITTED', to: 'RETURNED', action: 'TIMESHEET_RETURNED', notFrom: 'TIMESHEET_NOT_SUBMITTED', said: 'Returned' },
    reopen: { from: 'APPROVED', to: 'RETURNED', action: 'TIMESHEET_REOPENED', notFrom: 'TIMESHEET_NOT_APPROVED', said: 'Reopened' },
} as const;

async function decide(ctx: RequestContext, id: string, decision: Decision, expectedVersion?: number): Promise<TimesheetData> {
    const rule = DECISION_RULES[decision.verb];
    await assertDecidesTime(ctx, `${decision.verb}_timesheet`);
    const explanation = decision.verb === 'approve' ? null : explanationOf(decision.explanation);
    const now = new Date();
    const result = await runInTenantContext(ctx, async (db) => {
        const found = await TimesheetRepository.get(db, ctx, id);
        if (!found) timesheetNotFound();
        // Nobody decides their own week: refused (and audited) after this transaction, before any lock.
        if (found.userId === ctx.userId) return { own: true as const };
        await lockWeek(db, ctx, found.userId, dateKeyOf(found.weekStart));
        await TimesheetRepository.lock(db, ctx, id);
        const current = await TimesheetRepository.get(db, ctx, id);
        if (!current) timesheetNotFound();
        if (current.status !== rule.from) {
            throw new ConflictError(rule.from === 'SUBMITTED' ? 'Only a submitted week is decided.' : 'Only an approved week is reopened.', { reason: rule.notFrom, status: current.status });
        }
        if (expectedVersion !== undefined && expectedVersion !== current.version) throw versionConflict(current);
        const count = await TimesheetRepository.claim(db, ctx, id, [rule.from], current.version, {
            status: rule.to,
            decidedAt: now,
            decidedByUserId: ctx.userId,
            returnExplanation: explanation,
        });
        if (count === 0) throw versionConflict((await TimesheetRepository.get(db, ctx, id))!);
        const after = (await TimesheetRepository.get(db, ctx, id))!;
        const weekStart = dateKeyOf(after.weekStart);
        const weekEnd = dateOnlyValue(addDays(weekStart, 6));
        // The rates (3.4d, decision 273): an approval freezes each billable entry's rate; a reopening clears them.
        let rates: Record<string, number> = {};
        if (decision.verb === 'approve') rates = { frozenRates: await stampWeekRates(db, ctx, after.userId, after.weekStart, weekEnd) };
        if (decision.verb === 'reopen') rates = { clearedRates: await TimeEntryRepository.clearFrozenRates(db, ctx, after.userId, after.weekStart, weekEnd) };
        const sums = await TimeEntryRepository.weekSums(db, ctx, after.userId, after.weekStart, weekEnd);
        await auditDecision(db, ctx, rule.action, after, rule.from, rule.to, `${rule.said} the timesheet for the week of ${weekStart}`, {
            minutes: sums.minutes,
            billableMinutes: sums.billableMinutes,
            entries: sums.entries,
            ...rates,
        });
        return { own: false as const, decided: after };
    });
    if (result.own) return refuseOwnWeek(ctx, id, decision.verb);
    const decided = result.decided;
    recordTimesheetDecided({ outcome: decision.verb === 'approve' ? 'approved' : decision.verb === 'return' ? 'returned' : 'reopened' });
    const weekStart = dateKeyOf(decided.weekStart);
    await emitTimesheetNotices(ctx, [
        decision.verb === 'approve'
            ? { kind: 'approved', timesheetId: decided.id, version: decided.version, weekStart, personUserId: decided.userId }
            : { kind: 'returned', timesheetId: decided.id, version: decided.version, weekStart, personUserId: decided.userId, reopened: decision.verb === 'reopen' },
    ]);
    return toTimesheetData(decided);
}

/** Approve a member's submitted week (`time.approve`, never one's own). */
export function approveTimesheet(ctx: RequestContext, id: string, expectedVersion?: number): Promise<TimesheetData> {
    return decide(ctx, id, { verb: 'approve' }, expectedVersion);
}

/** Return a member's submitted week with an explanation (decision 270). */
export function returnTimesheet(ctx: RequestContext, id: string, input: { explanation: string }, expectedVersion?: number): Promise<TimesheetData> {
    return decide(ctx, id, { verb: 'return', explanation: input.explanation }, expectedVersion);
}

/** Reopen a member's approved week with an explanation (decision 270): RETURNED again, audited and notified. */
export function reopenTimesheet(ctx: RequestContext, id: string, input: { explanation: string }, expectedVersion?: number): Promise<TimesheetData> {
    return decide(ctx, id, { verb: 'reopen', explanation: input.explanation }, expectedVersion);
}

// ─── Reads ──────────────────────────────────────────────────────────

/**
 * A person's week as My time's status line reads it: the settings' switch,
 * the row (none: not submitted), the sums and whether a timer counts in it,
 * and what the caller may do. One's own under `time.track`; another member's
 * with `time.approve` (decision 266, as the week read).
 */
export async function getTimesheetWeek(ctx: RequestContext, input: { week: string; userId?: string }): Promise<TimesheetWeekData> {
    const userId = input.userId ?? ctx.userId;
    const own = userId === ctx.userId;
    if (own) {
        if (!mayTrackTime(ctx)) throw forbidden('You do not have permission to record time.');
    } else if (!mayApproveTime(ctx)) await refuseOthersWeek(ctx, userId);
    const weekStart = weekStartOf(input.week);
    const started = weekStart <= today();
    return runInTenantContext(ctx, async (db) => {
        const settings = await TimesheetRepository.settings(db, ctx);
        const row = await TimesheetRepository.forWeek(db, ctx, userId, dateOnlyValue(weekStart));
        const sums = await TimeEntryRepository.weekSums(db, ctx, userId, dateOnlyValue(weekStart), dateOnlyValue(addDays(weekStart, 6)));
        const names = row?.decidedByUserId ? new Map((await MembershipRepository.contactsOf(db, [row.decidedByUserId])).map((c) => [c.id, c.name])) : new Map<string, string | null>();
        const approvalRequired = settings?.approvalRequired ?? false;
        const frozen = isFrozenStatus(row?.status);
        const acts = own && recordsTimeAsPerson(ctx);
        return {
            userId,
            weekStart,
            approvalRequired,
            timesheet: row ? toTimesheetData(row, names) : null,
            frozen,
            timerOn: sums.timerOn,
            sums: { minutes: sums.minutes, billableMinutes: sums.billableMinutes, entries: sums.entries },
            viewer: {
                submit: acts && approvalRequired && started && !frozen && !sums.timerOn,
                withdraw: acts && row?.status === 'SUBMITTED',
                edit: acts && !frozen,
            },
        };
    });
}

/**
 * The weeks waiting for a decision (oldest first) or decided in the last 12
 * weeks (newest first), 50 a page, each with its person, sums and who
 * decided (`time.approve`).
 */
export async function listTimesheets(ctx: RequestContext, input: { status: 'SUBMITTED' | 'DECIDED'; cursor?: string }): Promise<TimesheetListData> {
    if (!mayApproveTime(ctx)) throw forbidden('You do not have permission to decide timesheets.');
    const order = input.status === 'SUBMITTED' ? PENDING_TIMESHEET_ORDER : DECIDED_TIMESHEET_ORDER;
    let cursor;
    try {
        cursor = input.cursor ? decodeCursor(input.cursor, order) : undefined;
    } catch (err) {
        if (err instanceof InvalidCursorError) throw badRequest('That page cursor is not valid.', { reason: 'INVALID_CURSOR' });
        throw err;
    }
    const since = dateOnlyValue(addDays(weekStartOf(today()), -7 * (TIMESHEET_LIMITS.decidedWeeks - 1)));
    return runInTenantContext(ctx, async (db) => {
        const rows = await TimesheetRepository.page(db, ctx, input.status === 'SUBMITTED' ? { kind: 'SUBMITTED' } : { kind: 'DECIDED', since }, { limit: TIMESHEET_LIMITS.page, cursor });
        const page = computeKeysetPage(rows, TIMESHEET_LIMITS.page, order);
        const sums = await TimeEntryRepository.sumsForWeeks(db, ctx, page.items.map((r) => ({ userId: r.userId, weekStart: r.weekStart })));
        const deciders = [...new Set(page.items.map((r) => r.decidedByUserId).filter((x): x is string => x !== null))];
        const names = new Map((await MembershipRepository.contactsOf(db, deciders)).map((c) => [c.id, c.name]));
        return {
            rows: page.items.map((r) => ({
                ...toTimesheetData(r, names),
                personName: r.user.name,
                sums: sums.get(`${r.userId}:${dateKeyOf(r.weekStart)}`) ?? { minutes: 0, billableMinutes: 0, entries: 0 },
            })),
            pageInfo: page.pageInfo,
        };
    });
}

/**
 * One member's submitted or decided week with its entries, read-only
 * (`time.approve`): the approver's own read of the week (decision 266), and
 * what they may do with it.
 */
export async function getTimesheet(ctx: RequestContext, id: string): Promise<TimesheetDetailData> {
    if (!mayApproveTime(ctx)) throw forbidden('You do not have permission to decide timesheets.');
    return runInTenantContext(ctx, async (db) => {
        const row = await TimesheetRepository.get(db, ctx, id);
        if (!row) timesheetNotFound();
        const weekStart = dateKeyOf(row.weekStart);
        const v = await visibleProjects(ctx, db);
        const entries = await TimeEntryRepository.listForPerson(db, ctx, row.userId, row.weekStart, dateOnlyValue(addDays(weekStart, 6)));
        if (entries.length > WEEK_ENTRIES_TAKE) {
            throw new AppError(`This week holds more than ${WEEK_ENTRIES_TAKE} entries.`, 'TIME_WEEK_TOO_LARGE', 422, true, { reason: 'TIME_WEEK_TOO_LARGE', limit: WEEK_ENTRIES_TAKE });
        }
        const itemIds = [...new Set(entries.map((e) => e.workItemId).filter((x): x is string => x !== null))];
        const items = new Map<string, TimeEntryItem>((itemIds.length > 0 ? await WorkItemRepository.listByIds(db, ctx, v, itemIds) : []).map((i) => [i.id, itemOf(i)]));
        const people = await MembershipRepository.contactsOf(db, [...new Set([row.userId, ...(row.decidedByUserId ? [row.decidedByUserId] : [])])]);
        const names = new Map(people.map((p) => [p.id, p.name]));
        const totals = new Map<string, number>();
        let minutes = 0;
        let billable = 0;
        let count = 0;
        for (const e of entries) {
            if (e.minutes === null) continue;
            totals.set(dateKeyOf(e.workDate), (totals.get(dateKeyOf(e.workDate)) ?? 0) + e.minutes);
            minutes += e.minutes;
            if (e.billable) billable += e.minutes;
            count += 1;
        }
        const decides = row.userId !== ctx.userId && recordsTimeAsPerson(ctx);
        return {
            timesheet: toTimesheetData(row, names),
            personName: names.get(row.userId) ?? null,
            entries: entries.map((e) => ({ ...toEntryData(e), item: itemFor(e.workItemId, items, v) })),
            dayTotals: Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((date) => ({ date, minutes: totals.get(date) ?? 0 })),
            sums: { minutes, billableMinutes: billable, entries: count },
            viewer: {
                approve: decides && row.status === 'SUBMITTED',
                return: decides && row.status === 'SUBMITTED',
                reopen: decides && row.status === 'APPROVED',
            },
        };
    });
}

// ─── Notifications ──────────────────────────────────────────────────

export type TimesheetNoticeOut =
    | { kind: 'submitted'; timesheetId: string; version: number; weekStart: string; personUserId: string }
    | { kind: 'returned'; timesheetId: string; version: number; weekStart: string; personUserId: string; reopened: boolean }
    | { kind: 'approved'; timesheetId: string; version: number; weekStart: string; personUserId: string };

/**
 * Who is told of a submitted week (decision 269): the people of the
 * settings' recipient list who hold `time.approve`, resolved now; with no
 * list, every ACTIVE holder of `time.approve`, at most 50, the most senior
 * first. Never the week's own person.
 */
async function approversToTell(db: PrismaTx, ctx: RequestContext, personUserId: string): Promise<string[]> {
    const settings = await TimesheetRepository.settings(db, ctx);
    if (settings?.approvalRecipientListId) {
        const resolved = await resolveListRecipients(db, ctx.tenantId, { listIds: [settings.approvalRecipientListId], may: (p) => p.time?.approve === true });
        return resolved.userIds.filter((id) => id !== personUserId);
    }
    const memberships = await MembershipRepository.activeMembershipsBySeniority(db, ctx, APPROVER_SCAN);
    return memberships
        .filter((m) => m.userId !== personUserId && permissionsForMembership(m).time?.approve === true)
        .slice(0, TIMESHEET_LIMITS.approversNotified)
        .map((m) => m.userId);
}

/**
 * Ring the notices after the commit (decision 276): the bell to whoever
 * approves on a submit, linking to the Timesheets page; to the person on a
 * return or a reopening (with an immediate email when their preference says
 * so) and an approval, linking to their week. Nobody is told of their own act.
 * A failure is logged, never thrown: the act has committed.
 */
export async function emitTimesheetNotices(ctx: RequestContext, notices: readonly TimesheetNoticeOut[]): Promise<void> {
    if (notices.length === 0 || !ctx.tenantSlug) return;
    const slug = ctx.tenantSlug;
    try {
        await runInTenantContext(ctx, async (db) => {
            const people = [...new Set([ctx.userId, ...notices.map((n) => n.personUserId)])];
            const byId = new Map((await MembershipRepository.contactsOf(db, people)).map((c) => [c.id, c]));
            const actorName = byId.get(ctx.userId)?.name ?? null;
            for (const n of notices) {
                if (n.kind === 'submitted') {
                    // guardrail-allow: n+1 — one resolution per notice; an act rings one.
                    const approvers = (await approversToTell(db, ctx, n.personUserId)).filter((id) => id !== ctx.userId);
                    const notice: TimesheetNotice = { kind: 'submitted', timesheetId: n.timesheetId, version: n.version, weekStart: n.weekStart, personName: byId.get(n.personUserId)?.name };
                    await createTimesheetNotifications(db, ctx.tenantId, approvers.map((userId) => ({ userId, notice, linkUrl: `/t/${slug}/time/timesheets` })));
                    continue;
                }
                if (n.personUserId === ctx.userId) continue;
                const linkUrl = `/t/${slug}/time?week=${n.weekStart}`;
                const notice: TimesheetNotice =
                    n.kind === 'approved'
                        ? { kind: 'approved', timesheetId: n.timesheetId, version: n.version, weekStart: n.weekStart, byName: actorName }
                        : { kind: 'returned', timesheetId: n.timesheetId, version: n.version, weekStart: n.weekStart, byName: actorName, reopened: n.reopened };
                // guardrail-allow: n+1 — one bell per notice; an act rings one.
                await createTimesheetNotifications(db, ctx.tenantId, [{ userId: n.personUserId, notice, linkUrl }]);
                if (n.kind !== 'returned') continue;
                const active = await MembershipRepository.listActiveUserIds(db, ctx, [n.personUserId]);
                if (!active.has(n.personUserId)) continue;
                const deliveries = await memberDeliveries(db, ctx.tenantId, 'TIMESHEET_RETURNED', [n.personUserId]);
                const person = byId.get(n.personUserId);
                if (deliveries.get(n.personUserId)?.email !== 'IMMEDIATE' || !person?.email) continue;
                await enqueueEmail(db, {
                    tenantId: ctx.tenantId,
                    type: 'TIMESHEET_RETURNED',
                    toEmail: person.email,
                    entityId: `${n.timesheetId}:${n.version}`,
                    requestId: ctx.requestId,
                    payload: {
                        recipientName: person.name || person.email,
                        actorName: actorName ?? undefined,
                        weekLabel: weekLabel(n.weekStart),
                        reopened: n.reopened,
                        linkPath: linkUrl,
                    },
                });
            }
        });
    } catch (err) {
        logger.warn('failed to create timesheet notifications', {
            component: 'notifications',
            timesheetIds: [...new Set(notices.map((n) => n.timesheetId))],
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
