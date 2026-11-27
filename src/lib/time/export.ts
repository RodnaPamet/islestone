/**
 * The time export's rows and its CSV writer (sub-phase 3.4d;
 * docs/porting/maps/3.4.md, "Rates, totals and export (3.4d)"; ADR 0012 §7;
 * owner decision 275, the owner's choice C: CSV and Excel).
 *
 *   - **One table, two writers.** `timeExportTable` builds the header and
 *     the rows once; `toCsv` (here) and `toXlsx` (`export-xlsx.ts`, server
 *     only) write the same cells, so both formats carry the same rows and
 *     columns.
 *   - **Formula injection** (OWASP's CSV injection): every text cell that
 *     starts with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed
 *     with `'` (`neutraliseText`), in both formats, so a workbook saved back
 *     as CSV stays safe too. Numbers and dates are typed cells, never text;
 *     the workbook writes a text cell as a string, never a formula.
 *   - **Money only for a rates holder** (decision 274): the rate and amount
 *     columns are left out otherwise. The description is shown only where the
 *     caller may read it (their own entries, or `time.approve`).
 *
 * Pure (no I/O). Written fresh for Islestone.
 */
import { minorDigits } from './money';

/** One cell, typed so neither writer has to guess. */
export type ExportCell =
    | { kind: 'text'; value: string }
    | { kind: 'number'; value: number; decimals: number }
    | { kind: 'date'; value: string }
    | { kind: 'empty' };

export interface ExportTable {
    header: string[];
    rows: ExportCell[][];
}

/** The characters a spreadsheet reads as the start of a formula (or that hide one). */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** A text cell made safe to open in a spreadsheet: a formula lead is prefixed with `'`. */
export function neutraliseText(value: string): string {
    return FORMULA_LEAD.test(value) ? `'${value}` : value;
}

function text(value: string | null | undefined): ExportCell {
    return value === null || value === undefined || value === '' ? { kind: 'empty' } : { kind: 'text', value: neutraliseText(value) };
}

/** One entry as the export reads it, every lookup already made. */
export interface ExportEntry {
    /** `YYYY-MM-DD`. */
    workDate: string;
    personName: string | null;
    projectKey: string;
    /** `ISL-12`, or "Deleted item" / "Item you cannot see". */
    itemLabel: string;
    title: string | null;
    minutes: number;
    billable: boolean;
    /** Minor units per hour; null: no rate (or not billable). Read only when `currency` is given. */
    rateMinor: number | null;
    amountMinor: number | null;
    /** Null where the caller may not read it. */
    description: string | null;
}

/** The export's table: the money columns only with a currency (a rates holder's export). */
export function timeExportTable(entries: readonly ExportEntry[], money: { currency: string } | null): ExportTable {
    const digits = money ? minorDigits(money.currency) : 0;
    const header = [
        'Date',
        'Person',
        'Project',
        'Item',
        'Title',
        'Hours',
        'Minutes',
        'Billable',
        ...(money ? [`Rate (${money.currency} per hour)`, `Amount (${money.currency})`] : []),
        'Description',
    ];
    const rows = entries.map((e): ExportCell[] => [
        { kind: 'date', value: e.workDate },
        text(e.personName),
        text(e.projectKey),
        text(e.itemLabel),
        text(e.title),
        { kind: 'number', value: Math.round((e.minutes / 60) * 100) / 100, decimals: 2 },
        { kind: 'number', value: e.minutes, decimals: 0 },
        { kind: 'text', value: e.billable ? 'Yes' : 'No' },
        ...(money
            ? [
                  e.rateMinor === null ? ({ kind: 'empty' } as const) : ({ kind: 'number', value: e.rateMinor / 10 ** digits, decimals: digits } as const),
                  e.amountMinor === null ? ({ kind: 'empty' } as const) : ({ kind: 'number', value: e.amountMinor / 10 ** digits, decimals: digits } as const),
              ]
            : []),
        text(e.description),
    ]);
    return { header: header.map(neutraliseText), rows };
}

function csvField(cell: ExportCell): string {
    let raw: string;
    switch (cell.kind) {
        case 'empty':
            return '';
        case 'number':
            raw = cell.value.toFixed(cell.decimals);
            break;
        case 'date':
        case 'text':
            raw = cell.value;
            break;
    }
    return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

/**
 * The table as CSV (RFC 4180: comma-separated, CRLF lines, a field with a
 * comma, quote or line break quoted), with a UTF-8 byte-order mark so a
 * spreadsheet reads names in any script.
 */
export function toCsv(table: ExportTable): string {
    const lines = [table.header.map((h) => csvField({ kind: 'text', value: h })), ...table.rows.map((r) => r.map(csvField))];
    return `﻿${lines.map((l) => l.join(',')).join('\r\n')}\r\n`;
}
