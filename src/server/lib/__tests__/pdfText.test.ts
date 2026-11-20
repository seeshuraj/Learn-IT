import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractPdfText, readPdfText } from '../pdfText.js';

const paper = readFileSync(fileURLToPath(new URL('./fixtures/question-paper.pdf', import.meta.url)));

test('reads the text of a generated question paper (ReportLab, standard fonts)', async () => {
  const text = await extractPdfText(paper);
  assert.ok(text.length > 1000, `only ${text.length} characters`);
  assert.match(text, /GROUP BY/);
  assert.match(text, /PART C/);
});

test('reads a small upload that sits inside Node\'s shared buffer pool (how multer hands it over)', async () => {
  Buffer.allocUnsafe(64);
  const pooled = Buffer.concat([paper.subarray(0, 100), paper.subarray(100)]);
  const text = await extractPdfText(pooled);
  assert.ok(text.length > 1000, `only ${text.length} characters`);
});

test('falls back to pdf.js when pdf-parse fails, and says why', async () => {
  const r = await readPdfText(paper, { primary: async () => { throw new Error('bad XRef entry'); } });
  assert.equal(r.engine, 'pdfjs');
  assert.match(r.text, /GROUP BY/);
  assert.match(r.error ?? '', /pdf-parse: Error: bad XRef entry/);
});

test('falls back to pdf.js when pdf-parse returns no text', async () => {
  const r = await readPdfText(paper, { primary: async () => '   \n ' });
  assert.equal(r.engine, 'pdfjs');
  assert.match(r.text, /PART A/);
  assert.match(r.error ?? '', /pdf-parse: no text/);
});

test('a file with no readable text comes back empty with the reasons, never throws', async () => {
  const r = await readPdfText(Buffer.from('this is not a pdf at all'));
  assert.equal(r.text, '');
  assert.equal(r.engine, null);
  assert.match(r.error ?? '', /pdf-parse: .*\| pdfjs: /);
});

test('the caller\'s buffer is left untouched', async () => {
  const copy = Buffer.from(paper);
  await readPdfText(copy, { primary: async d => { d.fill(0); return ''; } });
  assert.ok(copy.equals(paper));
});
