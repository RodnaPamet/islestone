/**
 * Time totals and the time export (sub-phase 3.4d; docs/porting/maps/3.4.md,
 * "Time totals" and "Rates, totals and export (3.4d)"; ADR 0012 §6 and §7;
 * owner decisions 266, 273 to 275).
 *
 *   - **Who** (decisions 266 and 274): `time.view` reads the totals and
 *     exports; amounts and rates only for `time.rates`; an export's
 *     description only for the caller's own entries or with `time.approve`.
 *   - **Which entries**: finished entries dated in a window of at most 366
 *     days (400 `TIME_RANGE`), of every project the caller's role sees: for a
 *     role that sees the workspace, every project, deleted ones and
 *     tombstones included (time stays with the project it was recorded in,
 *     decisions 261 and 281), for a granted role only its projects.
 *   - **Totals**: one aggregate over `TimeEntry` grouped by project, person,
 *     item or week, at most 2,000 groups read one past and refused 422
 *     `TIME_TOTALS_TOO_LARGE` with the count, never cut. Not audited.
 *   - **Amounts** (decision 273): priced per entry by `timeAmounts` from the
 *     rate history, or from the frozen rate when the entry's week is
 *     approved; computed on read, never stored.
 *   - **The export** (decision 275, CSV and Excel): the entries behind the
 *     same filter, at most 50,000 (422 `TIME_EXPORT_TOO_LARGE`, never cut),
 *     through one table (`timeExportTable`) and two writers, every text cell
 *     guarded against formulas; audited `TIME_EXPORTED` with the format, the
 *     filter and the row count, never content.
 *
 * Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import { entryAmount, entryRate, timeAmounts, type RateBook } from '../domain/billable-rate';
import { visibleProjects, type ProjectVisibility } from '../policies/project-visibility';
import { mayApproveTime, mayManageRates, mayViewTime } from '../policies/time.policies';
import { MembershipRepository } from '../repositories/MembershipRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { TimeEntryRepository, type TotalsFilter } from '../repositories/TimeEntryRepository';
import { TimesheetRepository } from '../repositories/TimesheetRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import type { RequestContext } from '../types';
import { loadRateBookInTx } from './billable-rate';
import { itemFor, itemOf } from './time-entry';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { AppError, badRequest, forbidden } from '@/lib/errors/types';
import type { TimeEntryItem } from '@/lib/time/entries';
import { timeExportTable, toCsv, type ExportEntry } from '@/lib/time/export';
import { toXlsx } from '@/lib/time/export-xlsx';
import {
    TIME_TOTALS_LIMITS,
    type TimeExportFormat,
    type TimeTotalsData,
    type TimeTotalsFilter,
    type TimeTotalsGroup,
    type TimeTotalsGroupBy,
    type TimeTotalsSubject,
} from '@/lib/time/totals';
import { dateKeyOf, dateOnlyValue, weekStartOf } from '@/lib/time/week';

/** Items looked up per read for the export's labels (an id list stays well under Postgres's bind limit). */
const ITEM_LOOKUP_CHUNK = 5_000;
/** The key a deleted item's group carries. */
const DELETED_ITEM_KEY = 'deleted';

function assertViewsTime(ctx: RequestContext): void {
    if (!mayViewTime(ctx)) throw forbidden('You do not have permission to see time totals.');
}

