/**
 * Per-request database timing, so the request log shows how much of each
 * request was spent waiting on Postgres (dbQueries, dbMs). With the API in
 * Singapore and the database in Mumbai, this is the number that says whether
 * moving the backend to India is worth it.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

export interface RequestStats { dbQueries: number; dbMs: number }

const als = new AsyncLocalStorage<RequestStats>();

/** Runs `fn` with a fresh stats object and returns it (read it when the response finishes). */
export function withRequestStats(fn: () => void): RequestStats {
  const stats: RequestStats = { dbQueries: 0, dbMs: 0 };
  als.run(stats, fn);
  return stats;
}

interface QueryablePool { query: (...args: any[]) => any }

/** Counts every pool.query made while handling a request. Call once at startup. */
export function instrumentPool<T extends QueryablePool>(pool: T): T {
  const original = pool.query.bind(pool);
  pool.query = ((...args: any[]) => {
    const stats = als.getStore();
    const result = original(...args);
    if (!stats || !result || typeof result.then !== 'function') return result;
    const started = performance.now();
    return result.finally(() => {
      stats.dbQueries++;
      stats.dbMs += performance.now() - started;
    });
  }) as T['query'];
  return pool;
}

/** Median round trip of a trivial query: the network cost every query pays. */
export async function measureDbRoundTrip(pool: QueryablePool, samples = 5): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t = performance.now();
    await pool.query('SELECT 1');
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return Math.round(times[Math.floor(times.length / 2)]);
}
