/**
 * auth.ts — server-side Supabase Auth middleware (P1-4)
 *
 * Every protected route passes through one of these middleware functions.
 * userId, institution and role are ALWAYS resolved from the database
 * (user_identity_map → the user's single active institution_members row) —
 * never trusted from the client request body, query string, or JWT metadata.
 *
 * Usage:
 *   app.get('/api/protected', requireAuth, handler)
 *   app.post('/api/admin/...', requireAuth, requireRole('admin'), handler)
 *   app.post('/api/instructor/...', requireAuth, requireRole('instructor', 'admin'), handler)
 */

import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import pkg from 'pg';
const { Pool } = pkg;

// ── Supabase server-side client (service role — never sent to browser) ──────
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── Shared DB pool (re-uses the pool from server.ts via module cache) ────────
let _pool: InstanceType<typeof Pool> | null = null;
export function setPool(pool: InstanceType<typeof Pool>) { _pool = pool; }

async function dbQuery(sql: string, params: unknown[] = []) {
  if (!_pool) throw new Error('DB pool not initialised — call setPool() first');
  const { rows } = await _pool.query(sql, params);
  return rows;
}

export type MemberRole = 'student' | 'instructor' | 'institution_admin' | 'institution_owner';

/** Institution roles collapse onto the three API roles used by requireRole. */
export function apiRoleOf(memberRole: MemberRole): 'student' | 'instructor' | 'admin' {
  return memberRole === 'institution_admin' || memberRole === 'institution_owner' ? 'admin' : memberRole;
}

// ── Extended request type ────────────────────────────────────────────────────
export interface AuthenticatedRequest extends Request {
  auth: {
    authUserId: string;       // Supabase Auth UUID (from getUser())
    legacyUserId: number;     // public.users integer PK
    role: 'student' | 'instructor' | 'admin';
    memberRole: MemberRole;   // institution_members.role (admin vs owner kept distinct)
    institutionId: string;    // the caller's active institution
    email: string;
  };
}

// ── Core: validate bearer token with Supabase Auth server-side ───────────────
/**
 * requireAuth
 *
 * 1. Extracts `Authorization: Bearer <token>` header.
 * 2. Calls supabase.auth.getUser(token) — makes a live network call to
 *    Supabase Auth to verify the token and check session validity.
 *    This is the ONLY safe way to verify a user server-side.
 *    getClaims() / JWT decode is NOT used here — it does not detect revoked sessions.
 * 3. Resolves legacyUserId from public.user_identity_map, then the caller's
 *    single active membership in an active institution. No membership → 403.
 * 4. Attaches result to req.auth.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  // getUser() validates the token against Supabase Auth server — not just JWT sig.
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  // Resolve identity and tenant from the DB — never trust JWT app_metadata.
  // The partial unique index on institution_members guarantees ≤ 1 active row.
  let rows: any[];
  try {
    rows = await dbQuery(
      `SELECT uim.legacy_user_id, im.role, im.institution_id
       FROM public.user_identity_map uim
       JOIN public.institution_members im
         ON im.user_id = uim.legacy_user_id AND im.status = 'active'
       JOIN public.institutions i
         ON i.id = im.institution_id AND i.status = 'active'
       WHERE uim.auth_user_id = $1 AND uim.is_active = true`,
      [user.id]
    );
  } catch (err) {
    next(err);
    return;
  }

  if (!rows.length) {
    res.status(403).json({ error: 'No active institution membership for this account' });
    return;
  }

  (req as AuthenticatedRequest).auth = {
    authUserId:    user.id,
    legacyUserId:  rows[0].legacy_user_id,
    role:          apiRoleOf(rows[0].role),
    memberRole:    rows[0].role,
    institutionId: rows[0].institution_id,
    email:         user.email ?? '',
  };

  next();
}

// ── Role guard ───────────────────────────────────────────────────────────────
/**
 * requireRole(...roles)
 *
 * Must be used AFTER requireAuth. Checks that req.auth.role is in the
 * allowed list. Roles are resolved from the DB — never from the request.
 */
export function requireRole(
  ...roles: Array<'student' | 'instructor' | 'admin'>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = (req as AuthenticatedRequest).auth;
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (!roles.includes(auth.role)) {
      res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
      return;
    }
    next();
  };
}

// ── Self-or-admin guard ──────────────────────────────────────────────────────
/**
 * requireSelfOrAdmin(paramName)
 *
 * Ensures the route param (default 'id') matches the caller's legacyUserId,
 * OR the caller is an admin of the institution the target user belongs to.
 * Prevents student A reading student B's data, and an admin of college A
 * reading a student of college B (reported as 404).
 *
 * Example: GET /api/student/:id/stats
 *   → only the student themselves OR an admin can call this.
 */
export function requireSelfOrAdmin(paramName = 'id') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = (req as AuthenticatedRequest).auth;
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const target = req.params[paramName];
    if (String(auth.legacyUserId) === target) {
      next();
      return;
    }
    if (auth.role !== 'admin') {
      res.status(403).json({ error: 'Access denied: not your resource' });
      return;
    }
    if (!/^\d+$/.test(target ?? '')) {
      res.status(400).json({ error: 'Invalid user id' });
      return;
    }
    try {
      const rows = await dbQuery(
        `SELECT 1 FROM public.institution_members
         WHERE user_id = $1 AND institution_id = $2 AND status <> 'removed'`,
        [Number(target), auth.institutionId]
      );
      if (!rows.length) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
