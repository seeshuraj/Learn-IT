import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeFromText, cleanName, yearOfSemester, resolveDepartmentId } from '../departments.js';

test('department codes from typed text', () => {
  assert.equal(codeFromText(' cse '), 'CSE');
  assert.equal(codeFromText('Computer Science & Engg.'), 'COMPUTERSCIENCE&ENGG'); // capped at 20
  assert.equal(codeFromText('E.C.E'), 'E.C.E');
  assert.equal(codeFromText('  '), null);
  assert.equal(codeFromText('---'), null);
  assert.equal(codeFromText('a'.repeat(40))!.length, 20);
  assert.equal(cleanName('  Mechanical   Engineering '), 'Mechanical Engineering');
});

test('year of study from semester', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 8].map(yearOfSemester), [1, 1, 2, 2, 3, 4]);
});

test('resolve: match by code or name, create only when asked', async () => {
  const calls: string[] = [];
  const db = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push(sql.trim().split(/\s+/)[0]);
      if (sql.includes('SELECT')) return { rows: params?.[1] === 'CSE' ? [{ id: 7 }] : [] };
      return { rows: [{ id: 9 }] };
    },
  };
  assert.equal(await resolveDepartmentId(db, 'i', 'cse'), 7);
  assert.equal(await resolveDepartmentId(db, 'i', 'Mechanical'), null);
  assert.equal(await resolveDepartmentId(db, 'i', 'Mechanical', { create: true }), 9);
  assert.equal(await resolveDepartmentId(db, 'i', '   ', { create: true }), null);
  assert.deepEqual(calls, ['SELECT', 'SELECT', 'SELECT', 'INSERT']);
});
