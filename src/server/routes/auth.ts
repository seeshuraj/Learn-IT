/**
 * auth.ts — P3-5
 *
 * Mounted at /api/auth by server.ts.
 *
 * Routes:
 *   GET  /api/auth/me                    — current user's profile row
 *   GET  /api/auth/me/force-change       — { forceChange: bool } for the auth'd user
 *   POST /api/auth/request-reset         — admin/self issues a reset token
 *   POST /api/auth/reset-password        — consume token, set new password via Supabase Admin API
 *   POST /api/auth/change-password       — auth'd user changes their own password
 */

import { Router } from 'express';
import pkg from 'pg';
const { Pool } = pkg;
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';

type PgPool = InstanceType<typeof Pool>;

/**
 * Module-level singleton — created once per process, never per-request.
 * Eliminates the "Multiple GoTrueClient instances" browser-console warning
 * and avoids redundant HTTP connections when running with numInstances > 1.
 */
const supabaseAdmin: SupabaseClient = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export function createAuthRouter(pool: PgPool): Router {
  const router = Router();

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
      const userId = (req as AuthenticatedRequest).auth.legacyUserId;
      const user = await q1(
        `SELECT id, name, email, role, active, year, major, gpa
         FROM users WHERE id = $1`,
        [userId]
      );
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(user);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/auth/request-reset ──────────────────────────────────────────
  router.post('/request-reset', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'email required' });

      const user = await q1(
        `SELECT id FROM users WHERE email = $1 AND active = 1`,
        [email.trim().toLowerCase()]
      );
      if (!user) return res.json({ message: 'If that email exists, a reset link has been issued.' });

      await pool.query(
        `UPDATE password_reset_tokens SET used_at = NOW()
         WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()`,
        [user.id]
      );

      const row = await q1(
        `INSERT INTO password_reset_tokens (user_id)
         VALUES ($1)
         RETURNING token, expires_at`,
        [user.id]
      );

      const isDev = process.env.NODE_ENV !== 'production';
      if (isDev) {
        return res.json({
          message: 'Reset token issued (dev mode — token returned directly).',
          token: row.token,
          expires_at: row.expires_at,
        });
      }

      console.log(`[auth] reset token for ${email}: ${row.token}`);
      res.json({ message: 'If that email exists, a reset link has been issued.' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/auth/reset-password ─────────────────────────────────────────
  router.post('/reset-password', async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword)
        return res.status(400).json({ error: 'token and newPassword required' });
      if (newPassword.length < 8)
        return res.status(400).json({ error: 'Password must be at least 8 characters' });

      const tokenRow = await q1(
        `SELECT prt.id, prt.user_id, uim.auth_user_id
         FROM password_reset_tokens prt
         JOIN user_identity_map uim ON uim.legacy_user_id = prt.user_id
         WHERE prt.token = $1
           AND prt.used_at IS NULL
           AND prt.expires_at > NOW()`,
        [token]
      );
      if (!tokenRow)
        return res.status(400).json({ error: 'Invalid or expired reset token' });

      const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(
        tokenRow.auth_user_id,
        { password: newPassword }
      );
      if (authErr)
        return res.status(500).json({ error: `Auth update failed: ${authErr.message}` });

      await pool.query(
        `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
        [tokenRow.id]
      );
      await pool.query(
        `UPDATE user_identity_map
         SET force_password_change = FALSE, last_password_change = NOW()
         WHERE legacy_user_id = $1`,
        [tokenRow.user_id]
      );

      res.json({ success: true, message: 'Password updated successfully.' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

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
        return res.status(500).json({ error: `Auth update failed: ${authErr.message}` });

      await pool.query(
        `UPDATE user_identity_map
         SET force_password_change = FALSE, last_password_change = NOW()
         WHERE legacy_user_id = $1`,
        [userId]
      );

      res.json({ success: true, message: 'Password changed successfully.' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
