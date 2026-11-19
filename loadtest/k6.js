// k6 load test: students, professors and an admin using the live API the way
// the web app does. Each request is tagged with a readable name so the report
// shows timings per endpoint.
import http from 'k6/http';
import { check, sleep, group } from 'k6';

const D = JSON.parse(open(__ENV.TOKENS));
const API = D.api;
const PEAK = Number(__ENV.PEAK || 300);

export const options = {
  scenarios: {
    students: {
      executor: 'ramping-vus', exec: 'student', startVUs: 0,
      stages: [
        { duration: '2m', target: Math.round(PEAK / 6) },
        { duration: '3m', target: Math.round(PEAK / 2) },
        { duration: '3m', target: PEAK },
        { duration: '4m', target: PEAK },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '20s',
    },
    professors: { executor: 'constant-vus', exec: 'professor', vus: 10, duration: '13m' },
    admins: { executor: 'constant-vus', exec: 'admin', vus: 2, duration: '13m' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:read}': ['p(95)<800'],
    'http_req_duration{kind:write}': ['p(95)<1500'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// k6 only reports per-endpoint timings for sub-metrics named in thresholds, so
// every endpoint gets a loose one (the real pass bars are above).
const NAMES = ['auth/me', 'courses', 'notifications', 'notices upcoming', 'student stats', 'my marks',
  'course modules', 'course notices', 'upcoming exams', 'my assignments', 'my analytics', 'my roadmap',
  'prof courses', 'grading queue', 'prof students tab', 'assessments list', 'assessment', 'marks grid',
  'class analysis', 'save marks', 'admin stats', 'admin users', 'admin role counts', 'admin courses', 'audit log'];
for (const n of NAMES) options.thresholds[`http_req_duration{name:${n}}`] = ['p(95)<30000'];

const pick = a => a[Math.floor(Math.random() * a.length)];
const think = (lo, hi) => sleep(lo + Math.random() * (hi - lo));

// 404 is the normal answer for "no study plan yet"; only that endpoint gets it.
const OK_404 = new Set(['my roadmap']);
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 404));

function get(path, name, token) {
  const r = http.get(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, tags: { name, kind: 'read' } });
  const ok = r.status === 200 || (r.status === 404 && OK_404.has(name));
  check(r, { [`${name} ok`]: () => ok });
  if (!ok) console.warn(`FAIL ${name} ${r.status} ${String(r.body).slice(0, 120)}`);
  return r;
}

export function student() {
  const me = pick(D.tokens.student);
  const t = me.token, id = me.id;
  const course = pick(D.courses);
  group('dashboard', () => {
    get('/api/auth/me', 'auth/me', t);
    get('/api/courses', 'courses', t);
    get('/api/notifications', 'notifications', t);
    get('/api/announcements/upcoming', 'notices upcoming', t);
    get(`/api/student/${id}/stats`, 'student stats', t);
    get(`/api/unit-exams/student/${id}/insights`, 'my marks', t);
  });
  think(3, 8);
  group('course page', () => {
    get(`/api/courses/${course}/modules`, 'course modules', t);
    get(`/api/courses/${course}/announcements`, 'course notices', t);
    get('/api/exams/upcoming?days=120', 'upcoming exams', t);
  });
  think(3, 8);
  group('assignments and analytics', () => {
    get(`/api/student/${id}/assignments`, 'my assignments', t);
    get(`/api/students/${id}/analytics`, 'my analytics', t);
    get(`/api/roadmaps/${course}`, 'my roadmap', t);
  });
  think(5, 12);
}

export function professor() {
  const me = pick(D.tokens.instructor);
  const t = me.token;
  const course = pick(D.profCourses[me.id]);
  const published = D.publishedExamByCourse[course];
  const draft = D.draftExamByCourse[course];
  get('/api/instructor/courses', 'prof courses', t);
  get('/api/instructor/submissions?limit=25&status=pending', 'grading queue', t);
  get(`/api/instructor/courses/${course}/analytics`, 'prof students tab', t);
  get(`/api/unit-exams/course/${course}`, 'assessments list', t);
  think(2, 5);
  get(`/api/unit-exams/${published}`, 'assessment', t);
  get(`/api/unit-exams/${published}/roster`, 'marks grid', t);
  get(`/api/unit-exams/${published}/analytics`, 'class analysis', t);
  think(2, 5);
  // Autosave of a marks grid: 10 students at a time on the draft assessment.
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push({ student_id: pick(D.studentIds), marks: Math.round(Math.random() * 500) / 10 });
  const unique = Object.values(Object.fromEntries(rows.map(r => [r.student_id, r])));
  const w = http.put(`${API}/api/unit-exams/${draft}/results`, JSON.stringify({ results: unique }), {
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, tags: { name: 'save marks', kind: 'write' },
  });
  check(w, { 'save marks ok': x => x.status === 200 });
  think(4, 10);
}

export function admin() {
  const t = D.tokens.admin[0].token;
  get('/api/admin/stats', 'admin stats', t);
  get('/api/admin/users?limit=50', 'admin users', t);
  get('/api/admin/users/role-counts', 'admin role counts', t);
  get('/api/admin/courses', 'admin courses', t);
  get('/api/admin/audit-logs?limit=50', 'audit log', t);
  think(8, 15);
}
