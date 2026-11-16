import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provisionAccount, AccountExists, type AuthAdmin } from '../provisionAccount.js';

/** Records every statement in order; `fail` makes matching SQL throw. */
function fakeDb(opts: { fail?: RegExp; failWith?: any; mapRows?: number } = {}) {
  const log: string[] = [];
  const run = async (sql: string) => {
    const s = sql.trim().split(/\s+/).slice(0, 3).join(' ');
    log.push(s);
    if (opts.fail && opts.fail.test(sql)) throw opts.failWith ?? new Error('boom');
    if (/^INSERT INTO users/.test(sql.trim())) return { rows: [{ id: 41 }] };
    if (/FROM departments/.test(sql)) return { rows: [{ id: 3 }] };
    if (/user_identity_map/.test(sql) && /^INSERT/.test(sql.trim())) return { rows: Array(opts.mapRows ?? 1).fill({ legacy_user_id: 41 }) };
    return { rows: [] };
  };
  return { log, db: { query: run, connect: async () => ({ query: run, release: () => {} }) } };
}

function fakeAuth(result: 'ok' | 'exists' | 'error', calls: string[]): AuthAdmin {
  return {
    async createUser() {
      calls.push('auth.createUser');
      if (result === 'exists') return { data: null, error: { message: 'A user with this email address has already been registered' } };
      if (result === 'error') return { data: null, error: { message: 'service unavailable' } };
      return { data: { user: { id: 'auth-uuid' } }, error: null };
    },
    async deleteUser(id) { calls.push(`auth.deleteUser ${id}`); },
  };
}

const account = {
  name: 'Rupesh', email: ' Rupesh@LearnIT.edu ', role: 'student', memberRole: 'student',
  institutionId: 'inst', year: 0, major: 'Masters Business Analytics', password: 'x', forcePasswordChange: true,
};

test('LearnIT rows are committed before Auth is called (no lock wait on the Auth trigger)', async () => {
  const { log, db } = fakeDb();
  const calls: string[] = [];
  const auth = fakeAuth('ok', calls);
  const wrapped = { ...auth, createUser: async (o: any) => { calls.push(`committed=${log.includes('COMMIT')}`); assert.equal(o.email, 'rupesh@learnit.edu'); return auth.createUser(o); } };
  const out = await provisionAccount(db, wrapped, account);
  assert.deepEqual(out, { userId: 41, authUserId: 'auth-uuid' });
  assert.deepEqual(calls, ['committed=true', 'auth.createUser']);
  assert.deepEqual(log.slice(0, 5), ['BEGIN', 'INSERT INTO users', 'SELECT id FROM', 'INSERT INTO institution_members', 'COMMIT']);
  assert.equal(log[5], 'INSERT INTO user_identity_map');
});

test('a year of 0 (empty form field) is stored as no year', async () => {
  const seen: unknown[][] = [];
  const { db } = fakeDb();
  const q = db.query;
  const spy = { ...db, connect: async () => ({ query: async (sql: string, p?: unknown[]) => { if (/institution_members/.test(sql)) seen.push(p!); return q(sql); }, release: () => {} }) };
  await provisionAccount(spy, fakeAuth('ok', []), account);
  assert.equal(seen[0][4], null);
});

test('login already exists: rows removed, AccountExists', async () => {
  const { log, db } = fakeDb();
  const calls: string[] = [];
  await assert.rejects(provisionAccount(db, fakeAuth('exists', calls), account), AccountExists);
  assert.deepEqual(log.slice(-3), ['DELETE FROM user_identity_map', 'DELETE FROM institution_members', 'DELETE FROM users']);
  assert.ok(!calls.some(c => c.startsWith('auth.deleteUser')));
});

test('mapping fails after the login was made: login and rows removed', async () => {
  const { log, db } = fakeDb({ mapRows: 0 });
  const calls: string[] = [];
  await assert.rejects(provisionAccount(db, fakeAuth('ok', calls), account), /different login/);
  assert.deepEqual(calls, ['auth.createUser', 'auth.deleteUser auth-uuid']);
  assert.equal(log.at(-1), 'DELETE FROM users');
});

test('email already in LearnIT: AccountExists, Auth never called', async () => {
  const { db } = fakeDb({ fail: /^\s*INSERT INTO users/, failWith: Object.assign(new Error('dup'), { code: '23505' }) });
  const calls: string[] = [];
  await assert.rejects(provisionAccount(db, fakeAuth('ok', calls), account), AccountExists);
  assert.deepEqual(calls, []);
});
