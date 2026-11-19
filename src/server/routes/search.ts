/**
 * Search box in the top bar.
 *
 *   GET /api/search?q=   courses, assignments and notes the caller can open;
 *                        admins also get people. At most 5 of each.
 *
 * Scope follows the same rules as the pages the results open: students see
 * their enrolled courses (and their own notes), professors the courses they
 * teach, admins everything in their college.
 */

import { Router, Request, Response } from 'express';
import type pkg from 'pg';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { sendServerError } from '../lib/httpErrors.js';
import { readSearchQuery } from '../lib/search.js';

export function createSearchRouter(pool: pkg.Pool): Router {
  const router = Router();

  router.get('/search', requireAuth, async (req: Request, res: Response) => {
    try {
      const a = (req as AuthenticatedRequest).auth;
      const q = readSearchQuery(req.query.q);
      if (!q) return res.json({ courses: [], assignments: [], notes: [], people: [] });

      // Courses the caller can open: $1 institution, $2 caller, $3 role.
      const scope = `c.institution_id = $1 AND (
          $3 = 'admin'
          OR ($3 = 'instructor' AND c.instructor_id = $2)
          OR ($3 = 'student' AND EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.student_id = $2)))`;
      const params = [a.institutionId, a.legacyUserId, a.role, q];

      const [courses, assignments, notes, people] = await Promise.all([
        pool.query(
          `SELECT c.id, c.code, c.name FROM courses c
           WHERE ${scope} AND (c.name ILIKE $4 OR c.code ILIKE $4)
           ORDER BY c.code LIMIT 5`, params),
        pool.query(
          `SELECT a.id, a.title, a.due_date, c.id AS course_id, c.code AS course_code
           FROM assignments a JOIN modules m ON m.id = a.module_id JOIN courses c ON c.id = m.course_id
           WHERE ${scope} AND a.title ILIKE $4 AND ($3 <> 'student' OR coalesce(a.status, 'active') = 'active')
           ORDER BY a.due_date DESC NULLS LAST LIMIT 5`, params),
        pool.query(
          `SELECT n.id, coalesce(n.original_name, n.filename) AS name, n.module_id, m.name AS module_name, c.code AS course_code
           FROM notes n JOIN modules m ON m.id = n.module_id JOIN courses c ON c.id = m.course_id
           LEFT JOIN users up ON up.id = n.uploaded_by
           WHERE ${scope} AND coalesce(n.original_name, n.filename) ILIKE $4
             AND (up.role IS NULL OR up.role <> 'student' OR n.student_id = $2)
           ORDER BY n.uploaded_at DESC LIMIT 5`, params),
        a.role === 'admin'
          ? pool.query(
              `SELECT u.id, u.name, u.email, im.role FROM users u
               JOIN institution_members im ON im.user_id = u.id AND im.institution_id = $1
               WHERE (u.name ILIKE $2 OR u.email ILIKE $2)
               ORDER BY u.name LIMIT 5`, [a.institutionId, q])
          : Promise.resolve({ rows: [] as any[] }),
      ]);
      res.json({ courses: courses.rows, assignments: assignments.rows, notes: notes.rows, people: people.rows });
    } catch (e: any) { sendServerError(res, e); }
  });

  return router;
}
