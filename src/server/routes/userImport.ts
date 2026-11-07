/**
 * Bulk user import for college admins: /api/admin/users/import
 *
 *   POST /preview         multipart `file` (.csv/.xlsx) → valid rows + issues; creates nothing
 *   POST /commit          { mode, rows } up to IMPORT_BATCH_SIZE rows → per-row results
 *   POST /resend-invites  { emails } → re-sends set-password emails to members of the caller's college
 *
 * The browser sends batches one after another and shows progress, so no single
 * request runs long and a dropped connection loses at most one batch. Every
 * row is idempotent: an email that already has an account is reported, never
 * duplicated.
 *
 * Modes:
 *   invite         Each person is emailed a link to set their own password
 *                  (Supabase's password-recovery email → /reset-password). No
 *                  password is ever shown. The email goes out after the account
 *                  is committed; if it can't be sent (email quota), the row is
 *                  marked emailPending and /resend-invites sends it later.
 *   temp_password  A one-time temporary password is returned for each row so the
 *                  admin can hand it out; it is never stored or logged by
 *                  LearnIT, and the user must change it at first sign-in.
 */
import { Router, Request, Response } from 'express';
import { createRequire } from 'module';
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import pkg from 'pg';
import * as XLSX from 'xlsx';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { writeAudit } from '../middleware/audit.js';
import { sendServerError } from '../lib/httpErrors.js';
import { log, errorFields } from '../lib/log.js';
import { generateTempPassword } from '../lib/tempPassword.js';
import {
  validateImportRows, ImportRow, IMPORT_BATCH_SIZE, IMPORT_MAX_ROWS,
} from '../lib/userImport.js';

const require = createRequire(import.meta.url);
const multer = require('multer');

type Mode = 'invite' | 'temp_password';
type RowResult =
  | { row: number; email: string; status: 'created'; tempPassword?: string; emailPending?: boolean }
  | { row: number; email: string; status: 'exists' | 'failed'; reason: string };

const APP_URL = (process.env.APP_URL || 'https://www.learnitanalytics.com').replace(/\/$/, '');
const RESET_REDIRECT = `${APP_URL}/reset-password`;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const isRateLimited = (err: { status?: number; message?: string } | null | undefined) =>
  !!err && (err.status === 429 || /rate limit|security purposes/i.test(err.message ?? ''));
const isAlreadyRegistered = (err: { message?: string } | null | undefined) =>
  !!err && /already (been )?registered|already exists/i.test(err.message ?? '');

