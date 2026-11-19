// Tenant isolation, checked on every PR against the local e2e stack (see the
// e2e CI job). Two colleges are seeded: the e2e college (seed.sql) and
// "Other College" (seed-tenant-b.sql). Three layers are checked:
//
//   1. API: users of one college get nothing from the other college's
//      courses, modules, notes, assignments, submissions or users, through
//      reads, writes and list endpoints. Positive controls prove the other
//      college's data exists and is visible to its own users.
//   2. Grants: anon and authenticated hold no privileges on public tables
//      (the app never reads tables through PostgREST).
//   3. RLS, as a second layer if a grant is ever re-added: with temporary
//      SELECT grants inside a rolled-back transaction, every policy evaluates
//      without error and returns only the caller's own college.
//
//   node e2e/tenancy.mjs        (exit code 1 when anything failed)

import pg from 'pg';

const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:3001';
const SUPABASE = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const A = {
  admin:     { email: 'admin@e2e.test',     password: 'E2e-admin-pass1',   uid: 'e2e00000-0000-4000-8000-000000000001' },
  professor: { email: 'professor@e2e.test', password: 'E2e-prof-pass1',    uid: 'e2e00000-0000-4000-8000-000000000004' },
  student:   { email: 'sarah@e2e.test',     password: 'E2e-student-pass1', uid: 'e2e00000-0000-4000-8000-000000000002' },
};
const B = {
  admin:     { email: 'admin@other.test', password: 'Other-pass-1', uid: 'bbbb0000-0000-4000-8000-000000000101' },
  professor: { email: 'prof@other.test',  password: 'Other-pass-1', uid: 'bbbb0000-0000-4000-8000-000000000102' },
  student:   { email: 'stu@other.test',   password: 'Other-pass-1', uid: 'bbbb0000-0000-4000-8000-000000000103' },
};
const B_INSTITUTION = 'bbbbbbbb-0000-4000-8000-00000000000b';
const B_MARKERS = /TENANT-B-SECRET|Other Course|Other Module|Other Assignment|Stu Other|other\.test|other-secret|OTH101/;
const A_MARKERS = /e2e\.test|Sarah Johnson|Michael Chen|Database Systems/;

let failed = 0;
const fail = (what) => { failed++; console.log(`✗ ${what}`); };
const pass = (what) => console.log(`✓ ${what}`);

async function token({ email, password }) {
  const r = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`sign-in failed for ${email}`);
  return j.access_token;
}
async function call(tok, method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body ?? {}),
  });
  return { status: r.status, text: await r.text() };
}

// ── 1. API ────────────────────────────────────────────────────────────────
const tA = Object.fromEntries(await Promise.all(Object.entries(A).map(async ([k, v]) => [k, await token(v)])));
const tB = Object.fromEntries(await Promise.all(Object.entries(B).map(async ([k, v]) => [k, await token(v)])));

// Positive controls: the other college's data exists and its own users see it.
for (const [who, path, marker] of [
  ['student', '/api/students/103/notes', /TENANT-B-SECRET-NOTE/],
  ['student', '/api/courses', /Other Course/],
  ['professor', '/api/instructor/submissions', /TENANT-B-SECRET-SUBMISSION/],
  ['admin', '/api/admin/users', /stu@other\.test/],
]) {
  const r = await call(tB[who], 'GET', path);
  if (r.status === 200 && marker.test(r.text)) pass(`other college ${who} sees its own data at ${path}`);
  else fail(`positive control: other college ${who} GET ${path} -> ${r.status}`);
}

// Reads of the other college's records by id.
const reads = [
  '/api/courses/901/modules', '/api/courses/901/announcements', '/api/modules/901/notes', '/api/modules/901/assignments',
  '/api/modules/901/materials', '/api/notes/901/signed-url', '/api/notes/901/proxy', '/api/submissions/901/files',
  '/api/students/103/notes', '/api/students/103/analytics', '/api/student/103/courses', '/api/student/103/assignments',
  '/api/student/103/stats', '/api/student/103/grading-insights', '/api/instructor/courses/901/analytics',
  '/api/admin/enrollments/901', '/api/unit-exams/course/901', '/api/unit-exams/student/103/insights', '/api/roadmaps/901',
];
for (const role of Object.keys(tA)) {
  for (const path of reads) {
    const r = await call(tA[role], 'GET', path);
    if (r.status < 300 && B_MARKERS.test(r.text)) fail(`${role} GET ${path} leaks the other college's data`);
    else if (r.status >= 500) fail(`${role} GET ${path} -> ${r.status}`);
  }
}
pass(`${reads.length * 3} cross-college reads returned nothing from the other college`);

