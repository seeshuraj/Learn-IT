import { useEffect, useState } from 'react';

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

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

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

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [coursesRes, usersRes] = await Promise.all([
        fetch(`${API}/api/courses`),
        fetch(`${API}/api/admin/users`),
      ]);
      const coursesData = await coursesRes.json();
      const usersData = await usersRes.json();
      setCourses(coursesData);
      setUsers(usersData);
    } finally {
      setLoading(false);
    }
  }

  async function loadEnrollments(courseId: number) {
    const res = await fetch(`${API}/api/admin/enrollments/${courseId}`);
    const data = await res.json();
    setEnrollments(data);
  }

  async function openEnrollModal(course: Course) {
    setSelectedCourse(course);
    setShowEnrollModal(true);
    setError(''); setSuccess('');
    setBulkEmails(''); setEnrollStudentId('');
    await loadEnrollments(course.id);
  }

  async function handleEnrollSingle() {
    if (!selectedCourse || !enrollStudentId) return;
    setEnrolling(true); setError(''); setSuccess('');
    try {
      const res = await fetch(`${API}/api/admin/enrollments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course_id: selectedCourse.id, student_id: Number(enrollStudentId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
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
    setEnrolling(true); setError(''); setSuccess('');
    try {
      const emails = bulkEmails.split('\n').map(e => e.trim()).filter(Boolean);
      const res = await fetch(`${API}/api/admin/enrollments/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course_id: selectedCourse.id, emails }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess(`Enrolled ${data.enrolled} student(s).`);
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
      const res = await fetch(`${API}/api/admin/enrollments/${enrollmentId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove enrollment');
      await loadEnrollments(selectedCourse.id);
      await loadData();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleCreateCourse() {
    setError(''); setSuccess('');
    try {
      const res = await fetch(`${API}/api/admin/courses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: newCourse.code,
          name: newCourse.name,
          instructor_id: Number(newCourse.instructor_id),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
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
      const res = await fetch(`${API}/api/admin/courses/${courseId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete course');
      await loadData();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const instructors = users.filter(u => u.role === 'instructor');

  if (loading) return <div className="p-8 text-center text-gray-500">Loading courses...</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Course Management</h1>
        <button
          onClick={() => { setShowCreateModal(true); setError(''); setSuccess(''); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          + New Course
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg">{success}</div>}

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Code</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Instructor</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Students</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {courses.map(course => (
              <tr key={course.id} className="border-b hover:bg-gray-50">
                <td className="px-4 py-3 font-mono font-medium text-blue-700">{course.code}</td>
                <td className="px-4 py-3">{course.name}</td>
                <td className="px-4 py-3 text-gray-600">{course.instructor_name || '—'}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    {course.enrollment_count}
                  </span>
                </td>
                <td className="px-4 py-3 flex gap-2">
                  <button
                    onClick={() => openEnrollModal(course)}
                    className="px-3 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100 font-medium"
                  >
                    Manage
                  </button>
                  <button
                    onClick={() => handleDeleteCourse(course.id)}
                    className="px-3 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100 font-medium"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {courses.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No courses yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Enroll Modal */}
      {showEnrollModal && selectedCourse && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b flex items-center justify-between">
              <h2 className="text-lg font-bold">Manage Enrollments — {selectedCourse.name}</h2>
              <button onClick={() => setShowEnrollModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
            </div>
            <div className="p-6 space-y-6">
              {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
              {success && <div className="p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{success}</div>}

              <div>
                <h3 className="font-semibold text-gray-700 mb-2">Enroll by Student ID</h3>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="Student ID"
                    value={enrollStudentId}
                    onChange={e => setEnrollStudentId(e.target.value)}
                    className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  <button
                    onClick={handleEnrollSingle}
                    disabled={enrolling}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    Enroll
                  </button>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-gray-700 mb-2">Bulk Enroll by Email</h3>
                <textarea
                  placeholder="One email per line"
                  value={bulkEmails}
                  onChange={e => setBulkEmails(e.target.value)}
                  rows={4}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
                <button
                  onClick={handleBulkEnroll}
                  disabled={enrolling}
                  className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  Bulk Enroll
                </button>
              </div>

              <div>
                <h3 className="font-semibold text-gray-700 mb-2">Enrolled Students ({enrollments.length})</h3>
                {enrollments.length === 0 ? (
                  <p className="text-gray-400 text-sm">No students enrolled yet.</p>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Name</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Email</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Enrolled</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {enrollments.map(e => (
                          <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                            <td className="px-3 py-2">{e.name}</td>
                            <td className="px-3 py-2 text-gray-500">{e.email}</td>
                            <td className="px-3 py-2 text-gray-400">{new Date(e.enrolled_at).toLocaleDateString()}</td>
                            <td className="px-3 py-2">
                              <button
                                onClick={() => handleRemoveEnrollment(e.id)}
                                className="text-red-500 hover:text-red-700 text-xs font-medium"
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Course Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b flex items-center justify-between">
              <h2 className="text-lg font-bold">Create New Course</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
            </div>
            <div className="p-6 space-y-4">
              {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Course Code</label>
                <input
                  type="text"
                  placeholder="e.g. CS101"
                  value={newCourse.code}
                  onChange={e => setNewCourse(p => ({ ...p, code: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Course Name</label>
                <input
                  type="text"
                  placeholder="e.g. Introduction to Computer Science"
                  value={newCourse.name}
                  onChange={e => setNewCourse(p => ({ ...p, name: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Instructor</label>
                <select
                  value={newCourse.instructor_id}
                  onChange={e => setNewCourse(p => ({ ...p, instructor_id: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                >
                  <option value="">Select instructor</option>
                  {instructors.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleCreateCourse}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
                >
                  Create Course
                </button>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
