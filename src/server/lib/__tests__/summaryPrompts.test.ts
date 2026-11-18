import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyticsSummaryMessages } from '../summaryPrompts.js';

const a = {
  studentName: 'Sarah Johnson', overallAverage: 83.5, submissionRate: 67,
  courses: [{ name: 'Database Systems', average: 87, assignments: 1, late: 0 }, { name: 'Algorithms', average: 0, assignments: 1, late: 0 }],
};

test('a student is addressed as "you" and their name is not sent to the model', () => {
  const m = analyticsSummaryMessages(a, 'student');
  const all = m.map(x => x.content).join('\n');
  assert.match(m[0].content, /second person/i);
  assert.match(m[0].content, /"you"/);
  assert.doesNotMatch(all, /Sarah|Johnson/);
  assert.match(all, /Database Systems: avg 87%/);
});

test('staff get "this student", also without the name', () => {
  const m = analyticsSummaryMessages(a, 'staff');
  const all = m.map(x => x.content).join('\n');
  assert.match(m[0].content, /this student/);
  assert.doesNotMatch(all, /Sarah|Johnson/);
});
