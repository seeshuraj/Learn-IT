import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendar, istToUtcStamp, fold, icsText, examTimes } from '../ics.js';

test('IST times written in UTC', () => {
  assert.equal(istToUtcStamp('2026-12-02', '09:30'), '20261202T040000Z');
  assert.equal(istToUtcStamp('2026-12-02', '02:00'), '20261201T203000Z');
});

test('times: own, session default, or none', () => {
  assert.deepEqual(examTimes({ session: 'FN', start_time: '10:00', end_time: '13:00' }), { start: '10:00', end: '13:00' });
  assert.deepEqual(examTimes({ session: null, start_time: '10:00', end_time: null }), { start: '10:00', end: '13:00' });
  assert.deepEqual(examTimes({ session: 'AN', start_time: null, end_time: null }), { start: '13:30', end: '16:30' });
  assert.equal(examTimes({ session: null, start_time: null, end_time: null }), null);
});

test('text escaping and line folding', () => {
  assert.equal(icsText('Hall A, Block 2; room\n3'), 'Hall A\\, Block 2\\; room\\n3');
  const long = 'DESCRIPTION:' + 'அ'.repeat(40);
  const folded = fold(long);
  for (const line of folded.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  assert.equal(folded.split('\r\n').map((l, i) => (i ? l.slice(1) : l)).join(''), long);
});

test('calendar: events with UID, alarm, all-day fallback', () => {
  const ics = buildCalendar([
    { id: 7, exam_date: '2026-12-02', session: 'FN', start_time: '09:30', end_time: '12:30', course_code: 'CS3401', course_name: 'Algorithms', title: 'Unit test 2', venue: 'B-201' },
    { id: 8, exam_date: '2026-12-31', session: null, start_time: null, end_time: null, course_code: null, course_name: 'Maths', title: 'Model exam', venue: null },
  ], { name: 'Exams · Test College', now: new Date('2026-11-17T00:00:00Z') });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.match(ics, /UID:exam-7@learnitanalytics\.com/);
  assert.match(ics, /DTSTART:20261202T040000Z\r\nDTEND:20261202T070000Z/);
  assert.match(ics, /SUMMARY:CS3401 Unit test 2/);
  assert.match(ics, /LOCATION:B-201/);
  assert.match(ics, /TRIGGER:-P1D/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
});
