/**
 * Exam timetables (admin): upload, review, publish.
 *
 *   GET    /api/admin/timetables                    list
 *   POST   /api/admin/timetables                    multipart: file, title, assessment_type
 *   GET    /api/admin/timetables/:id                timetable + rows (with matches and problems)
 *   GET    /api/admin/timetables/:id/source         signed link to the uploaded file (10 min)
 *   POST   /api/admin/timetables/:id/entries        add a row
 *   PATCH  /api/admin/timetables/:id/entries/:eid   fix a row (re-matched to a course)
 *   DELETE /api/admin/timetables/:id/entries/:eid   remove a row
 *   POST   /api/admin/timetables/:id/publish        schedule exams and notify people
 *   DELETE /api/admin/timetables/:id                drafts only
 *
 * Excel/CSV with one exam per row is read directly. Images, PDFs and grid
 * layouts are read by AI in a background job (timetable.extract); the admin
 * reviews every row before publishing either way.
 *
 * Publishing creates (or moves) a draft assessment per course with the exam
 * date, so the professor only enters marks, and notifies the course's
 * professor and students (enrolled students, plus students of the row's
 * department and year when the row has no course).
 */

import { verifyUploadedContent } from '../middleware/verifyUploads.js';
import { Router, Request, Response } from 'express';
import type pkg from 'pg';
import path from 'path';
import { createRequire } from 'module';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { sendServerError } from '../lib/httpErrors.js';
import { log, errorFields } from '../lib/log.js';
import { isAssessmentType } from '../lib/examGrading.js';
import { resolveDepartmentId, yearOfSemester } from '../lib/departments.js';
import {
  normaliseEntry, readTimetableRow, isRowPerExam, matchCourse, defaultMarks, parseDate, parseTime, parseOrdinal, entryProblems,
  type Entry, type CourseRef, type RawEntry,
} from '../lib/timetable.js';
import type { JobQueue } from '../lib/jobs.js';
import { markPlansStale } from './roadmaps.js';
import { readSpreadsheet } from '../lib/spreadsheet.js';

export { readSpreadsheet };


const require = createRequire(import.meta.url);
const multer = require('multer');

export const TIMETABLE_BUCKET = 'learnit-timetables';
const MAX_ROWS = 600;