// Writes against the other college's records.
const writes = [
  ['admin', 'PUT', '/api/admin/users/103', { name: 'x', role: 'admin' }],
  ['admin', 'DELETE', '/api/admin/courses/901'],
  ['admin', 'POST', '/api/admin/enrollments', { course_id: 901, student_id: 2 }],
  ['admin', 'POST', '/api/admin/enrollments', { course_id: 2, student_id: 103 }],
  ['admin', 'POST', '/api/admin/bulk-enroll', { course_id: 2, student_ids: [103] }],
  ['admin', 'PATCH', '/api/admin/courses/901/placement', { semester: 3 }],
  ['professor', 'POST', '/api/submissions/901/grade', { grade: 1, feedback: 'x' }],
  ['professor', 'POST', '/api/courses/901/modules', { name: 'x' }],
  ['professor', 'POST', '/api/modules/901/assignments', { title: 'x', max_points: 10 }],
  ['professor', 'PUT', '/api/assignments/901', { title: 'x' }],
  ['professor', 'DELETE', '/api/assignments/901'],
  ['professor', 'POST', '/api/courses/901/announcements', { title: 'x', body: 'x', kind: 'notice' }],
  ['professor', 'DELETE', '/api/notes/901'],
  ['student', 'POST', '/api/submissions', { assignment_id: 901, content: 'x' }],
];
for (const [role, method, path, body] of writes) {
  const r = await call(tA[role], method, path, body);
  if (r.status < 300) fail(`${role} ${method} ${path} was accepted (${r.status})`);
  else if (r.status >= 500) fail(`${role} ${method} ${path} -> ${r.status}`);
}
const untouched = await db.query(
  `select (select grade from submissions where id = 901) as grade,
          (select title from assignments where id = 901) as title,
          (select count(*)::int from courses where id = 901) as course,
          (select count(*)::int from notes where id = 901) as note,
          (select role from users where id = 103) as role,
          (select count(*)::int from enrollments where (course_id = 901 and student_id = 2) or (course_id = 2 and student_id = 103)) as cross_enrol`);
const u = untouched.rows[0];
if (u.grade === null && u.title === 'Other Assignment' && u.course === 1 && u.note === 1 && u.role === 'student' && u.cross_enrol === 0)
  pass(`${writes.length} cross-college writes were refused and changed nothing`);
else fail(`the other college's records changed: ${JSON.stringify(u)}`);

// List endpoints never mix colleges, in either direction.
const lists = ['/api/courses', '/api/admin/users', '/api/admin/courses', '/api/instructor/courses', '/api/instructor/submissions',
  '/api/notifications', '/api/exams/upcoming', '/api/announcements/upcoming', '/api/unit-exams', '/api/admin/export/users',
  '/api/admin/audit-logs', '/api/search?q=Other', '/api/search?q=Sarah'];
for (const path of lists) {
  for (const [label, toks, markers] of [['e2e college', tA, B_MARKERS], ['other college', tB, A_MARKERS]]) {
    for (const [role, tok] of Object.entries(toks)) {
      const r = await call(tok, 'GET', path);
      if (r.status < 300 && markers.test(r.text)) fail(`${label} ${role} GET ${path} shows the other college's data`);
      else if (r.status >= 500) fail(`${label} ${role} GET ${path} -> ${r.status}`);
    }
  }
}
pass(`${lists.length} list endpoints keep the two colleges apart`);

// ── 2. Grants ─────────────────────────────────────────────────────────────
const grants = await db.query(
  `select grantee, table_name, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')`);
if (grants.rowCount === 0) pass('anon and authenticated hold no privileges on public tables');
else fail(`public table privileges for anon/authenticated: ${grants.rows.slice(0, 5).map(g => `${g.grantee} ${g.privilege_type} ${g.table_name}`).join(', ')}`);

// ── 3. RLS as a second layer ──────────────────────────────────────────────
const tables = (await db.query(
  `select distinct tablename from pg_policies where schemaname = 'public' and 'authenticated' = any(roles) order by 1`)).rows.map(r => r.tablename);
const people = [
  ['e2e college admin', A.admin.uid, B_MARKERS], ['e2e college professor', A.professor.uid, B_MARKERS],
  ['e2e college student', A.student.uid, B_MARKERS], ['other college admin', B.admin.uid, A_MARKERS],
  ['other college student', B.student.uid, A_MARKERS],
];
for (const [label, uid, markers] of people) {
  let seen = 0, errors = 0;
  for (const t of tables) {
    const c = await db.connect();
    try {
      await c.query('begin');
      await c.query('grant usage on schema public, auth, extensions to authenticated');
      await c.query('grant execute on all functions in schema auth to authenticated');
      // Policies read related tables too, so grant them all (rolled back below).
      await c.query(`grant select on ${tables.map(x => `public.${x}`).join(', ')} to authenticated`);
      await c.query('set local role authenticated');
      await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
        [JSON.stringify({ sub: uid, role: 'authenticated' }), uid]);
      const { rows } = await c.query(`select to_jsonb(t)::text as j from public.${t} t`);
      seen += rows.length;
      const leaked = rows.filter(r => markers.test(r.j) || (markers === A_MARKERS ? /ac1b2e09/.test(r.j) : r.j.includes(B_INSTITUTION)));
      if (leaked.length) fail(`RLS: ${label} sees ${leaked.length} row(s) of the other college in ${t}`);
    } catch (e) {
      errors++;
      fail(`RLS: ${label} reading ${t} fails: ${e.message}`);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  }
  if (errors) continue;
  if (seen > 0) pass(`RLS: ${label} reads ${tables.length} tables without errors and sees only their own college (${seen} rows)`);
  else fail(`RLS: ${label} saw no rows at all (policies too strict or helpers broken)`);
}

await db.end();
console.log(failed ? `\n${failed} tenancy check(s) failed` : '\nAll tenancy checks passed');
process.exit(failed ? 1 : 0);
