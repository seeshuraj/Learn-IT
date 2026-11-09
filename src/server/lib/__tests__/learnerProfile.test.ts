import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatLearnerProfile, weakTopicsOf, improvementThemes, wantsStudyGuidance,
  loadLearnerProfile, PROFILE_MAX_CHARS, LearnerProfile,
} from '../learnerProfile.js';

const base: LearnerProfile = {
  exams: [
    { title: 'Unit Test 2', date: '2026-10-20', percentage: 64, band: 'moderate',
      topics: { 'Linked lists': 9, 'Tree traversal': 3, 'Hashing': 7, 'Graph search': 5 } },
  ],
  graded: [
    { title: 'Assignment 3: BST', grade: 14, maxPoints: 20, instructorFeedback: 'Good structure; postorder is wrong.',
      strengths: ['Clear code'], improvements: ['Revise tree traversal order', 'Add complexity analysis'] },
    { title: 'Assignment 2: Stacks', grade: 18, maxPoints: 20, instructorFeedback: null,
      strengths: ['Clear code'], improvements: ['Add complexity analysis'] },
  ],
  pendingSteps: ['Practise five inorder questions'],
};

test('weak topics are the lower half of each exam, lowest first', () => {
  assert.deepEqual(weakTopicsOf(base), ['Tree traversal', 'Graph search']);
});

test('recurring improvement points are ranked by frequency', () => {
  assert.deepEqual(improvementThemes(base), ['Add complexity analysis', 'Revise tree traversal order']);
});

test('profile text includes exams, weak topics, grades, feedback and plan', () => {
  const text = formatLearnerProfile(base);
  assert.match(text, /Unit Test 2: 64% \(moderate\); topic marks, lowest first: Tree traversal 3, Graph search 5/);
  assert.match(text, /Weakest exam topics: Tree traversal, Graph search/);
  assert.match(text, /Assignment 3: BST: 14\/20 — instructor: "Good structure; postorder is wrong\."/);
  assert.match(text, /Recurring points to improve: Add complexity analysis; Revise tree traversal order/);
  assert.match(text, /Strengths: Clear code$/m);
  assert.match(text, /Open study-plan steps: Practise five inorder questions/);
});

test('empty profile renders nothing', () => {
  assert.equal(formatLearnerProfile({ exams: [], graded: [], pendingSteps: [] }), '');
});

test('profile text is capped', () => {
  const long = 'x'.repeat(500);
  const big: LearnerProfile = {
    exams: Array.from({ length: 3 }, (_, i) => ({ title: long + i, date: null, percentage: 50, band: 'weak',
      topics: Object.fromEntries(Array.from({ length: 10 }, (_, k) => [long + k, k])) })),
    graded: Array.from({ length: 5 }, (_, i) => ({ title: long + i, grade: 1, maxPoints: 10,
      instructorFeedback: long, strengths: [long], improvements: [long, long + 'b'] })),
    pendingSteps: [long, long, long],
  };
  assert.ok(formatLearnerProfile(big).length <= PROFILE_MAX_CHARS);
});

test('study-guidance questions are recognised', () => {
  for (const q of ['What should I revise?', 'Where am I weak?', 'How do I improve my marks', 'Help me prepare for the exam']) {
    assert.ok(wantsStudyGuidance(q), q);
  }
  assert.ok(!wantsStudyGuidance('Explain Dijkstra’s algorithm'));
});

test('loader only reads graded submissions and parses AI feedback JSON', async () => {
  const seen: string[] = [];
  const db = {
    async query(sql: string, params?: unknown[]) {
      seen.push(sql);
      assert.deepEqual(params, [7, 3, 'inst-a']);
      if (sql.includes('unit_exam_results')) {
        return { rows: [{ title: 'UT1', exam_date: null, percentage: '55.5', performance_band: 'weak', topic_breakdown: '{"Heaps":"2","Sorting":6,"bad":"n/a"}' }] };
      }
      if (sql.includes('FROM submissions')) {
        return { rows: [{ title: 'A1', max_points: 10, grade: 6, feedback: 'ok',
          ai_feedback: JSON.stringify({ strengths: ['neat'], improvements: ['edge cases'] }), ai_strengths: null, ai_improvements: null }] };
      }
      return { rows: [{ title: 'Revise heaps' }] };
    },
  };
  const p = await loadLearnerProfile(db, { studentId: 7, courseId: 3, institutionId: 'inst-a' });
  assert.ok(seen.find(s => s.includes('FROM submissions'))!.includes('s.grade IS NOT NULL'));
  assert.deepEqual(p.exams[0].topics, { Heaps: 2, Sorting: 6 });
  assert.equal(p.exams[0].percentage, 55.5);
  assert.deepEqual(p.graded[0].improvements, ['edge cases']);
  assert.deepEqual(p.pendingSteps, ['Revise heaps']);

  // Second call within the TTL is served from cache.
  const before = seen.length;
  await loadLearnerProfile(db, { studentId: 7, courseId: 3, institutionId: 'inst-a' });
  assert.equal(seen.length, before);
});