const KINDS: Record<string, { kind: 'xlsx' | 'csv' | 'image' | 'pdf'; mime: string }> = {
  '.xlsx': { kind: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  '.xls':  { kind: 'xlsx', mime: 'application/vnd.ms-excel' },
  '.csv':  { kind: 'csv',  mime: 'text/csv' },
  '.png':  { kind: 'image', mime: 'image/png' },
  '.jpg':  { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' },
  '.webp': { kind: 'image', mime: 'image/webp' },
  '.pdf':  { kind: 'pdf',  mime: 'application/pdf' },
};

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

/**
 * Match normalised rows to courses and departments and insert them.
 * Department: the row's own (by code or name), else the course's. Year: the
 * row's, else from its semester, else from the course's semester.
 */
export async function storeEntries(db: Db, institutionId: string, timetableId: number, entries: Entry[]): Promise<number> {
  if (!entries.length) return 0;
  const { rows: courses } = await db.query(
    'SELECT id, code, name, department_id, semester FROM courses WHERE institution_id = $1 AND coalesce(archived, 0) = 0',
    [institutionId]
  );
  const deptCache = new Map<string, number | null>();
  const rows = [];
  for (const e of entries.slice(0, MAX_ROWS)) {
    const { course } = matchCourse(e, courses as CourseRef[]);
    let departmentId: number | null = null;
    if (e.department_text) {
      if (!deptCache.has(e.department_text)) deptCache.set(e.department_text, await resolveDepartmentId(db, institutionId, e.department_text));
      departmentId = deptCache.get(e.department_text) ?? null;
    }
    departmentId ??= course?.department_id ?? null;
    const year = e.year_of_study ?? (e.semester ? yearOfSemester(e.semester) : null) ?? (course?.semester ? yearOfSemester(course.semester) : null);
    rows.push({
      row_number: e.row_number, exam_date: e.exam_date, session: e.session, start_time: e.start_time, end_time: e.end_time,
      course_code: e.course_code, course_name: e.course_name, department_text: e.department_text,
      department_id: departmentId, year_of_study: year, semester: e.semester ?? course?.semester ?? null,
      venue: e.venue, course_id: course?.id ?? null,
    });
  }
  const r = await db.query(
    `INSERT INTO exam_timetable_entries
       (timetable_id, institution_id, row_number, exam_date, session, start_time, end_time, course_code, course_name,
        department_text, department_id, year_of_study, semester, venue, course_id)
     SELECT $1, $2, x.row_number, x.exam_date, x.session, x.start_time, x.end_time, x.course_code, x.course_name,
            x.department_text, x.department_id, x.year_of_study, x.semester, x.venue, x.course_id
     FROM jsonb_to_recordset($3::jsonb) AS x(
       row_number int, exam_date date, session text, start_time time, end_time time, course_code text, course_name text,
       department_text text, department_id int, year_of_study smallint, semester smallint, venue text, course_id int)`,
    [timetableId, institutionId, JSON.stringify(rows)]
  );
  return r.rowCount ?? rows.length;
}

const ENTRY_SELECT = `
  SELECT e.id, e.row_number, to_char(e.exam_date, 'YYYY-MM-DD') AS exam_date, e.session,
         to_char(e.start_time, 'HH24:MI') AS start_time, to_char(e.end_time, 'HH24:MI') AS end_time,
         e.course_code, e.course_name, e.department_text, e.department_id, d.code AS department_code,
         e.year_of_study, e.semester, e.venue, e.course_id, c.code AS matched_code, c.name AS matched_name,
         u.name AS professor_name, e.unit_exam_id
  FROM exam_timetable_entries e
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN courses c ON c.id = e.course_id
  LEFT JOIN users u ON u.id = c.instructor_id`;

export function createTimetablesRouter(pool: pkg.Pool, supabaseAdmin: Pick<SupabaseClient, 'storage'>, jobs: JobQueue): Router {
  const router = Router();
  const admin = [requireAuth, requireRole('admin')];
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  const authOf = (req: Request) => (req as AuthenticatedRequest).auth;
  const audit = (req: Request, action: string, id: number | string, metadata: Record<string, unknown>) => {
    const a = authOf(req);
    writeAudit({ action, resourceType: 'exam_timetable', resourceId: String(id), actorUserId: a.legacyUserId, actorEmail: a.email, actorRole: a.role, metadata, req });
  };

  async function loadTimetable(institutionId: string, id: unknown) {
    if (!/^\d+$/.test(String(id))) return null;
    const { rows } = await pool.query('SELECT * FROM exam_timetables WHERE id = $1 AND institution_id = $2', [id, institutionId]);
    return rows[0] ?? null;
  }

  async function detail(institutionId: string, id: number) {
    const t = await loadTimetable(institutionId, id);
    if (!t) return null;
    const { rows } = await pool.query(`${ENTRY_SELECT} WHERE e.timetable_id = $1 ORDER BY e.exam_date NULLS FIRST, e.session NULLS LAST, e.start_time NULLS LAST, e.row_number, e.id`, [id]);
    const { source_path, ...timetable } = t;
    return { timetable: { ...timetable, has_source: !!source_path }, entries: rows.map((r: any) => ({ ...r, problems: entryProblems(r) })) };
  }

  // Timetable ids are numbers; anything else is simply not found (not a 500).
  router.param('id', (req, res, next, id) => {
    if (/^\d{1,10}$/.test(String(id))) return next();
    res.status(404).json({ error: 'Timetable not found' });
  });

  router.get('/timetables', ...admin, async (req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT t.id, t.title, t.assessment_type, t.status, t.source_kind, t.source_name, t.published_at, t.created_at,
                count(e.id)::int AS exams,
                count(e.id) FILTER (WHERE e.course_id IS NOT NULL)::int AS matched,
                min(e.exam_date) AS first_date, max(e.exam_date) AS last_date
         FROM exam_timetables t LEFT JOIN exam_timetable_entries e ON e.timetable_id = t.id
         WHERE t.institution_id = $1
         GROUP BY t.id ORDER BY t.created_at DESC LIMIT 200`,
        [authOf(req).institutionId]
      );
      res.json(rows);
    } catch (e: any) { sendServerError(res, e); }
  });

  router.post('/timetables', ...admin, uploadLimiter, upload.single('file'), verifyUploadedContent, async (req: any, res: Response) => {
    const auth = authOf(req);
    try {
      const file = req.file;
      const title = String(req.body?.title ?? '').trim().slice(0, 200);
      const type = req.body?.assessment_type;
      if (!file) return res.status(400).json({ error: 'Choose a timetable file' });
      if (!title) return res.status(422).json({ error: 'Give the timetable a title, like "Unit test 2"' });
      if (!isAssessmentType(type)) return res.status(422).json({ error: 'Choose the exam type' });
      const ext = path.extname(file.originalname).toLowerCase();
      const k = KINDS[ext];
      if (!k) return res.status(400).json({ error: 'Upload Excel (.xlsx), CSV, PDF or an image (PNG/JPG)' });
      if (k.kind === 'image' && file.size > 5 * 1024 * 1024) return res.status(413).json({ error: 'Images must be under 5 MB' });

      // Read spreadsheets now; decide whether AI is needed.
      let sheet: ReturnType<typeof readSpreadsheet> | null = null;
      if (k.kind === 'xlsx' || k.kind === 'csv') {
        try { sheet = readSpreadsheet(file.buffer); }
        catch { return res.status(400).json({ error: "That spreadsheet couldn't be opened" }); }
        if (!sheet.csv.trim()) return res.status(422).json({ error: 'The first sheet is empty' });
      }
      const direct = !!sheet && isRowPerExam(sheet.headers);

      const { rows: [t] } = await pool.query(
        `INSERT INTO exam_timetables (institution_id, title, assessment_type, status, source_kind, source_name, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [auth.institutionId, title, type, direct ? 'draft' : 'extracting', k.kind, file.originalname.slice(0, 200), auth.legacyUserId]
      );
      const objectPath = `${auth.institutionId}/${t.id}${ext}`;
      const { error: upErr } = await supabaseAdmin.storage.from(TIMETABLE_BUCKET).upload(objectPath, file.buffer, { contentType: k.mime, upsert: true });
      if (upErr) log.warn('timetable source upload failed', { timetableId: t.id, reason: upErr.message });
      else await pool.query('UPDATE exam_timetables SET source_path = $2 WHERE id = $1', [t.id, objectPath]);

      if (direct) {
        const entries = sheet!.rows.slice(0, MAX_ROWS).map((r, i) => normaliseEntry(readTimetableRow(r, i + 2)));
        const usable = entries.filter(e => e.exam_date || e.course_code || e.course_name);
        await storeEntries(pool, auth.institutionId, t.id, usable);
        if (sheet!.rows.length > MAX_ROWS) {
          await pool.query('UPDATE exam_timetables SET extraction_note = $2 WHERE id = $1', [t.id, `Only the first ${MAX_ROWS} rows were read.`]);
        }
      } else {
        await jobs.enqueue('timetable.extract', { timetableId: t.id, ...(sheet ? { csv: sheet.csv.slice(0, 60_000) } : {}) }, {
          institutionId: auth.institutionId, createdBy: auth.legacyUserId, dedupeKey: `timetable:${t.id}`, maxAttempts: 3,
        });
      }
      audit(req, 'exam_timetable.upload', t.id, { kind: k.kind, read: direct ? 'direct' : 'ai' });
      res.status(201).json(await detail(auth.institutionId, t.id));
    } catch (e: any) {
      log.error('timetable upload failed', errorFields(e));
      sendServerError(res, e);
    }
  });

  router.get('/timetables/:id', ...admin, async (req: Request, res: Response) => {
    try {
      const d = await detail(authOf(req).institutionId, Number(req.params.id));
      if (!d) return res.status(404).json({ error: 'Timetable not found' });
      res.json(d);
    } catch (e: any) { sendServerError(res, e); }
  });

  router.get('/timetables/:id/source', ...admin, async (req: Request, res: Response) => {
    try {
      const t = await loadTimetable(authOf(req).institutionId, req.params.id);
      if (!t?.source_path) return res.status(404).json({ error: 'No file stored for this timetable' });
      const { data, error } = await supabaseAdmin.storage.from(TIMETABLE_BUCKET).createSignedUrl(t.source_path, 600);
      if (error || !data) return res.status(502).json({ error: "The file can't be opened right now" });
      res.json({ url: data.signedUrl, kind: t.source_kind, name: t.source_name });
    } catch (e: any) { sendServerError(res, e); }
  });

  /** Fields an admin may set on a row; text inputs are parsed like the upload. */
  function readEntryBody(b: any): { values?: Record<string, unknown>; error?: string } {
    const v: Record<string, unknown> = {};
    if (b.exam_date !== undefined) {
      const d = b.exam_date ? parseDate(b.exam_date) : null;
      if (b.exam_date && !d) return { error: 'Date not understood; use DD/MM/YYYY' };
      v.exam_date = d;
    }
    if (b.session !== undefined || b.time !== undefined) {
      const t = parseTime(`${b.session ?? ''} ${b.time ?? ''}`.trim());
      v.session = t.session; v.start_time = t.start; v.end_time = t.end;
    }
    for (const [k, max] of [['course_code', 50], ['course_name', 255], ['venue', 200]] as const) {
      if (b[k] !== undefined) v[k] = b[k] ? String(b[k]).trim().slice(0, max) || null : null;
    }
    if (v.course_code) v.course_code = String(v.course_code).toUpperCase().replace(/\s+/g, '');
    if (b.year_of_study !== undefined) v.year_of_study = b.year_of_study === null || b.year_of_study === '' ? null : parseOrdinal(b.year_of_study, 10);
    if (b.department_id !== undefined) v.department_id = b.department_id === null || b.department_id === '' ? null : Number(b.department_id);
    if (b.course_id !== undefined) v.course_id = b.course_id === null || b.course_id === '' ? null : Number(b.course_id);
    return { values: v };
  }

  async function ensureRefs(institutionId: string, v: Record<string, unknown>): Promise<string | null> {
    if (v.department_id) {
      const r = await pool.query('SELECT 1 FROM departments WHERE id = $1 AND institution_id = $2', [v.department_id, institutionId]);
      if (!r.rows.length) return 'Department not found';
    }
    if (v.course_id) {
      const r = await pool.query('SELECT 1 FROM courses WHERE id = $1 AND institution_id = $2', [v.course_id, institutionId]);
      if (!r.rows.length) return 'Course not found';
    }
    return null;
  }

  router.patch('/timetables/:id/entries/:eid', ...admin, async (req: Request, res: Response) => {
    try {
      const auth = authOf(req);
      const t = await loadTimetable(auth.institutionId, req.params.id);
      if (!t) return res.status(404).json({ error: 'Timetable not found' });
      const { values, error } = readEntryBody(req.body ?? {});
      if (error) return res.status(422).json({ error });
      const refErr = await ensureRefs(auth.institutionId, values!);
      if (refErr) return res.status(422).json({ error: refErr });

      // A changed code or name re-matches the course unless one was chosen.
      if ((values!.course_code !== undefined || values!.course_name !== undefined) && values!.course_id === undefined) {
        const { rows: [cur] } = await pool.query('SELECT course_code, course_name FROM exam_timetable_entries WHERE id = $1 AND timetable_id = $2', [req.params.eid, t.id]);
        if (cur) {
          const { rows: courses } = await pool.query('SELECT id, code, name, department_id, semester FROM courses WHERE institution_id = $1', [auth.institutionId]);
          const m = matchCourse({ course_code: (values!.course_code ?? cur.course_code) as string | null, course_name: (values!.course_name ?? cur.course_name) as string | null }, courses);
          values!.course_id = m.course?.id ?? null;
        }
      }
      const cols = Object.keys(values!);
      if (!cols.length) return res.status(400).json({ error: 'Nothing to change' });
      const sets = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
      const { rows } = await pool.query(
        `UPDATE exam_timetable_entries SET ${sets}, updated_at = now() WHERE id = $1 AND timetable_id = $2 RETURNING id`,
        [req.params.eid, t.id, ...cols.map(c => values![c])]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Row not found' });
      const { rows: [entry] } = await pool.query(`${ENTRY_SELECT} WHERE e.id = $1`, [rows[0].id]);
      res.json({ ...entry, problems: entryProblems(entry) });
    } catch (e: any) { sendServerError(res, e); }
  });

  router.post('/timetables/:id/entries', ...admin, async (req: Request, res: Response) => {
    try {
      const auth = authOf(req);
      const t = await loadTimetable(auth.institutionId, req.params.id);
      if (!t) return res.status(404).json({ error: 'Timetable not found' });
      const b = req.body ?? {};
      const raw: RawEntry = { date: b.exam_date, session: b.session, time: b.time, course_code: b.course_code, course_name: b.course_name, year: b.year_of_study, venue: b.venue };
      const entry = normaliseEntry(raw);
      if (!entry.exam_date && !entry.course_code && !entry.course_name) return res.status(422).json({ error: 'Enter at least a date and a course' });
      await storeEntries(pool, auth.institutionId, t.id, [entry]);
      res.status(201).json(await detail(auth.institutionId, t.id));
    } catch (e: any) { sendServerError(res, e); }
  });

  router.delete('/timetables/:id/entries/:eid', ...admin, async (req: Request, res: Response) => {
    try {
      const auth = authOf(req);
      const t = await loadTimetable(auth.institutionId, req.params.id);
      if (!t) return res.status(404).json({ error: 'Timetable not found' });
      const r = await pool.query('DELETE FROM exam_timetable_entries WHERE id = $1 AND timetable_id = $2', [req.params.eid, t.id]);
      if (!r.rowCount) return res.status(404).json({ error: 'Row not found' });
      res.json({ deleted: true });
    } catch (e: any) { sendServerError(res, e); }
  });

  router.post('/timetables/:id/publish', ...admin, async (req: Request, res: Response) => {
    const auth = authOf(req);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [t] } = await client.query('SELECT * FROM exam_timetables WHERE id = $1 AND institution_id = $2 FOR UPDATE', [req.params.id, auth.institutionId]);
      if (!t) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Timetable not found' }); }
      if (t.status === 'extracting') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'The file is still being read' }); }
      const { rows: entries } = await client.query(
        `SELECT e.*, c.instructor_id FROM exam_timetable_entries e LEFT JOIN courses c ON c.id = e.course_id
         WHERE e.timetable_id = $1 ORDER BY e.exam_date, e.id FOR UPDATE OF e`,
        [t.id]
      );
      if (!entries.length) { await client.query('ROLLBACK'); return res.status(422).json({ error: 'There are no exams to publish' }); }
      const undated = entries.filter((e: any) => !e.exam_date).length;
      if (undated) { await client.query('ROLLBACK'); return res.status(422).json({ error: `${undated} row(s) have no date. Fix or remove them first.` }); }

      // One assessment per course: created once, then kept in step with the timetable.
      const marks = defaultMarks(t.assessment_type);
      const examByCourse = new Map<number, number>();
      let created = 0, moved = 0;
      for (const e of entries.filter((x: any) => x.course_id)) {
        let examId = e.unit_exam_id ?? examByCourse.get(e.course_id) ?? null;
        if (examId) {
          // Only the date follows the timetable; the professor may have renamed it.
          const r = await client.query(
            `UPDATE unit_exams SET exam_date = $2, updated_at = now()
             WHERE id = $1 AND course_id = $3 AND exam_date IS DISTINCT FROM $2 RETURNING id`,
            [examId, e.exam_date, e.course_id]
          );
          if (r.rowCount) moved++;
        } else {
          const r = await client.query(
            `INSERT INTO unit_exams (course_id, title, exam_date, max_marks, internal_max, external_max, assessment_type, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [e.course_id, t.title, e.exam_date, marks.max, marks.internal, marks.external, t.assessment_type, e.instructor_id ?? auth.legacyUserId]
          );
          examId = r.rows[0].id;
          created++;
        }
        examByCourse.set(e.course_id, examId!);
        if (e.unit_exam_id !== examId) await client.query('UPDATE exam_timetable_entries SET unit_exam_id = $2 WHERE id = $1', [e.id, examId]);
      }

      const republish = t.status === 'published';
      await client.query(
        `UPDATE exam_timetables SET status = 'published', published_at = coalesce(published_at, now()), published_by = $2, updated_at = now() WHERE id = $1`,
        [t.id, auth.legacyUserId]
      );

      // Professors of the courses, and their students (enrolled, or in the
      // row's department and year when it has no course). One note each.
      const what = `${t.title} timetable`;
      const meta = JSON.stringify({ timetable_id: t.id });
      const prof = await client.query(
        `INSERT INTO notifications (user_id, type, message, metadata)
         SELECT DISTINCT c.instructor_id, 'exam_schedule', $3, $4::jsonb
         FROM exam_timetable_entries e JOIN courses c ON c.id = e.course_id
         WHERE e.timetable_id = $1 AND c.instructor_id IS NOT NULL AND c.institution_id = $2`,
        [t.id, auth.institutionId, republish ? `${what} was updated. Check your exam dates.` : `${what} is out. Your exams are on your calendar; marks can be entered under Assessments.`, meta]
      );
      const stud = await client.query(
        `INSERT INTO notifications (user_id, type, message, metadata)
         SELECT DISTINCT s.student_id, 'exam_schedule', $3, $4::jsonb FROM (
           SELECT en.student_id FROM exam_timetable_entries e JOIN enrollments en ON en.course_id = e.course_id
           JOIN institution_members im ON im.user_id = en.student_id AND im.institution_id = $2
            AND im.role = 'student' AND im.status = 'active'
           WHERE e.timetable_id = $1 AND en.institution_id = $2
           UNION
           SELECT im.user_id FROM exam_timetable_entries e JOIN institution_members im
             ON im.institution_id = $2 AND im.department_id = e.department_id AND im.year_of_study = e.year_of_study
            AND im.role = 'student' AND im.status = 'active'
           WHERE e.timetable_id = $1 AND e.course_id IS NULL
         ) s`,
        [t.id, auth.institutionId, republish ? `${what} was updated. Check your exam dates.` : `${what} is out. See your upcoming exams.`, meta]
      );
      // Study plans for these courses now have new exam dates to plan to.
      const courseIds = [...new Set(entries.filter((e: any) => e.course_id).map((e: any) => Number(e.course_id)))] as number[];
      await markPlansStale(client, courseIds, republish ? `${t.title} dates changed` : `${t.title} dates are out`);
      await client.query('COMMIT');
      audit(req, republish ? 'exam_timetable.republish' : 'exam_timetable.publish', t.id, {
        exams: entries.length, assessments_created: created, assessments_moved: moved,
        notified_professors: prof.rowCount, notified_students: stud.rowCount,
      });
      res.json({ ...(await detail(auth.institutionId, t.id)), result: { created, moved, professors: prof.rowCount, students: stud.rowCount } });
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => {});
      sendServerError(res, e);
    } finally {
      client.release();
    }
  });

  router.delete('/timetables/:id', ...admin, async (req: Request, res: Response) => {
    try {
      const auth = authOf(req);
      const t = await loadTimetable(auth.institutionId, req.params.id);
      if (!t) return res.status(404).json({ error: 'Timetable not found' });
      if (t.status === 'published') return res.status(409).json({ error: 'A published timetable stays; edit its rows and publish again instead' });
      await pool.query('DELETE FROM exam_timetables WHERE id = $1', [t.id]);
      if (t.source_path) supabaseAdmin.storage.from(TIMETABLE_BUCKET).remove([t.source_path]).catch(() => {});
      audit(req, 'exam_timetable.delete', t.id, { title: t.title });
      res.json({ deleted: true });
    } catch (e: any) { sendServerError(res, e); }
  });

  return router;
}
