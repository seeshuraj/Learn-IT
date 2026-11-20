import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topicDetails, topicsFromUnits, topicMastery, type QuestionPattern } from '../topicMastery.js';

const q = (no: string, marks: number, either_or = false, module_id: number | null = null, module_id_b: number | null = null) =>
  ({ no, marks, either_or, module_id, module_id_b });
const paper: QuestionPattern = {
  version: 1,
  parts: [
    { key: 'A', label: 'Part A', answer_count: null, questions: ['1', '2', '3', '4', '5'].map(n => q(n, 2)) },
    { key: 'B', label: 'Part B', answer_count: null, questions: [q('6', 13, true), q('7', 13, true)] },
    { key: 'C', label: 'Part C', answer_count: null, questions: [q('8', 14, true)] },
  ],
};
const topics = [
  { topic: 'GROUP BY and aggregates', questions: ['3', '7b'] },
  { topic: 'Join basics', questions: ['5'] },
];

test('topic details: marks got and possible, the questions counted and those where marks were lost', () => {
  const seeshuraj = { '1': 2, '2': 1, '3': 1, '4': 2, '5': 1, '6': 12, '7': { m: 9, o: 'b' as const }, '8': { m: 13, o: 'b' as const } };
  assert.deepEqual(topicDetails(paper, seeshuraj, topics), [
    { topic: 'GROUP BY and aggregates', pct: 66.67, got: 10, max: 15, questions: ['3', '7b'], lost: ['3', '7b'] },
    { topic: 'Join basics', pct: 50, got: 1, max: 2, questions: ['5'], lost: ['5'] },
  ]);
});

test('units tagged on questions become topics, option (b) separately when its unit differs', () => {
  const tagged: QuestionPattern = { version: 1, parts: [{ key: 'A', label: 'A', answer_count: null, questions: [
    q('1', 2, false, 10), q('2', 2, false, 11), q('11', 13, true, 10, 11), q('12', 13, true, 11),
  ] }] };
  assert.deepEqual(topicsFromUnits(tagged, new Map([[10, 'Trees'], [11, 'Graphs']])), [
    { topic: 'Trees', questions: ['1', '11a'] },
    { topic: 'Graphs', questions: ['2', '11b', '12'] },
  ]);
});

const exam = (id: number, title: string, scores: [string, number, string[]][], classAvg: Record<string, number> = {}) => ({
  examId: id, title, courseId: 1, courseCode: 'CS3200',
  scores: scores.map(([topic, pct, lost]) => ({ topic, pct, got: pct, max: 100, questions: [], lost })),
  classAvg,
});

test('mastery across tests: latest score, trend against the previous test, average, weakest first', () => {
  const rows = topicMastery([   // newest first
    exam(3, 'Unit test 2', [['Joins', 40, ['5']], ['Views', 90, []]], { Joins: 61.5 }),
    exam(2, 'Unit test 1', [['Joins', 70, []], ['Keys', 30, ['1', '2']]]),
  ]);
  assert.deepEqual(rows.map(r => [r.topic, r.latest_pct, r.trend, r.avg_pct, r.tests]), [
    ['Keys', 30, null, 30, 1],
    ['Joins', 40, 'down', 55, 2],
    ['Views', 90, null, 90, 1],
  ]);
  const joins = rows.find(r => r.topic === 'Joins')!;
  assert.equal(joins.class_avg, 61.5);
  assert.deepEqual(joins.latest, { exam_id: 3, title: 'Unit test 2', lost: ['5'] });
});

test('a change under 5 points is steady; the same topic name in two courses stays two topics', () => {
  const a = exam(2, 'T2', [['Joins', 72, []]]);
  const b = exam(1, 'T1', [['Joins', 70, []]]);
  const other = { ...exam(9, 'DS T1', [['Joins', 20, []]]), courseId: 2, courseCode: 'CS2100' };
  const rows = topicMastery([a, other, b]);
  assert.equal(rows.find(r => r.course_code === 'CS3200')!.trend, 'same');
  assert.equal(rows.length, 2);
});
