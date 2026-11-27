/**
 * Billable rates and a project's billable default (sub-phase 3.4d;
 * docs/porting/maps/3.4.md, "Rates, totals and export (3.4d)"; ADR 0012 §6;
 * owner decisions 271 to 274). The only writer of `BillableRate` and of
 * `Project.timeBillableByDefault`.
 *
 *   - **`time.rates` only** (decision 274): every read and write here asks
 *     it; Owners and Admins hold it, and a custom role may grant it.
 *   - **History** (decision 273): a rate is set for a level, a scope and a
 *     date, in force from that date until the scope's next row; setting one
 *     for a date that has a row replaces it. A NULL rate is "no rate at this
 *     level from this date". A row is removed only while its date has not
 *     come (409 `RATE_IN_FORCE`); a past rate is changed by a newer row.
 *     Approved weeks are untouched by any change: their rates are frozen.
 *   - **One currency** (decision 273): a rate is set only once the workspace
 *     names its currency (409 `CURRENCY_REQUIRED`); every rate write takes the
 *     settings row's lock, as the currency's change does, so neither races
 *     the other.
 *   - **Audited** `BILLABLE_RATE_SET` / `_REMOVED` with the level, scope,
 *     date and amount (rates are not personal free text), and
 *     `PROJECT_UPDATED` naming `timeBillableByDefault`.
 *
 * Written fresh for Islestone.
 */
import type { BillableRateLevel } from '@prisma/client';

import { logEvent } from '../events/audit';
import { rateBook, type RateBook, type RateRow } from '../domain/billable-rate';
import { visibleProjects } from '../policies/project-visibility';
import { assertCanManageRates } from '../policies/time.policies';
import { BillableRateRepository, type BillableRateRow, type RateScope } from '../repositories/BillableRateRepository';
import { MembershipRepository } from '../repositories/MembershipRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { TimesheetRepository } from '../repositories/TimesheetRepository';
import type { RequestContext } from '../types';
import { dayKeyInTz } from '../notifications/work-item-due';
import { notificationsTz } from './work-item-shared';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { todayClock } from '@/lib/clock';
import { AppError, ConflictError, notFound } from '@/lib/errors/types';
import { TIME_TOTALS_LIMITS, type BillableRateData, type BillableRatesData } from '@/lib/time/totals';
import { dateKeyOf, dateOnlyValue } from '@/lib/time/week';

/** Today in `NOTIFICATIONS_TZ` through the clock seam: a rate dated after it may be removed. */
function today(): string {
    const zone = notificationsTz();
    return dayKeyInTz(todayClock(zone), zone);
}

export function toRateData(row: BillableRateRow, todayKey: string): BillableRateData {
    const effectiveFrom = dateKeyOf(row.effectiveFrom);
    return {
        id: row.id,
        level: row.level,
        projectId: row.projectId,
        userId: row.userId,
        hourlyRateMinor: row.hourlyRateMinor,
        effectiveFrom,
        createdAt: row.createdAt.toISOString(),
        removable: effectiveFrom > todayKey,
    };
}

/** The cascade's rows of `rows`, for `resolveRate`. */
export function rateRowsOf(rows: readonly BillableRateRow[]): RateRow[] {
    return rows.map((r) => ({ level: r.level, projectId: r.projectId, userId: r.userId, hourlyRateMinor: r.hourlyRateMinor, effectiveFrom: dateKeyOf(r.effectiveFrom) }));
}

function tooManyRates(): never {
    throw new AppError(`The workspace holds more than ${TIME_TOTALS_LIMITS.rateRowsMax} rates.`, 'BILLABLE_RATES_TOO_MANY', 422, true, {
        reason: 'BILLABLE_RATES_TOO_MANY',
        limit: TIME_TOTALS_LIMITS.rateRowsMax,
    });
}

/** The workspace's rate book for days up to `until`, in the caller's transaction (422 above the cap, never cut). */
export async function loadRateBookInTx(db: PrismaTx, ctx: RequestContext, until: Date): Promise<RateBook> {
    const rows = await BillableRateRepository.listUntil(db, ctx, until);
    if (rows.length > TIME_TOTALS_LIMITS.rateRowsMax) tooManyRates();
    return rateBook(rateRowsOf(rows));
}

