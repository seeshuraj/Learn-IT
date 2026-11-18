/**
 * A college's saved question-paper patterns, reused when creating assessments.
 *
 *   GET    /api/exam-patterns          the college's patterns (+ built-in presets)
 *   POST   /api/exam-patterns          { name, assessment_type?, pattern }
 *   DELETE /api/exam-patterns/:id      its creator or an admin
 *
 * Professors and admins, always within the caller's college. Audited.
 */

import { Router, Request, Response } from 'express';
import type pkg from 'pg';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';
import { sendServerError } from '../lib/httpErrors.js';
import { isAssessmentType } from '../lib/examGrading.js';
import { ANNA_UNIV_SEMESTER, paperTotal, validatePattern } from '../lib/questionPattern.js';

const PG_UNIQUE = '23505';
const MAX_PER_COLLEGE = 200;

export const BUILT_IN_PATTERNS = [
  { id: 'anna-univ-semester', name: 'Anna University semester (100)', assessment_type: 'end_semester', pattern: ANNA_UNIV_SEMESTER, built_in: true },
];

export function createExamPatternsRouter(pool: pkg.Pool): Router {
  const router = Router();
  const staff = [requireAuth, requireRole('instructor', 'admin')];
  const authOf = (req: Request) => (req as AuthenticatedRequest).auth;

  router.get('/', ...staff, async (req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT p.id, p.name, p.assessment_type, p.pattern, p.created_by, u.name AS created_by_name, p.created_at
         FROM exam_patterns p LEFT JOIN users u ON u.id = p.created_by
         WHERE p.institution_id = $1 ORDER BY lower(p.name)`,
        [authOf(req).institutionId]
      );
      res.json([
        ...BUILT_IN_PATTERNS.map(b => ({ ...b, total: paperTotal(b.pattern) })),
        ...rows.map((r: any) => ({ ...r, built_in: false, total: paperTotal(r.pattern) })),
      ]);
    } catch (e: any) { sendServerError(res, e); }
  });

  router.post('/', ...staff, async (req: Request, res: Response) => {
    try {
      const auth = authOf(req);
      const name = String(req.body?.name ?? '').trim().replace(/\s+/g, ' ');
      if (!name || name.length > 80) return res.status(422).json({ error: 'Give the pattern a name (up to 80 characters)' });
      const type = req.body?.assessment_type ?? null;
      if (type !== null && !isAssessmentType(type)) return res.status(422).json({ error: 'Unknown assessment type' });
      const v = validatePattern(req.body?.pattern);
      if ('error' in v) return res.status(422).json({ error: v.error });
      // Units are course-specific; a saved pattern is for any course.
      const pattern = { ...v.pattern, parts: v.pattern.parts.map(p => ({ ...p, questions: p.questions.map(({ module_id_b: _b, ...q }) => ({ ...q, module_id: null })) })) };

      const count = await pool.query('SELECT count(*)::int AS n FROM exam_patterns WHERE institution_id = $1', [auth.institutionId]);
      if (count.rows[0].n >= MAX_PER_COLLEGE) return res.status(409).json({ error: 'Your college has reached the limit of saved patterns' });

      const { rows } = await pool.query(
        `INSERT INTO exam_patterns (institution_id, name, assessment_type, pattern, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, name, assessment_type, pattern, created_by, created_at`,
        [auth.institutionId, name, type, JSON.stringify(pattern), auth.legacyUserId]
      );
      writeAudit({
        action: 'exam_pattern.create', resourceType: 'exam_pattern', resourceId: String(rows[0].id),
        actorUserId: auth.legacyUserId, actorEmail: auth.email, actorRole: auth.role, metadata: { total: paperTotal(pattern) }, req,
      });
      res.status(201).json({ ...rows[0], built_in: false, total: paperTotal(pattern) });
    } catch (e: any) {
      if (e?.code === PG_UNIQUE) return res.status(409).json({ error: 'A pattern with that name already exists' });
      sendServerError(res, e);
    }
  });

  router.delete('/:id', ...staff, async (req: Request, res: Response) => {
    try {
      const auth = authOf(req);
      const { rows } = await pool.query(
        `DELETE FROM exam_patterns WHERE id = $1 AND institution_id = $2
           AND ($3::text = 'admin' OR created_by = $4) RETURNING id`,
        [Number(req.params.id) || 0, auth.institutionId, auth.role, auth.legacyUserId]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Pattern not found, or not yours to delete' });
      writeAudit({
        action: 'exam_pattern.delete', resourceType: 'exam_pattern', resourceId: String(rows[0].id),
        actorUserId: auth.legacyUserId, actorEmail: auth.email, actorRole: auth.role, metadata: {}, req,
      });
      res.json({ deleted: true });
    } catch (e: any) { sendServerError(res, e); }
  });

  return router;
}
