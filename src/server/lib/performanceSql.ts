/**
 * SQL for the admin performance views (see routes/performance.ts). $1 is the
 * caller's college in every query.
 */

const FAILING_GRADES = `('RA', 'U', 'F', 'AB', 'W')`;
const WRITTEN = `NOT r.is_absent AND r.percentage IS NOT NULL`;
const PASSED = `CASE WHEN r.grade IS NOT NULL THEN r.grade NOT IN ${FAILING_GRADES} ELSE r.percentage >= 50 END`;
/** Course material: notes uploaded by staff (not students' own notes). */
const STAFF_NOTE = `(n.uploaded_by IS NULL OR EXISTS (SELECT 1 FROM users up WHERE up.id = n.uploaded_by AND up.role <> 'student'))`;

export const COURSES_SQL = `WITH c AS (
             SELECT c.id, c.code, c.name, c.department_id, c.semester, c.instructor_id, u.name AS instructor_name
             FROM courses c LEFT JOIN users u ON u.id = c.instructor_id
             WHERE c.institution_id = $1 AND COALESCE(c.archived, 0) = 0
           ),
           enr AS (SELECT course_id, count(*) AS n FROM enrollments WHERE institution_id = $1 GROUP BY 1),
           mods AS (SELECT course_id, count(*) AS n FROM modules WHERE institution_id = $1 GROUP BY 1),
           nts AS (
             SELECT m.course_id, count(*) AS n FROM notes n JOIN modules m ON m.id = n.module_id
             WHERE n.institution_id = $1 AND ${STAFF_NOTE} GROUP BY 1
           ),
           asg AS (
             SELECT m.course_id,
                    count(DISTINCT a.id) AS n,
                    count(s.id) AS subs,
                    count(s.id) FILTER (WHERE s.grade IS NOT NULL) AS graded,
                    count(s.id) FILTER (WHERE s.grade IS NULL) AS pending,
                    count(s.id) FILTER (WHERE s.grade IS NOT NULL AND s.graded_at >= s.submitted_at) AS timed,
                    COALESCE(sum(extract(epoch FROM s.graded_at - s.submitted_at) / 3600)
                      FILTER (WHERE s.grade IS NOT NULL AND s.graded_at >= s.submitted_at), 0) AS tat
             FROM assignments a JOIN modules m ON m.id = a.module_id
             LEFT JOIN submissions s ON s.assignment_id = a.id
             WHERE a.institution_id = $1 GROUP BY 1
           ),
           ex AS (SELECT course_id, count(*) AS n FROM unit_exams WHERE institution_id = $1 AND published_at IS NOT NULL GROUP BY 1),
           res AS (
             SELECT e.course_id,
                    count(*) FILTER (WHERE ${WRITTEN}) AS written,
                    COALESCE(sum(r.percentage) FILTER (WHERE ${WRITTEN}), 0) AS pct_sum,
                    count(*) FILTER (WHERE ${WRITTEN} AND ${PASSED}) AS passed,
                    count(*) FILTER (WHERE r.is_absent) AS absent
             FROM unit_exam_results r JOIN unit_exams e ON e.id = r.unit_exam_id
             WHERE e.institution_id = $1 AND e.published_at IS NOT NULL GROUP BY 1
           ),
           risk AS (
             SELECT course_id, count(*) AS n FROM (
               SELECT e.course_id, r.student_id, avg(r.percentage) AS a
               FROM unit_exam_results r JOIN unit_exams e ON e.id = r.unit_exam_id
               WHERE e.institution_id = $1 AND e.published_at IS NOT NULL AND ${WRITTEN}
               GROUP BY 1, 2
             ) x WHERE a < 50 GROUP BY 1
           )
           SELECT c.*, enr.n AS enrolled, mods.n AS modules, nts.n AS notes, asg.n AS assignments,
                  asg.subs AS submissions, asg.graded, asg.pending, asg.timed, asg.tat AS turnaround_hours_sum,
                  ex.n AS assessments, res.written, res.pct_sum, res.passed, res.absent, risk.n AS at_risk
           FROM c
           LEFT JOIN enr ON enr.course_id = c.id LEFT JOIN mods ON mods.course_id = c.id
           LEFT JOIN nts ON nts.course_id = c.id LEFT JOIN asg ON asg.course_id = c.id
           LEFT JOIN ex ON ex.course_id = c.id LEFT JOIN res ON res.course_id = c.id
           LEFT JOIN risk ON risk.course_id = c.id
           ORDER BY c.code`;

export const TOPICS_SQL = `SELECT e.course_id, t.key AS topic, round(avg((t.value #>> '{}')::numeric), 1) AS avg_pct, count(*) AS n
           FROM unit_exam_results r JOIN unit_exams e ON e.id = r.unit_exam_id, jsonb_each(r.topic_breakdown) t
           WHERE e.institution_id = $1 AND e.published_at IS NOT NULL AND NOT r.is_absent
             AND jsonb_typeof(r.topic_breakdown) = 'object' AND jsonb_typeof(t.value) = 'number'
           GROUP BY 1, 2`;

