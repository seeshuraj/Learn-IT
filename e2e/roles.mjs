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
  if (new URL(page.url()).pathname === '/landing') problems.push('signed out unexpectedly');
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
    const key = Object.keys(localStorage).find(k => k.endsWith('-auth-token'));
    const token = JSON.parse(localStorage.getItem(key)).access_token;
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
    const key = Object.keys(localStorage).find(k => k.endsWith('-auth-token'));
    const token = key ? JSON.parse(localStorage.getItem(key)).access_token : '';
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

export const FLOWS = { allPages, courses, bell, questionWiseMarks, noticeBoard };

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
