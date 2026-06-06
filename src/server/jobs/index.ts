/**
 * jobs/index.ts
 *
 * Stable public entry-point for background jobs.
 * Re-exports startCronJobs so server.ts always imports from here,
 * insulating it from internal job file renames.
 */
export { startCronJobs } from './cron.js';
