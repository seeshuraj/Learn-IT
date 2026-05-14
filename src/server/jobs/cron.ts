/**
 * cron.ts — P3-2
 *
 * Schedules analytics snapshot jobs using node-cron.
 * Call startCronJobs(pool) once from startServer().
 *
 * Schedule: every 30 minutes  ->  '0,30 * * * *'
 * An immediate run fires on startup so the first request always hits
 * a warm snapshot (rather than waiting up to 30 min).
 *
 * node-cron is a zero-dependency in-process scheduler.
 * If you later move to a managed queue (BullMQ, pg-boss) replace this file.
 */

import pkg from 'pg';
const { Pool } = pkg;
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const cron = require('node-cron');

import { snapshotAdminStats, snapshotCourseAnalytics } from './analyticsSnapshot.js';

type PgPool = InstanceType<typeof Pool>;

export function startCronJobs(pool: PgPool): void {
  async function runAll() {
    await Promise.allSettled([
      snapshotAdminStats(pool),
      snapshotCourseAnalytics(pool),
    ]);
  }

  // Fire immediately on startup (non-blocking)
  runAll().catch((e: Error) => console.error('[cron] startup run failed:', e.message));

  // Then every 30 minutes
  cron.schedule('0,30 * * * *', () => {
    runAll().catch((e: Error) => console.error('[cron] scheduled run failed:', e.message));
  });

  console.log('[cron] analytics snapshot job registered (every 30 min)');
}
