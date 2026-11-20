import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readSpreadsheet } from '../spreadsheet.js';
import { parseDate } from '../timetable.js';

const XLSX = createRequire(import.meta.url)('xlsx');

test('CSV dates stay as written, so day-first dates with a day of 12 or less are not read month-first', () => {
  const csv = 'Date,Session,Course code\n01/12/2026,FN,CS3200\n12/11/2026,AN,CS3200\n30/11/2026,FN,CS3200\n';
  const { rows, headers } = readSpreadsheet(Buffer.from(csv));
  assert.deepEqual(headers, ['date', 'session', 'course_code']);
  assert.deepEqual(rows.map(r => r.date), ['01/12/2026', '12/11/2026', '30/11/2026']);
  assert.deepEqual(rows.map(r => parseDate(r.date)), ['2026-12-01', '2026-11-12', '2026-11-30']);
});

test('a CSV with a byte-order mark reads its first header', () => {
  const { headers } = readSpreadsheet(Buffer.from('﻿date,course_code\n02/12/2026,CS3200\n'));
  assert.equal(headers[0], 'date');
});

test('real date cells in an .xlsx still come back as dates', () => {
  const ws = XLSX.utils.aoa_to_sheet([['date', 'course_code'], [new Date(Date.UTC(2026, 11, 1)), 'CS3200']], { cellDates: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true });
  const { rows, csv } = readSpreadsheet(buf);
  assert.equal(parseDate(rows[0].date), '2026-12-01');
  assert.match(csv, /2026-12-01/);
});
