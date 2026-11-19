/**
 * roadmaps.ts — P3-3 (updated: grading feedback + unit exam context)
 *
 * Mounted at /api/roadmaps by server.ts.
 *
 * Routes:
 *   GET    /api/roadmaps/:courseId          — get student's roadmap + milestones
 *   POST   /api/roadmaps/:courseId/generate — AI-generate (or regenerate) roadmap
 *                                              (?async=1 queues it: 202 { jobId })
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
import { sendServerError } from '../lib/httpErrors.js';
import { log, errorFields } from '../lib/log.js';
import type { JobQueue } from '../lib/jobs.js';
import { studentVisibleNotes, assertManagesCourse, AccessDenied } from '../lib/access.js';
import {
  schedulePlan, rankWeakTopics, revisionDays, milestoneCount, todayIst, daysBetween, addDays, type TargetExam,
} from '../lib/studyPlan.js';

type PgPool = InstanceType<typeof Pool>;

const MILESTONE_COLUMNS = `id, step_order, title, description, resource_hint, status, completed_at,
  to_char(due_date, 'YYYY-MM-DD') AS due_date, kind, topic, module_id, est_minutes`;

/**
 * Mark plans out of date when what they were built on changes (exam dates,
 * portions, published marks). Students are asked to refresh; nothing is
 * regenerated in bulk, so AI cost stays per request.
 */
export async function markPlansStale(
  db: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  courseIds: number[], reason: string, studentIds?: number[],
): Promise<void> {
  if (!courseIds.length) return;
  await db.query(
    `UPDATE student_roadmaps SET stale_reason = $2, stale_since = now()
     WHERE course_id = ANY($1::int[]) AND ($3::int[] IS NULL OR student_id = ANY($3::int[]))`,
    [courseIds, reason.slice(0, 200), studentIds ?? null]
  );
}

type NimChatFn = (
  messages: { role: string; content: string }[],
  opts?: { temperature?: number; maxTokens?: number; timeoutMs?: number }
) => Promise<string>;

export class RoadmapNotEnrolled extends Error {
  constructor() { super('Not enrolled in this course.'); this.name = 'RoadmapNotEnrolled'; }
}

let generateRoadmapImpl: ((studentId: number, courseId: string, institutionId: string) => Promise<unknown>) | null = null;

/** Generates a roadmap outside a request (background job). Requires the router to be created first. */
export function generateRoadmap(studentId: number, courseId: number, institutionId: string): Promise<unknown> {
  if (!generateRoadmapImpl) throw new Error('roadmap router not initialised');
  return generateRoadmapImpl(studentId, String(courseId), institutionId);
}

