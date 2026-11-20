import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveQuestionRefs, paperTopicWeights, paperTopicBreakdown, type QuestionPattern } from '../questionPattern.js';
import { parsePaperTopics } from '../paperTopics.js';

// Audit unit test 1: Part A 5 × 2, Part B 2 × 13 (a)/(b), Part C 1 × 14 (a)/(b) = 50.
const q = (no: string, marks: number, either_or = false) => ({ no, marks, either_or, module_id: null });
const paper: QuestionPattern = {
  version: 1,
  parts: [
    { key: 'A', label: 'Part A', answer_count: null, questions: ['1', '2', '3', '4', '5'].map(n => q(n, 2)) },
    { key: 'B', label: 'Part B', answer_count: null, questions: [q('6', 13, true), q('7', 13, true)] },
    { key: 'C', label: 'Part C', answer_count: null, questions: [q('8', 14, true)] },
  ],
};

test('question references are read the ways people and models write them', () => {
  assert.deepEqual(resolveQuestionRefs(['Q3', '7(b)', '6 a', 'q8', '7B', '3'], paper), ['3', '7b', '6a', '8']);
});

test('references that are not on the paper are dropped; an option on a plain question is ignored', () => {
  assert.deepEqual(resolveQuestionRefs(['12', '3a', 'Part A', '', '6c'], paper), ['3']);
});

test('weights come from the marks: a 2-mark question is 4% of 50, an option of a 13-mark question 26%', () => {
  const w = paperTopicWeights(paper, [
    { topic: 'Aggregation', questions: ['3', '7b'] },
    { topic: 'Keys and DDL', questions: ['1', '2'] },
    { topic: 'Normalisation or transactions', questions: ['8'] },
    { topic: 'Unmapped', questions: [] },
  ]);
  assert.deepEqual(w.get('Aggregation'), { marks: 15, share: 30 });
  assert.deepEqual(w.get('Keys and DDL'), { marks: 4, share: 8 });
  assert.deepEqual(w.get('Normalisation or transactions'), { marks: 14, share: 28 });
  assert.equal(w.get('Unmapped'), undefined);
});

const topics = [
  { topic: 'GROUP BY and aggregates', questions: ['3', '7b'] },
  { topic: 'Join basics', questions: ['5'] },
  { topic: 'Joins and subqueries', questions: ['7a'] },
  { topic: 'Normalisation or transactions', questions: ['8'] },
];

test('a student is scored on the option they wrote: Seeshuraj (Q3 1/2, Q7(b) 9/13)', () => {
  const marks = { '1': 2, '2': 1, '3': 1, '4': 2, '5': 1, '6': 12, '7': { m: 9, o: 'b' as const }, '8': { m: 13, o: 'b' as const } };
  assert.deepEqual(paperTopicBreakdown(paper, marks, topics), {
    'GROUP BY and aggregates': 66.67,      // (1 + 9) / (2 + 13)
    'Join basics': 50,
    'Normalisation or transactions': 92.86, // 13 / 14, whichever option
  });                                        // Q7(a) not written: no score for "Joins and subqueries"
});

test('a plain number on an (a)/(b) question means option (a): Sarah (Q5 0/2, Q7 12 → 7a)', () => {
  const marks = { '1': 2, '2': 2, '3': 1.5, '4': 2, '5': 0, '6': { m: 10, o: 'b' as const }, '7': 12, '8': 11 };
  const b = paperTopicBreakdown(paper, marks, topics)!;
  assert.equal(b['Join basics'], 0);
  assert.equal(b['Joins and subqueries'], 92.31);       // 12 / 13
  assert.equal(b['GROUP BY and aggregates'], 75);       // only Q3 counts: 1.5 / 2
});

test('an unanswered question counts as 0, except where the part says "answer any N"', () => {
  const anyTwo: QuestionPattern = { version: 1, parts: [{ key: 'A', label: 'A', answer_count: 2, questions: [q('1', 5), q('2', 5), q('3', 5)] }] };
  assert.deepEqual(paperTopicBreakdown(anyTwo, { '1': 5, '2': 3 }, [{ topic: 'T', questions: ['1', '2', '3'] }]), { T: 80 });
  assert.deepEqual(paperTopicBreakdown(paper, { '1': 2 }, [{ topic: 'Basics', questions: ['1', '2'] }]), { Basics: 50 });
});

test('no mapped topics, or no marks: no breakdown', () => {
  assert.equal(paperTopicBreakdown(paper, { '1': 2 }, [{ topic: 'T', questions: [] }]), null);
  assert.equal(paperTopicBreakdown(paper, {}, []), null);
});

test('the model can list each topic\'s questions as an array or as text', () => {
  const t = parsePaperTopics('[{"topic":"Joins","questions":["5","7a"],"difficulty":"medium"},{"topic":"Views","question_numbers":"Q4, 6(b)"}]');
  assert.deepEqual(t.map(x => x.questions), [['5', '7a'], ['Q4', '6(b)']]);
});
