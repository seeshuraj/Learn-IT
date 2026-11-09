/**
 * GET /api/admin/ai-usage?days=30 — the caller's college only.
 *
 * Month-to-date tokens against the allowance, plus the last N days broken
 * down by feature, day and course. No per-person breakdown: admins see
 * aggregate usage, not who asked the tutor what.
 */
import { Router, Request, Response } from 'express';
import pkg from 'pg';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/auth.js';
import { sendServerError } from '../lib/httpErrors.js';
import type { AiBudgetGuard } from '../lib/aiUsage.js';

export function createAiUsageAdminRouter(pool: pkg.Pool, budget: AiBudgetGuard): Router {
  const router = Router();

  router.get('/', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const { institutionId } = (req as AuthenticatedRequest).auth;
      const days = Math.min(90, Math.max(1, Number.parseInt(String(req.query.days ?? '30'), 10) || 30));
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const params = [institutionId, since];

      const [month, byFeature, byDay, byCourse, users] = await Promise.all([
        budget.status(institutionId),
        pool.query(
          `SELECT feature, COUNT(*)::int AS calls,
                  COALESCE(SUM(prompt_tokens + completion_tokens), 0)::bigint AS tokens,
                  COUNT(*) FILTER (WHERE status = 'error')::int AS errors,
                  COALESCE(ROUND(AVG(latency_ms) FILTER (WHERE status = 'ok')), 0)::int AS avg_latency_ms
           FROM ai_usage_events WHERE institution_id = $1 AND created_at >= $2
           GROUP BY feature ORDER BY tokens DESC`,
          params,
        ),
        pool.query(
          `SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS day,
                  COUNT(*)::int AS calls,
                  COALESCE(SUM(prompt_tokens + completion_tokens), 0)::bigint AS tokens
           FROM ai_usage_events WHERE institution_id = $1 AND created_at >= $2
           GROUP BY 1 ORDER BY 1`,
          params,
        ),
        pool.query(
          `SELECT c.id, c.name, COALESCE(SUM(e.prompt_tokens + e.completion_tokens), 0)::bigint AS tokens,
                  COUNT(*)::int AS calls
           FROM ai_usage_events e JOIN courses c ON c.id = e.course_id
           WHERE e.institution_id = $1 AND e.created_at >= $2
           GROUP BY c.id, c.name ORDER BY tokens DESC LIMIT 10`,
          params,
        ),
        pool.query(
          `SELECT COUNT(DISTINCT user_id)::int AS active_users
           FROM ai_usage_events WHERE institution_id = $1 AND created_at >= $2`,
          params,
        ),
      ]);

      const num = (v: unknown) => Number(v ?? 0);
      res.json({
        month: { used: month.used, budget: month.budget, remaining: month.budget == null ? null : Math.max(0, month.budget - month.used) },
        days,
        activeUsers: num(users.rows[0]?.active_users),
        byFeature: byFeature.rows.map(r => ({ feature: r.feature, calls: num(r.calls), tokens: num(r.tokens), errors: num(r.errors), avgLatencyMs: num(r.avg_latency_ms) })),
        byDay: byDay.rows.map(r => ({ day: r.day, calls: num(r.calls), tokens: num(r.tokens) })),
        byCourse: byCourse.rows.map(r => ({ id: r.id, name: r.name, calls: num(r.calls), tokens: num(r.tokens) })),
      });
    } catch (e) {
      sendServerError(res, e);
    }
  });

  return router;
}
