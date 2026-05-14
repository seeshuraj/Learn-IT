import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { ClipboardCopy, CheckCheck } from 'lucide-react';

interface Course {
  id: number;
  code: string;
  name: string;
  instructor_name: string;
  enrollment_count: number;
}

interface Enrollment {
  id: number;
  student_id: number;
  name: string;
  email: string;
  year: number | null;
  major: string | null;
  enrolled_at: string;
}

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
}

interface TempCredential {
  email: string;
  tempPassword: string;
  name?: string;
}

export default function AdminCourseManagement() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [bulkEmails, setBulkEmails] = useState('');
  const [enrollStudentId, setEnrollStudentId] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [newCourse, setNewCourse] = useState({ code: '', name: '', instructor_id: '' });
  // Temp credentials returned from bulk enroll
  const [tempCredentials, setTempCredentials] = useState<TempCredential[]>([]);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [coursesData, usersData]: any[] = await Promise.all([
        api.getAdminCourses(),
        api.getAdminUsers(),
      ]);
      setCourses(Array.isArray(coursesData) ? coursesData : []);
      setUsers(Array.isArray(usersData) ? usersData : []);
    } finally {
      setLoading(false);
    }
  }

  async function loadEnrollments(courseId: number) {
    const data: any = await api.getAdminEnrollments(courseId);
    setEnrollments(Array.isArray(data) ? data : []);
  }

  async function openEnrollModal(course: Course) {
    setSelectedCourse(course);
    setShowEnrollModal(true);
    setError(''); setSuccess('');
    setBulkEmails(''); setEnrollStudentId('');
    setTempCredentials([]);
    await loadEnrollments(course.id);
  }

  async function handleEnrollSingle() {
    if (!selectedCourse || !enrollStudentId) return;
    setEnrolling(true); setError(''); setSuccess('');
    try {
      await api.enrollStudent({ course_id: selectedCourse.id, student_id: Number(enrollStudentId) });
      setSuccess('Student enrolled.');
      setEnrollStudentId('');
      await loadEnrollments(selectedCourse.id);
      await loadData();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEnrolling(false);
    }
  }

  async function handleBulkEnroll() {
    if (!selectedCourse || !bulkEmails.trim()) return;
    setEnrolling(true); setError(''); setSuccess(''); setTempCredentials([]);
    try {
      const emails = bulkEmails.split('\n').map(e => e.trim()).filter(Boolean);
      const data: any = await api.bulkEnrollStudents({ course_id: selectedCourse.id, emails });
      const creds: TempCredential[] = Array.isArray(data.credentials) ? data.credentials
        : Array.isArray(data.temp_passwords) ? data.temp_passwords
        : [];
      setTempCredentials(creds);
      setSuccess(`Enrolled ${data.enrolled ?? emails.length} student(s).${
        creds.length > 0 ? ' Temporary passwords generated — copy them now.' : ''
      }`);
      setBulkEmails('');
      await loadEnrollments(selectedCourse.id);
      await loadData();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEnrolling(false);
    }
  }

  async function handleRemoveEnrollment(enrollmentId: number) {
    if (!selectedCourse) return;
    try {
      await api.removeEnrollment(enrollmentId);
      await loadEnrollments(selectedCourse.id);
      await loadData();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleCreateCourse() {
    setError(''); setSuccess('');
    try {
      await api.createAdminCourse({
        code: newCourse.code,
        name: newCourse.name,
        instructor_id: Number(newCourse.instructor_id),
      });
      setSuccess('Course created.');
      setNewCourse({ code: '', name: '', instructor_id: '' });
      setShowCreateModal(false);
      await loadData();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleDeleteCourse(courseId: number) {
    if (!confirm('Delete this course and all its enrollments?')) return;
    try {
      await api.deleteAdminCourse(courseId);
      await loadData();
    } catch (e: any) {
      setError(e.message);
    }
  }

  function copyAll() {
    const text = tempCredentials.map(c => `${c.email}\t${c.tempPassword}`).join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
  }

  function copySingle(email: string, pwd: string) {
    navigator.clipboard.writeText(`${email}\t${pwd}`).catch(() => {});
    setCopiedEmail(email);
    setTimeout(() => setCopiedEmail(null), 2000);
  }

  const instructors = users.filter(u => u.role === 'instructor');

  if (loading) return <div className="p-8 text-slate-500">Loading courses...</div>;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-slate-900">Course Management</h1>
          <p className="text-slate-500 mt-1">Create, manage and enrol students in courses.</p>
        </div>
        <button
          onClick={() => { setShowCreateModal(true); setError(''); setSuccess(''); }}
          className="px-5 py-2.5 bg-indigo-600 text-white rounded-2xl text-sm font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20"
        >
          + New Course
        </button>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">{error}</div>}
      {success && <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-sm">{success}</div>}

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              {['Code','Name','Instructor','Students','Actions'].map(h => (
                <th key={h} className="text-left px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {courses.map(course => (
              <tr key={course.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4 font-mono text-xs font-bold text-indigo-600">{course.code}</td>
                <td className="px-6 py-4 text-sm font-semibold text-slate-900">{course.name}</td>
                <td className="px-6 py-4 text-sm text-slate-500">{course.instructor_name || '—'}</td>
                <td className="px-6 py-4 text-sm text-slate-500">{course.enrollment_count}</td>
                <td className="px-6 py-4 flex gap-2">
                  <button onClick={() => openEnrollModal(course)} className="px-3 py-1.5 text-xs bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 font-bold transition-colors">Manage</button>
                  <button onClick={() => handleDeleteCourse(course.id)} className="px-3 py-1.5 text-xs bg-red-50 text-red-700 rounded-lg hover:bg-red-100 font-bold transition-colors">Delete</button>
                </td>
              </tr>
            ))}
            {courses.length === 0 && (
              <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-400 text-sm">No courses yet. Create one to get started.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Enroll Modal */}
      {showEnrollModal && selectedCourse && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Manage Enrollments — {selectedCourse.name}</h2>
              <button onClick={() => { setShowEnrollModal(false); setTempCredentials([]); }} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-6">
              {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">{error}</div>}
              {success && <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-sm">{success}</div>}

              {/* Temp credentials table */}
              {tempCredentials.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-amber-800 uppercase tracking-wider">
                      ⚠️ Temporary Passwords — Share with students and ask them to change on first login
                    </p>
                    <button
                      onClick={copyAll}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors"
                    >
                      <ClipboardCopy className="w-3 h-3" /> Copy All
                    </button>
                  </div>
                  <div className="rounded-xl overflow-hidden border border-amber-200">
                    <table className="w-full text-xs">
                      <thead className="bg-amber-100">
                        <tr>
                          <th className="text-left px-3 py-2 text-amber-700 font-bold">Email</th>
                          {tempCredentials[0]?.name !== undefined && (
                            <th className="text-left px-3 py-2 text-amber-700 font-bold">Name</th>
                          )}
                          <th className="text-left px-3 py-2 text-amber-700 font-bold">Temp Password</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-100 bg-white">
                        {tempCredentials.map(c => (
                          <tr key={c.email}>
                            <td className="px-3 py-2 font-mono text-slate-700">{c.email}</td>
                            {c.name !== undefined && <td className="px-3 py-2 text-slate-600">{c.name}</td>}
                            <td className="px-3 py-2 font-mono font-bold text-indigo-700">{c.tempPassword}</td>
                            <td className="px-3 py-2 text-right">
                              <button
                                onClick={() => copySingle(c.email, c.tempPassword)}
                                className="text-amber-600 hover:text-amber-800 transition"
                                title="Copy row"
                              >
                                {copiedEmail === c.email
                                  ? <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                                  : <ClipboardCopy className="w-3.5 h-3.5" />}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div>
                <h3 className="font-bold text-slate-700 mb-2">Enroll by Student ID</h3>
                <div className="flex gap-2">
                  <input type="number" placeholder="Student ID" value={enrollStudentId} onChange={e => setEnrollStudentId(e.target.value)} className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  <button onClick={handleEnrollSingle} disabled={enrolling} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 disabled:opacity-50">Enroll</button>
                </div>
              </div>
              <div>
                <h3 className="font-bold text-slate-700 mb-2">Bulk Enroll by Email</h3>
                <p className="text-xs text-slate-400 mb-2">New accounts are auto-created with a temporary password shown above after enrolling.</p>
                <textarea placeholder="One email per line" value={bulkEmails} onChange={e => setBulkEmails(e.target.value)} rows={4} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                <button onClick={handleBulkEnroll} disabled={enrolling} className="mt-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 disabled:opacity-50">Bulk Enroll</button>
              </div>
              <div>
                <h3 className="font-bold text-slate-700 mb-2">Enrolled Students ({enrollments.length})</h3>
                {enrollments.length === 0 ? (
                  <p className="text-slate-400 text-sm">No students enrolled yet.</p>
                ) : (
                  <table className="w-full text-sm border border-slate-100 rounded-xl overflow-hidden">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        {['Name','Email','Enrolled',''].map(h => <th key={h} className="text-left px-3 py-2 text-xs font-bold text-slate-400 uppercase">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {enrollments.map(e => (
                        <tr key={e.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                          <td className="px-3 py-2">{e.name}</td>
                          <td className="px-3 py-2 text-slate-400">{e.email}</td>
                          <td className="px-3 py-2 text-slate-400">{new Date(e.enrolled_at).toLocaleDateString()}</td>
                          <td className="px-3 py-2"><button onClick={() => handleRemoveEnrollment(e.id)} className="text-red-500 hover:text-red-700 text-xs font-bold">Remove</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Course Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Create New Course</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">{error}</div>}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Course Code</label>
                <input type="text" placeholder="e.g. CS101" value={newCourse.code} onChange={e => setNewCourse(p => ({ ...p, code: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Course Name</label>
                <input type="text" placeholder="e.g. Introduction to Computer Science" value={newCourse.name} onChange={e => setNewCourse(p => ({ ...p, name: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Instructor</label>
                <select value={newCourse.instructor_id} onChange={e => setNewCourse(p => ({ ...p, instructor_id: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
                  <option value="">Select instructor</option>
                  {instructors.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={handleCreateCourse} className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700">Create Course</button>
                <button onClick={() => setShowCreateModal(false)} className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-200">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
