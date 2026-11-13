import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, csvRow, CSV_BOM } from '../csv.js';
import { DATASETS } from '../exportDatasets.js';

test('CSV quoting follows RFC 4180', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('Rao, Priya'), '"Rao, Priya"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(42), '42');
  assert.equal(csvCell(new Date('2026-11-13T10:00:00Z')), '2026-11-13T10:00:00.000Z');
  assert.equal(csvRow(['a', 1, null]), 'a,1,\r\n');
  assert.equal(CSV_BOM, '﻿');
});

test('cells a spreadsheet would run as formulas stay text (CSV injection)', () => {
  assert.equal(csvCell('=HYPERLINK("http://x","click")'), `"'=HYPERLINK(""http://x"",""click"")"`);
  assert.equal(csvCell('+91 98400 00000'), "'+91 98400 00000");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('-5'), '-5', 'negative numbers are left alone');
  assert.equal(csvCell('-2+3'), "'-2+3");
});

test('every export is scoped to one college and keyset-paged', () => {
  for (const [name, ds] of Object.entries(DATASETS)) {
    assert.match(ds.sql, /institution_id = \$1/, `${name} filters by college`);
    assert.match(ds.sql, /> \$2/, `${name} pages by key`);
    assert.match(ds.sql, /LIMIT \$3/, `${name} is batched`);
    assert.match(ds.sql, /AS k\b/, `${name} selects its key`);
    assert.equal(ds.row({}).length, ds.header.length, `${name} header matches its columns`);
  }
});