/** Days from `from` to `to`, both ends counted. */
function daysIn(from: string, to: string): number {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * The repository filter of a request: the window checked (400 `TIME_RANGE`),
 * and the caller's grants when their role does not see the whole workspace.
 * `null` when the caller can see none of it (a project outside their grants).
 */
function repositoryFilter(filter: TimeTotalsFilter, v: ProjectVisibility): TotalsFilter | null {
    if (filter.to < filter.from) throw badRequest('The window ends before it starts.', { reason: 'TIME_RANGE' });
    if (daysIn(filter.from, filter.to) > TIME_TOTALS_LIMITS.rangeDays) {
        throw badRequest(`A window is at most ${TIME_TOTALS_LIMITS.rangeDays} days.`, { reason: 'TIME_RANGE', limit: TIME_TOTALS_LIMITS.rangeDays });
    }
    const base: TotalsFilter = {
        from: dateOnlyValue(filter.from),
        to: dateOnlyValue(filter.to),
        ...(filter.projectId ? { projectId: filter.projectId } : {}),
        ...(filter.userId ? { userId: filter.userId } : {}),
        ...(filter.billable !== undefined ? { billable: filter.billable } : {}),
    };
    if (v.kind === 'ALL') return base;
    if (filter.projectId) return v.projectIds.includes(filter.projectId) ? base : null;
    return { ...base, projectIds: v.projectIds };
}

/** The approved weeks the window's entries fall in, as `userId:Monday` (their rates are frozen, decision 273). */
async function approvedWeeks(db: PrismaTx, ctx: RequestContext, filter: TotalsFilter): Promise<Set<string>> {
    const take = TIME_TOTALS_LIMITS.exportRowsMax * 2;
    const from = dateOnlyValue(weekStartOf(dateKeyOf(filter.from)));
    const rows = await TimesheetRepository.approvedWeeksIn(db, ctx, from, filter.to, filter.userId, take + 1);
    if (rows.length > take) {
        throw new AppError('Too many approved weeks in this window to price.', 'TIME_TOTALS_TOO_LARGE', 422, true, { reason: 'TIME_TOTALS_TOO_LARGE' });
    }
    return new Set(rows.map((r) => `${r.userId}:${dateKeyOf(r.weekStart)}`));
}

function isApproved(weeks: ReadonlySet<string>, userId: string, workDate: string): boolean {
    return weeks.has(`${userId}:${weekStartOf(workDate)}`);
}

/** The money a rates holder is shown: the currency, the rate book and the approved weeks. */
async function pricing(db: PrismaTx, ctx: RequestContext, filter: TotalsFilter): Promise<{ currency: string | null; book: RateBook; approved: Set<string> }> {
    const settings = await TimesheetRepository.settings(db, ctx);
    const book = await loadRateBookInTx(db, ctx, filter.to);
    const approved = await approvedWeeks(db, ctx, filter);
    return { currency: settings?.currency ?? null, book, approved };
}

/** Visible items among `ids`, in bounded reads. */
async function itemsOf(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, ids: readonly string[]): Promise<Map<string, TimeEntryItem>> {
    const out = new Map<string, TimeEntryItem>();
    for (let i = 0; i < ids.length; i += ITEM_LOOKUP_CHUNK) {
        // guardrail-allow: n+1 — bounded chunks of at most ITEM_LOOKUP_CHUNK ids (Postgres binds at most 65,535 parameters).
        const rows = await WorkItemRepository.listByIds(db, ctx, v, ids.slice(i, i + ITEM_LOOKUP_CHUNK));
        for (const r of rows) out.set(r.id, itemOf(r));
    }
    return out;
}

function itemSubject(item: TimeEntryItem): TimeTotalsSubject {
    return { kind: 'item', item: item.kind === 'visible' ? { kind: 'visible', id: item.id, key: item.key, title: item.title } : item };
}

// ─── Totals ─────────────────────────────────────────────────────────

/** Time totals over a window, grouped (`time.view`; amounts for `time.rates`). */
export async function getTimeTotals(ctx: RequestContext, input: { filter: TimeTotalsFilter; groupBy: TimeTotalsGroupBy }): Promise<TimeTotalsData> {
    assertViewsTime(ctx);
    const rates = mayManageRates(ctx);
    const { filter, groupBy } = input;
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const f = repositoryFilter(filter, v);
        const empty: TimeTotalsData = {
            filter,
            groupBy,
            groups: [],
            total: { minutes: 0, billableMinutes: 0, entries: 0, amountMinor: rates ? 0 : null, noRateMinutes: rates ? 0 : null },
            currency: null,
            viewer: { rates, export: true },
        };
        if (!f) return empty;
        const rows = await TimeEntryRepository.totals(db, ctx, f, groupBy, TIME_TOTALS_LIMITS.groupsMax + 1);
        if (rows.length > TIME_TOTALS_LIMITS.groupsMax) {
            const count = await TimeEntryRepository.countTotalsGroups(db, ctx, f, groupBy);
            throw new AppError(`This window holds ${count} groups; narrow it to at most ${TIME_TOTALS_LIMITS.groupsMax}.`, 'TIME_TOTALS_TOO_LARGE', 422, true, {
                reason: 'TIME_TOTALS_TOO_LARGE',
                limit: TIME_TOTALS_LIMITS.groupsMax,
                count,
            });
        }
        const subjects = await subjectsOf(db, ctx, v, groupBy, rows.map((r) => r.key));
        let money: Map<string, { amountMinor: number; noRateMinutes: number }> | null = null;
        let currency: string | null = null;
        if (rates && rows.some((r) => r.billable > 0)) {
            const p = await pricing(db, ctx, f);
            currency = p.currency;
            const lines = await TimeEntryRepository.amountLines(db, ctx, f, groupBy);
            money = timeAmounts(
                p.book,
                lines.map((l) => {
                    const workDate = dateKeyOf(l.workDate);
                    return {
                        key: l.key ?? DELETED_ITEM_KEY,
                        projectId: l.projectId,
                        userId: l.userId,
                        workDate,
                        minutes: l.minutes,
                        count: l.count,
                        billable: true,
                        approved: isApproved(p.approved, l.userId, workDate),
                        frozenRateMinor: l.frozenRateMinor,
                        frozenRateLevel: l.frozenRateLevel,
                    };
                }),
            );
        } else if (rates) {
            currency = (await TimesheetRepository.settings(db, ctx))?.currency ?? null;
        }
        const groups: TimeTotalsGroup[] = rows.map((r) => {
            const key = r.key ?? DELETED_ITEM_KEY;
            const m = money?.get(key);
            return {
                key,
                subject: subjects.get(key)!,
                minutes: r.minutes,
                billableMinutes: r.billable,
                entries: r.entries,
                amountMinor: rates ? (m?.amountMinor ?? 0) : null,
                noRateMinutes: rates ? (m?.noRateMinutes ?? 0) : null,
            };
        });
        const sum = (pick: (g: TimeTotalsGroup) => number | null) => groups.reduce((s, g) => s + (pick(g) ?? 0), 0);
        return {
            filter,
            groupBy,
            groups,
            total: {
                minutes: sum((g) => g.minutes),
                billableMinutes: sum((g) => g.billableMinutes),
                entries: sum((g) => g.entries),
                amountMinor: rates ? sum((g) => g.amountMinor) : null,
                noRateMinutes: rates ? sum((g) => g.noRateMinutes) : null,
            },
            currency,
            viewer: { rates, export: true },
        };
    });
}

