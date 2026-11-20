import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePaperTopics } from '../paperTopics.js';

const arr = '[{"topic":"SQL joins","weight":30,"difficulty":"medium"},{"topic":"Normalisation","weight":28,"difficulty":"hard"}]';
const expected = [
  { topic: 'SQL joins', weight: 30, difficulty: 'medium' },
  { topic: 'Normalisation', weight: 28, difficulty: 'hard' },
];

test('a bare JSON array', () => assert.deepEqual(parsePaperTopics(arr), expected));

test('fenced, with a sentence before and after', () => {
  assert.deepEqual(parsePaperTopics(`Here are the topics:\n\`\`\`json\n${arr}\n\`\`\`\nLet me know if you need more.`), expected);
});

test('reasoning in <think> before the answer, even one that mentions [brackets]', () => {
  assert.deepEqual(parsePaperTopics(`<think>Part A has [5] questions...</think>\n${arr}`), expected);
});

test('an object wrapping the list', () => {
  assert.deepEqual(parsePaperTopics(`{"topics": ${arr}}`), expected);
});

test('cleans each item: names trimmed, weights kept to 0–100, difficulty to easy/medium/hard', () => {
  const raw = '[{"topic":"  Views  ","weight":"12%","difficulty":"Easy"},{"topic":"Keys","weight":250,"difficulty":"very hard"},'
    + '{"topic":"","weight":5},{"weight":9},{"name":"Transactions","percentage":14,"level":"Hard"}]';
  assert.deepEqual(parsePaperTopics(raw), [
    { topic: 'Views', weight: 12, difficulty: 'easy' },
    { topic: 'Keys', weight: 100, difficulty: null },
    { topic: 'Transactions', weight: 14, difficulty: 'hard' },
  ]);
});

test('no list at all, or broken JSON, gives an empty list', () => {
  assert.deepEqual(parsePaperTopics('I could not find any topics.'), []);
  assert.deepEqual(parsePaperTopics('[{"topic": "SQL", "weight": 3'), []);
  assert.deepEqual(parsePaperTopics(''), []);
});

test('at most 20 topics, duplicates merged by name', () => {
  const many = JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ topic: `T${i % 25}`, weight: 1 })));
  const out = parsePaperTopics(many);
  assert.equal(out.length, 20);
  assert.equal(new Set(out.map(t => t.topic)).size, 20);
});

test('keys in any case or with symbols: "Topic", "Weight (%)", "weightage", "Difficulty level"', () => {
  const raw = '[{"Topic":"Joins","Weight (%)":"26","Difficulty":"MEDIUM"},{"Topic Name":"Views","weightage":4,"Difficulty level":"easy"}]';
  assert.deepEqual(parsePaperTopics(raw), [
    { topic: 'Joins', weight: 26, difficulty: 'medium' },
    { topic: 'Views', weight: 4, difficulty: 'easy' },
  ]);
});
