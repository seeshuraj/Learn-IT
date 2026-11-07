/**
 * Helpers that keep the backend safe for many users behind one campus IP and
 * for several backend instances: per-user rate-limit keys, env-tunable
 * limits, the verified-session TTL cache and the single-runner advisory lock.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitFromEnv, userKey } from '../rateLimitKeys.js';
import { TtlCache } from '../ttlCache.js';
import { runExclusive } from '../advisoryLock.js';

test('signed-in users on one campus IP get separate rate-limit buckets', () => {
  const a = userKey({ ip: '203.0.113.7', auth: { legacyUserId: 11, institutionId: 'inst-a' } });
  const b = userKey({ ip: '203.0.113.7', auth: { legacyUserId: 12, institutionId: 'inst-a' } });
  assert.notEqual(a, b);
  assert.equal(a, 'u:inst-a:11');
});

test('same user id in two colleges does not share a bucket', () => {
  assert.notEqual(
    userKey({ auth: { legacyUserId: 5, institutionId: 'inst-a' } }),
    userKey({ auth: { legacyUserId: 5, institutionId: 'inst-b' } }),
  );
});

test('unauthenticated requests fall back to the client IP', () => {
  assert.equal(userKey({ ip: '198.51.100.4' }), 'ip:198.51.100.4');
  assert.equal(userKey({}), 'ip:unknown');
});

test('limits are tunable per deployment and ignore invalid values', () => {
  assert.equal(limitFromEnv('AI', 40, {}), 40);
  assert.equal(limitFromEnv('AI', 40, { RATE_AI_MAX: '120' }), 120);
  for (const bad of ['0', '-5', '2.5', 'lots', '']) {
    assert.equal(limitFromEnv('AI', 40, { RATE_AI_MAX: bad }), 40, `value ${JSON.stringify(bad)}`);
  }
});

test('TtlCache expires entries and respects a shorter per-entry TTL', () => {
  let now = 1_000;
  const cache = new TtlCache<string>(60_000, 10, () => now);
  cache.set('a', 'A');
  cache.set('b', 'B', 5_000);
  now += 4_999;
  assert.equal(cache.get('b'), 'B');
  now += 1;
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 'A');
  now += 60_000;
  assert.equal(cache.get('a'), undefined);
});

test('TtlCache evicts the oldest entry at capacity and can be disabled', () => {
  const cache = new TtlCache<number>(60_000, 2);
  cache.set('x', 1);
  cache.set('y', 2);
  cache.set('z', 3);
  assert.equal(cache.get('x'), undefined);
  assert.equal(cache.size, 2);

  const off = new TtlCache<number>(0, 100);
  off.set('k', 1);
  assert.equal(off.get('k'), undefined);
});

function fakePool(lockGranted: boolean) {
  const sql: string[] = [];
  let released = 0;
  const client = {
    async query(text: string) {
      sql.push(text);
      return { rows: text.includes('pg_try_advisory_xact_lock') ? [{ locked: lockGranted }] : [] };
    },
    release() { released++; },
  };
  return { pool: { connect: async () => client }, sql, released: () => released };
}

test('runExclusive runs the work only when it wins the lock', async () => {
  const won = fakePool(true);
  let ran = 0;
  assert.equal(await runExclusive(won.pool, 1, async () => { ran++; }), true);
  assert.equal(ran, 1);
  assert.deepEqual(won.sql.map(s => s.split(' ')[0]), ['BEGIN', 'SELECT', 'COMMIT']);
  assert.equal(won.released(), 1);

  const lost = fakePool(false);
  assert.equal(await runExclusive(lost.pool, 1, async () => { ran++; }), false);
  assert.equal(ran, 1);
  assert.deepEqual(lost.sql.map(s => s.split(' ')[0]), ['BEGIN', 'SELECT', 'ROLLBACK']);
  assert.equal(lost.released(), 1);
});

test('runExclusive releases the connection when the work throws', async () => {
  const p = fakePool(true);
  await assert.rejects(runExclusive(p.pool, 1, async () => { throw new Error('boom'); }), /boom/);
  assert.equal(p.released(), 1);
});
