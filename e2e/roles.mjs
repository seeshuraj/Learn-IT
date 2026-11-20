// End-to-end check of LearnIT as admin, professor and student, against the
// local stack started by the e2e CI job (frontend :4173, API :3001, Supabase
// stand-in :54321, Postgres from DATABASE_URL).
//
// For every page each role can open it records console errors, uncaught
// exceptions and failed API calls, then runs the cross-role flows: things one
// role does must show up for the other.
//
//   node e2e/roles.mjs        (exit code 1 when anything failed)

import { chromium } from 'playwright';
import pg from 'pg';
import fs from 'node:fs';

const APP = process.env.E2E_APP_URL ?? 'http://127.0.0.1:4173';
const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:3001';
const OUT = process.env.E2E_OUT ?? 'e2e-report';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export const ACCOUNTS = {
  admin:     { email: 'admin@e2e.test',     password: 'E2e-admin-pass1' },
  professor: { email: 'professor@e2e.test', password: 'E2e-prof-pass1' },
  student:   { email: 'sarah@e2e.test',     password: 'E2e-student-pass1' },
};

const PAGES = {
  admin:     ['/', '/admin/users', '/admin/courses', '/admin/timetables', '/admin/data', '/admin/settings'],
  professor: ['/', '/courses', '/courses/2', '/notes', '/exams', '/assessments'],
  student:   ['/', '/courses', '/courses/2', '/assignments', '/notes', '/exams', '/marks', '/roadmap', '/analytics'],
};

// API answers that are expected on these pages and are not failures.
const EXPECTED_STATUSES = [
  // A student without a study plan for a course yet.
  { path: /\/api\/roadmaps\/\d+$/, status: 404 },
];

fs.mkdirSync(OUT, { recursive: true });
const results = [];
let failed = 0;
const fail = (where, what) => { failed++; results.push({ ok: false, where, what }); console.log(`✗ ${where}: ${what}`); };
const pass = (where, what) => { results.push({ ok: true, where, what }); console.log(`✓ ${where}: ${what}`); };

function watch(page, label) {
  const problems = [];
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // The browser repeats failed requests as console errors; those are reported below.
    if (/Failed to load resource/.test(t)) return;
    problems.push(`console: ${t.slice(0, 300)}`);
  });
  page.on('pageerror', e => problems.push(`exception: ${String(e.message).slice(0, 300)}`));
  page.on('response', r => {
    const url = r.url();
    if (!url.startsWith(API) || r.status() < 400) return;
    const path = new URL(url).pathname;
    if (EXPECTED_STATUSES.some(x => x.path.test(path) && x.status === r.status())) return;
    problems.push(`HTTP ${r.status()} ${r.request().method()} ${path}`);
  });
  page.on('requestfailed', r => {
    if (r.url().startsWith(API)) problems.push(`request failed: ${r.method()} ${new URL(r.url()).pathname} (${r.failure()?.errorText})`);
  });
  return {
    take() { const p = problems.splice(0); return p; },
    label,
  };
}

async function signIn(browser, role) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const w = watch(page, role);
  await page.goto(`${APP}/login`);
  await page.fill('#email', ACCOUNTS[role].email);
  await page.fill('#password', ACCOUNTS[role].password);
  await page.click('button[type="submit"]');
  await page.waitForURL(u => !/\/(login|landing)/.test(u.pathname), { timeout: 20_000 });
  await page.waitForLoadState('networkidle');
  return { context, page, w };
}

async function visit(page, w, role, path) {
  await page.goto(`${APP}${path}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
  const body = (await page.textContent('body')) ?? '';
  const problems = w.take();
  if (/Expected JSON from|Unexpected token '<'/.test(body)) problems.push('page shows a raw API error');
  if (await page.locator('h1', { hasText: 'Every mark, explained.' }).count()) problems.push('signed out unexpectedly');
  const name = `${role}${path.replace(/\//g, '_') || '_home'}`;
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  const h1 = ((await page.locator('main h1').first().textContent({ timeout: 1500 }).catch(() => '')) ?? '').trim();
  if (problems.length) fail(`${role} ${path}`, problems.join(' | '));
  else pass(`${role} ${path}`, `loads without errors${h1 ? ` (“${h1.slice(0, 60)}”)` : ''}`);
  return body;
}

async function expectText(page, where, text, timeout = 8000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ timeout });
    pass(where, `shows “${text}”`);
  } catch {
    fail(where, `expected to see “${text}”`);
  }
}

// ── Flows ─────────────────────────────────────────────────────────────────

/** Every page of every role loads cleanly. */
async function allPages(browser) {
  for (const role of Object.keys(PAGES)) {
    const { context, page, w } = await signIn(browser, role);
    for (const path of PAGES[role]) await visit(page, w, role, path);
    await context.close();
  }
}

/** Course list and course page show real, role-scoped data. */
async function courses(browser) {
  const prof = await signIn(browser, 'professor');
  await prof.page.goto(`${APP}/courses`);
  await expectText(prof.page, 'professor /courses', 'Database Systems');
  const body = (await prof.page.textContent('body')) ?? '';
  if (/12 Lessons|45 Enrolled|4\.8/.test(body)) fail('professor /courses', 'still shows placeholder numbers');
  await prof.page.getByText('Database Systems').first().click();
  await prof.page.waitForURL(/\/courses\/2$/);
  await expectText(prof.page, 'professor course page', 'Modules');
  await expectText(prof.page, 'professor course page', '2 students enrolled');
  // Dashboard → Students lists enrolled students (it used to be always empty).
  await prof.page.goto(`${APP}/`);
  await prof.page.getByRole('tab', { name: 'Students' }).click();
  await expectText(prof.page, 'professor Students tab', 'Sarah Johnson');
  await prof.context.close();

  const stu = await signIn(browser, 'student');
  await stu.page.goto(`${APP}/courses`);
  await expectText(stu.page, 'student /courses', 'Database Systems');
  await stu.page.goto(`${APP}/courses/2`);
  await expectText(stu.page, 'student course page', 'Upcoming exams');
  // A course Sarah isn't enrolled in must not open.
  const { rows } = await db.query(`select c.id from courses c where not exists
    (select 1 from enrollments e where e.course_id = c.id and e.student_id = 2) limit 1`);
  if (rows[0]) {
    await stu.page.goto(`${APP}/courses/${rows[0].id}`);
    await expectText(stu.page, 'student other course', 'Course not found');
  }
  await stu.context.close();
}

