/**
 * Course notice board.
 *
 *   GET    /api/courses/:id/announcements   anyone who can open the course
 *   POST   /api/courses/:id/announcements   the course's professor or an admin; notifies its students
 *   PATCH  /api/announcements/:id           the course's professor or an admin
 *   DELETE /api/announcements/:id           the course's professor or an admin
 *   GET    /api/announcements/upcoming      notices due today … in 2 days, for the caller's courses
 *
 * Always within the caller's college. Audited (ids and kinds only).
 */

import { Router, Request, Response } from 'express';
import type pkg from 'pg';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';
import { sendServerError } from '../lib/httpErrors.js';
import { assertCanAccessCourse, assertManagesCourse, type Caller } from '../lib/access.js';
import { readNotice, noticeMessage, type NoticeKind } from '../lib/courseNotices.js';
import { todayIst, addDays } from '../lib/studyPlan.js';

const COLUMNS = `a.id, a.course_id, a.kind, a.title, a.body, to_char(a.due_date, 'YYYY-MM-DD') AS due_date,
  a.pinned, a.author_id, u.name AS author_name, a.created_at, a.updated_at`;

export function createCourseNoticesRouter(pool: pkg.Pool): Router {
  const router = Router();
  const callerOf = (req: Request): Caller => {
    const a = (req as AuthenticatedRequest).auth;
    return { legacyUserId: a.legacyUserId, role: a.role, institutionId: a.institutionId };
  };
  const audit = (req: Request, action: string, id: number, metadata: Record<string, unknown>) => {
    const a = (req as AuthenticatedRequest).auth;
    writeAudit({ action, resourceType: 'course_announcement', resourceId: String(id),
      actorUserId: a.legacyUserId, actorEmail: a.email, actorRole: a.role, metadata, req });
  };
  const courseIdOf = (req: Request) => (/^\d+$/.test(req.params.id) ? Number(req.params.id) : null);

  /** The notice, if it is in the caller's college. */
  async function loadNotice(caller: Caller, id: string) {
    if (!/^\d+$/.test(id)) return null;
    const { rows } = await pool.query(
      'SELECT id, course_id FROM course_announcements WHERE id = $1 AND institution_id = $2', [Number(id), caller.institutionId]);
    return rows[0] ?? null;
  }

  // Pinned first, then what is due soonest (today onwards), then newest.
  // Notices whose date has passed come last; the page shows them as "Earlier".
  router.get('/courses/:id/announcements', requireAuth, async (req: Request, res: Response) => {
    try {
      const caller = callerOf(req);
      const courseId = courseIdOf(req);
      await assertCanAccessCourse(pool, caller, courseId);
      const { rows } = await pool.query(
        `SELECT ${COLUMNS} FROM course_announcements a LEFT JOIN users u ON u.id = a.author_id
         WHERE a.course_id = $1 AND a.institution_id = $2
         ORDER BY a.pinned DESC, (a.due_date IS NOT NULL AND a.due_date < $3::date), a.due_date NULLS LAST, a.created_at DESC
         LIMIT 200`,
        [courseId, caller.institutionId, todayIst()]
      );
      res.json(rows);
    } catch (e: any) { sendServerError(res, e); }
  });

  router.post('/courses/:id/announcements', requireAuth, requireRole('instructor', 'admin'), async (req: Request, res: Response) => {
    try {
      const caller = callerOf(req);
      const courseId = courseIdOf(req);
      await assertManagesCourse(pool, caller, courseId);
      const r = readNotice(req.body, false);
      if ('error' in r) return res.status(422).json({ error: r.error });
      const v = r.values as Required<typeof r.values>;

      const client = await pool.connect();
      let out: { notice: any; notified: number };
      try {
        await client.query('BEGIN');
        const { rows: [created] } = await client.query(
          `INSERT INTO course_announcements (institution_id, course_id, author_id, kind, title, body, due_date, pinned)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [caller.institutionId, courseId, caller.legacyUserId, v.kind, v.title, v.body, v.due_date, v.pinned]
        );
        const { rows: [course] } = await client.query('SELECT code FROM courses WHERE id = $1', [courseId]);
        const message = noticeMessage({ code: course?.code ?? null, kind: v.kind as NoticeKind, title: v.title, due_date: v.due_date }, todayIst());
        const sent = req.body?.notify === false ? { rowCount: 0 } : await client.query(
          `INSERT INTO notifications (user_id, type, message, metadata)
           SELECT e.student_id, 'course_notice', $3, jsonb_build_object('course_id', $1::int, 'announcement_id', $4::int)
           FROM enrollments e
           JOIN institution_members im ON im.user_id = e.student_id AND im.institution_id = $2
            AND im.role = 'student' AND im.status = 'active'
           WHERE e.course_id = $1 AND e.institution_id = $2`,
          [courseId, caller.institutionId, message, created.id]
        );
        const { rows: [notice] } = await client.query(
          `SELECT ${COLUMNS} FROM course_announcements a LEFT JOIN users u ON u.id = a.author_id WHERE a.id = $1`, [created.id]);
        await client.query('COMMIT');
        out = { notice, notified: sent.rowCount ?? 0 };
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
      audit(req, 'course_announcement.create', out.notice.id, { course_id: courseId, kind: v.kind, notified: out.notified });
      res.status(201).json({ ...out.notice, notified: out.notified });
    } catch (e: any) { sendServerError(res, e); }
  });

  router.patch('/announcements/:id', requireAuth, requireRole('instructor', 'admin'), async (req: Request, res: Response) => {
    try {
      const caller = callerOf(req);
      const found = await loadNotice(caller, req.params.id);
      if (!found) return res.status(404).json({ error: 'Notice not found' });
      await assertManagesCourse(pool, caller, found.course_id);
      const r = readNotice(req.body, true);
      if ('error' in r) return res.status(422).json({ error: r.error });
      const v = r.values;
      const keys = Object.keys(v) as (keyof typeof v)[];
      if (!keys.length) return res.status(400).json({ error: 'Nothing to change' });
      const sets = keys.map((k, i) => `${k} = $${i + 2}`);
      await pool.query(
        `UPDATE course_announcements SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
        [found.id, ...keys.map(k => v[k])]
      );
      const { rows: [notice] } = await pool.query(
        `SELECT ${COLUMNS} FROM course_announcements a LEFT JOIN users u ON u.id = a.author_id WHERE a.id = $1`, [found.id]);
      audit(req, 'course_announcement.update', found.id, { fields: keys });
      res.json(notice);
    } catch (e: any) { sendServerError(res, e); }
  });

  router.delete('/announcements/:id', requireAuth, requireRole('instructor', 'admin'), async (req: Request, res: Response) => {
    try {
      const caller = callerOf(req);
      const found = await loadNotice(caller, req.params.id);
      if (!found) return res.status(404).json({ error: 'Notice not found' });
      await assertManagesCourse(pool, caller, found.course_id);
      await pool.query('DELETE FROM course_announcements WHERE id = $1', [found.id]);
      audit(req, 'course_announcement.delete', found.id, { course_id: found.course_id });
      res.json({ deleted: true });
    } catch (e: any) { sendServerError(res, e); }
  });

  router.get('/announcements/upcoming', requireAuth, async (req: Request, res: Response) => {
    try {
      const caller = callerOf(req);
      const today = todayIst();
      // Each branch uses $1: Postgres rejects a query with an unused parameter.
      const scope = caller.role === 'admin' ? '$1::int IS NOT NULL'
        : caller.role === 'instructor' ? 'c.instructor_id = $1'
        : 'EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = a.course_id AND e.student_id = $1)';
      const { rows } = await pool.query(
        `SELECT ${COLUMNS}, c.code AS course_code, c.name AS course_name
         FROM course_announcements a
         JOIN courses c ON c.id = a.course_id
         LEFT JOIN users u ON u.id = a.author_id
         WHERE a.institution_id = $2 AND a.due_date BETWEEN $3::date AND $4::date AND ${scope}
         ORDER BY a.due_date, a.pinned DESC, a.created_at DESC
         LIMIT 50`,
        [caller.legacyUserId, caller.institutionId, today, addDays(today, 2)]
      );
      res.json(rows);
    } catch (e: any) { sendServerError(res, e); }
  });

  return router;
}
