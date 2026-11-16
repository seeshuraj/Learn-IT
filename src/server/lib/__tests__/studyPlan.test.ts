import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  schedulePlan, revisionDays, milestoneCount, rankWeakTopics, addDays, daysBetween, todayIst, type TargetExam,
} from '../studyPlan.js';

const exam: TargetExam = { unit_exam_id: 9, title: 'Unit test 2', exam_date: '2026-11-27', session: 'FN', start_time: null, venue: 'B-201' };
const modules = [{ id: 1, name: 'Graph Algorithms' }, { id: 2, name: 'Dynamic Programming' }];

test('date helpers', () => {
  assert.equal(addDays('2026-11-30', 2), '2026-12-02');
  assert.equal(daysBetween('2026-11-17', '2026-11-27'), 10);
  assert.equal(todayIst(Date.parse('2026-11-16T19:00:00Z')), '2026-11-17'); // 00:30 IST
});

test('revision days and plan size scale with time left', () => {
  assert.deepEqual([1, 4, 10].map(revisionDays), [0, 1, 2]);
  assert.deepEqual(milestoneCount(null), { min: 5, max: 8 });
  assert.deepEqual(milestoneCount(2), { min: 3, max: 3 });
  assert.deepEqual(milestoneCount(30), { min: 12, max: 14 });
});

test('dates clamped to study days, other exams avoided, exam added last', () => {
  const plan = schedulePlan([
    { title: 'Revise BFS/DFS', date: '2026-11-16', kind: 'learn', module: 'graph algorithms', minutes: 45 },
    { title: 'Past paper', date: '2026-11-30', kind: 'practice', minutes: 999 },
    { title: 'DP practice', date: '2026-11-20', kind: 'practice', topic: 'Knapsack', module: 'Dynamic' },
    { title: 'Fake exam', kind: 'exam' },
    { title: '' },
  ], { today: '2026-11-17', exam, busyDays: ['2026-11-20', '2026-11-27'], modules });

  assert.deepEqual(plan.map(m => [m.title, m.due_date, m.kind]), [
    ['Revise BFS/DFS', '2026-11-17', 'learn'],
    ['DP practice', '2026-11-19', 'practice'],        // 20th has another exam
    ['Past paper', '2026-11-26', 'practice'],          // clamped to the day before
    ['Unit test 2', '2026-11-27', 'exam'],
  ]);
  assert.equal(plan[0].module_id, 1);
  assert.equal(plan[1].module_id, 2);
  assert.equal(plan[1].topic, 'Knapsack');
  assert.equal(plan[2].est_minutes, 240);
  assert.match(plan[3].description!, /forenoon \(FN\), hall B-201/);
});

test('missing dates are spread over the window; no exam means undated', () => {
  const spread = schedulePlan([{ title: 'a' }, { title: 'b' }, { title: 'c' }], { today: '2026-11-17', exam });
  assert.deepEqual(spread.slice(0, 3).map(m => m.due_date), ['2026-11-17', '2026-11-22', '2026-11-26']);
  const undated = schedulePlan([{ title: 'a', date: '2026-11-20' }], { today: '2026-11-17', exam: null });
  assert.equal(undated.length, 1);
  assert.equal(undated[0].due_date, null);
});

test('exam today: everything today, exam last', () => {
  const plan = schedulePlan([{ title: 'Quick recap', date: '2026-11-25' }], { today: '2026-11-27', exam });
  assert.deepEqual(plan.map(m => m.due_date), ['2026-11-27', '2026-11-27']);
});

test('weak topics: lowest-scoring topics, portion first', () => {
  const ranked = rankWeakTopics([
    { performance_band: 'moderate', topic_breakdown: { 'Greedy': 4, 'Graph search': 2, 'Sorting': 9 } },
    { performance_band: 'weak', topic_breakdown: '{"Dynamic programming": 1, "Recursion": 3}' },
  ], ['Write clearer proofs'], ['Graph Algorithms']);
  assert.equal(ranked[0].topic, 'Graph search');   // not the highest score, but in the portion
  assert.equal(ranked[0].inPortion, true);
  assert.equal(ranked.find(r => r.topic === 'Dynamic programming')?.inPortion, false);
  assert.ok(!ranked.some(r => r.topic === 'Recursion'));   // the better half of a weak exam
  assert.ok(ranked.some(r => r.topic === 'Dynamic programming'));
  assert.ok(!ranked.some(r => r.topic === 'Sorting'));
  assert.ok(ranked.some(r => r.topic === 'Write clearer proofs'));
});