/** A notification for the student appears in the bell and leads somewhere. */
async function bell(browser) {
  await db.query(`insert into notifications (user_id, type, message, metadata)
                  values (2, 'marks_published', 'E2E: results published for CS3200', '{"course_id":2}')`);
  const stu = await signIn(browser, 'student');
  await stu.page.getByRole('button', { name: 'Notifications' }).click();
  await expectText(stu.page, 'student bell', 'E2E: results published for CS3200');
  await stu.page.getByText('E2E: results published for CS3200').click();
  try { await stu.page.waitForURL(/\/marks$/, { timeout: 5000 }); pass('student bell', 'opens My Marks'); }
  catch { fail('student bell', 'clicking the notification did not open My Marks'); }
  await stu.context.close();

  // Posting an assignment notifies the course's students and links to Assignments.
  const prof = await signIn(browser, 'professor');
  const { rows: [mod] } = await db.query(`select id from modules where course_id = 2 order by id limit 1`);
  const created = await jsonAs(prof.page, 'POST', `/api/modules/${mod.id}/assignments`,
    { title: 'E2E posted assignment', description: 'x', due_date: '2099-01-15', max_points: 10, status: 'active' });
  await prof.context.close();
  const { rows: [note] } = await db.query(
    `select message from notifications where user_id = 2 and type = 'new_assignment' and metadata->>'assignment_id' = $1`, [String(created.body?.id)]);
  if (created.status === 201 && note?.message?.includes('E2E posted assignment')) pass('assignment notification', note.message);
  else fail('assignment notification', `create → ${created.status}, notification ${JSON.stringify(note)}`);
  const stu2 = await signIn(browser, 'student');
  await stu2.page.getByRole('button', { name: 'Notifications' }).click();
  await stu2.page.getByText('E2E posted assignment').first().click();
  try { await stu2.page.waitForURL(/\/assignments$/, { timeout: 5000 }); pass('student bell', 'assignment notification opens Assignments'); }
  catch { fail('student bell', 'assignment notification did not open Assignments'); }
  await stu2.context.close();
}

/**
 * Professor builds a Part A/B/C paper, enters marks question by question and
 * publishes; the student sees the total, the conversion, the breakdown and
 * a notification.
 */
