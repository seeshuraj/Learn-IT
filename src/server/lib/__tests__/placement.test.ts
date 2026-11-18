import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPlacement } from '../departments.js';

test('only the department is sent: semester is left alone, nothing is NaN', () => {
  assert.deepEqual(readPlacement({ department_id: 3 }), { hasDept: true, dept: 3, hasSem: false, sem: null });
});

test('only the semester is sent', () => {
  assert.deepEqual(readPlacement({ semester: 5 }), { hasDept: false, dept: null, hasSem: true, sem: 5 });
  assert.deepEqual(readPlacement({ semester: '5' }), { hasDept: false, dept: null, hasSem: true, sem: 5 });
});

test('clearing with null or empty', () => {
  assert.deepEqual(readPlacement({ department_id: null, semester: '' }), { hasDept: true, dept: null, hasSem: true, sem: null });
});

test('invalid values are errors, not NaN', () => {
  assert.deepEqual(readPlacement({ department_id: 'x' }), { error: 'Invalid department' });
  assert.deepEqual(readPlacement({ semester: 13 }), { error: 'Semester must be 1–12' });
  assert.deepEqual(readPlacement({}), { error: 'Nothing to change' });
});
