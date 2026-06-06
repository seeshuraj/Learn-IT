/**
 * Unit Exams Router
 * Handles: create exam, upload marks (CSV/XLSX), upload paper PDF,
 *          analytics for instructor, exam insights for student.
 *
 * Mounted in server.ts:
 *   app.use('/api/unit-exams', createUnitExamsRouter(pool, supabaseAdmin, nimChat));
 *
 * Security model:
 *   - Instructors may only create/modify exams for courses they own.
 *   - Students may only read their own exam insights (requireSelfOrAdmin guard).
 *   - Admins bypass all ownership checks.
 */

import { Router, Request, Response } from 'express';
import pkg from 'pg';
const { Pool } = pkg;
import { createRequire } from 'module';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import {
  requireAuth,
  requireRole,
  requireSelfOrAdmin,
  AuthenticatedRequest,
} from '../middleware/auth.js';
import { writeAudit } from '../middleware/audit.js';
import { uploadLimiter, aiGradeLimiter } from '../middleware/rateLimit.js';

const require = createRequire(import.meta.url);
const multer   = require('multer');
const XLSX     = require('xlsx');
const pdfParse = require('pdf-parse');

const EXAM_PAPERS_BUCKET = 'learnit-exam-papers';

// Allowed MIME types for exam paper uploads
const ALLOWED_PAPER_MIMES = new Set(['application/pdf']);
const ALLOWED_SHEET_MIMES = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'application/octet-stream', // some browsers send this for .csv
]);

// ── Performance band thresholds (configurable per exam via grading_schema) ───
function computeBand(
  percentage: number,
  schema: { strong: number; moderate: number }
): 'strong' | 'moderate' | 'weak' {
  if (percentage >= schema.strong)   return 'strong';
  if (percentage >= schema.moderate) return 'moderate';
  return 'weak';
}

// ── Normalise sheet header names ─────────────────────────────────────────────────
function normaliseKey(k: string): string {
  return k.trim().toLowerCase().replace(/\s+/g, '_');
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

// ── Resolve student_id from email or id column ───────────────────────────────────
async function resolveStudent(
  pool: pkg.Pool,
  row: Record<string, any>
): Promise<number | null> {
  const email = row['student_email'] || row['email'] || '';
  if (email) {
    const r = await pool.query('SELECT id FROM users WHERE email=$1 AND role=$2', [email.trim(), 'student']);
    if (r.rows[0]) return r.rows[0].id;
  }
  const sid = row['student_id'] || row['id'] || '';
  if (sid) {
    const r = await pool.query('SELECT id FROM users WHERE id=$1 AND role=$2', [sid, 'student']);
    if (r.rows[0]) return r.rows[0].id;
  }
  return null;
}

// ── Extract marks from row ──────────────────────────────────────────────────────
function extractMarks(row: Record<string, any>): number | null {
  const keys = ['marks_obtained', 'marks', 'score', 'total', 'obtained'];
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== '') {
      const v = parseFloat(row[k]);
      if (!isNaN(v)) return v;
    }
  }
  return null;
}

