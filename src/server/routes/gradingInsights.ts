/**
 * gradingInsights.ts
 *
 * GET /api/student/:studentId/grading-insights
 *
 * Aggregates ai_feedback (JSON) from all of a student's graded submissions
 * and returns the most frequently appearing strengths and improvements
 * across all courses. Used by:
 *   - AnalyticsPage.tsx   → "AI Grading Insights" panel
 *   - roadmaps.ts         → injects into roadmap generation prompt
 */

import { Router } from 'express';
import pkg from 'pg';
const { Pool } = pkg;
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';

type PgPool = InstanceType<typeof Pool>;

export function createGradingInsightsRouter(pool: PgPool): Router {
  const router = Router();

  router.get('/:studentId/grading-insights', requireAuth, async (req, res) => {
    try {
      const caller    = (req as AuthenticatedRequest).auth.legacyUserId;
      const studentId = parseInt(req.params.studentId, 10);

      // Students can only fetch their own insights
      if (caller !== studentId) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      const rows = await pool.query(
        `SELECT s.ai_feedback, a.title AS assignment_title, c.name AS course_name
         FROM submissions s
         JOIN assignments a ON s.assignment_id = a.id
         JOIN modules m     ON a.module_id = m.id
         JOIN courses c     ON m.course_id = c.id
         WHERE s.student_id = $1
           AND s.ai_feedback IS NOT NULL
           AND s.ai_feedback != 'null'`,
        [studentId]
      );

      // Tally frequency of each strength and improvement string
      const strengthCount:    Record<string, number> = {};
      const improvementCount: Record<string, number> = {};

      for (const row of rows.rows) {
        let feedback: any;
        try {
          feedback = typeof row.ai_feedback === 'string'
            ? JSON.parse(row.ai_feedback)
            : row.ai_feedback;
        } catch { continue; }

        for (const s of (feedback?.strengths ?? [])) {
          if (typeof s === 'string' && s.trim()) {
            strengthCount[s.trim()] = (strengthCount[s.trim()] ?? 0) + 1;
          }
        }
        for (const imp of (feedback?.improvements ?? [])) {
          if (typeof imp === 'string' && imp.trim()) {
            improvementCount[imp.trim()] = (improvementCount[imp.trim()] ?? 0) + 1;
          }
        }
      }

      // Sort by frequency descending, take top 8
      const topStrengths = Object.entries(strengthCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([text, count]) => ({ text, count }));

      const topImprovements = Object.entries(improvementCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([text, count]) => ({ text, count }));

      res.json({
        totalSubmissionsWithFeedback: rows.rows.length,
        strengths:    topStrengths,
        improvements: topImprovements,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