export const DEPARTMENTS_SQL = `SELECT d.id, d.code, d.name,
                  count(*) FILTER (WHERE im.role = 'student') AS students,
                  count(*) FILTER (WHERE im.role = 'instructor') AS professors
           FROM departments d
           LEFT JOIN institution_members im ON im.department_id = d.id AND im.institution_id = $1 AND im.status = 'active'
           WHERE d.institution_id = $1 GROUP BY d.id ORDER BY d.code`;

export const PROFESSORS_SQL = `SELECT u.id, u.name, im.department_id
           FROM institution_members im JOIN users u ON u.id = im.user_id
           WHERE im.institution_id = $1 AND im.role = 'instructor' AND im.status = 'active'
           ORDER BY u.name`;

export const DEPT_STUDENTS_SQL = `SELECT im.department_id,
                  count(*) FILTER (WHERE ${WRITTEN}) AS written,
                  round(avg(r.percentage) FILTER (WHERE ${WRITTEN}), 1) AS avg_pct,
                  round(100.0 * count(*) FILTER (WHERE ${WRITTEN} AND ${PASSED}) / NULLIF(count(*) FILTER (WHERE ${WRITTEN}), 0), 1) AS pass_rate
           FROM unit_exam_results r
           JOIN unit_exams e ON e.id = r.unit_exam_id
           JOIN institution_members im ON im.user_id = r.student_id AND im.institution_id = $1
           WHERE e.institution_id = $1 AND e.published_at IS NOT NULL
           GROUP BY 1`;

/** Students page; `order` must come from the route's whitelist. Params: inst, department ('none' | id), year, name pattern, at-risk only, limit, offset. */
export const studentsSql = (order: string) => `WITH s AS (
           SELECT u.id, u.name, im.department_id, im.year_of_study
           FROM institution_members im JOIN users u ON u.id = im.user_id
           WHERE im.institution_id = $1 AND im.role = 'student' AND im.status = 'active'
             AND ($2::text IS NULL OR ($2 = 'none' AND im.department_id IS NULL) OR im.department_id::text = $2)
             AND ($3::int IS NULL OR im.year_of_study = $3)
             AND ($4::text IS NULL OR u.name ILIKE $4)
         ),
         r AS (
           SELECT r.student_id, r.percentage, r.is_absent,
                  row_number() OVER (PARTITION BY r.student_id, (${WRITTEN})
                                     ORDER BY e.exam_date DESC NULLS LAST, e.published_at DESC) AS rn,
                  (${WRITTEN}) AS written
           FROM unit_exam_results r JOIN unit_exams e ON e.id = r.unit_exam_id
           WHERE e.institution_id = $1 AND e.published_at IS NOT NULL AND r.student_id IN (SELECT id FROM s)
         ),
         agg AS (
           SELECT student_id,
                  count(*) FILTER (WHERE written) AS written,
                  round(avg(percentage) FILTER (WHERE written), 1) AS avg_pct,
                  max(percentage) FILTER (WHERE written AND rn = 1) AS latest_pct,
                  max(percentage) FILTER (WHERE written AND rn = 2) AS previous_pct,
                  count(*) FILTER (WHERE is_absent) AS absent
           FROM r GROUP BY 1
         ),
         work AS (
           SELECT en.student_id, count(DISTINCT en.course_id) AS courses, count(a.id) AS assignments, count(sb.id) AS submitted
           FROM enrollments en
           LEFT JOIN modules m ON m.course_id = en.course_id
           LEFT JOIN assignments a ON a.module_id = m.id AND a.status = 'active'
           LEFT JOIN submissions sb ON sb.assignment_id = a.id AND sb.student_id = en.student_id
           WHERE en.institution_id = $1 AND en.student_id IN (SELECT id FROM s)
           GROUP BY 1
         ),
         joined AS (
           SELECT s.id, s.name, s.department_id, d.code AS department_code, s.year_of_study,
                  COALESCE(work.courses, 0) AS courses,
                  COALESCE(agg.written, 0) AS written, agg.avg_pct, agg.latest_pct, agg.previous_pct,
                  COALESCE(agg.absent, 0) AS absent,
                  COALESCE(work.assignments, 0) AS assignments, COALESCE(work.submitted, 0) AS submitted
           FROM s
           LEFT JOIN departments d ON d.id = s.department_id
           LEFT JOIN agg ON agg.student_id = s.id
           LEFT JOIN work ON work.student_id = s.id
         )
         SELECT *, count(*) OVER () AS total FROM joined
         WHERE NOT $5::boolean OR avg_pct < 50 OR absent >= 2
         ORDER BY ${order}
         LIMIT $6 OFFSET $7`;

/** Files this college has stored: course notes and assignment submissions, in bytes. */
export const STORAGE_SQL = `SELECT
  (SELECT COALESCE(sum(n.file_size), 0) FROM notes n WHERE n.institution_id = $1) AS notes_bytes,
  (SELECT count(*) FROM notes n WHERE n.institution_id = $1 AND n.file_size IS NOT NULL) AS notes_files,
  (SELECT COALESCE(sum(f.file_size), 0) FROM submission_files f JOIN submissions s ON s.id = f.submission_id WHERE s.institution_id = $1) AS submission_bytes,
  (SELECT count(*) FROM submission_files f JOIN submissions s ON s.id = f.submission_id WHERE s.institution_id = $1) AS submission_files`;
