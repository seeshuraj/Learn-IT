/**
 * api.ts — Centralised API client.
 *
 * Every request (except multipart uploads) goes through `request()` which
 * automatically injects `Authorization: Bearer <token>` from the active
 * Supabase session. Multipart helpers do the same via `authHeaders()`.
 *
 * In dev, BASE is empty so Vite proxies :5173 → :3000.
 * In production (Vercel), VITE_API_BASE_URL is baked in at build time via
 * .env.production. A hardcoded fallback ensures the bundle never resolves
 * to '' and accidentally hits the Vercel SPA, which returns HTML.
 */
import { supabase, getAccessToken } from './supabaseClient';
import type { StudentAnalyticsData, ClassOverviewData } from './aiService';

export interface Department {
  id: number;
  code: string;
  name: string;
  students: number;
  professors: number;
  courses: number;
}

// ── Assessment types (see src/server/routes/unitExams.ts) ────────────────────
export type AssessmentType = 'unit_test' | 'model' | 'end_semester' | 'quiz' | 'lab' | 'other';

export interface Assessment {
  id: number;
  course_id: number;
  course_name?: string;
  course_code?: string | null;
  title: string;
  assessment_type: AssessmentType;
  exam_date: string | null;
  max_marks: number | string;
  internal_max: number | string | null;
  external_max: number | string | null;
  credits: number | string | null;
  semester: number | null;
  published_at: string | null;
  analysis_status: string;
  paper_storage_path: string | null;
  result_count?: number;
  absent_count?: number;
  enrolled_count?: number;
}

export interface RosterStudent {
  student_id: number;
  name: string | null;
  email: string | null;
  marks_obtained: string | null;
  internal_marks: string | null;
  external_marks: string | null;
  is_absent: boolean | null;
  percentage: string | null;
  performance_band: string | null;
  grade: string | null;
  grade_point: string | null;
  remarks: string | null;
  updated_at: string | null;
}

export interface MarksEntry {
  student_id: number;
  marks?: string | number | null;
  internal?: string | number | null;
  external?: string | number | null;
  absent?: boolean;
  grade?: string | null;
  remarks?: string | null;
}

/** One published result, as the student sees it. */
export interface StudentResult {
  exam_id: number;
  exam_title: string;
  assessment_type: AssessmentType;
  exam_date: string | null;
  max_marks: string;
  internal_max: string | null;
  external_max: string | null;
  credits: string | null;
  semester: number | null;
  published_at: string;
  course_id: number;
  course_name: string;
  course_code: string | null;
  marks_obtained: string | null;
  internal_marks: string | null;
  external_marks: string | null;
  is_absent: boolean;
  percentage: string | null;
  performance_band: 'strong' | 'moderate' | 'weak' | null;
  grade: string | null;
  grade_point: string | null;
  remarks: string | null;
  /** Only when at least 5 students wrote. */
  class_avg_pct: string | null;
}

export interface StudentMarks {
  results: StudentResult[];
  latest: StudentResult | null;
  overall_avg: number | null;
  weak_topics: string[];
  gpa: { semesters: { semester: number; sgpa: number | null; credits: number; courses: number }[]; cgpa: number | null };
}

export interface TimetableSummary {
  id: number;
  title: string;
  assessment_type: AssessmentType;
  status: 'extracting' | 'draft' | 'published' | 'failed';
  source_kind: string | null;
  source_name: string | null;
  published_at: string | null;
  created_at: string;
  exams: number;
  matched: number;
  first_date: string | null;
  last_date: string | null;
}

export interface TimetableEntry {
  id: number;
  row_number: number | null;
  exam_date: string | null;
  session: 'FN' | 'AN' | null;
  start_time: string | null;
  end_time: string | null;
  course_code: string | null;
  course_name: string | null;
  department_text: string | null;
  department_id: number | null;
  department_code: string | null;
  year_of_study: number | null;
  semester: number | null;
  venue: string | null;
  course_id: number | null;
  matched_code: string | null;
  matched_name: string | null;
  professor_name: string | null;
  unit_exam_id: number | null;
  problems: string[];
}