export function createUserImportRouter(
  pool: pkg.Pool,
  supabaseAdmin: Pick<SupabaseClient, 'auth'>,
): Router {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 } });

  async function existingEmails(emails: string[]): Promise<Set<string>> {
    if (!emails.length) return new Set();
    const { rows } = await pool.query<{ email: string }>(
      'SELECT lower(email) AS email FROM users WHERE lower(email) = ANY($1::text[])',
      [emails],
    );
    return new Set(rows.map(r => r.email));
  }

  /** Sends the set-password link; false if it could not be sent now (e.g. email quota). */
  async function sendSetPasswordEmail(email: string): Promise<boolean> {
    try {
      const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo: RESET_REDIRECT });
      if (error && !isRateLimited(error)) log.warn('set-password email failed', errorFields(error));
      return !error;
    } catch (e) {
      log.warn('set-password email failed', errorFields(e));
      return false;
    }
  }

  /** Creates one account: users + institution_members + auth user + identity map, all or nothing. */
  async function createOne(row: ImportRow, institutionId: string, mode: Mode): Promise<RowResult> {
    const client = await pool.connect();
    let authUserId: string | null = null;
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO users (name, email, role, active, year, major)
         VALUES ($1, $2, $3, 1, $4, $5) RETURNING id`,
        [row.name, row.email, row.role, row.year, row.major],
      );
      const userId = inserted.rows[0].id;
      await client.query(
        'INSERT INTO institution_members (institution_id, user_id, role) VALUES ($1, $2, $3)',
        [institutionId, userId, row.role],
      );

      // Invite mode: the account gets a random password nobody sees; the person
      // sets their own through the emailed link after the commit below.
      const tempPassword = mode === 'temp_password' ? generateTempPassword() : undefined;
      const created = await supabaseAdmin.auth.admin.createUser({
        email: row.email,
        password: tempPassword ?? crypto.randomBytes(24).toString('base64url'),
        email_confirm: true,
      });
      if (created.error) {
        if (isAlreadyRegistered(created.error)) throw Object.assign(new Error('exists'), { exists: true });
        throw created.error;
      }
      authUserId = created.data.user.id;

      await client.query(
        `INSERT INTO user_identity_map (legacy_user_id, auth_user_id, role, force_password_change)
         VALUES ($1, $2, $3, $4)`,
        [userId, authUserId, row.role, mode === 'temp_password'],
      );
      await client.query('COMMIT');
      authUserId = null; // committed: no cleanup from here on

      if (mode === 'temp_password') {
        return { row: row.row, email: row.email, status: 'created', tempPassword };
      }
      const sent = await sendSetPasswordEmail(row.email);
      return { row: row.row, email: row.email, status: 'created', ...(sent ? {} : { emailPending: true }) };
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      // Never leave an auth account without its LearnIT records.
      if (authUserId) {
        await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(e =>
          log.error('bulk import: orphan auth user cleanup failed', { authUserId, ...errorFields(e) }));
      }
      if (err?.exists || err?.code === '23505') {
        return { row: row.row, email: row.email, status: 'exists', reason: 'An account with this email already exists' };
      }
      log.error('bulk import: row failed', { row: row.row, ...errorFields(err) });
      return { row: row.row, email: row.email, status: 'failed', reason: 'Could not create this account; try again' };
    } finally {
      client.release();
    }
  }

  // ── Preview ────────────────────────────────────────────────────────────────
  router.post('/preview', requireAuth, requireRole('admin'), uploadLimiter, (req: Request, res: Response) => {
    upload.single('file')(req, res, async (uploadErr: any) => {
      try {
        if (uploadErr) {
          const tooBig = uploadErr?.code === 'LIMIT_FILE_SIZE';
          return res.status(400).json({ error: tooBig ? 'File is larger than 2 MB' : 'Could not read the upload' });
        }
        const file = (req as any).file as { buffer: Buffer; originalname: string } | undefined;
        if (!file) return res.status(400).json({ error: 'Attach a .csv or .xlsx file' });
        if (!/\.(csv|xlsx)$/i.test(file.originalname)) {
          return res.status(400).json({ error: 'Only .csv and .xlsx files are accepted' });
        }

        let raw: Array<Record<string, unknown>>;
        try {
          const wb = XLSX.read(file.buffer, { type: 'buffer', raw: false, sheetRows: IMPORT_MAX_ROWS + 2 });
          raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
        } catch {
          return res.status(400).json({ error: 'The file could not be read as a spreadsheet' });
        }

        const emails = raw
          .map(r => Object.entries(r).find(([k]) => /mail/i.test(k))?.[1])
          .filter(Boolean)
          .map(v => String(v).trim().toLowerCase());
        const { valid, issues } = validateImportRows(raw, await existingEmails(emails));

        res.json({
          rows: valid,
          issues,
          counts: {
            total: valid.length + issues.length,
            valid: valid.length,
            students: valid.filter(r => r.role === 'student').length,
            instructors: valid.filter(r => r.role === 'instructor').length,
            issues: issues.length,
          },
          batchSize: IMPORT_BATCH_SIZE,
        });
      } catch (e) {
        sendServerError(res, e);
      }
    });
  });

  // ── Commit one batch ───────────────────────────────────────────────────────
  router.post('/commit', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const { mode, rows } = req.body ?? {};
      if (mode !== 'invite' && mode !== 'temp_password') return res.status(400).json({ error: 'mode must be invite or temp_password' });
      if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'rows required' });
      if (rows.length > IMPORT_BATCH_SIZE) return res.status(400).json({ error: `At most ${IMPORT_BATCH_SIZE} rows per batch` });

      // Re-validate on the server; the client's copy is never trusted.
      const submitted = rows.map((r: any) => ({ name: r?.name, email: r?.email, role: r?.role, year: r?.year ?? '', major: r?.major ?? '' }));
      const emails = submitted.map(r => String(r.email ?? '').trim().toLowerCase());
      const { valid, issues } = validateImportRows(submitted, await existingEmails(emails));
      const rowNumberOf = (i: number) => Number(rows[i]?.row) || i + 2;

      const results: RowResult[] = issues.map(issue => {
        const idx = issue.row - 2;
        const base = { row: rowNumberOf(idx), email: issue.email ?? String(rows[idx]?.email ?? '') };
        return /already exists/.test(issue.reason)
          ? { ...base, status: 'exists' as const, reason: issue.reason }
          : { ...base, status: 'failed' as const, reason: issue.reason };
      });

      const { institutionId } = (req as AuthenticatedRequest).auth;
      for (const row of valid) {
        const original = { ...row, row: rowNumberOf(row.row - 2) };
        results.push(await createOne(original, institutionId, mode));
      }
      results.sort((a, b) => a.row - b.row);

      const tally = {
        created: results.filter(r => r.status === 'created').length,
        exists: results.filter(r => r.status === 'exists').length,
        failed: results.filter(r => r.status === 'failed').length,
        emailPending: results.filter(r => r.status === 'created' && r.emailPending).length,
      };
      const auth = (req as AuthenticatedRequest).auth;
      writeAudit({
        action: 'users.bulk_import',
        resourceType: 'institution',
        resourceId: institutionId,
        actorUserId: auth.legacyUserId,
        actorEmail: auth.email,
        actorRole: auth.role,
        metadata: { mode, ...tally }, // counts only; no names, emails or passwords
        req,
      });

      res.setHeader('Cache-Control', 'no-store'); // may carry temporary passwords
      res.json({ results, tally });
    } catch (e) {
      sendServerError(res, e);
    }
  });

  // ── Re-send set-password emails ────────────────────────────────────────────
  router.post('/resend-invites', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const emails: string[] = Array.isArray(req.body?.emails)
        ? [...new Set<string>(req.body.emails.map((e: unknown) => String(e).trim().toLowerCase()))].slice(0, IMPORT_BATCH_SIZE)
        : [];
      if (!emails.length) return res.status(400).json({ error: 'emails required' });

      // Only people who belong to the caller's college.
      const { institutionId } = (req as AuthenticatedRequest).auth;
      const { rows } = await pool.query<{ email: string }>(
        `SELECT lower(u.email) AS email FROM users u
         JOIN institution_members im ON im.user_id = u.id
         WHERE im.institution_id = $1 AND im.status = 'active' AND lower(u.email) = ANY($2::text[])`,
        [institutionId, emails],
      );
      const members = new Set(rows.map(r => r.email));

      const sent: string[] = [];
      const pending: string[] = [];
      let limited = false;
      for (const email of emails) {
        if (!members.has(email)) continue;
        if (limited) { pending.push(email); continue; }
        const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo: RESET_REDIRECT });
        if (!error) sent.push(email);
        else {
          pending.push(email);
          if (isRateLimited(error)) limited = true;
          else log.warn('resend invite failed', errorFields(error));
        }
      }
      res.json({ sent, pending, rateLimited: limited });
    } catch (e) {
      sendServerError(res, e);
    }
  });

  return router;
}
