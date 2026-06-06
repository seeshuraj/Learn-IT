import { Router } from "express";
import type { Pool } from "pg";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateParams, validateBody } from "../middleware/validate.js";
import {
  routeParamId,
  adminUserCreateSchema,
  adminUserUpdateSchema,
  courseCreateSchema,
  enrollmentCreateSchema,
  bulkEnrollSchema,
  settingsSchema,
} from "../validation/schemas.js";
import { createAuthUserAndIdentityMapRow } from "../lib/authHelpers.js";
import { notify } from "../lib/notify.js";

const SNAPSHOT_STALE_MS = 35 * 60 * 1000;

export function createAdminRouter(pool: Pool): Router {
  const router = Router();

  async function query(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows;
  }
  async function queryOne(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows[0] ?? null;
  }
  async function run(sql: string, params: any[] = []) {
    const { rows, rowCount } = await pool.query(sql, params);
    return { lastInsertId: rows[0]?.id ?? null, changes: rowCount ?? 0 };
  }

  // GET /api/admin/users
  router.get("/users", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      res.json(await query("SELECT id,name,email,role,active,year,major,gpa FROM users ORDER BY name"));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/users
  router.post("/users", requireAuth, requireRole("admin"), validateBody(adminUserCreateSchema), async (req, res) => {
    try {
      const { name, email, role, year, major, gpa } = req.body;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const user = await client.query(
          "INSERT INTO users (name,email,role,active,year,major,gpa) VALUES ($1,$2,$3,1,$4,$5,$6) RETURNING *",
          [name, email, role, year ?? null, major ?? null, gpa ?? null]
        );
        const newUser     = user.rows[0];
        const authResult  = await createAuthUserAndIdentityMapRow(client, newUser.id, email, role);
        await client.query("COMMIT");
        res.status(201).json({ ...newUser, tempPassword: authResult?.tempPassword });
      } catch (err) {
        await client.query("ROLLBACK"); throw err;
      } finally { client.release(); }
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/admin/users/:id
  router.put("/users/:id", requireAuth, requireRole("admin"), validateParams(routeParamId), validateBody(adminUserUpdateSchema), async (req, res) => {
    try {
      const { name, email, role, active, year, major, gpa } = req.body;
      const user = await queryOne(
        "UPDATE users SET name=$1,email=$2,role=$3,active=$4,year=$5,major=$6,gpa=$7 WHERE id=$8 RETURNING *",
        [name, email, role, active, year ?? null, major ?? null, gpa ?? null, req.params.id]
      );
      if (!user) return res.status(404).json({ error: "User not found" });
      res.json(user);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/stats
  router.get("/stats", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const [users, courses, submissions, enrollments] = await Promise.all([
        queryOne("SELECT COUNT(*) AS count FROM users WHERE active=1"),
        queryOne("SELECT COUNT(*) AS count FROM courses"),
        queryOne("SELECT COUNT(*) AS count FROM submissions"),
        queryOne("SELECT COUNT(*) AS count FROM enrollments"),
      ]);
      res.json({
        users:       Number(users?.count ?? 0),
        courses:     Number(courses?.count ?? 0),
        submissions: Number(submissions?.count ?? 0),
        enrollments: Number(enrollments?.count ?? 0),
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/stats/snapshot
  router.get("/stats/snapshot", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const row = await queryOne("SELECT * FROM admin_stats_snapshots ORDER BY created_at DESC LIMIT 1");
      if (!row) return res.status(404).json({ error: "No snapshot available" });
      res.json({ ...row, stale: Date.now() - new Date(row.created_at).getTime() > SNAPSHOT_STALE_MS });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/settings
  router.get("/settings", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      const settings = await query("SELECT key, value FROM settings");
      const obj: Record<string, string> = {};
      settings.forEach((s: any) => { obj[s.key] = s.value; });
      res.json(obj);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/settings
  router.post("/settings", requireAuth, requireRole("admin"), validateBody(settingsSchema), async (req, res) => {
    try {
      const { key, value } = req.body;
      await run(
        "INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
        [key, value]
      );
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/courses
  router.get("/courses", requireAuth, requireRole("admin"), async (_req, res) => {
    try {
      res.json(await query(
        `SELECT c.*, u.name AS instructor_name FROM courses c
         LEFT JOIN users u ON c.instructor_id=u.id ORDER BY c.name`
      ));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/courses
  router.post("/courses", requireAuth, requireRole("admin"), validateBody(courseCreateSchema), async (req, res) => {
    try {
      const { name, description, instructor_id, credits, semester } = req.body;
      res.status(201).json(await queryOne(
        "INSERT INTO courses (name,description,instructor_id,credits,semester) VALUES ($1,$2,$3,$4,$5) RETURNING *",
        [name, description, instructor_id ?? null, credits ?? null, semester ?? null]
      ));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/admin/courses/:id
  router.delete("/courses/:id", requireAuth, requireRole("admin"), validateParams(routeParamId), async (req, res) => {
    try {
      const { changes } = await run("DELETE FROM courses WHERE id=$1", [req.params.id]);
      if (!changes) return res.status(404).json({ error: "Course not found" });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/admin/enrollments/:courseId
  router.get("/enrollments/:courseId", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      res.json(await query(
        `SELECT e.*, u.name AS student_name, u.email AS student_email
         FROM enrollments e JOIN users u ON e.student_id=u.id
         WHERE e.course_id=$1`,
        [req.params.courseId]
      ));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/enrollments
  router.post("/enrollments", requireAuth, requireRole("admin"), validateBody(enrollmentCreateSchema), async (req, res) => {
    try {
      const { course_id, student_id } = req.body;
      const enrollment = await queryOne(
        "INSERT INTO enrollments (course_id,student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING *",
        [course_id, student_id]
      );
      await notify(pool, { userId: student_id, type: "enrollment_confirmed", message: "You have been enrolled in a new course.", metadata: { course_id } });
      res.status(201).json(enrollment ?? { message: "Already enrolled" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/admin/bulk-enroll
  router.post("/bulk-enroll", requireAuth, requireRole("admin"), validateBody(bulkEnrollSchema), async (req, res) => {
    try {
      const { course_id, emails } = req.body;
      const results = [];
      for (const email of emails) {
        const student = await queryOne("SELECT id FROM users WHERE email=$1 AND role='student'", [email]);
        if (!student) { results.push({ email, status: "not_found" }); continue; }
        const enrollment = await queryOne(
          "INSERT INTO enrollments (course_id,student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING *",
          [course_id, student.id]
        );
        await notify(pool, { userId: student.id, type: "enrollment_confirmed", message: "You have been enrolled in a new course.", metadata: { course_id } });
        results.push({ email, status: enrollment ? "enrolled" : "already_enrolled" });
      }
      res.json(results);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/admin/enrollments/:id
  router.delete("/enrollments/:id", requireAuth, requireRole("admin"), validateParams(routeParamId), async (req, res) => {
    try {
      const { changes } = await run("DELETE FROM enrollments WHERE id=$1", [req.params.id]);
      if (!changes) return res.status(404).json({ error: "Enrollment not found" });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  return router;
}
