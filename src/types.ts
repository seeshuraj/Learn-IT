export interface User {
  id: number;
  name: string;
  email: string;
  role: 'student' | 'instructor' | 'admin';
  active?: number;
  year?: number;
  gpa?: number;
  major?: string;
}

export interface Course {
  id: number;
  code: string;
  name: string;
  instructor_id: number;
  instructor_name: string;
  archived?: number;
}

export interface Module {
  id: number;
  course_id: number;
  name: string;
  content: string;
}

export interface Assignment {
  id: number;
  module_id: number;
  title: string;
  due_date: string;
  status: 'pending' | 'graded' | 'overdue';
  module_name?: string;
  course_name?: string;
}

export interface Submission {
  id: number;
  assignment_id: number;
  student_id: number;
  content: string;
  grade?: number;
  feedback?: string;
  ai_suggestion?: string;
  assignment_title?: string;
  student_name?: string;
  course_name?: string;
  submitted_at?: string;
}