async function questionWiseMarks(browser) {
  const prof = await signIn(browser, 'professor');
  const { page } = prof;
  await page.goto(`${APP}/assessments`);
  await page.getByRole('button', { name: 'New assessment' }).first().click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Course').selectOption({ label: 'CS3200: Database Systems' });
  await form.getByLabel('Title').fill('E2E Unit test 1');
  await expectText(form, 'professor new assessment', 'Paper total: 50');
  await form.getByLabel('Counts as (optional)').fill('20');
  await form.getByLabel('Pattern name').fill('E2E unit test 50');
  await form.getByRole('button', { name: 'Save pattern' }).click();
  await expectText(form, 'professor save pattern', 'Saved as “E2E unit test 50”');
  await form.getByRole('button', { name: 'Create and enter marks' }).click();

  const cell = (q, who) => page.getByLabel(new RegExp(`^Q${q} \\(out of .*\\) for ${who}$`));
  try { await cell(1, 'Sarah Johnson').waitFor({ timeout: 10_000 }); pass('professor marks grid', 'shows one cell per question'); }
  catch { fail('professor marks grid', 'question cells did not appear'); await prof.context.close(); return; }

  // The cells must look like inputs: bordered and narrow, not bare 190px fields.
  const look = await cell(1, 'Sarah Johnson').evaluate(el => { const c = getComputedStyle(el); return { w: el.getBoundingClientRect().width, b: c.borderTopWidth }; });
  if (look.w <= 90 && look.b !== '0px') pass('professor marks grid', `question cells styled (${Math.round(look.w)}px, border ${look.b})`);
  else fail('professor marks grid', `question cells unstyled: ${JSON.stringify(look)}`);

  const sarah = { 1: '2', 2: '2', 3: '1.5', 4: '2', 5: '0', 6: '10b', 7: '12', 8: '11' };
  for (const [q, v] of Object.entries(sarah)) await cell(q, 'Sarah Johnson').fill(v);
  const row = page.getByRole('row', { name: /Sarah Johnson/ });
  await expectText(row, 'professor live total', '40.5');

  await cell(1, 'Michael Chen').fill('3');
  await expectText(page, 'professor over-max cell', 'Q1 is out of 2');
  await cell(1, 'Michael Chen').fill('1');
  for (const [q, v] of Object.entries({ 2: '1', 6: '7', 7: '6a', 8: '5' })) await cell(q, 'Michael Chen').fill(v);
  await page.getByText('All changes saved').waitFor({ timeout: 15_000 }).catch(() => fail('professor autosave', 'marks did not save'));

  const { rows: [r] } = await db.query(
    `select r.marks_obtained::float as total, r.converted_marks::float as conv, r.question_marks->'6' as q6, r.topic_breakdown
     from unit_exam_results r join unit_exams e on e.id = r.unit_exam_id
     where e.title = 'E2E Unit test 1' and r.student_id = 2`);
  if (r?.total === 40.5 && r?.conv === 16.2 && r?.q6?.o === 'b') pass('database', 'stores 40.5, counts as 16.2, Q6 option (b)');
  else fail('database', `stored ${JSON.stringify(r)}`);

  await page.getByRole('button', { name: 'Publish results' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish' }).click();
  await expectText(page, 'professor publish', 'Unpublish');
  // Editing a published question-wise assessment (not its paper) must work.
  const { rows: [ex] } = await db.query(`select id, question_pattern from unit_exams where title = 'E2E Unit test 1'`);
  const st = await page.evaluate(async ({ api, id, pattern }) => {
    // The app keeps its Supabase session in sessionStorage.
    const store = [sessionStorage, localStorage].find(st => Object.keys(st).some(k => k.endsWith('-auth-token')));
    const key = store && Object.keys(store).find(k => k.endsWith('-auth-token'));
    const token = key ? JSON.parse(store.getItem(key)).access_token : '';
    const r = await fetch(`${api}/api/unit-exams/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: 'E2E Unit test 1', question_pattern: pattern }) });
    return r.status;
  }, { api: API, id: ex.id, pattern: ex.question_pattern });
  if (st === 200) pass('professor edit published', 'unchanged paper saves (200)'); else fail('professor edit published', `PATCH → ${st}`);
  await page.getByRole('tab', { name: /Analysis/i }).click();
  await expectText(page, 'professor analysis', 'Question by question');
  await prof.context.close();

  const stu = await signIn(browser, 'student');
  await stu.page.getByRole('button', { name: 'Notifications' }).click();
  await expectText(stu.page, 'student bell', 'E2E Unit test 1');
  await stu.page.goto(`${APP}/marks`);
  await expectText(stu.page, 'student My Marks', '40.5/50');
  await expectText(stu.page, 'student My Marks', 'Counts as 16.2/20');
  await stu.page.getByText('Show question-wise marks').first().click();
  await expectText(stu.page, 'student breakdown', 'Q6 (b)');
  await expectText(stu.page, 'student breakdown', 'Part B · 22/26');
  await stu.page.screenshot({ path: `${OUT}/student_marks_breakdown.png`, fullPage: true });
  const left = stu.w.take();
  if (left.length) fail('student marks flow', left.join(' | '));
  await stu.context.close();
}

/** Call the API as the signed-in user of this page (for permission checks). */
async function apiAs(page, method, path, body) {
  return page.evaluate(async ({ api, method, path, body }) => {
    const store = [sessionStorage, localStorage].find(st => Object.keys(st).some(k => k.endsWith('-auth-token')));
    const key = store && Object.keys(store).find(k => k.endsWith('-auth-token'));
    const token = key ? JSON.parse(store.getItem(key)).access_token : '';
    const r = await fetch(`${api}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    return r.status;
  }, { api: API, method, path, body });
}

/** Professor posts on the course notice board; students are notified and see it. */
async function noticeBoard(browser) {
  const prof = await signIn(browser, 'professor');
  await prof.page.goto(`${APP}/courses/2`);
  await expectText(prof.page, 'professor course page', 'Notice board');
  await prof.page.getByRole('radio', { name: 'Bring' }).click();
  await prof.page.getByLabel('Notice', { exact: true }).fill('E2E drawing kit and mini-drafter');
  await prof.page.getByRole('button', { name: 'Tomorrow' }).click();
  await prof.page.getByRole('button', { name: 'Post notice' }).click();
  await expectText(prof.page, 'professor post notice', 'Posted. 2 students were notified.');
  await expectText(prof.page, 'professor notice list', 'For tomorrow');
  await prof.context.close();

  const stu = await signIn(browser, 'student');
  await expectText(stu.page, 'student dashboard', 'Coming up in your courses');
  await expectText(stu.page, 'student dashboard', 'E2E drawing kit and mini-drafter');
  await stu.page.getByRole('button', { name: 'Notifications' }).click();
  await expectText(stu.page, 'student bell', 'CS3200 · Bring tomorrow: E2E drawing kit and mini-drafter');
  await stu.page.getByText('CS3200 · Bring tomorrow: E2E drawing kit and mini-drafter').click();
  try { await stu.page.waitForURL(/\/courses\/2$/, { timeout: 5000 }); pass('student bell', 'opens the course'); }
  catch { fail('student bell', 'clicking the notice did not open the course'); }
  await expectText(stu.page, 'student course page', 'E2E drawing kit and mini-drafter');
  if (await stu.page.getByRole('button', { name: 'Post notice' }).count()) fail('student course page', 'student can see the post form');
  else pass('student course page', 'no post form for students');
  const status = await apiAs(stu.page, 'POST', '/api/courses/2/announcements', { title: 'student post' });
  if (status === 403) pass('permissions', 'student POST notice → 403'); else fail('permissions', `student POST notice → ${status}`);
  const { rows } = await db.query(`select c.id from courses c where not exists
    (select 1 from enrollments e where e.course_id = c.id and e.student_id = 2) limit 1`);
  if (rows[0]) {
    const s2 = await apiAs(stu.page, 'GET', `/api/courses/${rows[0].id}/announcements`);
    if (s2 === 403) pass('permissions', 'notices of a course not enrolled in → 403'); else fail('permissions', `not-enrolled notices → ${s2}`);
  }
  await stu.page.screenshot({ path: `${OUT}/student_course_notices.png`, fullPage: true });
  await stu.context.close();
}

/** The Notes page lists the modules of the courses each role can see. */
async function notesModules(browser) {
  for (const role of ['professor', 'student']) {
    const { context, page } = await signIn(browser, role);
    await page.goto(`${APP}/notes`);
    await page.waitForLoadState('networkidle');
    const none = await page.getByText('No modules found.').count();
    if (none) fail(`${role} /notes`, 'shows "No modules found." although its courses have modules');
    else pass(`${role} /notes`, 'lists course modules');
    await context.close();
  }

  // Notes someone else uploaded: course material from staff, and a classmate's
  // private note. The professor sees both; a student sees only the material.
  const { rows: [mod] } = await db.query(
    `select m.id, c.institution_id from modules m join courses c on c.id = m.course_id where m.course_id = 2 order by m.id limit 1`);
  await db.query(
    `insert into notes (id, student_id, module_id, filename, original_name, content_text, file_type, uploaded_by, institution_id, processing_status)
     values (9101, 1, $1, 'e2e-a.txt', 'E2E staff lecture.txt', 'x', 'text/plain', 1, $2, 'ready'),
            (9102, 3, $1, 'e2e-b.txt', 'E2E classmate private.txt', 'x', 'text/plain', 3, $2, 'ready')
     on conflict (id) do nothing`, [mod.id, mod.institution_id]);
  try {
    for (const [role, sees, hidden] of [
      ['professor', ['E2E staff lecture.txt', 'E2E classmate private.txt'], []],
      ['student', ['E2E staff lecture.txt'], ['E2E classmate private.txt']],
    ]) {
      const { context, page } = await signIn(browser, role);
      await page.goto(`${APP}/notes?module=${mod.id}`);
      await page.waitForLoadState('networkidle');
      const missing = [];
      for (const name of sees) if (!(await page.getByText(name).count())) missing.push(name);
      const leaked = [];
      for (const name of hidden) if (await page.getByText(name).count()) leaked.push(name);
      if (missing.length || leaked.length) fail(`${role} /notes`, `missing ${JSON.stringify(missing)}, should not see ${JSON.stringify(leaked)}`);
      else pass(`${role} /notes`, `shows ${sees.join(' and ')}${hidden.length ? `, not ${hidden.join(', ')}` : ''}`);
      await context.close();
    }
  } finally {
    await db.query(`delete from notes where id in (9101, 9102)`);
  }
}

/** Admin dashboard shows real numbers, not blanks. */
async function adminStats(browser) {
  const { context, page } = await signIn(browser, 'admin');
  await page.waitForLoadState('networkidle');
  const val = async label => (await page.locator('p', { hasText: new RegExp(`^${label}$`) }).first().locator('xpath=following-sibling::h3').textContent().catch(() => '')).trim();
  const users = await val('Active Users'), courses = await val('Total Courses'), pass = await val('Pass rate');
  if (/^\d+$/.test(users) && Number(users) > 0) pass_('admin dashboard', `Active Users = ${users}`); else fail('admin dashboard', `Active Users shows “${users}”`);
  if (/^\d+$/.test(courses) && Number(courses) > 0) pass_('admin dashboard', `Total Courses = ${courses}`); else fail('admin dashboard', `Total Courses shows “${courses}”`);
  if (/^(—|\d+(\.\d)?%)$/.test(pass)) pass_('admin dashboard', `Pass rate = ${pass}`); else fail('admin dashboard', `Pass rate shows “${pass}”`);
  // Endpoints every role calls; admins used to get a 500 (unused SQL parameter).
  for (const p of ['/api/exams/upcoming', '/api/announcements/upcoming']) {
    const st = await apiAs(page, 'GET', p);
    if (st === 200) pass_('admin API', `${p} → 200`); else fail('admin API', `${p} → ${st}`);
  }
  // Course list shows how many students are enrolled.
  await page.goto(`${APP}/admin/courses`);
  await page.waitForLoadState('networkidle');
  const row = page.getByRole('row', { name: /CS3200/ });
  const cells = (await row.locator('td').allTextContents()).map(t => t.trim());
  if (cells.includes('2')) pass_('admin courses', 'CS3200 shows 2 students'); else fail('admin courses', `CS3200 row: ${JSON.stringify(cells)}`);
  // Placing a course: department alone, then semester alone (each used to 500).
  const { rows: [dep] } = await db.query(`select id from departments order by id limit 1`);
  const p1 = await jsonAs(page, 'PATCH', '/api/admin/courses/1/placement', { department_id: dep.id });
  const p2 = await jsonAs(page, 'PATCH', '/api/admin/courses/1/placement', { semester: 3 });
  const { rows: [placed] } = await db.query(`select department_id, semester from courses where id = 1`);
  if (p1.status === 200 && p2.status === 200 && placed.department_id === dep.id && placed.semester === 3) pass_('admin courses', 'department and semester set separately');
  else fail('admin courses', `placement → ${p1.status}/${p2.status} ${JSON.stringify(placed)}`);

  // Enrolment dialog lists students by name and email (both used to be blank).
  await page.goto(`${APP}/admin/courses`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('row', { name: /CS3200/ }).getByRole('button', { name: 'Manage' }).click();
  await page.waitForTimeout(1500);
  const dialogText = (await page.textContent('body')) ?? '';
  if (/Sarah/.test(dialogText) && /sarah@/.test(dialogText)) pass_('admin enrolments', 'enrolled students show name and email');
  else fail('admin enrolments', 'enrolled students show no name or email');
  // Bulk enrol reports emails with no account instead of claiming success.
  const { rows: [cs3200] } = await db.query(`select id from courses where code = 'CS3200'`);
  const bulk = await jsonAs(page, 'POST', '/api/admin/bulk-enroll', { course_id: cs3200.id, emails: ['nobody-here@example.com'] });
  if (bulk.status === 200 && bulk.body?.[0]?.status === 'not_found') pass_('admin enrolments', 'bulk enrol reports an unknown email as not found');
  else fail('admin enrolments', `bulk enrol → ${bulk.status} ${JSON.stringify(bulk.body)}`);
  await page.getByLabel('Student emails').fill('nobody-here@example.com');
  await page.getByRole('button', { name: 'Enrol these students' }).click();
  await page.waitForTimeout(1500);
  if (await page.getByText('1 not found').count()) pass_('admin enrolments', 'the dialog says which emails were not found');
  else fail('admin enrolments', 'the dialog does not report the unknown email');

  // Settings: the AI switch is real and saves.
  await page.goto(`${APP}/admin/settings`);
  const sw = page.getByRole('switch', { name: /AI for students and professors/ });
  await sw.waitFor();
  await sw.click();
  await expectText(page, 'admin settings', 'AI features turned off');
  const { rows: [setting] } = await db.query(`select value from settings where key = 'ai_enabled' limit 1`);
  if (setting?.value === 'false') pass_('admin settings', 'AI switch saved as off'); else fail('admin settings', `ai_enabled = ${setting?.value}`);
  await sw.click();
  await expectText(page, 'admin settings', 'AI features turned on');
  await context.close();
}
const pass_ = (w, m) => pass(w, m);

/** Upload a file as the page's signed-in user; returns { status, body }. */
async function uploadAs(page, path, filename, text, fields = {}) {
  return page.evaluate(async ({ api, path, filename, text, fields }) => {
    const store = [sessionStorage, localStorage].find(st => Object.keys(st).some(k => k.endsWith('-auth-token')));
    const key = Object.keys(store).find(k => k.endsWith('-auth-token'));
    const token = JSON.parse(store.getItem(key)).access_token;
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append('file', new Blob([text], { type: 'text/csv' }), filename);
    const r = await fetch(`${api}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { api: API, path, filename, text, fields });
}

/** JSON call as the page's signed-in user; returns { status, body }. */
async function jsonAs(page, method, path, body) {
  return page.evaluate(async ({ api, method, path, body }) => {
    const store = [sessionStorage, localStorage].find(st => Object.keys(st).some(k => k.endsWith('-auth-token')));
    const key = Object.keys(store).find(k => k.endsWith('-auth-token'));
    const token = JSON.parse(store.getItem(key)).access_token;
    const r = await fetch(`${api}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { api: API, method, path, body });
}

/**
 * Paths the UI flows don't reach: changing a paper after marks exist,
 * importing question-wise marks from a sheet.
 */
async function patternEditsAndImport(browser) {
  const { rows: [ex] } = await db.query(`select id, question_pattern from unit_exams where title = 'E2E Unit test 1'`);
  if (!ex) { fail('pattern edits', 'needs the questionWiseMarks flow to run first'); return; }
  const prof = await signIn(browser, 'professor');
  const { page } = prof;
  const pat = JSON.parse(JSON.stringify(ex.question_pattern));

  // Published: the paper can't change.
  const q8 = pat.parts[2].questions[0];
  q8.marks = 15;
  let r = await jsonAs(page, 'PATCH', `/api/unit-exams/${ex.id}`, { question_pattern: pat });
  if (r.status === 409) pass('pattern edits', 'published paper change refused (409)'); else fail('pattern edits', `published change → ${r.status}`);

  await jsonAs(page, 'POST', `/api/unit-exams/${ex.id}/unpublish`);
  // A change that a stored mark no longer fits (Sarah has 2 in Q1) is refused, naming who.
  const shrink = JSON.parse(JSON.stringify(ex.question_pattern));
  shrink.parts[0].questions[0].marks = 1;
  r = await jsonAs(page, 'PATCH', `/api/unit-exams/${ex.id}`, { question_pattern: shrink });
  const named = JSON.stringify(r.body ?? {});
  if (r.status === 422 && /Q1/.test(named)) pass('pattern edits', 'change that breaks a mark refused, naming Q1');
  else fail('pattern edits', `shrinking Q1 → ${r.status} ${named.slice(0, 160)}`);

  // A compatible change re-scores everyone: Q8 out of 15, total 51, Sarah still 40.5.
  r = await jsonAs(page, 'PATCH', `/api/unit-exams/${ex.id}`, { question_pattern: pat });
  const { rows: [after] } = await db.query(
    `select e.max_marks::float as max, r.marks_obtained::float as got, r.percentage::float as pct
     from unit_exams e join unit_exam_results r on r.unit_exam_id = e.id and r.student_id = 2 where e.id = $1`, [ex.id]);
  if (r.status === 200 && after?.max === 51 && after?.got === 40.5 && Math.abs(after.pct - 79.41) < 0.01) pass('pattern edits', 'compatible change re-scored (51 max, 40.5 = 79.41%)');
  else fail('pattern edits', `compatible change → ${r.status} ${JSON.stringify(after)}`);

  // Import question-wise marks from a sheet (preview only; nothing is saved).
  const csv = 'email,Q1,Q2,Q3,Q4,Q5,Q6,Q7,Q8\nsarah@e2e.test,2,2,1.5,2,0,10b,12,11\nmichael@e2e.test,1,3,,,,,,\n';
  r = await uploadAs(page, `/api/unit-exams/${ex.id}/preview-marks`, 'marks.csv', csv);
  const sarah = r.body?.matched?.find(m => m.email === 'sarah@e2e.test');
  const michael = r.body?.matched?.find(m => m.email === 'michael@e2e.test');
  if (r.status === 200 && sarah && !sarah.error && String(sarah.questions?.['6']).toLowerCase() === '10b') pass('import', 'sheet with Q columns read (Q6 = 10b, no error)');
  else fail('import', `preview → ${r.status} ${JSON.stringify(sarah ?? r.body).slice(0, 200)}`);
  if (michael?.error && /Q2/.test(michael.error)) pass('import', 'over-max cell in the sheet flagged (Q2)');
  else fail('import', `Michael's row: ${JSON.stringify(michael).slice(0, 200)}`);
  await prof.context.close();
}

/**
 * Admin uploads and publishes an exam timetable; the course's professor and
 * student see the exam, and the student's calendar link serves it.
 */
async function timetableFlow(browser) {
  const day = new Date(Date.now() + 10 * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
  const [y, m, d] = day.split('-');
  const csv = `date,session,course_code,venue\n${d}/${m}/${y},FN,CS3200,Hall 2\n`;
  const admin = await signIn(browser, 'admin');
  let r = await uploadAs(admin.page, '/api/admin/timetables', 'tt.csv', csv, { title: 'E2E Unit test 2', assessment_type: 'unit_test' });
  const tt = { ...(r.body?.timetable ?? {}), entries: r.body?.entries };
  if (r.status === 201 && tt.id && tt.entries?.length === 1) pass('timetable', 'CSV uploaded, 1 exam read');
  else { fail('timetable', `upload → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); await admin.context.close(); return; }
  const bad = await jsonAs(admin.page, 'POST', '/api/admin/timetables/undefined/publish');
  if (bad.status === 404) pass('timetable', 'malformed id → 404, not a server error'); else fail('timetable', `malformed id → ${bad.status}`);
  r = await jsonAs(admin.page, 'POST', `/api/admin/timetables/${tt.id}/publish`);
  if (r.status === 200) pass('timetable', 'published'); else fail('timetable', `publish → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  await admin.context.close();

  for (const role of ['professor', 'student']) {
    const u = await signIn(browser, role);
    const up = await jsonAs(u.page, 'GET', '/api/exams/upcoming');
    const hit = (up.body ?? []).find(e => e.course_code === 'CS3200' && e.exam_date === day);
    if (hit) pass('timetable', `${role} sees CS3200 on ${day} (${hit.session}, ${hit.venue})`); else fail('timetable', `${role} upcoming: ${JSON.stringify(up.body).slice(0, 200)}`);
    await u.page.goto(`${APP}/exams`);
    await expectText(u.page, `${role} /exams`, 'E2E Unit test 2');
    if (role === 'student') {
      const link = await jsonAs(u.page, 'POST', '/api/calendar/feed-link');
      const ics = link.body?.url ? await fetch(link.body.url).then(x => x.text()) : '';
      if (/BEGIN:VCALENDAR/.test(ics) && /CS3200/.test(ics)) pass('calendar', 'student feed has the exam');
      else fail('calendar', `feed: ${link.status} ${ics.slice(0, 120)}`);
    }
    await u.context.close();
  }
  // Admin's own calendar feed works too (it 500'd before #53).
  const a2 = await signIn(browser, 'admin');
  const link = await jsonAs(a2.page, 'POST', '/api/calendar/feed-link');
  const ics = link.body?.url ? await fetch(link.body.url) : null;
  if (ics?.status === 200) pass('calendar', 'admin feed serves (200)'); else fail('calendar', `admin feed → ${ics?.status}`);
  await a2.context.close();
}

/** What search engines and signed-out visitors get. */
async function publicSite(browser) {
  const raw = await (await fetch(`${APP}/`)).text();
  const want = {
    'prerendered heading': raw.includes('Every mark, explained.'),
    'title names LearnIT Analytics': /<title>[^<]*LearnIT Analytics/.test(raw),
    'canonical link': raw.includes('<link rel="canonical" href="https://www.learnitanalytics.com/"'),
    'structured data': raw.includes('application/ld+json'),
    'meta description 50–160 characters': (() => {
      const d = raw.match(/<meta name="description" content="([^"]*)"/)?.[1]?.replace(/&#39;/g, "'") ?? '';
      return d.length >= 50 && d.length <= 160;
    })(),
    'exactly one <h1>': (raw.match(/<h1[\s>]/g) ?? []).length === 1,
    'prices ₹300 / ₹500 / ₹650': ['₹300', '₹500', '₹650'].every(p => raw.includes(p)),
    'for universities and colleges': raw.includes('universities and colleges') && !/engineering colleges/i.test(raw),
  };
  const missing = Object.entries(want).filter(([, ok]) => !ok).map(([k]) => k);
  if (missing.length) fail('public / (HTML source)', `missing: ${missing.join(', ')}`);
  else pass('public / (HTML source)', 'has the landing text, title, canonical link and structured data without JavaScript');

  // Old plain-text reset tokens: both routes are closed.
  for (const route of ['request-reset', 'reset-password']) {
    const r = await fetch(`${API}/api/auth/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'sarah@learnit.edu', token: 'x', newPassword: 'x'.repeat(12) }) });
    if (r.status === 410) pass(`security: /api/auth/${route}`, 'retired (410)');
    else fail(`security: /api/auth/${route}`, `status ${r.status}`);
  }
  const h = (await fetch(`${API}/api/health`)).headers;
  if (h.get('strict-transport-security')?.includes('max-age=') && h.get('cache-control') === 'no-store')
    pass('security: API headers', 'HSTS and no-store on responses');
  else fail('security: API headers', `hsts ${h.get('strict-transport-security')}, cache ${h.get('cache-control')}`);

  for (const f of ['robots.txt', 'sitemap.xml']) {
    const r = await fetch(`${APP}/${f}`);
    const body = await r.text();
    if (r.ok && !body.includes('<!doctype html>') && body.includes('learnitanalytics.com')) pass(`public /${f}`, 'served');
    else fail(`public /${f}`, `status ${r.status}`);
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  await page.goto(`${APP}/`);
  await page.waitForLoadState('networkidle');
  const h1 = await page.locator('h1', { hasText: 'Every mark, explained.' }).count();
  const robots = await page.locator('meta[name="robots"]').getAttribute('content');
  if (h1 === 1 && new URL(page.url()).pathname === '/' && robots?.startsWith('index'))
    pass('public / (signed out)', 'shows the landing page once, indexable');
  else fail('public / (signed out)', `h1 count ${h1}, path ${new URL(page.url()).pathname}, robots ${robots}`);

  await page.goto(`${APP}/courses`);
  await page.waitForLoadState('networkidle');
  const robots2 = await page.locator('meta[name="robots"]').getAttribute('content');
  if (new URL(page.url()).pathname === '/' && (await page.locator('#prerender').count()) === 0)
    pass('public /courses (signed out)', 'sends the visitor to the landing page');
  else fail('public /courses (signed out)', `ended at ${page.url()}, robots ${robots2}`);
  await context.close();
}

/**
 * Class enrolment: a student (e.g. lateral entry into 2nd year) gets their
 * department's courses for the current semester; a professor can teach in
 * two departments; hand-made enrolments are never withdrawn.
 */
async function classEnrolment(browser) {
  const admin = await signIn(browser, 'admin');
  const { page } = admin;
  const ok = (r, what) => { if (r.status >= 300) fail('class enrolment setup', `${what} → ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
  ok(await jsonAs(page, 'POST', '/api/admin/settings', { key: 'current_term', value: 'odd' }), 'term');
  const bad = await jsonAs(page, 'POST', '/api/admin/settings', { key: 'current_term', value: 'summer' });
  if (bad.status === 422) pass('class enrolment', 'term setting accepts only odd, even or auto'); else fail('class enrolment', `bad term → ${bad.status}`);

  const { rows: [cse] } = await db.query(`select id from departments where code = 'COMPUTERSCIENCE'`);
  const ece = ok(await jsonAs(page, 'POST', '/api/admin/departments', { code: 'E2EECE', name: 'E2E Electronics' }), 'department');
  const csCourse = ok(await jsonAs(page, 'POST', '/api/admin/courses', { code: 'E2E-CS301', name: 'E2E Data Structures', instructor_id: 4 }), 'CSE course');
  const ecCourse = ok(await jsonAs(page, 'POST', '/api/admin/courses', { code: 'E2E-EC301', name: 'E2E Signals', instructor_id: 4 }), 'ECE course');
  ok(await jsonAs(page, 'PATCH', `/api/admin/courses/${csCourse.id}/placement`, { department_id: cse.id, semester: 3 }), 'place CSE');
  ok(await jsonAs(page, 'PATCH', `/api/admin/courses/${ecCourse.id}/placement`, { department_id: ece.id, semester: 3 }), 'place ECE');

  // Lateral entry: a new 2nd-year CSE student.
  const stu = ok(await jsonAs(page, 'POST', '/api/admin/users', { name: 'E2E Lateral Student', email: 'lateral@e2e.test', role: 'student', year: 2, major: 'COMPUTERSCIENCE' }), 'student');
  const enrolments = async () => (await db.query(
    `select c.code, e.source, e.id from enrollments e join courses c on c.id = e.course_id where e.student_id = $1 order by c.code`, [stu.id])).rows;
  let rows = await enrolments();
  if (rows.length === 1 && rows[0].code === 'E2E-CS301' && rows[0].source === 'auto') pass('class enrolment', 'a new 2nd-year CSE student gets the CSE semester 3 course, not the ECE one');
  else fail('class enrolment', `new student enrolments: ${JSON.stringify(rows)}`);
  const { rows: [note] } = await db.query(`select message from notifications where user_id = $1 and type = 'enrollment_confirmed'`, [stu.id]);
  if (note?.message?.includes('E2E-CS301')) pass('class enrolment', `student notified: “${note.message}”`); else fail('class enrolment', 'student not notified');

  // An admin can't remove a class enrolment by hand; a manual one is kept.
  const del = await jsonAs(page, 'DELETE', `/api/admin/enrollments/${rows[0].id}`);
  if (del.status === 409) pass('class enrolment', 'removing a class enrolment by hand is refused with a reason'); else fail('class enrolment', `delete auto → ${del.status}`);
  ok(await jsonAs(page, 'POST', '/api/admin/enrollments', { course_id: ecCourse.id, student_id: stu.id }), 'manual enrol');

  // Next year (3rd year, odd term → semester 5): the semester 3 course is
  // withdrawn, CSE's semester 5 course (CS3200 in the seed) is added, and
  // the hand-made enrolment stays.
  ok(await jsonAs(page, 'PUT', `/api/admin/users/${stu.id}`, { year: 3 }), 'year 3');
  rows = await enrolments();
  const now3 = rows.map(r => `${r.code}:${r.source}`).join(',');
  if (now3 === 'CS3200:auto,E2E-EC301:manual') pass('class enrolment', 'moving to 3rd year swaps the class courses and keeps the hand-made one');
  else fail('class enrolment', `after year change: ${now3}`);

  // Back to year 2, then re-placing the course moves it with its class.
  ok(await jsonAs(page, 'PUT', `/api/admin/users/${stu.id}`, { year: 2 }), 'year 2');
  ok(await jsonAs(page, 'PATCH', `/api/admin/courses/${csCourse.id}/placement`, { semester: 5 }), 'replace');
  rows = await enrolments();
  if (!rows.some(r => r.code === 'E2E-CS301')) pass('class enrolment', 'a course moved to another semester leaves the old class'); else fail('class enrolment', `after re-placing: ${JSON.stringify(rows)}`);
  ok(await jsonAs(page, 'PATCH', `/api/admin/courses/${csCourse.id}/placement`, { semester: 3 }), 'place back');
  const sync = ok(await jsonAs(page, 'POST', '/api/admin/class-enrolments/sync'), 'sync');
  if (sync && typeof sync.added === 'number') pass('class enrolment', `sync button: ${sync.added} added, ${sync.removed} withdrawn`);

  // Even semester: year 2 means semester 4, so the semester 3 course goes.
  const even = ok(await jsonAs(page, 'POST', '/api/admin/settings', { key: 'current_term', value: 'even' }), 'even');
  rows = await enrolments();
  if (!rows.some(r => r.code === 'E2E-CS301') && even?.enrolments) pass('class enrolment', 'switching to the even semester moves classes on');
  else fail('class enrolment', `after even term: ${JSON.stringify(rows)}`);
  await jsonAs(page, 'POST', '/api/admin/settings', { key: 'current_term', value: 'auto' });

  // The Settings page shows the semester choice.
  await page.goto(`${APP}/admin/settings`);
  await expectText(page, 'admin settings', 'Current semester');
  await admin.context.close();

  // One professor, courses in two departments.
  const prof = await signIn(browser, 'professor');
  const mine = await jsonAs(prof.page, 'GET', '/api/courses');
  const codes = (mine.body ?? []).map(c => c.code);
  if (codes.includes('E2E-CS301') && codes.includes('E2E-EC301')) pass('professor', 'teaches courses in two departments and sees both');
  else fail('professor', `courses: ${JSON.stringify(codes)}`);
  await prof.context.close();
}

/** Every link and button leads somewhere: search, shortcuts, deep links, notifications. */
async function noDeadEnds(browser) {
  // ── Search box: student finds their course and goes to it ──
  const stu = await signIn(browser, 'student');
  await stu.page.goto(`${APP}/`);
  await stu.page.getByRole('combobox', { name: 'Search' }).fill('Database');
  try {
    await stu.page.getByRole('option', { name: /Database Systems/ }).first().click({ timeout: 6000 });
    await stu.page.waitForURL(/\/courses\/2$/, { timeout: 5000 });
    pass('search', 'student finds “Database Systems” and opens the course');
  } catch { fail('search', `student search did not open the course (at ${stu.page.url()})`); }
  // Same on a phone: the bar has a Search button that opens the box.
  await stu.page.setViewportSize({ width: 390, height: 844 });
  await stu.page.goto(`${APP}/`);
  try {
    await stu.page.getByRole('button', { name: 'Search', exact: true }).click({ timeout: 5000 });
    await stu.page.getByRole('combobox', { name: 'Search' }).fill('Database');
    await stu.page.getByRole('option', { name: /Database Systems/ }).first().click({ timeout: 6000 });
    await stu.page.waitForURL(/\/courses\/2$/, { timeout: 5000 });
    if (await stu.page.locator('#mobile-search').count()) throw new Error('panel stayed open');
    pass('search (phone)', 'Search button opens the box, the result opens the course and the panel closes');
  } catch (e) { fail('search (phone)', `${e.message.split('\n')[0]} (at ${stu.page.url()})`); }
  await stu.page.setViewportSize({ width: 1280, height: 860 });

  const leak = await jsonAs(stu.page, 'GET', '/api/search?q=CS');
  const codes = (leak.body?.courses ?? []).map(c => c.code);
  const { rows: mine } = await db.query(`select c.code from enrollments e join courses c on c.id = e.course_id where e.student_id = 2`);
  const enrolled = new Set(mine.map(r => r.code));
  if (leak.status === 200 && !(leak.body?.people ?? []).length && codes.length && codes.every(c => enrolled.has(c)))
    pass('search', `student sees only their own courses (${codes.join(', ') || 'none'}) and no people`);
  else fail('search', `student search scope: ${JSON.stringify(leak.body)}`);

  // ── “Open AI Tutor” goes to Notes & AI Chat ──
  await stu.page.goto(`${APP}/`);
  await stu.page.getByRole('link', { name: 'Open AI Tutor' }).click();
  try { await stu.page.waitForURL(/\/notes$/, { timeout: 5000 }); pass('student dashboard', '“Open AI Tutor” opens Notes & AI Chat'); }
  catch { fail('student dashboard', '“Open AI Tutor” went nowhere'); }

  // A student can't read another student's plan.
  const other = await jsonAs(stu.page, 'GET', '/api/roadmaps/2?student_id=3');
  if (other.status === 403) pass('roadmap', 'a student cannot read another student’s plan'); else fail('roadmap', `student → other plan: ${other.status}`);

  // ── Submitting notifies the professor ──
  const prof = await signIn(browser, 'professor');
  const { rows: [mod] } = await db.query(`select id from modules where course_id = 2 order by id limit 1`);
  const asg = await jsonAs(prof.page, 'POST', `/api/modules/${mod.id}/assignments`,
    { title: 'E2E dead-ends assignment', description: 'x', due_date: '2099-02-01', max_points: 10, status: 'active' });
  const sub = await jsonAs(stu.page, 'POST', '/api/submissions', { assignment_id: asg.body?.id, content: 'My answer' });
  const { rows: [pn] } = await db.query(
    `select message from notifications where user_id = 4 and type = 'new_submission' and metadata->>'submission_id' = $1`, [String(sub.body?.id)]);
  if (sub.status === 201 && pn?.message?.includes('E2E dead-ends assignment')) pass('submission', `professor notified: “${pn.message}”`);
  else fail('submission', `submit → ${sub.status}; professor notification ${JSON.stringify(pn)}`);

  // Search result for an assignment opens it directly.
  await stu.page.goto(`${APP}/assignments?id=${asg.body?.id}`);
  await expectText(stu.page, 'assignment deep link', 'Submitted');
  await stu.context.close();

  // ── Professor: roadmap panel reads the student's plan, not their own ──
  const asProf = await jsonAs(prof.page, 'GET', '/api/roadmaps/2?student_id=2');
  if (asProf.status === 200 || asProf.status === 404) pass('roadmap', `professor reads a student's plan for their course (${asProf.status === 404 ? 'none yet' : 'found'})`);
  else fail('roadmap', `professor → student plan: ${asProf.status} ${JSON.stringify(asProf.body)}`);
  await db.query(`insert into student_roadmaps (student_id, course_id, institution_id, title, summary)
                  select 2, 2, institution_id, 'E2E plan', 'x' from courses where id = 2 on conflict do nothing`).catch(() => undefined);
  const seen = await jsonAs(prof.page, 'GET', '/api/roadmaps/2?student_id=2');
  if (seen.status === 200 && seen.body?.student_id === 2) pass('roadmap', 'professor sees the student’s own plan');
  else fail('roadmap', `professor sees ${seen.status} ${JSON.stringify(seen.body)?.slice(0, 120)}`);

  // ── Course page “Upload notes” opens the upload dialog for that course ──
  await prof.page.goto(`${APP}/courses/2`);
  await prof.page.getByRole('link', { name: 'Upload notes' }).click();
  try {
    const heading = prof.page.getByRole('heading', { name: 'Upload Module Notes' });
    await heading.waitFor({ timeout: 6000 });
    const courseSelect = heading.locator('xpath=ancestor::*[.//select][1]').locator('select').first();
    // The course list loads after the dialog opens.
    await courseSelect.locator('option[value="2"]').waitFor({ state: 'attached', timeout: 6000 });
    const chosen = await courseSelect.inputValue();
    if (chosen === '2') pass('course page', '“Upload notes” opens the upload dialog with the course chosen');
    else fail('course page', `upload dialog course = ${chosen}`);
  } catch { fail('course page', '“Upload notes” did not open the upload dialog'); }

  // ── Deleting an assessment updates the “was scheduled” prompt ──
  const ex = await jsonAs(prof.page, 'POST', '/api/unit-exams', { course_id: 2, title: 'E2E Cancelled test', max_marks: 50, assessment_type: 'unit_test' });
  await db.query(`update student_roadmaps set stale_reason = 'E2E Cancelled test was scheduled' where student_id = 2 and course_id = 2`);
  const del = await jsonAs(prof.page, 'DELETE', `/api/unit-exams/${ex.body?.id}`);
  const { rows: [plan] } = await db.query(`select stale_reason from student_roadmaps where student_id = 2 and course_id = 2`);
  if (del.status === 200 && plan?.stale_reason === 'E2E Cancelled test was cancelled') pass('study plan', 'deleting an assessment says it was cancelled');
  else fail('study plan', `delete → ${del.status}, reason “${plan?.stale_reason}”`);
  await db.query(`delete from student_roadmaps where title = 'E2E plan'`);
  await prof.context.close();

  // ── Admin: search finds people and opens User Management filtered ──
  const admin = await signIn(browser, 'admin');
  await admin.page.goto(`${APP}/`);
  await admin.page.getByRole('combobox', { name: 'Search' }).fill('Sarah Johnson');
  try {
    await admin.page.getByRole('option', { name: /Sarah Johnson/ }).first().click({ timeout: 6000 });
    await admin.page.waitForURL(/\/admin\/users\?q=/, { timeout: 5000 });
    await admin.page.locator('text=Sarah Johnson >> visible=true').first().waitFor({ timeout: 8000 });
    pass('search', 'admin finds a person and opens User Management filtered to them');
  } catch { fail('search', `admin person search failed (at ${admin.page.url()})`); }
  // Admin on a course page: no links to pages admins don't have.
  await admin.page.goto(`${APP}/courses/2`);
  await admin.page.waitForLoadState('networkidle');
  const dead = await admin.page.locator('a[href="/exams"], a[href="/assessments"], a[href^="/?upload"]').count();
  if (dead === 0) pass('course page', 'admins see only links they can open'); else fail('course page', `${dead} dead links for admin`);
  await admin.context.close();
}

export const FLOWS = { publicSite, adminStats, notesModules, allPages, courses, bell, questionWiseMarks, patternEditsAndImport, timetableFlow, noticeBoard, classEnrolment, noDeadEnds };

async function main() {
  const browser = await chromium.launch();
  const only = process.argv.slice(2);
  for (const [name, fn] of Object.entries(FLOWS)) {
    if (only.length && !only.includes(name)) continue;
    console.log(`\n── ${name}`);
    try { await fn(browser); }
    catch (e) { fail(name, `crashed: ${e.message}`); }
  }
  await browser.close();
  await db.end();
  const md = ['| | Check | Result |', '|---|---|---|',
    ...results.map(r => `| ${r.ok ? '✅' : '❌'} | ${r.where} | ${r.what.replace(/\|/g, '\\|')} |`)].join('\n');
  fs.writeFileSync(`${OUT}/report.md`, `## End-to-end: ${failed ? `${failed} failed` : 'all passed'}\n\n${md}\n`);
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main();
