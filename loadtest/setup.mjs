// Creates an isolated test college ("LearnIT Load Test <run>") with synthetic
// data, creates logins for the accounts the load test signs in as, signs them
// in, and writes their access tokens to $OUT/tokens.json (mode 600).
//
// Passwords are random, held in memory only, and never printed or saved.
// Nothing outside the new college is touched. teardown.mjs removes it all.
import { randomBytes } from 'node:crypto';
import { writeFileSync, chmodSync } from 'node:fs';
import { pool, admin, anon, env, sleep, mapLimit, SLUG_PREFIX, EMAIL_DOMAIN } from './lib.mjs';

const OUT = env('OUT');
const STUDENTS = Number(process.env.STUDENTS ?? 300);
const PROFESSORS = Number(process.env.PROFESSORS ?? 5);
const COURSES_PER_PROF = 2;
const LOGIN_STUDENTS = Number(process.env.LOGIN_STUDENTS ?? 30);

const run = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const slug = `${SLUG_PREFIX}${run}`;
const db = pool();
const state = { slug, run, institutionId: null, authUserIds: [], userIds: [] };
const saveState = () => writeFileSync(`${OUT}/state.json`, JSON.stringify(state));

async function q(sql, params) { return (await db.query(sql, params)).rows; }

try {
  // ── College, department, settings ────────────────────────────────────────
  const [inst] = await q(`INSERT INTO institutions (name, slug) VALUES ($1, $2) RETURNING id`, [`LearnIT Load Test ${run}`, slug]);
  state.institutionId = inst.id; saveState();
  const I = inst.id;
  const [dept] = await q(`INSERT INTO departments (institution_id, code, name) VALUES ($1, 'LTCSE', 'Load Test CSE') RETURNING id`, [I]);
  await q(`INSERT INTO settings (institution_id, key, value) VALUES ($1, 'current_term', 'odd')`, [I]);

  // ── People (LearnIT rows) ────────────────────────────────────────────────
  const mk = async (role, memberRole, n, prefix, year) => q(
    `WITH u AS (
       INSERT INTO users (name, email, role, active, year, major)
       SELECT $3 || ' ' || g, lower($4 || '-' || $6 || '-' || g || '@' || $7), $1, 1, $5, 'LTCSE'
       FROM generate_series(1, $2) g RETURNING id, email)
     INSERT INTO institution_members (institution_id, user_id, role, department_id, year_of_study)
     SELECT $8, u.id, $9, $10, $5 FROM u RETURNING user_id`,
    [role, n, prefix, `lt${run}`, year, prefix.toLowerCase().replace(/\s+/g, ''), EMAIL_DOMAIN, I, memberRole, dept.id]
  );
  const [adm] = await mk('admin', 'institution_admin', 1, 'LT Admin', null);
  const profs = await mk('instructor', 'instructor', PROFESSORS, 'LT Prof', null);
  const studs = await mk('student', 'student', STUDENTS, 'LT Student', 2);
  state.userIds = [adm.user_id, ...profs.map(p => p.user_id), ...studs.map(s => s.user_id)]; saveState();
  const studentIds = studs.map(s => s.user_id);

  // ── Courses, modules, assignments, submissions ───────────────────────────
  const courses = [];
  for (const [pi, p] of profs.entries()) {
    for (let k = 1; k <= COURSES_PER_PROF; k++) {
      const [c] = await q(
        `INSERT INTO courses (code, name, instructor_id, institution_id, department_id, semester)
         VALUES ($1, $2, $3, $4, $5, 3) RETURNING id`,
        [`LT${run.slice(-4)}${pi}${k}`, `Load Test Course ${pi + 1}.${k}`, p.user_id, I, dept.id]);
      courses.push({ id: c.id, prof: p.user_id });
    }
  }
  const C = courses.map(c => c.id);
  await q(`INSERT INTO enrollments (course_id, student_id, institution_id, source)
           SELECT c, s, $1, 'auto' FROM unnest($2::int[]) c, unnest($3::int[]) s`, [I, C, studentIds]);
  await q(`INSERT INTO modules (course_id, name, content, display_order, institution_id)
           SELECT c, 'Unit ' || m, 'Synthetic module', m, $1 FROM unnest($2::int[]) c, generate_series(1, 5) m`, [I, C]);
  // Per course: two graded past assignments, one past with no submissions, one future.
  await q(`INSERT INTO assignments (module_id, title, description, due_date, max_points, status, institution_id)
           SELECT m.id, 'Assignment ' || a, 'Synthetic', to_char(current_date + (CASE a WHEN 4 THEN 7 ELSE -10 * a END), 'YYYY-MM-DD'), 100, 'active', $1
           FROM modules m CROSS JOIN generate_series(1, 4) a
           WHERE m.institution_id = $1 AND m.display_order = 1`, [I]);
  await q(`INSERT INTO submissions (assignment_id, student_id, content, grade, feedback, submitted_at, graded_at, institution_id)
           SELECT a.id, s, 'Synthetic answer', 40 + (random() * 60)::int, 'Synthetic feedback',
                  now() - interval '12 days', now() - interval '10 days', $1
           FROM assignments a CROSS JOIN unnest($2::int[]) s
           WHERE a.institution_id = $1 AND a.title IN ('Assignment 1', 'Assignment 2')`, [I, studentIds]);

  // ── Assessments: two published with results, one draft for professors to write to ──
  const exams = await q(
    `INSERT INTO unit_exams (course_id, title, exam_date, max_marks, assessment_type, analysis_status, created_by, institution_id, published_at, published_by)
     SELECT c.id, t.title, current_date - t.ago, 50, 'unit_test', 'done', c.instructor_id, $1,
            CASE WHEN t.published THEN now() END, CASE WHEN t.published THEN c.instructor_id END
     FROM courses c CROSS JOIN (VALUES ('Unit test 1', 30, true), ('Unit test 2', 15, true), ('Unit test 3', 0, false)) t(title, ago, published)
     WHERE c.institution_id = $1 RETURNING id, course_id, title`, [I]);
  await q(`INSERT INTO unit_exam_results (unit_exam_id, student_id, marks_obtained, percentage, performance_band, institution_id, is_absent)
           SELECT e.id, s, m, m * 2, CASE WHEN m >= 37.5 THEN 'strong' WHEN m >= 25 THEN 'moderate' ELSE 'weak' END, $1, false
           FROM unit_exams e CROSS JOIN unnest($2::int[]) s CROSS JOIN LATERAL (SELECT round((10 + random() * 40 + 0 * s)::numeric, 1) AS m) r
           WHERE e.institution_id = $1 AND e.published_at IS NOT NULL`, [I, studentIds]);
  await q(`INSERT INTO course_announcements (institution_id, course_id, author_id, kind, title, due_date)
           SELECT $1, c.id, c.instructor_id, k, 'Synthetic ' || k, current_date + 1
           FROM courses c CROSS JOIN unnest(ARRAY['notice','bring','exam_prep']) k WHERE c.institution_id = $1`, [I]);
  await q(`INSERT INTO notifications (user_id, type, message, metadata, institution_id)
           SELECT s, 'course_notice', 'Synthetic notification ' || n, '{}'::jsonb, $1
           FROM unnest($2::int[]) s CROSS JOIN generate_series(1, 10) n`, [I, studentIds]);

  // ── Logins for the accounts the test signs in as ─────────────────────────
  const sb = admin();
  const loginStudents = studentIds.slice(0, LOGIN_STUDENTS);
  const people = [
    { id: adm.user_id, role: 'admin' },
    ...profs.map(p => ({ id: p.user_id, role: 'instructor' })),
    ...loginStudents.map(id => ({ id, role: 'student' })),
  ];
  const emails = Object.fromEntries((await q(`SELECT id, email FROM users WHERE id = ANY($1::int[])`, [people.map(p => p.id)])).map(r => [r.id, r.email]));
  const passwords = new Map();
  await mapLimit(people, 5, async p => {
    const password = randomBytes(24).toString('base64url');
    const { data, error } = await sb.auth.admin.createUser({ email: emails[p.id], password, email_confirm: true });
    if (error) throw new Error(`createUser: ${error.message}`);
    state.authUserIds.push(data.user.id); saveState();
    await q(`INSERT INTO user_identity_map (legacy_user_id, auth_user_id, role, force_password_change)
             VALUES ($1, $2, $3, false)
             ON CONFLICT (legacy_user_id) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id, role = EXCLUDED.role, force_password_change = false`,
            [p.id, data.user.id, p.role]);
    passwords.set(p.id, password);
  });

  // Sign in (paced, with back-off on rate limits).
  const tokens = { admin: [], instructor: [], student: [] };
  for (const p of people) {
    for (let attempt = 0; ; attempt++) {
      const { data, error } = await anon().auth.signInWithPassword({ email: emails[p.id], password: passwords.get(p.id) });
      if (!error) { tokens[p.role].push({ id: p.id, token: data.session.access_token }); break; }
      if (attempt >= 6) throw new Error(`sign-in failed: ${error.message}`);
      await sleep(5000 * (attempt + 1));
    }
    await sleep(400);
  }
  passwords.clear();

  const draft = exams.filter(e => e.title === 'Unit test 3');
  const published = exams.filter(e => e.title === 'Unit test 1');
  writeFileSync(`${OUT}/tokens.json`, JSON.stringify({
    api: env('API_URL'), tokens, courses: C,
    profCourses: Object.fromEntries(profs.map(p => [p.user_id, courses.filter(c => c.prof === p.user_id).map(c => c.id)])),
    draftExamByCourse: Object.fromEntries(draft.map(e => [e.course_id, e.id])),
    publishedExamByCourse: Object.fromEntries(published.map(e => [e.course_id, e.id])),
    studentIds,
  }));
  chmodSync(`${OUT}/tokens.json`, 0o600);
  const [counts] = await q(`SELECT
      (SELECT count(*) FROM enrollments WHERE institution_id = $1) enrolments,
      (SELECT count(*) FROM submissions WHERE institution_id = $1) submissions,
      (SELECT count(*) FROM unit_exam_results WHERE institution_id = $1) results`, [I]);
  console.log(`Test college ready: ${STUDENTS} students, ${PROFESSORS} professors, ${C.length} courses, ` +
    `${counts.enrolments} enrolments, ${counts.submissions} submissions, ${counts.results} marks. ` +
    `Signed in: 1 admin, ${tokens.instructor.length} professors, ${tokens.student.length} students.`);
} catch (e) {
  console.error('Setup failed:', e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
