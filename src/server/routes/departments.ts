/**
 * Departments of a college, and placing courses in them.
 *
 *   GET    /api/admin/departments            list with student/professor/course counts
 *   POST   /api/admin/departments            { code, name }
 *   PATCH  /api/admin/departments/:id        { code?, name? }
 *   DELETE /api/admin/departments/:id        members and courses keep existing, unassigned
 *   PATCH  /api/admin/courses/:id/placement  { department_id?, semester? }
 *
 * Admins only, always within the caller's college. Audited.
 */

import { Router, Request, Response } from 'express';
import type pkg from 'pg';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';
import { sendServerError } from '../lib/httpErrors.js';
import { cleanName } from '../lib/departments.js';

const CODE_RE = /^[A-Z0-9][A-Z0-9&.\-]{0,19}$/;
const PG_UNIQUE = '23505';

export function createDepartmentsRouter(pool: pkg.Pool): Router {
  const router = Router();
  const admin = [requireAuth, requireRole('admin')];
  const authOf = (req: Request) => (req as AuthenticatedRequest).auth;
  const audit = (req: Request, action: string, id: number | string, metadata: Record<string, unknown>) => {
    const auth = authOf(req);
    writeAudit({
      action, resourceType: action.split('.')[0], resourceId: String(id),
      actorUserId: auth.legacyUserId, actorEmail: auth.email, actorRole: auth.role, metadata, req,
    });
  };

  function readFields(body: any, partial: boolean): { code?: string; name?: string; error?: string } {
    const out: { code?: string; name?: string } = {};
    if (body?.code !== undefined || !partial) {
      const code = String(body?.code ?? '').trim().toUpperCase();
      if (!CODE_RE.test(code)) return { error: 'Code must be 1–20 letters or digits, like CSE or ECE' };
      out.code = code;
    }
    if (body?.name !== undefined || !partial) {
      const name = cleanName(String(body?.name ?? ''));
      if (!name) return { error: 'Name is required' };
      out.name = name;
    }
    return out;
  }

  router.get('/departments', ...admin, async (req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT d.id, d.code, d.name,
                (SELECT count(*)::int FROM institution_members im
                  WHERE im.department_id = d.id AND im.role = 'student' AND im.status = 'active') AS students,
                (SELECT count(*)::int FROM institution_members im
                  WHERE im.department_id = d.id AND im.role = 'instructor' AND im.status = 'active') AS professors,
                (SELECT count(*)::int FROM courses c WHERE c.department_id = d.id) AS courses
         FROM departments d
         WHERE d.institution_id = $1
         ORDER BY d.code`,
        [authOf(req).institutionId]
      );
      res.json(rows);
    } catch (e: any) { sendServerError(res, e); }
  });

  router.post('/departments', ...admin, async (req: Request, res: Response) => {
    try {
      const f = readFields(req.body, false);
      if (f.error) return res.status(422).json({ error: f.error });
      const { rows } = await pool.query(
        'INSERT INTO departments (institution_id, code, name) VALUES ($1, $2, $3) RETURNING id, code, name',
        [authOf(req).institutionId, f.code, f.name]
      );
      audit(req, 'department.create', rows[0].id, { code: f.code });
      res.status(201).json({ ...rows[0], students: 0, professors: 0, courses: 0 });
    } catch (e: any) {
      if (e?.code === PG_UNIQUE) return res.status(409).json({ error: 'A department with that code or name already exists' });
      sendServerError(res, e);
    }
  });

  router.patch('/departments/:id', ...admin, async (req: Request, res: Response) => {
    try {
      const f = readFields(req.body, true);
      if (f.error) return res.status(422).json({ error: f.error });
      const { rows } = await pool.query(
        `UPDATE departments SET code = COALESCE($3, code), name = COALESCE($4, name), updated_at = now()
         WHERE id = $1 AND institution_id = $2 RETURNING id, code, name`,
        [Number(req.params.id) || 0, authOf(req).institutionId, f.code ?? null, f.name ?? null]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Department not found' });
      audit(req, 'department.update', rows[0].id, { fields: Object.keys(f) });
      res.json(rows[0]);
    } catch (e: any) {
      if (e?.code === PG_UNIQUE) return res.status(409).json({ error: 'A department with that code or name already exists' });
      sendServerError(res, e);
    }
  });

  // Members and courses are kept; they just lose the department (FK sets null).
  router.delete('/departments/:id', ...admin, async (req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        'DELETE FROM departments WHERE id = $1 AND institution_id = $2 RETURNING code',
        [Number(req.params.id) || 0, authOf(req).institutionId]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Department not found' });
      audit(req, 'department.delete', req.params.id, { code: rows[0].code });
      res.json({ deleted: true });
    } catch (e: any) { sendServerError(res, e); }
  });

  router.patch('/courses/:id/placement', ...admin, async (req: Request, res: Response) => {
    try {
      const auth = authOf(req);
      const body = req.body ?? {};
      const hasDept = body.department_id !== undefined;
      const hasSem = body.semester !== undefined;
      const dept = body.department_id === null || body.department_id === '' ? null : Number(body.department_id);
      const sem = body.semester === null || body.semester === '' ? null : Number(body.semester);
      if (hasDept && dept !== null && !Number.isInteger(dept)) return res.status(422).json({ error: 'Invalid department' });
      if (hasSem && sem !== null && !(Number.isInteger(sem) && sem >= 1 && sem <= 12)) {
        return res.status(422).json({ error: 'Semester must be 1–12' });
      }
      if (dept !== null && hasDept) {
        const ok = await pool.query('SELECT 1 FROM departments WHERE id = $1 AND institution_id = $2', [dept, auth.institutionId]);
        if (!ok.rows.length) return res.status(422).json({ error: 'Department not found' });
      }
      const { rows } = await pool.query(
        `UPDATE courses SET
           department_id = CASE WHEN $3::boolean THEN $4::int ELSE department_id END,
           semester      = CASE WHEN $5::boolean THEN $6::smallint ELSE semester END
         WHERE id = $1 AND institution_id = $2
         RETURNING id, department_id, semester`,
        [Number(req.params.id) || 0, auth.institutionId, hasDept, dept, hasSem, sem]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Course not found' });
      audit(req, 'course.placement', rows[0].id, { department_id: rows[0].department_id, semester: rows[0].semester });
      res.json(rows[0]);
    } catch (e: any) { sendServerError(res, e); }
  });

  return router;
}
