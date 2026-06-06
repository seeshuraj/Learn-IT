import { Router } from "express";
import type { Pool } from "pg";
import { requireAuth, requireSelfOrAdmin } from "../middleware/auth.js";

export function createStudentRouter(pool: Pool): Router {
  const router = Router();

  async function query(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows;
  }
  async function queryOne(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows[0] ?? null;
  }

  // GET /api/student/:id/courses
  router.get("/:id/courses", requireAuth, requireSelfOrAdmin, async (req, res) => {
    try {
      res.json(await query(
        `SELECT c.* FROM courses c JOIN enrollments e ON c.id=e.course_id WHERE e.student_id=$1`,
        [req.params.id]
      ));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/student/:id/assignments
  router.get("/:id/assignments", requireAuth, requireSelfOrAdmin, async (req, res) => {
    try {
      res.json(await query(
        `SELECT a.*, m.name AS module_name, c.name AS course_name,
                s.grade, s.feedback, s.submitted_at, s.id AS submission_id
         FROM assignments a
         JOIN modules m     ON a.module_id=m.id
         JOIN courses c     ON m.course_id=c.id
         JOIN enrollments e ON c.id=e.course_id AND e.student_id=$1
         LEFT JOIN submissions s ON s.assignment_id=a.id AND s.student_id=$1
         ORDER BY a.due_date`,
        [req.params.id]
      ));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/student/:id/stats
  router.get("/:id/stats", requireAuth, requireSelfOrAdmin, async (req, res) => {
    try {
      res.json(await queryOne(
        `SELECT COUNT(DISTINCT e.course_id) AS enrolled_courses,
                COUNT(DISTINCT s.id)         AS total_submissions,
                AVG(s.grade)                 AS average_grade
         FROM enrollments e
         LEFT JOIN submissions s ON s.student_id=e.student_id
         WHERE e.student_id=$1`,
        [req.params.id]
      ));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/students/:id/analytics
  router.get("/analytics/:id", requireAuth, requireSelfOrAdmin, async (req, res) => {
    try {
      res.json(await query(
        `SELECT s.grade, s.submitted_at, a.title AS assignment_title,
                m.name AS module_name, c.name AS course_name
         FROM submissions s
         JOIN assignments a ON s.assignment_id=a.id
         JOIN modules m     ON a.module_id=m.id
         JOIN courses c     ON m.course_id=c.id
         WHERE s.student_id=$1 AND s.grade IS NOT NULL
         ORDER BY s.submitted_at`,
        [req.params.id]
      ));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/students/:id/notes
  router.get("/notes/:id", requireAuth, requireSelfOrAdmin, async (req, res) => {
    try {
      res.json(await query(
        `SELECT n.*, m.name AS module_name, c.name AS course_name
         FROM notes n
         JOIN modules m ON n.module_id=m.id
         JOIN courses c ON m.course_id=c.id
         WHERE n.uploaded_by=$1 ORDER BY n.created_at DESC`,
        [req.params.id]
      ));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  return router;
}
