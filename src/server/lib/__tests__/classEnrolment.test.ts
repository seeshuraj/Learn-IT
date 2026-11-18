import { test } from 'node:test';
import assert from 'node:assert/strict';
import { termParity, semesterOf, readTermSetting } from '../classEnrolment.js';

const ist = (iso: string) => Date.parse(`${iso}T12:00:00+05:30`);

test('term follows the Indian academic calendar: odd Jul–Dec, even Jan–Jun', () => {
  assert.equal(termParity('auto', ist('2026-07-01')), 'odd');
  assert.equal(termParity('auto', ist('2026-11-18')), 'odd');
  assert.equal(termParity('auto', ist('2026-12-31')), 'odd');
  assert.equal(termParity('auto', ist('2027-01-01')), 'even');
  assert.equal(termParity('auto', ist('2027-06-30')), 'even');
});

test('the date is read in IST, not UTC', () => {
  // 1 Jan 00:30 IST is still 31 Dec in UTC.
  assert.equal(termParity('auto', Date.parse('2027-01-01T00:30:00+05:30')), 'even');
  // 1 Jul 01:00 IST is still 30 Jun in UTC.
  assert.equal(termParity('auto', Date.parse('2026-07-01T01:00:00+05:30')), 'odd');
});

test('an admin setting overrides the calendar', () => {
  assert.equal(termParity('even', ist('2026-11-18')), 'even');
  assert.equal(termParity('odd', ist('2027-03-01')), 'odd');
});

test('semester of a year of study in a term', () => {
  assert.equal(semesterOf(1, 'odd'), 1);
  assert.equal(semesterOf(1, 'even'), 2);
  assert.equal(semesterOf(2, 'odd'), 3);   // lateral entry joins here
  assert.equal(semesterOf(2, 'even'), 4);
  assert.equal(semesterOf(4, 'even'), 8);
  assert.equal(semesterOf(5, 'even'), 10); // five-year programmes
  assert.equal(semesterOf(null, 'odd'), null);
  assert.equal(semesterOf(0, 'odd'), null);
});

test('term setting accepts odd, even or auto only', () => {
  assert.equal(readTermSetting(undefined), 'auto');
  assert.equal(readTermSetting('odd'), 'odd');
  assert.equal(readTermSetting(' EVEN '), 'even');
  assert.equal(readTermSetting('summer'), 'auto');
});
