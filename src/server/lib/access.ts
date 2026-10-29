/**
 * access.ts — resource-level authorization for the API.
 *
 * Role checks (requireRole) say what kind of user someone is; these helpers
 * say whether they may touch a specific course, module, note, assignment or
 * submission. Every route that takes a resource id must call one of them
 * before reading or writing that resource.
 *
 * Every rule is confined to the caller's institution (req.auth.institutionId,
 * resolved from their active institution_members row). A row in another
 * institution is reported as 404, never 403, so ids cannot be probed.
 *
 *   admin       — everything in their institution
 *   instructor  — courses in their institution where courses.instructor_id = them
 *   student     — courses they are enrolled in; their own submissions;
 *                 course material (notes uploaded by staff) plus their own notes
 */

import type pkg from 'pg';

type Pool = InstanceType<typeof pkg.Pool>;
export type Role = 'student' | 'instructor' | 'admin';
export interface Caller { legacyUserId: number; role: Role; institutionId: string }

export class AccessDenied extends Error {
  constructor(public status: 403 | 404 = 403, message = 'Access denied') {
    super(message);
    this.name = 'AccessDenied';
  }
}

async function one<T = any>(pool: Pool, sql: string, params: unknown[]): Promise<T | null> {
  const { rows } = await pool.query(sql, params);
  return (rows[0] as T) ?? null;
}

// ── id → course resolution ────────────────────────────────────────────────────
export const courseOfModule = async (pool: Pool, moduleId: number) =>
  (await one<{ course_id: number }>(pool, 'SELECT course_id FROM modules WHERE id = $1', [moduleId]))?.course_id ?? null;

export const courseOfAssignment = async (pool: Pool, assignmentId: number) =>
  (await one<{ course_id: number }>(pool,
    `SELECT m.course_id FROM assignments a JOIN modules m ON m.id = a.module_id WHERE a.id = $1`,
    [assignmentId]))?.course_id ?? null;

// ── predicates ────────────────────────────────────────────────────────────────
export async function managesCourse(pool: Pool, caller: Caller, courseId: number | null): Promise<boolean> {
  if (courseId == null) return false;
  if (caller.role !== 'admin' && caller.role !== 'instructor') return false;
  return !!(await one(pool,
    `SELECT 1 FROM courses
     WHERE id = $1 AND institution_id = $2 AND ($3::text = 'admin' OR instructor_id = $4)`,
    [courseId, caller.institutionId, caller.role, caller.legacyUserId]));
}

export async function isEnrolled(pool: Pool, caller: Caller, courseId: number | null): Promise<boolean> {
  if (courseId == null) return false;
  return !!(await one(pool,
    'SELECT 1 FROM enrollments WHERE course_id = $1 AND student_id = $2 AND institution_id = $3',
    [courseId, caller.legacyUserId, caller.institutionId]));
}

/** True when the course exists in the caller's institution. */
export async function courseInInstitution(pool: Pool, caller: Caller, courseId: number | null): Promise<boolean> {
  if (courseId == null) return false;
  return !!(await one(pool, 'SELECT 1 FROM courses WHERE id = $1 AND institution_id = $2', [courseId, caller.institutionId]));
}

/** True when userId has a non-removed membership in the caller's institution (optionally with a role). */
export async function isMemberOfInstitution(pool: Pool, caller: Caller, userId: number, role?: string): Promise<boolean> {
  return !!(await one(pool,
    `SELECT 1 FROM institution_members
     WHERE user_id = $1 AND institution_id = $2 AND status <> 'removed'
       AND ($3::text IS NULL OR role = $3)`,
    [userId, caller.institutionId, role ?? null]));
}

export async function canAccessCourse(pool: Pool, caller: Caller, courseId: number | null): Promise<boolean> {
  if (courseId == null) return false;
  if (await managesCourse(pool, caller, courseId)) return true;
  return caller.role === 'student' && isEnrolled(pool, caller, courseId);
}

// ── assertions (throw AccessDenied; 404 when the resource does not exist) ────
export async function assertManagesCourse(pool: Pool, caller: Caller, courseId: number | null) {
  if (!(await courseInInstitution(pool, caller, courseId))) throw new AccessDenied(404, 'Not found');
  if (!(await managesCourse(pool, caller, courseId))) throw new AccessDenied();
}

export async function assertCanAccessCourse(pool: Pool, caller: Caller, courseId: number | null) {
  if (!(await courseInInstitution(pool, caller, courseId))) throw new AccessDenied(404, 'Not found');
  if (!(await canAccessCourse(pool, caller, courseId))) throw new AccessDenied();
}

/**
 * A note is course material when its uploader is staff (or unknown, for
 * legacy rows); otherwise it is a student's personal note.
 */
export async function loadNoteForCaller(pool: Pool, caller: Caller, noteId: number, mode: 'read' | 'delete') {
  const note = await one<any>(pool,
    `SELECT n.*, m.course_id, u.role AS uploader_role
     FROM notes n
     JOIN modules m ON m.id = n.module_id
     LEFT JOIN users u ON u.id = n.uploaded_by
     WHERE n.id = $1`, [noteId]);
  if (!note || note.institution_id !== caller.institutionId) throw new AccessDenied(404, 'Note not found');
  if (await managesCourse(pool, caller, note.course_id)) return note;
  if (caller.role !== 'student' || !(await isEnrolled(pool, caller, note.course_id))) {
    throw new AccessDenied();
  }
  const own = note.uploaded_by === caller.legacyUserId;
  const courseMaterial = note.uploaded_by == null || note.uploader_role !== 'student';
  if (own || (mode === 'read' && courseMaterial)) return note;
  throw new AccessDenied();
}

/** Submission plus its course, readable by its student or the course's staff. */
export async function loadSubmissionForCaller(pool: Pool, caller: Caller, submissionId: number, mode: 'read' | 'grade') {
  const sub = await one<any>(pool,
    `SELECT s.*, a.max_points, m.course_id
     FROM submissions s
     JOIN assignments a ON a.id = s.assignment_id
     JOIN modules m     ON m.id = a.module_id
     WHERE s.id = $1`, [submissionId]);
  if (!sub || sub.institution_id !== caller.institutionId) throw new AccessDenied(404, 'Submission not found');
  if (await managesCourse(pool, caller, sub.course_id)) return sub;
  if (mode === 'read' && caller.role === 'student' && sub.student_id === caller.legacyUserId) return sub;
  throw new AccessDenied();
}

/**
 * SQL predicate over alias `n` (notes): rows a student may read — course
 * material (staff or legacy uploader) plus their own notes. `param` is the
 * placeholder holding the student's id, e.g. "$2".
 */
export const studentVisibleNotes = (param: string) =>
  `(n.uploaded_by IS NULL OR n.uploaded_by = ${param}
    OR EXISTS (SELECT 1 FROM users up WHERE up.id = n.uploaded_by AND up.role <> 'student'))`;
