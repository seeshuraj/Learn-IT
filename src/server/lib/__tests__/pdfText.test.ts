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
