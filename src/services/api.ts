/**
 * api.ts — Centralised API client.
 *
 * Every request (except multipart uploads) goes through `request()` which
 * automatically injects `Authorization: Bearer <token>` from the active
 * Supabase session. Multipart helpers do the same via `authHeaders()`.
 *
 * In dev, BASE is empty so Vite proxies :5173 → :3000.
 * In production (Vercel), set VITE_API_BASE_URL to your Render/Railway URL.
 */
import { supabase, getAccessToken } from './supabaseClient';

const BASE = (import.meta as any).env?.VITE_API_BASE_URL ?? '';

// ── Auth helpers ─────────────────────────────────────────────────────────────

/** Returns { Authorization: 'Bearer <token>' } or {} if not signed in. */
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  console.log('AUTH_TOKEN_PRESENT', !!token, token?.slice(0, 20));
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Sign in with Supabase (email + password). Returns { user, session }. */
export async function supabaseSignIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data;
}

/** Sign out of Supabase and clear the stored session. */
export async function supabaseSignOut() {
  await supabase.auth.signOut();
}

// ── Core fetch wrapper ───────────────────────────────────────────────────────

async function request<T = any>(path: string, options?: RequestInit): Promise<T> {
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
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Public API surface ───────────────────────────────────────────────────────

export const api = {
  // Auth — login still hits our Express endpoint to get the legacy user record.
  // The caller is responsible for calling supabaseSignIn() FIRST so a valid
  // Supabase session exists before this request is made.
  login: (email: string) =>
    request('/api/login', { method: 'POST', body: JSON.stringify({ email }) }),

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

  /** Upload a note file (multipart/form-data) — no Content-Type so browser sets boundary */
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

  /** Returns the backend proxy URL for a note (no auth needed here — it's just a URL string). */
  getNoteProxyUrl: (noteId: number): string => `${BASE}/api/notes/${noteId}/proxy`,

  // Submissions
  // student_id is NOT sent — the server resolves it from req.auth (JWT).
  submitAssignment: (assignmentId: number, content: string) =>
    request('/api/submissions', {
      method: 'POST',
      body: JSON.stringify({ assignment_id: assignmentId, content }),
    }),

  /** Upload assignment files (multipart). student_id resolved server-side. */
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

  // Student
  getStudentCourses:    (studentId: number) => request(`/api/student/${studentId}/courses`),
  getStudentAssignments:(studentId: number) => request(`/api/student/${studentId}/assignments`),
  getStudentStats:      (studentId: number) => request(`/api/student/${studentId}/stats`),
  getStudentAnalytics:  (studentId: number) => request(`/api/students/${studentId}/analytics`),
  getStudentNotes:      (studentId: number) => request(`/api/students/${studentId}/notes`),

  // Instructor
  getInstructorCourses: (instructorId: number) =>
    request(`/api/instructor/${instructorId}/courses`),
  getCourseAnalytics: (courseId: number) =>
    request(`/api/instructor/courses/${courseId}/analytics`),
  createInstructorAssignment: (data: any) =>
    request('/api/instructor/assignments', { method: 'POST', body: JSON.stringify(data) }),

  // Admin
  getAdminUsers:   () => request('/api/admin/users'),
  createUser:      (data: any) =>
    request('/api/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser:      (userId: number, data: any) =>
    request(`/api/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify(data) }),
  getAdminStats:   () => request('/api/admin/stats'),
  getAdminSettings: () => request('/api/admin/settings'),
  saveAdminSetting: (key: string, value: string) =>
    request('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key, value }) }),
  createAdminCourse: (data: any) =>
    request('/api/admin/courses', { method: 'POST', body: JSON.stringify(data) }),
  deleteAdminCourse: (courseId: number) =>
    request(`/api/admin/courses/${courseId}`, { method: 'DELETE' }),
  getEnrollments:  (courseId: number) =>
    request(`/api/admin/enrollments/${courseId}`),
  addEnrollment:   (courseId: number, studentId: number) =>
    request('/api/admin/enrollments', {
      method: 'POST',
      body: JSON.stringify({ course_id: courseId, student_id: studentId }),
    }),
  removeEnrollment: (enrollmentId: number) =>
    request(`/api/admin/enrollments/${enrollmentId}`, { method: 'DELETE' }),
  bulkEnroll: (courseId: number, emails: string[]) =>
    request('/api/admin/bulk-enroll', {
      method: 'POST',
      body: JSON.stringify({ course_id: courseId, emails }),
    }),

  // AI — all calls go through backend so NVIDIA_API_KEY stays server-side
  aiGrade: (submissionContent: string, rubric: string) =>
    request('/api/ai/grade', { method: 'POST', body: JSON.stringify({ submissionContent, rubric }) }),
  aiGradePdf: (submissionId: number, rubric: string, moduleId?: number) =>
    request('/api/ai/grade-pdf', { method: 'POST', body: JSON.stringify({ submission_id: submissionId, rubric, module_id: moduleId }) }),
  aiChat: (question: string, moduleTitle: string, moduleId: number | null, history: any[]) =>
    request('/api/ai/chat', { method: 'POST', body: JSON.stringify({ question, moduleTitle, moduleId, history }) }),
  aiAnalyticsSummary: (analytics: any) =>
    request('/api/ai/analytics-summary', { method: 'POST', body: JSON.stringify({ analytics }) }),

  // Health (public)
  health: () => request('/api/health'),
};
