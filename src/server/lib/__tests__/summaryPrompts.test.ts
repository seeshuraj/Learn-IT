import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyticsSummaryMessages, classOverviewMessages } from '../summaryPrompts.js';

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

test('class overview sends labels, not student names, and restores names in the reply', () => {
  const { messages, restoreNames } = classOverviewMessages({
    courseName: 'Database Systems', classAverage: 71,
    students: [
      { name: 'Sarah Johnson', average: 83, missed: 0, status: 'On track' },
      { name: 'Michael Chen', average: 41, missed: 3, status: 'At risk' },
    ],
  });
  const all = messages.map(x => x.content).join('\n');
  assert.doesNotMatch(all, /Sarah|Johnson|Michael|Chen/);
  assert.match(all, /S1: avg 83%, missed 0/);
  assert.match(all, /S2: avg 41%, missed 3, status: At risk/);
  assert.equal(
    restoreNames('**S2** is at risk; **S1** leads. S3 and S10 are unknown.'),
    '**Michael Chen** is at risk; **Sarah Johnson** leads. S3 and S10 are unknown.',
  );
});