/** What each group is: a project (deleted ones and tombstones too), a person, an item or a week. */
async function subjectsOf(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, groupBy: TimeTotalsGroupBy, keys: ReadonlyArray<string | null>): Promise<Map<string, TimeTotalsSubject>> {
    const out = new Map<string, TimeTotalsSubject>();
    const ids = keys.filter((k): k is string => k !== null);
    switch (groupBy) {
        case 'project': {
            for (const p of await ProjectRepository.labelsForTime(db, ctx, ids)) {
                out.set(p.id, { kind: 'project', projectId: p.id, name: p.name, keyPrefix: p.keyPrefix, teamId: p.teamId, deleted: p.deletedAt !== null });
            }
            break;
        }
        case 'person': {
            const names = new Map((await MembershipRepository.contactsOf(db, ids)).map((c) => [c.id, c.name]));
            for (const id of ids) out.set(id, { kind: 'person', userId: id, name: names.get(id) ?? null });
            break;
        }
        case 'item': {
            const items = await itemsOf(db, ctx, v, ids);
            for (const id of ids) out.set(id, itemSubject(itemFor(id, items, v)));
            if (keys.includes(null)) out.set(DELETED_ITEM_KEY, itemSubject({ kind: 'deleted' }));
            break;
        }
        case 'week':
            for (const id of ids) out.set(id, { kind: 'week', weekStart: id });
            break;
    }
    return out;
}

// ─── The export ─────────────────────────────────────────────────────

export interface TimeExportFile {
    body: Buffer;
    contentType: string;
    filename: string;
    rows: number;
}

