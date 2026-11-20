import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollUp, type CourseStats } from '../performance.js';

const course = (o: Partial<CourseStats>): CourseStats => ({
  id: 1, code: 'C', name: 'C', department_id: null, semester: null, instructor_id: null, instructor_name: null,
  enrolled: 0, modules: 0, notes: 0, assignments: 0, assessments: 0,
  written: 0, pct_sum: 0, passed: 0, absent: 0, at_risk: 0,
  submissions: 0, graded: 0, pending: 0, turnaround_hours_sum: 0, timed: 0,
  weak_topics: [],
  ...o,
});

test('roll-up weights averages by results written, not by course', () => {
  const [p] = rollUp([
    course({ id: 1, instructor_id: 7, written: 10, pct_sum: 800, passed: 9, enrolled: 10 }),   // 80%
    course({ id: 2, instructor_id: 7, written: 30, pct_sum: 1200, passed: 15, enrolled: 30 }), // 40%
  ], c => c.instructor_id);
  assert.equal(p.key, 7);
  assert.equal(p.courses, 2);
  assert.equal(p.avg_pct, 50);
  assert.equal(p.pass_rate, 60);
  assert.equal(p.enrolled, 40);
});

test('grading turnaround is the mean over graded submissions with both times; pending is summed', () => {
  const [p] = rollUp([
    course({ graded: 3, timed: 2, turnaround_hours_sum: 20, pending: 1, submissions: 4 }),
    course({ id: 2, graded: 3, timed: 3, turnaround_hours_sum: 130, pending: 2, submissions: 5 }),
  ], () => 'all');
  assert.equal(p.avg_turnaround_hours, 30);
  assert.equal(p.pending, 3);
  assert.equal(p.submissions, 9);
  assert.equal(p.graded, 6);
});

test('no results gives null averages, never 0% or NaN', () => {
  const [p] = rollUp([course({ enrolled: 5, modules: 3, notes: 4 })], () => 1);
  assert.equal(p.avg_pct, null);
  assert.equal(p.pass_rate, null);
  assert.equal(p.avg_turnaround_hours, null);
  assert.equal(p.materials, 7);
});

test('weak topics merge across courses (weighted by writers), weakest three', () => {
  const [d] = rollUp([
    course({ weak_topics: [{ topic: 'Joins', avg_pct: 40, n: 10 }, { topic: 'Keys', avg_pct: 90, n: 10 }] }),
    course({ id: 2, weak_topics: [{ topic: 'Joins', avg_pct: 70, n: 30 }, { topic: 'Trees', avg_pct: 30, n: 5 }, { topic: 'Heaps', avg_pct: 55, n: 5 }] }),
  ], () => 'd');
  assert.deepEqual(d.weak_topics, [
    { topic: 'Trees', avg_pct: 30, n: 5 },
    { topic: 'Heaps', avg_pct: 55, n: 5 },
    { topic: 'Joins', avg_pct: 62.5, n: 40 },
  ]);
});

test('groups keep first-seen order and include a null key (unassigned)', () => {
  const rows = rollUp([course({ id: 1, department_id: 2 }), course({ id: 2 }), course({ id: 3, department_id: 2 })], c => c.department_id);
  assert.deepEqual(rows.map(r => [r.key, r.courses]), [[2, 2], [null, 1]]);
});
