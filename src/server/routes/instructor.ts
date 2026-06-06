import { Router } from "express";
import type { Pool } from "pg";
import { requireAuth, requireRole, AuthenticatedRequest } from "../middleware/auth.js";
import { validateParams } from "../middleware/validate.js";
import { routeParamId } from "../validation/schemas.js";

export function createInstructorRouter(pool: Pool): Router {
  const router = Router();

  async function query(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows;
  }
  async function queryOne(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows[0] ?? null;
  }

  // GET /api/instructor/submissions
  router.get("/submissions", requireAuth, requireRole("instructor", "admin"), async (_req, res) => {
    try {
      res.json(await query(
        `SELECT s.*, u.name AS student_name, a.title AS assignment_title, m.name AS module_name
         FROM submissions s
         JOIN users u       ON s.student_id    = u.id
         JOIN assignments a ON s.assignment_id = a.id
         JOIN modules m     ON a.module_id     = m.id
         ORDER BY s.submitted_at DESC`
      ));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/instructor/courses
  router.get("/courses", requireAuth, requireRole("instructor", "admin"), async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      res.json(await query(
        "SELECT * FROM courses WHERE instructor_id=$1 ORDER BY name",
        [authReq.auth.legacyUserId]
      ));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/instructor/courses/:id/analytics
  router.get("/courses/:id/analytics", requireAuth, requireRole("instructor", "admin"), validateParams(routeParamId), async (req, res) => {
    try {
      const enrollmentCount = await queryOne(
        "SELECT COUNT(*) AS count FROM enrollments WHERE course_id=$1", [req.params.id]
      );
      const avgGrade = await queryOne(
        `SELECT AVG(s.grade) AS avg FROM submissions s
         JOIN assignments a ON s.assignment_id=a.id
         JOIN modules m     ON a.module_id=m.id
         WHERE m.course_id=$1 AND s.grade IS NOT NULL`,
        [req.params.id]
      );
      res.json({
        enrollment_count: Number(enrollmentCount?.count ?? 0),
        avg_grade: avgGrade?.avg ? Number(avgGrade.avg).toFixed(1) : null,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/instructor/courses/:id/analytics/snapshot
  router.get("/courses/:id/analytics/snapshot", requireAuth, requireRole("instructor", "admin"), validateParams(routeParamId), async (req, res) => {
    try {
      const SNAPSHOT_STALE_MS = 35 * 60 * 1000;
      const row = await queryOne(
        "SELECT * FROM course_analytics_snapshots WHERE course_id=$1 ORDER BY created_at DESC LIMIT 1",
        [req.params.id]
      );
      if (!row) return res.status(404).json({ error: "No snapshot available" });
      res.json({ ...row, stale: Date.now() - new Date(row.created_at).getTime() > SNAPSHOT_STALE_MS });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  return router;
}
