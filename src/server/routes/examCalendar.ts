/**
 * Upcoming exams for the signed-in person, and their phone-calendar feed.
 *
 *   GET  /api/exams/upcoming            ?from=YYYY-MM-DD&days=N (default today, 120)
 *   GET  /api/calendar/feed-link        { exists, created_at }
 *   POST /api/calendar/feed-link        new private link (replaces the old one)
 *   DELETE /api/calendar/feed-link      turn the link off
 *   GET  /api/calendar/:token.ics       the feed (no login; the token is the key)
 *
 * Who sees what, from published timetables only:
 *   student    exams of courses they're enrolled in, plus rows without a
 *              course for their department and year
 *   professor  exams of the courses they teach
 *   admin      every exam in the college
 */

import { Router, Request, Response } from 'express';
import type pkg from 'pg';
import crypto from 'node:crypto';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { sendServerError } from '../lib/httpErrors.js';
import { writeAudit } from '../middleware/audit.js';
import { buildCalendar } from '../lib/ics.js';

type Who = { userId: number; institutionId: string; role: string };

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** SQL for one person's exams in a date range ($1 user, $2 college, $3 from, $4 to). */
const EXAMS_SQL = (role: string) => `
  SELECT e.id, to_char(e.exam_date, 'YYYY-MM-DD') AS exam_date, e.session,
         to_char(e.start_time, 'HH24:MI') AS start_time, to_char(e.end_time, 'HH24:MI') AS end_time,
         coalesce(c.code, e.course_code) AS course_code, coalesce(c.name, e.course_name) AS course_name,
         e.course_id, t.title, t.assessment_type, e.venue, d.code AS department_code, e.year_of_study,
         e.unit_exam_id, greatest(e.updated_at, t.updated_at) AS updated_at
  FROM exam_timetable_entries e
  JOIN exam_timetables t ON t.id = e.timetable_id AND t.status = 'published'
  LEFT JOIN courses c ON c.id = e.course_id
  LEFT JOIN departments d ON d.id = e.department_id
  WHERE e.institution_id = $2 AND e.exam_date BETWEEN $3 AND $4
    AND ${role === 'admin' ? 'true'
      : role === 'instructor' ? 'c.instructor_id = $1'
      : `(EXISTS (SELECT 1 FROM enrollments en WHERE en.course_id = e.course_id AND en.student_id = $1)
          OR (e.course_id IS NULL AND EXISTS (
            SELECT 1 FROM institution_members im
            WHERE im.user_id = $1 AND im.institution_id = $2 AND im.status = 'active'
              AND im.department_id = e.department_id AND im.year_of_study = e.year_of_study)))`}
  ORDER BY e.exam_date, e.start_time NULLS LAST, e.session NULLS LAST, course_code
  LIMIT 500`;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
/** Today in India, as a UTC-midnight Date. */
const todayIst = () => new Date(ymd(new Date(Date.now() + 330 * 60_000)) + 'T00:00:00Z');

export function createExamCalendarRouter(pool: pkg.Pool, opts: { publicApiUrl?: string } = {}): Router {
  const router = Router();
  const whoOf = (req: Request): Who => {
    const a = (req as AuthenticatedRequest).auth;
    return { userId: a.legacyUserId, institutionId: a.institutionId, role: a.role };
  };
  const exams = (w: Who, from: Date, to: Date) => pool.query(EXAMS_SQL(w.role), [w.userId, w.institutionId, ymd(from), ymd(to)]).then(r => r.rows);
  const baseUrl = (req: Request) => (opts.publicApiUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

  router.get('/exams/upcoming', requireAuth, async (req: Request, res: Response) => {
    try {
      const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from ?? '')) ? new Date(`${req.query.from}T00:00:00Z`) : todayIst();
      const days = Math.min(Math.max(Number(req.query.days) || 120, 1), 366);
      res.json(await exams(whoOf(req), from, addDays(from, days)));
    } catch (e: any) { sendServerError(res, e); }
  });

  router.get('/calendar/feed-link', requireAuth, async (req: Request, res: Response) => {
    try {
      const w = whoOf(req);
      const { rows } = await pool.query(
        'SELECT created_at, last_used_at FROM calendar_feed_tokens WHERE user_id = $1 AND institution_id = $2',
        [w.userId, w.institutionId]
      );
      res.json({ exists: !!rows[0], created_at: rows[0]?.created_at ?? null, last_used_at: rows[0]?.last_used_at ?? null });
    } catch (e: any) { sendServerError(res, e); }
  });

  // The link is shown once; only its hash is kept. A new one revokes the old.
  router.post('/calendar/feed-link', requireAuth, async (req: Request, res: Response) => {
    try {
      const w = whoOf(req);
      const token = crypto.randomBytes(24).toString('base64url');
      await pool.query(
        `INSERT INTO calendar_feed_tokens (user_id, institution_id, token_hash) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, institution_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = now(), last_used_at = NULL`,
        [w.userId, w.institutionId, sha256(token)]
      );
      writeAudit({ action: 'calendar.link_created', resourceType: 'calendar_feed', resourceId: String(w.userId),
        actorUserId: w.userId, actorEmail: (req as AuthenticatedRequest).auth.email, actorRole: w.role, metadata: {}, req });
      const url = `${baseUrl(req)}/api/calendar/${token}.ics`;
      res.status(201).json({ url, webcal: url.replace(/^https?:/, 'webcal:') });
    } catch (e: any) { sendServerError(res, e); }
  });

  router.delete('/calendar/feed-link', requireAuth, async (req: Request, res: Response) => {
    try {
      const w = whoOf(req);
      await pool.query('DELETE FROM calendar_feed_tokens WHERE user_id = $1 AND institution_id = $2', [w.userId, w.institutionId]);
      res.json({ deleted: true });
    } catch (e: any) { sendServerError(res, e); }
  });

  router.get('/calendar/:token.ics', async (req: Request, res: Response) => {
    try {
      const token = req.params.token;
      if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return res.status(404).type('text/plain').send('Not found');
      const { rows: [owner] } = await pool.query(
        `UPDATE calendar_feed_tokens f SET last_used_at = now()
         FROM institution_members im, institutions i
         WHERE f.token_hash = $1 AND im.user_id = f.user_id AND im.institution_id = f.institution_id
           AND im.status = 'active' AND i.id = f.institution_id
         RETURNING f.user_id, f.institution_id, im.role, i.name AS college`,
        [sha256(token)]
      );
      if (!owner) return res.status(404).type('text/plain').send('This calendar link has been turned off. Make a new one in LearnIT.');
      const role = ['institution_admin', 'institution_owner'].includes(owner.role) ? 'admin' : owner.role;
      const today = todayIst();
      const rows = await exams({ userId: owner.user_id, institutionId: owner.institution_id, role }, addDays(today, -30), addDays(today, 365));
      const ics = buildCalendar(rows, { name: `Exams · ${owner.college}` });
      res.set('Cache-Control', 'private, max-age=900');
      res.set('X-Robots-Tag', 'noindex');
      res.type('text/calendar; charset=utf-8').send(ics);
    } catch (e: any) { sendServerError(res, e); }
  });

  return router;
}
