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

const BASE =
  (import.meta as any).env?.VITE_API_BASE_URL ||
  'https://learn-it-3f5h.onrender.com'; // production fallback — never empty

// ── Auth helpers ─────────────────────────────────────────────────────────────

/** Returns { Authorization: 'Bearer <token>' } or {} if not signed in. */
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  console.log('AUTH_TOKEN_PRESENT', !!token, token?.slice(0, 20));
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

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const preview = await res.text();
    throw new Error(
      `[API] Expected JSON from ${BASE}${path} but got: ${preview.slice(0, 120)}`
    );
  }

  const data = await res.json();
  if (!res.ok) throw new Error((data as any)?.error ?? `HTTP ${res.status}`);
  return data as T;
}

// ── Public API surface ──────────────────────────────────────────────────────────

export const api = {
  // Auth
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

  // Student
  getStudentCourses:    (studentId: number) => request(`/api/student/${studentId}/courses`),
  getStudentAssignments:(studentId: number) => request(`/api/student/${studentId}/assignments`),
  getStudentStats:      (studentId: number) => request(`/api/student/${studentId}/stats`),
  getStudentAnalytics:  (studentId: number) => request(`/api/students/${studentId}/analytics`),
  getStudentNotes:      (studentId: number) => request(`/api/students/${studentId}/notes`),
  // NEW: aggregated grading insights (strengths + improvements from ai_feedback)
  getStudentGradingInsights: (studentId: number) =>
    request(`/api/student/${studentId}/grading-insights`),

  // Instructor
  getInstructorCourses: (instructorId: number) =>
    request(`/api/instructor/${instructorId}/courses`),
  getCourseAnalytics: (courseId: number) =>
    request(`/api/instructor/courses/${courseId}/analytics`),
  createInstructorAssignment: (data: any) =>
    request('/api/instructor/assignments', { method: 'POST', body: JSON.stringify(data) }),

  // Admin
  getAdminUsers:    () => request('/api/admin/users'),
  getAdminStats:    () => request('/api/admin/stats'),
  getAdminSettings: () => request('/api/admin/settings'),
  saveAdminSetting: (key: string, value: string) =>
    request('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key, value }) }),
  createAdminUser:  (data: any) =>
    request('/api/admin/users', { method: 'POST', body: JSON.stringify(data) }),
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
  aiGradePdf: (submissionId: number, rubric: string, moduleId?: number) =>
    request('/api/ai/grade-pdf', { method: 'POST', body: JSON.stringify({ submission_id: submissionId, rubric, module_id: moduleId }) }),
  aiChat: (question: string, moduleTitle: string, moduleId: number | null, history: any[]) =>
    request('/api/ai/chat', { method: 'POST', body: JSON.stringify({ question, moduleTitle, moduleId, history }) }),
  aiAnalyticsSummary: (analytics: any) =>
    request('/api/ai/analytics-summary', { method: 'POST', body: JSON.stringify({ analytics }) }),

  // Roadmaps (P3-3)
  getRoadmap:          (courseId: number) => request(`/api/roadmaps/${courseId}`),
  generateRoadmap:     (courseId: number) =>
    request(`/api/roadmaps/${courseId}/generate`, { method: 'POST' }),
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