export function createRoadmapRouter(pool: PgPool, nimChat: NimChatFn, queue?: JobQueue): Router {
  const router = Router();

  async function q(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows;
  }
  async function q1(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows[0] ?? null;
  }

  // ── GET /api/roadmaps/today — today's and overdue steps across courses ──
  // Declared before /:courseId so "today" isn't read as a course id.
  router.get('/today', requireAuth, async (req, res) => {
    try {
      const { legacyUserId: studentId, institutionId } = (req as AuthenticatedRequest).auth;
      const today = todayIst();
      const rows = await q(
        `SELECT m.id, m.title, m.kind, m.topic, m.est_minutes, m.status,
                to_char(m.due_date, 'YYYY-MM-DD') AS due_date,
                r.course_id, c.code AS course_code, r.stale_reason,
                to_char(r.target_exam_date, 'YYYY-MM-DD') AS exam_date
         FROM roadmap_milestones m
         JOIN student_roadmaps r ON r.id = m.roadmap_id
         JOIN courses c ON c.id = r.course_id
         WHERE r.student_id = $1 AND r.institution_id = $2
           AND m.due_date IS NOT NULL AND m.due_date <= $3::date + 1
           AND m.status <> 'completed'
           AND (r.target_exam_date IS NULL OR r.target_exam_date >= $3::date)
         ORDER BY m.due_date, c.code, m.step_order
         LIMIT 30`,
        [studentId, institutionId, today]
      );
      res.json({ today, items: rows });
    } catch (e: any) { sendServerError(res, e); }
  });

  // ── GET /api/roadmaps/:courseId ─────────────────────────────────────────
  // A student gets their own plan. The course's professor (or an admin) can
  // read a student's plan with ?student_id=.
  router.get('/:courseId', requireAuth, async (req, res) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const courseId  = req.params.courseId;
      let studentId = auth.legacyUserId;
      if (req.query.student_id !== undefined) {
        const asked = Number(req.query.student_id);
        if (!Number.isInteger(asked) || asked <= 0) return res.status(400).json({ error: 'student_id must be a number' });
        if (auth.role === 'student' && asked !== auth.legacyUserId) return res.status(403).json({ error: 'Access denied' });
        if (auth.role !== 'student') {
          try {
            await assertManagesCourse(pool, { legacyUserId: auth.legacyUserId, role: auth.role, institutionId: auth.institutionId },
              /^\d+$/.test(courseId) ? Number(courseId) : null);
          } catch (e) {
            if (e instanceof AccessDenied) return res.status(e.status).json({ error: e.message });
            throw e;
          }
        }
        studentId = asked;
      }

      const roadmap = await q1(
        `SELECT r.id, r.student_id, r.course_id, r.title, r.summary, r.generated_at, r.updated_at,
                r.stale_reason, r.stale_since, to_char(r.target_exam_date, 'YYYY-MM-DD') AS target_exam_date,
                CASE WHEN ue.id IS NULL THEN NULL ELSE json_build_object(
                  'unit_exam_id', ue.id, 'title', ue.title,
                  'exam_date', to_char(ue.exam_date, 'YYYY-MM-DD')) END AS target_exam
         FROM student_roadmaps r LEFT JOIN unit_exams ue ON ue.id = r.target_unit_exam_id
         WHERE r.student_id = $1 AND r.course_id = $2 AND r.institution_id = $3`,
        [studentId, courseId, (req as AuthenticatedRequest).auth.institutionId]
      );

      if (!roadmap) {
        return res.status(404).json({ error: 'No roadmap yet — call POST .../generate to create one.' });
      }

      const milestones = await q(
        `SELECT ${MILESTONE_COLUMNS} FROM roadmap_milestones
         WHERE roadmap_id = $1
         ORDER BY step_order ASC`,
        [roadmap.id]
      );

      res.json({ ...roadmap, milestones });
    } catch (e: any) {
      sendServerError(res, e);
    }
  });

  // ── POST /api/roadmaps/:courseId/generate ───────────────────────────────
  /**
   * Builds (or rebuilds) a student's roadmap for a course and returns it.
   * Idempotent: the roadmap row is upserted and its milestones replaced.
   * Used directly by the route and by the "roadmap.generate" background job.
   */
  async function generate(studentId: number, courseId: string, institutionId: string) {

    // ─ Verify enrollment ─────────────────────────────────────────────────
    const enrollment = await q1(
      `SELECT e.id FROM enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE e.student_id = $1 AND e.course_id = $2 AND e.institution_id = $3 AND c.archived = 0`,
      [studentId, courseId, institutionId]
    );
    if (!enrollment) {
      throw new RoadmapNotEnrolled();
    }

    // ─ Gather all context in parallel ────────────────────────────────────
    const today = todayIst();
    const [
      course,
      modules,
      gradeHistory,
      pendingAssignments,
      feedbackRows,
      examRows,
      nextExam,
      otherExams,
      noteTitles,
    ] = await Promise.all([
      q1(`SELECT name, code FROM courses WHERE id = $1`, [courseId]),

      q(`SELECT id, name FROM modules WHERE course_id = $1 ORDER BY display_order ASC, id`, [courseId]),

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
           AND s.ai_feedback != 'null'
           -- Only work an instructor has graded: AI drafts stay private until reviewed.
           AND s.grade IS NOT NULL`,
        [studentId, courseId]
      ),

      // Unit exam results for this course
      q(
        `SELECT r.marks_obtained, r.percentage, r.performance_band, r.topic_breakdown,
                ue.title AS exam_title, ue.exam_date, ue.max_marks
         FROM unit_exam_results r
         JOIN unit_exams ue ON r.unit_exam_id = ue.id
         WHERE r.student_id = $1 AND ue.course_id = $2
           AND ue.published_at IS NOT NULL AND NOT r.is_absent
         ORDER BY ue.exam_date ASC NULLS LAST, r.created_at ASC`,
        [studentId, courseId]
      ),

      // The next exam in this course (from the timetable or set by the professor).
      q1(
        `SELECT ue.id AS unit_exam_id, ue.title, to_char(ue.exam_date, 'YYYY-MM-DD') AS exam_date,
                ue.assessment_type, ue.portion_module_ids, ue.portion_notes,
                te.session, te.start_time, te.venue
         FROM unit_exams ue
         LEFT JOIN LATERAL (
           SELECT e.session, to_char(e.start_time, 'HH24:MI') AS start_time, e.venue
           FROM exam_timetable_entries e
           JOIN exam_timetables t ON t.id = e.timetable_id AND t.status = 'published'
           WHERE e.unit_exam_id = ue.id ORDER BY e.id LIMIT 1
         ) te ON true
         WHERE ue.course_id = $1 AND ue.institution_id = $2 AND ue.exam_date >= $3::date
         ORDER BY ue.exam_date, ue.id LIMIT 1`,
        [courseId, institutionId, today]
      ),

      // The student's other exams in the next two months (to plan around them).
      q(
        `SELECT DISTINCT to_char(ue.exam_date, 'YYYY-MM-DD') AS exam_date, c.code, ue.title
         FROM unit_exams ue
         JOIN courses c ON c.id = ue.course_id
         JOIN enrollments en ON en.course_id = ue.course_id AND en.student_id = $1
         WHERE ue.institution_id = $3 AND ue.course_id <> $2
           AND ue.exam_date BETWEEN $4::date AND $4::date + 60
         ORDER BY 1 LIMIT 20`,
        [studentId, courseId, institutionId, today]
      ),

      // Notes the student can open, by module (titles only), for resource hints.
      q(
        `SELECT n.module_id, coalesce(n.original_name, n.filename) AS title
         FROM notes n JOIN modules m ON m.id = n.module_id
         WHERE m.course_id = $1 AND n.processing_status = 'ready' AND ${studentVisibleNotes('$2')}
         ORDER BY n.uploaded_at DESC LIMIT 60`,
        [courseId, studentId]
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

    // ─ The exam this plan counts down to, and its portion ────────────────
    const target: (TargetExam & { portion_module_ids: number[] | null; portion_notes: string | null }) | null = nextExam;
    const daysLeft = target ? daysBetween(today, target.exam_date) : null;
    const portionIds = new Set<number>(target?.portion_module_ids ?? []);
    const portionModules = modules.filter((m: any) => portionIds.has(m.id));
    const notesByModule = new Map<number, string[]>();
    for (const n of noteTitles) notesByModule.set(n.module_id, [...(notesByModule.get(n.module_id) ?? []), n.title].slice(0, 4));

    const weak = rankWeakTopics(examRows, uniqueImprovements, portionModules.map((m: any) => m.name));

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
    const moduleLine = (m: any) => {
      const notes = notesByModule.get(m.id);
      return `  - ${m.name}${notes?.length ? ` (notes: ${notes.join('; ')})` : ''}`;
    };
    const moduleList = modules.length ? modules.map(moduleLine).join('\n') : '  (no modules yet)';

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
          weak.length > 0
            ? `WEAK TOPICS (lowest scores first; [PORTION] = in the coming exam):\n${
                weak.map(w => `  !! ${w.topic}${w.inPortion ? ' [PORTION]' : ''}`).join('\n')
              }`
            : '',
        ].filter(Boolean).join('\n')
      : '';

    const counts = milestoneCount(daysLeft);
    const examSectionNext = target
      ? [
          ``,
          `COMING EXAM: ${target.title} on ${target.exam_date}${target.session ? ` (${target.session})` : ''}`,
          `TODAY: ${today}. DAYS LEFT: ${daysLeft}. Plan study dates from ${today} to ${addDays(target.exam_date, -1)}.`,
          `KEEP THE LAST ${revisionDays(daysLeft!)} DAY(S) BEFORE THE EXAM FOR REVISION AND PRACTICE QUESTIONS.`,
          portionModules.length
            ? `EXAM PORTION (only these modules are tested; plan only for these):\n${portionModules.map(moduleLine).join('\n')}`
            : `EXAM PORTION: not given by the professor; cover the modules taught so far.`,
          target.portion_notes ? `PORTION NOTE FROM PROFESSOR: ${target.portion_notes}` : '',
          otherExams.length
            ? `STUDENT'S OTHER EXAMS (keep those days free; lighter work the day before):\n${otherExams.map((o: any) => `  - ${o.exam_date}: ${o.code} ${o.title}`).join('\n')}`
            : '',
        ].filter(Boolean).join('\n')
      : `\nNO UPCOMING EXAM SCHEDULED: make an undated plan in priority order.`;

    const prompt = [
      `COURSE: ${course.code} — ${course.name}`,
      `MODULES:\n${moduleList}`,
      examSectionNext,
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
      'You are a study planner for an Indian engineering student.',
      'Make a personalised, day-by-day plan for the coming exam from their real marks, feedback and the exam portion.',
      'Priorities:',
      '  1. WEAK TOPICS marked [PORTION]: learn, then practise each one (most time here)',
      '  2. Other portion modules the student has not been tested on yet: cover them once',
      '  3. Pending assignments due before the exam',
      '  4. Final revision and timed practice in the last day(s): past questions, formulas, diagrams',
      'Rules: spread work over the available days, at most about 2 hours of tasks per day, never schedule on another exam\'s day,',
      'name the real module, topic and note for each step, and keep steps small enough to finish in one sitting.',
      'If the score trend is declining, start with a short, achievable win.',
      'Respond ONLY with valid JSON (no markdown fences):',
      '{',
      '  "title": "<short plan title, e.g. \"Unit test 2: 10-day plan\">",',
      '  "summary": "<2-3 sentences: what the exam covers, where the student is weak, how the plan handles it>",',
      '  "milestones": [',
      '    {',
      '      "title": "<what to do>",',
      '      "description": "<1-2 sentences, specific>",',
      '      "date": "<YYYY-MM-DD, within the study dates>",',
      '      "kind": "<learn | practice | revise | assignment>",',
      '      "topic": "<topic>",',
      '      "module": "<module name exactly as listed>",',
      '      "minutes": <15-120>,',
      '      "resource_hint": "<note title or module to use, or null>"',
      '    }',
      '  ]',
      '}',
      `Make ${counts.min}-${counts.max} milestones.`,
    ].join('\n');

    const raw = await nimChat(
      [
        { role: 'system', content: systemMsg },
        { role: 'user',   content: prompt },
      ],
      { temperature: 0.4, maxTokens: 2600, timeoutMs: 60_000 }
    );

    let parsed: { title: string; summary: string; milestones: any[] };
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch {
      parsed = { title: 'Learning Roadmap', summary: raw.slice(0, 300), milestones: [] };
    }

    const title      = parsed.title   || 'My Learning Roadmap';
    const summary    = parsed.summary || null;
    const milestones = schedulePlan(Array.isArray(parsed.milestones) ? parsed.milestones : [], {
      today,
      exam: target,
      busyDays: otherExams.map((o: any) => o.exam_date),
      modules,
    });

    // ─ Upsert roadmap row ─────────────────────────────────────────────────
    const upsertResult = await pool.query(
      `INSERT INTO student_roadmaps (student_id, course_id, title, summary, generated_at, updated_at,
                                     target_unit_exam_id, target_exam_date, stale_reason, stale_since)
       VALUES ($1, $2, $3, $4, NOW(), NOW(), $5, $6, NULL, NULL)
       ON CONFLICT (student_id, course_id)
       DO UPDATE SET
         title               = EXCLUDED.title,
         summary             = EXCLUDED.summary,
         target_unit_exam_id = EXCLUDED.target_unit_exam_id,
         target_exam_date    = EXCLUDED.target_exam_date,
         stale_reason        = NULL,
         stale_since         = NULL,
         generated_at        = NOW(),
         updated_at          = NOW()
       RETURNING id`,
      [studentId, courseId, title, summary, target?.unit_exam_id ?? null, target?.exam_date ?? null]
    );
    const roadmapId: number = upsertResult.rows[0].id;

    // ─ Replace all milestones (one statement) ──────────────────────────────
    await pool.query(`DELETE FROM roadmap_milestones WHERE roadmap_id = $1`, [roadmapId]);
    if (milestones.length) {
      await pool.query(
        `INSERT INTO roadmap_milestones
           (roadmap_id, step_order, title, description, resource_hint, due_date, kind, topic, module_id, est_minutes)
         SELECT $1, x.ord, x.title, x.description, x.resource_hint, x.due_date, x.kind, x.topic, x.module_id, x.est_minutes
         FROM jsonb_to_recordset($2::jsonb) AS x(ord int, title text, description text, resource_hint text,
              due_date date, kind text, topic text, module_id int, est_minutes smallint)`,
        [roadmapId, JSON.stringify(milestones.map((m, i) => ({ ord: i + 1, ...m })))]
      );
    }

    const saved = await q(
      `SELECT ${MILESTONE_COLUMNS} FROM roadmap_milestones WHERE roadmap_id = $1 ORDER BY step_order ASC`,
      [roadmapId]
    );

    return {
      id: roadmapId, student_id: studentId, course_id: parseInt(courseId),
      title, summary, generated_at: new Date().toISOString(), milestones: saved,
      target_exam: target ? { unit_exam_id: target.unit_exam_id, title: target.title, exam_date: target.exam_date, session: target.session, start_time: target.start_time, venue: target.venue } : null,
      stale_reason: null,
    };
  }
  generateRoadmapImpl = generate;

  // ── POST /api/roadmaps/:courseId/generate ─────────────────────────────
  // ?async=1 (with a job queue) queues the work and answers 202 { jobId };
  // poll GET /api/jobs/:id. Without it the roadmap is generated in the request.
  router.post('/:courseId/generate', requireAuth, requireRole('student'), async (req, res) => {
    try {
      const { legacyUserId: studentId, institutionId } = (req as AuthenticatedRequest).auth;
      const courseId = String(req.params.courseId);
      if (!/^\d+$/.test(courseId)) return res.status(400).json({ error: 'Invalid course id.' });
      if (req.query.async === '1' && queue) {
        const enrolled = await q1(
          `SELECT 1 FROM enrollments e JOIN courses c ON c.id = e.course_id
           WHERE e.student_id = $1 AND e.course_id = $2 AND e.institution_id = $3 AND c.archived = 0`,
          [studentId, courseId, institutionId]
        );
        if (!enrolled) return res.status(403).json({ error: 'Not enrolled in this course.' });
        const job = await queue.enqueue('roadmap.generate', { studentId, courseId: Number(courseId) }, {
          institutionId, createdBy: studentId, dedupeKey: `roadmap:${studentId}:${courseId}`, maxAttempts: 3,
        });
        return res.status(202).json({ jobId: job.id, status: 'queued' });
      }
      res.json(await generate(studentId, courseId, institutionId));
    } catch (e: any) {
      if (e instanceof RoadmapNotEnrolled) return res.status(403).json({ error: e.message });
      log.error('roadmap generation failed', errorFields(e));
      sendServerError(res, e);
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
      sendServerError(res, e);
    }
  });

  // ── DELETE /api/roadmaps/:courseId ───────────────────────────────────────
  router.delete('/:courseId', requireAuth, async (req, res) => {
    try {
      const studentId = (req as AuthenticatedRequest).auth.legacyUserId;
      const courseId  = req.params.courseId;
      await pool.query(
        `DELETE FROM student_roadmaps WHERE student_id = $1 AND course_id = $2 AND institution_id = $3`,
        [studentId, courseId, (req as AuthenticatedRequest).auth.institutionId]
      );
      res.json({ success: true });
    } catch (e: any) {
      sendServerError(res, e);
    }
  });

  return router;
}
