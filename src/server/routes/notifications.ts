/**
 * notifications.ts — P3-4
 *
 * Mounted at /api/notifications by server.ts.
 *
 * Routes:
 *   GET  /api/notifications           — list latest 50 notifications for the auth'd user
 *   GET  /api/notifications/unread-count — { count: N }
 *   PATCH /api/notifications/:id/read  — mark one notification as read
 *   POST  /api/notifications/read-all  — mark all unread as read
 *   DELETE /api/notifications/:id      — delete a single notification
 */

import { Router } from 'express';
import pkg from 'pg';
const { Pool } = pkg;
import {
  requireAuth,
  AuthenticatedRequest,
} from '../middleware/auth.js';

type PgPool = InstanceType<typeof Pool>;

export function createNotificationsRouter(pool: PgPool): Router {
  const router = Router();

  async function q(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows;
  }
  async function q1(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows[0] ?? null;
  }

  // ── GET /api/notifications ───────────────────────────────────────────────
  // Returns the latest 50 notifications for the authenticated user,
  // newest first. Optionally filter to unread only with ?unread=true.
  router.get('/', requireAuth, async (req, res) => {
    try {
      const userId  = (req as AuthenticatedRequest).auth.legacyUserId;
      const unread  = req.query.unread === 'true';
      const limit   = Math.min(parseInt(req.query.limit as string) || 50, 100);

      const rows = await q(
        `SELECT id, type, message, metadata, read, read_at, created_at
         FROM notifications
         WHERE user_id = $1
           ${unread ? 'AND read = FALSE' : ''}
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
      );

      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/notifications/unread-count ────────────────────────────────
  // Lightweight poll endpoint — frontend can call this every 60s.
  router.get('/unread-count', requireAuth, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).auth.legacyUserId;
      const row = await q1(
        `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND read = FALSE`,
        [userId]
      );
      res.json({ count: parseInt(row?.count) || 0 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── PATCH /api/notifications/:id/read ─────────────────────────────────
  router.patch('/:id/read', requireAuth, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).auth.legacyUserId;
      const id     = req.params.id;

      // Only mark if it belongs to this user
      const result = await pool.query(
        `UPDATE notifications
         SET read = TRUE, read_at = NOW()
         WHERE id = $1 AND user_id = $2 AND read = FALSE`,
        [id, userId]
      );

      if (result.rowCount === 0) {
        // Either already read or doesn't belong to user — still 200, idempotent
        return res.json({ success: true, alreadyRead: true });
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/notifications/read-all ──────────────────────────────────
  router.post('/read-all', requireAuth, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).auth.legacyUserId;

      const result = await pool.query(
        `UPDATE notifications
         SET read = TRUE, read_at = NOW()
         WHERE user_id = $1 AND read = FALSE`,
        [userId]
      );

      res.json({ success: true, marked: result.rowCount ?? 0 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── DELETE /api/notifications/:id ──────────────────────────────────────
  router.delete('/:id', requireAuth, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).auth.legacyUserId;
      await pool.query(
        `DELETE FROM notifications WHERE id = $1 AND user_id = $2`,
        [req.params.id, userId]
      );
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
