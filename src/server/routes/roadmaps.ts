/**
 * roadmaps.ts — P3-3 (updated: grading feedback + unit exam context)
 *
 * Mounted at /api/roadmaps by server.ts.
 *
 * Routes:
 *   GET    /api/roadmaps/:courseId          — get student's roadmap + milestones
 *   POST   /api/roadmaps/:courseId/generate — AI-generate (or regenerate) roadmap
 *   PATCH  /api/roadmaps/milestones/:id     — update a milestone's status
 *   DELETE /api/roadmaps/:courseId          — delete roadmap (cascade milestones)
 *
 * Roadmap generation pulls:
 *   1. ai_feedback (strengths + improvements) from graded submissions
 *   2. unit exam results (band, trend, weak topics) from unit_exam_results
 * Both are injected into the AI prompt so milestones target real measured gaps.
 */

import { Router } from 'express';
import pkg from 'pg';
const { Pool } = pkg;
import {
  requireAuth,
  requireRole,
  AuthenticatedRequest,
} from '../middleware/auth.js';

type PgPool = InstanceType<typeof Pool>;

type NimChatFn = (
  messages: { role: string; content: string }[],
  opts?: { temperature?: number; maxTokens?: number }
) => Promise<string>;

export function createRoadmapRouter(pool: PgPool, nimChat: NimChatFn): Router {
  const router = Router();

  async function q(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows;
  }
  async function q1(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows[0] ?? null;
  }

  // ── GET /api/roadmaps/:courseId ─────────────────────────────────────────
  router.get('/:courseId', requireAuth, async (req, res) => {
    try {
      const studentId = (req as AuthenticatedRequest).auth.legacyUserId;
      const courseId  = req.params.courseId;

      const roadmap = await q1(
        `SELECT * FROM student_roadmaps
         WHERE student_id = $1 AND course_id = $2`,
        [studentId, courseId]
      );

      if (!roadmap) {
        return res.status(404).json({ error: 'No roadmap yet — call POST .../generate to create one.' });
      }

      const milestones = await q(
        `SELECT id, step_order, title, description, resource_hint, status, completed_at
         FROM roadmap_milestones
         WHERE roadmap_id = $1
         ORDER BY step_order ASC`,
        [roadmap.id]
      );

      res.json({ ...roadmap, milestones });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/roadmaps/:courseId/generate ───────────────────────────────
  router.post('/:courseId/generate', requireAuth, requireRole('student'), async (req, res) => {
    try {
      const studentId = (req as AuthenticatedRequest).auth.legacyUserId;
      const courseId  = req.params.courseId;

      // ─ Verify enrollment ─────────────────────────────────────────────────
      const enrollment = await q1(
        `SELECT e.id FROM enrollments e
         JOIN courses c ON e.course_id = c.id
         WHERE e.student_id = $1 AND e.course_id = $2 AND c.archived = 0`,
        [studentId, courseId]
      );
      if (!enrollment) {
        return res.status(403).json({ error: 'Not enrolled in this course.' });
      }

      // ─ Gather all context in parallel ────────────────────────────────────
      const [
        course,
        modules,
        gradeHistory,
        pendingAssignments,
        feedbackRows,
        examRows,
      ] = await Promise.all([
        q1(`SELECT name, code FROM courses WHERE id = $1`, [courseId]),

        q(`SELECT name FROM modules WHERE course_id = $1 ORDER BY display_order ASC`, [courseId]),

        q(
          `SELECT a.title, s.grade, s.submitted_at, a.due_date, a.max_points,
                  CASE
                    WHEN a.due_date IS NOT NULL
                     AND s.submitted_at::date > a.due_date::date THEN true
                    ELSE false
                  END AS late
           FROM submissions s
           JOIN assignments a ON s.assignment_id = a.id
           JOIN modules m ON a.module_id = m.id
           WHERE s.student_id = $1 AND m.course_id = $2
           ORDER BY s.submitted_at ASC`,
          [studentId, courseId]
        ),

        q(
          `SELECT a.title, a.due_date
           FROM assignments a
           JOIN modules m ON a.module_id = m.id
           WHERE m.course_id = $1
             AND a.status = 'active'
             AND NOT EXISTS (
               SELECT 1 FROM submissions s
               WHERE s.assignment_id = a.id AND s.student_id = $2
             )
           ORDER BY a.due_date ASC NULLS LAST`,
          [courseId, studentId]
        ),

        // Grading AI feedback from submissions
        q(
          `SELECT s.ai_feedback, a.title AS assignment_title
           FROM submissions s
           JOIN assignments a ON s.assignment_id = a.id
           JOIN modules m     ON a.module_id = m.id
           WHERE s.student_id = $1
             AND m.course_id  = $2
             AND s.ai_feedback IS NOT NULL
             AND s.ai_feedback != 'null'`,
          [studentId, courseId]
        ),

        // Unit exam results for this course
        q(
          `SELECT r.marks_obtained, r.percentage, r.performance_band, r.topic_breakdown,
                  ue.title AS exam_title, ue.exam_date, ue.max_marks
           FROM unit_exam_results r
           JOIN unit_exams ue ON r.unit_exam_id = ue.id
           WHERE r.student_id = $1 AND ue.course_id = $2
           ORDER BY ue.exam_date ASC NULLS LAST, r.created_at ASC`,
          [studentId, courseId]
        ),
      ]);

      // ─ Aggregate strengths + improvements from AI feedback ───────────────
      const allStrengths:    string[] = [];
      const allImprovements: string[] = [];

      for (const row of feedbackRows) {
        try {
          const fb = typeof row.ai_feedback === 'string'
            ? JSON.parse(row.ai_feedback)
            : row.ai_feedback;
          for (const s   of (fb?.strengths    ?? [])) { if (s) allStrengths.push(s); }
          for (const imp of (fb?.improvements ?? [])) { if (imp) allImprovements.push(imp); }
        } catch { /* skip malformed */ }
      }

      const uniqueStrengths    = [...new Set(allStrengths)].slice(0, 5);
      const uniqueImprovements = [...new Set(allImprovements)].slice(0, 5);

      // ─ Aggregate unit exam weak topics + trend ───────────────────────────
      const examWeakTopics: Record<string, number> = {};
      for (const r of examRows) {
        if (r.performance_band !== 'weak' || !r.topic_breakdown) continue;
        const td: Record<string, number> =
          typeof r.topic_breakdown === 'string'
            ? JSON.parse(r.topic_breakdown)
            : r.topic_breakdown;
        for (const topic of Object.keys(td)) {
          examWeakTopics[topic] = (examWeakTopics[topic] ?? 0) + 1;
        }
      }
      const topExamWeakTopics = Object.entries(examWeakTopics)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([t]) => t);

      // Determine exam trend (improving / declining / stable)
      let examTrend = '';
      if (examRows.length >= 2) {
        const pcts = examRows.map((r: any) => parseFloat(r.percentage));
        const first = pcts.slice(0, Math.ceil(pcts.length / 2));
        const last  = pcts.slice(Math.floor(pcts.length / 2));
        const avgFirst = first.reduce((a: number, b: number) => a + b, 0) / first.length;
        const avgLast  = last.reduce((a: number, b: number) => a + b, 0) / last.length;
        if (avgLast - avgFirst >= 5)        examTrend = 'improving';
        else if (avgFirst - avgLast >= 5)   examTrend = 'declining';
        else                                examTrend = 'stable';
      }

      const latestExam = examRows[examRows.length - 1] ?? null;

      // ─ Build prompt context ───────────────────────────────────────────────
      const moduleList = modules.map((m: any) => m.name).join(', ');

      const gradeLines = gradeHistory.length > 0
        ? gradeHistory.map((g: any) =>
            `  - ${g.title}: ${g.grade != null ? g.grade + '%' : 'ungraded'}${
              g.late ? ' (LATE)' : ''
            }`
          ).join('\n')
        : '  (no submissions yet)';

      const pendingLines = pendingAssignments.length > 0
        ? pendingAssignments.map((a: any) =>
            `  - ${a.title}${
              a.due_date ? ' (due ' + new Date(a.due_date).toLocaleDateString() + ')' : ''
            }`
          ).join('\n')
        : '  (none pending)';

      const avgGrade = gradeHistory.length > 0
        ? Math.round(
            gradeHistory
              .filter((g: any) => g.grade != null)
              .reduce((sum: number, g: any) => sum + g.grade, 0) /
            Math.max(1, gradeHistory.filter((g: any) => g.grade != null).length)
          )
        : null;

      const feedbackSection = feedbackRows.length > 0
        ? [
            ``,
            `AI GRADING FEEDBACK (from ${feedbackRows.length} graded submission(s)):`,
            uniqueStrengths.length > 0
              ? `RECURRING STRENGTHS:\n${uniqueStrengths.map(s => `  + ${s}`).join('\n')}`
              : '',
            uniqueImprovements.length > 0
              ? `AREAS TO IMPROVE (shape milestones around these):\n${uniqueImprovements.map(i => `  ! ${i}`).join('\n')}`
              : '',
          ].filter(Boolean).join('\n')
        : '';

      // Unit exam section — only included if there are exam results
      const examSection = examRows.length > 0
        ? [
            ``,
            `UNIT EXAM RESULTS (${examRows.length} exam(s) in this course):`,
            ...examRows.map((r: any) =>
              `  - ${r.exam_title ?? 'Exam'}${
                r.exam_date ? ' (' + new Date(r.exam_date).toLocaleDateString() + ')' : ''
              }: ${parseFloat(r.percentage).toFixed(1)}% — ${r.performance_band?.toUpperCase() ?? 'N/A'}`
            ),
            latestExam
              ? `LATEST EXAM BAND: ${latestExam.performance_band?.toUpperCase()}`
              : '',
            examTrend
              ? `EXAM SCORE TREND: ${examTrend}`
              : '',
            topExamWeakTopics.length > 0
              ? `MEASURED WEAK TOPICS (from exam topic breakdown, highest priority for milestones):\n${
                  topExamWeakTopics.map(t => `  !! ${t}`).join('\n')
                }`
              : '',
          ].filter(Boolean).join('\n')
        : '';

      const prompt = [
        `COURSE: ${course.code} — ${course.name}`,
        `MODULES: ${moduleList}`,
        ``,
        `STUDENT GRADE HISTORY:`,
        gradeLines,
        `OVERALL AVERAGE: ${avgGrade != null ? avgGrade + '%' : 'N/A'}`,
        ``,
        `PENDING ASSIGNMENTS:`,
        pendingLines,
        feedbackSection,
        examSection,
      ].join('\n');

      // ─ Call AI ───────────────────────────────────────────────────────────
      const systemMsg = [
        'You are an academic learning path advisor AI.',
        'Given a student\'s course context and performance, generate a personalised learning roadmap.',
        'Priority order for milestone topics:',
        '  1. MEASURED WEAK TOPICS from unit exam topic breakdown (highest signal — address these first)',
        '  2. AREAS TO IMPROVE from AI grading feedback',
        '  3. Pending assignments that need immediate attention',
        '  4. Consolidation of strengths and forward advancement',
        'If EXAM SCORE TREND is "declining", add a motivational recovery milestone early.',
        'Respond ONLY with valid JSON in this exact shape (no markdown fences):',
        '{',
        '  "title": "<short roadmap title>",',
        '  "summary": "<2-3 sentence overview referencing exam performance, trend, and key weaknesses>",',
        '  "milestones": [',
        '    {',
        '      "title": "<step title>",',
        '      "description": "<1-2 sentence explanation — be specific, reference actual topics and exam names>",',
        '      "resource_hint": "<where in the course to find help, or null>"',
        '    }',
        '  ]',
        '}',
        'Generate 5-8 milestones. Reference actual module names, assignment titles, exam names, and improvement areas.',
        'Be specific and actionable. Avoid generic advice.',
      ].join('\n');

      const raw = await nimChat(
        [
          { role: 'system', content: systemMsg },
          { role: 'user',   content: prompt },
        ],
        { temperature: 0.4, maxTokens: 1400 }
      );

      let parsed: { title: string; summary: string; milestones: any[] };
      try {
        parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      } catch {
        parsed = { title: 'Learning Roadmap', summary: raw.slice(0, 300), milestones: [] };
      }

      const title      = parsed.title   || 'My Learning Roadmap';
      const summary    = parsed.summary || null;
      const milestones: any[] = Array.isArray(parsed.milestones) ? parsed.milestones : [];

      // ─ Upsert roadmap row ─────────────────────────────────────────────────
      const upsertResult = await pool.query(
        `INSERT INTO student_roadmaps (student_id, course_id, title, summary, generated_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (student_id, course_id)
         DO UPDATE SET
           title        = EXCLUDED.title,
           summary      = EXCLUDED.summary,
           generated_at = NOW(),
           updated_at   = NOW()
         RETURNING id`,
        [studentId, courseId, title, summary]
      );
      const roadmapId: number = upsertResult.rows[0].id;

      // ─ Replace all milestones ─────────────────────────────────────────────
      await pool.query(`DELETE FROM roadmap_milestones WHERE roadmap_id = $1`, [roadmapId]);

      for (let i = 0; i < milestones.length; i++) {
        const m = milestones[i];
        await pool.query(
          `INSERT INTO roadmap_milestones
             (roadmap_id, step_order, title, description, resource_hint)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            roadmapId, i + 1,
            (m.title        || `Step ${i + 1}`).slice(0, 200),
            m.description   || null,
            m.resource_hint || null,
          ]
        );
      }

      const saved = await q(
        `SELECT id, step_order, title, description, resource_hint, status, completed_at
         FROM roadmap_milestones WHERE roadmap_id = $1 ORDER BY step_order ASC`,
        [roadmapId]
      );

      res.json({
        id: roadmapId, student_id: studentId, course_id: parseInt(courseId),
        title, summary, generated_at: new Date().toISOString(), milestones: saved,
      });
    } catch (e: any) {
      console.error('[roadmaps/generate] error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── PATCH /api/roadmaps/milestones/:id ───────────────────────────────────
  router.patch('/milestones/:id', requireAuth, async (req, res) => {
    try {
      const studentId   = (req as AuthenticatedRequest).auth.legacyUserId;
      const milestoneId = req.params.id;
      const { status }  = req.body as { status: string };

      const allowed = ['pending', 'in_progress', 'completed'];
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
      }

      const owned = await q1(
        `SELECT m.id FROM roadmap_milestones m
         JOIN student_roadmaps r ON m.roadmap_id = r.id
         WHERE m.id = $1 AND r.student_id = $2`,
        [milestoneId, studentId]
      );
      if (!owned) return res.status(403).json({ error: 'Milestone not found or access denied.' });

      await pool.query(
        `UPDATE roadmap_milestones
         SET status       = $1,
             completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE NULL END
         WHERE id = $2`,
        [status, milestoneId]
      );

      await pool.query(
        `UPDATE student_roadmaps r SET updated_at = NOW()
         FROM roadmap_milestones m WHERE m.id = $1 AND m.roadmap_id = r.id`,
        [milestoneId]
      );

      res.json({ success: true, status });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── DELETE /api/roadmaps/:courseId ───────────────────────────────────────
  router.delete('/:courseId', requireAuth, async (req, res) => {
    try {
      const studentId = (req as AuthenticatedRequest).auth.legacyUserId;
      const courseId  = req.params.courseId;
      await pool.query(
        `DELETE FROM student_roadmaps WHERE student_id = $1 AND course_id = $2`,
        [studentId, courseId]
      );
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
