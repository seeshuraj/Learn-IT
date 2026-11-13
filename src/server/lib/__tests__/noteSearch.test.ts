import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchModuleChunks, insertNoteChunks, toVectorLiteral } from '../noteSearch.js';

function fakeDb(rows: any[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return { calls, async query(sql: string, params: unknown[] = []) { calls.push({ sql, params }); return { rows }; } };
}

test('vector literal: pgvector text format; rejects empty and non-finite vectors', () => {
  assert.equal(toVectorLiteral([0.5, -1, 2e-5]), '[0.5,-1,0.00002]');
  assert.throws(() => toVectorLiteral([]));
  assert.throws(() => toVectorLiteral([1, Number.NaN]));
});

test('search ranks in Postgres: one module, one model, top-K only', async () => {
  const db = fakeDb([{ chunk_text: 'KD-trees split space', source: 'Unit 3.pdf', score: '0.82' }]);
  const out = await searchModuleChunks(db, { moduleId: 7, model: 'm', queryVector: [1, 0], topK: 5 });
  assert.deepEqual(out, [{ text: 'KD-trees split space', source: 'Unit 3.pdf', score: 0.82 }]);
  const { sql, params } = db.calls[0];
  assert.match(sql, /ORDER BY nc\.embedding_vec OPERATOR\(extensions\.<=>\) \$3::extensions\.halfvec\s+LIMIT \$4/);
  assert.match(sql, /n\.module_id = \$1/);
  assert.match(sql, /nc\.embedding_model = \$2/);
  assert.doesNotMatch(sql, /uploaded_by/, 'no student filter for staff');
  assert.deepEqual(params, [7, 'm', '[1,0]', 5]);
});

test('students only search course material and their own notes', async () => {
  const db = fakeDb();
  await searchModuleChunks(db, { moduleId: 7, model: 'm', queryVector: [1], visibleToStudentId: 42 });
  assert.match(db.calls[0].sql, /n\.uploaded_by = \$5/);
  assert.equal(db.calls[0].params[4], 42);
});

test('top-K is clamped so a caller cannot pull a whole module', async () => {
  const db = fakeDb();
  await searchModuleChunks(db, { moduleId: 1, model: 'm', queryVector: [1], topK: 10_000 });
  assert.equal(db.calls[0].params[3], 20);
});

test('chunks insert in one statement; failed embeddings are stored for re-embedding', async () => {
  const db = fakeDb();
  await insertNoteChunks(db, 9, ['a', 'b'], [[1, 2], [3, 4]], 'm');
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].params, [9, ['a', 'b'], ['[1,2]', '[3,4]'], 'm']);
  assert.match(db.calls[0].sql, /CASE WHEN v\.vec IS NULL THEN NULL ELSE \$4 END/);

  await insertNoteChunks(db, 9, ['a'], null, 'm');
  assert.deepEqual(db.calls[1].params[2], [null]);
  await insertNoteChunks(db, 9, [], null, 'm');
  assert.equal(db.calls.length, 2, 'nothing to insert, no query');
  await assert.rejects(insertNoteChunks(db, 9, ['a', 'b'], [[1]], 'm'), /counts differ/);
});
