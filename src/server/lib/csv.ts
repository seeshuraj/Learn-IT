/**
 * CSV for college data exports (RFC 4180, UTF-8 with BOM so Excel opens it
 * correctly with Indian names).
 *
 * Cells that a spreadsheet would run as a formula (=, +, -, @, tab, CR) are
 * prefixed with an apostrophe, so an exported name like "=HYPERLINK(...)"
 * stays text (CSV injection).
 */

export const CSV_BOM = '﻿';

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',') + '\r\n';
}
