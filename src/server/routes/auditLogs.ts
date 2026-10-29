/**
 * auditLogs.ts — GET /api/admin/audit-logs
 *
 * Admin-only paginated read endpoint for the audit_logs table, limited to
 * the caller's institution. Platform-level rows (institution_id NULL) are
 * never returned here.
 *
 * Query params (all optional):
 *   action        – exact prefix match, e.g. "grade" matches "grade.submit"
 *   actor_user_id – filter by actor legacy user ID
 *   resource_type – filter by resource_type column
 *   since         – ISO 8601 start timestamp (inclusive)
 *   until         – ISO 8601 end timestamp (inclusive)
 *   limit         – rows per page, default 50, max 200
 *   offset        – pagination offset, default 0
 */

import { Router, Request, Response } from 'express';
import pkg from 'pg';
const { Pool } = pkg;
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/auth.js';
import { sendServerError } from '../lib/httpErrors.js';
import { log, errorFields } from '../lib/log.js';

export function createAuditLogsRouter(pool: InstanceType<typeof Pool>): Router {
  const router = Router();

  router.get('/', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const {
        action,
        actor_user_id,
        resource_type,
        since,
        until,
      } = req.query as Record<string, string | undefined>;

      const limit  = Math.min(parseInt((req.query.limit  as string) ?? '50',  10) || 50,  200);
      const offset = Math.max(parseInt((req.query.offset as string) ?? '0',   10) || 0,   0);

      const params: unknown[]    = [(req as AuthenticatedRequest).auth.institutionId];
      const conditions: string[] = ['institution_id = $1'];

      if (action) {
        params.push(action + '%');
        conditions.push(`action ILIKE $${params.length}`);
      }
      if (actor_user_id) {
        params.push(parseInt(actor_user_id, 10));
        conditions.push(`actor_user_id = $${params.length}`);
      }
      if (resource_type) {
        params.push(resource_type);
        conditions.push(`resource_type = $${params.length}`);
      }
      if (since) {
        params.push(since);
        conditions.push(`created_at >= $${params.length}`);
      }
      if (until) {
        params.push(until);
        conditions.push(`created_at <= $${params.length}`);
      }

      const where = `WHERE ${conditions.join(' AND ')}`;

      params.push(limit);
      const limitPlaceholder  = `$${params.length}`;
      params.push(offset);
      const offsetPlaceholder = `$${params.length}`;

      const [rows, countRow] = await Promise.all([
        pool.query(
          `SELECT id, created_at, actor_user_id, actor_email, actor_role,
                  action, resource_type, resource_id, metadata, ip AS ip_address, request_id
           FROM audit_logs
           ${where}
           ORDER BY created_at DESC
           LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
          params.slice(0, -2).concat([limit, offset])
        ),
        pool.query(
          `SELECT COUNT(*) AS total FROM audit_logs ${where}`,
          params.slice(0, params.length - 2)
        ),
      ]);

      res.json({
        total:  parseInt(countRow.rows[0]?.total ?? '0', 10),
        limit,
        offset,
        rows:   rows.rows,
      });
    } catch (e: any) {
      log.error('audit log query failed', errorFields(e));
      sendServerError(res, e);
    }
  });

  return router;
}
