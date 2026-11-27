/**
 * Timesheets and their approval (sub-phase 3.4c; docs/porting/maps/3.4.md,
 * "Timesheets and approval (3.4c)"; ADR 0012 §5; owner decisions 256, 268 to
 * 270): the limits, the statuses and the shapes the routes answer, shared by
 * the usecases, the input schemas and the pages.
 *
 *   - A week is Monday to Sunday by each entry's date (decision 268); its row
 *     names the Monday. No row is a week not submitted ("Draft" is banned).
 *   - SUBMITTED and APPROVED freeze the week's entries (decision 270; the
 *     trigger `time_entry_week_frozen`).
 *   - The verbs are Submit, Approve and Return (decision 256); the person
 *     takes a submitted week back (WITHDRAWN); an approver reopens an approved
 *     week with an explanation (RETURNED again).
 *
 * Client-safe and pure: no Prisma runtime, no server import.
 *
 * Written fresh for Islestone.
 */
import type { TimeEntryData, TimeEntryItem } from './entries';

export const TIMESHEET_STATUSES = ['SUBMITTED', 'APPROVED', 'RETURNED', 'WITHDRAWN'] as const;
export type TimesheetStatusValue = (typeof TIMESHEET_STATUSES)[number];

export const TIMESHEET_LIMITS = {
    /** A return's or a reopening's explanation, in characters of plaintext. */
    explanationMax: 2_000,
    /** Weeks on one page of the Timesheets page. */
    page: 50,
    /** How far back the Decided view reaches, in weeks. */
    decidedWeeks: 12,
    /** The people told of a submitted week when no recipient list is set (decision 269). */
    approversNotified: 50,
} as const;

/** Whether a week in `status` is frozen (decision 270). */
export function isFrozenStatus(status: TimesheetStatusValue | null | undefined): boolean {
    return status === 'SUBMITTED' || status === 'APPROVED';
}

/** One timesheet as the routes answer it. The explanation only to the person and to whoever approves weeks. */
export interface TimesheetData {
    id: string;
    userId: string;
    /** The Monday, `YYYY-MM-DD`. */
    weekStart: string;
    status: TimesheetStatusValue;
    submittedAt: string;
    decidedAt: string | null;
    decidedByUserId: string | null;
    decidedByName: string | null;
    /** Set while RETURNED. */
    returnExplanation: string | null;
    version: number;
}

/** A week's sums: finished entries only. */
export interface WeekSums {
    minutes: number;
    billableMinutes: number;
    entries: number;
}

/** What a person may do with a week, asked on the server. */
export interface TimesheetWeekViewer {
    /** Submit (or resubmit) the week. */
    submit: boolean;
    /** Take a submitted week back. */
    withdraw: boolean;
    /** Add, change and delete entries in it: the week is not frozen and the caller records time. */
    edit: boolean;
}

/** One person's week as My time's status line reads it (`GET /timesheets/week`). */
export interface TimesheetWeekData {
    userId: string;
    weekStart: string;
    /** "Timesheets need approval" (decision 268). */
    approvalRequired: boolean;
    /** No row: not submitted. */
    timesheet: TimesheetData | null;
    frozen: boolean;
    /** A timer counting on a day of the week: the week cannot be submitted (decision 263). */
    timerOn: boolean;
    sums: WeekSums;
    viewer: TimesheetWeekViewer;
}

/** A row of the Timesheets page: one member's week. */
export interface TimesheetListRow extends TimesheetData {
    personName: string | null;
    sums: WeekSums;
}

export interface TimesheetListData {
    rows: TimesheetListRow[];
    pageInfo: { hasNextPage: boolean; nextCursor?: string };
}

/** What an approver may do with one week, asked on the server. */
export interface TimesheetDecisionViewer {
    approve: boolean;
    return: boolean;
    reopen: boolean;
}

/** One submitted or decided week with its entries, read-only (`GET /timesheets/:id`). */
export interface TimesheetDetailData {
    timesheet: TimesheetData;
    personName: string | null;
    entries: Array<TimeEntryData & { item: TimeEntryItem }>;
    dayTotals: Array<{ date: string; minutes: number }>;
    sums: WeekSums;
    viewer: TimesheetDecisionViewer;
}

/** The workspace's time tracking settings (`GET /time-settings`). */
export interface TimeSettingsData {
    approvalRequired: boolean;
    approvalRecipientListId: string | null;
    version: number;
    /** May change them (`admin.manage`), asked on the server. */
    viewer: { manage: boolean };
}