export interface TimetableDetail {
  timetable: TimetableSummary & { extraction_note: string | null; has_source: boolean };
  entries: TimetableEntry[];
}

export interface MarksPreview {
  rows_total: number;
  matched: (MarksEntry & { row: number; name: string | null; email: string | null; error: string | null })[];
  problems: { row: number; reason: string }[];
  problems_total: number;
  missing: number;
}

/** Backend origin. Every browser call to the API builds its URL from this. */
export const API_BASE: string =
  (import.meta as any).env?.VITE_API_BASE_URL ||
  'https://learnit-api-sg.onrender.com'; // production fallback (Singapore) — never empty
const BASE = API_BASE;

// ── Auth helpers ─────────────────────────────────────────────────────────────

/** Returns { Authorization: 'Bearer <token>' } or {} if not signed in. */
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Sign in with Supabase (email + password).
 * Optionally forwards a captchaToken from hCaptcha (P2-10).
 */
export async function supabaseSignIn(
  email: string,
  password: string,
  captchaToken?: string
) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
    ...(captchaToken ? { options: { captchaToken } } : {}),
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Sign out of Supabase and clear the stored session. */
export async function supabaseSignOut() {
  await supabase.auth.signOut();
}

// ── Core fetch wrapper ──────────────────────────────────────────────────────────

/**
 * Retry a GET request up to `maxRetries` times when the server returns HTML
 * instead of JSON (happens during Render cold-start while Express is booting).
 * Only GET requests are retried — mutating requests are never retried.
 */
