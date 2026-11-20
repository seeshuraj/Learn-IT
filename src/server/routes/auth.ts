/**
 * auth.ts — P3-5
 *
 * Mounted at /api/auth by server.ts.
 *
 * Routes:
 *   GET  /api/auth/me                    — current user's profile row
 *   GET  /api/auth/me/force-change       — { forceChange: bool } for the auth'd user
 *   POST /api/auth/request-reset         — retired (410): resets use Supabase's recovery email
 *   POST /api/auth/reset-password        — retired (410)
 *   POST /api/auth/change-password       — auth'd user changes their own password
 */

import { Router, type Request, type Response } from 'express';
import pkg from 'pg';
const { Pool } = pkg;
import { createClient } from '@supabase/supabase-js';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { sendServerError } from '../lib/httpErrors.js';
import { log } from '../lib/log.js';

type PgPool = InstanceType<typeof Pool>;

export function createAuthRouter(pool: PgPool): Router {
  const router = Router();

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  async function q(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows;
  }
  async function q1(sql: string, params: any[] = []) {
    const { rows } = await pool.query(sql, params);
    return rows[0] ?? null;
  }

  // ── GET /api/auth/me ───────────────────────────────────────────────────────
  // Returns the authenticated user's profile row from the users table.
  router.get('/me', requireAuth, async (req, res) => {
    try {
      // Role and institution come from the resolved membership, not users.role.
      const { legacyUserId, role, institutionId } = (req as AuthenticatedRequest).auth;
      const user = await q1(
        `SELECT u.id, u.name, u.email, $2::text AS role, u.active, u.year, u.major, u.gpa,
                i.id AS institution_id, i.name AS institution_name
         FROM users u
         JOIN institutions i ON i.id = $3
         WHERE u.id = $1`,
        [legacyUserId, role, institutionId]
      );
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(user);
    } catch (e: any) {
      sendServerError(res, e);
    }
  });

  // ── GET /api/auth/me/force-change ──────────────────────────────────────────
  router.get('/me/force-change', requireAuth, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).auth.legacyUserId;
      const row = await q1(
        `SELECT force_password_change FROM user_identity_map WHERE legacy_user_id = $1`,
        [userId]
      );
      res.json({ forceChange: row?.force_password_change ?? false });
    } catch (e: any) {
      sendServerError(res, e);
    }
  });

  // ── POST /api/auth/request-reset, /api/auth/reset-password (retired) ─────
  // Password resets go through Supabase Auth's recovery email (the Forgot
  // password page → /reset-password). These routes kept their own plain-text
  // tokens, so they are closed rather than left as a second way in.
  const retired = (_req: Request, res: Response) =>
    res.status(410).json({ error: 'Use "Forgot password" on the sign-in page to reset your password.' });
  router.post('/request-reset', retired);
  router.post('/reset-password', retired);

  // ── POST /api/auth/change-password ────────────────────────────────────────
  router.post('/change-password', requireAuth, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).auth.legacyUserId;
      const { newPassword } = req.body;

      if (!newPassword || newPassword.length < 8)
        return res.status(400).json({ error: 'Password must be at least 8 characters' });

      const identityRow = await q1(
        `SELECT auth_user_id FROM user_identity_map WHERE legacy_user_id = $1`,
        [userId]
      );
      if (!identityRow?.auth_user_id)
        return res.status(404).json({ error: 'Auth identity not found' });

      const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(
        identityRow.auth_user_id,
        { password: newPassword }
      );
      if (authErr)
        return sendServerError(res, authErr);

      await pool.query(
        `UPDATE user_identity_map
         SET force_password_change = FALSE, last_password_change = NOW()
         WHERE legacy_user_id = $1`,
        [userId]
      );

      res.json({ success: true, message: 'Password changed successfully.' });
    } catch (e: any) {
      sendServerError(res, e);
    }
  });

  return router;
}
