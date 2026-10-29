/**
 * Authorization rules in lib/access.ts, exercised against an in-memory model
 * of the demo dataset (instructor 4 owns courses 1–3; student 2 is enrolled
 * in 1–3, student 3 only in 1; note 18 is course material with a legacy NULL
 * uploader, note 14 is student 2's personal note in course 1). Everything is
 * in institution A except course 50 (institution B, instructor 6), and
 * student 7, who moved to B but still has an old enrollment in course 1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  managesCourse, canAccessCourse, loadNoteForCaller, loadSubmissionForCaller,
  assertManagesCourse, assertCanAccessCourse, AccessDenied, Caller,
} from '../access.js';

const users: Record<number, { role: string }> = {
  1: { role: 'admin' }, 2: { role: 'student' }, 3: { role: 'student' },
  4: { role: 'instructor' }, 5: { role: 'instructor' },
};
const A = 'inst-a', B = 'inst-b';
const courses: Record<number, { instructor_id: number; inst: string }> = {
  1: { instructor_id: 4, inst: A }, 2: { instructor_id: 4, inst: A },
  9: { instructor_id: 5, inst: A }, 50: { instructor_id: 6, inst: B },
};
const enrollments: [number, number, string][] = [[1, 2, A], [2, 2, A], [1, 3, A], [1, 7, A]]; // [course, student, tenant]
const modules: Record<number, number> = { 1: 1, 3: 2, 90: 9 };   // module → course
const notes: Record<number, { module_id: number; uploaded_by: number | null; storage_path: string }> = {
  18: { module_id: 1, uploaded_by: null, storage_path: 'a' },
  14: { module_id: 1, uploaded_by: 2, storage_path: 'b' },
  30: { module_id: 3, uploaded_by: 4, storage_path: 'c' },
};
const assignments: Record<number, number> = { 2: 3, 7: 1 };      // assignment → module
const submissions: Record<number, { assignment_id: number; student_id: number }> = {
  1: { assignment_id: 2, student_id: 2 },
  5: { assignment_id: 7, student_id: 3 },
};

// Minimal pool: answers exactly the queries access.ts issues.
const pool = {
  async query(sql: string, p: any[]) {
    const s = sql.replace(/\s+/g, ' ');
    const rows = (() => {
      if (s.startsWith('SELECT course_id FROM modules')) return modules[p[0]] ? [{ course_id: modules[p[0]] }] : [];
      if (s.startsWith('SELECT m.course_id FROM assignments')) {
        const m = assignments[p[0]]; return m ? [{ course_id: modules[m] }] : [];
      }
      if (s.startsWith('SELECT 1 FROM courses WHERE id = $1 AND institution_id = $2 AND')) {
        const c = courses[p[0]];
        return c && c.inst === p[1] && (p[2] === 'admin' || c.instructor_id === p[3]) ? [{}] : [];
      }
      if (s.startsWith('SELECT 1 FROM courses WHERE id = $1 AND institution_id = $2')) return courses[p[0]]?.inst === p[1] ? [{}] : [];
      if (s.startsWith('SELECT 1 FROM enrollments')) {
        return enrollments.some(([c, st, t]) => c === p[0] && st === p[1] && t === p[2]) ? [{}] : [];
      }
      if (s.includes('FROM notes n')) {
        const n = notes[p[0]]; if (!n) return [];
        return [{ id: p[0], ...n, institution_id: A, course_id: modules[n.module_id], uploader_role: n.uploaded_by ? users[n.uploaded_by].role : null }];
      }
      if (s.includes('FROM submissions s')) {
        const sub = submissions[p[0]]; if (!sub) return [];
        return [{ id: p[0], ...sub, institution_id: A, max_points: 100, course_id: modules[assignments[sub.assignment_id]] }];
      }
      throw new Error(`unexpected query: ${s}`);
    })();
    return { rows };
  },
} as any;

const admin: Caller = { legacyUserId: 1, role: 'admin', institutionId: A };
const owner: Caller = { legacyUserId: 4, role: 'instructor', institutionId: A };
const otherInstructor: Caller = { legacyUserId: 5, role: 'instructor', institutionId: A };
const s2: Caller = { legacyUserId: 2, role: 'student', institutionId: A };
const s3: Caller = { legacyUserId: 3, role: 'student', institutionId: A };
const adminB: Caller = { legacyUserId: 8, role: 'admin', institutionId: B };
const instructorB: Caller = { legacyUserId: 6, role: 'instructor', institutionId: B };
const movedStudent: Caller = { legacyUserId: 7, role: 'student', institutionId: B };

const denied = (status: number) => (err: unknown) =>
  err instanceof AccessDenied && err.status === status;

test('only the owning instructor or an admin manages a course', async () => {
  assert.equal(await managesCourse(pool, admin, 1), true);
  assert.equal(await managesCourse(pool, owner, 1), true);
  assert.equal(await managesCourse(pool, otherInstructor, 1), false);
  assert.equal(await managesCourse(pool, s2, 1), false);
  await assert.rejects(assertManagesCourse(pool, otherInstructor, 1), denied(403));
  await assert.rejects(assertManagesCourse(pool, owner, null), denied(404));
});

test('students access only courses they are enrolled in', async () => {
  assert.equal(await canAccessCourse(pool, s3, 1), true);
  assert.equal(await canAccessCourse(pool, s3, 2), false);
  assert.equal(await canAccessCourse(pool, s2, 9), false);
  assert.equal(await canAccessCourse(pool, otherInstructor, 1), false);
});

test('students read course material and their own notes, not other students\' notes', async () => {
  assert.equal((await loadNoteForCaller(pool, s3, 18, 'read')).id, 18);      // course material
  await assert.rejects(loadNoteForCaller(pool, s3, 14, 'read'), denied(403)); // student 2's note
  assert.equal((await loadNoteForCaller(pool, s2, 14, 'read')).id, 14);      // own note
  await assert.rejects(loadNoteForCaller(pool, s3, 30, 'read'), denied(403)); // not enrolled
  await assert.rejects(loadNoteForCaller(pool, s2, 999, 'read'), denied(404));
});

test('students delete only their own notes; staff manage any note in their course', async () => {
  await assert.rejects(loadNoteForCaller(pool, s2, 18, 'delete'), denied(403));
  assert.equal((await loadNoteForCaller(pool, s2, 14, 'delete')).id, 14);
  assert.equal((await loadNoteForCaller(pool, owner, 14, 'delete')).id, 14);
  await assert.rejects(loadNoteForCaller(pool, otherInstructor, 14, 'read'), denied(403));
});

test('submissions: the student reads their own; only course staff grade', async () => {
  assert.equal((await loadSubmissionForCaller(pool, s2, 1, 'read')).id, 1);
  await assert.rejects(loadSubmissionForCaller(pool, s2, 1, 'grade'), denied(403));
  await assert.rejects(loadSubmissionForCaller(pool, s3, 1, 'read'), denied(403));
  assert.equal((await loadSubmissionForCaller(pool, owner, 1, 'grade')).course_id, 2);
  await assert.rejects(loadSubmissionForCaller(pool, otherInstructor, 5, 'grade'), denied(403));
  assert.equal((await loadSubmissionForCaller(pool, admin, 5, 'grade')).id, 5);
  await assert.rejects(loadSubmissionForCaller(pool, owner, 404, 'read'), denied(404));
});

test('admins and instructors are confined to their institution; other tenants see 404', async () => {
  assert.equal(await managesCourse(pool, adminB, 1), false);
  assert.equal(await managesCourse(pool, adminB, 50), true);
  assert.equal(await managesCourse(pool, admin, 50), false);
  assert.equal(await managesCourse(pool, instructorB, 50), true);
  await assert.rejects(assertManagesCourse(pool, adminB, 1), denied(404));
  await assert.rejects(assertCanAccessCourse(pool, instructorB, 2), denied(404));
  await assert.rejects(loadSubmissionForCaller(pool, adminB, 5, 'grade'), denied(404));
  await assert.rejects(loadNoteForCaller(pool, adminB, 18, 'read'), denied(404));
});

test('a student who moved institutions loses access to old enrollments and records', async () => {
  assert.equal(await canAccessCourse(pool, movedStudent, 1), false);
  await assert.rejects(assertCanAccessCourse(pool, movedStudent, 1), denied(404));
  await assert.rejects(loadNoteForCaller(pool, movedStudent, 18, 'read'), denied(404));
});
