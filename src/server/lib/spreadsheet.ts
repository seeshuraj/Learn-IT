import { createRequire } from 'node:module';

const XLSX = createRequire(import.meta.url)('xlsx');

const sheetKey = (k: string) => k.replace(/^﻿/, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** .xlsx (zip) or .xls (OLE) rather than text such as CSV. */
const isWorkbook = (b: Buffer) =>
  (b[0] === 0x50 && b[1] === 0x4b) || (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0);

/**
 * First sheet as rows with lower_snake headers, plus a CSV dump for AI reading.
 *
 * CSV and other text is read without value parsing: SheetJS would otherwise
 * read "01/12/2026" month-first as 12 January. Text dates reach parseDate as
 * written, which reads them day-first as in India. Real date cells in a
 * workbook are kept as dates.
 */
export function readSpreadsheet(buffer: Buffer): { rows: Record<string, unknown>[]; headers: string[]; csv: string } {
  const wb = isWorkbook(buffer)
    // dateNF: date cells come out as 2026-12-02 in the CSV sent to the AI;
    // the default (12/2/26, month first) would be misread as 12 February.
    ? XLSX.read(buffer, { type: 'buffer', cellDates: true, dateNF: 'yyyy-mm-dd' })
    : XLSX.read(buffer.toString('utf8').replace(/^﻿/, ''), { type: 'string', raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  const rows = raw.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [sheetKey(k), v])));
  return { rows, headers: rows[0] ? Object.keys(rows[0]) : [], csv: XLSX.utils.sheet_to_csv(ws, { dateNF: 'yyyy-mm-dd' }) };
}
