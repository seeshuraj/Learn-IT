// Centralised API client — reads VITE_API_BASE_URL at build time.
// In dev, this is empty string so requests go to localhost:5173 → proxied to :3000 by Vite.
// In production (Vercel), this is "https://learnit-api.onrender.com".
const BASE = (import.meta as any).env?.VITE_API_BASE_URL ?? '';

async function request<T = any>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
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

export const api = {
  // Auth
  login: (email: string) => request('/api/login', { method: 'POST', body: JSON.stringify({ email }) }),

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
  getModuleNotes: (moduleId: number, studentId?: number) => {
    const qs = studentId ? `?student_id=${studentId}` : '';
    return request(`/api/modules/${moduleId}/notes${qs}`);
  },
  deleteNote: (noteId: number) => request(`/api/notes/${noteId}`, { method: 'DELETE' }),
  /** Upload a note file (multipart/form-data) — no Content-Type header so browser sets boundary */
  uploadNote: (moduleId: number, file: File): Promise<any> => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch(`${BASE}/api/modules/${moduleId}/notes`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    }).then(async res => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    });
  },
  /** Returns the backend proxy URL for a note — always works regardless of Cloudinary ACL */
  getNoteProxyUrl: (noteId: number): string => `${BASE}/api/notes/${noteId}/proxy`,

  // Submissions
  submitAssignment: (assignmentId: number, studentId: number, content: string) =>
    request('/api/submissions', { method: 'POST', body: JSON.stringify({ assignment_id: assignmentId, student_id: studentId, content }) }),
  gradeSubmission: (submissionId: number, grade: number, feedback: string) =>
    request(`/api/submissions/${submissionId}/grade`, { method: 'POST', body: JSON.stringify({ grade, feedback }) }),
  getInstructorSubmissions: () => request('/api/instructor/submissions'),

  // Student
  getStudentCourses: (studentId: number) => request(`/api/student/${studentId}/courses`),
  getStudentAssignments: (studentId: number) => request(`/api/student/${studentId}/assignments`),
  getStudentStats: (studentId: number) => request(`/api/student/${studentId}/stats`),
  getStudentAnalytics: (studentId: number) => request(`/api/students/${studentId}/analytics`),
  getStudentNotes: (studentId: number) => request(`/api/students/${studentId}/notes`),

  // Instructor
  getInstructorCourses: (instructorId: number) => request(`/api/instructor/${instructorId}/courses`),
  getCourseAnalytics: (courseId: number) => request(`/api/instructor/courses/${courseId}/analytics`),
  createInstructorAssignment: (data: any) =>
    request('/api/instructor/assignments', { method: 'POST', body: JSON.stringify(data) }),

  // Admin
  getAdminUsers: () => request('/api/admin/users'),
  createUser: (data: any) => request('/api/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (userId: number, data: any) => request(`/api/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify(data) }),
  getAdminStats: () => request('/api/admin/stats'),
  getAdminSettings: () => request('/api/admin/settings'),
  saveAdminSetting: (key: string, value: string) =>
    request('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key, value }) }),
  createAdminCourse: (data: any) =>
    request('/api/admin/courses', { method: 'POST', body: JSON.stringify(data) }),
  getEnrollments: (courseId: number) => request(`/api/admin/enrollments/${courseId}`),
  addEnrollment: (courseId: number, studentId: number) =>
    request('/api/admin/enrollments', { method: 'POST', body: JSON.stringify({ course_id: courseId, student_id: studentId }) }),
  removeEnrollment: (enrollmentId: number) =>
    request(`/api/admin/enrollments/${enrollmentId}`, { method: 'DELETE' }),
  bulkEnroll: (courseId: number, emails: string[]) =>
    request('/api/admin/bulk-enroll', { method: 'POST', body: JSON.stringify({ course_id: courseId, emails }) }),

  // AI — all calls go through backend so NVIDIA_API_KEY stays server-side
  aiGrade: (submissionContent: string, rubric: string) =>
    request('/api/ai/grade', { method: 'POST', body: JSON.stringify({ submissionContent, rubric }) }),
  aiGradePdf: (submissionId: number, rubric: string, moduleId?: number) =>
    request('/api/ai/grade-pdf', { method: 'POST', body: JSON.stringify({ submission_id: submissionId, rubric, module_id: moduleId }) }),
  aiChat: (question: string, moduleTitle: string, moduleId: number | null, history: any[]) =>
    request('/api/ai/chat', { method: 'POST', body: JSON.stringify({ question, moduleTitle, moduleId, history }) }),
  aiAnalyticsSummary: (analytics: any) =>
    request('/api/ai/analytics-summary', { method: 'POST', body: JSON.stringify({ analytics }) }),

  // Health
  health: () => request('/api/health'),
};
