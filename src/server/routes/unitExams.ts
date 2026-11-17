/**
 * Assessments router (unit tests/CIA, model, end-semester, quiz, lab)
 * Handles: list/create/edit/delete assessments, the marks grid (roster +
 *          bulk save), sheet import preview, publish/unpublish, paper PDF
 *          upload, instructor analytics, and a student's published results.
 *
 * Mounted in server.ts:
 *   app.use('/api/unit-exams', createUnitExamsRouter(pool, supabaseAdmin, nimChat));
 *
 * Security model:
 *   - Instructors may only create/modify exams for courses they own.
 *   - Results are drafts until published; students only see published ones.
 *   - Students may only read their own exam insights (requireSelfOrAdmin guard).
 *   - Admins bypass all ownership checks.
 */

import { Router, Request, Response } from 'express';
import pkg from 'pg';
const { Pool } = pkg;
import { createRequire } from 'module';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  requireAuth,
  requireRole,
  requireSelfOrAdmin,
  AuthenticatedRequest,
} from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';
import { uploadLimiter, aiGradeLimiter } from '../middleware/rateLimit.js';
import { sendServerError } from '../lib/httpErrors.js';
import { log, errorFields } from '../lib/log.js';
import {
  computeResult, readSheetRow, usesGrades, allowedGrades, isAssessmentType, gpaSummary, type ResultRow,
} from '../lib/examGrading.js';
import { markPlansStale } from './roadmaps.js';
import { validatePattern, paperTotal, topicBreakdown, scoreQuestions, type QuestionPattern } from '../lib/questionPattern.js';

const require = createRequire(import.meta.url);
const multer   = require('multer');
const XLSX     = require('xlsx');
const pdfParse = require('pdf-parse');

const EXAM_PAPERS_BUCKET = 'learnit-exam-papers';

// Allowed MIME types for exam paper uploads
const ALLOWED_PAPER_MIMES = new Set(['application/pdf']);

// ── Normalise sheet header names: "Email ID" → email_id, "Marks (50)" → marks_50
function normaliseKey(k: string): string {
  return k.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// ── Parse CSV or XLSX buffer → array of row objects ────────────────────────────
function parseSheet(buffer: Buffer, _mimetype: string, _originalname: string): Record<string, any>[] {
  const wb  = XLSX.read(buffer, { type: 'buffer', raw: false });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const raw: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return raw.map(row => {
    const normalised: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) {
      normalised[normaliseKey(k)] = v;
    }
    return normalised;
  });
}