/** The rate book a person's week needs (the approval's stamp, 3.4d). */
export async function loadWeekRateBookInTx(db: PrismaTx, ctx: RequestContext, userId: string, projectIds: readonly string[], until: Date): Promise<RateBook> {
    const rows = await BillableRateRepository.forPersonAndProjects(db, ctx, userId, projectIds, until);
    if (rows.length > TIME_TOTALS_LIMITS.rateRowsMax) tooManyRates();
    return rateBook(rateRowsOf(rows));
}

// ─── Reads ──────────────────────────────────────────────────────────

/** Every rate of the workspace and its currency (`time.rates`): the settings and project pages' read. */
export async function getBillableRates(ctx: RequestContext): Promise<BillableRatesData> {
    assertCanManageRates(ctx);
    const todayKey = today();
    return runInTenantContext(ctx, async (db) => {
        const settings = await TimesheetRepository.settings(db, ctx);
        const rows = await BillableRateRepository.listUntil(db, ctx);
        if (rows.length > TIME_TOTALS_LIMITS.rateRowsMax) tooManyRates();
        return { currency: settings?.currency ?? null, rates: rows.map((r) => toRateData(r, todayKey)), today: todayKey };
    });
}

// ─── Writes ─────────────────────────────────────────────────────────

export interface SetRateInput {
    /** `YYYY-MM-DD`: the day it starts to apply. */
    effectiveFrom: string;
    /** Minor units per hour, or null: no rate at this level from this date. */
    hourlyRateMinor: number | null;
}

async function setRate(ctx: RequestContext, scope: RateScope, input: SetRateInput, checkScope: (db: PrismaTx) => Promise<string>): Promise<BillableRateData> {
    assertCanManageRates(ctx);
    const todayKey = today();
    return runInTenantContext(ctx, async (db) => {
        // The currency's lock (decision 273): a rate and the currency's change never race.
        await TimesheetRepository.lockSettings(db, ctx);
        const settings = await TimesheetRepository.settings(db, ctx);
        if (!settings?.currency) throw new ConflictError('Choose the workspace\'s currency before the first rate.', { reason: 'CURRENCY_REQUIRED' });
        const scopeLabel = await checkScope(db);
        const day = dateOnlyValue(input.effectiveFrom);
        const existing = await BillableRateRepository.forDate(db, ctx, scope, day);
        if (existing && existing.hourlyRateMinor === input.hourlyRateMinor) return toRateData(existing, todayKey);
        let row: BillableRateRow;
        if (existing) {
            await BillableRateRepository.setRate(db, ctx, existing.id, input.hourlyRateMinor, ctx.userId);
            row = (await BillableRateRepository.get(db, ctx, existing.id))!;
        } else {
            row = await BillableRateRepository.create(db, ctx, scope, { hourlyRateMinor: input.hourlyRateMinor, effectiveFrom: day, createdByUserId: ctx.userId });
        }
        await logEvent(db, ctx, {
            action: 'BILLABLE_RATE_SET',
            entityType: 'BillableRate',
            entityId: row.id,
            details: `Set the ${scopeLabel} rate from ${input.effectiveFrom}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'BillableRate', operation: existing ? 'updated' : 'created', changedFields: ['hourlyRateMinor'] },
            // Numbers, dates and ids (the map's "Privacy, audit and encryption"): a rate is not personal free text.
            metadata: {
                level: scope.level,
                projectId: scope.projectId,
                userId: scope.userId,
                effectiveFrom: input.effectiveFrom,
                hourlyRateMinor: input.hourlyRateMinor,
                fromHourlyRateMinor: existing ? existing.hourlyRateMinor : undefined,
                currency: settings.currency,
            },
        });
        return toRateData(row, todayKey);
    });
}

/** The workspace's rate from a date (`time.rates`). */
export function setWorkspaceRate(ctx: RequestContext, input: SetRateInput): Promise<BillableRateData> {
    return setRate(ctx, { level: 'WORKSPACE', projectId: null, userId: null }, input, async () => 'workspace');
}

/** A project's rate from a date (`time.rates`): a live project, archived ones included. */
export function setProjectRate(ctx: RequestContext, projectId: string, input: SetRateInput): Promise<BillableRateData> {
    return setRate(ctx, { level: 'PROJECT', projectId, userId: null }, input, async (db) => {
        const project = await ProjectRepository.getVisible(db, ctx, await visibleProjects(ctx, db), projectId);
        if (!project) throw notFound('Project not found');
        return `${project.keyPrefix} project`;
    });
}

/** A member's rate from a date (`time.rates`): an ACTIVE member of the workspace. */
export function setMemberRate(ctx: RequestContext, userId: string, input: SetRateInput): Promise<BillableRateData> {
    return setRate(ctx, { level: 'MEMBER', projectId: null, userId }, input, async (db) => {
        const active = await MembershipRepository.listActiveUserIds(db, ctx, [userId]);
        if (!active.has(userId)) throw notFound('Member not found');
        return 'member';
    });
}

/**
 * Remove a rate whose date has not come (`time.rates`; 409 `RATE_IN_FORCE`
 * otherwise: a rate that has applied is changed by a newer row, never
 * removed, so the history stays what entries were priced by).
 */
export async function removeBillableRate(ctx: RequestContext, id: string): Promise<void> {
    assertCanManageRates(ctx);
    const todayKey = today();
    await runInTenantContext(ctx, async (db) => {
        await TimesheetRepository.lockSettings(db, ctx);
        const row = await BillableRateRepository.get(db, ctx, id);
        if (!row) throw notFound('Rate not found');
        const effectiveFrom = dateKeyOf(row.effectiveFrom);
        if (effectiveFrom <= todayKey) {
            throw new ConflictError('A rate that has applied is not removed; set a new rate from a later date instead.', { reason: 'RATE_IN_FORCE', effectiveFrom });
        }
        await BillableRateRepository.delete(db, ctx, id);
        await logEvent(db, ctx, {
            action: 'BILLABLE_RATE_REMOVED',
            entityType: 'BillableRate',
            entityId: id,
            details: `Removed the ${row.level.toLowerCase()} rate from ${effectiveFrom}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'BillableRate', operation: 'deleted' },
            metadata: { level: row.level as BillableRateLevel, projectId: row.projectId, userId: row.userId, effectiveFrom, hourlyRateMinor: row.hourlyRateMinor },
        });
    });
}

