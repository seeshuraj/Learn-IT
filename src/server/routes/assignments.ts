import { Router } from "express";
import type { Pool } from "pg";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateParams, validateBody } from "../middleware/validate.js";
import {
  routeParamId,
  assignmentCreateSchema,
  assignmentUpdateSchema,
  instructorAssignmentCreateSchema,
} from "../validation/schemas.js";

export function createAssignmentsRouter(pool: Pool): Router {
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

  // GET /api/modules/:id/assignments
  router.get("/modules/:id/assignments", requireAuth, validateParams(routeParamId), async (req, res) => {
    try {
      res.json(await query("SELECT * FROM assignments WHERE module_id=$1 ORDER BY due_date", [req.params.id]));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/modules/:id/assignments
  router.post(
    "/modules/:id/assignments",
    requireAuth, requireRole("instructor", "admin"),
    validateParams(routeParamId), validateBody(assignmentCreateSchema),
    async (req, res) => {
      try {
        const { title, description, due_date, max_score } = req.body;
        res.status(201).json(await queryOne(
          "INSERT INTO assignments (module_id,title,description,due_date,max_score) VALUES ($1,$2,$3,$4,$5) RETURNING *",
          [req.params.id, title, description, due_date, max_score]
        ));
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
  );

  // PUT /api/assignments/:id
  router.put(
    "/assignments/:id",
    requireAuth, requireRole("instructor", "admin"),
    validateParams(routeParamId), validateBody(assignmentUpdateSchema),
    async (req, res) => {
      try {
        const { title, description, due_date, max_score } = req.body;
        const assignment = await queryOne(
          "UPDATE assignments SET title=$1,description=$2,due_date=$3,max_score=$4 WHERE id=$5 RETURNING *",
          [title, description, due_date, max_score, req.params.id]
        );
        if (!assignment) return res.status(404).json({ error: "Assignment not found" });
        res.json(assignment);
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
  );

  // DELETE /api/assignments/:id
  router.delete(
    "/assignments/:id",
    requireAuth, requireRole("instructor", "admin"),
    validateParams(routeParamId),
    async (req, res) => {
      try {
        const { changes } = await run("DELETE FROM assignments WHERE id=$1", [req.params.id]);
        if (!changes) return res.status(404).json({ error: "Assignment not found" });
        res.json({ success: true });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
  );

  // POST /api/instructor/assignments
  router.post(
    "/instructor/assignments",
    requireAuth, requireRole("instructor", "admin"),
    validateBody(instructorAssignmentCreateSchema),
    async (req, res) => {
      try {
        const { module_id, title, description, due_date, max_score } = req.body;
        res.status(201).json(await queryOne(
          "INSERT INTO assignments (module_id,title,description,due_date,max_score) VALUES ($1,$2,$3,$4,$5) RETURNING *",
          [module_id, title, description, due_date, max_score]
        ));
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
  );

  return router;
}
