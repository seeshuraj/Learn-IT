/**
 * cron.ts
 *
 * Schedules analytics snapshot jobs using node-cron.
 * Call startCronJobs(pool) once from startServer().
 *
 * Schedule: every 30 minutes  ->  '0,30 * * * *'
 * An immediate run fires on startup so the first request always hits
 * a warm snapshot (rather than waiting up to 30 min).
 */

import pkg from 'pg';
const { Pool } = pkg;
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const cron = require('node-cron');

import { snapshotAdminStats, snapshotCourseAnalytics } from './analyticsSnapshot.js';

type PgPool = InstanceType<typeof Pool>;

/**
 * Start background cron jobs.
 *
 * Returns a Promise so callers can safely do:
 *   startCronJobs(pool).catch(console.error)
 *
 * The second argument (nimChat) is accepted but currently unused — it is
 * kept so the signature matches the call in server.ts without needing a
 * separate change there.
 */
export async function startCronJobs(
  pool: PgPool,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _nimChat?: unknown,
): Promise<void> {
  async function runAll() {
    await Promise.allSettled([
      snapshotAdminStats(pool),
      snapshotCourseAnalytics(pool),
    ]);
  }

  // Fire immediately on startup (non-blocking — error is caught internally)
  runAll().catch((e: Error) => console.error('[cron] startup run failed:', e.message));

  // Then every 30 minutes
  cron.schedule('0,30 * * * *', () => {
    runAll().catch((e: Error) => console.error('[cron] scheduled run failed:', e.message));
  });

  console.log('[cron] analytics snapshot job registered (every 30 min)');
}
