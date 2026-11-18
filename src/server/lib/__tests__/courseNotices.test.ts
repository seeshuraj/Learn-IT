import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNotice, noticeMessage, dueLabel } from '../courseNotices.js';

test('readNotice validates and trims a new notice', () => {
  const r = readNotice({ kind: 'bring', title: '  Drawing kit and mini-drafter ', body: ' For the lab ', due_date: '2026-11-19', pinned: true }, false);
  assert.deepEqual(r, { values: { kind: 'bring', title: 'Drawing kit and mini-drafter', body: 'For the lab', due_date: '2026-11-19', pinned: true } });
});

test('readNotice defaults and rejects', () => {
  assert.deepEqual(readNotice({ title: 'Read chapter 4' }, false), { values: { kind: 'notice', title: 'Read chapter 4', body: null, due_date: null, pinned: false } });
  assert.ok('error' in readNotice({ title: '' }, false));
  assert.ok('error' in readNotice({ title: 'x'.repeat(201) }, false));
  assert.ok('error' in readNotice({ title: 'Ok', kind: 'party' }, false));
  assert.ok('error' in readNotice({ title: 'Ok', due_date: '19/11/2026' }, false));
  assert.ok('error' in readNotice({ title: 'Ok', due_date: '2026-02-30' }, false));
  assert.ok('error' in readNotice({ title: 'Ok', body: 'y'.repeat(4001) }, false));
});

test('readNotice partial keeps only the fields sent', () => {
  assert.deepEqual(readNotice({ pinned: false }, true), { values: { pinned: false } });
  assert.deepEqual(readNotice({ due_date: null }, true), { values: { due_date: null } });
});

test('dueLabel speaks in days from today (IST)', () => {
  assert.equal(dueLabel('2026-11-18', '2026-11-18'), 'today');
  assert.equal(dueLabel('2026-11-19', '2026-11-18'), 'tomorrow');
  assert.equal(dueLabel('2026-11-21', '2026-11-18'), 'Sat 21 Nov');
  assert.equal(dueLabel(null, '2026-11-18'), null);
});

test('noticeMessage for the bell', () => {
  assert.equal(noticeMessage({ code: 'CS3200', kind: 'bring', title: 'Drawing kit', due_date: '2026-11-19' }, '2026-11-18'), 'CS3200 · Bring tomorrow: Drawing kit');
  assert.equal(noticeMessage({ code: null, kind: 'exam_prep', title: 'Unit 2 for the test', due_date: null }, '2026-11-18'), 'Prepare: Unit 2 for the test');
  assert.equal(noticeMessage({ code: 'CS3200', kind: 'notice', title: 'Class moved to Lab 3', due_date: '2026-11-18' }, '2026-11-18'), 'CS3200 · Notice for today: Class moved to Lab 3');
});