// ── Extract optional topic breakdown from row ──────────────────────────────────────
function extractTopicBreakdown(row: Record<string, any>): Record<string, number> | null {
  const reserved = new Set([
    'student_email','email','student_id','id',
    'marks_obtained','marks','score','total','obtained','remarks','comments',
  ]);
  const topics: Record<string, number> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!reserved.has(k) && v !== '') {
      const n = parseFloat(v);
      if (!isNaN(n)) topics[k] = n;
    }
  }
  return Object.keys(topics).length > 0 ? topics : null;
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
  supabaseAdmin: ReturnType<typeof createClient>,
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
   * the course that a given unit_exam belongs to. Admins always pass.
   */
  async function ownsExamCourse(
    auth: AuthenticatedRequest['auth'],
    examId: string | number
  ): Promise<boolean> {
    if (auth.role === 'admin') return true;
    const row = await qOne(
      `SELECT ue.id FROM unit_exams ue
       JOIN courses c ON c.id = ue.course_id
       WHERE ue.id = $1 AND c.instructor_id = $2`,
      [examId, auth.legacyUserId]
    );
    return !!row;
  }

  /**
   * ownsCourse — returns true if the instructor owns the given course_id.
   * Admins always pass.
   */
  async function ownsCourse(
    auth: AuthenticatedRequest['auth'],
    courseId: string | number
  ): Promise<boolean> {
    if (auth.role === 'admin') return true;
    const row = await qOne(
      'SELECT id FROM courses WHERE id=$1 AND instructor_id=$2',
      [courseId, auth.legacyUserId]
    );
    return !!row;
  }

  async function uploadPaperToStorage(buffer: Buffer, examId: number, mime: string, ext: string): Promise<string> {
    const objectPath = `exam-papers/${examId}/${Date.now()}${ext}`;
    const { error } = await (supabaseAdmin.storage as any)
      .from(EXAM_PAPERS_BUCKET)
      .upload(objectPath, buffer, { contentType: mime, upsert: true });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    return objectPath;
  }

  // ── POST /api/unit-exams  — create exam metadata ────────────────────────────────
  router.post(
    '/',
    requireAuth,
    requireRole('instructor', 'admin'),
    async (req: Request, res: Response) => {
      try {
        const auth = (req as AuthenticatedRequest).auth;
        const { course_id, title, exam_date, max_marks, grading_schema } = req.body;
        if (!course_id || !title) return res.status(400).json({ error: 'course_id and title are required' });

        // Ownership: instructor must own the course
        if (!(await ownsCourse(auth, course_id))) {
          return res.status(403).json({ error: 'Access denied: not your course' });
        }

        const maxM   = parseFloat(max_marks) || 100;
        const schema = grading_schema ?? { strong: 75, moderate: 50 };
        const r = await pool.query(
          `INSERT INTO unit_exams (course_id, title, exam_date, max_marks, grading_schema, created_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [course_id, title, exam_date ?? null, maxM, JSON.stringify(schema), auth.legacyUserId]
        );
        const examId = r.rows[0].id;
        writeAudit({
          action: 'unit_exam.create', resourceType: 'unit_exam', resourceId: String(examId),
          actorUserId: auth.legacyUserId, actorEmail: auth.email, actorRole: auth.role,
          metadata: { course_id, title }, req,
        });
        res.status(201).json({ id: examId });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
  );

  // ── GET /api/unit-exams/course/:courseId  — list exams for a course ────────────
  router.get(
    '/course/:courseId',
    requireAuth,
    requireRole('instructor', 'admin'),
    async (req: Request, res: Response) => {
      try {
        const auth = (req as AuthenticatedRequest).auth;

        // Ownership: instructor may only list their own course's exams
        if (!(await ownsCourse(auth, req.params.courseId))) {
          return res.status(403).json({ error: 'Access denied: not your course' });
        }

        const exams = await q(
          `SELECT ue.*,
                  (SELECT COUNT(*) FROM unit_exam_results r WHERE r.unit_exam_id = ue.id) AS result_count
           FROM unit_exams ue
           WHERE ue.course_id = $1
           ORDER BY ue.exam_date DESC, ue.created_at DESC`,
          [req.params.courseId]
        );
        res.json(exams);
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
  );

  // ── POST /api/unit-exams/:id/upload-marks  — ingest CSV / XLSX ─────────────────
  router.post(
    '/:id/upload-marks',
    requireAuth,
    requireRole('instructor', 'admin'),
    uploadLimiter,
    uploadFile.single('file'),
    async (req: any, res: Response) => {
      const examId = req.params.id;
      const auth   = (req as AuthenticatedRequest).auth;
      try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'file required (CSV or XLSX)' });

        const ext     = path.extname(file.originalname).toLowerCase();
        const allowed = ['.csv', '.xlsx', '.xls'];
        if (!allowed.includes(ext)) {
          return res.status(400).json({ error: 'Only .csv, .xlsx, .xls files are accepted' });
        }

        const exam = await qOne('SELECT * FROM unit_exams WHERE id=$1', [examId]);
        if (!exam) return res.status(404).json({ error: 'Exam not found' });

        // Ownership check
        if (!(await ownsExamCourse(auth, examId))) {
          return res.status(403).json({ error: 'Access denied: not your exam' });
        }

        const importType = ext === '.csv' ? 'csv' : 'xlsx';
        const ir = await pool.query(
          `INSERT INTO unit_exam_imports
             (unit_exam_id, file_name, import_type, status, imported_by)
           VALUES ($1,$2,$3,'processing',$4) RETURNING id`,
          [examId, file.originalname, importType, auth.legacyUserId]
        );
        const importId  = ir.rows[0].id;
        const rows      = parseSheet(file.buffer, file.mimetype, file.originalname);
        const schema    = exam.grading_schema as { strong: number; moderate: number };
        const maxMarks  = parseFloat(exam.max_marks);

        const errors: any[]   = [];
        const inserted: any[] = [];
        let matched = 0;

        for (let i = 0; i < rows.length; i++) {
          const row       = rows[i];
          const studentId = await resolveStudent(pool, row);
          const marks     = extractMarks(row);
          const topics    = extractTopicBreakdown(row);

          if (!studentId) {
            errors.push({ row: i + 2, reason: 'Student not found', data: row });
            continue;
          }
          if (marks === null) {
            errors.push({ row: i + 2, reason: 'No marks column found', data: row });
            continue;
          }
          if (marks < 0 || marks > maxMarks) {
            errors.push({ row: i + 2, reason: `Marks ${marks} out of valid range [0, ${maxMarks}]`, data: row });
            continue;
          }

          const pct  = Math.round((marks / maxMarks) * 10000) / 100;
          const band = computeBand(pct, schema);

          await pool.query(
            `INSERT INTO unit_exam_results
               (unit_exam_id, student_id, marks_obtained, percentage, performance_band, topic_breakdown, raw_row)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (unit_exam_id, student_id)
             DO UPDATE SET
               marks_obtained   = EXCLUDED.marks_obtained,
               percentage       = EXCLUDED.percentage,
               performance_band = EXCLUDED.performance_band,
               topic_breakdown  = EXCLUDED.topic_breakdown,
               raw_row          = EXCLUDED.raw_row,
               updated_at       = NOW()`,
            [examId, studentId, marks, pct, band, topics ? JSON.stringify(topics) : null, JSON.stringify(row)]
          );
          matched++;
          inserted.push({ studentId, marks, band, pct });
        }

        await pool.query(
          `UPDATE unit_exam_imports
           SET status=$1, rows_total=$2, rows_matched=$3, rows_failed=$4, error_report=$5
           WHERE id=$6`,
          [
            errors.length > 0 && matched === 0 ? 'failed' : 'done',
            rows.length, matched, errors.length,
            errors.length > 0 ? JSON.stringify(errors) : null,
            importId,
          ]
        );

        writeAudit({
          action: 'unit_exam.import_marks', resourceType: 'unit_exam', resourceId: String(examId),
          actorUserId: auth.legacyUserId, actorEmail: auth.email, actorRole: auth.role,
          metadata: { file: file.originalname, rows_total: rows.length, matched, failed: errors.length }, req,
        });

        res.json({
          import_id:    importId,
          rows_total:   rows.length,
          rows_matched: matched,
          rows_failed:  errors.length,
          errors:       errors.slice(0, 20),
          preview:      inserted.slice(0, 10),
        });
      } catch (e: any) {
        console.error('[unit-exams/upload-marks]', e.message);
        res.status(500).json({ error: e.message });
      }
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

        const exam = await qOne('SELECT * FROM unit_exams WHERE id=$1', [examId]);
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
            console.error('[unit-exams/upload-paper] async analysis error:', e.message);
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
        console.error('[unit-exams/upload-paper]', e.message);
        res.status(500).json({ error: e.message });
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
        const examId  = req.params.id;
        const auth    = (req as AuthenticatedRequest).auth;
        const exam    = await qOne('SELECT * FROM unit_exams WHERE id=$1', [examId]);
        if (!exam) return res.status(404).json({ error: 'Exam not found' });

        // Ownership check
        if (!(await ownsExamCourse(auth, examId))) {
          return res.status(403).json({ error: 'Access denied: not your exam' });
        }

        const results = await q(
          `SELECT r.*, u.name as student_name, u.email as student_email
           FROM unit_exam_results r
           JOIN users u ON r.student_id = u.id
           WHERE r.unit_exam_id = $1
           ORDER BY r.marks_obtained DESC`,
          [examId]
        );

        const topics = await q(
          'SELECT * FROM unit_exam_topic_analysis WHERE unit_exam_id=$1 ORDER BY weight DESC',
          [examId]
        );

        const total = results.length;
        if (total === 0) return res.json({ exam, results: [], topics, stats: null });

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

        res.json({
          exam,
          results,
          topics,
          stats: {
            total, avg, avg_pct: avgPct, max_marks: maxM, min_marks: minM, median_pct: median,
            pass_rate: Math.round(((bands.strong + bands.moderate) / total) * 100),
            bands,
            weakest_topics:   topicAverages.slice(0, 3).map(t => t.topic),
            strongest_topics: topicAverages.slice(-3).reverse().map(t => t.topic),
          },
        });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
  );

  // ── GET /api/unit-exams/student/:studentId/insights — student exam summary ───
  // requireSelfOrAdmin ensures students can only read their own data.
  // Instructors and admins can access any student.
  router.get(
    '/student/:studentId/insights',
    requireAuth,
    requireSelfOrAdmin('studentId'),
    async (req: Request, res: Response) => {
      try {
        const studentId = req.params.studentId;
        const results   = await q(
          `SELECT r.marks_obtained, r.percentage, r.performance_band, r.topic_breakdown,
                  ue.title as exam_title, ue.exam_date, ue.max_marks, ue.course_id,
                  c.name as course_name, c.code as course_code
           FROM unit_exam_results r
           JOIN unit_exams ue ON r.unit_exam_id = ue.id
           JOIN courses c ON ue.course_id = c.id
           WHERE r.student_id = $1
           ORDER BY ue.exam_date DESC, r.created_at DESC`,
          [studentId]
        );

        const weakTopics: Record<string, number> = {};
        for (const r of results) {
          if (r.performance_band !== 'weak' || !r.topic_breakdown) continue;
          const td: Record<string, number> = typeof r.topic_breakdown === 'string'
            ? JSON.parse(r.topic_breakdown) : r.topic_breakdown;
          for (const [t] of Object.entries(td)) {
            weakTopics[t] = (weakTopics[t] ?? 0) + 1;
          }
        }
        const topWeakTopics = Object.entries(weakTopics)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([t]) => t);

        const latest      = results[0] ?? null;
        const allPcts     = results.map((r: any) => parseFloat(r.percentage)).filter(Boolean);
        const overall_avg = allPcts.length > 0
          ? Math.round((allPcts.reduce((a: number, b: number) => a + b, 0) / allPcts.length) * 10) / 10
          : null;

        res.json({ results, latest, overall_avg, weak_topics: topWeakTopics });
      } catch (e: any) { res.status(500).json({ error: e.message }); }
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
        const exam = await qOne('SELECT * FROM unit_exams WHERE id=$1', [req.params.id]);
        if (!exam) return res.status(404).json({ error: 'Exam not found' });

        // Ownership check
        if (!(await ownsExamCourse(auth, req.params.id))) {
          return res.status(403).json({ error: 'Access denied: not your exam' });
        }

        res.json(exam);
      } catch (e: any) { res.status(500).json({ error: e.message }); }
    }
  );

  return router;
}
