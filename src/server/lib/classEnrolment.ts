/**
 * Class enrolment: every active student gets the courses of their own
 * department for the semester their year of study is in now.
 *
 *   department + year of study + current term  →  semester  →  courses
 *
 * A student who joins in the middle (e.g. lateral entry into 2nd year) gets
 * that class's courses as soon as an admin adds them. Professors are not
 * involved: a course belongs to one department and one professor, and a
 * professor can teach any number of courses in any department.
 *
 * Enrolments made here are marked source = 'auto'. They are withdrawn when the
 * student or course no longer matches (moved department, next year, course
 * re-placed, student suspended). Enrolments an admin made by hand ('manual')
 * are never touched.
 */

import type pkg from 'pg';

export type TermParity = 'odd' | 'even';
export type TermSetting = TermParity | 'auto';

/** Settings key an admin can set to 'odd' or 'even' to override the calendar. */
export const TERM_SETTING_KEY = 'current_term';

export function readTermSetting(v: unknown): TermSetting {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'odd' || s === 'even' ? s : 'auto';
}

/**
 * Odd semesters run July–December and even ones January–June (Anna
 * University and most Indian universities), read in IST.
 */
export function termParity(setting: TermSetting, now = Date.now()): TermParity {
  if (setting !== 'auto') return setting;
  const month = new Date(now + 330 * 60_000).getUTCMonth() + 1;
  return month >= 7 ? 'odd' : 'even';
}

export function semesterOf(yearOfStudy: number | null | undefined, parity: TermParity): number | null {
  if (!yearOfStudy || yearOfStudy < 1) return null;
  return parity === 'odd' ? yearOfStudy * 2 - 1 : yearOfStudy * 2;
}

type Db = Pick<pkg.Pool, 'query'> | Pick<pkg.PoolClient, 'query'>;

export async function currentParity(db: Db, institutionId: string, now = Date.now()): Promise<TermParity> {
  const { rows } = await db.query('SELECT value FROM settings WHERE institution_id = $1 AND key = $2', [institutionId, TERM_SETTING_KEY]);
  return termParity(readTermSetting(rows[0]?.value), now);
}

export interface SyncScope {
  /** Only these students (e.g. the one just added or edited). */
  studentIds?: number[];
  /** Only these courses (e.g. the one just placed). */
  courseIds?: number[];
}

/**
 * Bring automatic enrolments in line with departments and years, for the
 * whole college or a subset. Idempotent: safe to run any number of times.
 * Newly enrolled students get a notification.
 */
export async function syncClassEnrolments(db: Db, institutionId: string, scope: SyncScope = {}, now = Date.now()):
    Promise<{ added: number; removed: number; parity: TermParity }> {
  const parity = await currentParity(db, institutionId, now);
  const students = scope.studentIds?.length ? scope.studentIds : null;
  const courses = scope.courseIds?.length ? scope.courseIds : null;
  const { rows: [r] } = await db.query(
    `WITH target AS (
       SELECT c.id AS course_id, im.user_id AS student_id
       FROM institution_members im
       JOIN courses c ON c.institution_id = im.institution_id
        AND c.department_id = im.department_id
        AND c.semester = CASE WHEN $2 = 'odd' THEN im.year_of_study * 2 - 1 ELSE im.year_of_study * 2 END
       WHERE im.institution_id = $1 AND im.role = 'student' AND im.status = 'active'
         AND im.year_of_study IS NOT NULL
         AND ($3::int[] IS NULL OR im.user_id = ANY($3::int[]))
         AND ($4::int[] IS NULL OR c.id = ANY($4::int[]))
     ), added AS (
       INSERT INTO enrollments (course_id, student_id, institution_id, source)
       SELECT course_id, student_id, $1, 'auto' FROM target
       ON CONFLICT (course_id, student_id) DO NOTHING
       RETURNING course_id, student_id
     ), removed AS (
       DELETE FROM enrollments e
       WHERE e.institution_id = $1 AND e.source = 'auto'
         AND ($3::int[] IS NULL OR e.student_id = ANY($3::int[]))
         AND ($4::int[] IS NULL OR e.course_id = ANY($4::int[]))
         AND NOT EXISTS (SELECT 1 FROM target t WHERE t.course_id = e.course_id AND t.student_id = e.student_id)
       RETURNING e.id
     ), notified AS (
       INSERT INTO notifications (user_id, type, message, metadata)
       SELECT a.student_id, 'enrollment_confirmed',
              'You now have ' || coalesce(c.code || ': ', '') || c.name || ' with your class.',
              jsonb_build_object('course_id', c.id)
       FROM added a JOIN courses c ON c.id = a.course_id
       RETURNING 1
     )
     SELECT (SELECT count(*) FROM added)::int AS added,
            (SELECT count(*) FROM removed)::int AS removed,
            (SELECT count(*) FROM notified)::int AS notified`,
    [institutionId, parity, students, courses]
  );
  return { added: r.added, removed: r.removed, parity };
}