// ── AI topic extraction from exam paper text ────────────────────────────────────
async function extractTopicsFromPaperText(
  paperText: string,
  nimChat: (msgs: any[], opts?: any) => Promise<string>
): Promise<{ topic: string; weight: number; difficulty: string }[]> {
  const prompt = [
    {
      role: 'system',
      content:
        'You are an educational analyst. Given an exam paper, extract the main topics covered, '
        + 'their approximate weight (percentage of total marks) and difficulty (easy/medium/hard). '
        + 'Respond ONLY with a valid JSON array like '
        + '[{"topic":"Recursion","weight":25,"difficulty":"hard"}]. '
        + 'No explanation, no markdown fences.',
    },
    {
      role: 'user',
      content: paperText.slice(0, 4000),
    },
  ];
  try {
    const raw    = await nimChat(prompt, { temperature: 0.2, maxTokens: 512 });
    const json   = raw.replace(/```[a-z]*/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed;
  } catch (_) {}
  return [];
}

export function createUnitExamsRouter(
  pool: pkg.Pool,
  // Only Storage is used; typing just that keeps any client generics compatible.
  supabaseAdmin: Pick<SupabaseClient, 'storage'>,
  nimChat: (msgs: any[], opts?: any) => Promise<string>
): Router {
  const router = Router();

  const mem        = multer.memoryStorage();
  const uploadFile = multer({
    storage: mem,
    limits: { fileSize: 20 * 1024 * 1024 },
  });

  async function q(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows;
  }
  async function qOne(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows[0] ?? null;
  }

  /**
   * ownsExamCourse — returns true if the instructor (or admin) has access to
   * the course that a given unit_exam belongs to. Admins pass for any exam
   * in their own institution.
   */
  async function ownsExamCourse(
    auth: AuthenticatedRequest['auth'],
    examId: string | number
  ): Promise<boolean> {
    const row = await qOne(
      `SELECT ue.id FROM unit_exams ue
       JOIN courses c ON c.id = ue.course_id
       WHERE ue.id = $1 AND ue.institution_id = $2
         AND ($3::text = 'admin' OR c.instructor_id = $4)`,
      [examId, auth.institutionId, auth.role, auth.legacyUserId]
    );
    return !!row;
  }

  /**
   * ownsCourse — returns true if the instructor owns the given course_id.
   * Admins pass for any course in their own institution.
   */
  async function ownsCourse(
    auth: AuthenticatedRequest['auth'],
    courseId: string | number
  ): Promise<boolean> {
    const row = await qOne(
      `SELECT id FROM courses
       WHERE id = $1 AND institution_id = $2 AND ($3::text = 'admin' OR instructor_id = $4)`,
      [courseId, auth.institutionId, auth.role, auth.legacyUserId]
    );
    return !!row;
  }

  async function uploadPaperToStorage(buffer: Buffer, examId: number, mime: string, ext: string): Promise<string> {
    const objectPath = `exam-papers/${examId}/${Date.now()}${ext}`;
    const { error } = await supabaseAdmin.storage
      .from(EXAM_PAPERS_BUCKET)
      .upload(objectPath, buffer, { contentType: mime, upsert: true });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    return objectPath;
  }

  // Columns returned for an assessment. paper_text (up to 40 KB) stays server-side.
  const EXAM_COLUMNS = `ue.id, ue.course_id, ue.title, ue.exam_date, ue.max_marks, ue.grading_schema,
    ue.assessment_type, ue.internal_max, ue.external_max, ue.credits, ue.semester, ue.grade_scale,
    ue.published_at, ue.published_by, ue.paper_storage_path, ue.analysis_status,
    ue.portion_module_ids, ue.portion_notes, ue.question_pattern, ue.counted_out_of,
    ue.created_by, ue.created_at, ue.updated_at`;

  const MAX_ROWS_PER_SAVE = 2000;

  async function loadExam(auth: AuthenticatedRequest['auth'], examId: string | number) {
    if (!/^\d+$/.test(String(examId))) return null;
    return qOne(
      `SELECT ${EXAM_COLUMNS}, c.name AS course_name, c.code AS course_code
       FROM unit_exams ue JOIN courses c ON c.id = ue.course_id
       WHERE ue.id = $1 AND ue.institution_id = $2
         AND ($3::text = 'admin' OR c.instructor_id = $4)`,
      [examId, auth.institutionId, auth.role, auth.legacyUserId]
    );
  }

  /** Active students enrolled in the course, with their result for this assessment. */
  async function roster(examId: number, courseId: number, institutionId: string) {
    return q(
      `SELECT u.id AS student_id, u.name, u.email,
              r.marks_obtained, r.internal_marks, r.external_marks, r.is_absent,
              r.percentage, r.performance_band, r.grade, r.grade_point, r.remarks, r.updated_at,
              r.question_marks, r.converted_marks
       FROM enrollments e
       JOIN users u ON u.id = e.student_id
       JOIN institution_members im
         ON im.user_id = u.id AND im.institution_id = $3 AND im.role = 'student' AND im.status = 'active'
       LEFT JOIN unit_exam_results r ON r.unit_exam_id = $1 AND r.student_id = u.id
       WHERE e.course_id = $2 AND e.institution_id = $3
       ORDER BY lower(coalesce(u.name, u.email)), u.id`,
      [examId, courseId, institutionId]
    );
  }

  type FieldErrors = Record<string, string>;
  // pg returns DATE columns as Date objects; keep YYYY-MM-DD.
  const dateOnly = (d: unknown): string | null =>
    d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null;
  const toNum = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

  /**
   * Validate assessment fields from a request body. `current` is the stored row
   * for an update (fields not sent keep their value).
   */
  function readExamFields(body: any, current?: any): { values?: any; errors?: FieldErrors } {
    const errors: FieldErrors = {};
    const has = (k: string) => body[k] !== undefined;
    const v: any = {
      title:           has('title') ? String(body.title ?? '').trim() : current?.title,
      exam_date:       has('exam_date') ? (body.exam_date || null) : dateOnly(current?.exam_date),
      assessment_type: has('assessment_type') ? body.assessment_type : current?.assessment_type ?? 'unit_test',
      max_marks:       has('max_marks') ? toNum(body.max_marks) : toNum(current?.max_marks) ?? 100,
      internal_max:    has('internal_max') ? toNum(body.internal_max) : toNum(current?.internal_max),
      external_max:    has('external_max') ? toNum(body.external_max) : toNum(current?.external_max),
      credits:         has('credits') ? toNum(body.credits) : toNum(current?.credits),
      semester:        has('semester') ? toNum(body.semester) : toNum(current?.semester),
      portion_module_ids: has('portion_module_ids')
        ? (Array.isArray(body.portion_module_ids) ? [...new Set(body.portion_module_ids.map(Number))] : null)
        : current?.portion_module_ids ?? null,
      portion_notes:   has('portion_notes') ? (String(body.portion_notes ?? '').trim().slice(0, 1000) || null) : current?.portion_notes ?? null,
      question_pattern: has('question_pattern') ? body.question_pattern ?? null : current?.question_pattern ?? null,
      counted_out_of:  has('counted_out_of') ? toNum(body.counted_out_of) : toNum(current?.counted_out_of),
    };

    // Question-wise entry: the paper total follows from the pattern (for a
    // split assessment the paper is the external part).
    if (v.question_pattern !== null) {
      const r = validatePattern(v.question_pattern);
      if ('error' in r) errors.question_pattern = r.error;
      else {
        v.question_pattern = r.pattern;
        if (v.internal_max !== null || v.external_max !== null) v.external_max = paperTotal(r.pattern);
        else v.max_marks = paperTotal(r.pattern);
      }
    }

    if (!v.title) errors.title = 'Title is required';
    else if (v.title.length > 200) errors.title = 'Title is too long';
    if (!isAssessmentType(v.assessment_type)) errors.assessment_type = 'Unknown assessment type';
    if (v.exam_date !== null && !/^\d{4}-\d{2}-\d{2}/.test(String(v.exam_date))) errors.exam_date = 'Use YYYY-MM-DD';

    // End-semester marks are internal + external; the total follows from them.
    if (v.internal_max !== null || v.external_max !== null) {
      if (!(v.internal_max >= 0) || !(v.external_max > 0)) {
        errors.internal_max = 'Enter both internal and external maximum marks';
      } else {
        v.max_marks = Math.round((v.internal_max + v.external_max) * 100) / 100;
      }
    }
    if (!(v.max_marks > 0) || v.max_marks > 1000) errors.max_marks = 'Maximum marks must be between 1 and 1000';
    if (v.credits !== null && !(v.credits >= 0 && v.credits <= 30)) errors.credits = 'Credits must be 0–30';
    if (v.semester !== null && !(Number.isInteger(v.semester) && v.semester >= 1 && v.semester <= 12)) {
      errors.semester = 'Semester must be 1–12';
    }
    if (v.counted_out_of !== null) {
      if (!(v.counted_out_of > 0 && v.counted_out_of <= 1000)) errors.counted_out_of = '“Counts as” must be between 1 and 1000';
      else if (v.internal_max !== null) errors.counted_out_of = 'Conversion applies to single-total assessments';
    }
    if (v.portion_module_ids && (v.portion_module_ids.length > 100 || v.portion_module_ids.some((n: number) => !Number.isInteger(n) || n <= 0))) {
      errors.portion_module_ids = 'Choose modules from the course';
    }
    return Object.keys(errors).length ? { errors } : { values: v };
  }

  /** Portion modules must belong to the assessment's course. */
  async function portionOk(courseId: number, ids: number[] | null): Promise<boolean> {
    if (!ids || !ids.length) return true;
    const r = await pool.query('SELECT count(*)::int AS n FROM modules WHERE course_id = $1 AND id = ANY($2::int[])', [courseId, ids]);
    return r.rows[0].n === ids.length;
  }

  /** Module ids tagged on a pattern's questions. */
  const patternModuleIds = (p: QuestionPattern | null) =>
    p ? [...new Set(p.parts.flatMap(x => x.questions.flatMap(q => [q.module_id, q.module_id_b ?? null])).filter((n): n is number => !!n))] : [];

  /** The course's module names, for per-unit percentages. */
  async function moduleNames(courseId: number): Promise<Map<number, string>> {
    const r = await pool.query('SELECT id, name FROM modules WHERE course_id = $1', [courseId]);
    return new Map(r.rows.map((m: any) => [m.id, m.name]));
  }

  /** Per-unit % for a computed row, when the exam has a tagged pattern. */
  function withTopics(exam: any, row: ResultRow, names: Map<number, string>) {
    const topics = exam.question_pattern && row.question_marks
      ? topicBreakdown(exam.question_pattern, row.question_marks, names) : null;
    return { ...row, topic_breakdown: topics };
  }

  /** Upsert computed rows and delete cleared ones, in the caller's transaction. */
  async function writeResults(
    client: pkg.PoolClient, examId: number, rows: (ResultRow & { topic_breakdown?: unknown })[], cleared: number[], enteredBy: number
  ) {
    if (rows.length) {
      await client.query(
        `INSERT INTO unit_exam_results
           (unit_exam_id, student_id, marks_obtained, internal_marks, external_marks, is_absent,
            percentage, performance_band, grade, grade_point, remarks, entered_by,
            question_marks, converted_marks, topic_breakdown)
         SELECT $1, x.student_id, x.marks_obtained, x.internal_marks, x.external_marks, x.is_absent,
                x.percentage, x.performance_band, x.grade, x.grade_point, x.remarks, $3,
                x.question_marks, x.converted_marks, x.topic_breakdown
         FROM jsonb_to_recordset($2::jsonb) AS x(
           student_id int, marks_obtained numeric, internal_marks numeric, external_marks numeric,
           is_absent boolean, percentage numeric, performance_band text, grade text,
           grade_point numeric, remarks text, question_marks jsonb, converted_marks numeric,
           topic_breakdown jsonb)
         ON CONFLICT (unit_exam_id, student_id) DO UPDATE SET
           marks_obtained   = EXCLUDED.marks_obtained,
           internal_marks   = EXCLUDED.internal_marks,
           external_marks   = EXCLUDED.external_marks,
           is_absent        = EXCLUDED.is_absent,
           percentage       = EXCLUDED.percentage,
           performance_band = EXCLUDED.performance_band,
           grade            = EXCLUDED.grade,
           grade_point      = EXCLUDED.grade_point,
           remarks          = EXCLUDED.remarks,
           entered_by       = EXCLUDED.entered_by,
           question_marks   = EXCLUDED.question_marks,
           converted_marks  = EXCLUDED.converted_marks,
           topic_breakdown  = EXCLUDED.topic_breakdown,
           updated_at       = NOW()`,
        [examId, JSON.stringify(rows), enteredBy]
      );
    }
    if (cleared.length) {
      await client.query(
        'DELETE FROM unit_exam_results WHERE unit_exam_id = $1 AND student_id = ANY($2::int[])',
        [examId, cleared]
      );
    }
  }

  async function inTransaction<T>(fn: (c: pkg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  const auditBase = (auth: AuthenticatedRequest['auth'], examId: number | string) => ({
    resourceType: 'unit_exam', resourceId: String(examId),
    actorUserId: auth.legacyUserId, actorEmail: auth.email, actorRole: auth.role,
  });

  // ── GET /api/unit-exams  — assessments the caller manages ──────────────────
  // ?course_id= and ?type= filter. Instructors see their courses; admins see
  // the whole college.
  router.get(
    '/',
    requireAuth,
    requireRole('instructor', 'admin'),
    async (req: Request, res: Response) => {
      try {
        const auth = (req as AuthenticatedRequest).auth;
        const courseId = req.query.course_id ? Number(req.query.course_id) : null;
        const type = typeof req.query.type === 'string' ? req.query.type : null;
        if (courseId !== null && !Number.isInteger(courseId)) return res.status(400).json({ error: 'Invalid course_id' });
        if (type !== null && !isAssessmentType(type)) return res.status(400).json({ error: 'Invalid type' });

        const exams = await q(
          `SELECT ${EXAM_COLUMNS}, c.name AS course_name, c.code AS course_code,
                  coalesce(rc.entered, 0)::int AS result_count,
                  coalesce(rc.absent, 0)::int  AS absent_count,
                  coalesce(ec.enrolled, 0)::int AS enrolled_count
           FROM unit_exams ue
           JOIN courses c ON c.id = ue.course_id
           LEFT JOIN LATERAL (
             SELECT count(*) AS entered, count(*) FILTER (WHERE r.is_absent) AS absent
             FROM unit_exam_results r WHERE r.unit_exam_id = ue.id
           ) rc ON true
           LEFT JOIN LATERAL (
             SELECT count(*) AS enrolled FROM enrollments e
             JOIN institution_members im
               ON im.user_id = e.student_id AND im.institution_id = ue.institution_id
              AND im.role = 'student' AND im.status = 'active'
             WHERE e.course_id = ue.course_id
           ) ec ON true
           WHERE ue.institution_id = $1
             AND ($2::text = 'admin' OR c.instructor_id = $3)
             AND ($4::int IS NULL OR ue.course_id = $4)
             AND ($5::text IS NULL OR ue.assessment_type = $5)
           ORDER BY ue.exam_date DESC NULLS LAST, ue.created_at DESC
           LIMIT 500`,
          [auth.institutionId, auth.role, auth.legacyUserId, courseId, type]
        );
        res.json(exams);
      } catch (e: any) { sendServerError(res, e); }
    }
  );

  // ── POST /api/unit-exams  — create an assessment (draft) ────────────────────
  router.post(
    '/',
    requireAuth,
    requireRole('instructor', 'admin'),
    async (req: Request, res: Response) => {
      try {
        const auth = (req as AuthenticatedRequest).auth;
        const { course_id } = req.body;
        if (!course_id) return res.status(400).json({ error: 'course_id is required' });
        if (!(await ownsCourse(auth, course_id))) {
          return res.status(403).json({ error: 'Access denied: not your course' });
        }
        const { values: v, errors } = readExamFields(req.body);
        if (errors) return res.status(422).json({ error: Object.values(errors)[0], fields: errors });

        if (!(await portionOk(Number(course_id), v.portion_module_ids))) {
          return res.status(422).json({ error: 'Choose modules from this course', fields: { portion_module_ids: 'Choose modules from this course' } });
        }
        if (!(await portionOk(Number(course_id), patternModuleIds(v.question_pattern)))) {
          return res.status(422).json({ error: 'Question units must be modules of this course', fields: { question_pattern: 'Question units must be modules of this course' } });
        }
        const schema = req.body.grading_schema ?? { strong: 75, moderate: 50 };
        const r = await pool.query(
          `INSERT INTO unit_exams
             (course_id, title, exam_date, max_marks, grading_schema, created_by,
              assessment_type, internal_max, external_max, credits, semester, portion_module_ids, portion_notes,
              question_pattern, counted_out_of)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
          [course_id, v.title, v.exam_date, v.max_marks, JSON.stringify(schema), auth.legacyUserId,
           v.assessment_type, v.internal_max, v.external_max, v.credits, v.semester, v.portion_module_ids, v.portion_notes,
           v.question_pattern ? JSON.stringify(v.question_pattern) : null, v.counted_out_of]
        );
        if (v.exam_date) await markPlansStale(pool, [Number(course_id)], `${v.title} was scheduled`);
        const examId = r.rows[0].id;
        writeAudit({
          action: 'unit_exam.create', ...auditBase(auth, examId),
          metadata: { course_id, title: v.title, assessment_type: v.assessment_type, question_wise: !!v.question_pattern }, req,
        });
        res.status(201).json(await loadExam(auth, examId));
      } catch (e: any) { sendServerError(res, e); }
    }
  );

  // ── PATCH /api/unit-exams/:id  — edit; stored results are re-graded ─────────
  router.patch(
    '/:id',
    requireAuth,
    requireRole('instructor', 'admin'),
    async (req: Request, res: Response) => {
      try {
        const auth = (req as AuthenticatedRequest).auth;
        const exam = await loadExam(auth, req.params.id);
        if (!exam) return res.status(404).json({ error: 'Assessment not found' });
        const { values: v, errors } = readExamFields(req.body, exam);
        if (errors) return res.status(422).json({ error: Object.values(errors)[0], fields: errors });

        if (!(await portionOk(exam.course_id, v.portion_module_ids))) {
          return res.status(422).json({ error: 'Choose modules from this course', fields: { portion_module_ids: 'Choose modules from this course' } });
        }
        if (!(await portionOk(exam.course_id, patternModuleIds(v.question_pattern)))) {
          return res.status(422).json({ error: 'Question units must be modules of this course', fields: { question_pattern: 'Question units must be modules of this course' } });
        }
        const patternChanged = JSON.stringify(v.question_pattern ?? null) !== JSON.stringify(exam.question_pattern ?? null);
        if (patternChanged && exam.published_at) {
          return res.status(409).json({ error: 'Unpublish the results before changing the question paper' });
        }
        const next = { ...exam, ...v };
        const names = await moduleNames(exam.course_id);
        const out = await inTransaction(async client => {
          // Re-grade what is already entered against the new maximums.
          const { rows: stored } = await client.query(
            `SELECT student_id, is_absent, marks_obtained, internal_marks, external_marks, grade, remarks, question_marks
             FROM unit_exam_results WHERE unit_exam_id = $1 FOR UPDATE`,
            [exam.id]
          );
          const rows: (ResultRow & { topic_breakdown?: unknown })[] = [];
          const problems: { student_id: number; error: string }[] = [];
          for (const s of stored) {
            const split = next.internal_max !== null && next.internal_max !== undefined;
            const entered = {
              student_id: s.student_id, absent: s.is_absent, marks: s.marks_obtained,
              internal: s.internal_marks, external: s.external_marks, remarks: s.remarks,
              questions: s.question_marks,
            };
            // A stored grade that differs from the computed one was a manual
            // override (moderation); keep it. Computed grades are recomputed.
            const before = computeResult(exam, { ...entered, grade: null });
            const overridden = s.grade && !(before.kind === 'row' && before.row.grade === s.grade);
            const r = computeResult(next, {
              ...entered,
              // Switching to a split leaves old totals without parts; reported below.
              internal: split ? s.internal_marks : null,
              external: split ? s.external_marks : null,
              grade: overridden ? s.grade : null,
            });
            if (r.kind === 'row') rows.push(withTopics(next, r.row, names));
            else problems.push({
              student_id: s.student_id,
              error: r.kind === 'error' ? r.error
                : next.question_pattern && !exam.question_pattern ? 'Has a total but no question marks; clear it or enter question marks'
                : 'Marks missing for the new format',
            });
          }
          if (problems.length) return { problems };

          await client.query(
            `UPDATE unit_exams SET title=$2, exam_date=$3, assessment_type=$4, max_marks=$5,
               internal_max=$6, external_max=$7, credits=$8, semester=$9,
               portion_module_ids=$10, portion_notes=$11, question_pattern=$12, counted_out_of=$13, updated_at=NOW()
             WHERE id=$1`,
            [exam.id, v.title, v.exam_date, v.assessment_type, v.max_marks,
             v.internal_max, v.external_max, v.credits, v.semester, v.portion_module_ids, v.portion_notes,
             v.question_pattern ? JSON.stringify(v.question_pattern) : null, v.counted_out_of]
          );
          await writeResults(client, exam.id, rows, [], auth.legacyUserId);
          return { regraded: rows.length };
        });
        if ('problems' in out) {
          return res.status(422).json({
            error: `${out.problems!.length} entered result(s) don't fit the new settings. Fix or clear them first.`,
            results: out.problems!.slice(0, 50),
          });
        }
        const dateMoved = String(v.exam_date ?? '') !== String(dateOnly(exam.exam_date) ?? '');
        const portionChanged = JSON.stringify(v.portion_module_ids ?? null) !== JSON.stringify(exam.portion_module_ids ?? null)
          || (v.portion_notes ?? null) !== (exam.portion_notes ?? null);
        if (dateMoved || portionChanged) {
          await markPlansStale(pool, [exam.course_id], dateMoved ? `${v.title} date changed` : `${v.title} portion changed`);
        }
        writeAudit({
          action: 'unit_exam.update', ...auditBase(auth, exam.id),
          metadata: { fields: Object.keys(req.body), regraded: out.regraded, published: !!exam.published_at }, req,
        });
        res.json(await loadExam(auth, exam.id));
      } catch (e: any) { sendServerError(res, e); }
    }
  );

  // ── DELETE /api/unit-exams/:id  — drafts only ───────────────────────────────
  router.delete(
    '/:id',
    requireAuth,
    requireRole('instructor', 'admin'),
    async (req: Request, res: Response) => {
      try {
        const auth = (req as AuthenticatedRequest).auth;
        const exam = await loadExam(auth, req.params.id);
        if (!exam) return res.status(404).json({ error: 'Assessment not found' });
        if (exam.published_at) {
          return res.status(409).json({ error: 'Unpublish the results before deleting this assessment' });
        }
        const removed = await inTransaction(async client => {
          const r = await client.query('DELETE FROM unit_exam_results WHERE unit_exam_id = $1', [exam.id]);
          await client.query('DELETE FROM unit_exams WHERE id = $1', [exam.id]);
          return r.rowCount ?? 0;
        });
        if (exam.paper_storage_path) {
          supabaseAdmin.storage.from(EXAM_PAPERS_BUCKET).remove([exam.paper_storage_path]).catch(() => {});
        }
        writeAudit({
          action: 'unit_exam.delete', ...auditBase(auth, exam.id),
          metadata: { title: exam.title, course_id: exam.course_id, results_removed: removed }, req,
        });
        res.json({ deleted: true });
      } catch (e: any) { sendServerError(res, e); }
    }
  );

  // ── GET /api/unit-exams/:id/roster  — marks grid ────────────────────────────
  router.get(
    '/:id/roster',
    requireAuth,
    requireRole('instructor', 'admin'),
    async (req: Request, res: Response) => {
      try {
        const auth = (req as AuthenticatedRequest).auth;
        const exam = await loadExam(auth, req.params.id);
        if (!exam) return res.status(404).json({ error: 'Assessment not found' });
        const students = await roster(exam.id, exam.course_id, auth.institutionId);
        res.json({
          exam,
          students,
          grades: usesGrades(exam) ? allowedGrades(exam) : [],
        });
      } catch (e: any) { sendServerError(res, e); }
    }
  );

  // ── PUT /api/unit-exams/:id/results  — save entered marks ───────────────────
  // Body: { results: [{ student_id, marks?, internal?, external?, absent?, grade?, remarks? }] }
  // A row with no marks and not absent clears that student's result. All or
  // nothing: any invalid row rejects the batch with per-student errors.
  router.put(
    '/:id/results',
    requireAuth,
    requireRole('instructor', 'admin'),
    async (req: Request, res: Response) => {
      try {
        const auth = (req as AuthenticatedRequest).auth;
        const exam = await loadExam(auth, req.params.id);
        if (!exam) return res.status(404).json({ error: 'Assessment not found' });

        const input = req.body?.results;
        if (!Array.isArray(input) || input.length === 0) return res.status(400).json({ error: 'results must be a non-empty array' });
        if (input.length > MAX_ROWS_PER_SAVE) return res.status(413).json({ error: `At most ${MAX_ROWS_PER_SAVE} rows per save` });

        const ids = input.map((r: any) => Number(r?.student_id));
        if (ids.some(id => !Number.isInteger(id) || id <= 0)) return res.status(400).json({ error: 'Every row needs a student_id' });
        if (new Set(ids).size !== ids.length) return res.status(400).json({ error: 'A student appears more than once' });

        const { rows: enrolled } = await pool.query(
          `SELECT e.student_id FROM enrollments e
           JOIN institution_members im
             ON im.user_id = e.student_id AND im.institution_id = $2 AND im.role = 'student' AND im.status = 'active'
           WHERE e.course_id = $1 AND e.institution_id = $2 AND e.student_id = ANY($3::int[])`,
          [exam.course_id, auth.institutionId, ids]
        );
        const allowed = new Set(enrolled.map((r: any) => r.student_id));

        const names = exam.question_pattern ? await moduleNames(exam.course_id) : new Map<number, string>();
        const rows: (ResultRow & { topic_breakdown?: unknown })[] = [];
        const cleared: number[] = [];
        const errors: { student_id: number; error: string }[] = [];
        for (const raw of input) {
          const sid = Number(raw.student_id);
          if (!allowed.has(sid)) { errors.push({ student_id: sid, error: 'Not enrolled in this course' }); continue; }
          if (raw.questions !== undefined && raw.questions !== null && (typeof raw.questions !== 'object' || Array.isArray(raw.questions))) {
            errors.push({ student_id: sid, error: 'Question marks must be an object' }); continue;
          }
          const out = computeResult(exam, {
            student_id: sid, absent: raw.absent === true, marks: raw.marks,
            internal: raw.internal, external: raw.external, grade: raw.grade, remarks: raw.remarks,
            questions: raw.questions ?? null,
          });
          if (out.kind === 'row') rows.push(withTopics(exam, out.row, names));
          else if (out.kind === 'clear') cleared.push(sid);
          else errors.push({ student_id: sid, error: out.error });
        }
        if (errors.length) {
          return res.status(422).json({ error: `${errors.length} row(s) need fixing; nothing was saved.`, results: errors });
        }

        await inTransaction(client => writeResults(client, exam.id, rows, cleared, auth.legacyUserId));
        writeAudit({
          action: 'unit_exam.save_marks', ...auditBase(auth, exam.id),
          metadata: { saved: rows.length, cleared: cleared.length, published: !!exam.published_at }, req,
        });
        res.json({ saved: rows, cleared });
      } catch (e: any) { sendServerError(res, e); }
    }
  );

  // ── POST /api/unit-exams/:id/preview-marks  — read a sheet, save nothing ────
  // Matches rows to enrolled students by email or student id and validates
  // them. The page puts the values into the grid; saving goes through PUT
  // /:id/results like typed marks.
  router.post(
    '/:id/preview-marks',
    requireAuth,
    requireRole('instructor', 'admin'),
    uploadLimiter,
    uploadFile.single('file'),
    async (req: any, res: Response) => {
      try {
        const auth = (req as AuthenticatedRequest).auth;
        const exam = await loadExam(auth, req.params.id);
        if (!exam) return res.status(404).json({ error: 'Assessment not found' });
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'file required (CSV or XLSX)' });
        const ext = path.extname(file.originalname).toLowerCase();
        if (!['.csv', '.xlsx', '.xls'].includes(ext)) {
          return res.status(400).json({ error: 'Only .csv, .xlsx, .xls files are accepted' });
        }

        let sheet: Record<string, any>[];
        try { sheet = parseSheet(file.buffer, file.mimetype, file.originalname); }
        catch { return res.status(400).json({ error: 'Could not read that file' }); }
        if (sheet.length > 5000) return res.status(413).json({ error: 'At most 5000 rows per file' });

        const students = await roster(exam.id, exam.course_id, auth.institutionId);
        const byEmail = new Map(students.filter((s: any) => s.email).map((s: any) => [String(s.email).toLowerCase(), s]));
        const byId = new Map(students.map((s: any) => [s.student_id, s]));

        const matched: any[] = [];
        const problems: { row: number; reason: string }[] = [];
        const seen = new Set<number>();
        sheet.forEach((raw, i) => {
          const rowNo = i + 2; // header is row 1
          const r = readSheetRow(raw);
          const s: any = (r.email && byEmail.get(r.email)) || (r.studentId && byId.get(r.studentId));
          if (!s) {
            if (r.email || r.studentId) problems.push({ row: rowNo, reason: 'No enrolled student with that email or id' });
            return; // fully blank rows are ignored
          }
          if (seen.has(s.student_id)) { problems.push({ row: rowNo, reason: `${s.name ?? s.email} appears more than once` }); return; }
          seen.add(s.student_id);
          const out = computeResult(exam, { student_id: s.student_id, ...r.input });
          matched.push({
            row: rowNo, student_id: s.student_id, name: s.name, email: s.email,
            ...r.input, error: out.kind === 'error' ? out.error : null,
          });
        });

        res.json({
          rows_total: sheet.length,
          matched,
          problems: problems.slice(0, 200),
          problems_total: problems.length,
          missing: students.filter((s: any) => !seen.has(s.student_id)).length,
        });
      } catch (e: any) {
        log.error('unit exam marks preview failed', errorFields(e));
        sendServerError(res, e);
      }
    }
  );

  // ── POST /api/unit-exams/:id/publish  /  unpublish ──────────────────────────
  router.post(
    '/:id/publish',
    requireAuth,
    requireRole('instructor', 'admin'),
    async (req: Request, res: Response) => {
      try {
        const auth = (req as AuthenticatedRequest).auth;
        const exam = await loadExam(auth, req.params.id);
        if (!exam) return res.status(404).json({ error: 'Assessment not found' });
        if (exam.published_at) return res.json(exam);

        const count = await qOne('SELECT count(*)::int AS n FROM unit_exam_results WHERE unit_exam_id = $1', [exam.id]);
        if (!count?.n) return res.status(409).json({ error: 'Enter marks before publishing' });

        const notified = await inTransaction(async client => {
          await client.query(
            'UPDATE unit_exams SET published_at = NOW(), published_by = $2, updated_at = NOW() WHERE id = $1',
            [exam.id, auth.legacyUserId]
          );
          if (req.body?.notify === false) return 0;
          const label = exam.course_code ? `${exam.course_code}: ${exam.title}` : exam.title;
          const r = await client.query(
            `INSERT INTO notifications (user_id, type, message, metadata)
             SELECT r.student_id, 'marks_published', $2, jsonb_build_object('unit_exam_id', $1::int, 'course_id', $3::int)
             FROM unit_exam_results r WHERE r.unit_exam_id = $1`,
            [exam.id, `Results published for ${label}`, exam.course_id]
          );
          return r.rowCount ?? 0;
        });
        await markPlansStale(pool, [exam.course_id], `${exam.title} marks are out`);
        writeAudit({
          action: 'unit_exam.publish', ...auditBase(auth, exam.id),
          metadata: { results: count.n, notified }, req,
        });
        res.json(await loadExam(auth, exam.id));
      } catch (e: any) { sendServerError(res, e); }
    }
  );

  router.post(
    '/:id/unpublish',
    requireAuth,
    requireRole('instructor', 'admin'),
    async (req: Request, res: Response) => {
      try {
        const auth = (req as AuthenticatedRequest).auth;
        const exam = await loadExam(auth, req.params.id);
        if (!exam) return res.status(404).json({ error: 'Assessment not found' });
        if (!exam.published_at) return res.json(exam);
        await pool.query(
          'UPDATE unit_exams SET published_at = NULL, published_by = NULL, updated_at = NOW() WHERE id = $1',
          [exam.id]
        );
        writeAudit({ action: 'unit_exam.unpublish', ...auditBase(auth, exam.id), metadata: {}, req });
        res.json(await loadExam(auth, exam.id));
      } catch (e: any) { sendServerError(res, e); }
    }
  );

  // ── GET /api/unit-exams/course/:courseId  — kept for older clients ──────────
  router.get(
    '/course/:courseId',
    requireAuth,
    requireRole('instructor', 'admin'),
    async (req: Request, res: Response) => {
      try {
        const auth = (req as AuthenticatedRequest).auth;
        if (!(await ownsCourse(auth, req.params.courseId))) {
          return res.status(403).json({ error: 'Access denied: not your course' });
        }
        const exams = await q(
          `SELECT ${EXAM_COLUMNS},
                  (SELECT COUNT(*) FROM unit_exam_results r WHERE r.unit_exam_id = ue.id) AS result_count
           FROM unit_exams ue
           WHERE ue.course_id = $1 AND ue.institution_id = $2
           ORDER BY ue.exam_date DESC NULLS LAST, ue.created_at DESC`,
          [req.params.courseId, auth.institutionId]
        );
        res.json(exams);
      } catch (e: any) { sendServerError(res, e); }
    }
  );

  // ── POST /api/unit-exams/:id/upload-paper  — ingest exam PDF ─────────────────
  // aiGradeLimiter applied: PDF upload triggers an LLM call for topic extraction.
  router.post(
    '/:id/upload-paper',
    requireAuth,
    requireRole('instructor', 'admin'),
    uploadLimiter,
    aiGradeLimiter,
    uploadFile.single('file'),
    async (req: any, res: Response) => {
      const examId = req.params.id;
      const auth   = (req as AuthenticatedRequest).auth;
      try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'file required (PDF)' });
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.pdf' || !ALLOWED_PAPER_MIMES.has(file.mimetype)) {
          return res.status(400).json({ error: 'Only PDF files accepted for exam paper' });
        }

        const exam = await qOne('SELECT * FROM unit_exams WHERE id=$1 AND institution_id=$2', [examId, auth.institutionId]);
        if (!exam) return res.status(404).json({ error: 'Exam not found' });

        // Ownership check
        if (!(await ownsExamCourse(auth, examId))) {
          return res.status(403).json({ error: 'Access denied: not your exam' });
        }

        const storedPath = await uploadPaperToStorage(file.buffer, examId, file.mimetype, ext);

        let paperText = '';
        try {
          const parsed = await pdfParse(file.buffer);
          paperText = (parsed.text ?? '').replace(/\x00/g, '').slice(0, 40000);
        } catch (_) {}

        await pool.query(
          `UPDATE unit_exams
           SET paper_storage_path=$1, paper_text=$2, analysis_status='processing', updated_at=NOW()
           WHERE id=$3`,
          [storedPath, paperText, examId]
        );

        // Fire-and-forget: extract topics from paper text via AI
        setImmediate(async () => {
          try {
            if (!paperText.trim()) return;
            const topics = await extractTopicsFromPaperText(paperText, nimChat);
            for (const t of topics) {
              await pool.query(
                `INSERT INTO unit_exam_topic_analysis (unit_exam_id, topic_name, weight, difficulty)
                 VALUES ($1,$2,$3,$4)
                 ON CONFLICT DO NOTHING`,
                [examId, t.topic, t.weight ?? null, t.difficulty ?? null]
              );
            }
            await pool.query(
              `UPDATE unit_exams SET analysis_status='done', updated_at=NOW() WHERE id=$1`,
              [examId]
            );
          } catch (e: any) {
            log.error('unit exam paper analysis failed', errorFields(e));
            await pool.query(
              `UPDATE unit_exams SET analysis_status='failed', updated_at=NOW() WHERE id=$1`,
              [examId]
            ).catch(() => {});
          }
        });

        writeAudit({
          action: 'unit_exam.upload_paper', resourceType: 'unit_exam', resourceId: String(examId),
          actorUserId: auth.legacyUserId, actorEmail: auth.email, actorRole: auth.role,
          metadata: { file: file.originalname, text_length: paperText.length }, req,
        });

        res.json({ success: true, text_length: paperText.length, analysis_status: 'processing' });
      } catch (e: any) {
        log.error('unit exam paper upload failed', errorFields(e));
        sendServerError(res, e);
      }
    }
  );

  // ── GET /api/unit-exams/:id/analytics  — instructor exam analytics ─────────────
  router.get(
    '/:id/analytics',
    requireAuth,
    requireRole('instructor', 'admin'),
    async (req: Request, res: Response) => {
      try {
        const auth    = (req as AuthenticatedRequest).auth;
        const exam    = await loadExam(auth, req.params.id);
        if (!exam) return res.status(404).json({ error: 'Assessment not found' });
        const examId  = exam.id;

        const allResults = await q(
          `SELECT r.student_id, r.marks_obtained, r.internal_marks, r.external_marks, r.is_absent,
                  r.percentage, r.performance_band, r.grade, r.grade_point, r.topic_breakdown,
                  r.question_marks, r.converted_marks,
                  u.name as student_name, u.email as student_email
           FROM unit_exam_results r
           JOIN users u ON r.student_id = u.id
           WHERE r.unit_exam_id = $1
           ORDER BY r.is_absent, r.marks_obtained DESC NULLS LAST`,
          [examId]
        );

        const topics = await q(
          'SELECT topic_name, weight, difficulty FROM unit_exam_topic_analysis WHERE unit_exam_id=$1 ORDER BY weight DESC NULLS LAST',
          [examId]
        );

        // Absent students are listed but left out of averages and pass rate.
        const results = allResults.filter((r: any) => !r.is_absent);
        const absent  = allResults.length - results.length;
        const grades: Record<string, number> = {};
        for (const r of allResults) if (r.grade) grades[r.grade] = (grades[r.grade] ?? 0) + 1;

        const total = results.length;
        if (total === 0) return res.json({ exam, results: allResults, topics, stats: null });

        const marks  = results.map((r: any) => parseFloat(r.marks_obtained));
        const pcts   = results.map((r: any) => parseFloat(r.percentage));
        const avg    = Math.round((marks.reduce((a: number, b: number) => a + b, 0) / total) * 100) / 100;
        const avgPct = Math.round((pcts.reduce((a: number, b: number) => a + b, 0) / total) * 100) / 100;
        const maxM   = Math.max(...marks);
        const minM   = Math.min(...marks);
        const sorted = [...pcts].sort((a, b) => a - b);
        const mid    = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 !== 0
          ? sorted[mid]
          : (sorted[mid - 1] + sorted[mid]) / 2;

        const bands: Record<string, number> = { strong: 0, moderate: 0, weak: 0 };
        for (const r of results) {
          const b = r.performance_band as string;
          if (b && b in bands) bands[b]++;
        }

        const topicScores: Record<string, { total: number; count: number }> = {};
        for (const r of results) {
          if (!r.topic_breakdown) continue;
          const td: Record<string, number> = typeof r.topic_breakdown === 'string'
            ? JSON.parse(r.topic_breakdown) : r.topic_breakdown;
          for (const [t, v] of Object.entries(td)) {
            if (!topicScores[t]) topicScores[t] = { total: 0, count: 0 };
            topicScores[t].total += v as number;
            topicScores[t].count += 1;
          }
        }
        const topicAverages = Object.entries(topicScores)
          .map(([t, { total, count }]) => ({ topic: t, avg: Math.round((total / count) * 100) / 100 }))
          .sort((a, b) => a.avg - b.avg);

        // Question-wise: class average per question (of those who attempted it,
        // and as a share of all writers) and per part.
        let questionStats: any[] | null = null;
        let partStats: any[] | null = null;
        if (exam.question_pattern) {
          const p = exam.question_pattern as QuestionPattern;
          const withQ = results.filter((r: any) => r.question_marks);
          const val = (m: any) => (m === undefined || m === null ? null : typeof m === 'number' ? m : Number(m.m));
          questionStats = p.parts.flatMap(part => part.questions.map(q => {
            const got = withQ.map((r: any) => val(r.question_marks[q.no])).filter((x: number | null): x is number => x !== null);
            const optB = withQ.filter((r: any) => typeof r.question_marks[q.no] === 'object' && r.question_marks[q.no]?.o === 'b').length;
            return {
              no: q.no, part: part.key, max: q.marks,
              attempted_pct: withQ.length ? Math.round((got.length / withQ.length) * 100) : null,
              avg_pct: got.length ? Math.round((got.reduce((a, b) => a + b, 0) / got.length / q.marks) * 1000) / 10 : null,
              option_b: q.either_or ? optB : undefined,
            };
          }));
          partStats = p.parts.map(part => {
            const scores = withQ.map((r: any) => scoreQuestions({ version: 1, parts: [part] },
              Object.fromEntries(part.questions.filter(q => r.question_marks[q.no] !== undefined).map(q => [q.no, r.question_marks[q.no]]))))
              .filter((x: any) => !('error' in x)) as { total: number }[];
            const max = paperTotal({ version: 1, parts: [part] });
            return {
              key: part.key, label: part.label, max,
              avg_pct: scores.length ? Math.round((scores.reduce((a, b) => a + b.total, 0) / scores.length / max) * 1000) / 10 : null,
            };
          });
        }

        // Pass: a passing grade where grades apply, otherwise not in the weak band.
        const failGrades = new Set(['RA', 'AB', 'W', 'U']);
        const passed = usesGrades(exam)
          ? results.filter((r: any) => r.grade && !failGrades.has(r.grade)).length
          : bands.strong + bands.moderate;

        res.json({
          exam,
          results: allResults,
          topics,
          stats: {
            total, absent, grades, avg, avg_pct: avgPct, max_marks: maxM, min_marks: minM, median_pct: median,
            pass_rate: Math.round((passed / total) * 100),
            bands,
            weakest_topics:   topicAverages.slice(0, 3).map(t => t.topic),
            strongest_topics: topicAverages.slice(-3).reverse().map(t => t.topic),
            topic_averages:   topicAverages,
            questions:        questionStats,
            parts:            partStats,
          },
        });
      } catch (e: any) { sendServerError(res, e); }
    }
  );

  // ── GET /api/unit-exams/student/:studentId/insights — a student's results ──
  // Published assessments only. requireSelfOrAdmin: a student reads their own;
  // an admin reads any student in their college.
  // class_avg_pct is shown only when at least 5 students wrote, so it can't be
  // used to work out a classmate's marks.
  router.get(
    '/student/:studentId/insights',
    requireAuth,
    requireSelfOrAdmin('studentId'),
    async (req: Request, res: Response) => {
      try {
        const auth = (req as AuthenticatedRequest).auth;
        const studentId = Number(req.params.studentId);
        const results = await q(
          `SELECT ue.id AS exam_id, ue.title AS exam_title, ue.assessment_type, ue.exam_date,
                  ue.max_marks, ue.internal_max, ue.external_max, ue.credits, ue.semester, ue.grade_scale,
                  ue.question_pattern, ue.counted_out_of,
                  ue.published_at, ue.course_id, c.name AS course_name, c.code AS course_code,
                  r.marks_obtained, r.internal_marks, r.external_marks, r.is_absent,
                  r.percentage, r.performance_band, r.grade, r.grade_point, r.remarks, r.topic_breakdown,
                  r.question_marks, r.converted_marks,
                  CASE WHEN cls.n >= 5 THEN round(cls.avg_pct, 1) END AS class_avg_pct
           FROM unit_exam_results r
           JOIN unit_exams ue ON r.unit_exam_id = ue.id
           JOIN courses c ON ue.course_id = c.id
           LEFT JOIN LATERAL (
             SELECT count(*) AS n, avg(o.percentage) AS avg_pct
             FROM unit_exam_results o
             WHERE o.unit_exam_id = ue.id AND NOT o.is_absent
           ) cls ON true
           WHERE r.student_id = $1 AND r.institution_id = $2 AND ue.published_at IS NOT NULL
           ORDER BY ue.exam_date DESC NULLS LAST, ue.published_at DESC`,
          [studentId, auth.institutionId]
        );

        const weakTopics: Record<string, number> = {};
        for (const r of results) {
          if (r.performance_band !== 'weak' || !r.topic_breakdown) continue;
          const td: Record<string, number> = typeof r.topic_breakdown === 'string'
            ? JSON.parse(r.topic_breakdown) : r.topic_breakdown;
          for (const [t] of Object.entries(td)) weakTopics[t] = (weakTopics[t] ?? 0) + 1;
        }
        const topWeakTopics = Object.entries(weakTopics)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([t]) => t);

        const written = results.filter((r: any) => !r.is_absent && r.percentage !== null);
        const pcts = written.map((r: any) => parseFloat(r.percentage)).filter((n: number) => Number.isFinite(n));
        const overall_avg = pcts.length > 0
          ? Math.round((pcts.reduce((a: number, b: number) => a + b, 0) / pcts.length) * 10) / 10
          : null;

        const gpa = gpaSummary(
          results
            .filter((r: any) => r.assessment_type === 'end_semester')
            .map((r: any) => ({
              semester: r.semester, credits: r.credits, grade: r.grade,
              grade_point: r.grade_point, grade_scale: r.grade_scale,
            }))
        );

        res.json({
          // topic_breakdown is the student's own per-unit %, shown with the breakdown.
          results: results.map(({ grade_scale, ...r }: any) => r),
          latest: written[0] ?? null,
          overall_avg,
          weak_topics: topWeakTopics,
          gpa,
        });
      } catch (e: any) { sendServerError(res, e); }
    }
  );

  // ── GET /api/unit-exams/:id  — get single exam ──────────────────────────────────
  router.get(
    '/:id',
    requireAuth,
    requireRole('instructor', 'admin'),
    async (req: Request, res: Response) => {
      try {
        const auth = (req as AuthenticatedRequest).auth;
        const exam = await loadExam(auth, req.params.id);
        if (!exam) return res.status(404).json({ error: 'Assessment not found' });
        res.json(exam);
      } catch (e: any) { sendServerError(res, e); }
    }
  );

  return router;
}
