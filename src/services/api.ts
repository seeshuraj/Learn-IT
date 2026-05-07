// Centralised API client — reads VITE_API_BASE_URL at build time.
// In dev, this is empty string so requests go to localhost:5173 → proxied to :3000 by Vite.
// In production (Vercel), this is "https://learnit-api.onrender.com".

const BASE = (import.meta as any).env?.VITE_API_BASE_URL ?? '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
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
  login: (email: string) =>
    request<any>('/api/login', { method: 'POST', body: JSON.stringify({ email }) }),

  // Courses
  getCourses: () => request<any[]>('/api/courses'),
  getCourseModules: (courseId: number) => request<any[]>(`/api/courses/${courseId}/modules`),
  createModule: (courseId: number, name: string, content: string) =>
    request<any>(`/api/courses/${courseId}/modules`, { method: 'POST', body: JSON.stringify({ name, content }) }),

  // Modules
  getModuleMaterials: (moduleId: number) => request<any[]>(`/api/modules/${moduleId}/materials`),
  uploadMaterial: (moduleId: number, title: string, type: string, size: string) =>
    request<any>(`/api/modules/${moduleId}/materials`, { method: 'POST', body: JSON.stringify({ title, type, size }) }),
  getModuleAssignments: (moduleId: number) => request<any[]>(`/api/modules/${moduleId}/assignments`),
  createAssignment: (moduleId: number, data: any) =>
    request<any>(`/api/modules/${moduleId}/assignments`, { method: 'POST', body: JSON.stringify(data) }),

  // Submissions
  submitAssignment: (assignmentId: number, studentId: number, content: string) =>
    request<any>('/api/submissions', { method: 'POST', body: JSON.stringify({ assignment_id: assignmentId, student_id: studentId, content }) }),
  gradeSubmission: (submissionId: number, grade: number, feedback: string) =>
    request<any>(`/api/submissions/${submissionId}/grade`, { method: 'POST', body: JSON.stringify({ grade, feedback }) }),
  getInstructorSubmissions: () => request<any[]>('/api/instructor/submissions'),

  // Student
  getStudentCourses: (studentId: number) => request<any[]>(`/api/student/${studentId}/courses`),
  getStudentAssignments: (studentId: number) => request<any[]>(`/api/student/${studentId}/assignments`),
  getStudentStats: (studentId: number) => request<any>(`/api/student/${studentId}/stats`),

  // Instructor
  getInstructorCourses: (instructorId: number) => request<any[]>(`/api/instructor/${instructorId}/courses`),
  getInstructorModules: (instructorId: number) => request<any[]>(`/api/instructor/${instructorId}/modules`),
  getCourseAnalytics: (courseId: number) => request<any>(`/api/instructor/courses/${courseId}/analytics`),
  createInstructorAssignment: (data: any) =>
    request<any>('/api/instructor/assignments', { method: 'POST', body: JSON.stringify(data) }),

  // Admin
  getAdminUsers: () => request<any[]>('/api/admin/users'),
  createUser: (data: any) =>
    request<any>('/api/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (userId: number, data: any) =>
    request<any>(`/api/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify(data) }),
  getAdminStats: () => request<any>('/api/admin/stats'),
  getAdminSettings: () => request<any[]>('/api/admin/settings'),
  saveAdminSetting: (key: string, value: string) =>
    request<any>('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key, value }) }),
  createAdminCourse: (data: any) =>
    request<any>('/api/admin/courses', { method: 'POST', body: JSON.stringify(data) }),

  // AI (all AI calls go through backend — NVIDIA key never in browser)
  aiGrade: (submissionContent: string, rubric: string) =>
    request<any>('/api/ai/grade', { method: 'POST', body: JSON.stringify({ submissionContent, rubric }) }),
  aiChat: (question: string, moduleTitle: string, notesContext: string, history: any[]) =>
    request<any>('/api/ai/chat', { method: 'POST', body: JSON.stringify({ question, moduleTitle, notesContext, history }) }),
  aiAnalyticsSummary: (data: any) =>
    request<any>('/api/ai/analytics-summary', { method: 'POST', body: JSON.stringify(data) }),

  // Health
  health: () => request<any>('/api/health'),
};
