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
import { createHash } from 'node:crypto';
import pkg from 'pg';
import { TtlCache } from '../lib/ttlCache.js';
import { userApiLimiter } from './rateLimit.js';
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
    authUserId: string;       // Supabase Auth UUID (token subject)
    legacyUserId: number;     // public.users integer PK
    role: 'student' | 'instructor' | 'admin';
    memberRole: MemberRole;   // institution_members.role (admin vs owner kept distinct)
    institutionId: string;    // the caller's active institution
    email: string;
  };
}

// ── Token verification ───────────────────────────────────────────────────────
// AUTH_VERIFY_MODE=local (default): the access token's signature is checked
// here against the project's published signing keys (ES256, JWKS fetched once
// and cached by supabase-js). No call to Supabase Auth per request, so no
// per-IP auth rate limit to hit and no extra round trip.
//   Trade-off: a token stays valid until it expires even after sign-out. Keep
//   the JWT expiry short (Supabase → Auth → Sessions; 15–30 min) and rely on
//   the membership check below, which blocks deactivated or removed accounts
//   within AUTH_CACHE_TTL_MS.
// AUTH_VERIFY_MODE=remote: every new token is checked with Supabase Auth
// (getUser), which also sees revoked sessions; counted against the "sign-ups
// and sign-ins" per-IP limit, so raise that limit if you use it.
//
// Successful verifications are cached for AUTH_CACHE_TTL_MS (default 60 s;
// 0 disables), keyed by a SHA-256 hash of the token, never past its expiry.
type VerifiedUser = { id: string; email: string };
const authCacheTtlMs = Math.max(0, Number(process.env.AUTH_CACHE_TTL_MS ?? 60_000) || 0);
const verifyMode: 'local' | 'remote' = process.env.AUTH_VERIFY_MODE === 'remote' ? 'remote' : 'local';
const verifiedSessions = new TtlCache<VerifiedUser>(authCacheTtlMs, 20_000);

async function verifyToken(token: string): Promise<VerifiedUser | null> {
  const key = createHash('sha256').update(token).digest('hex');
  const cached = verifiedSessions.get(key);
  if (cached) return cached;

  let verified: VerifiedUser;
  if (verifyMode === 'local') {
    const expSec = jwtExpiry(token);
    if (!expSec || expSec * 1000 <= Date.now()) return null;
    const { data, error } = await supabaseAdmin.auth.getClaims(token);
    const claims = data?.claims as Record<string, unknown> | undefined;
    // Only signed-in users' tokens: not the anon or service-role keys.
    if (error || !claims || typeof claims.sub !== 'string' || claims.role !== 'authenticated') return null;
    verified = { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : '' };
  } else {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return null;
    verified = { id: user.id, email: user.email ?? '' };
  }
  // Never cache past the token's own expiry.
  const expSec = jwtExpiry(token);
  const ttl = expSec ? Math.min(authCacheTtlMs, expSec * 1000 - Date.now()) : authCacheTtlMs;
  verifiedSessions.set(key, verified, ttl);
  return verified;
}

/** Reads `exp` from a JWT payload without verifying it (only used to bound the cache TTL). */
function jwtExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

// ── Membership cache ─────────────────────────────────────────────────────────
// Saves one database round trip per request (the API and database are in
// different regions). Cleared on this instance whenever an admin changes users.
const memberships = new TtlCache<any[]>(authCacheTtlMs, 20_000);

/** Call after changing anyone's role, status or membership. */
export function clearMembershipCache(): void {
  memberships.clear();
}

// ── Core: validate bearer token ──────────────────────────────────────────────
/**
 * requireAuth
 *
 * 1. Extracts `Authorization: Bearer <token>` header.
 * 2. Verifies the token (see "Token verification" above: signature check by
 *    default, or a call to Supabase Auth with AUTH_VERIFY_MODE=remote).
 * 3. Resolves legacyUserId from public.user_identity_map, then the caller's
 *    single active membership in an active institution. No membership → 403.
 *    The lookup is cached per auth user for AUTH_CACHE_TTL_MS, so a role
 *    change or deactivation applies within that window on every instance
 *    (immediately on the instance that made the change).
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

  let user: VerifiedUser | null;
  try {
    user = await verifyToken(token);
  } catch (err) {
    next(err);
    return;
  }
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  // Resolve identity and tenant from the DB — never trust JWT app_metadata.
  // The partial unique index on institution_members guarantees ≤ 1 active row.
  let rows: any[];
  try {
    const cachedMembership = memberships.get(user.id);
    rows = cachedMembership ?? await dbQuery(
      `SELECT uim.legacy_user_id, im.role, im.institution_id
       FROM public.user_identity_map uim
       JOIN public.institution_members im
         ON im.user_id = uim.legacy_user_id AND im.status = 'active'
       JOIN public.institutions i
         ON i.id = im.institution_id AND i.status = 'active'
       WHERE uim.auth_user_id = $1 AND uim.is_active = true`,
      [user.id]
    );
    // Cache found memberships only, so a newly added account works at once.
    if (!cachedMembership && rows.length) memberships.set(user.id, rows);
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
    email:         user.email,
  };

  // Per-user request quota (campus-NAT safe; see rateLimit.ts).
  userApiLimiter(req, res, next);
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