const CONTENT_TYPES: Record<TimeExportFormat, string> = {
    csv: 'text/csv; charset=utf-8',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * The entries behind Time totals' filter as CSV or an Excel workbook
 * (`time.view`; decision 275). Audited `TIME_EXPORTED`.
 */
export async function exportTimeEntries(ctx: RequestContext, input: { filter: TimeTotalsFilter; format: TimeExportFormat }): Promise<TimeExportFile> {
    assertViewsTime(ctx);
    const rates = mayManageRates(ctx);
    const readsAllDescriptions = mayApproveTime(ctx);
    const { filter, format } = input;
    const built = await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const f = repositoryFilter(filter, v);
        const rows = f ? await TimeEntryRepository.forExport(db, ctx, f, TIME_TOTALS_LIMITS.exportRowsMax + 1) : [];
        if (rows.length > TIME_TOTALS_LIMITS.exportRowsMax) {
            throw new AppError(`An export holds at most ${TIME_TOTALS_LIMITS.exportRowsMax} entries; narrow the filter.`, 'TIME_EXPORT_TOO_LARGE', 422, true, {
                reason: 'TIME_EXPORT_TOO_LARGE',
                limit: TIME_TOTALS_LIMITS.exportRowsMax,
            });
        }
        const projects = new Map((await ProjectRepository.labelsForTime(db, ctx, [...new Set(rows.map((r) => r.projectId))])).map((p) => [p.id, p]));
        const people = new Map((await MembershipRepository.contactsOf(db, [...new Set(rows.map((r) => r.userId))])).map((c) => [c.id, c.name]));
        const items = await itemsOf(db, ctx, v, [...new Set(rows.map((r) => r.workItemId).filter((x): x is string => x !== null))]);
        const money = rates && f && rows.some((r) => r.billable) ? await pricing(db, ctx, f) : null;
        const currency = rates ? (money?.currency ?? (await TimesheetRepository.settings(db, ctx))?.currency ?? null) : null;
        const entries: ExportEntry[] = rows.map((r) => {
            const workDate = dateKeyOf(r.workDate);
            const item = itemFor(r.workItemId, items, v);
            const rateInput = money
                ? {
                      projectId: r.projectId,
                      userId: r.userId,
                      workDate,
                      billable: r.billable,
                      approved: isApproved(money.approved, r.userId, workDate),
                      frozenRateMinor: r.frozenRateMinor,
                      frozenRateLevel: r.frozenRateLevel,
                  }
                : null;
            return {
                workDate,
                personName: people.get(r.userId) ?? null,
                projectKey: projects.get(r.projectId)?.keyPrefix ?? '',
                itemLabel: item.kind === 'visible' ? item.key : item.kind === 'deleted' ? 'Deleted item' : 'Item you cannot see',
                title: item.kind === 'visible' ? item.title : null,
                minutes: r.minutes!,
                billable: r.billable,
                rateMinor: rateInput && money ? (entryRate(money.book, rateInput)?.hourlyRateMinor ?? null) : null,
                amountMinor: rateInput && money ? entryAmount(money.book, { ...rateInput, minutes: r.minutes! }) : null,
                description: r.userId === ctx.userId || readsAllDescriptions ? r.description : null,
            };
        });
        await logEvent(db, ctx, {
            action: 'TIME_EXPORTED',
            entityType: 'TimeEntry',
            entityId: ctx.tenantId,
            details: `Exported ${entries.length} time entries as ${format.toUpperCase()}`,
            detailsJson: { category: 'data_lifecycle', operation: 'exported', recordCount: entries.length, model: 'TimeEntry' },
            // The format, the filter and the count: never content.
            metadata: { format, from: filter.from, to: filter.to, projectId: filter.projectId ?? null, userId: filter.userId ?? null, billable: filter.billable ?? null, rows: entries.length, amounts: currency !== null },
        });
        return { entries, currency };
    });
    const table = timeExportTable(built.entries, built.currency ? { currency: built.currency } : null);
    const body = format === 'csv' ? Buffer.from(toCsv(table), 'utf8') : await toXlsx(table);
    return { body, contentType: CONTENT_TYPES[format], filename: `time-entries-${filter.from}-to-${filter.to}.${format}`, rows: built.entries.length };
}
