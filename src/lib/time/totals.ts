/**
 * Billable rates, Time totals and the export (sub-phase 3.4d;
 * docs/porting/maps/3.4.md, "Rates, totals and export (3.4d)"; ADR 0012 §6
 * and §7; owner decisions 271 to 275): the limits and the shapes the routes
 * answer, shared by the usecases, the input schemas and the pages.
 *
 *   - Money is seen only by holders of `time.rates` (decision 274): every
 *     amount and rate below is absent (`null`) for anyone else, their own
 *     time included.
 *   - Time totals group finished entries by project, person, item or week
 *     over a window of at most 366 days.
 *   - The export (decision 275, the owner's choice C) is the entries behind
 *     the same filter as CSV or an Excel workbook, at most 50,000 rows.
 *
 * Client-safe and pure. Written fresh for Islestone.
 */
import type { RateLevel } from '@/app-layer/domain/billable-rate';

export const TIME_TOTALS_LIMITS = {
    /** The longest window, in days counting both ends (400 `TIME_RANGE`). */
    rangeDays: 366,
    /** The most groups a totals read returns; more is 422 `TIME_TOTALS_TOO_LARGE`, never cut. */
    groupsMax: 2_000,
    /** The most rows an export holds; more is 422 `TIME_EXPORT_TOO_LARGE`, never cut. */
    exportRowsMax: 50_000,
    /** The most rate rows read for an answer; more is 422 `BILLABLE_RATES_TOO_MANY`. */
    rateRowsMax: 10_000,
} as const;

export const TIME_TOTALS_GROUPS = ['project', 'person', 'item', 'week'] as const;
export type TimeTotalsGroupBy = (typeof TIME_TOTALS_GROUPS)[number];

export const TIME_EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type TimeExportFormat = (typeof TIME_EXPORT_FORMATS)[number];

/** The filter Time totals and the export share. Dates `YYYY-MM-DD`, both ends included. */
export interface TimeTotalsFilter {
    from: string;
    to: string;
    projectId?: string;
    userId?: string;
    billable?: boolean;
}

/** What one group is: its label parts, as the page shows them. */
export type TimeTotalsSubject =
    | { kind: 'project'; projectId: string; name: string; keyPrefix: string; teamId: string | null; deleted: boolean }
    | { kind: 'person'; userId: string; name: string | null }
    | { kind: 'item'; item: { kind: 'visible'; id: string; key: string; title: string } | { kind: 'deleted' } | { kind: 'hidden' } }
    | { kind: 'week'; weekStart: string };

export interface TimeTotalsGroup {
    /** Stable within one answer: the group's id or date. */
    key: string;
    subject: TimeTotalsSubject;
    minutes: number;
    billableMinutes: number;
    entries: number;
    /** Minor units (`time.rates` only); null otherwise. */
    amountMinor: number | null;
    /** Billable minutes with no rate (`time.rates` only): "No rate" for that part. */
    noRateMinutes: number | null;
}

export interface TimeTotalsData {
    filter: TimeTotalsFilter;
    groupBy: TimeTotalsGroupBy;
    groups: TimeTotalsGroup[];
    total: { minutes: number; billableMinutes: number; entries: number; amountMinor: number | null; noRateMinutes: number | null };
    /** The workspace's currency, for a rates holder; null otherwise or when unset. */
    currency: string | null;
    viewer: {
        /** Sees amounts (`time.rates`, decision 274). */
        rates: boolean;
        /** May export (`time.view`, as a person or not: an export is a read). */
        export: boolean;
    };
}

/** One rate row as the routes answer it (`time.rates` only). */
export interface BillableRateData {
    id: string;
    level: RateLevel;
    projectId: string | null;
    userId: string | null;
    hourlyRateMinor: number | null;
    effectiveFrom: string;
    createdAt: string;
    /** A row whose date has not come yet may be removed. */
    removable: boolean;
}

/** Every rate of the workspace, the settings and project pages' one read (`GET /billable-rates`). */
export interface BillableRatesData {
    currency: string | null;
    rates: BillableRateData[];
    /** Today in `NOTIFICATIONS_TZ`: a row dated after it may be removed. */
    today: string;
}

/** The export's columns, in order; the money ones only for a rates holder, the description only where it may be read. */
export const TIME_EXPORT_COLUMNS = ['date', 'person', 'project', 'item', 'title', 'hours', 'minutes', 'billable', 'rate', 'amount', 'description'] as const;
export type TimeExportColumn = (typeof TIME_EXPORT_COLUMNS)[number];
