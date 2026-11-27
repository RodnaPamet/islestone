/**
 * The time export as an Excel workbook (sub-phase 3.4d; owner decision 275,
 * the owner's choice C): the same table `toCsv` writes, as one sheet, "Time
 * entries", through `write-excel-file` 4.1.1 (MIT; its one dependency is
 * `fflate`, MIT; chosen over ExcelJS, whose tree fails the licence gate, in
 * the 3.4 map's "Rates, totals and export (3.4d)").
 *
 *   - Text cells are string cells (`type: String`), never formulas: the
 *     writer makes a formula only from `type: 'Formula'`, which nothing here
 *     passes. They carry `neutraliseText`'s prefix all the same, so a workbook
 *     saved back as CSV stays safe.
 *   - Numbers and dates are typed cells: hours to two decimals, money to the
 *     currency's minor digits, dates as `yyyy-mm-dd`.
 *
 * Server only: the writer's Node entry (`write-excel-file/node`) reads no
 * file here but imports Node's modules. Written fresh for Islestone.
 */
import writeXlsxFile from 'write-excel-file/node';
import type { Cell, Row } from 'write-excel-file/node';

import type { ExportCell, ExportTable } from './export';

function numberFormat(decimals: number): string {
    return decimals === 0 ? '0' : `0.${'0'.repeat(decimals)}`;
}

function cellOf(cell: ExportCell): Cell {
    switch (cell.kind) {
        case 'empty':
            return null;
        case 'text':
            return { value: cell.value, type: String };
        case 'number':
            return { value: cell.value, type: Number, format: numberFormat(cell.decimals) };
        case 'date':
            return { value: new Date(`${cell.value}T00:00:00.000Z`), type: Date, format: 'yyyy-mm-dd' };
    }
}

/** The table as an `.xlsx` workbook of one sheet. */
export async function toXlsx(table: ExportTable): Promise<Buffer> {
    const header: Row = table.header.map((h) => ({ value: h, type: String, fontWeight: 'bold' }));
    const data: Row[] = [header, ...table.rows.map((r) => r.map(cellOf))];
    return writeXlsxFile(data, { sheet: 'Time entries', stickyRowsCount: 1 }).toBuffer();
}
