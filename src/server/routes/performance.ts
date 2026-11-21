/**
 * College performance for admins.
 *
 *   GET /api/admin/performance           departments, professors and courses (subjects)
 *   GET /api/admin/performance/students  students, filtered and paged
 *
 * Results count only published assessments. Pass = a passing grade where
 * grades apply, otherwise at least 50% (as on the admin dashboard). Admins
 * only, always within the caller's college; nothing here is written or logged
 * about individual students.
 */

import { Router, Request, Response } from 'express';
import type pkg from 'pg';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/auth.js';
import { sendServerError } from '../lib/httpErrors.js';
import { rollUp, type CourseStats, type TopicAvg } from '../lib/performance.js';
import { COURSES_SQL, TOPICS_SQL, DEPARTMENTS_SQL, PROFESSORS_SQL, DEPT_STUDENTS_SQL, STORAGE_SQL, studentsSql } from '../lib/performanceSql.js';

const STUDENT_SORTS: Record<string, string> = {
  avg_asc: 'avg_pct ASC NULLS LAST, name',
  avg_desc: 'avg_pct DESC NULLS LAST, name',
  name: 'name, id',
  latest_asc: 'latest_pct ASC NULLS LAST, name',
};
const MAX_PAGE = 100;

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const optInt = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);

export function createPerformanceRouter(pool: pkg.Pool): Router {
  const router = Router();
  const admin = [requireAuth, requireRole('admin')];
  const q = async (sql: string, params: unknown[]) => (await pool.query(sql, params)).rows;

  router.get('/performance', ...admin, async (req: Request, res: Response) => {
    try {
      const inst = (req as AuthenticatedRequest).auth.institutionId;
      const [courseRows, topicRows, deptRows, profRows, deptStudentRows, [storageRow]] = await Promise.all([
        q(COURSES_SQL, [inst]),
        q(TOPICS_SQL, [inst]),
        q(DEPARTMENTS_SQL, [inst]),
        q(PROFESSORS_SQL, [inst]),
        // Results of each department's own students, whichever courses they wrote.
        q(DEPT_STUDENTS_SQL, [inst]),
        q(STORAGE_SQL, [inst]),
      ]);

      const topics = new Map<number, TopicAvg[]>();
      for (const t of topicRows) {
        const list = topics.get(t.course_id) ?? [];
        list.push({ topic: t.topic, avg_pct: Number(t.avg_pct), n: Number(t.n) });
        topics.set(t.course_id, list);
      }
      const courses: CourseStats[] = courseRows.map((c: any) => ({
        id: c.id, code: c.code, name: c.name, department_id: c.department_id, semester: c.semester,
        instructor_id: c.instructor_id, instructor_name: c.instructor_name,
        enrolled: num(c.enrolled), modules: num(c.modules), notes: num(c.notes), assignments: num(c.assignments),
        assessments: num(c.assessments), written: num(c.written), pct_sum: num(c.pct_sum), passed: num(c.passed),
        absent: num(c.absent), at_risk: num(c.at_risk), submissions: num(c.submissions), graded: num(c.graded),
        pending: num(c.pending), timed: num(c.timed), turnaround_hours_sum: num(c.turnaround_hours_sum),
        weak_topics: (topics.get(c.id) ?? []).sort((a, b) => a.avg_pct - b.avg_pct).slice(0, 3),
      }));

      const byDept = new Map(rollUp(courses, c => c.department_id).map(r => [r.key, r]));
      const byProf = new Map(rollUp(courses, c => c.instructor_id).map(r => [r.key, r]));
      const ofStudents = new Map(deptStudentRows.map((r: any) => [r.department_id, r]));
      const studentFigures = (id: number | null) => {
        const s: any = ofStudents.get(id);
        return {
          written: num(s?.written),
          avg_pct: s?.avg_pct === null || s?.avg_pct === undefined ? null : Number(s.avg_pct),
          pass_rate: s?.pass_rate === null || s?.pass_rate === undefined ? null : Number(s.pass_rate),
        };
      };
      const departments = deptRows.map((d: any) => ({
        id: d.id, code: d.code, name: d.name, students: num(d.students), professors: num(d.professors),
        subjects: byDept.get(d.id) ?? null,
        of_students: studentFigures(d.id),
      }));
      const unplaced = byDept.get(null);

      // Professors: everyone with the role, plus anyone teaching a course without it.
      const profs = new Map<number, { id: number; name: string | null; department_id: number | null }>();
      for (const p of profRows) profs.set(p.id, { id: p.id, name: p.name, department_id: p.department_id });
      for (const c of courses) {
        if (c.instructor_id && !profs.has(c.instructor_id)) profs.set(c.instructor_id, { id: c.instructor_id, name: c.instructor_name, department_id: null });
      }
      const professors = [...profs.values()].map(p => ({
        ...p,
        course_departments: [...new Set(courses.filter(c => c.instructor_id === p.id).map(c => c.department_id).filter(Boolean))],
        subjects: byProf.get(p.id) ?? null,
      }));

      res.json({
        storage: {
          notes_bytes: num(storageRow?.notes_bytes), notes_files: num(storageRow?.notes_files),
          submission_bytes: num(storageRow?.submission_bytes), submission_files: num(storageRow?.submission_files),
        },
        departments,
        unassigned: unplaced ? { subjects: unplaced, of_students: studentFigures(null) } : null,
        professors,
        courses: courses.map(({ pct_sum, turnaround_hours_sum, ...c }) => ({
          ...c,
          avg_pct: c.written ? Math.round((pct_sum / c.written) * 10) / 10 : null,
          pass_rate: c.written ? Math.round((1000 * c.passed) / c.written) / 10 : null,
          avg_turnaround_hours: c.timed ? Math.round((turnaround_hours_sum / c.timed) * 10) / 10 : null,
        })),
      });
    } catch (e: any) { sendServerError(res, e); }
  });

  router.get('/performance/students', ...admin, async (req: Request, res: Response) => {
    try {
      const inst = (req as AuthenticatedRequest).auth.institutionId;
      const dept = req.query.department_id === 'none' ? 'none' : optInt(req.query.department_id);
      const year = optInt(req.query.year);
      const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
      const like = search ? `%${search.replace(/[\\%_]/g, m => `\\${m}`)}%` : null;
      const order = STUDENT_SORTS[String(req.query.sort ?? '')] ?? STUDENT_SORTS.avg_asc;
      const limit = Math.min(MAX_PAGE, Math.max(1, optInt(req.query.limit) ?? 50));
      const offset = optInt(req.query.offset) ?? 0;
      const atRisk = req.query.at_risk === '1';

      const rows = await q(
        studentsSql(order),
        [inst, dept === null ? null : String(dept), year, like, atRisk, limit, offset]
      );

      res.json({
        total: rows.length ? Number(rows[0].total) : 0,
        students: rows.map((r: any) => {
          const latest = r.latest_pct === null ? null : Number(r.latest_pct);
          const previous = r.previous_pct === null ? null : Number(r.previous_pct);
          const diff = latest !== null && previous !== null ? latest - previous : null;
          const avg = r.avg_pct === null ? null : Number(r.avg_pct);
          return {
            id: r.id, name: r.name, department_id: r.department_id, department_code: r.department_code,
            year_of_study: r.year_of_study, courses: num(r.courses),
            written: num(r.written), avg_pct: avg, latest_pct: latest,
            trend: diff === null ? null : diff >= 5 ? 'up' : diff <= -5 ? 'down' : 'same',
            absent: num(r.absent), assignments: num(r.assignments), submitted: num(r.submitted),
            at_risk: (avg !== null && avg < 50) || num(r.absent) >= 2,
          };
        }),
      });
    } catch (e: any) { sendServerError(res, e); }
  });

  return router;
}
