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