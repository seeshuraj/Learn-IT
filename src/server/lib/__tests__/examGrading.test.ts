import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeResult, readSheetRow, gradeFor, allowedGrades, gpaSummary, type ExamConfig, type ResultRow,
} from '../examGrading.js';

const unitTest: ExamConfig = { assessment_type: 'unit_test', max_marks: 50, grading_schema: { strong: 75, moderate: 50 } };
const endSem: ExamConfig = { assessment_type: 'end_semester', max_marks: 100, internal_max: 40, external_max: 60 };

function row(exam: ExamConfig, input: Parameters<typeof computeResult>[1]): ResultRow {
  const out = computeResult(exam, input);
  assert.equal(out.kind, 'row', JSON.stringify(out));
  return (out as { row: ResultRow }).row;
}

test('unit test: percentage, band, no grade', () => {
  const r = row(unitTest, { student_id: 1, marks: '38.5' });
  assert.equal(r.marks_obtained, 38.5);
  assert.equal(r.percentage, 77);
  assert.equal(r.performance_band, 'strong');
  assert.equal(r.grade, null);
  assert.equal(row(unitTest, { student_id: 1, marks: 20 }).performance_band, 'weak');
});

test('rejects out-of-range, non-numeric and over-precise marks', () => {
  for (const marks of [51, -1, 'abc', 12.345]) {
    const out = computeResult(unitTest, { student_id: 7, marks });
    assert.equal(out.kind, 'error', String(marks));
  }
});

test('blank row clears; absent stores no marks', () => {
  assert.deepEqual(computeResult(unitTest, { student_id: 3, marks: '' }), { kind: 'clear', student_id: 3 });
  const r = row(unitTest, { student_id: 3, absent: true, marks: 40 });
  assert.equal(r.is_absent, true);
  assert.equal(r.marks_obtained, null);
  assert.equal(r.percentage, null);
});

test('end-semester: internal + external, grade boundaries', () => {
  const r = row(endSem, { student_id: 1, internal: 36, external: 56 });
  assert.equal(r.marks_obtained, 92);
  assert.equal(r.grade, 'O');
  assert.equal(r.grade_point, 10);
  assert.equal(row(endSem, { student_id: 1, internal: 30, external: 51 }).grade, 'A+');
  assert.equal(row(endSem, { student_id: 1, internal: 20, external: 30 }).grade, 'C');
  assert.equal(row(endSem, { student_id: 1, internal: 20, external: 29 }).grade, 'RA');
});

test('end-semester: external below 45% fails even with a passing total', () => {
  // 40 + 26 = 66% total, but 26/60 = 43% external.
  const r = row(endSem, { student_id: 1, internal: 40, external: 26 });
  assert.equal(r.grade, 'RA');
  assert.equal(r.grade_point, 0);
  assert.equal(row(endSem, { student_id: 1, internal: 40, external: 27 }).grade, 'B+');
});

test('end-semester: both parts required, absent gets AB, override validated', () => {
  assert.equal(computeResult(endSem, { student_id: 1, internal: 30 }).kind, 'error');
  assert.equal(computeResult(endSem, { student_id: 1, internal: 41, external: 10 }).kind, 'error');
  const ab = row(endSem, { student_id: 1, absent: true });
  assert.equal(ab.grade, 'AB');
  assert.equal(ab.grade_point, 0);
  const moderated = row(endSem, { student_id: 1, internal: 20, external: 29, grade: 'c' });
  assert.equal(moderated.grade, 'C');
  assert.equal(moderated.grade_point, 5);
  assert.equal(computeResult(endSem, { student_id: 1, internal: 20, external: 29, grade: 'Z' }).kind, 'error');
  assert.equal(computeResult(unitTest, { student_id: 1, marks: 20, grade: 'A' }).kind, 'error');
});

test('custom grade scale', () => {
  const exam: ExamConfig = {
    assessment_type: 'end_semester', max_marks: 100,
    grade_scale: { bands: [{ grade: 'S', min: 90, point: 10 }, { grade: 'D', min: 40, point: 4 }], fail: { grade: 'U', point: 0 } },
  };
  assert.deepEqual(gradeFor(exam, 95, null), { grade: 'S', point: 10 });
  assert.deepEqual(gradeFor(exam, 39, null), { grade: 'U', point: 0 });
  assert.ok(allowedGrades(exam).includes('U'));
});

test('sheet rows: common headers, AB as absent, grade A kept', () => {
  const a = readSheetRow({ email: ' Priya@College.edu ', marks: 'AB' });
  assert.equal(a.email, 'priya@college.edu');
  assert.equal(a.input.absent, true);
  assert.equal(a.input.marks, null);

  const b = readSheetRow({ student_id: '12', cia: '35', ese: '50', grade: 'A' });
  assert.equal(b.studentId, 12);
  assert.equal(b.input.internal, '35');
  assert.equal(b.input.external, '50');
  assert.equal(b.input.grade, 'A');
  assert.equal(b.input.absent, false);

  assert.equal(readSheetRow({ email: 'x@y.in', absent: 'Yes', marks: '' }).input.absent, true);
  assert.equal(readSheetRow({ email: 'x@y.in', grade: 'AB' }).input.absent, true);
  assert.equal(readSheetRow({ id: 'abc' }).studentId, null);
});

test('SGPA and CGPA: credit-weighted, RA/AB excluded, unplaceable rows skipped', () => {
  const out = gpaSummary([
    { semester: 3, credits: 4, grade: 'O', grade_point: 10 },
    { semester: 3, credits: 3, grade: 'B', grade_point: 6 },
    { semester: 3, credits: 3, grade: 'RA', grade_point: 0 },
    { semester: 4, credits: '4', grade: 'A', grade_point: '8' },
    { semester: 4, credits: null, grade: 'O', grade_point: 10 },
    { semester: null, credits: 3, grade: 'O', grade_point: 10 },
  ]);
  assert.deepEqual(out.semesters, [
    { semester: 3, sgpa: 8.29, credits: 7, courses: 3 },
    { semester: 4, sgpa: 8, credits: 4, courses: 1 },
  ]);
  assert.equal(out.cgpa, 8.18);
  assert.deepEqual(gpaSummary([{ semester: 1, credits: 3, grade: 'RA', grade_point: 0 }]), {
    semesters: [{ semester: 1, sgpa: null, credits: 0, courses: 1 }], cgpa: null,
  });
});
