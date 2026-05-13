/**
 * auth.ts — server-side Supabase Auth middleware (P1-4)
 *
 * Every protected route passes through one of these middleware functions.
 * Role and userId are ALWAYS resolved from the database via user_identity_map —
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

// ── Extended request type ────────────────────────────────────────────────────
export interface AuthenticatedRequest extends Request {
  auth: {
    authUserId: string;       // Supabase Auth UUID (from getUser())
    legacyUserId: number;     // public.users integer PK
    role: 'student' | 'instructor' | 'admin';
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
 * 3. Resolves legacyUserId and role from public.user_identity_map.
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

  // Resolve identity from our bridge table — never trust JWT app_metadata.role
  const rows = await dbQuery(
    `SELECT uim.legacy_user_id, uim.role
     FROM public.user_identity_map uim
     WHERE uim.auth_user_id = $1 AND uim.is_active = true`,
    [user.id]
  );

  if (!rows.length) {
    res.status(403).json({ error: 'User not provisioned in this application' });
    return;
  }

  (req as AuthenticatedRequest).auth = {
    authUserId:   user.id,
    legacyUserId: rows[0].legacy_user_id,
    role:         rows[0].role,
    email:        user.email ?? '',
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
 * OR the caller is an admin. Prevents student A reading student B's data
 * even if both are authenticated.
 *
 * Example: GET /api/student/:id/stats
 *   → only the student themselves OR an admin can call this.
 */
export function requireSelfOrAdmin(paramName = 'id') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = (req as AuthenticatedRequest).auth;
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (
      auth.role === 'admin' ||
      String(auth.legacyUserId) === req.params[paramName]
    ) {
      next();
      return;
    }
    res.status(403).json({ error: 'Access denied: not your resource' });
  };
}
