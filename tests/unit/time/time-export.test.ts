/**
 * The time export's table and its writers (sub-phase 3.4d; owner decision
 * 275; `lib/time/export.ts`, `lib/time/export-xlsx.ts`):
 *
 *   - every text cell that opens with `=`, `+`, `-`, `@`, a tab or a carriage
 *     return is prefixed with `'`, in both formats, and a cell that does not
 *     is left as it is (property-tested);
 *   - numbers and dates are typed cells, never text;
 *   - the money columns only with a currency;
 *   - the CSV quotes what must be quoted and carries a byte-order mark;
 *   - the workbook is a zip with one sheet holding the same strings, and no
 *     formula.
 */
import fc from 'fast-check';
import { unzipSync, strFromU8 } from 'fflate';

import { neutraliseText, timeExportTable, toCsv, type ExportEntry } from '@/lib/time/export';
import { toXlsx } from '@/lib/time/export-xlsx';

const ENTRY: ExportEntry = {
    workDate: '2026-11-23',
    personName: 'Ada',
    projectKey: 'ISL',
    itemLabel: 'ISL-12',
    title: 'Write the brief',
    minutes: 90,
    billable: true,
    rateMinor: 12_000,
    amountMinor: 18_000,
    description: 'Drafted, "then" reviewed, line two\nhere',
};

describe('formula injection (decision 275)', () => {
    it('prefixes a formula lead with a quote and leaves anything else alone', () => {
        fc.assert(
            fc.property(fc.string(), (s) => {
                const out = neutraliseText(s);
                if (/^[=+\-@\t\r]/.test(s)) expect(out).toBe(`'${s}`);
                else expect(out).toBe(s);
                // Never a formula lead left at the start.
                expect(/^[=+\-@\t\r]/.test(out)).toBe(false);
            }),
        );
    });

    it('neutralises every text cell of the table, and types numbers and dates', () => {
        const table = timeExportTable([{ ...ENTRY, title: '=cmd|"/c calc"!A1', description: '+1', personName: '@me', itemLabel: '-x' }], { currency: 'EUR' });
        const row = table.rows[0]!;
        expect(row[0]).toEqual({ kind: 'date', value: '2026-11-23' });
        expect(row.filter((c) => c.kind === 'text').every((c) => c.kind === 'text' && !/^[=+\-@\t\r]/.test(c.value))).toBe(true);
        expect(row[4]).toEqual({ kind: 'text', value: '\'=cmd|"/c calc"!A1' });
        expect(row[5]).toEqual({ kind: 'number', value: 1.5, decimals: 2 });
        expect(row[8]).toEqual({ kind: 'number', value: 120, decimals: 2 });
        expect(row[9]).toEqual({ kind: 'number', value: 180, decimals: 2 });
    });

    it('leaves the money columns out without a currency', () => {
        const table = timeExportTable([ENTRY], null);
        expect(table.header).toEqual(['Date', 'Person', 'Project', 'Item', 'Title', 'Hours', 'Minutes', 'Billable', 'Description']);
        expect(table.rows[0]).toHaveLength(9);
    });
});

describe('the CSV writer', () => {
    it('quotes commas, quotes and line breaks, writes CRLF lines and a byte-order mark', () => {
        const csv = toCsv(timeExportTable([ENTRY], { currency: 'JPY' }));
        expect(csv.startsWith('﻿')).toBe(true);
        const lines = csv.slice(1).split('\r\n');
        expect(lines[0]).toBe('Date,Person,Project,Item,Title,Hours,Minutes,Billable,Rate (JPY per hour),Amount (JPY),Description');
        // JPY has no minor digits: the rate and amount are whole.
        expect(csv).toContain('2026-11-23,Ada,ISL,ISL-12,Write the brief,1.50,90,Yes,12000,18000,"Drafted, ""then"" reviewed, line two\nhere"');
    });
});

describe('the Excel writer', () => {
    it('writes one sheet, "Time entries", with the same strings and no formula', async () => {
        const table = timeExportTable([{ ...ENTRY, title: '=SUM(A1)' }], { currency: 'EUR' });
        const zip = unzipSync(new Uint8Array(await toXlsx(table)));
        const workbook = strFromU8(zip['xl/workbook.xml']!);
        expect(workbook).toContain('name="Time entries"');
        const sheet = strFromU8(zip['xl/worksheets/sheet1.xml']!);
        expect(sheet).not.toMatch(/<f>/);
        const strings = strFromU8(zip['xl/sharedStrings.xml'] ?? new Uint8Array()) + sheet;
        expect(strings).toContain("'=SUM(A1)");
        expect(strings).toContain('Ada');
    });
});
