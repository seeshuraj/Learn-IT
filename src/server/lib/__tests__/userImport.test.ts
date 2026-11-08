import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateImportRows, normaliseHeader, IMPORT_MAX_ROWS } from '../userImport.js';

test('accepts common header spellings and normalises values', () => {
  const { valid, issues } = validateImportRows([
    { 'Full Name': '  Priya   R ', 'Email Address': 'Priya@College.edu.in', Role: 'Student', Year: '2', Department: 'CSE' },
    { Name: 'Dr. Kumar', 'Email ID': 'kumar@college.edu.in', Type: 'Professor', Year: '3' },
  ]);
  assert.deepEqual(issues, []);
  assert.deepEqual(valid, [
    { row: 2, name: 'Priya R', email: 'priya@college.edu.in', role: 'student', year: 2, major: 'CSE' },
    // Year is only kept for students.
    { row: 3, name: 'Dr. Kumar', email: 'kumar@college.edu.in', role: 'instructor', year: null, major: null },
  ]);
});

test('role defaults to student when the column is absent or empty', () => {
  const { valid } = validateImportRows([{ name: 'A', email: 'a@x.in' }, { name: 'B', email: 'b@x.in', role: '' }]);
  assert.deepEqual(valid.map(v => v.role), ['student', 'student']);
});

test('rejects admins and unknown roles, with the spreadsheet row number', () => {
  const { valid, issues } = validateImportRows([
    { name: 'A', email: 'a@x.in', role: 'admin' },
    { name: 'B', email: 'b@x.in', role: 'principal' },
  ]);
  assert.equal(valid.length, 0);
  assert.deepEqual(issues.map(i => i.row), [2, 3]);
  assert.match(issues[0].reason, /not recognised/);
});

test('reports missing and invalid fields, duplicates, existing accounts and bad years', () => {
  const { valid, issues } = validateImportRows(
    [
      { name: 'No Email', email: '' },
      { name: 'Bad', email: 'not-an-email' },
      { name: '', email: 'noname@x.in' },
      { name: 'First', email: 'dup@x.in' },
      { name: 'Second', email: 'DUP@x.in' },
      { name: 'Taken', email: 'taken@x.in' },
      { name: 'Year', email: 'year@x.in', year: '13' },
      { name: 'Ok', email: 'ok@x.in', year: '' },
    ],
    new Set(['taken@x.in']),
  );
  assert.deepEqual(valid.map(v => v.email), ['dup@x.in', 'ok@x.in']);
  assert.deepEqual(
    issues.map(i => [i.row, i.reason]),
    [
      [2, 'Email is missing'],
      [3, 'Email is not valid'],
      [4, 'Name is missing'],
      [6, 'Email appears more than once in this file'],
      [7, 'An account with this email already exists'],
      [8, 'Year must be a whole number from 1 to 10'],
    ],
  );
});

test('skips blank lines without reporting them', () => {
  const { valid, issues } = validateImportRows([{ name: '', email: '' }, { name: 'A', email: 'a@x.in' }]);
  assert.equal(valid.length, 1);
  assert.equal(valid[0].row, 3);
  assert.deepEqual(issues, []);
});

test('refuses files over the row limit', () => {
  const rows = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => ({ name: `S${i}`, email: `s${i}@x.in` }));
  const { valid, issues } = validateImportRows(rows);
  assert.equal(valid.length, 0);
  assert.match(issues[0].reason, /limit/);
});

test('normaliseHeader', () => {
  assert.equal(normaliseHeader(' Email Address '), 'email_address');
  assert.equal(normaliseHeader('E-mail'), 'e_mail');
});

test('temporary passwords are 16 chars, mixed, and never start with a formula character', async () => {
  const { generateTempPassword } = await import('../tempPassword.js');
  for (let i = 0; i < 500; i++) {
    const p = generateTempPassword();
    assert.equal(p.length, 16);
    assert.match(p, /^[A-Za-z0-9]/);
    assert.match(p, /[A-Z]/);
    assert.match(p, /[2-9]/);
    assert.match(p, /[!@#$%^&*]/);
  }
});
