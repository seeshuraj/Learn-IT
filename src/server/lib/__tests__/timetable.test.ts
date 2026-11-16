import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDate, parseTime, parseOrdinal, normaliseEntry, readTimetableRow, isRowPerExam, matchCourse, type CourseRef,
} from '../timetable.js';

test('dates: day-first numeric, names, ISO, Excel serials, weekdays', () => {
  assert.equal(parseDate('12/11/2026'), '2026-11-12');
  assert.equal(parseDate('2-1-27'), '2027-01-02');
  assert.equal(parseDate('12.11.2026 (Thursday)'), '2026-11-12');
  assert.equal(parseDate('Thursday, 12th Nov 2026'), '2026-11-12');
  assert.equal(parseDate('12-Nov-26'), '2026-11-12');
  assert.equal(parseDate('November 12, 2026'), '2026-11-12');
  assert.equal(parseDate('2026-11-12'), '2026-11-12');
  assert.equal(parseDate(46338), '2026-11-12');
  assert.equal(parseDate(new Date(2026, 10, 12)), '2026-11-12');
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(parseDate('soon'), null);
  assert.equal(parseDate(''), null);
});

test('sessions and times', () => {
  assert.deepEqual(parseTime('FN'), { session: 'FN', start: null, end: null });
  assert.deepEqual(parseTime('Afternoon'), { session: 'AN', start: null, end: null });
  assert.deepEqual(parseTime('10.00 AM - 1.00 PM'), { session: 'FN', start: '10:00', end: '13:00' });
  assert.deepEqual(parseTime('10.00 - 1.00'), { session: 'FN', start: '10:00', end: '13:00' });
  assert.deepEqual(parseTime('9:30 to 12:30'), { session: 'FN', start: '09:30', end: '12:30' });
  assert.deepEqual(parseTime('2.00 - 5.00 PM'), { session: 'AN', start: '14:00', end: '17:00' });
  assert.deepEqual(parseTime('AN (1.30 - 4.30)'), { session: 'AN', start: '13:30', end: '16:30' });
  assert.deepEqual(parseTime(''), { session: null, start: null, end: null });
});

test('year and semester', () => {
  assert.equal(parseOrdinal('III', 10), 3);
  assert.equal(parseOrdinal('3rd Year', 10), 3);
  assert.equal(parseOrdinal('Sem V', 12), 5);
  assert.equal(parseOrdinal('II CSE', 10), 2);
  assert.equal(parseOrdinal('13', 12), null);
  assert.equal(parseOrdinal('', 10), null);
});

test('rows: headers mapped, problems listed', () => {
  const headers = ['date', 'session', 'subject_code', 'subject_name', 'dept', 'year', 'hall'];
  assert.ok(isRowPerExam(headers));
  assert.ok(!isRowPerExam(['day', 'cse', 'ece']));
  const e = normaliseEntry(readTimetableRow({ date: '12/11/2026', session: 'FN', subject_code: 'cs 3401', subject_name: 'Algorithms', dept: 'CSE', year: 'II', hall: 'B-201' }, 2));
  assert.deepEqual(e, {
    row_number: 2, exam_date: '2026-11-12', session: 'FN', start_time: null, end_time: null,
    course_code: 'CS3401', course_name: 'Algorithms', department_text: 'CSE', year_of_study: 2, semester: null,
    venue: 'B-201', problems: [],
  });
  const bad = normaliseEntry({ row: 3, date: 'tbd' });
  assert.deepEqual(bad.problems, ['Date "tbd" not understood', 'Course code or name missing']);
});

test('course matching: code, then a unique name', () => {
  const courses: CourseRef[] = [
    { id: 1, code: 'CS3401', name: 'Design and Analysis of Algorithms', department_id: 1, semester: 4 },
    { id: 2, code: 'CS3492', name: 'Database Management Systems', department_id: 1, semester: 4 },
    { id: 3, code: 'IT3492', name: 'Database Management Systems', department_id: 2, semester: 4 },
  ];
  assert.equal(matchCourse({ course_code: 'CS3401', course_name: null }, courses).course?.id, 1);
  assert.equal(matchCourse({ course_code: 'XX999', course_name: 'Design & Analysis of Algorithms' }, courses).how, 'name');
  const amb = matchCourse({ course_code: null, course_name: 'Database Management Systems' }, courses);
  assert.equal(amb.course, null);
  assert.match(amb.problem!, /Several courses/);
  assert.equal(matchCourse({ course_code: 'ME101', course_name: null }, courses).problem, 'No course with code ME101');
});