/**
 * Whether new entries on a project are billable by default (`time.rates`;
 * decision 271): a versioned write (`If-Match` optional), audited
 * `PROJECT_UPDATED` naming `timeBillableByDefault`. Entries already recorded
 * keep their own flag.
 */
export async function setProjectBillableDefault(
    ctx: RequestContext,
    projectId: string,
    input: { billableByDefault: boolean },
    expectedVersion?: number,
): Promise<{ id: string; timeBillableByDefault: boolean; version: number }> {
    assertCanManageRates(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const project = await ProjectRepository.getVisible(db, ctx, v, projectId);
        if (!project) throw notFound('Project not found');
        if (expectedVersion !== undefined && expectedVersion !== project.version) {
            throw new ConflictError('The project changed since you read it.', { reason: 'VERSION_CONFLICT', version: project.version });
        }
        if (project.timeBillableByDefault === input.billableByDefault) return { id: project.id, timeBillableByDefault: project.timeBillableByDefault, version: project.version };
        await ProjectRepository.lock(db, ctx, projectId);
        const count = await ProjectRepository.setTimeBillableByDefault(db, ctx, projectId, expectedVersion ?? project.version, input.billableByDefault);
        if (count === 0) throw new ConflictError('The project changed since you read it.', { reason: 'VERSION_CONFLICT' });
        await logEvent(db, ctx, {
            action: 'PROJECT_UPDATED',
            entityType: 'Project',
            entityId: projectId,
            details: `${input.billableByDefault ? 'Made' : 'Stopped making'} new time on project ${project.name} billable by default`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Project', operation: 'updated', changedFields: ['timeBillableByDefault'] },
            metadata: { timeBillableByDefault: input.billableByDefault },
        });
        const after = (await ProjectRepository.getVisible(db, ctx, v, projectId))!;
        return { id: after.id, timeBillableByDefault: after.timeBillableByDefault, version: after.version };
    });
}
