/**
 * College data exports: what each CSV contains. Every query is scoped to one
 * college ($1) and keyset-paged ($2 = last key, $3 = batch size).
 */

export const EXPORT_BATCH = 2_000;

export interface Dataset {
  header: string[];
  /** $1 = institution id, $2 = last key seen, $3 = batch size. Must select `k` (the keyset column). */
  sql: string;
  row: (r: any) => unknown[];
}

export const DATASETS: Record<string, Dataset> = {
  users: {
    header: ['User ID', 'Name', 'Email', 'Role', 'Status', 'Year', 'Major', 'Joined'],
    sql: `SELECT u.id AS k, u.name, u.email,
                 CASE WHEN im.role IN ('institution_admin','institution_owner') THEN 'admin' ELSE im.role END AS role,
                 im.status, u.year, u.major, im.created_at
          FROM institution_members im JOIN users u ON u.id = im.user_id
          WHERE im.institution_id = $1 AND im.status <> 'removed' AND u.id > $2
          ORDER BY u.id LIMIT $3`,
    row: r => [r.k, r.name, r.email, r.role, r.status, r.year, r.major, r.created_at],
  },
  enrollments: {
    header: ['Course code', 'Course', 'Student ID', 'Student', 'Email', 'Enrolled at'],
    sql: `SELECT e.id AS k, c.code, c.name AS course, u.id AS student_id, u.name, u.email, e.enrolled_at
          FROM enrollments e
          JOIN courses c ON c.id = e.course_id
          JOIN users u   ON u.id = e.student_id
          WHERE e.institution_id = $1 AND e.id > $2
          ORDER BY e.id LIMIT $3`,
    row: r => [r.code, r.course, r.student_id, r.name, r.email, r.enrolled_at],
  },
  grades: {
    header: ['Submission ID', 'Course code', 'Course', 'Assignment', 'Student ID', 'Student', 'Email',
             'Submitted at', 'Graded at', 'Grade', 'Out of', 'Percent', 'Feedback'],
    sql: `SELECT s.id AS k, c.code, c.name AS course, a.title, u.id AS student_id, u.name, u.email,
                 s.submitted_at, s.graded_at, s.grade, a.max_points,
                 CASE WHEN s.grade IS NOT NULL AND a.max_points > 0
                      THEN round(s.grade * 100.0 / a.max_points, 1) END AS pct,
                 s.feedback
          FROM submissions s
          JOIN assignments a ON a.id = s.assignment_id
          JOIN modules m     ON m.id = a.module_id
          JOIN courses c     ON c.id = m.course_id
          JOIN users u       ON u.id = s.student_id
          WHERE s.institution_id = $1 AND s.id > $2
          ORDER BY s.id LIMIT $3`,
    row: r => [r.k, r.code, r.course, r.title, r.student_id, r.name, r.email,
               r.submitted_at, r.graded_at, r.grade, r.max_points, r.pct, r.feedback],
  },
  'exam-results': {
    header: ['Course code', 'Exam', 'Exam date', 'Student ID', 'Student', 'Email', 'Marks', 'Out of', 'Percent', 'Band'],
    sql: `SELECT r.id AS k, c.code, x.title, x.exam_date, u.id AS student_id, u.name, u.email,
                 r.marks_obtained, x.max_marks, r.percentage, r.performance_band
          FROM unit_exam_results r
          JOIN unit_exams x ON x.id = r.unit_exam_id
          JOIN courses c    ON c.id = x.course_id
          JOIN users u      ON u.id = r.student_id
          WHERE r.institution_id = $1 AND r.id > $2
          ORDER BY r.id LIMIT $3`,
    row: r => [r.code, r.title, r.exam_date, r.student_id, r.name, r.email,
               r.marks_obtained, r.max_marks, r.percentage, r.performance_band],
  },
};
