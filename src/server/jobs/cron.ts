/**
 * cron.ts
 *
 * Schedules analytics snapshot jobs using node-cron.
 * Call startCronJobs(pool, extraJobs) once from startServer().
 *
 * Schedule: every 30 minutes  ->  '0,30 * * * *'
 * An immediate run fires on startup so the first request always hits
 * a warm snapshot (rather than waiting up to 30 min).
 *
 * Safe with several backend instances: each run first takes a Postgres
 * advisory lock inside a transaction, and instances that don't get it skip
 * the run. A transaction-scoped lock also works through Supabase's
 * transaction pooler.
 */

import pkg from 'pg';
const { Pool } = pkg;
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const cron = require('node-cron');

import { snapshotAdminStats, snapshotCourseAnalytics } from './analyticsSnapshot.js';
import { log, errorFields } from '../lib/log.js';
import { runExclusive } from '../lib/advisoryLock.js';

type PgPool = InstanceType<typeof Pool>;

/** Arbitrary constant identifying the snapshot job's advisory lock. */
const CRON_LOCK_KEY = 74_201_001;

/**
 * Start background cron jobs.
 *
 * `extraJobs` run alongside the snapshots on startup and every tick (e.g. the
 * idempotent stale-embedding catch-up). Each job handles its own errors; a
 * rejection is logged and never stops the others.
 */
export async function startCronJobs(
  pool: PgPool,
  extraJobs: Array<() => Promise<unknown>> = [],
): Promise<void> {
  async function runAll() {
    const ran = await runExclusive(pool, CRON_LOCK_KEY, runJobs);
    if (!ran) log.info('cron run skipped: another instance holds the lock');
  }

  async function runJobs() {
    const results = await Promise.allSettled([
      snapshotAdminStats(pool),
      snapshotCourseAnalytics(pool),
      ...extraJobs.map(job => job()),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') log.error('cron job failed', errorFields(r.reason));
    }
  }

  // Fire immediately on startup (non-blocking)
  runAll().catch((e: Error) => log.error('cron startup run failed', errorFields(e)));

  // Then every 30 minutes
  cron.schedule('0,30 * * * *', () => {
    runAll().catch((e: Error) => log.error('cron scheduled run failed', errorFields(e)));
  });

  log.info('cron registered', { job: 'analytics-snapshot', schedule: '0,30 * * * *', extraJobs: extraJobs.length });
}
