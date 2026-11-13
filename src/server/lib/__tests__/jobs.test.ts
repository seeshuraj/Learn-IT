/**
 * JobQueue against a real Postgres (claiming, SKIP LOCKED, retries, dedupe).
 * Runs when JOBS_TEST_PSQL_DB names a scratch database that has the jobs
 * migration applied (queries go through `psql`); skipped otherwise.
 *
 *   JOBS_TEST_PSQL_DB=jobs_test PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres node --test …
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { JobQueue, PermanentJobError, retryDelayMs, GENERIC_JOB_ERROR } from '../jobs.js';

const DB = process.env.JOBS_TEST_PSQL_DB;
const run = promisify(execFile);

/** Inline a parameter as a SQL literal (test-only; values come from this file). */
function literal(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return `ARRAY[${v.map(literal).join(',')}]::text[]`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Minimal Queryable over psql: each call is its own session, like separate pool connections. */
const psqlDb = {
  async query(sql: string, params: unknown[] = []) {
    let text = sql;
    for (let i = params.length; i >= 1; i--) text = text.replaceAll(`$${i}`, literal(params[i - 1]));
    const dml = /^\s*(UPDATE|INSERT|DELETE)\b/i.test(text);
    if (dml && !/\bRETURNING\b/i.test(text)) text += ' RETURNING 1 AS _';
    const wrapped = dml || /^\s*SELECT\b/i.test(text)
      ? `WITH r AS (${text}) SELECT coalesce(json_agg(r), '[]') FROM r`
      : text;
    const { stdout } = await run('psql', ['-d', DB!, '-tAq', '-v', 'ON_ERROR_STOP=1', '-c', wrapped]);
    const rows = JSON.parse(stdout.trim() || '[]');
    return { rows, rowCount: rows.length };
  },
};

const sql = (q: string) => psqlDb.query(q);
const inst = async () => (await sql(`INSERT INTO institutions DEFAULT VALUES RETURNING id`)).rows[0].id as string;
const job = async (id: number) => (await sql(`SELECT * FROM jobs WHERE id = ${id}`)).rows[0];

test('retry backoff grows and is capped', () => {
  assert.equal(retryDelayMs(1), 10_000);
  assert.equal(retryDelayMs(2), 40_000);
  assert.equal(retryDelayMs(10), 30 * 60_000);
});

test('enqueue → claim → done, result stored, status scoped to the college', { skip: !DB }, async () => {
  await sql('DELETE FROM jobs');
  const a = await inst(), b = await inst();
  const q = new JobQueue(psqlDb, { workerId: 'w1' });
  q.register('t.ok', async j => ({ doubled: j.payload.n * 2 }));
  const { id } = await q.enqueue('t.ok', { n: 21 }, { institutionId: a, createdBy: 7 });
  assert.equal((await q.get(id, a))!.status, 'queued');
  assert.equal(await q.drain(), 1);
  const view = await q.get(id, a);
  assert.deepEqual([view!.status, view!.result, view!.attempts], ['done', { doubled: 42 }, 1]);
  assert.equal(await q.get(id, b), null, 'another college cannot see it');
  assert.equal(await q.ownerOf(id, a), 7);
});

test('dedupe: same key while pending returns the existing job; allowed again after it finishes', { skip: !DB }, async () => {
  await sql('DELETE FROM jobs');
  const q = new JobQueue(psqlDb).register('t.ok', async () => 'ok');
  const first = await q.enqueue('t.ok', {}, { dedupeKey: 'note:1' });
  const again = await q.enqueue('t.ok', {}, { dedupeKey: 'note:1' });
  assert.deepEqual([again.id, again.deduped], [first.id, true]);
  await q.drain();
  const later = await q.enqueue('t.ok', {}, { dedupeKey: 'note:1' });
  assert.notEqual(later.id, first.id);
  assert.equal(later.deduped, false);
});

test('transient failure retries with backoff; the last attempt fails with a generic message', { skip: !DB }, async () => {
  await sql('DELETE FROM jobs');
  const a = await inst();
  let calls = 0;
  const q = new JobQueue(psqlDb).register('t.flaky', async () => { calls++; throw new Error('db password=secret timeout'); });
  const { id } = await q.enqueue('t.flaky', {}, { institutionId: a, maxAttempts: 2 });
  await q.drain();
  let row = await job(id);
  assert.equal(row.status, 'queued');
  assert.ok(new Date(row.run_after).getTime() > Date.now() + 5_000, 'backed off');
  await sql(`UPDATE jobs SET run_after = now() WHERE id = ${id}`);
  await q.drain();
  row = await job(id);
  assert.deepEqual([row.status, row.attempts, calls], ['failed', 2, 2]);
  assert.match(row.last_error, /timeout/, 'internal error kept for logs');
  assert.equal((await q.get(id, a))!.error, GENERIC_JOB_ERROR, 'users never see internal error text');
});

test('PermanentJobError fails at once and its message is shown; failure hook runs', { skip: !DB }, async () => {
  await sql('DELETE FROM jobs');
  const a = await inst();
  const hooked: number[] = [];
  const q = new JobQueue(psqlDb)
    .register('t.bad', async () => { throw new PermanentJobError('You no longer have access to this submission.'); })
    .onFailure('t.bad', async j => { hooked.push(j.id); });
  const { id } = await q.enqueue('t.bad', {}, { institutionId: a });
  await q.drain();
  const view = await q.get(id, a);
  assert.deepEqual([view!.status, view!.error, view!.attempts], ['failed', 'You no longer have access to this submission.', 1]);
  assert.deepEqual(hooked, [id]);
});

test('two workers racing never run the same job twice (SKIP LOCKED)', { skip: !DB }, async () => {
  await sql('DELETE FROM jobs');
  const seen: number[] = [];
  const handler = async (j: any) => { seen.push(j.id); await new Promise(r => setTimeout(r, 50)); };
  const w1 = new JobQueue(psqlDb, { workerId: 'w1', concurrency: 3 }).register('t.race', handler);
  const w2 = new JobQueue(psqlDb, { workerId: 'w2', concurrency: 3 }).register('t.race', handler);
  for (let i = 0; i < 12; i++) await w1.enqueue('t.race', { i });
  await Promise.all([w1.drain(), w2.drain(), w1.drain(), w2.drain()]);
  await Promise.all([w1.drain(), w2.drain()]);
  assert.equal(seen.length, 12, 'every job ran');
  assert.equal(new Set(seen).size, 12, 'no job ran twice');
  const { rows } = await sql(`SELECT count(*)::int AS n FROM jobs WHERE status = 'done'`);
  assert.equal(rows[0].n, 12);
  const { rows: by } = await sql(`SELECT count(DISTINCT locked_by) AS n FROM jobs`);
  assert.ok(by[0].n !== undefined);
});

test('a job abandoned by a crashed worker is requeued, then runs', { skip: !DB }, async () => {
  await sql('DELETE FROM jobs');
  const q = new JobQueue(psqlDb, { staleMs: 1_000 }).register('t.ok', async () => 'ok');
  const { id } = await q.enqueue('t.ok', {});
  await sql(`UPDATE jobs SET status = 'running', attempts = 1, locked_at = now() - interval '1 hour', locked_by = 'dead' WHERE id = ${id}`);
  await q.drain();
  const row = await job(id);
  assert.deepEqual([row.status, row.attempts], ['done', 2]);
});

test('only kinds this worker handles are claimed', { skip: !DB }, async () => {
  await sql('DELETE FROM jobs');
  const q = new JobQueue(psqlDb).register('t.mine', async () => 'ok');
  const mine = await q.enqueue('t.mine', {});
  const other = await q.enqueue('t.other', {});
  await q.drain();
  assert.equal((await job(mine.id)).status, 'done');
  assert.equal((await job(other.id)).status, 'queued');
});
