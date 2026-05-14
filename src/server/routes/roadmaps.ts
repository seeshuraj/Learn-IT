/**
 * roadmaps.ts — P3-3
 *
 * Mounted at /api/roadmaps by server.ts.
 *
 * Routes:
 *   GET    /api/roadmaps/:courseId          — get student's roadmap + milestones for a course
 *   POST   /api/roadmaps/:courseId/generate — AI-generate (or regenerate) roadmap
 *   PATCH  /api/roadmaps/milestones/:id     — update a milestone's status
 *   DELETE /api/roadmaps/:courseId          — delete roadmap (and cascade milestones)
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

// nimChat is injected from server.ts at mount time to avoid re-importing the
// NVIDIA SDK. We accept it as a factory parameter.
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
  // Returns the student's roadmap for this course, including milestones.
  // Returns 404 (not generated yet) or the roadmap object.
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
  // Generates (or regenerates) an AI learning roadmap for this student + course.
  // Context fed to the model:
  //   - Course name + modules
  //   - Student's submission/grade history for this course
  //   - Pending/missed assignments
  // Idempotent: upserts the roadmap row and replaces all milestone rows.
  router.post('/:courseId/generate', requireAuth, requireRole('student'), async (req, res) => {
    try {
      const studentId = (req as AuthenticatedRequest).auth.legacyUserId;
      const courseId  = req.params.courseId;

      // ─ Gather context ────────────────────────────────────────────────────────

      // Verify enrollment
      const enrollment = await q1(
        `SELECT e.id FROM enrollments e
         JOIN courses c ON e.course_id = c.id
         WHERE e.student_id = $1 AND e.course_id = $2 AND c.archived = 0`,
        [studentId, courseId]
      );
      if (!enrollment) {
        return res.status(403).json({ error: 'Not enrolled in this course.' });
      }

      const [course, modules, gradeHistory] = await Promise.all([
        q1(`SELECT name, code FROM courses WHERE id = $1`, [courseId]),
        q(`SELECT name FROM modules WHERE course_id = $1 ORDER BY display_order ASC`, [courseId]),
        q(
          `SELECT a.title, s.grade, s.submitted_at,
                  a.due_date, a.max_points,
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
      ]);

      const pendingAssignments = await q(
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
      );

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
      ].join('\n');

      // ─ Call AI ──────────────────────────────────────────────────────────────

      const systemMsg = [
        'You are an academic learning path advisor AI.',
        'Given a student\'s course context and performance, generate a personalised learning roadmap.',
        'Respond ONLY with valid JSON in this exact shape (no markdown fences):',
        '{',
        '  "title": "<short roadmap title>",',
        '  "summary": "<2-3 sentence overview of the student\'s situation and plan>",',
        '  "milestones": [',
        '    {',
        '      "title": "<step title>",',
        '      "description": "<1-2 sentence explanation of what to do and why>",',
        '      "resource_hint": "<optional: where in the course to find help, or null>"',
        '    }',
        '  ]',
        '}',
        'Generate 5-8 milestones. Order them logically (address weaknesses first, then advance).',
        'Be specific and actionable. Reference actual module names and assignment titles from the context.',
      ].join('\n');

      const raw = await nimChat(
        [
          { role: 'system', content: systemMsg },
          { role: 'user',   content: prompt },
        ],
        { temperature: 0.45, maxTokens: 1200 }
      );

      let parsed: { title: string; summary: string; milestones: any[] };
      try {
        parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      } catch (_e) {
        // AI returned garbage — still persist with a fallback
        parsed = {
          title:      'Learning Roadmap',
          summary:    raw.slice(0, 300),
          milestones: [],
        };
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

      // ─ Replace all milestones ───────────────────────────────────────────────

      await pool.query(
        `DELETE FROM roadmap_milestones WHERE roadmap_id = $1`,
        [roadmapId]
      );

      for (let i = 0; i < milestones.length; i++) {
        const m = milestones[i];
        await pool.query(
          `INSERT INTO roadmap_milestones
             (roadmap_id, step_order, title, description, resource_hint)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            roadmapId,
            i + 1,
            (m.title        || `Step ${i + 1}`).slice(0, 200),
            m.description   || null,
            m.resource_hint || null,
          ]
        );
      }

      // Return full roadmap
      const saved = await q(
        `SELECT id, step_order, title, description, resource_hint, status, completed_at
         FROM roadmap_milestones
         WHERE roadmap_id = $1
         ORDER BY step_order ASC`,
        [roadmapId]
      );

      res.json({
        id:           roadmapId,
        student_id:   studentId,
        course_id:    parseInt(courseId),
        title,
        summary,
        generated_at: new Date().toISOString(),
        milestones:   saved,
      });
    } catch (e: any) {
      console.error('[roadmaps/generate] error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── PATCH /api/roadmaps/milestones/:id ───────────────────────────────────
  // Students can update a milestone's status: pending | in_progress | completed
  router.patch('/milestones/:id', requireAuth, async (req, res) => {
    try {
      const studentId   = (req as AuthenticatedRequest).auth.legacyUserId;
      const milestoneId = req.params.id;
      const { status }  = req.body as { status: string };

      const allowed = ['pending', 'in_progress', 'completed'];
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
      }

      // Verify the milestone belongs to this student's roadmap
      const owned = await q1(
        `SELECT m.id FROM roadmap_milestones m
         JOIN student_roadmaps r ON m.roadmap_id = r.id
         WHERE m.id = $1 AND r.student_id = $2`,
        [milestoneId, studentId]
      );
      if (!owned) {
        return res.status(403).json({ error: 'Milestone not found or access denied.' });
      }

      await pool.query(
        `UPDATE roadmap_milestones
         SET status       = $1,
             completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE NULL END
         WHERE id = $2`,
        [status, milestoneId]
      );

      // Also bump roadmap updated_at
      await pool.query(
        `UPDATE student_roadmaps r
         SET updated_at = NOW()
         FROM roadmap_milestones m
         WHERE m.id = $1 AND m.roadmap_id = r.id`,
        [milestoneId]
      );

      res.json({ success: true, status });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── DELETE /api/roadmaps/:courseId ─────────────────────────────────────────
  // Deletes the student's roadmap (and all milestones via CASCADE).
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
