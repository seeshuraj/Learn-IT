import { Router } from "express";
import type { Pool } from "pg";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateParams, validateBody } from "../middleware/validate.js";
import { routeParamId, moduleCreateSchema } from "../validation/schemas.js";

export function createCoursesRouter(pool: Pool): Router {
  const router = Router();

  async function query(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows;
  }
  async function queryOne(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows[0] ?? null;
  }

  // GET /api/courses
  router.get("/", requireAuth, async (_req, res) => {
    try {
      res.json(await query("SELECT * FROM courses ORDER BY name"));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/courses/:id/modules
  router.get("/:id/modules", requireAuth, validateParams(routeParamId), async (req, res) => {
    try {
      res.json(await query(
        "SELECT * FROM modules WHERE course_id=$1 ORDER BY position,id",
        [req.params.id]
      ));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/courses/:id/modules
  router.post(
    "/:id/modules",
    requireAuth, requireRole("instructor", "admin"),
    validateParams(routeParamId), validateBody(moduleCreateSchema),
    async (req, res) => {
      try {
        const { name, content } = req.body;
        const mod = await queryOne(
          "INSERT INTO modules (course_id,name,content) VALUES ($1,$2,$3) RETURNING *",
          [req.params.id, name, content]
        );
        res.status(201).json(mod);
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
  );

  // GET /api/courses/:id  (materials)
  router.get("/:id/materials", requireAuth, validateParams(routeParamId), async (req, res) => {
    try {
      res.json(await query("SELECT * FROM materials WHERE module_id=$1", [req.params.id]));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  return router;
}
