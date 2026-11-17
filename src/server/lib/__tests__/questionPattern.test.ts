import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePattern, paperTotal, partMax, parseCell, scoreQuestions, topicBreakdown, ANNA_UNIV_SEMESTER,
  type QuestionPattern,
} from '../questionPattern.js';

const unitTest: QuestionPattern = {
  version: 1,
  parts: [
    { key: 'A', label: 'Part A', answer_count: null, questions: [1, 2, 3, 4, 5].map(n => ({ no: String(n), marks: 2, either_or: false, module_id: 10 })) },
    { key: 'B', label: 'Part B', answer_count: 2, questions: [
      { no: '6', marks: 8, either_or: false, module_id: 10 },
      { no: '7', marks: 8, either_or: false, module_id: 11 },
      { no: '8', marks: 16, either_or: false, module_id: 11 },
    ] },
    { key: 'C', label: 'Part C', answer_count: null, questions: [{ no: '9', marks: 16, either_or: true, module_id: 10, module_id_b: 11 }] },
  ],
};

test('Anna University semester preset totals 100', () => {
  assert.equal(paperTotal(ANNA_UNIV_SEMESTER), 100);
  assert.deepEqual(ANNA_UNIV_SEMESTER.parts.map(p => p.questions.length), [10, 5, 1]);
  assert.equal(ANNA_UNIV_SEMESTER.parts[1].questions[0].no, '11');
  assert.ok(ANNA_UNIV_SEMESTER.parts[1].questions.every(q => q.either_or));
});

test('answer any N: part max is the N largest questions', () => {
  assert.equal(partMax(unitTest.parts[1]), 24);
  assert.equal(paperTotal(unitTest), 10 + 24 + 16);
});

test('parseCell reads either/or options', () => {
  assert.deepEqual(parseCell('12B', true), { mark: { m: 12, o: 'b' } });
  assert.deepEqual(parseCell(' 12 b', true), { mark: { m: 12, o: 'b' } });
  assert.deepEqual(parseCell('12', true), { mark: { m: 12, o: 'a' } });
  assert.deepEqual(parseCell(7.5, false), { mark: 7.5 });
  assert.deepEqual(parseCell('', false), { mark: null });
  assert.deepEqual(parseCell(null, true), { mark: null });
  assert.ok('error' in parseCell('b12', true));
  assert.ok('error' in parseCell('12a', false));
  assert.ok('error' in parseCell('abc', false));
  assert.ok('error' in parseCell(-1, false));
  assert.ok('error' in parseCell(1.25, false));
});

test('scoreQuestions sums parts, counting the best N in an "any N" part', () => {
  const r = scoreQuestions(unitTest, { '1': 2, '2': 1.5, '6': 8, '7': 6, '8': 10, '9': { m: 12, o: 'b' } });
  assert.ok(!('error' in r));
  if ('error' in r) return;
  assert.equal(r.total, 3.5 + 18 + 12);
  assert.deepEqual(r.parts.map(p => [p.key, p.score, p.max]), [['A', 3.5, 10], ['B', 18, 24], ['C', 12, 16]]);
});

test('scoreQuestions rejects marks above a question, unknown questions and non-halves', () => {
  assert.match((scoreQuestions(unitTest, { '1': 2.5 }) as any).error, /Q1.*2/);
  assert.match((scoreQuestions(unitTest, { '99': 1 }) as any).error, /Q99/);
  assert.match((scoreQuestions(unitTest, { '2': 1.25 }) as any).error, /halves/);
  assert.match((scoreQuestions(unitTest, { '9': 20 }) as any).error, /Q9/);
});

test('validatePattern accepts a good pattern and normalises it', () => {
  const r = validatePattern(JSON.parse(JSON.stringify(unitTest)));
  assert.ok('pattern' in r);
});

test('validatePattern rejects bad patterns', () => {
  const bad = (p: unknown) => 'error' in validatePattern(p);
  assert.ok(bad(null));
  assert.ok(bad({ version: 1, parts: [] }));
  assert.ok(bad({ version: 1, parts: [{ key: 'A', label: 'Part A', answer_count: null, questions: [] }] }));
  const many = { version: 1, parts: [{ key: 'A', label: 'A', answer_count: null, questions: Array.from({ length: 61 }, (_, i) => ({ no: String(i + 1), marks: 1, either_or: false, module_id: null })) }] };
  assert.ok(bad(many));
  const dup = JSON.parse(JSON.stringify(unitTest)); dup.parts[1].questions[0].no = '1';
  assert.ok(bad(dup));
  const zero = JSON.parse(JSON.stringify(unitTest)); zero.parts[0].questions[0].marks = 0;
  assert.ok(bad(zero));
  const tooMany = JSON.parse(JSON.stringify(unitTest)); tooMany.parts[1].answer_count = 4;
  assert.ok(bad(tooMany));
});

test('topicBreakdown gives % per unit, using option b’s unit when b was written', () => {
  const names = new Map([[10, 'Unit 1: Relational model'], [11, 'Unit 2: SQL']]);
  const t = topicBreakdown(unitTest, { '1': 2, '2': 1, '6': 8, '7': 4, '8': 8, '9': { m: 8, o: 'b' } }, names);
  // Unit 1: Q1–5 (3/10) + Q6 (8/8) = 11/18. Unit 2: Q7 (4/8) + Q8 (8/16) + Q9b (8/16) = 20/40.
  assert.deepEqual(t, { 'Unit 1: Relational model': 61.11, 'Unit 2: SQL': 50 });
  assert.equal(topicBreakdown(ANNA_UNIV_SEMESTER, { '1': 2 }, names), null);
});
