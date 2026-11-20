import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractPdfText } from '../pdfText.js';

const paper = readFileSync(fileURLToPath(new URL('./fixtures/question-paper.pdf', import.meta.url)));

test('reads the text of a generated question paper (ReportLab, standard fonts)', async () => {
  const text = await extractPdfText(paper);
  assert.ok(text.length > 1000, `only ${text.length} characters`);
  assert.match(text, /GROUP BY/);
  assert.match(text, /PART C/);
});

test('reads a small upload that sits inside Node\'s shared buffer pool (how multer hands it over)', async () => {
  Buffer.allocUnsafe(64);                                           // move the pool's offset off zero
  const pooled = Buffer.concat([paper.subarray(0, 100), paper.subarray(100)]);
  assert.ok(pooled.byteOffset > 0 || pooled.buffer.byteLength > pooled.length, 'test setup: buffer should be a pool slice');
  const text = await extractPdfText(pooled);
  assert.ok(text.length > 1000, `only ${text.length} characters`);
  assert.match(text, /GROUP BY/);
});
