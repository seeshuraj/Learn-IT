import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRequestStats, instrumentPool, measureDbRoundTrip } from '../requestStats.js';

const fakePool = () => ({ calls: 0, async query(_sql: string) { this.calls++; await new Promise(r => setTimeout(r, 5)); return { rows: [] }; } });

test('queries made while handling a request are counted and timed', async () => {
  const pool = instrumentPool(fakePool());
  let done!: () => void;
  const finished = new Promise<void>(r => { done = r; });
  const stats = withRequestStats(() => {
    void (async () => {
      await pool.query('SELECT 1');
      await Promise.all([pool.query('SELECT 2'), pool.query('SELECT 3')]);
      done();
    })();
  });
  await finished;
  assert.equal(stats.dbQueries, 3);
  assert.ok(stats.dbMs >= 10, `dbMs ${stats.dbMs}`);
});

test('queries outside a request are not counted and results pass through', async () => {
  const pool = instrumentPool(fakePool());
  assert.deepEqual(await pool.query('SELECT 1'), { rows: [] });
  const ms = await measureDbRoundTrip(pool, 3);
  assert.ok(ms >= 4 && ms < 1000);
  assert.equal(pool.calls, 4);
});
