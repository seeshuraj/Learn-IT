/**
 * analyticsSnapshot.ts — P3-2
 *
 * Two exported functions:
 *   snapshotAdminStats(pool)     — writes one row per institution to admin_stats_snapshots
 *   snapshotCourseAnalytics(pool) — writes one row per active course to
 *                                    course_analytics_snapshots
 *
 * Both are idempotent (INSERT-only) and safe to call concurrently.
 * Errors are caught and logged — a snapshot failure never crashes the process.
 */

import pkg from 'pg';
import { log, errorFields } from '../lib/log.js';
const { Pool } = pkg;

type PgPool = InstanceType<typeof Pool>;

// ── Admin stats, one row per active institution ──────────────────────────────

export async function snapshotAdminStats(pool: PgPool): Promise<void> {
  try {
    // One set-based statement per run: compute every institution's counts and
    // insert them together, so institutions never see a partial cycle.
    const { rowCount } = await pool.query(`
      INSERT INTO admin_stats_snapshots
        (institution_id, active_users, total_courses, average_grade, total_notes, total_submissions)
      SELECT
        i.id,
        (SELECT COUNT(*) FROM institution_members im JOIN users u ON u.id = im.user_id
          WHERE im.institution_id = i.id AND im.status = 'active' AND u.active = 1),
        (SELECT COUNT(*) FROM courses c WHERE c.institution_id = i.id AND c.archived = 0),
        ROUND(COALESCE((SELECT AVG(s.grade) FROM submissions s
                         WHERE s.institution_id = i.id AND s.grade IS NOT NULL), 0)),
        (SELECT COUNT(*) FROM notes n       WHERE n.institution_id = i.id),
        (SELECT COUNT(*) FROM submissions s WHERE s.institution_id = i.id)
      FROM institutions i
      WHERE i.status = 'active'
    `);

    // Prune: keep the last 48 rows per institution (24 h at 30-min cadence)
    await pool.query(`
      DELETE FROM admin_stats_snapshots a
      USING (
        SELECT id, row_number() OVER (PARTITION BY institution_id ORDER BY snapshotted_at DESC) AS rn
        FROM admin_stats_snapshots
      ) ranked
      WHERE a.id = ranked.id AND ranked.rn > 48
    `);

    log.info('snapshot written', { table: 'admin_stats_snapshots', institutions: rowCount ?? 0 });
  } catch (err: any) {
    log.error('snapshotAdminStats failed (non-fatal)', errorFields(err));
  }
}

// ── Per-course instructor analytics ──────────────────────────────────────────

export async function snapshotCourseAnalytics(pool: PgPool): Promise<void> {
  try {
    const { rows: courses } = await pool.query(
      `SELECT id FROM courses WHERE archived = 0`
    );

    for (const course of courses) {
      const courseId = course.id;
      try {
        const [enrollRow, avgRow] = await Promise.all([
          pool.query(
            `SELECT COUNT(*) AS count FROM enrollments WHERE course_id = $1`,
            [courseId]
          ),
          pool.query(
            `SELECT AVG(s.grade) AS avg
             FROM submissions s
             JOIN assignments a ON s.assignment_id = a.id
             JOIN modules m     ON a.module_id = m.id
             WHERE m.course_id = $1 AND s.grade IS NOT NULL`,
            [courseId]
          ),
        ]);

        const { rows: studentRows } = await pool.query(
          `SELECT
             u.id                                        AS student_id,
             u.name,
             ROUND(AVG(s.grade)::numeric, 1)             AS avg_grade,
             COUNT(s.id)                                 AS submission_count,
             COUNT(CASE
               WHEN a.due_date IS NOT NULL
                AND s.submitted_at::date > a.due_date::date
               THEN 1 END)                               AS late,
             (
               SELECT COUNT(*)
               FROM assignments a2
               JOIN modules m2 ON a2.module_id = m2.id
               WHERE m2.course_id = $1
                 AND a2.status = 'active'
                 AND NOT EXISTS (
                   SELECT 1 FROM submissions s2
                   WHERE s2.assignment_id = a2.id AND s2.student_id = u.id
                 )
             )                                           AS missed
           FROM enrollments e
           JOIN users u ON e.student_id = u.id
           LEFT JOIN submissions s ON s.student_id = u.id
             AND EXISTS (
               SELECT 1 FROM assignments a
               JOIN modules m ON a.module_id = m.id
               WHERE a.id = s.assignment_id AND m.course_id = $1
             )
           LEFT JOIN assignments a ON a.id = s.assignment_id
           WHERE e.course_id = $1
           GROUP BY u.id, u.name
           ORDER BY u.name`,
          [courseId]
        );

        const students = studentRows.map((r: any) => ({
          student_id:       r.student_id,
          name:             r.name,
          avg_grade:        r.avg_grade != null ? parseFloat(r.avg_grade) : 0,
          submission_count: parseInt(r.submission_count) || 0,
          late:             parseInt(r.late)             || 0,
          missed:           parseInt(r.missed)           || 0,
        }));

        await pool.query(
          `INSERT INTO course_analytics_snapshots
             (course_id, enrollment_count, average_grade, students)
           VALUES ($1, $2, $3, $4)`,
          [
            courseId,
            parseInt(enrollRow.rows[0].count) || 0,
            Math.round(parseFloat(avgRow.rows[0].avg) || 0),
            JSON.stringify(students),
          ]
        );

        // Prune: keep last 48 snapshots per course
        await pool.query(
          `DELETE FROM course_analytics_snapshots
           WHERE course_id = $1
             AND id NOT IN (
               SELECT id FROM course_analytics_snapshots
               WHERE course_id = $1
               ORDER BY snapshotted_at DESC
               LIMIT 48
             )`,
          [courseId]
        );
      } catch (courseErr: any) {
        log.error('course snapshot failed (non-fatal)', { courseId, ...errorFields(courseErr) });
      }
    }

    log.info('snapshot written', { table: 'course_analytics_snapshots', courses: courses.length });
  } catch (err: any) {
    log.error('snapshotCourseAnalytics failed (non-fatal)', errorFields(err));
  }
}
