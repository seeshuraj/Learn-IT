/**
 * Creating a person's account: LearnIT rows, their college membership and
 * their Supabase Auth login.
 *
 * Order matters. Supabase runs a trigger on auth.users (handle_new_auth_user)
 * that inserts the same email into public.users. If our public.users row is
 * still inside an open transaction while we call Auth, the trigger waits for
 * our transaction and our transaction waits for Auth: neither finishes and
 * every retry queues behind them. So:
 *
 *   1. insert users + institution_members and COMMIT;
 *   2. create the Auth user (the trigger finds our committed row and maps it);
 *   3. record the identity mapping (role, must-change-password).
 *
 * If step 2 or 3 fails, the rows from step 1 (and the Auth user, if created)
 * are removed again, so a failed attempt leaves nothing behind and can be
 * retried.
 */

import { resolveDepartmentId } from './departments.js';

type Db = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
  connect: () => Promise<{ query: Db['query']; release: () => void }>;
};

export interface AuthAdmin {
  createUser(o: { email: string; password: string; email_confirm: boolean }):
    Promise<{ data: { user: { id: string } | null } | null; error: { message?: string; status?: number } | null }>;
  deleteUser(id: string): Promise<unknown>;
}

export interface NewAccount {
  name: string;
  email: string;
  /** users.role: student | instructor | admin */
  role: string;
  /** institution_members.role: student | instructor | institution_admin */
  memberRole: string;
  institutionId: string;
  year?: number | null;
  major?: string | null;
  gpa?: number | null;
  password: string;
  forcePasswordChange: boolean;
}

export class AccountExists extends Error {
  constructor() { super('An account with this email already exists'); this.name = 'AccountExists'; }
}

const PG_UNIQUE = '23505';
export const isAlreadyRegistered = (err: { message?: string } | null | undefined) =>
  !!err && /already (been )?registered|already exists/i.test(err.message ?? '');

export async function provisionAccount(db: Db, auth: AuthAdmin, a: NewAccount): Promise<{ userId: number; authUserId: string }> {
  const email = a.email.trim().toLowerCase();
  const year = Number.isInteger(a.year) && (a.year as number) >= 1 && (a.year as number) <= 10 ? a.year : null;

  // 1. LearnIT rows, committed before Auth is called.
  const client = await db.connect();
  let userId: number;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO users (name, email, role, active, year, major, gpa)
       VALUES ($1, $2, $3, 1, $4, $5, $6) RETURNING id`,
      [a.name, email, a.role, year, a.major || null, a.gpa ?? null],
    );
    userId = rows[0].id;
    const departmentId = await resolveDepartmentId(client, a.institutionId, a.major, { create: true });
    await client.query(
      `INSERT INTO institution_members (institution_id, user_id, role, department_id, year_of_study)
       VALUES ($1, $2, $3, $4, $5)`,
      [a.institutionId, userId, a.memberRole, departmentId, a.memberRole === 'student' ? year : null],
    );
    await client.query('COMMIT');
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (e?.code === PG_UNIQUE) throw new AccountExists();
    throw e;
  } finally {
    client.release();
  }

  // 2–3. Login and mapping; undo step 1 if either fails.
  let authUserId: string | null = null;
  try {
    const created = await auth.createUser({ email, password: a.password, email_confirm: true });
    if (created.error || !created.data?.user) {
      if (isAlreadyRegistered(created.error)) throw new AccountExists();
      throw new Error(`Supabase Auth createUser failed: ${created.error?.message ?? 'no user returned'}`);
    }
    authUserId = created.data.user.id;
    // The Auth trigger usually created this mapping already; make sure it
    // points at this login and carries the role and password rule.
    const mapped = await db.query(
      `INSERT INTO user_identity_map (legacy_user_id, auth_user_id, role, force_password_change)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (legacy_user_id) DO UPDATE
         SET role = EXCLUDED.role, force_password_change = EXCLUDED.force_password_change
         WHERE user_identity_map.auth_user_id = EXCLUDED.auth_user_id
       RETURNING legacy_user_id`,
      [userId, authUserId, a.role, a.forcePasswordChange],
    );
    if (!mapped.rows.length) throw new Error('identity map points at a different login');
    return { userId, authUserId };
  } catch (e) {
    if (authUserId) await Promise.resolve(auth.deleteUser(authUserId)).catch(() => undefined);
    await db.query('DELETE FROM user_identity_map WHERE legacy_user_id = $1', [userId]).catch(() => undefined);
    await db.query('DELETE FROM institution_members WHERE user_id = $1 AND institution_id = $2', [userId, a.institutionId]).catch(() => undefined);
    await db.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => undefined);
    throw e;
  }
}