async function request<T = any>(
  path: string,
  options?: RequestInit,
  maxRetries = 3,
): Promise<T> {
  const isGet = !options?.method || options.method.toUpperCase() === 'GET';
  let attempt = 0;

  while (true) {
    const ah = await authHeaders();
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...ah,
        ...options?.headers,
      },
      credentials: 'include',
    });

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      const preview = await res.text();
      // If this is a GET and we got HTML (likely cold-start SPA fallback), retry.
      if (isGet && attempt < maxRetries && preview.trim().startsWith('<')) {
        attempt++;
        const delay = 1000 * attempt; // 1s, 2s, 3s
        console.warn(`[API] Got HTML for ${path}, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error(
        `[API] Expected JSON from ${BASE}${path} but got: ${preview.slice(0, 120)}`
      );
    }

    const data = await res.json();
    if (!res.ok) {
      // status and body let callers show field or per-row errors.
      throw Object.assign(new Error((data as any)?.error ?? `HTTP ${res.status}`), { status: res.status, body: data });
    }
    return data as T;
  }
}

/** Downloads a college data export (CSV) and saves it in the browser. */
export async function downloadExport(dataset: 'users' | 'enrollments' | 'grades' | 'exam-results'): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/export/${dataset}`, { headers: await authHeaders(), credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error((data as any)?.error ?? `Export failed (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `learnit-${dataset}.csv`;
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ── Streaming chat (server-sent events) ─────────────────────────────────────

export interface ChatStreamHandlers {
  onMeta?(meta: {
    retrieval: 'none' | 'ok' | 'unavailable';
    sourceCount: number;
    /** Note names the answer drew on, for citations. */
    sources?: string[];
    /** True when the student's own marks and feedback informed the answer. */
    personalized?: boolean;
  }): void;
  onDelta(text: string): void;
  signal?: AbortSignal;
}

/**
 * POST /api/ai/chat/stream and dispatch its events. EventSource cannot send a
 * body or an Authorization header, so this reads the fetch body directly.
 * Resolves on `done`; rejects with the server's message on errors.
 */
export async function aiChatStream(
  body: { question: string; moduleTitle: string; moduleId: number | null; history: unknown[] },
  handlers: ChatStreamHandlers,
): Promise<{ model?: string }> {
  const res = await fetch(`${BASE}/api/ai/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(await authHeaders()) },
    body: JSON.stringify(body),
    credentials: 'include',
    signal: handlers.signal,
  });
  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok || !contentType.includes('text/event-stream') || !res.body) {
    const data = await res.json().catch(() => null);
    throw new Error((data as any)?.error ?? `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = 'message', data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      let payload: any = {};
      try { payload = data ? JSON.parse(data) : {}; } catch { continue; }
      if (event === 'meta') handlers.onMeta?.(payload);
      else if (event === 'delta' && typeof payload.text === 'string') handlers.onDelta(payload.text);
      else if (event === 'done') { await reader.cancel().catch(() => {}); return { model: payload.model }; }
      else if (event === 'error') throw new Error(payload.error ?? 'The AI assistant failed to answer.');
    }
  }
  throw new Error('The answer was interrupted. Please try again.');
}

// ── Multipart upload helper ─────────────────────────────────────────────────

async function uploadFile(path: string, fieldName: string, file: File): Promise<any> {
  const ah = await authHeaders();
  const form = new FormData();
  form.append(fieldName, file);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { ...ah },
    body: form,
    credentials: 'include',
  });
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    const text = await res.text();
    throw new Error(`[API] Expected JSON from ${BASE}${path} but got: ${text.slice(0, 120)}`);
  }
  const data = await res.json();
  if (!res.ok) throw new Error((data as any)?.error ?? `HTTP ${res.status}`);
  return data;
}

/**
 * Waits for a background job and returns its result. A response without a
 * jobId is already the result (a backend that ran the work in the request).
 * Polls every 1.5 s at first, backing off to 4 s; gives up after 3 minutes.
 */
export async function resultOfJob(started: unknown): Promise<any> {
  const jobId = (started as { jobId?: number } | null)?.jobId;
  if (!jobId) return started;
  const deadline = Date.now() + 3 * 60_000;
  for (let delay = 1_500; Date.now() < deadline; delay = Math.min(4_000, delay * 1.3)) {
    await new Promise(r => setTimeout(r, delay));
    const job = await request(`/api/jobs/${jobId}`) as { status: string; result?: unknown; error?: string | null };
    if (job.status === 'done') return job.result;
    if (job.status === 'failed') throw new Error(job.error || 'This took too long or failed. Please try again.');
  }
  throw new Error('Still working on it. Check back in a minute.');
}

/** Query string from defined, non-empty values. */
function toQuery(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  return q.toString();
}

/**
 * A page from a list endpoint. Accepts the older plain-array shape too, so the
 * site keeps working while the backend deploy catches up with the frontend.
 */
export function asPage<T>(data: unknown): { items: T[]; total: number; nextCursor: string | null } {
  if (Array.isArray(data)) return { items: data as T[], total: data.length, nextCursor: null };
  const d = (data ?? {}) as { items?: T[]; total?: number; nextCursor?: string | null };
  const items = Array.isArray(d.items) ? d.items : [];
  return { items, total: Number(d.total ?? items.length), nextCursor: d.nextCursor ?? null };
}

// ── Public API surface ──────────────────────────────────────────────────────────

export const api = {
  // Auth
  login: (email: string) =>
    request('/api/login', { method: 'POST', body: JSON.stringify({ email }) }),

  /** GET /api/auth/me — returns the current user's profile row */
  getMe: () => request('/api/auth/me'),

  // Courses
  getCourses: () => request('/api/courses'),
  getCourseModules: (courseId: number) => request(`/api/courses/${courseId}/modules`),
  createModule: (courseId: number, name: string, content: string) =>
    request(`/api/courses/${courseId}/modules`, { method: 'POST', body: JSON.stringify({ name, content }) }),

  // Modules
  getModuleMaterials: (moduleId: number) => request(`/api/modules/${moduleId}/materials`),
  uploadMaterial: (moduleId: number, title: string, type: string, size: string) =>
    request(`/api/modules/${moduleId}/materials`, { method: 'POST', body: JSON.stringify({ title, type, size }) }),
  getModuleAssignments: (moduleId: number) => request(`/api/modules/${moduleId}/assignments`),
  createAssignment: (moduleId: number, data: any) =>
    request(`/api/modules/${moduleId}/assignments`, { method: 'POST', body: JSON.stringify(data) }),
  deleteAssignment: (assignmentId: number) =>
    request(`/api/assignments/${assignmentId}`, { method: 'DELETE' }),

  // Notes
  getModuleNotes: (moduleId: number) => request(`/api/modules/${moduleId}/notes`),
  deleteNote: (noteId: number) => request(`/api/notes/${noteId}`, { method: 'DELETE' }),

  uploadNote: async (moduleId: number, file: File): Promise<any> => {
    const ah = await authHeaders();
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE}/api/modules/${moduleId}/notes`, {
      method: 'POST',
      headers: { ...ah },
      body: formData,
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    return res.json();
  },

  getNoteProxyUrl: (noteId: number): string => `${BASE}/api/notes/${noteId}/proxy`,

  getSignedNoteUrl: (noteId: number): Promise<{ url: string }> =>
    request(`/api/notes/${noteId}/signed-url`),

  // Submissions
  submitAssignment: (assignmentId: number, content: string) =>
    request('/api/submissions', {
      method: 'POST',
      body: JSON.stringify({ assignment_id: assignmentId, content }),
    }),

  uploadSubmission: async (assignmentId: number, files: File[], content = ''): Promise<any> => {
    const ah = await authHeaders();
    const formData = new FormData();
    formData.append('assignment_id', String(assignmentId));
    formData.append('content', content);
    files.forEach(f => formData.append('files', f));
    const res = await fetch(`${BASE}/api/submissions/upload`, {
      method: 'POST',
      headers: { ...ah },
      body: formData,
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    return res.json();
  },

  gradeSubmission: (submissionId: number, grade: number, feedback: string) =>
    request(`/api/submissions/${submissionId}/grade`, {
      method: 'POST',
      body: JSON.stringify({ grade, feedback }),
    }),
  getSubmissionFiles: (submissionId: number) =>
    request(`/api/submissions/${submissionId}/files`),
  getInstructorSubmissions: () => request('/api/instructor/submissions'),
  /** One page of the grading queue: { items, total, nextCursor }. */
  getSubmissionQueue: (opts: { status?: 'pending' | 'graded' | 'all'; courseId?: number; cursor?: string | null; limit?: number } = {}) =>
    request(`/api/instructor/submissions?${toQuery({ limit: opts.limit ?? 25, status: opts.status ?? 'pending', courseId: opts.courseId, cursor: opts.cursor })}`),

  // Student — all resolve the student from the JWT on the server side,
  // so the id param is kept for backwards compat with existing callers.
  getStudentCourses:    (studentId: number) => request(`/api/student/${studentId}/courses`),
  getStudentAssignments:(studentId: number) => request(`/api/student/${studentId}/assignments`),
  getStudentStats:      (studentId: number) => request(`/api/student/${studentId}/stats`),
  getStudentAnalytics:  (studentId: number) => request(`/api/students/${studentId}/analytics`),
  getStudentNotes:      (studentId: number) => request(`/api/students/${studentId}/notes`),
  // aggregated grading insights (strengths + improvements from ai_feedback)
  getStudentGradingInsights: (studentId: number) =>
    request(`/api/student/${studentId}/grading-insights`),

  // ── Departments (admin) ────────────────────────────────────────────────────
  getDepartments: () => request<Department[]>('/api/admin/departments'),
  createDepartment: (d: { code: string; name: string }) =>
    request<Department>('/api/admin/departments', { method: 'POST', body: JSON.stringify(d) }),
  updateDepartment: (id: number, d: { code?: string; name?: string }) =>
    request<Department>(`/api/admin/departments/${id}`, { method: 'PATCH', body: JSON.stringify(d) }),
  deleteDepartment: (id: number) => request(`/api/admin/departments/${id}`, { method: 'DELETE' }),
  /** Put a course in a department and semester (null clears). */
  setCoursePlacement: (courseId: number, p: { department_id?: number | null; semester?: number | null }) =>
    request(`/api/admin/courses/${courseId}/placement`, { method: 'PATCH', body: JSON.stringify(p) }),

  // ── Exam timetables (admin) ────────────────────────────────────────────────
  getTimetables: () => request<TimetableSummary[]>('/api/admin/timetables'),
  getTimetable: (id: number) => request<TimetableDetail>(`/api/admin/timetables/${id}`),
  uploadTimetable: async (file: File, title: string, assessmentType: AssessmentType): Promise<TimetableDetail> => {
    const form = new FormData();
    form.append('title', title);
    form.append('assessment_type', assessmentType);
    form.append('file', file);
    const res = await fetch(`${BASE}/api/admin/timetables`, { method: 'POST', headers: await authHeaders(), body: form, credentials: 'include' });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data as any)?.error ?? `Upload failed (HTTP ${res.status})`);
    return data as TimetableDetail;
  },
  getTimetableSource: (id: number) => request<{ url: string; kind: string; name: string }>(`/api/admin/timetables/${id}/source`),
  updateTimetableEntry: (id: number, entryId: number, patch: Record<string, unknown>) =>
    request<TimetableEntry>(`/api/admin/timetables/${id}/entries/${entryId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  addTimetableEntry: (id: number, entry: Record<string, unknown>) =>
    request<TimetableDetail>(`/api/admin/timetables/${id}/entries`, { method: 'POST', body: JSON.stringify(entry) }),
  deleteTimetableEntry: (id: number, entryId: number) =>
    request(`/api/admin/timetables/${id}/entries/${entryId}`, { method: 'DELETE' }),
  publishTimetable: (id: number) =>
    request<TimetableDetail & { result: { created: number; moved: number; professors: number; students: number } }>(`/api/admin/timetables/${id}/publish`, { method: 'POST' }),
  deleteTimetable: (id: number) => request(`/api/admin/timetables/${id}`, { method: 'DELETE' }),

  // ── Assessments (unit tests, model, end-semester…) — Instructor ────────────
  /** Create an assessment (a draft until published). */
  createUnitExam: (data: {
    course_id: number;
    title: string;
    assessment_type?: AssessmentType;
    exam_date?: string | null;
    max_marks?: number;
    internal_max?: number | null;
    external_max?: number | null;
    credits?: number | null;
    semester?: number | null;
    grading_schema?: { strong: number; moderate: number };
  }) => request<Assessment>('/api/unit-exams', { method: 'POST', body: JSON.stringify(data) }),

  /** Assessments the caller manages, optionally for one course or type. */
  listUnitExams: (filter: { course_id?: number; type?: AssessmentType } = {}) =>
    request<Assessment[]>(`/api/unit-exams${toQuery(filter)}`),

  /** List all unit exams for a course (instructor view). */
  listCourseExams: (courseId: number) =>
    request(`/api/unit-exams/course/${courseId}`),

  getUnitExam: (examId: number) =>
    request<Assessment>(`/api/unit-exams/${examId}`),

  /** Edit an assessment; entered marks are re-graded against the new settings. */
  updateUnitExam: (examId: number, data: Partial<Omit<Assessment, 'id'>>) =>
    request<Assessment>(`/api/unit-exams/${examId}`, { method: 'PATCH', body: JSON.stringify(data) }),

  /** Delete a draft assessment and its entered marks. */
  deleteUnitExam: (examId: number) =>
    request(`/api/unit-exams/${examId}`, { method: 'DELETE' }),

  /** Enrolled students with their current marks, for the marks grid. */
  getExamRoster: (examId: number) =>
    request<{ exam: Assessment; students: RosterStudent[]; grades: string[] }>(`/api/unit-exams/${examId}/roster`),

  /** Save marks (all or nothing). A blank, non-absent row clears that student. */
  saveExamResults: (examId: number, results: MarksEntry[]) =>
    request<{ saved: any[]; cleared: number[] }>(`/api/unit-exams/${examId}/results`, {
      method: 'PUT',
      body: JSON.stringify({ results }),
    }),

  /** Read a CSV/XLSX marks sheet and match it to the roster. Saves nothing. */
  previewExamMarks: (examId: number, file: File) =>
    uploadFile(`/api/unit-exams/${examId}/preview-marks`, 'file', file) as Promise<MarksPreview>,

  /** Release results to students (notifies them unless notify is false). */
  publishUnitExam: (examId: number, notify = true) =>
    request<Assessment>(`/api/unit-exams/${examId}/publish`, { method: 'POST', body: JSON.stringify({ notify }) }),

  unpublishUnitExam: (examId: number) =>
    request<Assessment>(`/api/unit-exams/${examId}/unpublish`, { method: 'POST' }),

  /** Get full analytics for an exam (stats + band distribution + student results). */
  getExamAnalytics: (examId: number) =>
    request(`/api/unit-exams/${examId}/analytics`),

  /** Upload exam paper PDF for AI topic analysis. */
  uploadExamPaper: (examId: number, file: File) =>
    uploadFile(`/api/unit-exams/${examId}/upload-paper`, 'file', file),

  // ── Unit Exams — Student ────────────────────────────────────────────────
  /** Get a student's unit exam insights (all exams, weak topics, trend). */
  getStudentExamInsights: (studentId: number) =>
    request<StudentMarks>(`/api/unit-exams/student/${studentId}/insights`),

  // Instructor
  /**
   * GET /api/instructor/courses — returns courses owned by the
   * authenticated instructor (resolved from JWT, no id param needed).
   */
  getInstructorCourses: () => request('/api/instructor/courses'),
  getCourseAnalytics: (courseId: number) =>
    request(`/api/instructor/courses/${courseId}/analytics`),
  createInstructorAssignment: (data: any) =>
    request('/api/instructor/assignments', { method: 'POST', body: JSON.stringify(data) }),

  // Admin
  getAdminUsers:    () => request('/api/admin/users'),
  /** One page of college users: { items, total }. */
  getAdminUsersPage: (opts: { q?: string; role?: string; limit?: number; offset?: number } = {}) =>
    request(`/api/admin/users?${toQuery({ limit: opts.limit ?? 50, offset: opts.offset, q: opts.q, role: opts.role })}`),
  getUserRoleCounts: () => request('/api/admin/users/role-counts'),
  getAdminStats:    () => request('/api/admin/stats'),
  getAdminSettings: () => request('/api/admin/settings'),
  saveAdminSetting: (key: string, value: string) =>
    request('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key, value }) }),
  createAdminUser:  (data: any) =>
    request('/api/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  getAiUsage: (days = 30) => request(`/api/admin/ai-usage?days=${days}`),
  /** One page of the college audit log: { total, limit, offset, rows }. */
  getAuditLogs: (opts: { action?: string; since?: string; until?: string; limit?: number; offset?: number } = {}) =>
    request(`/api/admin/audit-logs?${toQuery({ limit: opts.limit ?? 50, offset: opts.offset, action: opts.action, since: opts.since, until: opts.until })}`),
  previewUserImport: (file: File) => uploadFile('/api/admin/users/import/preview', 'file', file),
  commitUserImport: (mode: 'invite' | 'temp_password', rows: unknown[]) =>
    request('/api/admin/users/import/commit', { method: 'POST', body: JSON.stringify({ mode, rows }) }),
  resendUserInvites: (emails: string[]) =>
    request('/api/admin/users/import/resend-invites', { method: 'POST', body: JSON.stringify({ emails }) }),
  updateAdminUser:  (userId: number, data: any) =>
    request(`/api/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify(data) }),
  createUser:       (data: any) =>
    request('/api/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser:       (userId: number, data: any) =>
    request(`/api/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify(data) }),
  getAdminCourses:  () => request('/api/admin/courses'),
  createAdminCourse:(data: any) =>
    request('/api/admin/courses', { method: 'POST', body: JSON.stringify(data) }),
  deleteAdminCourse:(courseId: number) =>
    request(`/api/admin/courses/${courseId}`, { method: 'DELETE' }),
  getAdminEnrollments: (courseId: number) =>
    request(`/api/admin/enrollments/${courseId}`),
  enrollStudent: ({ course_id, student_id }: { course_id: number; student_id: number }) =>
    request('/api/admin/enrollments', {
      method: 'POST',
      body: JSON.stringify({ course_id, student_id }),
    }),
  bulkEnrollStudents: ({ course_id, emails }: { course_id: number; emails: string[] }) =>
    request('/api/admin/bulk-enroll', {
      method: 'POST',
      body: JSON.stringify({ course_id, emails }),
    }),
  removeEnrollment: (enrollmentId: number) =>
    request(`/api/admin/enrollments/${enrollmentId}`, { method: 'DELETE' }),
  getEnrollments: (courseId: number) =>
    request(`/api/admin/enrollments/${courseId}`),
  addEnrollment: (courseId: number, studentId: number) =>
    request('/api/admin/enrollments', {
      method: 'POST',
      body: JSON.stringify({ course_id: courseId, student_id: studentId }),
    }),
  bulkEnroll: (courseId: number, emails: string[]) =>
    request('/api/admin/bulk-enroll', {
      method: 'POST',
      body: JSON.stringify({ course_id: courseId, emails }),
    }),

  // AI
  aiGrade: (submissionContent: string, rubric: string) =>
    request('/api/ai/grade', { method: 'POST', body: JSON.stringify({ submissionContent, rubric }) }),
  /** Queued AI grading draft; resolves with the draft once the job finishes. */
  aiGradePdf: (submissionId: number, rubric: string, moduleId?: number) =>
    request('/api/ai/grade-pdf?async=1', { method: 'POST', body: JSON.stringify({ submission_id: submissionId, rubric, module_id: moduleId }) })
      .then(resultOfJob),
  aiChat: (question: string, moduleTitle: string, moduleId: number | null, history: any[]) =>
    request('/api/ai/chat', { method: 'POST', body: JSON.stringify({ question, moduleTitle, moduleId, history }) }),
  aiAnalyticsSummary: (analytics: StudentAnalyticsData) =>
    request('/api/ai/analytics-summary', { method: 'POST', body: JSON.stringify({ analytics }) }),
  aiClassOverviewSummary: (overview: ClassOverviewData) =>
    request('/api/ai/class-overview-summary', { method: 'POST', body: JSON.stringify({ overview }) }),

  // Roadmaps
  getRoadmap:          (courseId: number) => request(`/api/roadmaps/${courseId}`),
  generateRoadmap:     (courseId: number) =>
    request(`/api/roadmaps/${courseId}/generate?async=1`, { method: 'POST' }).then(resultOfJob),
  updateMilestoneStatus: (milestoneId: number, status: 'pending' | 'in_progress' | 'completed') =>
    request(`/api/roadmaps/milestones/${milestoneId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  deleteRoadmap: (courseId: number) =>
    request(`/api/roadmaps/${courseId}`, { method: 'DELETE' }),

  // Health (public)
  health: () => request('/api/health'),
};
